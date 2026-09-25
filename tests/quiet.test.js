'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../src/core/quiet');

// A13 六个信号（顺序即 quietReasons 的输出顺序）
const SIGNAL_KEYS = ['foregroundFullscreen', 'typingBurst', 'dnd', 'paused', 'hidden', 'deepNight'];

test('A13 六信号：任一为真即安静，全假不误伤（quietReasons 顺序钉死）', () => {
  SIGNAL_KEYS.forEach(function (key) {
    const signals = {};
    signals[key] = true;
    assert.equal(Q.shouldBeQuiet(signals), true, key + ' 为真时应安静');
    assert.deepEqual(Q.quietReasons(signals), [key], key + ' 的理由要单独列出');
  });
  assert.deepEqual(
    Q.quietReasons({ foregroundFullscreen: true, typingBurst: true, dnd: true, paused: true, hidden: true, deepNight: true }),
    SIGNAL_KEYS
  );
  // 只列真信号，且顺序与上面一致（不按对象键序）
  assert.deepEqual(Q.quietReasons({ deepNight: true, dnd: true }), ['dnd', 'deepNight']);
  // 缺参 / 空 / 假值一律不安静（0 / '' / null / NaN 都不许误伤）
  assert.equal(Q.shouldBeQuiet(), false);
  assert.equal(Q.shouldBeQuiet(null), false);
  assert.equal(Q.shouldBeQuiet({}), false);
  assert.equal(
    Q.shouldBeQuiet({ foregroundFullscreen: 0, typingBurst: '', dnd: null, paused: undefined, hidden: false, deepNight: NaN }),
    false
  );
});

test('前台全屏信号：true / false 两个方向都要能被认出来（A13 主线）', () => {
  assert.equal(Q.shouldBeQuiet({ foregroundFullscreen: true }), true);
  assert.equal(Q.shouldBeQuiet({ foregroundFullscreen: false }), false);
  assert.deepEqual(Q.quietReasons({ foregroundFullscreen: true }), ['foregroundFullscreen']);
  assert.deepEqual(Q.quietReasons({ foregroundFullscreen: false }), []);
  assert.equal(Q.FULLSCREEN_THROTTLE_MS, 2000);
  assert.equal(Q.TYPING_BURST_WINDOW_MS, 3000);
  assert.equal(Q.TYPING_BURST_MIN_KEYS, 8);
});

test('parseFullscreenProbe：认 FULLSCREEN 1 / 0，垃圾输入降级 false', () => {
  assert.equal(Q.parseFullscreenProbe('FULLSCREEN 1 rect=0,0,1440,900 monitor=0,0,1440,900'), true);
  assert.equal(Q.parseFullscreenProbe('  FULLSCREEN 1  '), true);
  assert.equal(Q.parseFullscreenProbe('FULLSCREEN 0 reason=none'), false);
  assert.equal(Q.parseFullscreenProbe('FULLSCREEN 0 rect=0,0,1440,860 monitor=0,0,1440,900'), false);
  assert.equal(Q.parseFullscreenProbe(''), false);
  assert.equal(Q.parseFullscreenProbe(null), false);
  assert.equal(Q.parseFullscreenProbe(undefined), false);
  assert.equal(Q.parseFullscreenProbe('powershell.exe : 拒绝访问'), false);
});

test('探测脚本用 -EncodedCommand（UTF-16LE base64）：引号/转义零风险', () => {
  assert.match(Q.FULLSCREEN_PROBE_SCRIPT, /GetForegroundWindow/);
  assert.match(Q.FULLSCREEN_PROBE_SCRIPT, /MonitorFromWindow/);
  assert.match(Q.FULLSCREEN_PROBE_SCRIPT, /GetMonitorInfo/);
  assert.match(Q.FULLSCREEN_PROBE_SCRIPT, /rcMonitor/);
  assert.equal(Buffer.from(Q.encodePowerShell('abc'), 'base64').toString('utf16le'), 'abc');
  assert.equal(Buffer.from(Q.encodePowerShell('全屏'), 'base64').toString('utf16le'), '全屏');
});

test('探测降级：runner 抛错 / 拒绝 / 关闭时一律 false + 记 error，绝不抛给调用方', async () => {
  const rejected = await Q.probeForegroundFullscreen({
    runner: function () {
      return Promise.reject(new Error('powershell 不在 PATH'));
    },
  });
  assert.equal(rejected.fullscreen, false);
  assert.equal(rejected.error, 'powershell 不在 PATH');
  assert.equal(typeof rejected.durationMs, 'number');

  const thrown = await Q.probeForegroundFullscreen({
    runner: function () {
      throw new Error('boom');
    },
  });
  assert.equal(thrown.fullscreen, false);
  assert.equal(thrown.error, 'boom');

  const disabled = await Q.probeForegroundFullscreen({ enabled: false });
  assert.equal(disabled.fullscreen, false);
  assert.equal(disabled.error, 'disabled');
});

