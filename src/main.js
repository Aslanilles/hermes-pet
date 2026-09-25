'use strict';

/**
 * hermes-pet 主进程：窗口 / 托盘 / 菜单 / 单实例 / 调度器接线 / 持久化 / --smoke-test。
 * 技术约束：CommonJS、无构建步骤、除 electron 外零依赖。
 */

const path = require('path');
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, globalShortcut, clipboard } = require('electron');

const configStore = require('./core/config');
const position = require('./core/position');
const scheduler = require('./core/scheduler');
const replies = require('./core/replies');
const spriteFrames = require('./core/sprite-frames');
const walkCore = require('./core/walk');
const quiet = require('./core/quiet');
const { createReplyService } = require('./adapters');
const windowGuard = require('./core/window-guards');

const SMOKE_TEST = process.argv.indexOf('--smoke-test') >= 0;
const SELF_CHECK = process.argv.indexOf('--self-check') >= 0;
const SMOKE_WAIT_MS = 6000;

const PROJECT_ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const SPRITE_DIR = path.join(PROJECT_ROOT, 'data', 'sprites');
const RENDERER_DIR = path.join(__dirname, 'renderer');

const EDGE_MARGIN = 24; // 启动位置距屏幕右下角
const PET_PADDING = 12; // 猫本体窗口四周留白（给投影/拖拽手柄）
const MIN_VISIBLE = 48; // 位置恢复时至少留多少像素在屏幕内
const BUBBLE_MAX_WIDTH = 320; // 设计文档 4.4
const BUBBLE_MAX_HEIGHT = 400;
const BUBBLE_PADDING_X = 24;
const BUBBLE_GAP = 8; // 气泡底部距角色顶部
const DEEP_NIGHT_START = 22; // 22:00-07:00
const DEEP_NIGHT_END = 7;
const ACTIVITY_NEAR_PX = 120; // 鼠标在猫附近移动也算「人在」
const ACTIVITY_THROTTLE_MS = 5000;
const SHORTCUT_DEFAULTS = configStore.DEFAULT_SHORTCUTS;
// A7：自检/冒烟里用来验「注册成功 / 被占用降级 / 退出注销」的**不常用测试加速键**，验完立刻注销。
const SHORTCUT_PROBE_KEYS = ['Alt+F9', 'Alt+F10'];

let win = null;
let settingsWin = null;
let tray = null;
let configPath = null;
let statePath = null;
let config = null;
let state = null;
let runtime = null;
let replyService = null;
let baseBounds = null; // 猫本体窗口的基准位置/尺寸（气泡展开时窗口临时变大，基准不变）
// 气泡窗口被收进屏幕后，渲染进程要做的两处平移（全部由主进程算，渲染进程不猜屏幕坐标）：
//   catX/catY    —— 舞台整体平移，让猫在屏幕上的位置一动不动
//   bubbleX/bubbleY —— 气泡再单独平移，保证它一定完整落在 workArea 内
let windowShift = { catX: 0, catY: 0, bubbleX: 0, bubbleY: 0 };
let positionReady = false; // 窗口按基准摆好之前，禁止把位置写进 state.json
let bubbleContent = null;
let dragSession = null;
let lastPetState = 'idle';
let lastCursor = null;
let lastNearActivityAt = 0;
let cursorTimer = null;
let schedulerTimer = null;
let deepNightTimer = null;
let breakTimer = null;
let breakUntil = 0;
let smokeTimer = null;
let topmostWatchdog = null;
let ignoreWatchdog = null;
let rendererReport = null;
let selfCheckActive = false;
let ignoreMouseActive = true;
// FIX-1（第五轮）：建窗后、渲染进程任何命中测试之前的初始态快照。
// ignoreMouseActive 会被渲染进程合法改写（真实光标压进猫的矩形 -> forward 转发 mousemove
// -> 命中「可交互」-> 关穿透），直接读它做断言会随用户光标位置随机变红；验收门必须钉在这个
// 只写一次的快照上。
let ignoreMouseAtStart = null;
let lastInteractive = false; // 渲染进程最近一次报的「有没有命中交互元素」，穿透看门狗据此兜底
let quitting = false;
// M1-R1 A2：走动会话（walkTimer 100ms 步进 4px；走动期间不落盘，走完才 persistPosition）
let walkTimer = null;
let walkSession = null;
let lastWalkEndAt = null; // 上次散步结束时刻（3 分钟硬冷却的基准）
let cursorTrail = []; // 近 5s 光标轨迹（A2「光标安静」判定：累计位移 <=120px 才允许走）
// M1-R1 A13：信号采集
let keystrokes = []; // 近 3s 击键时刻（高频打字 -> quiet）
let quietTimer = null;
let foregroundFullscreen = false; // 前台窗口是否全屏（PowerShell 探测，节流 2s，失败降级 false）
// M1-R1 A7：被占用的快捷键（**运行时内存**，不写 config.json —— 运行时态别污染偏好文件）
let shortcutOccupied = {};
let lastUserNotice = null; // 最近一条给用户看的提示（A12 自启失败等；托盘 tooltip + 气泡）

function log() {
  const args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[hermes-pet]'].concat(args));
}

function isDeepNight(now) {
  if (!config || config.deepNightEnabled === false) return false;
  const hour = new Date(now).getHours();
  return hour >= DEEP_NIGHT_START || hour < DEEP_NIGHT_END;
}

/* ---------------- M1-R1：A13 静默信号 / A2 走动 / A6 吸附 ---------------- */

function statePaused() {
  return Boolean(state && state.paused) || selfCheckActive;
}

function hiddenNow() {
  return !win || win.isDestroyed() || !win.isVisible();
}

/** A13 六信号（quiet.js 的唯一入参；判定是纯函数，接线在这里）。 */
function quietSignals(now) {
  return {
    foregroundFullscreen: foregroundFullscreen,
    typingBurst: quiet.isTypingBurst(keystrokes, now),
    dnd: Boolean(config && config.dnd),
    paused: statePaused(),
    hidden: hiddenNow(),
    deepNight: isDeepNight(now),
  };
}

function quietNow(now) {
  return quiet.shouldBeQuiet(quietSignals(now));
}

/**
 * 走路用的静默信号只取「全屏 / 高速打字」两条：
 * features §2 写死「深夜不禁止走动，只降频降速」——深夜走速 20px/s、换帧 500ms 就是它的落地。
 * dnd / paused / hidden / 对话中 / 拖拽中另有独立闸门（walkCore.walkBlockReason）。
 */
function quietForWalk(now) {
  return quiet.shouldBeQuiet({
    foregroundFullscreen: foregroundFullscreen,
    typingBurst: quiet.isTypingBurst(keystrokes, now),
  });
}

