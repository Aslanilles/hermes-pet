'use strict';

/**
 * hermes-pet 主进程：窗口 / 托盘 / 菜单 / 单实例 / 调度器接线 / 持久化 / --smoke-test。
 * 技术约束：CommonJS、无构建步骤、除 electron 外零依赖。
 */

const path = require('path');
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } = require('electron');

const configStore = require('./core/config');
const position = require('./core/position');
const scheduler = require('./core/scheduler');
const replies = require('./core/replies');
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
let lastInteractive = false; // 渲染进程最近一次报的「有没有命中交互元素」，穿透看门狗据此兜底
let quitting = false;

function log() {
  const args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[hermes-pet]'].concat(args));
}

function isDeepNight(now) {
  if (!config || config.deepNightEnabled === false) return false;
  const hour = new Date(now).getHours();
  return hour >= DEEP_NIGHT_START || hour < DEEP_NIGHT_END;
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
  config = configStore.ensureConfig(configPath); // 首启即落盘一份含全部默认值的 config.json
  state = configStore.loadState(statePath);
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
  sendToPet('config:changed', { config: config, deepNight: isDeepNight(Date.now()) });
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
  tray.setToolTip('hermes-pet 琉斯');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
  tray.on('click', function () {
    toggleVisibility();
  });
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
  return [
    { label: visible ? '隐藏' : '显示', click: function () { toggleVisibility(); } },
    { type: 'separator' },
    { label: '暂停动画', type: 'checkbox', checked: Boolean(state.paused), click: function (item) { setPaused(item.checked); } },
    { label: '重置位置', click: function () { resetPosition(); } },
    { label: '设置', click: function () { openSettings(); } },
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

function applyAutoLaunch() {
  if (SMOKE_TEST) return;
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(config.launchAtLogin) });
  } catch (err) {
    log('开机自启设置失败：', err && err.message ? err.message : String(err));
  }
}

function applyConfigPatch(patch) {
  const beforeSize = config.size;
  config = configStore.saveConfig(configPath, Object.assign({}, config, patch || {}));
  applyAutoLaunch();
  if (config.size !== beforeSize) recenterForSize();
  else syncWindowBounds();
  pushConfig();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('config:changed', { config: config, deepNight: isDeepNight(Date.now()) });
  }
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
    const bounds = win.getBounds();
    const size = petWindowSize();
    baseBounds = clampToWorkArea({
      x: Math.round(bounds.x + (bounds.width - size.width) / 2),
      y: Math.round(bounds.y + (bounds.height - size.height)),
      width: size.width,
      height: size.height,
    });
    dragSession = null;
    runtime = scheduler.recordDrag(runtime, Date.now(), false);
    syncWindowBounds();
    persistPosition();
  });
  ipcMain.on('pet:bubble-resize', function (event, size) {
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
  ipcMain.on('pet:ignore-mouse', function (event, info) {
    if (!win || win.isDestroyed()) return;
    const ignore = !(info && info.ignore === false);
    // 渲染进程每次命中变化都会报一次，主进程缓存下来给穿透看门狗用（FIX-B）。
    lastInteractive = !ignore;
    if (ignore === ignoreMouseActive) return;
    ignoreMouseActive = ignore;
    win.setIgnoreMouseEvents(ignore, { forward: true });
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
  const decision = scheduler.plan({
    now: now,
    config: config,
    runtime: runtime,
    state: lastPetState,
    paused: Boolean(state.paused) || selfCheckActive,
    hidden: hidden,
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
  sendToPet('pet:cursor', point);
  const centerX = baseBounds.x + baseBounds.width / 2;
  const centerY = baseBounds.y + baseBounds.height / 2;
  const near = Math.hypot(point.x - centerX, point.y - centerY) <= ACTIVITY_NEAR_PX;
  const moved = lastCursor ? Math.hypot(point.x - lastCursor.x, point.y - lastCursor.y) >= 20 : false;
  lastCursor = point;
  const now = Date.now();
  if (near && moved && now - lastNearActivityAt > ACTIVITY_THROTTLE_MS) {
    lastNearActivityAt = now;
    markActivity(now);
  }
}

function startTimers() {
  cursorTimer = setInterval(tickCursor, 200);
  schedulerTimer = setInterval(schedulerTick, 1000);
  deepNightTimer = setInterval(function () {
    sendToPet('pet:deep-night', { deepNight: isDeepNight(Date.now()) });
  }, 60000);
  // FIX-A / FIX-B：两条「环境级静默失效」看门狗，常数与依据见 src/core/window-guards.js §5.2/§6。
  topmostWatchdog = setInterval(topmostWatchdogTick, windowGuard.TOPMOST_WATCHDOG_MS);
  ignoreWatchdog = setInterval(ignoreWatchdogTick, windowGuard.IGNORE_WATCHDOG_MS);
}

function stopTimers() {
  [cursorTimer, schedulerTimer, deepNightTimer, smokeTimer, topmostWatchdog, ignoreWatchdog].forEach(function (timer) {
    if (timer) clearInterval(timer);
  });
  cursorTimer = null;
  schedulerTimer = null;
  deepNightTimer = null;
  smokeTimer = null;
  topmostWatchdog = null;
  ignoreWatchdog = null;
  stopBreakCountdown();
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

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
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
  const payload = {
    window: Boolean(win && !win.isDestroyed() && win.isVisible()),
    tray: Boolean(tray && !tray.isDestroyed()),
    pet: Boolean(rendererReport && rendererReport.catRendered),
    // P0-2 断言：穿透已接线，初始状态必须是 ignore=true（否则桌面会留一块看不见的挡板）
    mousePassThrough: ignoreMouseActive === true,
    // FIX-A / FIX-B 断言：两条「环境级静默失效」看门狗已接线（第四轮）
    topmostWatchdog: Boolean(topmostWatchdog),
    ignoreWatchdog: Boolean(ignoreWatchdog),
  };
  const ok = payload.window && payload.tray && payload.pet && payload.mousePassThrough
    && payload.topmostWatchdog && payload.ignoreWatchdog;
  return { ok: ok, line: (ok ? 'SMOKE_OK ' : 'SMOKE_FAIL ') + JSON.stringify(payload) };
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
    persistPosition();
    persistState();
  });
  // 桌宠常驻：关掉窗口不等于退出（退出只走托盘/右键菜单）
  app.on('window-all-closed', function () {
    if (quitting) app.quit();
  });
}
