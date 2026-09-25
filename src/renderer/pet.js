'use strict';

/**
 * 桌宠窗口渲染与交互。
 * 所有纯逻辑（状态机 / 取帧）都走 window.hermes.pet（preload 里 require 的 src/core），
 * 这里只做 DOM、动画节拍、鼠标键盘与气泡排版。
 *
 * 拖拽注意：整窗**不加** -webkit-app-region: drag（会吃掉点击）。用位移 > 5px 判定拖拽，
 * 否则算点击 —— 保证「拖完之后还能点开对话」。
 */

const api = window.hermes;

const stage = document.getElementById('stage');
const cat = document.getElementById('cat');
const slot = document.getElementById('cat-slot');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleUser = document.getElementById('bubble-user');
const bubbleNotice = document.getElementById('bubble-notice');
const bubbleActions = document.getElementById('bubble-actions');
const bubbleAction = document.getElementById('bubble-action');
const bubblePin = document.getElementById('bubble-pin');
const bubbleCopied = document.getElementById('bubble-copied');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

const SPRITE_URL = '../../data/sprites/oneko.gif';
const FRAME_MS_DAY = 1000 / 30; // 目标 30fps
const FRAME_MS_NIGHT = 1000 / 15; // 深夜模式动画频率减半
const NO_REPLY_MS = 10000; // 主动气泡 10 秒无人理 -> 消失且当天不再重复
const DOUBLE_CLICK_MS = 320; // 【P2-1】保持不变，只把单击动作延迟到该窗口之后
const DRAG_THRESHOLD_PX = 5; // A13：位移 >5px 判拖拽（不弹对话）
const NEAR_PX = 90;
const HOVER_DWELL_MS = 500; // A3：停猫上 >=0.5s 才看向光标（快速扫过不触发）
const LOOK_EXIT_MS = 300; // A3：离开 0.3s 回正（debounce）
const LONG_PRESS_MS = 1000; // A10：长按 >=1s 固定气泡
const COPIED_BADGE_MS = 1000; // A8：「已复制」1s 淡出
const KEYBURST_THROTTLE_MS = 60; // A13：击键上报节流（够判密度，不刷屏）
const HISTORY_MAX = 20; // A9：输入历史栈深度
const THINKING_DELAY_MS = 1500; // 发出去 1.5 秒还没回音就先「在想…」，别让气泡像卡死

const view = {
  size: 120,
  deepNight: false,
  paused: false,
  pinned: false,
  adapter: 'local-mock',
  bubbleKind: null,
  ignoreTimer: null,
  typeTimer: null,
  lastSize: { width: 0, height: 0 },
  reportedState: null,
  lastClickAt: 0,
  spriteOk: false,
  dragging: false,
  dragDir: null,
  userPaused: false,
  hidden: false,
  dnd: false, // A5：别烦我（整窗恒定穿透，渲染进程连上报都不用报 ignore:false）
  onboarded: true, // A1：初见流程是否已走完（主进程下发；冒烟/自检里恒为 true）
  onboardStep: null, // null | 'ask'（等用户回答）
  walking: false, // A2：主进程正在让猫走路
  looking: false, // A3：当前处于「看向光标」
  pinnedBubble: false, // A10：气泡已固定（跳过 10s 超时）
  clickTimer: null, // A13：单击动作延迟到 DOUBLE_CLICK_MS 之后
  pinTimer: null,
  copiedTimer: null,
  zoomTimer: null,
  hoverTimer: null,
  lookExitTimer: null,
  history: [],
  historyIndex: -1,
  lastKeystrokeAt: 0,
  winOrigin: null, // 【P2-2】主进程下发的窗口原点（不用 window.screenX）
};

function setText(el, text) {
  el.textContent = text == null ? '' : String(text);
}

function show(el) {
  el.classList.remove('is-hidden');
}

function hide(el) {
  el.classList.add('is-hidden');
}

function setDeepNight(value) {
  view.deepNight = Boolean(value);
  document.body.classList.toggle('deep-night', view.deepNight);
  // A2：walk 的换帧节拍深夜减半（250ms -> 500ms），交给状态机去算
  if (api.pet.setDeepNight) api.pet.setDeepNight(view.deepNight);
}

function setPaused(value) {
  view.userPaused = Boolean(value);
  view.paused = view.userPaused || view.hidden;
  if (view.paused) {
    cat.style.backgroundPosition = api.spritePosition('idle', 0);
  }
}