function centerOfBounds(bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function walkBlockedNow(now) {
  return walkCore.walkBlockReason({
    now: now,
    paused: statePaused(),
    dnd: Boolean(config && config.dnd),
    quiet: quietForWalk(now),
    hidden: hiddenNow(),
    dialogueOpen: Boolean(runtime && runtime.dialogueOpen),
    typing: Boolean(runtime && runtime.typing),
    dragging: Boolean(runtime && runtime.dragging),
    dragEndedAt: runtime ? runtime.dragEndedAt : null,
    cursorQuiet: walkCore.isCursorQuiet(cursorTrail, now),
    state: lastPetState,
  });
}

/** 每个光标 tick（200ms）抽一次签（冷却 180s + 1/300）。 */
function maybeStartWalk(now) {
  // 自检 / 冒烟期间猫一律不乱动：窗口位移会干扰同一次运行里的其它测量
  if (SMOKE_TEST || SELF_CHECK) return;
  if (!config || !baseBounds || walkSession) return;
  const want = walkCore.shouldStartWalk({
    now: now,
    lastWalkAt: lastWalkEndAt,
    cursorQuiet: walkCore.isCursorQuiet(cursorTrail, now),
    state: lastPetState,
    paused: statePaused(),
    dnd: Boolean(config.dnd),
    quiet: quietForWalk(now),
    hidden: hiddenNow(),
    dialogueOpen: Boolean(runtime && runtime.dialogueOpen),
    typing: Boolean(runtime && runtime.typing),
    dragging: Boolean(runtime && runtime.dragging),
    dragEndedAt: runtime ? runtime.dragEndedAt : null,
  });
  if (!want) return;
  const cursor = screen.getCursorScreenPoint();
  const center = centerOfBounds(baseBounds);
  walkSession = {
    dir: spriteFrames.direction8(cursor.x - center.x, cursor.y - center.y),
    traveledPx: 0,
    elapsedMs: 0,
    startedAt: now,
  };
  sendToPet('pet:walk', { walk: true, dir: walkSession.dir });
  if (walkTimer) clearInterval(walkTimer);
  walkTimer = setInterval(walkStepTick, walkCore.WALK_STEP_MS);
}

function walkStepTick() {
  if (!walkSession || !baseBounds || !win || win.isDestroyed()) {
    endWalk('closed');
    return;
  }
  const now = Date.now();
  const blocked = walkBlockedNow(now);
  if (blocked) {
    endWalk(blocked);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const step = walkCore.walkStep({
    from: centerOfBounds(baseBounds),
    cursor: cursor,
    dir: walkSession.dir,
    traveledPx: walkSession.traveledPx,
    elapsedMs: walkSession.elapsedMs,
    deepNight: isDeepNight(now),
  });
  if (step.dir !== walkSession.dir) {
    walkSession.dir = step.dir;
    sendToPet('pet:walk', { walk: true, dir: step.dir });
  }
  if (step.dx !== 0 || step.dy !== 0) {
    // 【P2-4】每一步都同步 baseBounds，再让窗口跟上（走动期间不落盘）
    baseBounds = position.clampToArea(
      {
        x: baseBounds.x + step.dx,
        y: baseBounds.y + step.dy,
        width: baseBounds.width,
        height: baseBounds.height,
      },
      workAreaFor(baseBounds),
      MIN_VISIBLE
    );
    syncWindowBounds();
    walkSession.traveledPx += Math.hypot(step.dx, step.dy);
  }
  walkSession.elapsedMs += walkCore.WALK_STEP_MS;
  if (step.done) endWalk(step.reason);
}

/** 结束一次走动：停表 + 通知渲染进程 + **这时候才**落盘（走动期间不写 state.json）。 */
function endWalk(reason) {
  if (!walkSession && !walkTimer) return;
  if (walkTimer) {
    clearInterval(walkTimer);
    walkTimer = null;
  }
  walkSession = null;
  lastWalkEndAt = Date.now();
  sendToPet('pet:walk', { walk: false, reason: reason || null });
  persistPosition();
}

function petWindowSize() {
  const size = config.size;
  return { width: size + PET_PADDING * 2, height: size + PET_PADDING * 2 };
}

function sendToPet(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function workAreaFor(rect) {
  return screen.getDisplayMatching(rect).workArea;
}

/** 允许窗口部分出屏，但至少留 MIN_VISIBLE 像素可见（拖拽 / 恢复位置用）。 */
function clampToWorkArea(bounds) {
  return position.clampToArea(bounds, workAreaFor(bounds), MIN_VISIBLE);
}

function primaryDisplayInfo() {
  const display = screen.getPrimaryDisplay();
  return { size: display.size, workArea: display.workArea, scaleFactor: display.scaleFactor };
}

/** 默认落点：主屏右下角，距两边各留 EDGE_MARGIN（F1「首次启动出现在右下角」）。 */
function defaultBaseBounds() {
  return position.defaultBounds(screen.getPrimaryDisplay().workArea, petWindowSize(), {
    edgeMargin: EDGE_MARGIN,
  });
}

/**
 * 恢复落点：坐标缺失 / 非数字 / (0,0) 哨兵 一律回默认右下角，其余 clamp 回可见区。
 * 判断全部下沉到 src/core/position.js（纯逻辑，有单测钉住）。
 */
function restoreBaseBounds() {
  const size = petWindowSize();
  const workArea =
    Number.isFinite(state.x) && Number.isFinite(state.y)
      ? workAreaFor({ x: state.x, y: state.y, width: size.width, height: size.height })
      : screen.getPrimaryDisplay().workArea;
  return position.restoreBounds(state, workArea, size, {
    edgeMargin: EDGE_MARGIN,
    minVisible: MIN_VISIBLE,
  });
}

/**
 * 气泡展开时窗口临时变大：算完之后整体收进 workArea，并把「被平移了多少」记下来。
 * 渲染进程反向平移内容 -> 气泡一定完整可见（FIX-ROUND3 FIX-2），猫在屏幕上不动。
 */
function windowBoundsForBubble(content) {
  const size = petWindowSize();
  if (!content) {
    windowShift = { catX: 0, catY: 0, bubbleX: 0, bubbleY: 0 };
    return Object.assign({}, baseBounds);
  }
  const width = Math.max(
    size.width,
    Math.round(Math.min(BUBBLE_MAX_WIDTH + BUBBLE_PADDING_X, Math.max(160, content.width + BUBBLE_PADDING_X)))
  );
  const bodyHeight = Math.max(0, Math.min(BUBBLE_MAX_HEIGHT, Math.round(content.height)));
  const height = size.height + bodyHeight + BUBBLE_GAP;
  const centerX = baseBounds.x + baseBounds.width / 2;
  const bottom = baseBounds.y + baseBounds.height;
  const workArea = workAreaFor(baseBounds);
  const fitted = position.fitInside(
    {
      x: Math.round(centerX - width / 2),
      y: Math.round(bottom - height),
      width: width,
      height: height,
    },
    workArea
  );
  // 1) 舞台整体反向平移：窗口被推回来多少，内容就挪回去多少 -> 猫在屏幕上的位置一动不动
  const catX = fitted.shift.x;
  const catY = fitted.shift.y;
  // 2) 气泡在窗口里的落点是固定的（pet.css：舞台内边距 PET_PADDING，flex 底部对齐 + 12px 顶部余量），
  //    叠加舞台平移后若仍越出 workArea，就再单独把气泡挪进来 —— 只动气泡、不动猫。
  const bubbleRect = {
    x: fitted.rect.x + PET_PADDING + catX,
    y: fitted.rect.y + PET_PADDING + catY,
    width: Math.round(width - PET_PADDING * 2),
    height: Math.round(bodyHeight),
  };
  const bubbleInside = position.clampFullyInside(bubbleRect, workArea);
  windowShift = {
    catX: catX,
    catY: catY,
    bubbleX: bubbleInside.x - bubbleRect.x,
    bubbleY: bubbleInside.y - bubbleRect.y,
  };
  return fitted.rect;
}

function syncWindowBounds() {
  if (!win || win.isDestroyed()) return;
  win.setBounds(windowBoundsForBubble(bubbleContent));
  // 平移量全部由主进程算好（渲染进程的 window.screenX 可能滞后于窗口真实位置，不能拿来当基准）
  sendToPet('pet:window-shift', windowShift);
}

/** 从窗口真实矩形反推「猫的基准矩形」；读不到合法坐标返回 null。 */
function liveBaseBounds() {
  if (!win || win.isDestroyed()) return null;
  const actual = win.getBounds();
  if (!actual || !Number.isFinite(actual.x) || !Number.isFinite(actual.y)) return null;
  const size = petWindowSize();
  const derived = {
    x: actual.x + (actual.width - size.width) / 2,
    y: actual.y + (actual.height - size.height),
    width: size.width,
    height: size.height,
  };
  // 再过一遍恢复路径：顺手 clamp，并且把 (0,0) 这种非法落点挡在盘外
  return position.restoreBounds(derived, workAreaFor(derived), size, {
    edgeMargin: EDGE_MARGIN,
    minVisible: MIN_VISIBLE,
  });
}

/**
 * 位置落盘（唯一写入口）。两道防御（FIX-ROUND3 FIX-1）：
 * 1) 窗口还没按基准摆好（ready-to-show 之前）绝不写 —— 否则会把占位坐标写进 state.json；
 * 2) 写之前用 win.getBounds() 的真实值再 clamp 一次，读到非法坐标就放弃这次写入。
 */
function persistPosition() {
  if (!state || !statePath || !positionReady) return;
  const live = liveBaseBounds();
  if (!live) return;
  state.x = live.x;
  state.y = live.y;
  persistState();
}

function persistState() {
  try {
    if (!statePath) return;
    state.scheduler = runtime ? Object.assign({}, runtime) : {};
    configStore.saveState(statePath, state);
  } catch (err) {
    log('state 保存失败：', err && err.message ? err.message : String(err));
  }
}

function persistRuntime() {
  persistState();
}

function loadPersisted() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  statePath = path.join(app.getPath('userData'), 'state.json');
  // 首启即落盘一份含全部默认值的 config.json；老文件顺带走一遍 migrateConfig
  // （schemaVersion 1 -> 2 + nickname 旧语义迁移，A1【P0-2】，迁完写回盘）
  config = configStore.ensureConfig(configPath, statePath);
  state = configStore.loadState(statePath);
  if (SMOKE_TEST) {
    // 冒烟必须**确定性**：别烦我 / 静音这类前置状态一律按默认走（只在内存里，不落盘）
    config = Object.assign({}, config, { dnd: false });
  }
  runtime = scheduler.normaliseRuntime(state.scheduler, Date.now());
}

function createPetWindow() {
  positionReady = false;
  baseBounds = restoreBaseBounds();
  win = new BrowserWindow({
    x: baseBounds.x,
    y: baseBounds.y,
    width: baseBounds.width,
    height: baseBounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    icon: path.join(SPRITE_DIR, 'icon-64.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 关掉 renderer sandbox：preload 需要 require 本项目的纯逻辑模块（src/core/*），
      // 复用同一份状态机与取帧实现；contextIsolation 仍然开着，也不暴露 ipcRenderer。
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  // Windows 上透明窗口整矩形都吃鼠标事件 —— 不处理就是桌面上的一块「看不见的挡板」。
  // 策略：默认穿透（ignore=true），渲染进程用 elementFromPoint 命中测试，
  // 鼠标移到猫/气泡上时通过 IPC 临时关掉穿透；forward:true 保证穿透时仍能收到 mousemove。
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoreMouseActive = true;
  // FIX-1：初始态快照 —— 此刻渲染进程还没跑过任何 elementFromPoint 命中测试，
  // 这个值之后不会被渲染进程的回包污染，才是「初始不留挡板」的可靠证据。
  ignoreMouseAtStart = ignoreMouseActive;
  lastInteractive = false;
  // 页面重载 / 跳转后 Chromium 的 forward 转发会静默失效（docs/M0-recon-github-pet.md §5.2），
  // 这正是「透明区域又开始挡桌面点击」的现场 -> 每次页面加载完立刻重断言一次穿透。
  ['did-finish-load', 'did-navigate', 'did-navigate-in-page'].forEach(function (channel) {
    win.webContents.on(channel, function () {
      reassertPassThrough(channel);
    });
  });
  if (SMOKE_TEST) {
    // 冒烟测试期间把渲染进程的报错原样吐到 stdout，失败时能直接看到原因
    win.webContents.on('console-message', function (event) {
      log('[renderer]', event && event.message, '(', event && event.sourceId, event && event.lineNumber, ')');
    });
    win.webContents.on('did-fail-load', function (event, code, desc, url) {
      log('[renderer] did-fail-load', code, desc, url);
    });
    win.webContents.on('preload-error', function (event, preloadPath, error) {
      log('[renderer] preload-error', preloadPath, error && error.message);
    });
    win.webContents.on('render-process-gone', function (event, details) {
      log('[renderer] render-process-gone', JSON.stringify(details));
    });
  }
  win.webContents.setWindowOpenHandler(function () {
    return { action: 'deny' };
  });
  win.once('ready-to-show', function () {
    win.show();
    // 首启的 baseBounds 来自 defaultBaseBounds()（右下角）：先把它坐实，再放行落盘。
    // 顺序很关键 —— setBounds 之前读到的坐标是占位值，写下去就成了「永久左上角」。
    win.setBounds(baseBounds);
    positionReady = true;
    log(
      '窗口就绪：baseBounds =',
      JSON.stringify(baseBounds),
      '；win.getBounds() =',
      JSON.stringify(win.getBounds()),
      '；主屏 =',
      JSON.stringify(primaryDisplayInfo())
    );
    persistPosition();
    pushConfig();
  });
  win.on('closed', function () {
    win = null;
  });
  win.loadFile(path.join(RENDERER_DIR, 'index.html'));
}

function pushConfig() {
  sendToPet('config:changed', {
    config: config,
    deepNight: isDeepNight(Date.now()),
    dnd: Boolean(config && config.dnd),
    // 在**内存里**把初见流程按住（冒烟 / 自检期间不弹问名气泡，也不落盘）：
    // 磁盘上的 state.onboarded 一动不动，真人首启照样能看到完整入场 + 问名。
    onboarded: Boolean(state && state.onboarded) || SMOKE_TEST || SELF_CHECK,
  });
  sendToPet('pet:pause', { paused: Boolean(state.paused) });
  sendToPet('pet:command', { command: 'pin', pinned: Boolean(state.pinned) });
}

function createTray() {
  const iconPath = path.join(SPRITE_DIR, 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) {
    image = image.resize({ width: 16, height: 16 });
  }
  tray = new Tray(image);
  tray.setToolTip(trayTooltip());
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
  tray.on('click', function () {
    toggleVisibility();
  });
}

/** 托盘 tooltip：常态是产品名；别烦我开着 / 有自启失败提示时要说清楚（绝不静默）。 */
function trayTooltip() {
  const base = 'hermes-pet 琉斯';
  if (config && config.dnd) return base + ' · 别烦我：开（窗内点击穿透）';
  if (lastUserNotice) return base + ' · ' + lastUserNotice;
  return base;
}

/** A5：托盘图标随 dnd 切换（dnd 开 -> icon-night.png「静默变体」，不改素材本身）。 */
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const iconPath = path.join(SPRITE_DIR, config && config.dnd ? 'icon-night.png' : 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  tray.setImage(image);
  tray.setToolTip(trayTooltip());
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function petMenuTemplate() {
  return [
    { label: '对话', click: function () { sendToPet('pet:command', { command: 'dialogue' }); } },
    { label: '设置', click: function () { openSettings(); } },
    { type: 'separator' },
    {
      label: '固定位置',
      type: 'checkbox',
      checked: Boolean(state.pinned),
      click: function (item) { setPinned(item.checked); },
    },
    { label: '重置位置', click: function () { resetPosition(); } },
    {
      label: '暂停',
      type: 'checkbox',
      checked: Boolean(state.paused),
      click: function (item) { setPaused(item.checked); },
    },
    { type: 'separator' },
    { label: '退出', click: function () { quitApp(); } },
  ];
}

function trayMenuTemplate() {
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  const occupiedNames = Object.keys(shortcutOccupied).map(function (action) {
    return SHORTCUT_LABELS[action] + '=' + shortcutOccupied[action].accelerator;
  });
  return [
    { label: visible ? '隐藏' : '显示', click: function () { toggleVisibility(); } },
    { type: 'separator' },
    { label: '暂停动画', type: 'checkbox', checked: Boolean(state.paused), click: function (item) { setPaused(item.checked); } },
    {
      // A5 别烦我 / 透明模式：勾上后整窗恒定穿透（猫点不动，点击全落到桌面），猫仍在呼吸
      label: config && config.dnd ? '别烦我 / 透明模式：开' : '别烦我 / 透明模式',
      type: 'checkbox',
      checked: Boolean(config && config.dnd),
      click: function (item) { setDnd(item.checked); },
    },
    {
      // A7【P1-2】静音 = 不主动说话（proactiveEnabled），**不复用**暂停（paused 是冻结）
      label: '静音（不主动说话）',
      type: 'checkbox',
      checked: Boolean(config && config.proactiveEnabled === false),
      click: function () { toggleMute(); },
    },
    { label: '重置位置', click: function () { resetPosition(); } },
    { label: '设置', click: function () { openSettings(); } },
    // A7：被占用的快捷键必须说出来（绝不静默失败），点一下进设置改键
    {
      label: occupiedNames.length ? '快捷键被占用：' + occupiedNames.join('、') + '（点此改键）' : '快捷键都可用',
      enabled: occupiedNames.length > 0,
      click: function () { openSettings(); },
    },
    { type: 'separator' },
    { label: '退出', click: function () { quitApp(); } },
  ];
}

function toggleVisibility() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else win.show();
  refreshTrayMenu();
}

function quitApp() {
  quitting = true;
  persistPosition();
  persistState();
  app.quit();
}

function setPaused(value) {
  state.paused = Boolean(value);
  persistState();
  sendToPet('pet:pause', { paused: state.paused });
  refreshTrayMenu();
  return { ok: true, paused: state.paused };
}

function setPinned(value) {
  state.pinned = Boolean(value);
  persistState();
  sendToPet('pet:command', { command: 'pin', pinned: state.pinned });
  refreshTrayMenu();
  return { ok: true, pinned: state.pinned };
}

/* ---------------- M1-R1 A5：别烦我 / 透明模式（【P0-1】穿透所有权） ---------------- */

/**
 * A5 别烦我：偏好级（config.dnd），与「暂停」分开——暂停是「它安静了」（冻结，点击仍可点），
 * dnd 是「它透明了」（整窗恒定穿透，点击全落到桌面，但呼吸/看她板仍在）。
 *
 * 【P0-1-1】开 / 关**两个方向都无条件重断言穿透**。只重断言「关」是这个功能最容易做错的洞：
 * 鼠标正压在猫身上时勾上 dnd，渲染进程刚报过「命中可交互」（ignore=false），
 * 若主进程不主动重断言，状态就卡在 ignore=false —— 猫仍然吃点击，功能等于没生效。
 */
function setDnd(value) {
  const next = Boolean(value);
  if (config.dnd !== next) {
    config = configStore.saveConfig(configPath, Object.assign({}, config, { dnd: next }));
  }
  reassertPassThrough(next ? 'dnd-on' : 'dnd-off');
  lastInteractive = false;
  refreshTray();
  pushConfig();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('config:changed', { config: config, deepNight: isDeepNight(Date.now()) });
  }
  return { ok: true, dnd: Boolean(config.dnd) };
}

/** A7【P1-2】Alt+M：静音 = 切换 config.proactiveEnabled（不新增 muted、不动 paused）。幂等。 */
function toggleMute(value) {
  const next = typeof value === 'boolean' ? value : config.proactiveEnabled !== false;
  config = configStore.saveConfig(configPath, Object.assign({}, config, { proactiveEnabled: next }));
  refreshTray();
  pushConfig();
  notifySettings();
  return { ok: true, proactiveEnabled: Boolean(config.proactiveEnabled), muted: config.proactiveEnabled === false };
}

/* ---------------- M1-R1 A7：全局快捷键 ---------------- */

const SHORTCUT_LABELS = { toggle: '显示/隐藏', chat: '打开对话', settings: '打开设置', mute: '静音' };

/**
 * 注册一个加速键（A7 的唯一入口，五条纪律都收在这里）：
 * ① register 前先 unregister 同键（幂等）；
 * ② register 返回 false = 被别的程序占用 -> 降级成 { ok:false, occupied:true }；
 * ③ register 抛异常也要 catch（Electron 对非法加速键会抛）；
 * ④ 绝不把异常抛给上层（一个键失败不影响其它键）。
 */
function registerAccelerator(accelerator, handler) {
  if (typeof accelerator !== 'string' || !accelerator) {
    return { ok: false, occupied: false, error: 'invalid-accelerator' };
  }
  try {
    globalShortcut.unregister(accelerator);
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) return { ok: false, occupied: true, error: 'occupied' };
    return { ok: true, occupied: false, error: null };
  } catch (err) {
    return { ok: false, occupied: true, error: failureText(err) };
  }
}

function shortcutHandler(action) {
  return function () {
    if (action === 'toggle') toggleVisibility();
    else if (action === 'chat') {
      // 【P2-6】取舍承认：Alt+T 需要把窗口前台化才能让输入框拿到焦点（会抢一次焦点），
      // 换来的是「一键就能打字」。不改，只在这里写明。
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
      sendToPet('pet:command', { command: 'dialogue' });
    } else if (action === 'settings') openSettings();
    else if (action === 'mute') toggleMute();
  };
}

function occupiedShortcutList() {
  const list = {};
  Object.keys(shortcutOccupied).forEach(function (action) {
    list[action] = Object.assign({}, shortcutOccupied[action]);
  });
  return list;
}

function broadcastShortcuts() {
  const payload = { shortcuts: config ? config.shortcuts : SHORTCUT_DEFAULTS, occupied: occupiedShortcutList() };
  sendToPet('shortcuts:changed', payload);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('shortcuts:changed', payload);
}

/** 启动时注册四键；冒烟/自检**不注册真实快捷键**（会抢用户键位）。 */
function registerShortcuts() {
  unregisterShortcuts();
  if (SMOKE_TEST || SELF_CHECK) {
    broadcastShortcuts();
    return { skipped: true, shortcuts: config.shortcuts, occupied: {} };
  }
  shortcutOccupied = {};
  configStore.SHORTCUT_KEYS.forEach(function (action) {
    const accelerator = config.shortcuts[action];
    const result = registerAccelerator(accelerator, shortcutHandler(action));
    if (!result.ok) {
      shortcutOccupied[action] = { accelerator: accelerator, error: result.error };
      log('快捷键注册失败（被占用 / 非法），已标红并提示用户：', action, accelerator, result.error);
    }
  });
  broadcastShortcuts();
  refreshTray();
  if (Object.keys(shortcutOccupied).length) {
    lastUserNotice = '部分快捷键被占用，去设置里改键';
    refreshTray();
  }
  return { skipped: false, shortcuts: config.shortcuts, occupied: occupiedShortcutList() };
}

/** 退出 / 重注册前先全部注销：不留幽灵占用。 */
function unregisterShortcuts() {
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    log('快捷键注销失败：', failureText(err));
  }
  shortcutOccupied = {};
}

/**
 * A7 改键：先 unregister 旧键 -> register 新键 -> 失败回滚旧键（旧键必须仍然可用）。
 * 被占用时返回 { ok:false, occupied:true } 并标红，绝不静默。
 */
function setShortcut(action, accelerator) {
  if (configStore.SHORTCUT_KEYS.indexOf(action) < 0) return { ok: false, reason: 'unknown-action' };
  const candidate = Object.assign({}, config.shortcuts);
  candidate[action] = accelerator;
  const normalised = configStore.coerceShortcuts(candidate);
  if (normalised[action] !== accelerator) {
    return { ok: false, reason: 'invalid', shortcuts: config.shortcuts, occupied: occupiedShortcutList() };
  }
  const previous = config.shortcuts[action];
  if (SMOKE_TEST || SELF_CHECK) {
    // 自检不碰真实快捷键：只回一条「形状正确」的结果，绝不注册
    return { ok: true, skipped: true, shortcuts: normalised, occupied: occupiedShortcutList() };
  }
  try {
    globalShortcut.unregister(previous);
  } catch (err) {
    log('旧快捷键注销失败：', failureText(err));
  }
  const result = registerAccelerator(accelerator, shortcutHandler(action));
  if (!result.ok) {
    registerAccelerator(previous, shortcutHandler(action)); // 回滚：旧键继续有效
    shortcutOccupied[action] = { accelerator: accelerator, error: result.error };
    broadcastShortcuts();
    refreshTray();
    return { ok: false, reason: 'occupied', occupied: true, shortcuts: config.shortcuts, occupiedList: occupiedShortcutList() };
  }
  delete shortcutOccupied[action];
  config = configStore.saveConfig(configPath, Object.assign({}, config, { shortcuts: normalised }));
  broadcastShortcuts();
  refreshTray();
  return { ok: true, shortcuts: config.shortcuts, occupied: occupiedShortcutList() };
}

function resetPosition() {
  baseBounds = defaultBaseBounds();
  syncWindowBounds();
  persistPosition();
  return { ok: true, x: baseBounds.x, y: baseBounds.y };
}

function recenterForSize() {
  const size = petWindowSize();
  const anchor = baseBounds || defaultBaseBounds();
  const centerX = anchor.x + anchor.width / 2;
  const bottom = anchor.y + anchor.height;
  baseBounds = clampToWorkArea({
    x: Math.round(centerX - size.width / 2),
    y: Math.round(bottom - size.height),
    width: size.width,
    height: size.height,
  });
  // 【P2-5】A4 缩放落盘那一次顺带走一遍吸附：贴着哪条边就还贴哪条边
  const workArea = workAreaFor(baseBounds);
  const snapped = position.snapToEdge(
    position.clampFullyInside(baseBounds, workArea),
    workArea,
    position.SNAP_THRESHOLD,
    position.SNAP_BREATHE
  );
  baseBounds = { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height };
  syncWindowBounds();
  persistPosition();
}

let settingsShownAt = 0;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return { ok: true, reused: true };
  }
  const anchor = baseBounds || defaultBaseBounds();
  const width = 480; // 设计文档 4.4
  const height = 560;
  const display = screen.getDisplayMatching(anchor);
  const wa = display.workArea;
  const x = Math.round(Math.min(Math.max(anchor.x + anchor.width - width, wa.x + 16), wa.x + wa.width - width - 16));
  const y = Math.round(Math.min(Math.max(anchor.y + anchor.height - height, wa.y + 16), wa.y + wa.height - height - 16));
  settingsWin = new BrowserWindow({
    x: x,
    y: y,
    width: width,
    height: height,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  settingsWin.once('ready-to-show', function () {
    settingsShownAt = Date.now();
    settingsWin.show();
    settingsWin.focus();
  });
  settingsWin.on('blur', function () {
    if (settingsWin && !settingsWin.isDestroyed() && Date.now() - settingsShownAt > 400) {
      settingsWin.close();
    }
  });
  settingsWin.on('closed', function () {
    settingsWin = null;
  });
  settingsWin.loadFile(path.join(RENDERER_DIR, 'settings.html'));
  return { ok: true };
}

function closeSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  return { ok: true };
}

function startBreakCountdown(minutes) {
  const mins = Number.isFinite(minutes) ? Math.max(1, Math.min(60, Math.round(minutes))) : 5;
  breakUntil = Date.now() + mins * 60000;
  if (breakTimer) clearInterval(breakTimer);
  sendToPet('break:tick', { active: true, remainingMs: breakUntil - Date.now() });
  breakTimer = setInterval(function () {
    const remaining = breakUntil - Date.now();
    if (remaining <= 0) {
      clearInterval(breakTimer);
      breakTimer = null;
      sendToPet('break:tick', { active: false, remainingMs: 0, done: true });
      sendToPet('pet:proactive', { kind: 'wake', text: '回来吧。休息完了。', button: null, fromUser: true });
      return;
    }
    sendToPet('break:tick', { active: true, remainingMs: remaining });
  }, 1000);
  return { ok: true, until: breakUntil };
}

function stopBreakCountdown() {
  if (breakTimer) {
    clearInterval(breakTimer);
    breakTimer = null;
  }
  breakUntil = 0;
}

function markActivity(now) {
  runtime = scheduler.markActivity(runtime, now);
}

function notifySettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('config:changed', { config: config, deepNight: isDeepNight(Date.now()) });
  }
}

