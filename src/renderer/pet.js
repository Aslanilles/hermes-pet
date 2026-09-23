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
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

const SPRITE_URL = '../../data/sprites/oneko.gif';
const FRAME_MS_DAY = 1000 / 30; // 目标 30fps
const FRAME_MS_NIGHT = 1000 / 15; // 深夜模式动画频率减半
const NO_REPLY_MS = 10000; // 主动气泡 10 秒无人理 -> 消失且当天不再重复
const DOUBLE_CLICK_MS = 320;
const DRAG_THRESHOLD_PX = 5;
const NEAR_PX = 90;
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
  }
  if (info.primaryAdapter) view.adapter = info.primaryAdapter;
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
    view.ignoreTimer = window.setTimeout(function () {
      view.ignoreTimer = null;
      api.bubbleIgnored(kind);
      closeBubble();
    }, NO_REPLY_MS);
  }
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
    api.dragEnd();
    api.pet.send('drag:end');
    return;
  }
  handleClick();
}

function handleClick() {
  const now = Date.now();
  const isDouble = now - view.lastClickAt < DOUBLE_CLICK_MS;
  view.lastClickAt = isDouble ? 0 : now;
  api.activity();
  if (isDouble) {
    api.openSettings();
    return;
  }
  if (composer.classList.contains('is-hidden')) openDialogue();
  else input.focus();
}

function onContextMenu(event) {
  event.preventDefault();
  api.activity();
  api.contextMenu();
}

function onCursor(point) {
  if (!point || view.dragging || !window.hermes) return;
  const rect = slot.getBoundingClientRect();
  const centerX = window.screenX + rect.left + rect.width / 2;
  const centerY = window.screenY + rect.top + rect.height / 2;
  const near = Math.sqrt(Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2)) <= NEAR_PX;
  const state = api.pet.state();
  if (near && (state === 'idle' || state === 'tired' || state === 'scratchSelf')) {
    api.pet.send('mouse:near');
  } else if (!near && state === 'alert') {
    api.pet.send('mouse:far');
  }
}

/* ---------------- 输入框 ---------------- */

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(96, Math.max(24, input.scrollHeight)) + 'px';
  measureBubble();
}

function closeDialogue() {
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
  api.typing(hasText);
  if (hasText) {
    api.pet.send('typing:start');
    api.activity();
  }
  autosize();
});

input.addEventListener('focus', function () {
  setDragLock(true);
});

input.addEventListener('blur', function () {
  setDragLock(false);
});

input.addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialogue();
  }
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

api.onWindowShift(function (shift) {
  applyWindowShift(shift);
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
  slot.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });
}

init();
