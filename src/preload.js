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

const machine = createStateMachine({});

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
  },
  spritePosition: function (name, frame) { return spriteFrames.spritePosition(name, frame); },
  spriteSets: function () { return JSON.parse(JSON.stringify(spriteFrames.SPRITE_SETS)); },
  onConfig: function (cb) { return on('config:changed', cb); },
  onProactive: function (cb) { return on('pet:proactive', cb); },
  onCursor: function (cb) { return on('pet:cursor', cb); },
  onDeepNight: function (cb) { return on('pet:deep-night', cb); },
  onPause: function (cb) { return on('pet:pause', cb); },
  onBreakTick: function (cb) { return on('break:tick', cb); },
  onPetCommand: function (cb) { return on('pet:command', cb); },
});
