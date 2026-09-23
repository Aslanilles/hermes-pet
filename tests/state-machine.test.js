'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStateMachine, DEFAULT_TIMING } = require('../src/core/state-machine');

function machine(options) {
  return createStateMachine(Object.assign({ random: function () { return 0.99; } }, options || {}));
}

test('初始为 idle，单帧组不会被动画节拍改帧', () => {
  const sm = machine();
  assert.equal(sm.state, 'idle');
  assert.deepEqual(sm.pose(), { state: 'idle', sprite: 'idle', frame: 0, frames: 1 });
  sm.tick(5000);
  assert.deepEqual(sm.pose(), { state: 'idle', sprite: 'idle', frame: 0, frames: 1 });
});

test('空闲 30 分钟进 tired，再过几秒睡着；被点击唤醒到 talk', () => {
  const sm = machine();
  sm.tick(DEFAULT_TIMING.idleToTiredMs - 1);
  assert.equal(sm.state, 'idle');
  sm.tick(1);
  assert.equal(sm.state, 'tired');
  assert.equal(sm.pose().sprite, 'tired');
  sm.tick(DEFAULT_TIMING.tiredToSleepingMs);
  assert.equal(sm.state, 'sleeping');
  assert.equal(sm.pose().sprite, 'sleeping');
  const result = sm.send('click');
  assert.equal(result.changed, true);
  assert.equal(result.prev, 'sleeping');
  assert.equal(sm.state, 'talk');
  assert.equal(sm.pose().sprite, 'alert');
});

test('说话中被用户打断 -> 立刻让位切 listen', () => {
  const sm = machine();
  assert.equal(sm.send('click').state, 'talk');
  assert.equal(sm.send('interrupt').state, 'listen');
  assert.equal(sm.pose().sprite, 'idle');
  assert.equal(sm.send('speak').state, 'talk');
  assert.equal(sm.send('typing:start').state, 'listen');
  assert.equal(sm.send('typing:end').state, 'idle');
});

test('被打断时不切错状态：非 talk 状态收到 interrupt 不动', () => {
  const sm = machine();
  const result = sm.send('interrupt');
  assert.equal(result.changed, false);
  assert.equal(sm.state, 'idle');
});

test('拖拽：drag:start -> drag（侧向 2 帧交替）-> drag:end 回 idle', () => {
  const sm = machine();
  assert.equal(sm.send('drag:start').state, 'drag');
  assert.equal(sm.pose().sprite, 'SE');
  assert.equal(sm.pose().frames, 2);
  sm.tick(DEFAULT_TIMING.dragCadenceMs);
  assert.equal(sm.pose().frame, 1);
  assert.equal(sm.send('click').state, 'drag', '拖拽中点击不应打断拖拽');
  assert.equal(sm.send('drag:end').state, 'idle');
});

test('抓痒动作播完自动回 idle', () => {
  const sm = machine();
  assert.equal(sm.send('scratch').state, 'scratchSelf');
  sm.tick(DEFAULT_TIMING.scratchSelfMs - 1);
  assert.equal(sm.state, 'scratchSelf');
  sm.tick(1);
  assert.equal(sm.state, 'idle');
});

test('睡觉时被活动叫醒；mouse:near 不吵醒睡着的猫', () => {
  const sm = machine();
  sm.send('sleep');
  assert.equal(sm.state, 'sleeping');
  const sleeping = machine();
  sleeping.tick(DEFAULT_TIMING.idleToTiredMs);
  sleeping.tick(DEFAULT_TIMING.tiredToSleepingMs);
  assert.equal(sleeping.state, 'sleeping');
  assert.equal(sleeping.send('mouse:near').state, 'sleeping');
  assert.equal(sleeping.send('activity').state, 'idle');
});

test('未知事件是空操作，不抛错也不改变状态', () => {
  const sm = machine();
  const result = sm.send('teleport');
  assert.equal(result.changed, false);
  assert.equal(result.known, false);
  assert.equal(sm.state, 'idle');
});

test('白名单拒绝越界迁移：sleeping 不能直接变 scratchSelf', () => {
  const sm = machine();
  sm.tick(DEFAULT_TIMING.idleToTiredMs);
  sm.tick(DEFAULT_TIMING.tiredToSleepingMs);
  assert.equal(sm.state, 'sleeping');
  assert.equal(sm.allowedTransitions().indexOf('scratchSelf'), -1);
});

test('idle 够久后随机触发小动作（注入 random 保证可测）', () => {
  const sm = createStateMachine({ random: function () { return 0; } });
  sm.tick(DEFAULT_TIMING.microActionAfterIdleMs + 10);
  assert.ok(sm.state === 'sleeping' || sm.state === 'scratchSelf');
  assert.equal(sm.state, 'sleeping');
});

test('状态历史可回溯（调试用）', () => {
  const sm = machine();
  sm.send('click');
  sm.send('interrupt');
  assert.deepEqual(sm.history, ['talk', 'listen']);
});

test('打盹 nap 只由用户交互唤醒；假睡 micro 自己醒（P0-3b）', () => {
  const nap = machine();
  nap.send('nap:start');
  assert.equal(nap.state, 'tired');
  nap.tick(DEFAULT_TIMING.tiredToSleepingMs + 10);
  assert.equal(nap.state, 'sleeping');
  assert.equal(nap.sleepKind, 'nap');
  nap.tick(60 * 60 * 1000); // 睡一小时：任何计时器都不许自动退出打盹
  assert.equal(nap.state, 'sleeping');
  assert.equal(nap.sleepKind, 'nap');
  assert.equal(nap.send('click').state, 'talk'); // 被点击唤醒

  const micro = createStateMachine({ random: function () { return 0; } });
  micro.tick(DEFAULT_TIMING.microActionAfterIdleMs + 10);
  assert.equal(micro.state, 'sleeping');
  assert.equal(micro.sleepKind, 'micro');
  micro.tick(DEFAULT_TIMING.microSleepMs); // 假睡约 6.4 秒自己醒
  assert.equal(micro.state, 'idle');

  // 主动行为到点：先唤醒再开口（禁止「睡着的猫在说话」）
  const proactive = machine();
  proactive.send('nap:start');
  proactive.tick(DEFAULT_TIMING.tiredToSleepingMs + 10);
  assert.equal(proactive.state, 'sleeping');
  proactive.send('activity');
  assert.equal(proactive.state, 'idle');
  proactive.send('speak');
  assert.equal(proactive.state, 'talk');
});

test('drag 按位移方向取 SE / SW，松手回到拖之前的状态（P0-3c）', () => {
  const sm = machine();
  sm.send('click');
  assert.equal(sm.state, 'talk');
  sm.send('drag:start');
  assert.equal(sm.state, 'drag');
  assert.equal(sm.pose().sprite, 'SE');
  sm.send('drag:dir', 'W');
  assert.equal(sm.pose().sprite, 'SW');
  assert.equal(sm.dragDir, 'W');
  sm.send('drag:dir', 'E');
  assert.equal(sm.pose().sprite, 'SE');
  assert.equal(sm.pose().frames, 2);
  sm.send('drag:end');
  assert.equal(sm.state, 'talk'); // 对话中的猫被拖一下不丢对话
  assert.equal(sm.dragDir, null);

  const plain = machine();
  plain.send('drag:start');
  plain.send('drag:end');
  assert.equal(plain.state, 'idle');
});

test('发消息等回复期间切 listen', () => {
  const sm = machine();
  sm.send('click');
  assert.equal(sm.state, 'talk');
  sm.send('sending');
  assert.equal(sm.state, 'listen');
});