/** 给用户**看得见**的提示（A12 自启失败 / 快捷键被占）：托盘 tooltip + 一次气泡，绝不只写日志。 */
function notifyUser(text) {
  lastUserNotice = String(text == null ? '' : text);
  if (tray && !tray.isDestroyed()) tray.setToolTip(trayTooltip());
  if (lastUserNotice) {
    sendToPet('pet:proactive', { kind: 'error', text: lastUserNotice, button: null, fromUser: true });
  }
  return lastUserNotice;
}

/**
 * A12 开机自启（【P1-7】失败路径**可注入**）。
 * 真的调 app.setLoginItemSettings；options.injectSetLoginItem 是自证门用的替身
 * （注入一个抛错的函数 -> 断言「调用一次 + 产生一条用户可见提示」）。
 * 返回值形状固定：{ ok, calls, notice, error }，好让 --self-check 直接断言。
 */
function applyAutoLaunch(options) {
  const opts = options || {};
  const setLoginItem =
    typeof opts.injectSetLoginItem === 'function'
      ? opts.injectSetLoginItem
      : function (settings) {
          app.setLoginItemSettings(settings);
        };
  if (SMOKE_TEST) {
    return { ok: true, skipped: true, calls: 0, notice: lastUserNotice, error: null };
  }
  try {
    setLoginItem({ openAtLogin: Boolean(config.launchAtLogin) });
    return { ok: true, skipped: false, calls: 1, notice: null, error: null };
  } catch (err) {
    const notice = notifyUser('开机自启设置失败：' + failureText(err));
    log('开机自启设置失败：', failureText(err));
    return { ok: false, skipped: false, calls: 1, notice: notice, error: failureText(err) };
  }
}

