'use strict';

/**
 * 桌宠状态机（纯逻辑，禁止 require('electron')）。
 * 状态：idle / alert / tired / sleeping / scratchSelf / talk / listen / drag / walk / look
 * 只负责「状态 + 帧 + 计时」，不碰 DOM、不碰 IPC。
 */

const {
  PET_STATES,
  DIRECTIONS,
  DIRECTION_DEFAULT,
  spriteForState,
  spriteForDrag,
  spriteForWalk,
  spriteForLook,
  frameCount,
} = require('./sprite-frames');

// 计时参数：量级对齐 oneko 原版节拍（见 docs/M0-sprite-map.md 第 4 节）
const DEFAULT_TIMING = {
  idleToTiredMs: 30 * 60 * 1000, // 空闲 30 分钟 -> 打盹
  tiredToSleepingMs: 3000, // tired 先显示约 3 秒再睡
  scratchSelfMs: 1000, // 抓痒/洗脸播 10 帧（oneko 10 tick ~= 1s）
  talkTimeoutMs: 120 * 1000, // 兜底：气泡都没了 2 分钟还没收到事件就回 idle
  microActionAfterIdleMs: 1000, // idleTime > 10 帧（约 1s）之后才可能触发小动作
  microActionChance: 1 / 600, // 每 tick 概率；30fps 下约每 20 秒一次机会（对齐 oneko 1/200 @10fps）
  frameCadenceMs: 100, // 多帧状态的基础换帧间隔
  sleepingCadenceMs: 400, // 睡觉换帧更慢
  dragCadenceMs: 150,
  walkCadenceMs: 250, // A2：白天 250ms 换帧（≈4fps，8 方向走帧每组 2 帧交替）
  walkCadenceNightMs: 500, // 深夜减半（≈2fps），与「深夜不禁止走动、只降频降速」一致
  // oneko 式「小动作假睡」会自动复位（192 帧 @30fps 约 6.4s）；30 分钟打盹（nap）绝不自动退出。
  microSleepMs: 6400,
};

// 状态 -> 允许迁移到的状态（显式白名单，越界即拒绝）
const ALLOWED = {
  idle: ['alert', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'idle', 'walk', 'look'],
  alert: ['idle', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'alert', 'walk', 'look'],
  tired: ['idle', 'alert', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'tired'],
  sleeping: ['idle', 'tired', 'alert', 'talk', 'listen', 'drag', 'sleeping'],
  scratchSelf: ['idle', 'alert', 'talk', 'listen', 'drag', 'scratchSelf'],
  talk: ['idle', 'listen', 'alert', 'drag', 'talk'],
  listen: ['idle', 'talk', 'alert', 'drag', 'listen'],
  drag: ['idle', 'alert', 'talk', 'listen', 'drag', 'walk', 'look'],
  // 【P1-1】walk / look 补用户交互出口：用户主动（click / drag:start …）永远优先，
  // 所以这两个状态必须能走到 talk / listen / drag，而不是「困在走路里」。
  walk: ['idle', 'talk', 'listen', 'drag', 'walk', 'look'],
  look: ['idle', 'talk', 'listen', 'drag', 'walk', 'look'],
};

// 事件 -> 目标状态（null 表示该事件在当前状态无副作用）
const EVENT_TARGETS = {
  'mouse:near': (state) => (state === 'sleeping' ? null : 'alert'),
  'mouse:far': (state) => (state === 'alert' ? 'idle' : null),
  click: (state) => (state === 'drag' ? null : 'talk'), // 单击猫 = 叫醒/开口（打盹、睡觉被点都走这里）
  dblclick: (state) => (state === 'drag' ? null : 'talk'), // 双击开设置面板，本体先切 talk
  'typing:start': (state) => (state === 'drag' ? null : 'listen'),
  'typing:end': (state) => (state === 'listen' ? 'idle' : null),
  sending: (state) => (state === 'drag' ? null : 'listen'), // 发出消息、等回复期间：切 listen
  speak: () => 'talk', // 收到回复 / 主动说话
  interrupt: (state) => (state === 'talk' ? 'listen' : null), // 说话被打断 -> 让位给用户
  'dialogue:close': () => 'idle',
  activity: (state) => (state === 'sleeping' || state === 'tired' ? 'idle' : null),
  'nap:start': (state) => (state === 'idle' ? 'tired' : null),
  sleep: (state) => (state === 'idle' || state === 'tired' ? 'sleeping' : null),
  scratch: (state) => (state === 'idle' || state === 'tired' ? 'scratchSelf' : null),
  'drag:start': () => 'drag',
  // 第二轮 P0-3c：拖完回到拖之前的状态（对话中的猫被拖一下不能丢对话）
  'drag:end': (state, ctx) => (state === 'drag' ? ctx.resume : null),
  // M1 A2 / A3：走动与悬停（8 向）。walk:step 只更新方向、不换状态。
  'walk:start': (state) => (state === 'idle' || state === 'alert' ? 'walk' : null),
  'walk:step': (state) => (state === 'walk' ? 'walk' : null),
  'walk:end': (state) => (state === 'walk' ? 'idle' : null),
  'look:start': (state) => (state === 'idle' || state === 'alert' ? 'look' : null),
  'look:end': (state) => (state === 'look' ? 'idle' : null),
};