/**
 * 主进程为了保证「气泡完整可见」会把窗口整体收进屏幕，并算好两处平移量（FIX-ROUND3 FIX-2）：
 *   catX/catY       —— 舞台整体反向平移，猫在屏幕上的位置一动不动；
 *   bubbleX/bubbleY —— 气泡再单独挪回来，即使猫被拖到屏幕最边上气泡也不会被裁。
 * 坐标全部由主进程按窗口真实矩形算 —— 渲染进程的 window.screenX 可能滞后于窗口位置，不能当基准。
 */
function applyWindowShift(shift) {
  const payload = shift || {};
  const catX = Number.isFinite(payload.catX) ? Math.round(payload.catX) : 0;
  const catY = Number.isFinite(payload.catY) ? Math.round(payload.catY) : 0;
  const bubbleX = Number.isFinite(payload.bubbleX) ? Math.round(payload.bubbleX) : 0;
  const bubbleY = Number.isFinite(payload.bubbleY) ? Math.round(payload.bubbleY) : 0;
  stage.style.transform = catX || catY ? 'translate(' + catX + 'px, ' + catY + 'px)' : 'none';
  bubble.style.transform = bubbleX || bubbleY ? 'translate(' + bubbleX + 'px, ' + bubbleY + 'px)' : '';
}

function setPinned(value) {
  view.pinned = Boolean(value);
  document.body.classList.toggle('pinned', view.pinned);
}

function applyConfig(info) {
  if (!info) return;
  if (info.config) {
    view.size = Number(info.config.size) || 120;
    document.documentElement.style.setProperty('--pet-size', view.size + 'px');
    document.documentElement.style.setProperty('--pet-scale', String(view.size / 32));
    view.dnd = Boolean(info.config.dnd);
  }
  if (info.primaryAdapter) view.adapter = info.primaryAdapter;
  if (typeof info.onboarded === 'boolean') {
    view.onboarded = info.onboarded;
    if (!view.onboarded) startOnboarding();
  }
  setDeepNight(info.deepNight);
  setPaused(info.paused);
  setPinned(info.pinned);
}

function applyPose(pose) {
  cat.style.backgroundPosition = api.spritePosition(pose.sprite, pose.frame);
  if (pose.state !== view.reportedState) {
    view.reportedState = pose.state;
    document.body.setAttribute('data-pet-state', pose.state);
    api.petState(pose.state);
  }
}

/* ---------------- A1 初见与命名（【P0-2】） ---------------- */

function focusComposer() {
  window.setTimeout(function () {
    try {
      input.focus();
    } catch (err) {
      /* 焦点失败不影响使用 */
    }
  }, 60);
}

/** 首启（onboarded === false）：出场就把「你叫什么名字？」问出来（全程 textContent）。 */
function startOnboarding() {
  if (view.onboardStep === 'ask') return;
  view.onboardStep = 'ask';
  playEntryAnimation(); // A1：从右边缘探出 + 左右张望 + 跳到底部中央
  clearIgnoreTimer();
  stopTypewriter();
  view.bubbleKind = 'onboard';
  hide(bubbleActions);
  hide(bubbleNotice);
  show(composer);
  openBubble();
  api.dialogue(true);
  api.pet.send('click');
  typeText(api.onboard.ask, measureBubble);
  focusComposer();
}

/** A1 入场动画（CSS 关键帧，1.5s）；只跑一次，不锁死任何交互。 */
function playEntryAnimation() {
  document.body.classList.add('pet-entering');
  window.setTimeout(function () {
    document.body.classList.remove('pet-entering');
  }, 1600);
}

function leaveOnboarding() {
  view.onboardStep = null;
  view.onboarded = true;
}

/* ---------------- A2 走动 / A3 悬停看向光标 ---------------- */

/** 主进程是走路的唯一决策者；渲染进程只把状态机推到 walk / 回到 idle。 */
function onWalk(info) {
  const payload = info || {};
  if (payload.walk) {
    view.walking = true;
    api.pet.send(api.pet.state() === 'walk' ? 'walk:step' : 'walk:start', payload.dir);
    return;
  }
  view.walking = false;
  api.pet.send('walk:end');
}

/**
 * A3 悬停看向光标。【P2-2】方向必须用**主进程下发的窗口原点**（winOrigin）来算：
 * 渲染进程的 window.screenX 会滞后于窗口真实位置（HANDOFF §13 记过），拿它算方向会偏。
 */
