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
const adapter = document.getElementById('adapter');
const reset = document.getElementById('reset');
const closeBtn = document.getElementById('close');

let saveTimer = null;

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
  proactive.checked = cfg.proactiveEnabled !== false;
  autolaunch.checked = Boolean(cfg.launchAtLogin);
  deepnight.checked = cfg.deepNightEnabled !== false;
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
  save({ proactiveEnabled: proactive.checked });
});

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
}

init();
