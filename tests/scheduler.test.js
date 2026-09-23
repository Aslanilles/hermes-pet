'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/core/scheduler');

const MIN = 60 * 1000;

function at(h, m, day) {
  return new Date(2026, 0, day || 15, h, m, 0, 0).getTime();
}

function baseRuntime(now) {
  const rt = S.createRuntime(now);
  return Object.assign({}, rt, { greetedDate: S.dateKey(now) });
}

function plan(now, runtime, extra) {
  return S.plan(Object.assign({ now: now, config: { proactiveEnabled: true }, runtime: runtime, state: 'idle' }, extra || {}));
}

test('每日问候：当天首次启动说一次，说过就不再重复', () => {
  const now = at(9, 0);
  const first = plan(now, S.createRuntime(now));
  assert.equal(first.speak, true);
  assert.equal(first.kind, 'greeting');
  structCheck(first);
  const after = S.recordSpoken(S.createRuntime(now), now, 'greeting');
  const second = plan(now + 1000, after);
  assert.equal(second.speak, false);
  assert.equal(second.kind, null);
  assert.equal(second.reason, 'nothing-due');
});

function structCheck(decision) {
  assert.equal(typeof decision.speak, 'boolean');
  assert.ok(typeof decision.reason === 'string');
  assert.ok(decision.kind === null || typeof decision.kind === 'string');
  assert.ok(decision.action === 'nap' || decision.action === 'none');
}

test('每 2 小时护栏：多个触发源同时到期也只放行一次', () => {
  const now = at(22, 40); // 日落已过 + 未问候 + 会话已 45 分钟
  let rt = S.createRuntime(now);
  rt = Object.assign({}, rt, { sessionStartAt: now - 45 * MIN });
  const first = plan(now, rt);
  assert.equal(first.speak, true);
  assert.equal(first.kind, 'sunset'); // 优先级：日落 > 问候 > 休息提醒
  const afterFirst = S.recordSpoken(rt, now, first.kind);
  // 此刻 greeting / break 两个触发源仍然全部到期
  assert.equal(S.pickTrigger(now, afterFirst), 'greeting');
  const blocked = plan(now + 1000, afterFirst);
  assert.equal(blocked.speak, false);
  assert.equal(blocked.reason, 'cooldown');
  const blocked2 = plan(now + 119 * MIN, afterFirst);
  assert.equal(blocked2.speak, false);
  assert.equal(blocked2.reason, 'cooldown');
  const allowed = plan(now + 120 * MIN, afterFirst);
  assert.equal(allowed.speak, true);
  assert.equal(allowed.kind, 'greeting');
});

test('22:30 数字日落：当天只触发一次，冷却过期也不重复', () => {
  let rt = S.createRuntime(at(22, 30));
  const first = plan(at(22, 30), rt);
  assert.equal(first.kind, 'sunset');
  rt = S.recordSpoken(rt, at(22, 30), 'sunset');
  // 冷却早已过期（上次说话在 19:00），且当天问候也说过；只把会话保持在 10 分钟内，
  // 好让唯一还可能到期的触发源就是「日落」本身 —— 它必须因为当天已触发而保持沉默。
  rt = Object.assign({}, rt, {
    greetedDate: S.dateKey(at(22, 30)),
    lastProactiveAt: at(19, 0),
    sessionStartAt: at(23, 40),
  });
  const again = plan(at(23, 50), rt);
  assert.equal(again.speak, false);
  assert.equal(again.reason, 'nothing-due');
  assert.equal(S.pickTrigger(at(23, 50), rt), null);
});

test('日落之前不触发日落提醒', () => {
  const now = at(22, 29);
  assert.equal(S.pickTrigger(now, baseRuntime(now)), null);
  const later = S.plan({ now: at(22, 30), config: {}, runtime: baseRuntime(at(22, 30)), state: 'idle' });
  assert.equal(later.kind, 'sunset');
});

