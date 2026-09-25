'use strict';

/**
 * A2「偶尔朝光标走一小段」的纯逻辑（禁止 require('electron')，容器里 node --test 直接覆盖）。
 *
 * 产品口径（docs/M1R1-features.md §2，数字照抄，**调频时不许碰**）：
 *   猫「朝光标方向走一小段就停」，不是「跟着光标跑」——永远追不到（距光标 ≤120px 立即停）。
 *   节拍：上次散步结束起 180s 硬冷却，冷却期内**不抽签**；冷却过后每个光标 tick（200ms）
 *   抽签 1/300（0.33%），冷却后期望再等约 60s → 平均 180s + 60s = 240s ≈ 4 分钟一次
 *   ≈ 15 次/小时（验收：「10 分钟内能看到 2-3 次」）。
 *   走速 40px/s（深夜 20）、单次位移 ≤100px、单次持续 ≤3s（先到先停）。
 *
 * 【P0-4 红线】「近 5s 光标累计位移 >120px 就不走」是这一节最漂亮的一条，调频率时不许动它。
 * 全部判定用**注入的 now / random**，墙钟只由调用方喂（容器里可跑 1 小时虚拟时间）。
 */

const { direction8, directionVector } = require('./sprite-frames');

const WALK_COOLDOWN_MS = 180000; // 上次散步结束起 3 分钟硬冷却（冷却期内不抽签）
const WALK_CHANCE = 1 / 300; // 冷却过后每个光标 tick 的抽签概率（0.33%）
const WALK_SPEED_PX_S = 40; // 白天 40px/s
const WALK_SPEED_NIGHT_PX_S = 20; // 深夜 22:00-07:00 减半（深夜不禁止走动，只降频降速）
const WALK_STOP_DIST_PX = 120; // 距光标 ≤120px 立即停（绝不进入 120px 内）
const WALK_MAX_DIST_PX = 100; // 单次位移上限
const WALK_MAX_MS = 3000; // 单次持续上限（与位移先到先停）
const CURSOR_QUIET_MS = 5000; // 「光标安静」的观察窗口：近 5s 累计位移
const CURSOR_QUIET_PX = 120; // 累计位移 >120px = 高频操作 = 禁止散步
const WALK_STEP_MS = 100; // 主进程 walkTimer 的步进节拍（100ms 一步）
const WALK_GATE_TICK_MS = 200; // 光标 tick 的节拍（抽签频率）
const WALK_SETTLE_MS = 2000; // 拖拽结束后 2s 内不走（与 scheduler.DRAG_SETTLE_MS 一致）

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoint(value) {
  const point = value || {};
  return {
    x: isFiniteNumber(point.x) ? point.x : 0,
    y: isFiniteNumber(point.y) ? point.y : 0,
  };
}

/**
 * 光标近 windowMs 内的累计位移（像素，DIP）。trail = [{ t, x, y }, ...] 升序。
 * 只统计「首尾都在窗口内」的相邻点对，避免把跨越窗口的一次大跳算进来。
 */
function cursorTravel(trail, now, options) {
  const opts = options || {};
  const windowMs = isFiniteNumber(opts.windowMs) ? opts.windowMs : CURSOR_QUIET_MS;
  const at = isFiniteNumber(now) ? now : 0;
  if (!Array.isArray(trail) || trail.length < 2) return 0;
  let travel = 0;
  for (let i = 1; i < trail.length; i += 1) {
    const prev = trail[i - 1];
    const cur = trail[i];
    if (!prev || !cur) continue;
    if (!isFiniteNumber(cur.t) || cur.t < at - windowMs || cur.t > at) continue;
    if (!isFiniteNumber(prev.t) || prev.t < at - windowMs || prev.t > at) continue;
    if (!isFiniteNumber(prev.x) || !isFiniteNumber(prev.y) || !isFiniteNumber(cur.x) || !isFiniteNumber(cur.y)) continue;
    travel += Math.hypot(cur.x - prev.x, cur.y - prev.y);
  }
  return travel;
}

