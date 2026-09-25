'use strict';

/**
 * contextIsolation 白名单桥。
 * 只暴露必要能力，绝不把 ipcRenderer / require 本体交给渲染进程。
 * 状态机放在这里（require 自 src/core），渲染进程通过 window.hermes.pet 使用，
 * 好处是运行时与单测共用同一份纯逻辑，不用复制粘贴。
 */

const { contextBridge, ipcRenderer } = require('electron');
const spriteFrames = require('./core/sprite-frames');
const { createStateMachine } = require('./core/state-machine');
const replies = require('./core/replies');
const configCore = require('./core/config');

const machine = createStateMachine({});
const COPY_MAX_LEN = 4096; // A8【P1-5】复制长度上限（超出截断，并在气泡里说明）

function on(channel, handler) {
  const listener = function (event, payload) {
    handler(payload);
  };
  ipcRenderer.on(channel, listener);
  return function off() {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('hermes', {
  petReady: function (info) { ipcRenderer.send('pet:ready', info); },
  activity: function () { ipcRenderer.send('pet:activity'); },
  petState: function (name) { ipcRenderer.send('pet:state', { name: name }); },
  dragStart: function (point) { ipcRenderer.send('pet:drag-start', point); },
  dragMove: function (point) { ipcRenderer.send('pet:drag-move', point); },
  dragEnd: function () { ipcRenderer.send('pet:drag-end'); },
  contextMenu: function () { ipcRenderer.send('pet:context-menu'); },
  setIgnoreMouse: function (flag) { ipcRenderer.send('pet:ignore-mouse', { ignore: Boolean(flag) }); },
  dialogue: function (open) { ipcRenderer.send('pet:dialogue', { open: Boolean(open) }); },
  typing: function (active) { ipcRenderer.send('pet:typing', { active: Boolean(active) }); },
  bubbleResize: function (size) { ipcRenderer.send('pet:bubble-resize', size); },
  bubbleIgnored: function (kind) { ipcRenderer.send('bubble:ignored', { kind: kind }); },
  bubbleClosed: function (kind) { ipcRenderer.send('bubble:closed', { kind: kind }); },
  // A13：把「击键」上报给主进程（只用来判「近 3s 击键密度」，不记录内容）
  keystroke: function () { ipcRenderer.send('pet:keystroke'); },
  // A5：别烦我 / 透明模式（主进程是穿透状态的唯一裁决点）
  setDnd: function (value) { return ipcRenderer.invoke('pet:set-dnd', Boolean(value)); },
  // A1：初见收尾（complete 走名字净化 + 拒绝词；skip 落「你」）
  completeOnboarding: function (text) { return ipcRenderer.invoke('onboard:complete', text); },
  skipOnboarding: function () { return ipcRenderer.invoke('onboard:skip'); },
  // A7：四键绑定与改键
  getShortcuts: function () { return ipcRenderer.invoke('shortcuts:get'); },
  setShortcut: function (action, accelerator) {
    return ipcRenderer.invoke('shortcuts:set', { action: action, accelerator: accelerator });
  },
  /**
   * A8【P1-5】双击气泡 -> 复制全文。三道约束：
   * ① 只接受 string（其余一律拒绝）；② 长度 <= 4096（超出截断并回报 truncated）；
   * ③ 只允许写「当前气泡可见文本」——调用方（pet.js）只传 #bubble-text 的 textContent，
   *    不接受任意来源；空文本不提示、不写剪贴板。
   */
  copyText: function (text) {
    if (typeof text !== 'string') return Promise.resolve({ ok: false, reason: 'not-a-string', copied: 0 });
    const requested = text.length;
    const truncated = requested > COPY_MAX_LEN;
    const payload = truncated ? text.slice(0, COPY_MAX_LEN) : text;
    if (!payload.trim()) return Promise.resolve({ ok: false, reason: 'empty', copied: 0 });
    return ipcRenderer
      .invoke('clipboard:write', payload)
      .then(function (result) {
        return {
          ok: Boolean(result && result.ok),
          reason: result && result.reason ? result.reason : null,
          copied: payload.length,
          requested: requested,
          truncated: truncated,
        };
      })
      .catch(function (err) {
        return { ok: false, reason: err && err.message ? err.message : 'clipboard-failed', copied: 0 };
      });
  },
  send: function (text) { return ipcRenderer.invoke('chat:send', text); },
  getConfig: function () { return ipcRenderer.invoke('config:get'); },
  setConfig: function (patch) { return ipcRenderer.invoke('config:set', patch); },
  resetPosition: function () { return ipcRenderer.invoke('pet:reset-position'); },
  setPaused: function (value) { return ipcRenderer.invoke('pet:toggle-pause', value); },
  setPinned: function (value) { return ipcRenderer.invoke('pet:toggle-pin', value); },
  openSettings: function () { return ipcRenderer.invoke('settings:open'); },
  closeSettings: function () { return ipcRenderer.invoke('settings:close'); },
  breakStart: function (minutes) { return ipcRenderer.invoke('break:start', minutes); },
  pet: {
    state: function () { return machine.state; },
    pose: function () { return machine.pose(); },
    send: function (event, payload) { return machine.send(event, payload); },
    tick: function (dt) { machine.tick(dt); return machine.pose(); },
    touch: function () { machine.touch(); },
    // walk 换帧节拍在深夜减半（250ms -> 500ms）：由渲染进程在 deep-night 广播时同步
    setDeepNight: function (value) { machine.setDeepNight(value); },
  },
  spritePosition: function (name, frame) { return spriteFrames.spritePosition(name, frame); },
  spriteSets: function () { return JSON.parse(JSON.stringify(spriteFrames.SPRITE_SETS)); },
  // A2/A3 的 8 向量化（渲染进程与状态机共用同一份实现，方向不会两边不一致）
  petDirection: function (dx, dy) { return spriteFrames.direction8(dx, dy); },
  // A4：滚轮缩放算式（+1 -> ×1.1、-1 -> ×0.9，夹 60-180）与主进程 / 单测共用
  zoomSize: function (size, delta) { return configCore.zoomSize(size, delta); },
  // A1 文案与名字净化：与主进程 / 单测共用同一份实现（src/core/replies.js）
  onboard: {
    ask: replies.ONBOARD_LINES.ask,
    retry: replies.ONBOARD_LINES.retry,
    decline: replies.ONBOARD_LINES.decline,
    answer: function (name) { return replies.ONBOARD_LINES.answer(name); },
    normaliseName: function (value) { return configCore.normaliseUserName(value); },
  },
  onConfig: function (cb) { return on('config:changed', cb); },
  onProactive: function (cb) { return on('pet:proactive', cb); },
  onWalk: function (cb) { return on('pet:walk', cb); },
  onCursor: function (cb) { return on('pet:cursor', cb); },
  onDeepNight: function (cb) { return on('pet:deep-night', cb); },
  onPause: function (cb) { return on('pet:pause', cb); },
  onBreakTick: function (cb) { return on('break:tick', cb); },
  onPetCommand: function (cb) { return on('pet:command', cb); },
  onWindowShift: function (cb) { return on('pet:window-shift', cb); },
  onShortcuts: function (cb) { return on('shortcuts:changed', cb); },
});
