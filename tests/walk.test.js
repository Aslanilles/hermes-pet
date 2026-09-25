'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/core/walk');

const CURSOR = { x: 1000, y: 0 };

test('常数与 docs/M1R1-features.md §2 逐字一致（调频时不许碰这几条红线）', () => {
  assert.equal(W.WALK_COOLDOWN_MS, 180000); // 上次散步结束起 3 分钟硬冷却
  assert.equal(W.WALK_CHANCE, 1 / 300); // 冷却过后每个光标 tick 抽签 0.33%
  assert.equal(W.WALK_SPEED_PX_S, 40);
  assert.equal(W.WALK_SPEED_NIGHT_PX_S, 20);
  assert.equal(W.WALK_STOP_DIST_PX, 120);
  assert.equal(W.WALK_MAX_DIST_PX, 100);
  assert.equal(W.WALK_MAX_MS, 3000);
  assert.equal(W.CURSOR_QUIET_MS, 5000);
  assert.equal(W.CURSOR_QUIET_PX, 120);
  // 100ms 步进 × 40px/s = 4px/步
  assert.equal(Math.round((W.WALK_SPEED_PX_S * W.WALK_STEP_MS) / 1000), 4);
});

test('1 小时虚拟时间散步次数 ∈ [10,20]：**固定种子**注入确定随机序列（不靠真随机碰运气）', () => {
  const count = W.walksPerHour(20260925);
  assert.ok(count >= 10 && count <= 20, '固定种子下应落在 [10,20]，实际 ' + count);
  // 确定性：同一颗种子跑两次必须一模一样（否则就是偶发红灯的来源）
  assert.equal(W.walksPerHour(20260925), count);
  const again = W.simulateWalks({ random: W.createSeededRandom(20260925) });
  assert.equal(again.walks, count);
  // 序列本身也要确定性（头几次散步的时刻逐字相同）
  assert.deepEqual(again.times, W.simulateWalks({ random: W.createSeededRandom(20260925) }).times);
  // 均值约 15 次/小时 = 平均 4 分钟一次，与「10 分钟内 2-3 次」自洽
  const average = [1, 2, 3, 4, 5, 6, 7, 8].reduce(function (sum, seed) {
    return sum + W.walksPerHour(seed);
  }, 0) / 8;
  assert.ok(average > 12 && average < 18, '多种子均值应在 15 附近，实际 ' + average);
});

test('冷却期内**不抽签**（随机数一次都不许消费）', () => {
  let draws = 0;
  const random = function () {
    draws += 1;
    return 0; // 抽签必中
  };
  // 刚好在冷却期内：不抽签、不走
  assert.equal(
    W.shouldStartWalk({ now: 100000, lastWalkAt: 100000 - W.WALK_COOLDOWN_MS + 1, cursorQuiet: true, state: 'idle', random: random }),
    false
  );
  assert.equal(draws, 0, '冷却期内消费随机数 = 节拍会漂');
  // 冷却刚过：抽签并命中
  assert.equal(
    W.shouldStartWalk({ now: 100000, lastWalkAt: 100000 - W.WALK_COOLDOWN_MS, cursorQuiet: true, state: 'idle', random: random }),
    true
  );
  assert.equal(draws, 1);
  // 第一次走完：lastWalkAt = now，再抽签直接被冷却挡住
  assert.equal(
    W.shouldStartWalk({ now: 100000, lastWalkAt: 100000, cursorQuiet: true, state: 'idle', random: random }),
    false
  );
  assert.equal(draws, 1);
});

test('光标安静规则：近 5s 累计位移 <=120px 才算安静（红线，不许碰）', () => {
  const trail = [
    { t: 0, x: 0, y: 0 },
    { t: 1000, x: 60, y: 0 },
    { t: 2000, x: 120, y: 0 },
  ];
  assert.equal(W.cursorTravel(trail, 2000), 120);
  assert.equal(W.isCursorQuiet(trail, 2000), true); // 正好 120 -> 安静
  assert.equal(W.isCursorQuiet(trail, 2000, { limitPx: 119 }), false); // 119 -> 不安静
  const busy = trail.concat([{ t: 2100, x: 200, y: 0 }]);
  assert.equal(W.cursorTravel(busy, 2100), 200);
  assert.equal(W.isCursorQuiet(busy, 2100), false);
  // 窗口外的旧轨迹要滚出去：6 秒前那一段不算
  assert.equal(W.cursorTravel(trail, 8000), 0);
  assert.equal(W.isCursorQuiet(trail, 8000), true);
  // 脏数据不炸
  assert.equal(W.cursorTravel(null, 0), 0);
  assert.equal(W.cursorTravel([{ t: 0, x: 0, y: 0 }], 0), 0);
  assert.equal(W.isCursorQuiet(undefined, 0), true);
});