function lookDirectionFrom(point) {
  const rect = slot.getBoundingClientRect();
  const originX = view.winOrigin ? view.winOrigin.x : window.screenX;
  const originY = view.winOrigin ? view.winOrigin.y : window.screenY;
  const centerX = originX + rect.left + rect.width / 2;
  const centerY = originY + rect.top + rect.height / 2;
  const direction = api.petDirection
    ? api.petDirection(point.x - centerX, point.y - centerY)
    : null;
  return { direction: direction, dx: point.x - centerX, dy: point.y - centerY };
}

function startLook(point) {
  const info = lookDirectionFrom(point);
  if (!info.direction) return false;
  const current = api.pet.state();
  if (current !== 'idle' && current !== 'alert') return false;
  view.looking = true;
  api.pet.send('look:start', info.direction);
  return true;
}

function endLook() {
  if (!view.looking) return;
  view.looking = false;
  api.pet.send('look:end');
}

/** 离开 300ms 才回正（debounce）；快速扫过（<500ms）根本不触发 look:start。 */
function scheduleLookExit() {
  if (view.lookExitTimer) return;
  view.lookExitTimer = window.setTimeout(function () {
    view.lookExitTimer = null;
    endLook();
  }, LOOK_EXIT_MS);
}

function cancelLookExit() {
  if (view.lookExitTimer) {
    clearTimeout(view.lookExitTimer);
    view.lookExitTimer = null;
  }
}

let lastTs = 0;

function loop(ts) {
  window.requestAnimationFrame(loop);
  if (view.paused) {
    lastTs = ts;
    return;
  }
  const minFrame = view.deepNight ? FRAME_MS_NIGHT : FRAME_MS_DAY;
  if (!lastTs) lastTs = ts;
  const dt = ts - lastTs;
  if (dt < minFrame) return;
  lastTs = ts;
  applyPose(api.pet.tick(dt));
}

function loadSprite() {
  const img = new Image();
  img.onload = function () {
    view.spriteOk = true;
    window.requestAnimationFrame(function () {
      api.petReady({
        catRendered: true,
        sprite: SPRITE_URL,
        sheet: img.naturalWidth + 'x' + img.naturalHeight,
      });
    });
  };
  img.onerror = function () {
    view.spriteOk = false;
    api.petReady({ catRendered: false, reason: 'sprite-load-failed', sprite: SPRITE_URL });
  };
  img.src = SPRITE_URL;
}

function measureBubble() {
  if (bubble.classList.contains('is-hidden')) {
    view.lastSize = { width: 0, height: 0 };
    api.bubbleResize(null);
    return;
  }
  const rect = bubble.getBoundingClientRect();
  const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  const changed =
    Math.abs(size.width - view.lastSize.width) >= 2 || Math.abs(size.height - view.lastSize.height) >= 2;
  view.lastSize = size;
  if (changed) api.bubbleResize(size);
}

function stopTypewriter() {
  if (view.typeTimer) {
    clearInterval(view.typeTimer);
    view.typeTimer = null;
  }
}

function typeText(text, onDone) {
  const full = text == null ? '' : String(text);
  stopTypewriter();
  setText(bubbleText, '');
  if (!full) {
    if (onDone) onDone();
    return;
  }
  let index = 0;
  view.typeTimer = setInterval(function () {
    index += 1;
    setText(bubbleText, full.slice(0, index));
    if (index % 4 === 0) measureBubble();
    if (index >= full.length) {
      stopTypewriter();
      measureBubble();
      if (onDone) onDone();
    }
  }, 26);
}

function openBubble() {
  show(bubble);
  measureBubble();
}

function clearIgnoreTimer() {
  if (view.ignoreTimer) {
    clearTimeout(view.ignoreTimer);
    view.ignoreTimer = null;
  }
}

function closeBubble() {
  setBubblePinned(false); // 气泡没了，固定态一起收掉（图钉/边框标记不残留）
  clearIgnoreTimer();
  stopTypewriter();
  view.bubbleKind = null;
  hide(bubbleActions);
  hide(composer);
  hide(bubbleUser);
  hide(bubbleNotice);
  hide(bubble);
  measureBubble();
  api.dialogue(false);
  api.pet.send('dialogue:close');
}

