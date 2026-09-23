'use strict';

/**
 * 桌宠状态机（纯逻辑，禁止 require('electron')）。
 * 状态：idle / alert / tired / sleeping / scratchSelf / talk / listen / drag
 * 只负责「状态 + 帧 + 计时」，不碰 DOM、不碰 IPC。
 */

const { PET_STATES, spriteForState, spriteForDrag, frameCount } = require('./sprite-frames');

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
  // oneko 式「小动作假睡」会自动复位（192 帧 @30fps 约 6.4s）；30 分钟打盹（nap）绝不自动退出。
  microSleepMs: 6400,
};

// 状态 -> 允许迁移到的状态（显式白名单，越界即拒绝）
const ALLOWED = {
  idle: ['alert', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'idle'],
  alert: ['idle', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'alert'],
  tired: ['idle', 'alert', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag', 'tired'],
  sleeping: ['idle', 'tired', 'alert', 'talk', 'listen', 'drag', 'sleeping'],
  scratchSelf: ['idle', 'alert', 'talk', 'listen', 'drag', 'scratchSelf'],
  talk: ['idle', 'listen', 'alert', 'drag', 'talk'],
  listen: ['idle', 'talk', 'alert', 'drag', 'listen'],
  drag: ['idle', 'alert', 'talk', 'listen', 'drag'],
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
};

function cadenceFor(state, timing) {
  if (state === 'sleeping') return timing.sleepingCadenceMs;
  if (state === 'drag') return timing.dragCadenceMs;
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
  let resumeState = null; // drag:start 之前的状态，mouseup 之后恢复
  let history = [];

  function allowed(next) {
    return (ALLOWED[state] || []).indexOf(next) >= 0;
  }

  function enter(next) {
    if (!allowed(next)) return false;
    if (next === 'drag') resumeState = state;
    state = next;
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
    if (event === 'sleep' || event === 'nap:start') {
      pendingSleepKind = 'nap'; // 30 分钟打盹：只有用户交互能唤醒
    }
    const next = map(state, { resume: resumeTarget() });
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
    const sprite = state === 'drag' ? spriteForDrag(dragDir) : spriteForState(state);
    const frames = frameCount(sprite);
    const cadence = cadenceFor(state, timing);
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
    timing: timing,
    send: send,
    tick: tick,
    touch: touch,
    pose: pose,
    allowedTransitions: function () {
      return (ALLOWED[state] || []).slice();
    },
  };
}

module.exports = {
  DEFAULT_TIMING,
  ALLOWED,
  EVENT_TARGETS,
  createStateMachine,
};
