'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../src/core/config');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-pet-'));
}

function tmpFile(name) {
  return path.join(tmpDir(), name || 'config.json');
}

test('默认值合并：缺字段补默认值，未知字段丢弃', () => {
  const merged = C.coerceConfig({ nickname: '嘉仪' });
  assert.equal(merged.nickname, '嘉仪');
  assert.equal(merged.size, C.SIZE_DEFAULT);
  assert.equal(merged.proactiveEnabled, true);
  assert.equal(merged.launchAtLogin, false);
  assert.equal(merged.deepNightEnabled, true);
  assert.equal(merged.schemaVersion, C.SCHEMA_VERSION);
  const withUnknown = C.coerceConfig({ nickname: 'A', hack: 'x', __proto__: { evil: 1 } });
  assert.equal(withUnknown.hack, undefined);
});

test('校验：显示大小夹紧到 60-180，非法值回落默认', () => {
  assert.equal(C.coerceConfig({ size: 999 }).size, C.SIZE_MAX);
  assert.equal(C.coerceConfig({ size: 1 }).size, C.SIZE_MIN);
  assert.equal(C.coerceConfig({ size: 133.6 }).size, 134);
  assert.equal(C.coerceConfig({ size: 'not-a-number' }).size, C.SIZE_DEFAULT);
  assert.equal(C.coerceConfig({ size: null }).size, C.SIZE_DEFAULT);
});

test('校验：昵称去空白、空串回落默认、超长截断', () => {
  assert.equal(C.coerceConfig({ nickname: '  琉斯  ' }).nickname, '琉斯');
  assert.equal(C.coerceConfig({ nickname: '   ' }).nickname, C.NICKNAME_DEFAULT);
  assert.equal(C.coerceConfig({ nickname: 42 }).nickname, C.NICKNAME_DEFAULT);
  assert.equal(C.coerceConfig({ nickname: 'x'.repeat(50) }).nickname.length, C.NICKNAME_MAX);
});

test('校验：布尔字段只认真布尔，其余回落默认', () => {
  assert.equal(C.coerceConfig({ proactiveEnabled: false }).proactiveEnabled, false);
  assert.equal(C.coerceConfig({ proactiveEnabled: 'false' }).proactiveEnabled, true);
  assert.equal(C.coerceConfig({ launchAtLogin: true }).launchAtLogin, true);
  assert.equal(C.coerceConfig({ deepNightEnabled: 0 }).deepNightEnabled, true);
});

test('损坏 / 缺失 / 类型错误的文件一律回落默认值，且不抛错', () => {
  const cases = ['{ not json at all', '', '   ', '[]', '123', 'null', 'true', 'string-value'];
  cases.forEach(function (text) {
    const file = tmpFile();
    fs.writeFileSync(file, text, 'utf8');
    const cfg = C.loadConfig(file);
    assert.deepEqual(cfg, C.DEFAULT_CONFIG, '内容为 ' + JSON.stringify(text) + ' 时应回落默认值');
  });
  const missing = C.loadConfig(path.join(tmpDir(), 'nope.json'));
  assert.deepEqual(missing, C.DEFAULT_CONFIG);
});

test('目录不存在也能读（回落默认）', () => {
  const file = path.join(tmpDir(), 'a', 'b', 'c', 'config.json');
  assert.deepEqual(C.loadConfig(file), C.DEFAULT_CONFIG);
});

test('原子写：写完不留 .tmp，读回来一致', () => {
  const file = tmpFile();
  const saved = C.saveConfig(file, { nickname: '嘉仪', size: 150, proactiveEnabled: false });
  assert.equal(saved.size, 150);
  assert.ok(fs.existsSync(file));
  assert.equal(fs.existsSync(file + '.tmp'), false, '临时文件必须已被 rename 掉');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.endsWith('\n'), '写入以换行结尾，便于人工查看');
  const reloaded = C.loadConfig(file);
  assert.equal(reloaded.nickname, '嘉仪');
  assert.equal(reloaded.proactiveEnabled, false);
  assert.equal(reloaded.size, 150);
});

test('原子写会创建缺失的父目录', () => {
  const file = path.join(tmpDir(), 'deep', 'nested', 'config.json');
  C.saveConfig(file, { nickname: 'A' });
  assert.ok(fs.existsSync(file));
});

