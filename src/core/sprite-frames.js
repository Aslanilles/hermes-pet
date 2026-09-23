'use strict';

/**
 * oneko 32x32 网格贴图取帧。
 *
 * 纯逻辑模块：禁止 require('electron')，必须能在容器里被 `node --test` 直接跑。
 * SPRITE_SETS 与取帧公式照抄 docs/M0-sprite-map.md（权威参考），不要自行重排索引。
 * 同时兼容 CommonJS 与浏览器 <script> 直连，好让 tools/sprite_preview.html 复用同一张表
 * （避免预览页与运行时各写一份表而发生漂移）。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.hermesSpriteFrames = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 贴图事实（实测）：256x128，8 列 x 4 行，每格 32x32。
  const SPRITE_CELL = 32;
  const SHEET_COLUMNS = 8;
  const SHEET_ROWS = 4;
  const SHEET_WIDTH = SPRITE_CELL * SHEET_COLUMNS;
  const SHEET_HEIGHT = SPRITE_CELL * SHEET_ROWS;

  // 索引表（直接复制自 docs/M0-sprite-map.md，坐标为「负列 / 负行」）
  const SPRITE_SETS = {
    idle: [[-3, -3]],
    alert: [[-7, -3]],
    scratchSelf: [[-5, 0], [-6, 0], [-7, 0]],
    scratchWallN: [[0, 0], [0, -1]],
    scratchWallS: [[-7, -1], [-6, -2]],
    scratchWallE: [[-2, -2], [-2, -3]],
    scratchWallW: [[-4, 0], [-4, -1]],
    tired: [[-3, -2]],
    sleeping: [[-2, 0], [-2, -1]],
    N: [[-1, -2], [-1, -3]],
    NE: [[0, -2], [0, -3]],
    E: [[-3, 0], [-3, -1]],
    SE: [[-5, -1], [-5, -2]],
    S: [[-6, -3], [-7, -2]],
    SW: [[-5, -3], [-6, -1]],
    W: [[-4, -2], [-4, -3]],
    NW: [[-1, 0], [-1, -1]],
  };

  // hermes-pet 状态 -> oneko sprite 组。
  // idle / alert / tired / sleeping / scratchSelf 直接照抄映射表；
  // talk / listen / drag 是 hermes-pet 新增状态，oneko 没有对应组，按「视觉语义」就近借用：
  //   talk   -> alert（竖耳、胡须张开、面向观众 = 正在开口）
  //   listen -> idle （坐定面向观众 = 在听）
  //   drag   -> SE / SW（侧向挣扎 2 帧；拖动时按位移方向选，见 spriteForDrag）
  const STATE_SPRITES = {
    idle: 'idle',
    alert: 'alert',
    tired: 'tired',
    sleeping: 'sleeping',
    scratchSelf: 'scratchSelf',
    talk: 'alert',
    listen: 'idle',
    drag: 'SE',
  };

  const PET_STATES = ['idle', 'alert', 'tired', 'sleeping', 'scratchSelf', 'talk', 'listen', 'drag'];
  const SPRITE_NAMES = Object.keys(SPRITE_SETS);

  function hasSprite(name) {
    return Object.prototype.hasOwnProperty.call(SPRITE_SETS, name);
  }

  function normaliseFrame(frame, length) {
    const n = Number(frame);
    if (!Number.isFinite(n)) return 0;
    const i = Math.trunc(n) % length;
    return i < 0 ? i + length : i;
  }

  /** 取某组的第 frame 帧的网格坐标，返回 [x, y]（负值，原样照抄映射表）。 */
  function spriteAt(name, frame) {
    if (!hasSprite(name)) {
      throw new Error('unknown sprite set: ' + name);
    }
    const set = SPRITE_SETS[name];
    return set[normaliseFrame(frame, set.length)];
  }

  /** 取帧计算：background-position 字符串。负索引直接用乘法，不要换算成正列号。 */
  function spritePosition(name, frame) {
    const cell = spriteAt(name, frame);
    return `${cell[0] * SPRITE_CELL}px ${cell[1] * SPRITE_CELL}px`;
  }

  /** canvas drawImage 用的源矩形（正偏移）。 */
  function spriteRect(name, frame) {
    const cell = spriteAt(name, frame);
    return {
      sx: Math.abs(cell[0]) * SPRITE_CELL,
      sy: Math.abs(cell[1]) * SPRITE_CELL,
      sw: SPRITE_CELL,
      sh: SPRITE_CELL,
    };
  }

  function frameCount(name) {
    if (!hasSprite(name)) {
      throw new Error('unknown sprite set: ' + name);
    }
    return SPRITE_SETS[name].length;
  }

  function spriteForState(state) {
    return STATE_SPRITES[state] || STATE_SPRITES.idle;
  }

  /**
   * drag 的方向变体（第二轮修复：拖向哪边用哪组）。
   * 映射表里 SE / SW 都是 2 帧的侧向挣扎姿态，直接复用，不自创索引。
   */
  function spriteForDrag(direction) {
    return direction === 'W' ? 'SW' : 'SE';
  }

  return {
    SPRITE_CELL,
    SHEET_COLUMNS,
    SHEET_ROWS,
    SHEET_WIDTH,
    SHEET_HEIGHT,
    SPRITE_SETS,
    SPRITE_NAMES,
    STATE_SPRITES,
    PET_STATES,
    hasSprite,
    spriteAt,
    spritePosition,
    spriteRect,
    frameCount,
    spriteForState,
    spriteForDrag,
    normaliseFrame,
  };
});
