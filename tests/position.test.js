'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/core/position');

// 复验环境事实：宿主屏 1440x900，窗口 = 猫 120 + 四周内边距 24 = 144
const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 };
const SIZE = { width: 144, height: 144 };
const OPTS = { edgeMargin: 24, minVisible: P.MIN_VISIBLE };

test('A6 边缘吸附：四边内侧 10px / 边界 20px 命中并留 4px，21px 不命中', () => {
  const box = function (x, y) {
    return { x: x, y: y, width: SIZE.width, height: SIZE.height };
  };
  assert.equal(P.SNAP_THRESHOLD, 20);
  assert.equal(P.SNAP_BREATHE, 4);
  assert.deepEqual(P.SNAP_PRIORITY, ['left', 'right', 'top', 'bottom']);
  // 四边内侧 10px
  assert.deepEqual(P.snapToEdge(box(10, 300), WORK_AREA), { x: 4, y: 300, width: 144, height: 144, edge: 'left' });
  assert.deepEqual(P.snapToEdge(box(1440 - 144 - 10, 300), WORK_AREA).edge, 'right');
  assert.equal(P.snapToEdge(box(1440 - 144 - 10, 300), WORK_AREA).x, 1440 - 144 - 4);
  assert.equal(P.snapToEdge(box(300, 10), WORK_AREA).edge, 'top');
  assert.equal(P.snapToEdge(box(300, 10), WORK_AREA).y, 4);
  assert.equal(P.snapToEdge(box(300, 900 - 144 - 10), WORK_AREA).edge, 'bottom');
  assert.equal(P.snapToEdge(box(300, 900 - 144 - 10), WORK_AREA).y, 900 - 144 - 4);
  // 边界：正好 20px 命中（含），21px 不命中（原样返回）
  assert.equal(P.snapToEdge(box(1440 - 144 - 20, 300), WORK_AREA).edge, 'right');
  assert.deepEqual(P.snapToEdge(box(1440 - 144 - 21, 300), WORK_AREA), {
    x: 1440 - 144 - 21,
    y: 300,
    width: 144,
    height: 144,
    edge: null,
  });
  // 阈值可覆盖
  assert.equal(P.snapToEdge(box(30, 300), WORK_AREA, 30).edge, 'left');
  assert.equal(P.snapToEdge(box(30, 300), WORK_AREA, 10).edge, null);
});

test('A6 吸附边界情形：已出屏 96px / 窗口比 workArea 大 / 多屏偏移 / 并列优先级 / 幂等', () => {
  const box = function (x, y, w, h) {
    return { x: x, y: y, width: w || SIZE.width, height: h || SIZE.height };
  };
  // 已出屏 96px：距离为负，照样吸附回屏内
  const off = P.snapToEdge(box(1440 - 144 + 96, 300), WORK_AREA);
  assert.equal(off.edge, 'right');
  assert.equal(off.x, 1440 - 144 - 4);
  // 窗口比 workArea 还大：仍贴最小距离那条边，不许算出 NaN
  const huge = P.snapToEdge(box(0, 0, 2000, 1200), WORK_AREA);
  assert.equal(huge.edge, 'right');
  assert.equal(huge.width, 2000);
  assert.ok(Number.isFinite(huge.x) && Number.isFinite(huge.y));
  // 多屏：workArea 带偏移，按 workArea 原点算，不写死 0
  const second = { x: -1024, y: 0, width: 1024, height: 768 };
  const shifted = P.snapToEdge(box(-1024 + 10, 200), second);
  assert.equal(shifted.edge, 'left');
  assert.equal(shifted.x, -1024 + 4);
  // 并列优先级 左 > 右 > 上 > 下：左上角同时贴左和上 -> 选左，且只动命中的那条边
  const corner = P.snapToEdge(box(0, 0), WORK_AREA);
  assert.equal(corner.edge, 'left');
  assert.equal(corner.x, 4);
  assert.equal(corner.y, 0);
  // 幂等：吸附过的矩形再吸附一次不动
  const once = P.snapToEdge(box(10, 300), WORK_AREA);
  assert.deepEqual(P.snapToEdge(once, WORK_AREA), once);
  // edgeDistances 正负号：屏内为正
  assert.deepEqual(P.edgeDistances(box(20, 30), WORK_AREA), {
    left: 20,
    right: 1440 - 20 - 144,
    top: 30,
    bottom: 900 - 30 - 144,
  });
});

test('首启（state 里没有合法坐标）落在 workArea 右下角：1440-144-24 / 900-144-24', () => {
  const expected = { x: 1272, y: 732, width: 144, height: 144 };
  assert.deepEqual(P.defaultBounds(WORK_AREA, SIZE, { edgeMargin: 24 }), expected);
  assert.deepEqual(P.restoreBounds({ x: null, y: null }, WORK_AREA, SIZE, OPTS), expected);
});

