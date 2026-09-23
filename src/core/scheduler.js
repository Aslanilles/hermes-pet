'use strict';

/**
 * 主动行为调度（纯逻辑，禁止 require('electron')）。
 *
 * 命门在这一个函数里：所有触发源（问候 / 打盹 / 休息提醒 / 数字日落）都只是「候选」，
 * 频率护栏（每 2 小时 <= 1 次、24 小时硬上限、当天被忽略过的不再提、拖拽/对话中不插话）
 * 一律在 plan() 里集中判定，任何触发源都绕不过去。
 */

const PROACTIVE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 主动说话整体上限：每 2 小时 1 次
const MAX_PROACTIVE_PER_DAY = 6; // 24 小时硬上限（含问候 + 休息提醒）
const NAP_AFTER_IDLE_MS = 30 * 60 * 1000; // 空闲 >=30 分钟打盹
const ACTIVE_BREAK_MS = 40 * 60 * 1000; // 连续活跃 >=40 分钟提醒休息
const SESSION_GAP_MS = 5 * 60 * 1000; // 交互间隔 >5 分钟视为新会话
const DRAG_SETTLE_MS = 2000; // 拖拽结束 2 秒后才允许弹气泡
const NO_REPLY_MS = 10 * 1000; // 用户 10 秒不回应 -> 气泡自行消失
const DRIFT_MS = 2 * 60 * 1000; // 距上次 tick 超过 2 分钟 = 刚从睡眠/挂起中醒来
const SUNSET_HOUR = 22;
const SUNSET_MINUTE = 30;

const TRIGGERS = ['sunset', 'greeting', 'break'];

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** 本地日期键 YYYY-MM-DD（跨天重置全靠它）。 */
function dateKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sameDay(a, b) {
  return Boolean(a) && a === b;
}

function sunsetTime(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), SUNSET_HOUR, SUNSET_MINUTE, 0, 0).getTime();
}

function createRuntime(now) {
  const base = Number.isFinite(now) ? now : Date.now();
  return {
    lastActivityAt: base,
    sessionStartAt: base,
    lastTickAt: base,
    lastProactiveAt: null,
    lastProactiveKind: null,
    dailyCount: 0,
    dailyCountDate: dateKey(base),
    greetedDate: null,
    sunsetDate: null,
    ignoredDate: null,
    ignoredKinds: [],
    dragging: false,
    dragEndedAt: null,
    dialogueOpen: false,
    typing: false,
  };
}

function normaliseRuntime(runtime, now) {
  const base = createRuntime(now);
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return base;
  const merged = Object.assign(base, runtime);
  if (!Array.isArray(merged.ignoredKinds)) merged.ignoredKinds = [];
  return merged;
}

/**
 * 每个 tick 先过这里：只用**墙钟**判定，绝不累计计时。
 *
 * - 时间**回拨**（now < lastTickAt，用户手改系统时间）→ 所有基准归零并**静默**，这一个 tick 不做任何行为；
 * - 长时间挂起后醒来（now - lastTickAt > 2 分钟）→ 只做**一次**「现在该不该说」的判定，不补发历史；
 * - 正常 tick → 继续。
 *
 * 返回值：{ runtime, skip, reason }，reason ∈ first | ok | drift | rollback。
 */
function guardTick(now, runtime) {
  const rt = normaliseRuntime(runtime, now);
  if (!Number.isFinite(rt.lastTickAt)) {
    return { runtime: Object.assign({}, rt, { lastTickAt: now }), skip: false, reason: 'first' };
  }
  if (now < rt.lastTickAt) {
    const day = dateKey(now);
    return {
      runtime: Object.assign({}, rt, {
        lastTickAt: now,
        lastActivityAt: now,
        sessionStartAt: now,
        lastProactiveAt: now,
        greetedDate: day,
        sunsetDate: day,
        ignoredDate: day,
        ignoredKinds: [],
        dailyCount: 0,
        dailyCountDate: day,
      }),
      skip: true,
      reason: 'rollback',
    };
  }
  const gap = now - rt.lastTickAt;
  return {
    runtime: Object.assign({}, rt, { lastTickAt: now }),
    skip: false,
    reason: gap > DRIFT_MS ? 'drift' : 'ok',
  };
}

/** 记录一次用户交互：间隔超过 5 分钟算新会话。 */
function markActivity(runtime, now) {
  const rt = normaliseRuntime(runtime, now);
  const gap = Number.isFinite(rt.lastActivityAt) ? now - rt.lastActivityAt : Number.POSITIVE_INFINITY;
  const sessionStartAt = gap > SESSION_GAP_MS || !Number.isFinite(rt.sessionStartAt) ? now : rt.sessionStartAt;
  return Object.assign({}, rt, { lastActivityAt: now, sessionStartAt: sessionStartAt });
}

function activeSessionMs(now, runtime) {
  if (!Number.isFinite(runtime.sessionStartAt)) return 0;
  return Math.max(0, now - runtime.sessionStartAt);
}

function idleMs(now, runtime) {
  if (!Number.isFinite(runtime.lastActivityAt)) return 0;
  return Math.max(0, now - runtime.lastActivityAt);
}