function openDialogue(options) {
  const opts = options || {};
  clearIgnoreTimer();
  setBubblePinned(false); // 新内容 = 新气泡：固定态不带过去
  view.bubbleKind = null;
  hide(bubbleActions);
  hide(bubbleNotice);
  show(composer);
  openBubble();
  api.dialogue(true);
  api.pet.send('click');
  if (opts.text) typeText(opts.text);
  else if (!bubbleText.textContent) typeText('嗯，我在。');
  measureBubble();
  window.setTimeout(function () {
    try {
      input.focus();
    } catch (err) {
      /* 焦点失败不影响使用 */
    }
  }, 60);
}

function showProactive(info) {
  const payload = info || {};
  const kind = payload.kind || null;
  setBubblePinned(false);
  hide(composer);
  hide(bubbleUser);
  hide(bubbleNotice);
  // 主动行为不许「睡着的猫在说话」：先唤醒（sleeping / tired -> idle）再开口
  const current = api.pet.state();
  if (current === 'sleeping' || current === 'tired') api.pet.send('activity');
  api.pet.send('speak');
  view.bubbleKind = kind;
  if (payload.button) {
    setText(bubbleAction, payload.button);
    bubbleAction.setAttribute('data-kind', kind || '');
    show(bubbleActions);
  } else {
    hide(bubbleActions);
  }
  openBubble();
  typeText(payload.text || '', measureBubble);
  if (!payload.fromUser) {
    clearIgnoreTimer();
    // A10：固定（长按 >=1s）时跳过 10 秒自动消失
    view.ignoreTimer = window.setTimeout(function () {
      view.ignoreTimer = null;
      api.bubbleIgnored(kind);
      closeBubble();
    }, NO_REPLY_MS);
  }
}

/* ---------------- A8 双击复制 / A10 长按固定 ---------------- */

/** A10：图钉标记必须是**可辨**的（用 textContent 写，绝不用 innerHTML/insertAdjacentHTML）。 */
function setBubblePinned(value) {
  const next = Boolean(value);
  view.pinnedBubble = next;
  document.body.classList.toggle('bubble-pinned', next);
  if (next) {
    setText(bubblePin, '📌 已固定');
    show(bubblePin);
    clearIgnoreTimer(); // 固定后不再自动消失
  } else {
    setText(bubblePin, '');
    hide(bubblePin);
  }
}

/** A8：双击气泡 -> 全文进剪贴板 + 「已复制」1s 淡出（非系统通知；空文本不提示）。 */
function copyBubbleText() {
  const text = bubbleText.textContent || '';
  if (!text.trim()) return;
  api.copyText(text).then(function (result) {
    if (!result || !result.ok) return;
    setText(bubbleCopied, result.truncated ? '已复制（超长已截断）' : '已复制');
    show(bubbleCopied);
    if (view.copiedTimer) clearTimeout(view.copiedTimer);
    view.copiedTimer = window.setTimeout(function () {
      view.copiedTimer = null;
      setText(bubbleCopied, '');
      hide(bubbleCopied);
    }, COPIED_BADGE_MS);
  });
}

