'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/core/window-guards');

test('【P0-1】watchdogAction 16 组合穷举：dnd=true 一律 force-ignore，dnd 缺省/false 时 M0 结论一条不变', () => {
  const byKey = {};
  [false, true].forEach(function (dnd) {
    [false, true].forEach(function (lastInteractive) {
      [false, true].forEach(function (isDestroyed) {
        [false, true].forEach(function (visible) {
          byKey[[dnd, lastInteractive, isDestroyed, visible].join(',')] = G.watchdogAction({
            dnd: dnd,
            lastInteractive: lastInteractive,
            isDestroyed: isDestroyed,
            visible: visible,
          });
        });
      });
    });
  });
  assert.equal(Object.keys(byKey).length, 16);
  Object.keys(byKey).forEach(function (key) {
    const parts = key.split(',');
    const dnd = parts[0] === 'true';
    const lastInteractive = parts[1] === 'true';
    const isDestroyed = parts[2] === 'true';
    const visible = parts[3] === 'true';
    let expected = 'noop';
    if (!isDestroyed && visible) {
      expected = dnd || !lastInteractive ? 'force-ignore' : 'noop';
    }
    assert.equal(byKey[key], expected, 'dnd,lastInteractive,isDestroyed,visible = ' + key);
  });
  // 重点（A5）：鼠标正压在猫身上时开「别烦我」，也必须强开穿透
  assert.equal(byKey['true,true,false,true'], 'force-ignore');
  // dnd 不是绕过「窗口不存在 / 不可见」的理由
  assert.equal(byKey['true,false,true,true'], 'noop');
  assert.equal(byKey['true,false,false,false'], 'noop');
  // dnd 缺省 / false：M0 的 8 组合逐条复述
  const m0 = {
    'false,false,false,true': 'force-ignore',
    'false,true,false,true': 'noop',
    'false,false,true,true': 'noop',
    'false,false,false,false': 'noop',
    'false,true,false,false': 'noop',
    'false,true,true,true': 'noop',
    'false,true,true,false': 'noop',
    'false,false,true,false': 'noop',
  };
  Object.keys(m0).forEach(function (key) {
    assert.equal(byKey[key], m0[key], key);
  });
  // 键缺省 / 真值非布尔：一律按「没有开 dnd」处理
  assert.equal(G.watchdogAction({ lastInteractive: true, isDestroyed: false, visible: true }), 'noop');
  assert.equal(G.watchdogAction({ dnd: 'yes', lastInteractive: true, isDestroyed: false, visible: true }), 'noop');
  assert.equal(G.watchdogAction({ dnd: false, lastInteractive: false, isDestroyed: false, visible: true }), 'force-ignore');
});

test('看门狗常数与 docs/M0-recon-github-pet.md §6 对齐（5000ms / 2000ms / pop-up-menu）', () => {
  assert.equal(G.TOPMOST_WATCHDOG_MS, 5000);
  assert.equal(G.IGNORE_WATCHDOG_MS, 2000);
  assert.equal(G.TOPMOST_LEVEL, 'pop-up-menu');
});

test('shouldReassertTopmost：四种取值组合（只有「存在+可见+未暂停」才重断言）', () => {
  // ① 存在 + 可见 + 未暂停 -> 动手
  assert.equal(G.shouldReassertTopmost({ isDestroyed: false, isVisible: true, paused: false }), true);
  // ② 已销毁 -> 不动手
  assert.equal(G.shouldReassertTopmost({ isDestroyed: true, isVisible: true, paused: false }), false);
  // ③ 不可见 -> 不动手
  assert.equal(G.shouldReassertTopmost({ isDestroyed: false, isVisible: false, paused: false }), false);
  // ④ 暂停 -> 不动手（否则「暂停」这个逃生口形同虚设）
  assert.equal(G.shouldReassertTopmost({ isDestroyed: false, isVisible: true, paused: true }), false);
});

test('shouldReassertTopmost：8 种布尔组合穷举，只有全绿组合为 true', () => {
  const combos = [];
  [false, true].forEach(function (isDestroyed) {
    [false, true].forEach(function (isVisible) {
      [false, true].forEach(function (paused) {
        combos.push({ isDestroyed: isDestroyed, isVisible: isVisible, paused: paused });
      });
    });
  });
  assert.equal(combos.length, 8);
  combos.forEach(function (combo) {
    const expected = combo.isDestroyed === false && combo.isVisible === true && combo.paused === false;
    assert.equal(G.shouldReassertTopmost(combo), expected, JSON.stringify(combo));
  });
});

test('shouldReassertTopmost：缺参 / 空对象一律 false，不抛异常', () => {
  assert.equal(G.shouldReassertTopmost(), false);
  assert.equal(G.shouldReassertTopmost({}), false);
  assert.equal(G.shouldReassertTopmost(null), false);
});

test('watchdogAction：8 种布尔组合穷举，只有「未销毁+可见+最近没命中」才 force-ignore', () => {
  const byKey = {};
  [false, true].forEach(function (lastInteractive) {
    [false, true].forEach(function (isDestroyed) {
      [false, true].forEach(function (visible) {
        const action = G.watchdogAction({
          lastInteractive: lastInteractive,
          isDestroyed: isDestroyed,
          visible: visible,
        });
        byKey[[lastInteractive, isDestroyed, visible].join(',')] = action;
      });
    });
  });
  assert.equal(Object.keys(byKey).length, 8);
  assert.equal(byKey['false,false,true'], 'force-ignore');
  // 重点：命中了交互元素时绝不能强行重开穿透，否则点猫会失效
  assert.equal(byKey['true,false,true'], 'noop');
  [
    'false,false,false',
    'false,true,true',
    'false,true,false',
    'true,false,false',
    'true,true,true',
    'true,true,false',
  ].forEach(function (key) {
    assert.equal(byKey[key], 'noop', key);
  });
  Object.keys(byKey).forEach(function (key) {
    assert.ok(byKey[key] === 'force-ignore' || byKey[key] === 'noop', byKey[key]);
  });
});

test('watchdogAction：缺参 / 空对象 / 真值 lastInteractive 一律 noop，绝不误关穿透', () => {
  assert.equal(G.watchdogAction(), 'noop');
  assert.equal(G.watchdogAction({}), 'noop');
  assert.equal(G.watchdogAction(null), 'noop');
  // IPC 传来的命中状态即使是 1 / '1' 这样的真值，也必须当成「命中」处理
  assert.equal(G.watchdogAction({ lastInteractive: 1, isDestroyed: false, visible: true }), 'noop');
  assert.equal(G.watchdogAction({ lastInteractive: '1', isDestroyed: false, visible: true }), 'noop');
  // 未上报命中状态（undefined）按「没命中」兜底重开穿透
  assert.equal(G.watchdogAction({ isDestroyed: false, visible: true }), 'force-ignore');
});