function budgetState(now, runtime, config) {
  const maxPerDay = Number.isFinite(config.maxProactivePerDay) && config.maxProactivePerDay > 0
    ? Math.floor(config.maxProactivePerDay)
    : MAX_PROACTIVE_PER_DAY;
  const day = dateKey(now);
  const countToday = sameDay(runtime.dailyCountDate, day) ? Math.max(0, runtime.dailyCount || 0) : 0;
  const sinceLast = Number.isFinite(runtime.lastProactiveAt) ? now - runtime.lastProactiveAt : Number.POSITIVE_INFINITY;
  return {
    day: day,
    countToday: countToday,
    maxPerDay: maxPerDay,
    cooldownOk: sinceLast >= PROACTIVE_COOLDOWN_MS,
    remainingCooldownMs: Math.max(0, PROACTIVE_COOLDOWN_MS - sinceLast),
    dailyOk: countToday < maxPerDay,
  };
}

function isIgnoredToday(runtime, day, kind) {
  return sameDay(runtime.ignoredDate, day) && runtime.ignoredKinds.indexOf(kind) >= 0;
}

/** 选出当下「到期」的候选触发源（优先级：数字日落 > 每日问候 > 休息提醒）。 */
function pickTrigger(now, runtime) {
  const day = dateKey(now);
  if (!sameDay(runtime.sunsetDate, day) && now >= sunsetTime(now)) return 'sunset';
  if (!sameDay(runtime.greetedDate, day)) return 'greeting';
  if (activeSessionMs(now, runtime) >= ACTIVE_BREAK_MS) return 'break';
  return null;
}

function napAction(now, runtime, state) {
  if (idleMs(now, runtime) < NAP_AFTER_IDLE_MS) return 'none';
  if (state === undefined || state === null || state === 'idle' || state === 'alert') return 'nap';
  return 'none';
}

/**
 * 唯一的决策入口。
 * ctx = { now, config, runtime, state, paused, hidden }
 * -> { speak, kind, reason, action }
 */
function plan(ctx) {
  const context = ctx || {};
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const config = context.config || {};
  const runtime = normaliseRuntime(context.runtime, now);
  const action = napAction(now, runtime, context.state);
  const day = dateKey(now);

  function silent(reason, kind) {
    return { speak: false, kind: kind || null, reason: reason, action: action };
  }

  if (config.proactiveEnabled === false) return silent('disabled');
  if (context.paused) return silent('paused');
  if (context.hidden) return silent('hidden');
  if (runtime.dragging) return silent('dragging');
  if (Number.isFinite(runtime.dragEndedAt) && now - runtime.dragEndedAt < DRAG_SETTLE_MS) return silent('drag-settle');
  if (runtime.dialogueOpen || runtime.typing) return silent('busy-dialogue');

  const kind = pickTrigger(now, runtime);
  if (!kind) return silent('nothing-due');
  if (isIgnoredToday(runtime, day, kind)) return silent('ignored-today', kind);

  const budget = budgetState(now, runtime, config);
  if (!budget.cooldownOk) return silent('cooldown', kind);
  if (!budget.dailyOk) return silent('daily-cap', kind);

  return { speak: true, kind: kind, reason: 'ok', action: action, budget: budget };
}

/** 说了话 -> 记账（护栏的全部状态都写在这里）。 */
function recordSpoken(runtime, now, kind) {
  const rt = normaliseRuntime(runtime, now);
  const day = dateKey(now);
  const countToday = sameDay(rt.dailyCountDate, day) ? Math.max(0, rt.dailyCount || 0) + 1 : 1;
  return Object.assign({}, rt, {
    lastProactiveAt: now,
    lastProactiveKind: kind || null,
    dailyCount: countToday,
    dailyCountDate: day,
    greetedDate: kind === 'greeting' ? day : rt.greetedDate,
    sunsetDate: kind === 'sunset' ? day : rt.sunsetDate,
    sessionStartAt: kind === 'break' ? now : rt.sessionStartAt,
  });
}

/** 没回应 -> 当天不再重复同一条。 */
function recordIgnored(runtime, now, kind) {
  const rt = normaliseRuntime(runtime, now);
  const day = dateKey(now);
  const kinds = sameDay(rt.ignoredDate, day) ? rt.ignoredKinds.slice() : [];
  if (kind && kinds.indexOf(kind) < 0) kinds.push(kind);
  return Object.assign({}, rt, { ignoredDate: day, ignoredKinds: kinds });
}

function recordDialogue(runtime, now, open) {
  const rt = normaliseRuntime(runtime, now);
  return Object.assign({}, rt, { dialogueOpen: Boolean(open), typing: open ? rt.typing : false });
}

function recordTyping(runtime, now, typing) {
  const rt = normaliseRuntime(runtime, now);
  return Object.assign({}, rt, { typing: Boolean(typing) });
}

function recordDrag(runtime, now, dragging) {
  const rt = normaliseRuntime(runtime, now);
  return Object.assign({}, rt, {
    dragging: Boolean(dragging),
    dragEndedAt: dragging ? null : now,
  });
}

module.exports = {
  PROACTIVE_COOLDOWN_MS,
  MAX_PROACTIVE_PER_DAY,
  NAP_AFTER_IDLE_MS,
  ACTIVE_BREAK_MS,
  SESSION_GAP_MS,
  DRAG_SETTLE_MS,
  NO_REPLY_MS,
  DRIFT_MS,
  SUNSET_HOUR,
  SUNSET_MINUTE,
  TRIGGERS,
  dateKey,
  sameDay,
  sunsetTime,
  createRuntime,
  normaliseRuntime,
  guardTick,
  markActivity,
  activeSessionMs,
  idleMs,
  budgetState,
  isIgnoredToday,
  pickTrigger,
  plan,
  recordSpoken,
  recordIgnored,
  recordDialogue,
  recordTyping,
  recordDrag,
};