test('跨天重置：额度、日落标记、忽略记录都不跨天', () => {
  const day1 = at(22, 40, 15);
  const day2 = at(22, 40, 16);
  let rt = S.createRuntime(day1);
  rt = S.recordSpoken(rt, day1, 'sunset');
  rt = S.recordIgnored(rt, day1, 'greeting');
  assert.equal(S.budgetState(day1, rt, {}).countToday, 1);
  assert.equal(S.budgetState(day2, rt, {}).countToday, 0);
  assert.equal(S.isIgnoredToday(rt, S.dateKey(day1), 'greeting'), true);
  assert.equal(S.isIgnoredToday(rt, S.dateKey(day2), 'greeting'), false);
  const next = plan(day2, rt);
  assert.equal(next.speak, true);
  assert.equal(next.kind, 'sunset');
});

test('10 秒无人回应 -> 当天不再重复同一条', () => {
  const now = at(9, 0);
  const rt = S.recordIgnored(S.createRuntime(now), now + S.NO_REPLY_MS, 'greeting');
  const later = plan(now + 3 * 60 * MIN, rt);
  assert.equal(later.speak, false);
  assert.equal(later.kind, 'greeting');
  assert.equal(later.reason, 'ignored-today');
});

test('休息提醒：连续活跃满 40 分钟才触发', () => {
  const now = at(14, 0);
  let rt = baseRuntime(now);
  rt = Object.assign({}, rt, { sessionStartAt: now - 39 * MIN });
  assert.equal(plan(now, rt).kind, null);
  rt = Object.assign({}, rt, { sessionStartAt: now - 40 * MIN });
  assert.equal(plan(now, rt).kind, 'break');
  const spoken = S.recordSpoken(rt, now, 'break');
  assert.equal(spoken.sessionStartAt, now, '说完休息提醒要重开一个会话，避免立刻又来一次');
});

test('交互间隔 >5 分钟算新会话，会话内小间隔不重置', () => {
  const t0 = at(10, 0);
  let rt = S.createRuntime(t0);
  rt = S.markActivity(rt, t0 + 60 * 1000);
  assert.equal(rt.sessionStartAt, t0);
  const resume = t0 + 60 * 1000 + S.SESSION_GAP_MS + 1000;
  rt = S.markActivity(rt, resume);
  assert.equal(rt.sessionStartAt, resume);
  assert.equal(S.activeSessionMs(rt.sessionStartAt, rt), 0);
});

test('打盹：空闲 30 分钟动作标记为 nap（与说话额度无关）', () => {
  const now = at(11, 0);
  const rt = baseRuntime(now);
  assert.equal(plan(now + 29 * MIN, rt, { state: 'idle' }).action, 'none');
  assert.equal(plan(now + 30 * MIN, rt, { state: 'idle' }).action, 'nap');
  assert.equal(plan(now + 40 * MIN, rt, { state: 'sleeping' }).action, 'none');
});

test('对话中 / 打字中绝不插话', () => {
  const now = at(16, 0);
  const talking = S.recordDialogue(S.createRuntime(now), now, true);
  assert.equal(plan(now, talking, { state: 'talk' }).reason, 'busy-dialogue');
  const typing = S.recordTyping(S.recordDialogue(talking, now, false), now, true);
  assert.equal(plan(now, typing, { state: 'listen' }).reason, 'busy-dialogue');
});

test('拖拽中不弹气泡，拖拽结束 2 秒后才允许', () => {
  const now = at(15, 0);
  let rt = S.recordDrag(S.createRuntime(now), now, true);
  assert.equal(plan(now, rt, { state: 'drag' }).reason, 'dragging');
  rt = S.recordDrag(rt, now, false);
  assert.equal(plan(now + 1900, rt).reason, 'drag-settle');
  assert.equal(plan(now + 2000, rt).speak, true);
});