/** 光标「安静」= 近 5s 累计位移 ≤120px。用户连续工作时（甩鼠标）为 false。 */
function isCursorQuiet(trail, now, options) {
  const opts = options || {};
  const limit = isFiniteNumber(opts.limitPx) ? opts.limitPx : CURSOR_QUIET_PX;
  return cursorTravel(trail, now, opts) <= limit;
}

/**
 * 「现在禁止走动吗」——四类禁止态保留不动（features §2）：
 *   ① 对话中 / 打字中；② 拖拽中 + 拖后 2s；③ 打盹/睡觉（state 不是 idle|alert）、别烦我（dnd）、暂停（paused）；
 *   ④ 高频操作（光标近 5s 累计位移 >120px）。另有 hidden / quiet（A13 静默）。
 * 返回 null（可以走）或原因字符串（禁止）。
 */
function walkBlockReason(options) {
  const o = options || {};
  const now = isFiniteNumber(o.now) ? o.now : 0;
  if (o.hidden) return 'hidden';
  if (o.paused) return 'paused';
  if (o.dnd) return 'dnd';
  if (o.quiet) return 'quiet';
  if (o.dialogueOpen || o.typing) return 'busy-dialogue';
  if (o.dragging) return 'dragging';
  if (isFiniteNumber(o.dragEndedAt) && now - o.dragEndedAt < WALK_SETTLE_MS) return 'drag-settle';
  if (o.cursorQuiet === false) return 'cursor-busy';
  if (o.state && o.state !== 'idle' && o.state !== 'alert') return 'state-' + o.state;
  return null;
}

/**
 * 该不该「想走一次」。冷却期内**不消费随机数**（顺序写死，方便用固定种子复现）。
 * options = { now, lastWalkAt, cursorQuiet, state, random, paused, dnd, quiet, hidden,
 *             dialogueOpen, typing, dragging, dragEndedAt }
 */
function shouldStartWalk(options) {
  const o = options || {};
  const now = isFiniteNumber(o.now) ? o.now : 0;
  if (walkBlockReason(o)) return false;
  if (isFiniteNumber(o.lastWalkAt) && now - o.lastWalkAt < WALK_COOLDOWN_MS) return false;
  const random = typeof o.random === 'function' ? o.random : Math.random;
  return random() < WALK_CHANCE;
}

/**
 * 走一小步。返回 { dir, dx, dy, done, reason }：done=true 表示这一步之后必须停。
 * 停的四种理由：stop-distance（离光标 ≤120px）/ max-distance（位移到 100px）/ max-time（走了 3s）/ done。
 */