// 【P1-1】收到这些「用户主动」事件时先隐式 walk:end（走动中点猫 -> talk、走动中 drag:start -> drag）。
// 也就是 A13 的反向边界：用户召唤永远优先于猫自己的小动作。
const WALK_INTERRUPT_EVENTS = ['click', 'dblclick', 'typing:start', 'sending', 'speak', 'interrupt', 'drag:start'];

function normaliseDirection(value) {
  return DIRECTIONS.indexOf(value) >= 0 ? value : null;
}

function cadenceFor(state, timing, deepNight) {
  if (state === 'sleeping') return timing.sleepingCadenceMs;
  if (state === 'drag') return timing.dragCadenceMs;
  if (state === 'walk') return deepNight ? timing.walkCadenceNightMs : timing.walkCadenceMs;
  return timing.frameCadenceMs;
}

function createStateMachine(options) {
  const opts = options || {};
  const timing = Object.assign({}, DEFAULT_TIMING, opts.timing || {});
  const random = typeof opts.random === 'function' ? opts.random : Math.random;

  let state = PET_STATES.indexOf(opts.initial) >= 0 ? opts.initial : 'idle';
  let stateElapsedMs = 0;
  let idleElapsedMs = 0;
  let sleepKind = null; // 'nap'（30 分钟打盹，只由用户交互唤醒）| 'micro'（假睡，会自己醒）
  let pendingSleepKind = null;
  let dragDir = null; // drag 的方向：'E'（向右）/ 'W'（向左），由渲染进程按位移喂进来
  let walkDir = null; // walk 的 8 向之一（N/NE/E/...），由主进程按「猫中心 -> 目标」喂进来
  let gazeDir = null; // look 的 8 向之一（猫中心 -> 光标），与 walk 共用一批方向组
  let deepNight = Boolean(opts.deepNight); // 深夜只影响 walk 的换帧节拍（降频不禁止）
  let resumeState = null; // drag:start 之前的状态，mouseup 之后恢复
  let history = [];

  function allowed(next) {
    return (ALLOWED[state] || []).indexOf(next) >= 0;
  }

  function enter(next) {
    if (!allowed(next)) return false;
    if (next === 'drag') resumeState = state;
    state = next;
    if (next === 'walk' && !walkDir) walkDir = DIRECTION_DEFAULT;
    if (next === 'look' && !gazeDir) gazeDir = DIRECTION_DEFAULT;
    if (next === 'sleeping') {
      sleepKind = pendingSleepKind || 'nap';
    }
    pendingSleepKind = null;
    stateElapsedMs = 0;
    history.push(next);
    if (history.length > 32) history = history.slice(-32);
    if (next !== 'idle') idleElapsedMs = 0;
    if (next !== 'drag') {
      dragDir = null;
      resumeState = null;
    }
    if (next !== 'walk') walkDir = null;
    if (next !== 'look') gazeDir = null;
    return true;
  }

  /** drag:end 的目标：优先回到拖之前那个状态，白名单不允许就回 idle。 */
  function resumeTarget() {
    return resumeState && (ALLOWED.drag || []).indexOf(resumeState) >= 0 ? resumeState : 'idle';
  }

  function touch() {
    idleElapsedMs = 0;
  }

  function send(event, payload) {
    const prev = state;
    // 拖拽方向不是状态迁移，只是把方向喂给取帧（drag 用 SE / SW 两组）
    if (event === 'drag:dir') {
      dragDir = payload === 'W' ? 'W' : 'E';
      return { prev: prev, state: state, changed: false, known: true };
    }
    const map = EVENT_TARGETS[event];
    if (typeof map !== 'function') {
      return { prev: prev, state: state, changed: false, known: false };
    }
    // 【P1-1】用户主动事件先隐式 walk:end：走动中点击/拖拽/说话立即让位，不困在走路里。
    if (state === 'walk' && WALK_INTERRUPT_EVENTS.indexOf(event) >= 0) {
      enter('idle');
    }
    if (event === 'sleep' || event === 'nap:start') {
      pendingSleepKind = 'nap'; // 30 分钟打盹：只有用户交互能唤醒
    }
    const next = map(state, { resume: resumeTarget() });
    // walk / look 的方向同样不是迁移，只是喂给取帧（walk 中再喂一次仍然是 walk）：
    // **事件被接受时**才记方向 —— 被白名单拒绝的 walk:start 不许偷偷留下脏 walkDir。
    if (next === 'walk' && (event === 'walk:start' || event === 'walk:step')) {
      const dir = normaliseDirection(payload);
      if (dir) walkDir = dir;
    }
    if (next === 'look' && event === 'look:start') {
      const dir = normaliseDirection(payload);
      if (dir) gazeDir = dir;
    }
    if (next && next !== state && enter(next)) {
      return { prev: prev, state: state, changed: true, known: true };
    }
    if (event === 'click' || event === 'dblclick' || event === 'speak' || event === 'activity') {
      touch();
    }
    return { prev: prev, state: state, changed: false, known: true };
  }

  function tick(dtMs) {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    stateElapsedMs += dt;
    if (state === 'idle') {
      idleElapsedMs += dt;
    }

    if (state === 'idle' && idleElapsedMs >= timing.idleToTiredMs) {
      enter('tired');
      return;
    }
    if (state === 'tired' && stateElapsedMs >= timing.tiredToSleepingMs) {
      enter('sleeping');
      return;
    }
    if (state === 'scratchSelf' && stateElapsedMs >= timing.scratchSelfMs) {
      enter('idle');
      return;
    }
    if (state === 'talk' && stateElapsedMs >= timing.talkTimeoutMs) {
      enter('idle');
      return;
    }
    if (state === 'sleeping' && sleepKind === 'micro' && stateElapsedMs >= timing.microSleepMs) {
      enter('idle'); // 假睡自己醒
      return;
    }

    // oneko 式小动作：idle 够久之后每 tick 一次机会，随机在 睡觉 / 抓痒 里挑一个
    if (state === 'idle' && idleElapsedMs > timing.microActionAfterIdleMs && random() < timing.microActionChance) {
      if (random() < 0.5) {
        pendingSleepKind = 'micro';
        enter('sleeping');
      } else {
        enter('scratchSelf');
      }
    }
  }

  function pose() {
    let sprite;
    if (state === 'drag') sprite = spriteForDrag(dragDir);
    else if (state === 'walk') sprite = spriteForWalk(walkDir);
    else if (state === 'look') sprite = spriteForLook(gazeDir);
    else sprite = spriteForState(state);
    const frames = frameCount(sprite);
    // look 是**单帧**：只取走帧的第一帧，不跟着节拍交替（A3「看向光标」是一个定格的姿势）
    if (state === 'look') return { state: state, sprite: sprite, frame: 0, frames: frames };
    const cadence = cadenceFor(state, timing, deepNight);
    const frame = frames > 1 ? Math.floor(stateElapsedMs / cadence) % frames : 0;
    return { state: state, sprite: sprite, frame: frame, frames: frames };
  }

  return {
    get state() {
      return state;
    },
    get stateElapsedMs() {
      return stateElapsedMs;
    },
    get idleElapsedMs() {
      return idleElapsedMs;
    },
    get history() {
      return history.slice();
    },
    get sleepKind() {
      return sleepKind;
    },
    get dragDir() {
      return dragDir;
    },
    get walkDir() {
      return walkDir;
    },
    get gazeDir() {
      return gazeDir;
    },
    timing: timing,
    send: send,
    tick: tick,
    touch: touch,
    pose: pose,
    // 深夜只影响 walk 换帧节拍（250ms -> 500ms）；由渲染进程在 deep-night 广播时同步
    setDeepNight: function (value) {
      deepNight = Boolean(value);
    },
    allowedTransitions: function () {
      return (ALLOWED[state] || []).slice();
    },
  };
}

module.exports = {
  DEFAULT_TIMING,
  ALLOWED,
  EVENT_TARGETS,
  WALK_INTERRUPT_EVENTS,
  cadenceFor,
  createStateMachine,
};