function applyConfigPatch(patch) {
  const beforeSize = config.size;
  config = configStore.saveConfig(configPath, Object.assign({}, config, patch || {}));
  // A7：patch 里带了 shortcuts（理论上只有设置面板会这么干）就重挂一遍全局快捷键
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'shortcuts')) registerShortcuts();
  applyAutoLaunch();
  if (config.size !== beforeSize) recenterForSize();
  else syncWindowBounds();
  pushConfig();
  notifySettings();
  refreshTray();
  return { ok: true, config: config };
}

function registerIpc() {
  ipcMain.on('pet:ready', function (event, info) {
    rendererReport = info || {};
  });
  ipcMain.on('pet:activity', function () {
    markActivity(Date.now());
  });
  ipcMain.on('pet:state', function (event, info) {
    if (info && typeof info.name === 'string') lastPetState = info.name;
  });
  ipcMain.on('pet:dialogue', function (event, info) {
    runtime = scheduler.recordDialogue(runtime, Date.now(), Boolean(info && info.open));
  });
  ipcMain.on('pet:typing', function (event, info) {
    runtime = scheduler.recordTyping(runtime, Date.now(), Boolean(info && info.active));
  });
  ipcMain.on('bubble:ignored', function (event, info) {
    runtime = scheduler.recordIgnored(runtime, Date.now(), info && info.kind);
    persistState();
  });
  ipcMain.on('pet:drag-start', function (event, point) {
    if (!win || win.isDestroyed() || state.pinned) return;
    const bounds = win.getBounds();
    dragSession = {
      originX: bounds.x,
      originY: bounds.y,
      pointerX: point && Number.isFinite(point.x) ? point.x : 0,
      pointerY: point && Number.isFinite(point.y) ? point.y : 0,
    };
    runtime = scheduler.recordDrag(runtime, Date.now(), true);
  });
  ipcMain.on('pet:drag-move', function (event, point) {
    if (!dragSession || !win || win.isDestroyed()) return;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const bounds = win.getBounds();
    win.setBounds({
      x: dragSession.originX + Math.round(point.x - dragSession.pointerX),
      y: dragSession.originY + Math.round(point.y - dragSession.pointerY),
      width: bounds.width,
      height: bounds.height,
    });
  });
  ipcMain.on('pet:drag-end', function () {
    if (!win || win.isDestroyed()) return;
    if (walkSession) endWalk('drag'); // 拖拽优先于走动：先把散步停干净
    const bounds = win.getBounds();
    const size = petWindowSize();
    const raw = {
      x: Math.round(bounds.x + (bounds.width - size.width) / 2),
      y: Math.round(bounds.y + (bounds.height - size.height)),
      width: size.width,
      height: size.height,
    };
    // 【P0-5】A6 吸附顺序**写死**：clampFullyInside -> snapToEdge -> clampFullyInside 兜底。
    // 先整体收进 workArea，再在「完整在屏内」的窗口上判四边距离 —— 堵住 M0 clampToArea
    // (MIN_VISIBLE=48) 允许窗口出屏 96px、于是「永远吸附不上」的洞。
    const workArea = workAreaFor(raw);
    const inside = position.clampFullyInside(raw, workArea);
    const snapped = position.snapToEdge(inside, workArea, position.SNAP_THRESHOLD, position.SNAP_BREATHE);
    const settled = position.clampFullyInside(snapped, workArea);
    baseBounds = { x: settled.x, y: settled.y, width: settled.width, height: settled.height };
    if (snapped.edge) log('边缘吸附：', snapped.edge, JSON.stringify(baseBounds));
    dragSession = null;
    runtime = scheduler.recordDrag(runtime, Date.now(), false);
    syncWindowBounds();
    persistPosition();
  });
  ipcMain.on('pet:bubble-resize', function (event, size) {
    // 【P2-4】走动中气泡要展开：先 walk:end（把走路停干净、把位置落盘），再同步窗口尺寸
    if (walkSession) endWalk('bubble-resize');
    if (!size || !Number.isFinite(size.height)) {
      bubbleContent = null;
    } else {
      bubbleContent = {
        width: Number.isFinite(size.width) ? size.width : 0,
        height: Math.max(0, Math.min(BUBBLE_MAX_HEIGHT, size.height)),
      };
    }
    syncWindowBounds();
  });
  ipcMain.on('pet:context-menu', function () {
    if (!win || win.isDestroyed()) return;
    Menu.buildFromTemplate(petMenuTemplate()).popup({ window: win });
  });
  // FIX-1：handler 主体抽成 applyIgnoreMouse()，好让 --smoke-test 在不依赖真实光标与渲染
  // 进程时序的前提下，确定性地走一遍同一条状态切换路径（见 probeMousePassThrough）。
  ipcMain.on('pet:ignore-mouse', function (event, info) {
    applyIgnoreMouse(info, 'renderer');
  });
  // A13：渲染进程上报「这一下是击键」——主进程只留近 3s 的时刻，密度够了就安静
  ipcMain.on('pet:keystroke', function () {
    keystrokes = quiet.recordKeystroke(keystrokes, Date.now());
  });
  // A5：渲染进程在 dnd 短路时也上报一次 { ignore:true }，保证 lastInteractive 缓存不在 dnd 下腐烂
  ipcMain.handle('pet:set-dnd', function (event, value) {
    return setDnd(value);
  });
  // A1：初见一问一答（skip 落 nickname='你'；拒绝词 / 空输入都在纯函数里判）
  ipcMain.handle('onboard:complete', function (event, text) {
    const outcome = replies.resolveOnboarding(text);
    if (outcome.action === 'retry') return { ok: true, done: false, nickname: config.nickname, line: outcome.line };
    state.onboarded = true;
    persistState();
    config = configStore.saveConfig(configPath, Object.assign({}, config, { nickname: outcome.nickname }));
    pushConfig();
    notifySettings();
    return { ok: true, done: true, nickname: outcome.nickname, line: outcome.line, action: outcome.action };
  });
  ipcMain.handle('onboard:skip', function () {
    state.onboarded = true;
    persistState();
    config = configStore.saveConfig(configPath, Object.assign({}, config, { nickname: configStore.ONBOARD_NICKNAME }));
    pushConfig();
    notifySettings();
    return { ok: true, done: true, nickname: config.nickname, line: replies.ONBOARD_LINES.decline };
  });
  // A8：双击气泡复制。preload 已做 typeof / 长度 <=4096 截断，这里只落地到系统剪贴板。
  ipcMain.handle('clipboard:write', function (event, text) {
    if (typeof text !== 'string' || !text) return { ok: false, reason: 'empty' };
    try {
      clipboard.writeText(text);
      return { ok: true, length: text.length };
    } catch (err) {
      return { ok: false, reason: failureText(err) };
    }
  });
  // A7：改键（先注销旧 -> 注册新 -> 失败回滚）
  ipcMain.handle('shortcuts:set', function (event, payload) {
    const info = payload || {};
    return setShortcut(info.action, info.accelerator);
  });
  ipcMain.handle('shortcuts:get', function () {
    return { shortcuts: config.shortcuts, occupied: occupiedShortcutList() };
  });
  // 【P2-9】'bubble:closed' 之前是死通道（渲染进程发了没人接）：补上 handler，
  // 顺手把「气泡没了 -> 窗口收回基准尺寸」这条收尾做掉。
  ipcMain.on('bubble:closed', function () {
    if (walkSession) endWalk('bubble-closed');
    bubbleContent = null;
    syncWindowBounds();
  });
  ipcMain.handle('chat:send', async function (event, text) {
    return replyService.reply(text);
  });
  ipcMain.handle('config:get', function () {
    return {
      config: config,
      deepNight: isDeepNight(Date.now()),
      paused: Boolean(state.paused),
      pinned: Boolean(state.pinned),
      primaryAdapter: replyService ? replyService.primaryName : 'local-mock',
      spritesDir: SPRITE_DIR,
    };
  });
  ipcMain.handle('config:set', function (event, patch) {
    return applyConfigPatch(patch);
  });
  ipcMain.handle('pet:reset-position', function () {
    return resetPosition();
  });
  ipcMain.handle('pet:toggle-pause', function (event, value) {
    return setPaused(value);
  });
  ipcMain.handle('pet:toggle-pin', function (event, value) {
    return setPinned(value);
  });
  ipcMain.handle('settings:open', function () {
    return openSettings();
  });
  ipcMain.handle('settings:close', function () {
    return closeSettings();
  });
  ipcMain.handle('break:start', function (event, minutes) {
    return startBreakCountdown(minutes);
  });
}

