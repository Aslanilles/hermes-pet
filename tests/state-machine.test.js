'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStateMachine, DEFAULT_TIMING, ALLOWED, WALK_INTERRUPT_EVENTS, cadenceFor } = require('../src/core/state-machine');

function machine(options) {
  return createStateMachine(Object.assign({ random: function () { return 0.99; } }, options || {}));
}

test('A2 walk：只从 idle|alert 起走；walk:step 只更新方向；walk:end 回 idle', () => {
  const sm = machine();
  assert.equal(sm.send('walk:start', 'E').state, 'walk');
  assert.equal(sm.walkDir, 'E');
  assert.equal(sm.pose().sprite, 'E');
  assert.equal(sm.pose().frames, 2);
  sm.send('walk:step', 'NE');
  assert.equal(sm.state, 'walk', 'walk:step 不是状态迁移');
  assert.equal(sm.walkDir, 'NE');
  assert.equal(sm.pose().sprite, 'NE');
  assert.equal(sm.send('walk:end').state, 'idle');
  assert.equal(sm.walkDir, null);
  // 睡着的猫不会被「猫自己」叫起来走；打盹中同理
  const sleeping = machine();
  sleeping.send('sleep');
  assert.equal(sleeping.send('walk:start', 'E').state, 'sleeping');
  assert.equal(sleeping.walkDir, null);
  // 非法方向不改已有方向（这里默认回落 S）
  const plain = machine();
  plain.send('walk:start', 'E');
  plain.send('walk:step', 'X');
  assert.equal(plain.walkDir, 'E');
});

test('A2/A13 用户主动优先：走动中 click -> talk、drag:start -> drag（隐式 walk:end）', () => {
  const clicked = machine();
  clicked.send('walk:start', 'E');
  const result = clicked.send('click');
  assert.equal(result.changed, true);
  assert.equal(result.prev, 'walk');
  assert.equal(clicked.state, 'talk');
  assert.equal(clicked.walkDir, null);

  const dragged = machine();
  dragged.send('walk:start', 'S');
  assert.equal(dragged.send('drag:start').state, 'drag');
  // 拖完不许「回到走动」：走路是一次性的小动作
  assert.equal(dragged.send('drag:end').state, 'idle');

  const typed = machine();
  typed.send('walk:start', 'S');
  assert.equal(typed.send('typing:start').state, 'listen');
  assert.deepEqual(WALK_INTERRUPT_EVENTS, ['click', 'dblclick', 'typing:start', 'sending', 'speak', 'interrupt', 'drag:start']);
});

test('A3 look：单帧定格（不跟节拍换帧）+ look:end 回 idle', () => {
  const sm = machine();
  sm.send('look:start', 'NW');
  assert.equal(sm.state, 'look');
  assert.equal(sm.gazeDir, 'NW');
  assert.deepEqual(sm.pose(), { state: 'look', sprite: 'NW', frame: 0, frames: 2 });
  sm.tick(1000);
  sm.tick(5000);
  assert.deepEqual(sm.pose(), { state: 'look', sprite: 'NW', frame: 0, frames: 2 }, 'look 永远是第 0 帧');
  assert.equal(sm.send('look:end').state, 'idle');
  assert.equal(sm.gazeDir, null);
});

test('A13 深夜：walk 换帧节拍 250ms -> 500ms（只影响 walk，别的状态不动）', () => {
  assert.equal(DEFAULT_TIMING.walkCadenceMs, 250);
  assert.equal(DEFAULT_TIMING.walkCadenceNightMs, 500);
  assert.equal(cadenceFor('walk', DEFAULT_TIMING, false), 250);
  assert.equal(cadenceFor('walk', DEFAULT_TIMING, true), 500);
  assert.equal(cadenceFor('drag', DEFAULT_TIMING, true), DEFAULT_TIMING.dragCadenceMs);
  assert.equal(cadenceFor('sleeping', DEFAULT_TIMING, true), DEFAULT_TIMING.sleepingCadenceMs);

  const day = machine();
  day.send('walk:start', 'E');
  day.tick(250);
  assert.equal(day.pose().frame, 1);

  const night = machine();
  night.setDeepNight(true);
  night.send('walk:start', 'E');
  night.tick(250);
  assert.equal(night.pose().frame, 0, '深夜 250ms 还不够换帧');
  night.tick(250);
  assert.equal(night.pose().frame, 1);
  night.setDeepNight(false);
  assert.equal(night.pose().frame, 0, '关掉深夜：节拍回到 250ms，500ms 已经是第 2 帧的起点');
});

test('白名单只增不减：M0 的每条迁移都还在，walk/look 只多了用户交互出口', () => {
  // M0 快照（逐条写死；要删条目必须显式改这里，防止 M1 顺手改烂）
  const m0 = {
    idle: ['alert', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'idle'],
    alert: ['idle', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'alert'],
    tired: ['idle', 'alert', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'tired'],
    sleeping: ['idle', 'tired', 'alert', 'talk', 'listen', 'drag', 'sleeping'],
    scratchSelf: ['idle', 'alert', 'talk', 'listen', 'drag', 'scratchSelf'],
    talk: ['idle', 'listen', 'alert', 'drag', 'talk'],
    listen: ['idle', 'talk', 'alert', 'drag', 'listen'],
    drag: ['idle', 'alert', 'talk', 'listen', 'drag'],
  };
  Object.keys(m0).forEach(function (state) {
    m0[state].forEach(function (target) {
      assert.ok(ALLOWED[state].indexOf(target) >= 0, state + ' -> ' + target + ' 被删掉了');
    });
  });
  ['idle', 'talk', 'listen', 'drag', 'walk', 'look'].forEach(function (target) {
    assert.ok(ALLOWED.walk.indexOf(target) >= 0, 'walk -> ' + target);
    assert.ok(ALLOWED.look.indexOf(target) >= 0, 'look -> ' + target);
  });
  assert.ok(ALLOWED.idle.indexOf('walk') >= 0 && ALLOWED.idle.indexOf('look') >= 0);
  assert.ok(ALLOWED.drag.indexOf('walk') >= 0 && ALLOWED.drag.indexOf('look') >= 0);
});

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