function onBreakTick(info) {
  if (!info || !info.active || !(info.remainingMs > 0)) return;
  clearIgnoreTimer();
  stopTypewriter();
  hide(composer);
  hide(bubbleUser);
  hide(bubbleActions);
  api.pet.send('speak');
  const total = Math.ceil(info.remainingMs / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  setText(bubbleText, '休息中 ' + mm + ':' + ss + ' —— 别看屏幕。');
  openBubble();
}
/* ---------------- 鼠标：拖拽 / 点击 / 双击 / 右键 ---------------- */

let pointer = null;
let dragLock = false;
let lastClient = { x: 0, y: 0 };

/**
 * 透明窗口整矩形都会吃鼠标事件（Windows 上 alpha=0 的像素照样挡点击），
 * 所以默认让窗口穿透（主进程 setIgnoreMouseEvents(true, {forward:true})），
 * 鼠标移到「猫 / 气泡 / 可点元素」上时再临时关掉穿透。
 * 拖拽与输入框聚焦期间强制保持不穿透，否则快速拖动会丢鼠标事件。
 */
function refreshPassthrough() {
  if (dragLock) {
    api.setIgnoreMouse(false);
    return;
  }
  // A5【P0-1-3】dnd 短路：别烦我开着时渲染进程也要上报一次 { ignore:true }，
  // 好让主进程的 lastInteractive 缓存不在 dnd 期间腐烂（关掉 dnd 的瞬间不会残留旧命中态）。
  if (view.dnd) {
    api.setIgnoreMouse(true);
    return;
  }
  const hit = document.elementFromPoint(lastClient.x, lastClient.y);
  const interactive = Boolean(hit && hit.closest('#cat, #cat-slot, #bubble, #bubble *, button, input, textarea'));
  api.setIgnoreMouse(!interactive);
}

function setDragLock(value) {
  dragLock = Boolean(value);
  refreshPassthrough();
}

window.addEventListener('mousemove', function (event) {
  lastClient = { x: event.clientX, y: event.clientY };
  refreshPassthrough();
});

function wakeIfAsleep() {
  const state = api.pet.state();
  if (state === 'sleeping' || state === 'tired') {
    api.pet.send('activity');
    showProactive({ kind: 'wake', text: '回来了。', fromUser: true });
  }
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  api.activity();
  api.pet.touch();
  wakeIfAsleep();
  setDragLock(true);
  pointer = { startX: event.screenX, startY: event.screenY, dragging: false };
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
}

function onPointerMove(event) {
  if (!pointer) return;
  const dx = event.screenX - pointer.startX;
  const dy = event.screenY - pointer.startY;
  if (!pointer.dragging) {
    if (Math.abs(dx) <= DRAG_THRESHOLD_PX && Math.abs(dy) <= DRAG_THRESHOLD_PX) return;
    if (view.pinned) return;
    pointer.dragging = true;
    view.dragging = true;
    document.body.classList.add('dragging'); // A11：按住即拖 + 立刻半透明反馈
    endLook();
    api.pet.send('drag:start');
    api.dragStart({ x: pointer.startX, y: pointer.startY });
  }
  api.dragMove({ x: event.screenX, y: event.screenY });
  if (dx !== 0) {
    const dir = dx < 0 ? 'W' : 'E'; // 拖向哪边用哪组侧向挣扎帧（SE / SW）
    if (dir !== view.dragDir) {
      view.dragDir = dir;
      api.pet.send('drag:dir', dir);
    }
  }
  api.activity();
}

function onPointerUp(event) {
  window.removeEventListener('mousemove', onPointerMove);
  window.removeEventListener('mouseup', onPointerUp);
  if (event && Number.isFinite(event.clientX)) {
    lastClient = { x: event.clientX, y: event.clientY };
  }
  setDragLock(false);
  const session = pointer;
  pointer = null;
  if (!session) return;
  if (session.dragging) {
    view.dragging = false;
    view.dragDir = null;
    document.body.classList.remove('dragging');
    api.dragEnd();
    api.pet.send('drag:end');
    return;
  }
  handleClick();
}

function handleClick() {
  const now = Date.now();
  if (now - view.lastClickAt < DOUBLE_CLICK_MS) {
    // 双击：撤掉还没执行的单击动作，改开设置（A13：双击不弹对话）
    view.lastClickAt = 0;
    if (view.clickTimer) {
      clearTimeout(view.clickTimer);
      view.clickTimer = null;
    }
    api.openSettings();
    return;
  }
  view.lastClickAt = now;
  api.activity();
  // 【P2-1】DOUBLE_CLICK_MS = 320 保持不变，只把**单击动作**延迟到该窗口之后：
  // 否则一次双击会先开对话、再开设置（M0 的误触）。
  if (view.clickTimer) clearTimeout(view.clickTimer);
  view.clickTimer = window.setTimeout(function () {
    view.clickTimer = null;
    if (composer.classList.contains('is-hidden')) openDialogue();
    else input.focus();
  }, DOUBLE_CLICK_MS);
}

function onContextMenu(event) {
  event.preventDefault();
  api.activity();
  api.contextMenu();
}

function onCursor(point) {
  if (!point || !window.hermes) return;
  // 【P2-2】主进程下发的窗口原点（权威）优先；window.screenX 只在没有它时兜底
  if (Number.isFinite(point.winX) && Number.isFinite(point.winY)) {
    view.winOrigin = { x: point.winX, y: point.winY };
  }
  if (view.dragging) return;
  const rect = slot.getBoundingClientRect();
  const originX = view.winOrigin ? view.winOrigin.x : window.screenX;
  const originY = view.winOrigin ? view.winOrigin.y : window.screenY;
  const centerX = originX + rect.left + rect.width / 2;
  const centerY = originY + rect.top + rect.height / 2;
  const near = Math.sqrt(Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2)) <= NEAR_PX;
  const state = api.pet.state();
  if (near && (state === 'idle' || state === 'tired' || state === 'scratchSelf')) {
    api.pet.send('mouse:near');
  } else if (!near && state === 'alert') {
    api.pet.send('mouse:far');
  }
  // A3：停猫上持续 >=500ms 才看向光标；离开后 300ms 回正；快速扫过不触发。
  if (near) {
    cancelLookExit();
    if (!view.looking && !view.hoverTimer) {
      view.hoverTimer = window.setTimeout(function () {
        view.hoverTimer = null;
        startLook(point);
      }, HOVER_DWELL_MS);
    }
  } else {
    if (view.hoverTimer) {
      clearTimeout(view.hoverTimer);
      view.hoverTimer = null;
    }
    if (view.looking) scheduleLookExit();
  }
}

