'use strict';

/**
 * 窗口位置计算（纯逻辑，禁止 require('electron')，可以在容器里被 node --test 直接覆盖）。
 *
 * 为什么单独抽一层（FIX-ROUND3 FIX-1）：第一轮首启落点写进了 (0,0)。根因是
 * 「没有坐标」被当成了「坐标是 0」——coerceCoord(null) 走 Number(null) 得到 0，
 * 于是 restoreBaseBounds() 以为 state 里有合法坐标，把窗口摆到了屏幕左上角。
 * 这一层把「有没有坐标」和「落在哪」拆成两个显式判断，并且默认路径 / 恢复路径
 * 都要过一遍 clamp，绝不把窗口丢到看不见的地方。
 */

const EDGE_MARGIN = 24; // 默认落点距 workArea 右下角的留白
const MIN_VISIBLE = 48; // 恢复 / 拖拽后至少留多少像素在屏幕里
const SNAP_THRESHOLD = 20; // A6：距屏幕边缘 <=20px 松手即吸附
const SNAP_BREATHE = 4; // A6：吸附后留 4px 呼吸缝（贴边但不贴死）
// A6 多边并列时的优先级，写死：左 > 右 > 上 > 下
const SNAP_PRIORITY = ['left', 'right', 'top', 'bottom'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

/** 读一个坐标：null / undefined / 空串 / 非数字 -> null（「没有坐标」，不是 0）。 */
function readCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * (0,0) 哨兵：上一轮的 bug 会把「窗口还没摆好时的占位值」写进 state.json，
 * 表现为猫蹲在屏幕左上角挡开始菜单。无法判断用户是不是真把猫拖到了那儿，
 * 按任务书要求一律判非法 -> 回默认右下角。
 */
function isOriginSentinel(x, y) {
  return x === 0 && y === 0;
}

/** 允许窗口部分出屏，但至少留 minVisible 像素可见（拖拽 / 恢复位置用）。 */
function clampToArea(bounds, workArea, minVisible) {
  const keep = numberOr(minVisible, MIN_VISIBLE);
  const minX = workArea.x - bounds.width + keep;
  const maxX = workArea.x + workArea.width - keep;
  const minY = workArea.y - bounds.height + keep;
  const maxY = workArea.y + workArea.height - keep;
  return {
    x: Math.round(Math.min(Math.max(bounds.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, minY), maxY)),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

/** 整体收进 workArea（默认落点 / 气泡窗口用，画面一个像素都不许出屏）。 */
function clampFullyInside(rect, workArea) {
  const maxX = workArea.x + Math.max(0, workArea.width - rect.width);
  const maxY = workArea.y + Math.max(0, workArea.height - rect.height);
  return {
    x: Math.round(Math.min(Math.max(rect.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(rect.y, workArea.y), maxY)),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** 默认落点：workArea 右下角，距两条边各留 edgeMargin（1440 宽 / 144 窗口 / 24 -> x = 1272）。 */
function defaultBounds(workArea, size, options) {
  const opts = options || {};
  const margin = numberOr(opts.edgeMargin, EDGE_MARGIN);
  return clampFullyInside(
    {
      x: workArea.x + workArea.width - size.width - margin,
      y: workArea.y + workArea.height - size.height - margin,
      width: size.width,
      height: size.height,
    },
    workArea
  );
}

/**
 * 恢复落点：有合法坐标 -> clamp 后使用；坐标缺失 / 非法 / (0,0) 哨兵 -> 默认右下角。
 * 返回的一定是「可以用」的矩形，调用方不需要再判断。
 */
function restoreBounds(state, workArea, size, options) {
  const opts = options || {};
  const x = readCoord(state && state.x);
  const y = readCoord(state && state.y);
  if (x === null || y === null || isOriginSentinel(x, y)) {
    return defaultBounds(workArea, size, opts);
  }
  return clampToArea({ x: x, y: y, width: size.width, height: size.height }, workArea, opts.minVisible);
}

/**
 * 把「被气泡撑大的窗口」整体收进 workArea，并给出内容需要反向平移的量。
 * shift = 原矩形 - 收进去后的矩形：窗口被推回来多少，渲染进程就把内容反向挪多少，
 * 这样气泡不会被屏幕边缘裁掉，同时猫在屏幕上的位置一动不动。
 */
function fitInside(rect, workArea) {
  const fitted = clampFullyInside(rect, workArea);
  return {
    rect: fitted,
    shift: { x: Math.round(rect.x - fitted.x), y: Math.round(rect.y - fitted.y) },
  };
}

/** 窗口四条边到 workArea 四条边的距离（正数 = 在屏内，负数 = 已经出屏多少）。 */
function edgeDistances(bounds, workArea) {
  return {
    left: bounds.x - workArea.x,
    right: workArea.x + workArea.width - (bounds.x + bounds.width),
    top: bounds.y - workArea.y,
    bottom: workArea.y + workArea.height - (bounds.y + bounds.height),
  };
}

/**
 * A6 边缘吸附（【P0-5】）。
 * 判据写死：窗口四边到 workArea 四边的距离取**最小**；最小距离 <= threshold 就贴该边并留
 * breathe = 4px；并列时优先级 **左 > 右 > 上 > 下**；没贴边就原样返回（idempotent）。
 * 只动命中的那一条边（另一个轴保持不变）——「贴哪条边回哪条边」，不制造二次位移。
 *
 * 注意：调用方必须保证坐标是 **DIP**（逻辑像素），且吸附只在「完整在屏内」的窗口上判
 * （drag-end 顺序 clampFullyInside -> snapToEdge -> clampFullyInside 兜底）。
 * 返回矩形额外带 `edge`（命中的边，未命中为 null），只用于日志 / 自证门。
 */
function snapToEdge(bounds, workArea, threshold, breathe) {
  const limit = isFiniteNumber(threshold) ? threshold : SNAP_THRESHOLD;
  const gap = isFiniteNumber(breathe) ? breathe : SNAP_BREATHE;
  const rect = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
  const dist = edgeDistances(rect, workArea);
  const min = Math.min(dist.left, dist.right, dist.top, dist.bottom);
  if (!(min <= limit)) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, edge: null };
  let edge = SNAP_PRIORITY[0];
  for (let i = 0; i < SNAP_PRIORITY.length; i += 1) {
    const side = SNAP_PRIORITY[i];
    if (Math.abs(dist[side] - min) < 1e-9) {
      edge = side;
      break;
    }
  }
  if (edge === 'left') rect.x = workArea.x + gap;
  else if (edge === 'right') rect.x = workArea.x + workArea.width - rect.width - gap;
  else if (edge === 'top') rect.y = workArea.y + gap;
  else rect.y = workArea.y + workArea.height - rect.height - gap;
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: rect.width, height: rect.height, edge: edge };
}

module.exports = {
  EDGE_MARGIN,
  MIN_VISIBLE,
  SNAP_THRESHOLD,
  SNAP_BREATHE,
  SNAP_PRIORITY,
  isFiniteNumber,
  readCoord,
  isOriginSentinel,
  clampToArea,
  clampFullyInside,
  defaultBounds,
  restoreBounds,
  fitInside,
  edgeDistances,
  snapToEdge,
};