function schedulerTick() {
  if (!config || !runtime) return;
  const now = Date.now();
  // 墙钟护栏：时间回拨 -> 重置基准并静默；长时间挂起后醒来 -> 只判定一次，不补发历史
  const guard = scheduler.guardTick(now, runtime);
  runtime = guard.runtime;
  if (guard.skip) return;
  const hidden = !win || win.isDestroyed() || !win.isVisible();
  const signals = quietSignals(now);
  const quietAll = quiet.shouldBeQuiet(signals);
  // A13：安静如果**只**由深夜一条引起，就不该把 22:30 的数字日落一起关掉 ——
  // 那条提醒本来就是为深夜准备的。其余任何一条信号（全屏/打字/dnd/暂停/隐藏）
  // 都一票否决，连 sunset 也不例外。
  const nightOnly =
    quietAll &&
    signals.deepNight &&
    !(signals.foregroundFullscreen || signals.typingBurst || signals.dnd || signals.paused || signals.hidden);
  const decision = scheduler.plan({
    now: now,
    config: config,
    runtime: runtime,
    state: lastPetState,
    paused: statePaused(),
    hidden: hidden,
    quiet: quietAll,
    quietExemptKinds: nightOnly ? ['sunset'] : [],
  });
  if (decision.action === 'nap') {
    sendToPet('pet:command', { command: 'nap' });
  }
  if (decision.speak) {
    runtime = scheduler.recordSpoken(runtime, now, decision.kind);
    persistState();
    sendToPet('pet:proactive', {
      kind: decision.kind,
      text: replies.proactiveLine(decision.kind, { nickname: config.nickname, now: now }),
      button: decision.kind === 'break' ? '休息 5 分钟' : null,
    });
  }
}