test('坐标缺失 / 非法 / (0,0) 哨兵一律回默认右下角，绝不落在左上角', () => {
  const expected = P.defaultBounds(WORK_AREA, SIZE, { edgeMargin: 24 });
  const cases = [
    {},
    { x: undefined, y: undefined },
    { x: null, y: 0 },
    { x: 0, y: null },
    { x: 'abc', y: 12 },
    { x: 12, y: NaN },
    { x: '', y: 8 },
  ];
  cases.forEach(function (state) {
    const restored = P.restoreBounds(state, WORK_AREA, SIZE, OPTS);
    assert.deepEqual(restored, expected, 'state = ' + JSON.stringify(state) + ' 时应回默认右下角');
  });
  // (0,0)：上一轮 bug 的典型产物，无法判断是不是用户拖过去的 -> 一律判非法
  assert.equal(P.isOriginSentinel(0, 0), true);
  assert.deepEqual(P.restoreBounds({ x: 0, y: 0 }, WORK_AREA, SIZE, OPTS), expected);
  assert.deepEqual(P.restoreBounds({ x: '0', y: '0' }, WORK_AREA, SIZE, OPTS), expected);
  // 而 (0, 8) / (8, 0) 不是哨兵，属于「用户真放在边上」，照常恢复
  assert.equal(P.restoreBounds({ x: 0, y: 8 }, WORK_AREA, SIZE, OPTS).x, 0);
  assert.equal(P.restoreBounds({ x: 8, y: 0 }, WORK_AREA, SIZE, OPTS).y, 0);
});

test('合法坐标原样恢复（只做四舍五入）', () => {
  const restored = P.restoreBounds({ x: 1272.4, y: 731.6 }, WORK_AREA, SIZE, OPTS);
  assert.deepEqual(restored, { x: 1272, y: 732, width: 144, height: 144 });
});

test('超出 workArea 的坐标 clamp 回可见区（至少 MIN_VISIBLE 像素留在屏内）', () => {
  const right = P.restoreBounds({ x: 5000, y: 5000 }, WORK_AREA, SIZE, OPTS);
  assert.equal(right.x, WORK_AREA.width - P.MIN_VISIBLE);
  assert.equal(right.y, WORK_AREA.height - P.MIN_VISIBLE);
  const left = P.restoreBounds({ x: -5000, y: -5000 }, WORK_AREA, SIZE, OPTS);
  assert.equal(left.x, -SIZE.width + P.MIN_VISIBLE);
  assert.equal(left.y, -SIZE.height + P.MIN_VISIBLE);
  // 默认落点只要放得下就整体在 workArea 内，一个像素都不越界
  const roomy = P.defaultBounds({ x: 0, y: 0, width: 1280, height: 800 }, SIZE, { edgeMargin: 24 });
  assert.ok(roomy.x >= 0 && roomy.x + roomy.width <= 1280, JSON.stringify(roomy));
  assert.ok(roomy.y >= 0 && roomy.y + roomy.height <= 800, JSON.stringify(roomy));
  // 屏幕比窗口还小时只会往回缩到原点，不会算出负坐标（负坐标就是「跑到屏幕外面去」）
  const tiny = P.defaultBounds({ x: 0, y: 0, width: 200, height: 120 }, SIZE, { edgeMargin: 24 });
  assert.ok(tiny.x >= 0 && tiny.y >= 0, JSON.stringify(tiny));
});

test('多屏 / workArea 带偏移时按 workArea 原点算，不写死 0', () => {
  const second = { x: -1024, y: 0, width: 1024, height: 768 };
  const bounds = P.defaultBounds(second, SIZE, { edgeMargin: 24 });
  assert.deepEqual(bounds, { x: -1024 + 1024 - 144 - 24, y: 768 - 144 - 24, width: 144, height: 144 });
  const restored = P.restoreBounds({ x: 9000, y: 9000 }, second, SIZE, OPTS);
  assert.equal(restored.x, second.x + second.width - P.MIN_VISIBLE);
  assert.equal(restored.y, second.y + second.height - P.MIN_VISIBLE);
});

test('fitInside：气泡窗口整体收进 workArea，shift 正好是内容要反向平移的量', () => {
  // 猫贴屏幕右边缘 + 气泡把窗口撑宽 -> 窗口右侧会出屏
  const wide = P.fitInside({ x: 1350, y: 100, width: 344, height: 500 }, WORK_AREA);
  assert.deepEqual(wide.rect, { x: 1096, y: 100, width: 344, height: 500 });
  assert.deepEqual(wide.shift, { x: 254, y: 0 });
  // 窗口内的相对位置 + shift = 原来的屏幕位置（猫在屏幕上不动）
  assert.equal(wide.rect.x + wide.shift.x, 1350);

  const tall = P.fitInside({ x: 20, y: -200, width: 344, height: 500 }, WORK_AREA);
  assert.deepEqual(tall.rect, { x: 20, y: 0, width: 344, height: 500 });
  assert.deepEqual(tall.shift, { x: 0, y: -200 });
  assert.equal(tall.rect.y + tall.shift.y, -200);

  // 完全放得下时不许动
  const inside = P.fitInside({ x: 100, y: 100, width: 344, height: 500 }, WORK_AREA);
  assert.deepEqual(inside.rect, { x: 100, y: 100, width: 344, height: 500 });
  assert.deepEqual(inside.shift, { x: 0, y: 0 });
});