test('四类禁止态保留不动：对话/拖拽(+拖后 2s)/打盹睡觉+dnd+暂停/高频操作', () => {
  const allowed = { now: 1000000, lastWalkAt: 0, cursorQuiet: true, state: 'idle' };
  const random = function () { return 0; };
  assert.equal(W.shouldStartWalk(Object.assign({}, allowed, { random: random })), true);
  const blocked = [
    ['dialogueOpen', { dialogueOpen: true }, 'busy-dialogue'],
    ['typing', { typing: true }, 'busy-dialogue'],
    ['dragging', { dragging: true }, 'dragging'],
    ['drag-settle', { dragEndedAt: 1000000 - 1900 }, 'drag-settle'],
    ['dnd', { dnd: true }, 'dnd'],
    ['paused', { paused: true }, 'paused'],
    ['quiet', { quiet: true }, 'quiet'],
    ['hidden', { hidden: true }, 'hidden'],
    ['sleeping', { state: 'sleeping' }, 'state-sleeping'],
    ['tired（打盹）', { state: 'tired' }, 'state-tired'],
    ['cursor-busy', { cursorQuiet: false }, 'cursor-busy'],
  ];
  blocked.forEach(function (entry) {
    const options = Object.assign({}, allowed, entry[1], { random: random });
    assert.equal(W.walkBlockReason(options), entry[2], entry[0]);
    assert.equal(W.shouldStartWalk(options), false, entry[0]);
  });
  // 拖后 2s 一到就放行（先到先判）
  assert.equal(W.walkBlockReason(Object.assign({}, allowed, { dragEndedAt: 1000000 - 2000 })), null);
  // alert 状态可以走（只从 idle / alert 起步）
  assert.equal(W.shouldStartWalk(Object.assign({}, allowed, { state: 'alert', random: random })), true);
});

test('walkStep：白天 4px/步、深夜 2px/步；方向按 8 向量化', () => {
  const day = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 400, y: 0 } });
  assert.deepEqual([day.dir, day.dx, day.dy, day.done, day.reason], ['E', 4, 0, false, 'step']);
  const night = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 400, y: 0 }, deepNight: true });
  assert.deepEqual([night.dx, night.dy], [2, 0]);
  const diagonal = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 400, y: 400 } });
  assert.equal(diagonal.dir, 'SE');
  assert.equal(diagonal.dx, 3);
  assert.equal(diagonal.dy, 3);
  const up = W.walkStep({ from: { x: 0, y: 400 }, cursor: { x: 0, y: 0 } });
  assert.equal(up.dir, 'N');
  assert.equal(up.dy, -4);
});

test('追不到：距光标 <=120px 立即停，绝不进入 120px 以内', () => {
  // 124px：再走一步（4px）就会进 120 以内 -> 原地停
  const near = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 124, y: 0 } });
  assert.deepEqual([near.dx, near.dy, near.done, near.reason], [0, 0, true, 'stop-distance']);
  const exact = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 120, y: 0 } });
  assert.equal(exact.reason, 'stop-distance');
  // 125px：还能走一步到 121px（仍然 >120）
  const step = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 125, y: 0 } });
  assert.equal(step.dx, 4);
  assert.equal(125 - step.dx > W.WALK_STOP_DIST_PX, true);
});

test('单次上限：位移 <=100px、持续 <=3s，先到先停；整段走完都满足约束', () => {
  // 时长先到：2950ms 再走一步就超 3000ms
  const late = W.walkStep({ from: { x: 0, y: 0 }, cursor: CURSOR, elapsedMs: 2950 });
  assert.deepEqual([late.dx, late.dy, late.done, late.reason], [0, 0, true, 'max-time']);
  // 位移先到：已走 96px，再走一步正好 100 -> 这一步算完就停
  const last = W.walkStep({ from: { x: 0, y: 0 }, cursor: CURSOR, traveledPx: 96 });
  assert.deepEqual([last.dx, last.done, last.reason], [4, true, 'max-distance']);
  assert.equal(last.dx, 100 - 96);
  // 已经走满 100px 就不许再动
  const full = W.walkStep({ from: { x: 0, y: 0 }, cursor: CURSOR, traveledPx: 100 });
  assert.deepEqual([full.dx, full.dy, full.done, full.reason], [0, 0, true, 'max-distance']);
  // 对角线的取整不能把总额度顶出去
  const diagRest = W.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 500, y: 500 }, traveledPx: 99 });
  assert.ok(Math.hypot(diagRest.dx, diagRest.dy) <= 1, JSON.stringify(diagRest));

  // 整段模拟：从 (0,0) 朝 (1000,0) 走，直到停
  let from = { x: 0, y: 0 };
  let traveled = 0;
  let elapsed = 0;
  let steps = 0;
  for (;;) {
    const step = W.walkStep({ from: from, cursor: CURSOR, dir: 'E', traveledPx: traveled, elapsedMs: elapsed });
    steps += 1;
    assert.ok(steps < 200, '不该走不停');
    if (step.dx === 0 && step.dy === 0) {
      assert.equal(step.done, true);
      break;
    }
    from = { x: from.x + step.dx, y: from.y + step.dy };
    traveled += Math.hypot(step.dx, step.dy);
    elapsed += W.WALK_STEP_MS;
    if (step.done) break;
  }
  assert.ok(traveled <= W.WALK_MAX_DIST_PX, '位移超上限：' + traveled);
  assert.ok(elapsed <= W.WALK_MAX_MS, '时长超上限：' + elapsed);
  assert.equal(traveled, 100);
  assert.equal(elapsed, 2500); // 25 步 × 100ms
  assert.ok(Math.hypot(CURSOR.x - from.x, CURSOR.y - from.y) >= W.WALK_STOP_DIST_PX, '走进了 120px 以内');
});

test('注入 now/random：不读墙钟、不读 Math.random', () => {
  const raw = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'core', 'walk.js'), 'utf8');
  // 先剥掉注释：文档里提到 require('electron') / Date.now() 不算真的用了
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/Date\.now\(\)/.test(source), false, 'walk.js 不许自己读墙钟');
  assert.equal(/Math\.random\(\)/.test(source.replace(/typeof o\.random === 'function' \? o\.random : Math\.random/g, '')), false);
  assert.equal(/require\('electron'\)/.test(source), false);
});