function tickCursor() {
  if (!win || win.isDestroyed() || !win.isVisible() || !baseBounds) return;
  const point = screen.getCursorScreenPoint();
  const now = Date.now();
  // A2：近 5s 光标轨迹（累计位移 >120px = 高频操作 = 禁止散步）
  cursorTrail.push({ t: now, x: point.x, y: point.y });
  cursorTrail = cursorTrail.filter(function (entry) {
    return entry.t >= now - walkCore.CURSOR_QUIET_MS;
  });
  // 【P2-2】A3 的方向要用**主进程下发的窗口矩形**算 —— 渲染进程的 window.screenX 会滞后于
  // 窗口真实位置（HANDOFF §13 记过）。这里把窗口原点和光标一起发过去。
  const live = win.getBounds();
  sendToPet('pet:cursor', { x: point.x, y: point.y, winX: live.x, winY: live.y });
  const centerX = baseBounds.x + baseBounds.width / 2;
  const centerY = baseBounds.y + baseBounds.height / 2;
  const near = Math.hypot(point.x - centerX, point.y - centerY) <= ACTIVITY_NEAR_PX;
  const moved = lastCursor ? Math.hypot(point.x - lastCursor.x, point.y - lastCursor.y) >= 20 : false;
  lastCursor = point;
  if (near && moved && now - lastNearActivityAt > ACTIVITY_THROTTLE_MS) {
    lastNearActivityAt = now;
    markActivity(now);
  }
  maybeStartWalk(now); // A2：抽签 + 起步（冷却 180s + 1/300）
}

function startTimers() {
  cursorTimer = setInterval(tickCursor, 200);
  schedulerTimer = setInterval(schedulerTick, 1000);
  // A13：全屏探测节流 ~2s（探测本身在后台跑，这里只读最近一次结果并顺手触发刷新）
  quietTick();
  quietTimer = setInterval(quietTick, quiet.FULLSCREEN_THROTTLE_MS);
  deepNightTimer = setInterval(function () {
    sendToPet('pet:deep-night', { deepNight: isDeepNight(Date.now()) });
  }, 60000);
  // FIX-A / FIX-B：两条「环境级静默失效」看门狗，常数与依据见 src/core/window-guards.js §5.2/§6。
  topmostWatchdog = setInterval(topmostWatchdogTick, windowGuard.TOPMOST_WATCHDOG_MS);
  ignoreWatchdog = setInterval(ignoreWatchdogTick, windowGuard.IGNORE_WATCHDOG_MS);
}