test('patchConfig 只改指定字段，其余保持', () => {
  const file = tmpFile();
  C.saveConfig(file, { nickname: '嘉仪', size: 88 });
  const patched = C.patchConfig(file, { size: 120 });
  assert.equal(patched.size, 120);
  assert.equal(patched.nickname, '嘉仪');
  assert.equal(C.loadConfig(file).size, 120);
});

test('state：坐标 / 暂停 / 固定 / 调度运行时都能存取，脏值回落', () => {
  const file = tmpFile('state.json');
  const saved = C.saveState(file, {
    x: 1200.4,
    y: -30,
    paused: true,
    pinned: true,
    scheduler: { greetedDate: '2026-01-15', dailyCount: 2 },
  });
  assert.equal(saved.x, 1200);
  assert.equal(saved.y, -30);
  assert.equal(saved.paused, true);
  assert.equal(saved.pinned, true);
  const reloaded = C.loadState(file);
  assert.equal(reloaded.scheduler.greetedDate, '2026-01-15');
  assert.equal(reloaded.scheduler.dailyCount, 2);
  assert.equal(C.coerceState({ x: 'abc', y: null, scheduler: 'nope' }).x, null);
  assert.deepEqual(C.coerceState({ scheduler: [1, 2] }).scheduler, {});
});

test('readJsonSafe 对损坏内容返回 null，交给上层回落', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '###', 'utf8');
  assert.equal(C.readJsonSafe(file), null);
});

test('首启落盘：ensureConfig 写出一份含全部默认值的 config.json（原子写）', () => {
  const file = tmpFile();
  assert.equal(fs.existsSync(file), false, '前提：文件真的不存在');
  const cfg = C.ensureConfig(file);
  assert.deepEqual(cfg, C.DEFAULT_CONFIG);
  assert.ok(fs.existsSync(file), '首启必须落盘');
  assert.equal(fs.existsSync(file + '.tmp'), false, '原子写不留 .tmp');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk, C.DEFAULT_CONFIG, '文件里就是完整默认值清单，打开即可人工验收');
  assert.deepEqual(Object.keys(onDisk).sort(), Object.keys(C.DEFAULT_CONFIG).sort());
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));
});

test('ensureConfig 不覆盖用户改过的值；文件损坏时自愈回默认值', () => {
  const file = tmpFile();
  C.saveConfig(file, { nickname: '嘉仪', size: 150, proactiveEnabled: false });
  const kept = C.ensureConfig(file);
  assert.equal(kept.nickname, '嘉仪');
  assert.equal(kept.size, 150);
  assert.equal(kept.proactiveEnabled, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).size, 150, '已存在的配置不许被默认值冲掉');

  fs.writeFileSync(file, '{ broken', 'utf8');
  assert.deepEqual(C.ensureConfig(file), C.DEFAULT_CONFIG);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), C.DEFAULT_CONFIG);
});

test('state 坐标缺省必须是 null，不是 0（FIX-1 根因：Number(null) === 0）', () => {
  const file = tmpFile('state.json');
  fs.writeFileSync(file, JSON.stringify({ paused: false }), 'utf8');
  assert.equal(C.loadState(file).x, null);
  assert.equal(C.loadState(file).y, null);
  assert.equal(C.coerceState({ x: undefined, y: '' }).x, null);
  assert.equal(C.coerceState({ x: null, y: null }).y, null);
  assert.equal(C.coerceState({ x: 'abc' }).x, null);
  // 文件里真的写了 0 属于「值」而不是「缺省」，这一层原样保留；是否合法由 position 层判定
  assert.equal(C.coerceState({ x: 0, y: 0 }).x, 0);
  assert.equal(C.coerceState({ x: 1272.4, y: -3.6 }).x, 1272);
});

test('首启落盘后 loadState 与 ensureConfig 可以共存（目录不存在也能自建）', () => {
  const dir = tmpDir();
  const cfg = path.join(dir, 'nested', 'config.json');
  assert.deepEqual(C.ensureConfig(cfg), C.DEFAULT_CONFIG);
  assert.ok(fs.existsSync(cfg));
});