test('关掉主动提醒 / 隐藏窗口 / 暂停 -> 一律闭嘴', () => {
  const now = at(9, 0);
  const rt = S.createRuntime(now);
  assert.equal(plan(now, rt, { config: { proactiveEnabled: false } }).reason, 'disabled');
  assert.equal(plan(now, rt, { hidden: true }).reason, 'hidden');
  assert.equal(plan(now, rt, { paused: true }).reason, 'paused');
});

test('24 小时硬上限（默认 6 次）', () => {
  const now = at(12, 0);
  let rt = S.createRuntime(now);
  rt = Object.assign({}, rt, { dailyCount: 6, dailyCountDate: S.dateKey(now), lastProactiveAt: now - 5 * 60 * MIN });
  const decision = plan(now, rt);
  assert.equal(decision.speak, false);
  assert.equal(decision.reason, 'daily-cap');
});

test('脏数据不炸：runtime 传 null / 数组 / 字符串都能回落', () => {
  const now = at(9, 0);
  [null, [], 'x', 42, undefined].forEach(function (bad) {
    const decision = S.plan({ now: now, config: {}, runtime: bad, state: 'idle' });
    assert.equal(decision.speak, true);
    assert.equal(decision.kind, 'greeting');
  });
});

test('dateKey / sunsetTime 用本地时间，跨天判定正确', () => {
  assert.equal(S.dateKey(at(23, 59)), '2026-01-15');
  assert.equal(S.dateKey(at(0, 1, 16)), '2026-01-16');
  assert.equal(S.sunsetTime(at(9, 0)), at(22, 30));
});

test('墙钟护栏：缺基准（旧 state.json）报 first，正常间隔报 ok', () => {
  const now = at(9, 0);
  const fresh = S.guardTick(now, { lastTickAt: null });
  assert.equal(fresh.reason, 'first');
  assert.equal(fresh.skip, false);
  assert.equal(fresh.runtime.lastTickAt, now);
  const next = S.guardTick(now + 30 * 1000, fresh.runtime);
  assert.equal(next.reason, 'ok');
  assert.equal(next.skip, false);
});

test('墙钟护栏：系统时间回拨 -> 基准归零且当次静默（手改时间不炸）', () => {
  const now = at(12, 0);
  const rt = Object.assign({}, S.createRuntime(now), {
    greetedDate: S.dateKey(now),
    sunsetDate: S.dateKey(now),
    lastProactiveAt: now - 10 * MIN,
    dailyCount: 3,
  });
  const back = at(11, 0); // 往回拨 1 小时
  const guard = S.guardTick(back, rt);
  assert.equal(guard.reason, 'rollback');
  assert.equal(guard.skip, true, '回拨的那一次必须静默，不触发任何行为');
  assert.equal(guard.runtime.lastTickAt, back);
  assert.equal(guard.runtime.lastProactiveAt, back);
  assert.equal(guard.runtime.dailyCount, 0);
  assert.equal(guard.runtime.greetedDate, S.dateKey(back));
  assert.equal(guard.runtime.sunsetDate, S.dateKey(back));
});

test('墙钟护栏：挂起后醒来只判定一次，不补发历史（P1-7）', () => {
  const now = at(9, 0);
  const rt = S.createRuntime(now);
  const woke = at(13, 0); // 合盖 4 小时
  const guard = S.guardTick(woke, rt);
  assert.equal(guard.reason, 'drift');
  assert.equal(guard.skip, false);
  assert.equal(guard.runtime.lastTickAt, woke);
  // 醒来后只放行一次问候；紧接着的第二次判定被 2 小时护栏挡住（不会补发一串气泡）
  const first = plan(woke, guard.runtime);
  assert.equal(first.speak, true);
  assert.equal(first.kind, 'greeting');
  const after = S.recordSpoken(guard.runtime, woke, 'greeting');
  const second = plan(woke + 1000, after);
  assert.equal(second.speak, false);
  assert.equal(second.reason, 'cooldown');
});