/* ---------------- 输入框 ---------------- */

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(96, Math.max(24, input.scrollHeight)) + 'px';
  measureBubble();
}

function closeDialogue() {
  if (view.onboardStep === 'ask') {
    // 跳过起名（Esc）：nickname 落「你」、onboarded=true（【P0-2-3】别留「琉斯」）
    leaveOnboarding();
    api.skipOnboarding();
  }
  setBubblePinned(false);
  input.value = '';
  autosize();
  api.typing(false);
  api.pet.send('typing:end');
  closeBubble();
}

async function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autosize();
  if (view.onboardStep === 'ask') {
    // A1：这一句是名字（空 / 拒绝词 / 正常记名都在主进程侧的纯函数里判）
    const outcome = await api.completeOnboarding(text);
    if (outcome && outcome.line) typeText(outcome.line, measureBubble);
    if (outcome && outcome.done) {
      leaveOnboarding();
      api.activity();
    }
    return;
  }
  view.history.push(text);
  if (view.history.length > HISTORY_MAX) view.history = view.history.slice(-HISTORY_MAX);
  view.historyIndex = -1;
  setBubblePinned(false);
  clearIgnoreTimer();
  hide(bubbleActions);
  hide(bubbleNotice);
  api.pet.send('typing:end');
  api.typing(false);
  setText(bubbleUser, '你：' + text);
  show(bubbleUser);
  stopTypewriter();
  setText(bubbleText, '');
  api.pet.send('sending');
  measureBubble();
  // P1-4：网关最长 10 秒不吭声，1.5 秒内没回音就先打字机显示「在想…」，
  // 否则用户看到的是一个空气泡 = 以为对话功能坏了。
  let pending = true;
  const thinkingTimer = window.setTimeout(function () {
    if (!pending) return;
    typeText('在想…');
  }, THINKING_DELAY_MS);
  let result = null;
  try {
    result = await api.send(text);
  } catch (err) {
    result = { text: '我这边卡了一下，再说一次？', degraded: true, notice: '' };
  }
  pending = false;
  window.clearTimeout(thinkingTimer);
  if (result && result.degraded && result.notice) {
    setText(bubbleNotice, result.notice);
    show(bubbleNotice);
  } else {
    hide(bubbleNotice);
  }
  api.pet.send('speak');
  typeText(result && result.text ? result.text : '……', measureBubble);
  api.activity();
}
/* ---------------- 事件接线 ---------------- */

bubbleAction.addEventListener('click', function () {
  const kind = bubbleAction.getAttribute('data-kind');
  api.activity();
  clearIgnoreTimer();
  hide(bubbleActions);
  if (kind === 'break') {
    api.breakStart(5);
    return;
  }
  closeBubble();
});

input.addEventListener('input', function () {
  const hasText = input.value.length > 0;
  view.historyIndex = -1;
  api.typing(hasText);
  if (hasText) {
    api.pet.send('typing:start');
    api.activity();
  }
  autosize();
});

/* A9：输入框为空时按 ↑ 回填上一条（连续 ↑ 更早）；非空不劫持。 */
function recallHistory() {
  if (!view.history.length) return;
  const index = view.historyIndex < 0 ? view.history.length - 1 : Math.max(0, view.historyIndex - 1);
  view.historyIndex = index;
  input.value = view.history[index];
  autosize();
}

input.addEventListener('focus', function () {
  setDragLock(true);
});

input.addEventListener('blur', function () {
  setDragLock(false);
});