function stopTimers() {
  [cursorTimer, schedulerTimer, deepNightTimer, smokeTimer, topmostWatchdog, ignoreWatchdog, quietTimer].forEach(function (timer) {
    if (timer) clearInterval(timer);
  });
  cursorTimer = null;
  schedulerTimer = null;
  deepNightTimer = null;
  smokeTimer = null;
  topmostWatchdog = null;
  ignoreWatchdog = null;
  quietTimer = null;
  // A2：走动计时器也一起清掉（退出时不留尾巴），但不落盘 —— 退出路径另有 persistPosition
  if (walkTimer) {
    clearInterval(walkTimer);
    walkTimer = null;
  }
  walkSession = null;
  stopBreakCountdown();
}

/**
 * A13：读一次全屏探测（节流 2s、失败降级 false、可注入/mock —— 见 src/core/quiet.js）。
 * 探测在后台异步跑，这里只取「最近一次」的同步结果，绝不阻塞主进程。
 */
function quietTick() {
  foregroundFullscreen = quiet.detectForegroundFullscreen();
}

/**
 * 立刻重断言「默认穿透」（FIX-B）：页面加载 / 重载 / 站内跳转后调一次。
 * 依据 docs/M0-recon-github-pet.md §5.2：Windows 上 forward 转发会在「宠物页快速重载后」静默失效。
 * 这里刻意不看 ignoreMouseActive —— 「主进程以为穿透还开着」正是静默失效的形态，所以再调一次 API。
 */
function reassertPassThrough(source) {
  if (!win || win.isDestroyed()) return;
  lastInteractive = false;
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoreMouseActive = true;
  if (SMOKE_TEST) log('穿透重断言：', source);
}

/**
 * FIX-A 置顶看门狗（5000ms）：Windows 上 alwaysOnTop 只在构造器里设一次不够，
 * 任务栏 / 全屏窗扫过后会被压下去。5000ms 与层级 'pop-up-menu' 依据
 * docs/M0-recon-github-pet.md §6(a) / §5.2，抄自竞品 rullerzhou-afk/clawd-on-desk 的
 * TOPMOST_WATCHDOG_MS —— 别当成冗余定时器删掉。
 */
function topmostWatchdogTick() {
  if (!win || win.isDestroyed()) return;
  if (!windowGuard.shouldReassertTopmost({
    isDestroyed: win.isDestroyed(),
    isVisible: win.isVisible(),
    paused: Boolean(state && state.paused),
  })) {
    return;
  }
  win.setAlwaysOnTop(true, windowGuard.TOPMOST_LEVEL);
}

/**
 * FIX-B 穿透看门狗（2000ms）：setIgnoreMouseEvents(true, { forward: true }) 在 Windows 上
 * 「宠物页快速重载 / 有全屏窗扫过」后会静默失效，且没有任何报错
 * （docs/M0-recon-github-pet.md §5.2，实测来自竞品 OpenPetsHQ/openpets 源码注释）。
 * 只在「最近一次没命中交互元素」时兜底重开穿透；命中了就什么都不做，否则点猫会失效。
 */
function ignoreWatchdogTick() {
  if (!win || win.isDestroyed()) return;
  const action = windowGuard.watchdogAction({
    lastInteractive: lastInteractive,
    isDestroyed: win.isDestroyed(),
    visible: win.isVisible(),
  });
  if (action !== 'force-ignore') return;
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoreMouseActive = true;
}

function failureText(err) {
  if (!err) return 'unknown error';
  return err.message ? err.message : String(err);
}

/**
 * `pet:ignore-mouse` 的状态切换主体（FIX-1 从 IPC handler 里抽出来）。
 * 渲染进程 elementFromPoint 命中变化时发来的就是 `{ ignore: <boolean> }`，
 * 所以直接调它 = 走一遍和真实命中完全相同的路径。
 * source 只用于 --smoke-test 的日志：区分「真实光标命中触发」与「探针合成」。
 */
function applyIgnoreMouse(info, source, options) {
  if (!win || win.isDestroyed()) return;
  const opts = options || {};
  // 【P0-1】dnd 是穿透状态的**唯一裁决点**：dnd 为真时无条件 ignore=true ——
  // 渲染进程报什么都不作数（鼠标压在猫身上时它刚报过「命中」）。
  // 探针用 bypassDnd 走同一条切换路径，好把「开/关双向」验证成确定性断言。
  const dndActive = Boolean(config && config.dnd) && !opts.bypassDnd;
  const ignore = dndActive ? true : !(info && info.ignore === false);
  // 渲染进程每次命中变化都会报一次，主进程缓存下来给穿透看门狗用（FIX-B）。
  lastInteractive = dndActive ? false : !ignore;
  if (ignore === ignoreMouseActive) return;
  ignoreMouseActive = ignore;
  win.setIgnoreMouseEvents(ignore, { forward: true });
  if (SMOKE_TEST) log('穿透状态切换：ignore =', ignore, '（来源：' + (source || 'renderer') + '）');
}

/**
 * FIX-1（P0，第五轮）：把 `mousePassThrough` 断言从「读一个会被合法改写的当前态」
 * 改成**光标无关的确定性探针**，四条一起才算通过：
 *   ① ipcWired  —— `pet:ignore-mouse` 通道确实挂着 handler（接线存在）；
 *   ② initial   —— 建窗后、任何命中测试之前的快照 ignoreMouseAtStart === true
 *                  （这才是 P0-1/P0-2 真要不留的那块「挡板」）；
 *   ③ hit / miss—— 合成「命中交互元素」-> ignoreMouseActive 变 false；
 *                  再合成「未命中」-> 回到 true（穿透双向真的接线了）；
 *   ④ restored  —— 断言结束后把状态恢复成 ignoreMouseActive = true。
 * 全程不读、不动真实光标，也不依赖渲染进程时序，因此不受宿主光标位置影响。
 */
