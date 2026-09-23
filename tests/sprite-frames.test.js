'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/core/sprite-frames');

test('索引表照抄 docs/M0-sprite-map.md，不自创', () => {
  assert.deepEqual(S.SPRITE_SETS.idle, [[-3, -3]]);
  assert.deepEqual(S.SPRITE_SETS.alert, [[-7, -3]]);
  assert.deepEqual(S.SPRITE_SETS.tired, [[-3, -2]]);
  assert.deepEqual(S.SPRITE_SETS.sleeping, [[-2, 0], [-2, -1]]);
  assert.deepEqual(S.SPRITE_SETS.scratchSelf, [[-5, 0], [-6, 0], [-7, 0]]);
  assert.deepEqual(S.SPRITE_SETS.scratchWallN, [[0, 0], [0, -1]]);
  assert.deepEqual(S.SPRITE_SETS.scratchWallS, [[-7, -1], [-6, -2]]);
  assert.deepEqual(S.SPRITE_SETS.scratchWallE, [[-2, -2], [-2, -3]]);
  assert.deepEqual(S.SPRITE_SETS.scratchWallW, [[-4, 0], [-4, -1]]);
  assert.deepEqual(S.SPRITE_SETS.N, [[-1, -2], [-1, -3]]);
  assert.deepEqual(S.SPRITE_SETS.NE, [[0, -2], [0, -3]]);
  assert.deepEqual(S.SPRITE_SETS.E, [[-3, 0], [-3, -1]]);
  assert.deepEqual(S.SPRITE_SETS.SE, [[-5, -1], [-5, -2]]);
  assert.deepEqual(S.SPRITE_SETS.S, [[-6, -3], [-7, -2]]);
  assert.deepEqual(S.SPRITE_SETS.SW, [[-5, -3], [-6, -1]]);
  assert.deepEqual(S.SPRITE_SETS.W, [[-4, -2], [-4, -3]]);
  assert.deepEqual(S.SPRITE_SETS.NW, [[-1, 0], [-1, -1]]);
});

test('取帧公式：负索引直接乘 32，不做正列号换算', () => {
  assert.equal(S.spritePosition('idle', 0), '-96px -96px');
  assert.equal(S.spritePosition('alert', 0), '-224px -96px');
  assert.equal(S.spritePosition('tired', 0), '-96px -64px');
  assert.equal(S.spritePosition('sleeping', 0), '-64px 0px');
  assert.equal(S.spritePosition('sleeping', 1), '-64px -32px');
  assert.equal(S.spritePosition('E', 0), '-96px 0px');
  assert.equal(S.spritePosition('E', 1), '-96px -32px');
  assert.equal(S.spritePosition('scratchWallN', 0), '0px 0px');
  assert.equal(S.spritePosition('scratchWallN', 1), '0px -32px');
});

test('负帧号与超界帧号按组长度取模', () => {
  assert.equal(S.spritePosition('E', -1), S.spritePosition('E', 1));
  assert.equal(S.spritePosition('E', 2), S.spritePosition('E', 0));
  assert.equal(S.spritePosition('E', -2), S.spritePosition('E', 0));
  assert.equal(S.spritePosition('E', 7), S.spritePosition('E', 1));
  assert.equal(S.normaliseFrame(-1, 2), 1);
  assert.equal(S.normaliseFrame(1.9, 2), 1);
  assert.equal(S.normaliseFrame(NaN, 2), 0);
  assert.equal(S.normaliseFrame(undefined, 2), 0);
});

test('每组帧数正确，单帧组永远取同一格', () => {
  assert.equal(S.frameCount('idle'), 1);
  assert.equal(S.frameCount('sleeping'), 2);
  assert.equal(S.frameCount('scratchSelf'), 3);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(S.spritePosition('idle', i), S.spritePosition('idle', 0));
  }
});

test('未知组抛错，不静默返回错帧', () => {
  assert.throws(function () {
    S.spritePosition('nope', 0);
  }, /unknown sprite set/);
  assert.throws(function () {
    S.frameCount('nope');
  }, /unknown sprite set/);
  assert.equal(S.hasSprite('nope'), false);
});

test('spriteRect 给出 canvas 用的正偏移', () => {
  assert.deepEqual(S.spriteRect('idle', 0), { sx: 96, sy: 96, sw: 32, sh: 32 });
  assert.deepEqual(S.spriteRect('scratchWallN', 1), { sx: 0, sy: 32, sw: 32, sh: 32 });
});

test('每个 hermes-pet 状态都能取到落在表内的格子', () => {
  S.PET_STATES.forEach(function (state) {
    const group = S.STATE_SPRITES[state];
    assert.ok(S.hasSprite(group), state + ' 映射到了不存在的组 ' + group);
    const frames = S.frameCount(group);
    for (let f = 0; f < frames; f += 1) {
      const cell = S.spriteAt(group, f);
      const col = -cell[0];
      const row = -cell[1];
      assert.ok(col >= 0 && col < S.SHEET_COLUMNS, state + ' 列越界');
      assert.ok(row >= 0 && row < S.SHEET_ROWS, state + ' 行越界');
    }
  });
});

test('贴图事实：256x128，8x4，单格 32', () => {
  assert.equal(S.SPRITE_CELL, 32);
  assert.equal(S.SHEET_WIDTH, 256);
  assert.equal(S.SHEET_HEIGHT, 128);
  assert.equal(S.SHEET_COLUMNS * S.SHEET_ROWS, 32);
});

test('drag 方向：向右 SE / 向左 SW，默认 SE（复用映射表，不自创索引）', () => {
  assert.equal(S.STATE_SPRITES.drag, 'SE');
  assert.equal(S.spriteForDrag('E'), 'SE');
  assert.equal(S.spriteForDrag('W'), 'SW');
  assert.equal(S.spriteForDrag(null), 'SE');
  assert.equal(S.spriteForDrag(undefined), 'SE');
  // 两组的第一帧必须与 docs/M0-sprite-map.md 的 SE/SW 完全一致
  assert.equal(S.spritePosition('SE', 0), '-160px -32px');
  assert.equal(S.spritePosition('SW', 0), '-160px -96px');
  assert.equal(S.frameCount('SE'), 2);
  assert.equal(S.frameCount('SW'), 2);
});

test('talk / listen 复用映射：talk -> alert、listen -> idle（与 docs/M0-sprite-map.md 第 6 节一致）', () => {
  assert.equal(S.STATE_SPRITES.talk, 'alert');
  assert.equal(S.STATE_SPRITES.listen, 'idle');
  assert.equal(S.spriteForState('talk'), 'alert');
  assert.equal(S.spriteForState('listen'), 'idle');
  // 取帧必须与映射表的 alert [-7,-3] / idle [-3,-3] 逐字一致
  assert.equal(S.spritePosition('alert', 0), '-224px -96px');
  assert.equal(S.spritePosition('idle', 0), '-96px -96px');
  assert.equal(S.frameCount('alert'), 1);
  assert.equal(S.frameCount('idle'), 1);
});