input.addEventListener('keydown', function (event) {
  // A13：把击键上报给主进程（只判密度，不记内容）—— 高速打字时猫闭嘴
  const now = Date.now();
  if ((event.key && event.key.length === 1) || event.key === 'Backspace') {
    if (now - view.lastKeystrokeAt > KEYBURST_THROTTLE_MS) {
      view.lastKeystrokeAt = now;
      api.keystroke();
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === 'ArrowUp' && !input.value) {
    event.preventDefault();
    recallHistory();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialogue();
  }
});

/* ---------------- A4 滚轮缩放（只在猫身上） ---------------- */

function onWheel(event) {
  if (view.dnd || view.dragging) return; // A5：dnd 下滚轮也穿透；拖拽中不缩放
  const target = event.target;
  if (target && target.closest && target.closest('#bubble, #composer, input, textarea')) return;
  if (document.activeElement === input && !bubble.classList.contains('is-hidden')) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 1 : -1;
  const next = api.zoomSize(view.size, delta);
  if (next === view.size) return;
  // 即时生效（本地先反映），落盘走 100ms debounce：连滚 3 次只写一次盘
  view.size = next;
  document.documentElement.style.setProperty('--pet-size', next + 'px');
  document.documentElement.style.setProperty('--pet-scale', String(next / 32));
  if (view.zoomTimer) clearTimeout(view.zoomTimer);
  view.zoomTimer = window.setTimeout(function () {
    view.zoomTimer = null;
    api.setConfig({ size: view.size });
  }, 100);
}

/* ---------------- A8 双击气泡复制 ---------------- */

bubble.addEventListener('dblclick', function (event) {
  event.preventDefault();
  copyBubbleText();
});

/* ---------------- A10 长按气泡固定 ---------------- */

let bubblePress = null;

function cancelBubblePress() {
  if (bubblePress) {
    clearTimeout(bubblePress);
    bubblePress = null;
  }
}

bubble.addEventListener('mousedown', function (event) {
  if (event.button !== 0) return;
  cancelBubblePress();
  bubblePress = window.setTimeout(function () {
    bubblePress = null;
    setBubblePinned(!view.pinnedBubble); // 长按 >=1s 固定；再长按解除
  }, LONG_PRESS_MS);
});

bubble.addEventListener('mouseup', cancelBubblePress);
bubble.addEventListener('mouseleave', cancelBubblePress);

/* Esc 只在**猫窗口聚焦时**生效（渲染进程局部监听，绝不注册全局 Esc） */
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (bubble.classList.contains('is-hidden')) return;
  event.preventDefault();
  closeDialogue(); // closeDialogue 内部已处理「跳过起名」与「解除固定」
});

sendBtn.addEventListener('click', function () {
  submit();
});

api.onConfig(function (info) {
  applyConfig(info);
});

api.onProactive(function (info) {
  showProactive(info);
});

api.onCursor(function (point) {
  onCursor(point);
});

api.onDeepNight(function (info) {
  setDeepNight(info && info.deepNight);
});

api.onPause(function (info) {
  setPaused(info && info.paused);
});

api.onBreakTick(function (info) {
  onBreakTick(info);
});

api.onWalk(function (info) {
  onWalk(info);
});

api.onWindowShift(function (shift) {
  applyWindowShift(shift);
});

api.onShortcuts(function (info) {
  // A7：被占用的快捷键要在设置面板标红；气泡这里只留一条可见提示，不打扰
  const occupied = (info && info.occupied) || {};
  view.occupiedShortcuts = Object.keys(occupied);
});

api.onPetCommand(function (info) {
  if (!info) return;
  if (info.command === 'dialogue') openDialogue();
  else if (info.command === 'nap') api.pet.send('nap:start');
  else if (info.command === 'pin') setPinned(info.pinned);
});

document.addEventListener('visibilitychange', function () {
  view.hidden = document.hidden;
  view.paused = view.userPaused || view.hidden;
});

/* ---------------- 启动 ---------------- */

async function init() {
  let info = null;
  try {
    info = await api.getConfig();
  } catch (err) {
    info = null;
  }
  applyConfig(info);
  loadSprite();
  window.requestAnimationFrame(loop);
  slot.addEventListener('mousedown', onPointerDown);
  slot.addEventListener('contextmenu', onContextMenu);
  // A4：只在猫身上滚轮缩放（passive:false 才能 preventDefault 掉页面滚动）
  slot.addEventListener('wheel', onWheel, { passive: false });
  cat.addEventListener('wheel', onWheel, { passive: false });
  slot.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });
}

init();