test('探测真解析：注入替身时 true / false 两个方向都对得上', async () => {
  const yes = await Q.probeForegroundFullscreen({
    runner: function () {
      return Promise.resolve('FULLSCREEN 1 rect=0,0,1440,900 monitor=0,0,1440,900');
    },
  });
  assert.equal(yes.fullscreen, true);
  assert.equal(yes.error, null);
  assert.match(yes.raw, /^FULLSCREEN 1/);

  const no = await Q.probeForegroundFullscreen({
    runner: function () {
      return Promise.resolve('FULLSCREEN 0 reason=none');
    },
  });
  assert.equal(no.fullscreen, false);
  assert.equal(no.error, null);
});

test('detectForegroundFullscreen：可单独调用（§3.1 第 6 条的自测入口）', async () => {
  Q.resetForegroundFullscreenCache();
  assert.equal(Q.foregroundFullscreenStatus().fullscreen, false);
  const result = await Q.detectForegroundFullscreen({
    wait: true,
    runner: function () {
      return Promise.resolve('FULLSCREEN 1 rect=0,0,1440,900 monitor=0,0,1440,900');
    },
  });
  assert.equal(result.fullscreen, true);
  // wait 模式会把结果写进缓存（主进程随后同步读到的一定是这次的结果）
  assert.equal(Q.foregroundFullscreenStatus().fullscreen, true);
  assert.equal(Q.foregroundFullscreenStatus().pending, false);
  assert.equal(Q.foregroundFullscreenStatus().raw, result.raw);
  Q.resetForegroundFullscreenCache();
  assert.equal(Q.foregroundFullscreenStatus().fullscreen, false);
});

test('节流：缓存新鲜时不重复刷新，过期才后台刷一次（同步路径从不阻塞）', async () => {
  Q.resetForegroundFullscreenCache();
  let calls = 0;
  const runner = function () {
    calls += 1;
    return Promise.resolve('FULLSCREEN 1 rect=0,0,1440,900 monitor=0,0,1440,900');
  };
  // 冷缓存：同步调用立刻返回**旧值**（false），同时后台刷一次
  assert.equal(Q.detectForegroundFullscreen({ now: Date.now(), throttleMs: 2000, runner: runner }), false);
  await new Promise(function (resolve) {
    setImmediate(resolve);
  });
  assert.equal(calls, 1);
  assert.equal(Q.foregroundFullscreenStatus().fullscreen, true);
  // 节流窗口内：直接回缓存值，不再探测
  assert.equal(Q.detectForegroundFullscreen({ now: Date.now(), throttleMs: 2000, runner: runner }), true);
  await new Promise(function (resolve) {
    setImmediate(resolve);
  });
  assert.equal(calls, 1, '节流期内不许重复探测');
  // 过期：允许再刷一次
  assert.equal(Q.detectForegroundFullscreen({ now: Date.now() + 3000, throttleMs: 2000, runner: runner }), true);
  await new Promise(function (resolve) {
    setImmediate(resolve);
  });
  assert.equal(calls, 2);
  Q.resetForegroundFullscreenCache();
});

test('打字密度：近 3s >=8 次才算高速（窗口边界与未来时刻都不许算进去）', () => {
  const now = 1000000;
  let keys = [];
  for (let i = 7; i >= 0; i -= 1) keys = Q.recordKeystroke(keys, now - i * 100);
  assert.equal(keys.length, 8);
  assert.equal(Q.isTypingBurst(keys, now), true);
  assert.equal(Q.isTypingBurst(keys.slice(0, 7), now), false, '7 次不够阈值');
  // 窗口边界：最早一次正好 3000ms 前（含）-> 真；3001ms 前 -> 假
  const seven = [now, now, now, now, now, now, now];
  assert.equal(Q.isTypingBurst([now - 3000].concat(seven), now), true, '最老一次正好 3000ms，仍在窗口内');
  assert.equal(Q.isTypingBurst([now - 3001].concat(seven), now), false, '最老一次超窗 -> 只剩 7 次');
  // 未来时刻（时钟异常）不算击键
  assert.equal(Q.isTypingBurst(seven.map(function () { return now + 1; }), now), false);
  // 脏输入不抛
  assert.equal(Q.isTypingBurst(null, now), false);
  assert.equal(Q.isTypingBurst([], now), false);
  assert.equal(Q.isTypingBurst(['x', null, NaN], now), false);
  // recordKeystroke 只留窗口内的，并追加本次
  assert.deepEqual(Q.recordKeystroke([now - 9000, now - 4000, now - 100], now), [now - 100, now]);
  assert.deepEqual(Q.recordKeystroke(null, now), [now]);
});

test('平台降级：非 Windows 真探测直接 false（容器里 node --test 不许炸）', async () => {
  if (process.platform === 'win32') {
    // 宿主 Windows：真跑一次 PowerShell 探测，只要求「给出结果 + 不抛」，不要求当前一定是全屏
    const real = await Q.probeForegroundFullscreen();
    assert.equal(typeof real.fullscreen, 'boolean');
    assert.equal(typeof real.durationMs, 'number');
    assert.ok(real.error === null || typeof real.error === 'string');
    return;
  }
  const real = await Q.probeForegroundFullscreen();
  assert.equal(real.fullscreen, false);
  assert.match(String(real.error), /unsupported-platform/);
});