function probeMousePassThrough() {
  const detail = {
    ipcWired: ipcMain.listenerCount('pet:ignore-mouse') > 0,
    initial: ignoreMouseAtStart === true,
    hit: false,
    miss: false,
    restored: false,
  };
  if (!win || win.isDestroyed()) return detail;
  applyIgnoreMouse({ ignore: false }, 'probe'); // ③a 合成「命中交互元素」：关穿透
  detail.hit = ignoreMouseActive === false;
  applyIgnoreMouse({ ignore: true }, 'probe'); // ③b 合成「未命中」：回到穿透
  detail.miss = ignoreMouseActive === true;
  reassertPassThrough('smoke-probe'); // ④ 恢复默认穿透（不看当前值，直接再调一次 API）
  detail.restored = ignoreMouseActive === true;
  return detail;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * A5【P0-1-4】dnd-locks-passthrough 的**确定性**探针（光标无关）：
 *   ① 开 dnd -> 再合成一次「渲染进程报命中可交互」（ignore:false）—— dnd 必须压住它，
 *      ignoreMouseActive 仍为 true（「鼠标正压在猫身上时勾上别烦我」的现场）；
 *   ② 关 dnd -> 必须回到穿透（off 方向也重断言了）；
 *   ③ 收尾把 dnd 恢复成原值，并再断言一次穿透。
 */
function probeDndLocksPassthrough() {
  const detail = { onLocks: false, offRestores: false, restored: false };
  const before = Boolean(config && config.dnd);
  try {
    setDnd(true);
    applyIgnoreMouse({ ignore: false }, 'probe'); // 合成「鼠标压在猫上」
    detail.onLocks = ignoreMouseActive === true;
    setDnd(false);
    detail.offRestores = ignoreMouseActive === true;
  } catch (err) {
    detail.error = failureText(err);
  } finally {
    setDnd(before);
  }
  detail.restored = ignoreMouseActive === true && Boolean(config.dnd) === before;
  return detail;
}

/**
 * A7 快捷键自证：只用**不常用测试键** Alt+F9 / Alt+F10，验完立刻注销（绝不抢用户键位）。
 * 返回 { register, occupied, unregistered }：
 *   register    —— 真注册成功一次（走 globalShortcut.register 的返回 true 路径）；
 *   occupied    —— 注册失败 / 抛异常一律被 catch 成 { ok:false, occupied:true }（降级不静默）。
 */
function probeShortcuts() {
  const detail = { register: false, occupied: false, unregistered: false, keys: SHORTCUT_PROBE_KEYS.slice() };
  const key = SHORTCUT_PROBE_KEYS[0];
  const result = registerAccelerator(key, function () {});
  detail.register = result.ok === true;
  // 「被占用」用**非法加速键**来触发（`register false=被占用` 的两条路径都要 catch）：
  // 这比「自己注册两次」更确定 —— 不依赖 Electron 对重复注册的返回约定。
  const bogus = registerAccelerator('Alt+F9+NotAKey', function () {});
  detail.occupied = bogus.ok === false && bogus.occupied === true;
  try {
    globalShortcut.unregister(key);
  } catch (err) {
    detail.error = failureText(err);
  }
  detail.unregistered = !globalShortcut.isRegistered(key);
  return detail;
}

/** A7「退出无幽灵占用」自证：注册两个测试键 -> unregisterAll -> 两个都必须不再注册。 */
function probeUnregisterAll() {
  const detail = { registered: 0, allCleared: false };
  SHORTCUT_PROBE_KEYS.forEach(function (key) {
    if (registerAccelerator(key, function () {}).ok) detail.registered += 1;
  });
  try {
    globalShortcut.unregisterAll();
  } catch (err) {
    detail.error = failureText(err);
  }
  detail.allCleared = SHORTCUT_PROBE_KEYS.every(function (key) {
    return !globalShortcut.isRegistered(key);
  });
  return detail;
}

/** --self-check：把交互链路真正跑一遍（点击 -> 气泡 -> 回复 -> 设置面板），失败即返工。 */
async function runSelfCheckFlow() {
  selfCheckActive = true; // 自检期间不弹主动气泡，避免干扰测量
  const { runSelfCheck } = require('../tools/selfcheck');
  try {
    const result = await runSelfCheck({
      win: win,
      tray: tray,
      config: config,
      workArea: workAreaFor(baseBounds),
      minVisible: function () { return MIN_VISIBLE; },
      petBaseBounds: function () { return Object.assign({}, baseBounds); },
      // 自检专用：把猫摆到指定基准矩形（FIX-2 的「贴屏幕边缘」验收要用），不落盘
      placePet: function (bounds) {
        baseBounds = clampToWorkArea(bounds);
        syncWindowBounds();
        return Object.assign({}, baseBounds);
      },
      rendererReport: function () { return rendererReport; },
      settingsWindow: function () { return settingsWin; },
      openSettings: openSettings,
      closeSettings: closeSettings,
      // M1-R1 新增：A5 / A7 / A12 / A13 的自证钩子（全部确定性，不读真实光标与真实命中态）
      dnd: function () { return Boolean(config.dnd); },
      setDnd: setDnd,
      probeDndLocksPassthrough: probeDndLocksPassthrough,
      probeShortcuts: probeShortcuts,
      probeUnregisterAll: probeUnregisterAll,
      shortcuts: function () { return { shortcuts: config.shortcuts, occupied: occupiedShortcutList() }; },
      applyAutoLaunch: applyAutoLaunch,
      lastUserNotice: function () { return lastUserNotice; },
      foregroundFullscreen: function () { return foregroundFullscreen; },
      setForegroundFullscreenProbe: function (value) { foregroundFullscreen = Boolean(value); },
      probeForegroundFullscreen: function () {
        return quiet.detectForegroundFullscreen({ wait: true });
      },
    });
    result.steps.forEach(function (step) {
      log('[selfcheck]', step.ok ? 'OK  ' : 'FAIL', step.name, '-', step.detail);
    });
    if (result.ok) {
      process.stdout.write('SELFCHECK_OK ' + result.steps.length + '/' + result.steps.length + '\n');
      setTimeout(function () { app.exit(0); }, 80);
      return;
    }
    const names = result.failed.map(function (step) { return step.name; });
    process.stdout.write('SELFCHECK_FAIL ' + names.join(',') + '\n');
    setTimeout(function () { app.exit(1); }, 80);
  } catch (err) {
    process.stdout.write('SELFCHECK_FAIL ' + failureText(err) + '\n');
    setTimeout(function () { app.exit(1); }, 80);
  }
}

function smokeOutcome() {
  // FIX-1：穿透断言走确定性探针（光标无关），不再直接读会被渲染进程合法改写的 ignoreMouseActive。
  const pass = probeMousePassThrough();
  // A5【P0-1-4】dnd-locks-passthrough：开 dnd 后 ignoreMouseActive 必须仍是 true（光标无关模式）
  const dndProbe = probeDndLocksPassthrough();
  const payload = {
    window: Boolean(win && !win.isDestroyed() && win.isVisible()),
    tray: Boolean(tray && !tray.isDestroyed()),
    pet: Boolean(rendererReport && rendererReport.catRendered),
    // P0-2 断言（FIX-1 改写）：初始 ignore=true **且** 双向切换都验证通过（合取）。
    // 字段名保留不变（HANDOFF / 历史证据都引用了它）。
    mousePassThrough: pass.ipcWired && pass.initial && pass.hit && pass.miss && pass.restored,
    // FIX-A / FIX-B 断言：两条「环境级静默失效」看门狗已接线（第四轮）
    topmostWatchdog: Boolean(topmostWatchdog),
    ignoreWatchdog: Boolean(ignoreWatchdog),
    // M1-R1 A5：dnd 开 -> 穿透锁死；关 -> 恢复；收尾恢复原值
    dnd: dndProbe.onLocks && dndProbe.offRestores && dndProbe.restored,
  };
  const ok = payload.window && payload.tray && payload.pet && payload.mousePassThrough
    && payload.topmostWatchdog && payload.ignoreWatchdog && payload.dnd;
  return { ok: ok, pass: pass, dndProbe: dndProbe, line: (ok ? 'SMOKE_OK ' : 'SMOKE_FAIL ') + JSON.stringify(payload) };
}

function finishSmokeCheck() {
  let result;
  try {
    result = smokeOutcome();
  } catch (err) {
    process.stdout.write('SMOKE_FAIL ' + failureText(err) + '\n');
    setTimeout(function () { app.exit(1); }, 80);
    return;
  }
  log('穿透探针（FIX-1 光标无关）：', JSON.stringify(result.pass));
  log('dnd 锁定探针（A5 光标无关）：', JSON.stringify(result.dndProbe));
  process.stdout.write(result.line + '\n');
  const code = result.ok ? 0 : 1;
  setTimeout(function () { app.exit(code); }, 80);
}

function smokeFail(reason) {
  process.stdout.write('SMOKE_FAIL ' + reason + '\n');
  setTimeout(function () { app.exit(1); }, 80);
}

function start() {
  loadPersisted();
  replyService = createReplyService({ envPath: ENV_PATH, env: process.env });
  registerIpc();
  createPetWindow();
  createTray();
  registerShortcuts(); // A7：四键（冒烟 / 自检跳过，绝不抢用户键位）
  applyAutoLaunch(); // A12：真接线（失败给可见提示，绝不静默）
  startTimers();
  log('已启动，adapter =', replyService.primaryName, '；userData =', app.getPath('userData'));
  if (SMOKE_TEST) smokeTimer = setTimeout(finishSmokeCheck, SMOKE_WAIT_MS);
  if (SELF_CHECK) {
    sleep(400).then(runSelfCheckFlow);
  }
}

process.on('uncaughtException', function (err) {
  if (SMOKE_TEST) smokeFail(failureText(err));
  else log('未捕获异常：', failureText(err));
});

process.on('unhandledRejection', function (err) {
  log('未处理的 Promise 拒绝：', failureText(err));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function () {
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(function () {
    try {
      start();
    } catch (err) {
      if (SMOKE_TEST) smokeFail(failureText(err));
      else {
        log('启动失败：', failureText(err));
        app.quit();
      }
    }
  });
  app.on('before-quit', function () {
    quitting = true;
    stopTimers();
    unregisterShortcuts(); // A7：退出不留幽灵占用
    persistPosition();
    persistState();
  });
  // A7 纪律：will-quit 再兜一次 unregisterAll（异常也不能挡住退出）
  app.on('will-quit', function () {
    unregisterShortcuts();
  });
  // 桌宠常驻：关掉窗口不等于退出（退出只走托盘/右键菜单）
  app.on('window-all-closed', function () {
    if (quitting) app.quit();
  });
}