function walkStep(options) {
  const o = options || {};
  const from = readPoint(o.from);
  const cursor = readPoint(o.cursor);
  const offsetX = cursor.x - from.x;
  const offsetY = cursor.y - from.y;
  const dist = Math.hypot(offsetX, offsetY);
  const dir = direction8(offsetX, offsetY);
  const speed = o.deepNight ? WALK_SPEED_NIGHT_PX_S : WALK_SPEED_PX_S;
  // 一步的位移：100ms × 40px/s = 4px（深夜 2px）
  const stepPx = Math.max(1, Math.round(speed * (WALK_STEP_MS / 1000)));
  const traveledPx = isFiniteNumber(o.traveledPx) ? Math.max(0, o.traveledPx) : 0;
  const elapsedMs = isFiniteNumber(o.elapsedMs) ? Math.max(0, o.elapsedMs) : 0;
  const stopped = function (reason) {
    return { dir: dir, dx: 0, dy: 0, done: true, reason: reason, dist: dist };
  };

  // 追不到：再走一步就会进 120px 以内 -> 原地停（不先迈进去再退出来）
  if (dist - stepPx <= WALK_STOP_DIST_PX) return stopped('stop-distance');
  if (elapsedMs + WALK_STEP_MS > WALK_MAX_MS) return stopped('max-time');
  const remaining = WALK_MAX_DIST_PX - traveledPx;
  if (remaining <= 0) return stopped('max-distance');

  const vector = directionVector(dir);
  let length = Math.min(stepPx, remaining);
  let dx = Math.round(vector[0] * length);
  let dy = Math.round(vector[1] * length);
  // 取整后若超出剩余额度（对角线的 1/√2 取整会多出零点几像素），退回按剩余额度取整
  if (Math.hypot(dx, dy) > remaining) {
    dx = Math.round(vector[0] * remaining);
    dy = Math.round(vector[1] * remaining);
  }
  // 极端额度（剩不到 1.5px）：对角取整仍会超支 -> 退化成单轴 1px，绝不把总额度顶出去
  if (Math.hypot(dx, dy) > remaining) {
    if (Math.abs(vector[0]) >= Math.abs(vector[1])) {
      dx = 1;
      dy = 0;
    } else {
      dx = 0;
      dy = 1;
    }
    if (Math.hypot(dx, dy) > remaining) {
      dx = 0;
      dy = 0;
    }
  }
  if (dx === 0 && dy === 0) return stopped('max-distance'); // 额度耗尽（取整后不足 1px）
  const nextTraveled = traveledPx + Math.hypot(dx, dy);
  const done = nextTraveled >= WALK_MAX_DIST_PX;
  return { dir: dir, dx: dx, dy: dy, done: done, reason: done ? 'max-distance' : 'step', dist: dist };
}

/**
 * 固定种子随机数（mulberry32）。测试与 --self-check 共用同一支序列，
 * 保证「1 小时虚拟时间散步次数 ∈ [10,20]」这条断言**确定性可复现**，不会偶发红灯。
 */
function createSeededRandom(seed) {
  let a = (isFiniteNumber(seed) ? Math.floor(seed) : 1) >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 跑虚拟时间，数一小时内散步几次（只走 shouldStartWalk 的抽签路径，不模拟走路本身）。
 * 默认从「冷却已过」开始（lastWalkAt 早于起点一个冷却周期），与真实首启一致。
 */
function simulateWalks(options) {
  const o = options || {};
  const random = typeof o.random === 'function' ? o.random : Math.random;
  const durationMs = isFiniteNumber(o.durationMs) ? o.durationMs : 60 * 60 * 1000;
  const gateMs = isFiniteNumber(o.gateMs) ? o.gateMs : WALK_GATE_TICK_MS;
  const startAt = isFiniteNumber(o.now) ? o.now : 0;
  let lastWalkAt = isFiniteNumber(o.lastWalkAt) ? o.lastWalkAt : startAt - WALK_COOLDOWN_MS;
  const times = [];
  const endAt = startAt + durationMs;
  for (let now = startAt; now <= endAt; now += gateMs) {
    if (shouldStartWalk({ now: now, lastWalkAt: lastWalkAt, cursorQuiet: true, state: 'idle', random: random })) {
      times.push(now);
      lastWalkAt = now;
    }
  }
  return { walks: times.length, times: times, lastWalkAt: lastWalkAt };
}

/** 一小时的散步次数（默认用固定种子 20260925，断言 ∈ [10,20]，均值约 15）。 */
function walksPerHour(seed) {
  return simulateWalks({ random: createSeededRandom(isFiniteNumber(seed) ? seed : 20260925) }).walks;
}

module.exports = {
  WALK_COOLDOWN_MS,
  WALK_CHANCE,
  WALK_SPEED_PX_S,
  WALK_SPEED_NIGHT_PX_S,
  WALK_STOP_DIST_PX,
  WALK_MAX_DIST_PX,
  WALK_MAX_MS,
  CURSOR_QUIET_MS,
  CURSOR_QUIET_PX,
  WALK_STEP_MS,
  WALK_GATE_TICK_MS,
  WALK_SETTLE_MS,
  readPoint,
  cursorTravel,
  isCursorQuiet,
  walkBlockReason,
  shouldStartWalk,
  walkStep,
  createSeededRandom,
  simulateWalks,
  walksPerHour,
};
