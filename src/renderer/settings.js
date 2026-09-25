'use strict';

/**
 * 设置面板：昵称 / 显示大小 / 主动提醒 / 开机自启 / 深夜模式。
 * 改动即时生效（主进程负责落盘与广播），重启后保持。
 */

const api = window.hermes;

const nickname = document.getElementById('nickname');
const size = document.getElementById('size');
const sizeValue = document.getElementById('size-value');
const proactive = document.getElementById('proactive');
const autolaunch = document.getElementById('autolaunch');
const deepnight = document.getElementById('deepnight');
const dnd = document.getElementById('dnd');
const adapter = document.getElementById('adapter');
const reset = document.getElementById('reset');
const closeBtn = document.getElementById('close');
const shortcutReset = document.getElementById('shortcuts-reset');
const shortcutsHint = document.getElementById('shortcuts-hint');

const SHORTCUT_ACTIONS = ['toggle', 'chat', 'settings', 'mute'];
const shortcutFields = {};
const shortcutStates = {};
SHORTCUT_ACTIONS.forEach(function (action) {
  shortcutFields[action] = document.getElementById('sc-' + action);
  shortcutStates[action] = document.getElementById('sc-' + action + '-state');
});

let occupied = {};
let listening = null; // 正在等待用户按组合键的那个 action

let saveTimer = null;

/* ---------------- A7 快捷键区块 ---------------- */

/** 把一次 keydown 转成 Electron 加速键串（例：Alt+H）。改造/改键都走它。 */
function acceleratorFromEvent(event) {
  const key = event.key;
  if (!key || key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  if (!parts.length) return null; // 至少一个修饰键：单键全局绑定既危险又难按
  const named = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: null, // Esc 绝不进全局（任务书红线）
  };
  let name = Object.prototype.hasOwnProperty.call(named, key) ? named[key] : key;
  if (name && name.length === 1) name = name.toUpperCase();
  if (!name) return null;
  parts.push(name);
  return parts.join('+');
}

function renderShortcuts(shortcuts) {
  SHORTCUT_ACTIONS.forEach(function (action) {
    const field = shortcutFields[action];
    const state = shortcutStates[action];
    if (!field) return;
    field.textContent = (shortcuts && shortcuts[action]) || '未设置';
    const bad = Boolean(occupied[action]);
    field.classList.toggle('is-occupied', bad);
    field.classList.toggle('is-listening', listening === action);
    if (state) state.textContent = bad ? '被占用' : listening === action ? '按下组合键…' : '';
  });
}

function applyShortcutsInfo(info) {
  if (!info) return;
  occupied = info.occupied || {};
  renderShortcuts(info.shortcuts);
}

SHORTCUT_ACTIONS.forEach(function (action) {
  const field = shortcutFields[action];
  if (!field) return;
  field.addEventListener('click', function () {
    listening = listening === action ? null : action;
    renderShortcuts(lastShortcuts);
    if (listening) field.focus();
  });
  field.addEventListener('keydown', async function (event) {
    if (listening !== action) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      listening = null;
      renderShortcuts(lastShortcuts);
      return;
    }
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) return;
    listening = null;
    const result = await api.setShortcut(action, accelerator);
    if (result && result.occupiedList) occupied = result.occupiedList;
    lastShortcuts = (result && result.shortcuts) || lastShortcuts;
    renderShortcuts(lastShortcuts);
    if (result && !result.ok && shortcutsHint) {
      shortcutsHint.textContent = result.reason === 'occupied' ? '这个键被别的程序占用了，换一个试试。' : '这个组合不合法，换一个试试。';
    }
  });
});

let lastShortcuts = null;

if (shortcutReset) {
  shortcutReset.addEventListener('click', async function () {
    listening = null;
    const result = await api.setConfig({ shortcuts: { toggle: 'Alt+H', chat: 'Alt+T', settings: 'Alt+S', mute: 'Alt+M' } });
    if (result && result.config) lastShortcuts = result.config.shortcuts;
    renderShortcuts(lastShortcuts);
    if (shortcutsHint) shortcutsHint.textContent = '已恢复默认四键。';
  });
}

if (api.onShortcuts) {
  api.onShortcuts(function (info) {
    applyShortcutsInfo(info);
  });
}

function save(patch, delay) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const wait = Number.isFinite(delay) ? delay : 0;
  if (wait <= 0) {
    api.setConfig(patch);
    return;
  }
  saveTimer = setTimeout(function () {
    saveTimer = null;
    api.setConfig(patch);
  }, wait);
}

function applyConfig(info) {
  const cfg = (info && info.config) || {};
  if (document.activeElement !== nickname) nickname.value = cfg.nickname || '';
  const px = Number(cfg.size) || 120;
  size.value = String(px);
  sizeValue.textContent = px + ' px';
  // A7【P1-2】这一项语义是「静音（不主动说话）」= proactiveEnabled **取反**
  proactive.checked = cfg.proactiveEnabled === false;
  autolaunch.checked = Boolean(cfg.launchAtLogin);
  deepnight.checked = cfg.deepNightEnabled !== false;
  if (dnd) dnd.checked = Boolean(cfg.dnd);
  if (cfg.shortcuts) {
    lastShortcuts = cfg.shortcuts;
    renderShortcuts(cfg.shortcuts);
  }
  if (info && info.primaryAdapter) {
    adapter.textContent = '对话后端：' + (info.primaryAdapter === 'local-mock' ? '本地 mock' : info.primaryAdapter);
  }
  document.body.classList.toggle('deep-night', Boolean(info && info.deepNight));
}

size.addEventListener('input', function () {
  const px = Number(size.value) || 120;
  sizeValue.textContent = px + ' px'; // 实时预览
  save({ size: px }, 120); // 拖动时不狂写盘
});

nickname.addEventListener('input', function () {
  save({ nickname: nickname.value }, 300);
});

proactive.addEventListener('change', function () {
  save({ proactiveEnabled: !proactive.checked }); // 静音勾上 -> 关掉主动提醒
});

if (dnd) {
  dnd.addEventListener('change', function () {
    api.setDnd(dnd.checked);
  });
}

autolaunch.addEventListener('change', function () {
  save({ launchAtLogin: autolaunch.checked });
});

deepnight.addEventListener('change', function () {
  save({ deepNightEnabled: deepnight.checked });
});

reset.addEventListener('click', function () {
  api.resetPosition();
});

closeBtn.addEventListener('click', function () {
  api.closeSettings();
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    api.closeSettings();
  }
});

api.onConfig(function (info) {
  applyConfig(info);
});

api.onDeepNight(function (info) {
  document.body.classList.toggle('deep-night', Boolean(info && info.deepNight));
});

async function init() {
  let info = null;
  try {
    info = await api.getConfig();
  } catch (err) {
    info = null;
  }
  applyConfig(info);
  // A7：被占用的快捷键列表来自主进程运行时内存（不写 config.json）
  try {
    applyShortcutsInfo(await api.getShortcuts());
  } catch (err) {
    /* 拿不到就按「都可用」显示，不挡设置面板 */
  }
}

init();
