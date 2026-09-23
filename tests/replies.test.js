'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/core/replies');

test('关键词规则不少于 15 组，每组都结构完整', () => {
  assert.ok(R.KEYWORD_RULES.length >= 15, '规则组数 = ' + R.KEYWORD_RULES.length);
  const ids = new Set();
  R.KEYWORD_RULES.forEach(function (rule) {
    assert.equal(typeof rule.id, 'string');
    assert.ok(rule.id.length > 0);
    assert.equal(ids.has(rule.id), false, '规则 id 不能重复：' + rule.id);
    ids.add(rule.id);
    assert.ok(Array.isArray(rule.keywords) && rule.keywords.length > 0);
    assert.ok(Array.isArray(rule.replies) && rule.replies.length >= 2);
    rule.replies.forEach(function (text) {
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 0);
    });
  });
});

test('mock 回复命中：常见说法都能落到对应规则', () => {
  const hit = function (text, ruleId) {
    const result = R.matchReply(text, {});
    assert.equal(result.matched, true, text + ' 应该命中');
    assert.equal(result.ruleId, ruleId, text + ' 命中规则不对：' + result.ruleId);
    assert.ok(result.text.length > 0);
  };
  hit('你好', 'greeting');
  hit('hello', 'greeting');
  hit('这个 bug 又报错了', 'debug');
  hit('今天 DDL 快到了，来不及', 'deadline');
  hit('累死了，好困', 'tired');
  hit('晚安', 'sleep');
  hit('谢谢', 'thanks');
  hit('我难过', 'sad');
  hit('哈哈哈哈太好了', 'happy');
  hit('你是谁', 'name');
  hit('帮我看看怎么办', 'help');
  hit('把这个任务拆解一下', 'plan');
  hit('我在摸鱼', 'slack');
  hit('想喝咖啡', 'food');
  hit('今天下雨好冷', 'weather');
  hit('你太厉害了', 'praise');
  hit('现在几点了', 'time');
  hit('讲个笑话', 'joke');
  hit('拜拜，我下班了', 'bye');
  hit('对不起', 'apology');
});

test('大小写与标点不影响命中', () => {
  assert.equal(R.matchReply('  BUG！！！  ', {}).ruleId, 'work');
  assert.equal(R.matchReply('ERROR：', {}).ruleId, 'debug');
  assert.equal(R.matchReply('Hi, there!', {}).ruleId, 'greeting');
});

test('无关键词命中时给兜底回复，不空回', () => {
  const result = R.matchReply('zzzzz qqq', {});
  assert.equal(result.matched, false);
  assert.equal(result.ruleId, 'fallback');
  assert.ok(R.FALLBACK_REPLIES.indexOf(result.text) >= 0);
  const empty = R.matchReply('', {});
  assert.equal(empty.matched, false);
  assert.ok(empty.text.length > 0);
  assert.ok(R.matchReply(null, {}).text.length > 0);
});

test('语气锚点：口头禅「拆解它」在语料里出现', () => {
  const all = JSON.stringify(R.KEYWORD_RULES) + JSON.stringify(R.FALLBACK_REPLIES) + JSON.stringify(R.PROACTIVE_LINES);
  assert.ok(all.indexOf('拆解它') >= 0);
});

test('pick 用注入的 rng 保证可复现', () => {
  const list = ['a', 'b', 'c'];
  assert.equal(R.pick(list, function () { return 0; }), 'a');
  assert.equal(R.pick(list, function () { return 0.5; }), 'b');
  assert.equal(R.pick(list, function () { return 0.999; }), 'c');
  assert.equal(R.pick([], function () { return 0; }), '');
});

test('主动话术：问候带时间与昵称，各类都有话说', () => {
  const now = new Date(2026, 0, 15, 7, 42).getTime();
  const line = R.proactiveLine('greeting', { nickname: '嘉仪', now: now, rng: function () { return 0; } });
  assert.ok(line.indexOf('嘉仪') >= 0);
  assert.ok(line.indexOf('07:42') >= 0);
  assert.ok(line.indexOf('早') >= 0);
  ['greeting', 'break', 'sunset', 'wake', 'nap', 'error'].forEach(function (kind) {
    const text = R.proactiveLine(kind, { nickname: '嘉仪', now: now });
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, kind + ' 没有话术');
    assert.equal(text.indexOf('{'), -1, kind + ' 模板变量没有替换干净');
  });
  const sunset = R.proactiveLine('sunset', { now: now, rng: function () { return 0; } });
  assert.ok(sunset.indexOf('22:30') >= 0, '数字日落要报出时间点');
});

test('fill 只替换认识的名字，缺变量保持原样', () => {
  assert.equal(R.fill('你好 {name}', { name: '琉斯' }), '你好 琉斯');
  assert.equal(R.fill('你好 {other}', { name: '琉斯' }), '你好 {other}');
});

test('normalize 去空白与常见标点', () => {
  assert.equal(R.normalize(' 你好，世界！ '), '你好世界');
  assert.equal(R.normalize('Hi, There!'), 'hithere');
  assert.equal(R.normalize(null), '');
});
