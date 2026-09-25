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

test('A4 滚轮缩放：120 -> 132 -> 145 -> 159，到界不再动（60 / 180）', () => {
  assert.equal(C.zoomSize(120, 1), 132);
  assert.equal(C.zoomSize(132, 1), 145);
  assert.equal(C.zoomSize(145, 1), 159);
  assert.equal(C.zoomSize(159, 1), 175);
  assert.equal(C.zoomSize(180, 1), 180);
  assert.equal(C.zoomSize(200, 1), C.SIZE_MAX);
  assert.equal(C.zoomSize(120, -1), 108);
  assert.equal(C.zoomSize(60, -1), 60);
  assert.equal(C.zoomSize(10, -1), C.SIZE_MIN);
  // delta >= 0 一律当放大（滚轮向上）
  assert.equal(C.zoomSize(120, 0), 132);
  // 脏值先回落默认再缩放
  assert.equal(C.zoomSize('abc', 1), C.clampSize(C.SIZE_DEFAULT * 1.1));
});

test('A1 名字净化：先去控制字符 -> trim -> 截断 24 字（顺序写死）', () => {
  assert.equal(C.normaliseUserName('  嘉仪  '), '嘉仪');
  assert.equal(C.normaliseUserName('嘉\u0000仪\r\n'), '嘉仪');
  assert.equal(C.normaliseUserName('a'.repeat(30)).length, 24);
  // 顺序证据：控制字符先被删掉，截断不会把它们算进 24 字
  assert.equal(C.normaliseUserName('\t' + 'b'.repeat(30) + '\n').length, 24);
  // 空 / 纯空白 / 非字符串 -> 空串（起名流程靠这个区分「用户还没输入」）
  assert.equal(C.normaliseUserName('   '), '');
  assert.equal(C.normaliseUserName(null), '');
  assert.equal(C.normaliseUserName(undefined), '');
  assert.equal(C.normaliseUserName(123), '');
  // 回归：迁移逻辑不许下沉进 coerceNickname（'  琉斯  ' 仍回落 '琉斯'）
  assert.equal(C.coerceConfig({ nickname: '  琉斯  ' }).nickname, '琉斯');
  assert.equal(C.coerceConfig({ nickname: '   ' }).nickname, C.NICKNAME_DEFAULT);
});

test('A7 快捷键校验：合法保留 / 缺项或非法整项回落默认 / 四键撞车也回落默认', () => {
  const custom = C.coerceShortcuts({ toggle: 'Ctrl+Alt+H', chat: 'Alt+T', settings: 'Alt+S', mute: 'Alt+M' });
  assert.equal(custom.toggle, 'Ctrl+Alt+H');
  assert.equal(custom.chat, 'Alt+T');
  // 缺项补默认
  assert.deepEqual(C.coerceShortcuts({ toggle: 'Alt+H' }), C.DEFAULT_SHORTCUTS);
  // 非法绑定：没有修饰键 / 单键 / Esc（Esc 绝不进全局）/ 空
  assert.equal(C.isValidShortcut('H'), false);
  assert.equal(C.isValidShortcut('Escape'), false);
  assert.equal(C.isValidShortcut('Alt+Escape'), false);
  assert.equal(C.isValidShortcut('Alt+'), false);
  assert.equal(C.isValidShortcut(''), false);
  assert.equal(C.isValidShortcut(null), false);
  assert.equal(C.isValidShortcut('Alt+F9'), true);
  assert.equal(C.isValidShortcut('Ctrl+Shift+Space'), true);
  assert.deepEqual(C.coerceShortcuts({ toggle: 'H', chat: 'Alt+T', settings: 'Alt+S', mute: 'Alt+M' }), C.DEFAULT_SHORTCUTS);
  // 撞车：两项绑同一个键 -> 整项回落默认（宁可回到 Alt+H，也不留按不出来的键）
  assert.deepEqual(C.coerceShortcuts({ toggle: 'Alt+X', chat: 'Alt+X', settings: 'Alt+S', mute: 'Alt+M' }), C.DEFAULT_SHORTCUTS);
  // 四键默认值本身必须合法
  C.SHORTCUT_KEYS.forEach(function (key) {
    assert.equal(C.isValidShortcut(C.DEFAULT_SHORTCUTS[key]), true, key);
  });
  assert.deepEqual(C.SHORTCUT_KEYS, ['toggle', 'chat', 'settings', 'mute']);
  assert.equal(C.DEFAULT_CONFIG.dnd, false);
  assert.equal(C.DEFAULT_STATE.onboarded, false);
  assert.equal(C.SCHEMA_VERSION, 2);
});

test('A1【P0-2】migrateConfig 四场景：旧语义残留 / 自定义名 / 已 onboarded / 已是新版本', () => {
  // ① schemaVersion 1 + 琉斯 + state 里没有 onboarded -> 判「旧语义残留」
  const legacy = C.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, {});
  assert.equal(legacy.changed, true);
  assert.equal(legacy.reason, 'legacy-nickname');
  assert.equal(legacy.config.nickname, '你');
  assert.equal(legacy.config.nickname, C.ONBOARD_NICKNAME);
  assert.equal(legacy.config.schemaVersion, 2);
  assert.equal(legacy.state.onboarded, false);
  // 没有 state.json（rawState = null）同样按「没有 onboarded」处理
  assert.equal(C.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, null).reason, 'legacy-nickname');
  // 缺 schemaVersion 字段的老文件也算旧
  assert.equal(C.migrateConfig({ nickname: '琉斯' }, {}).reason, 'legacy-nickname');

  // ② 用户改过名字 -> 只升版本，绝不动名字
  const custom = C.migrateConfig({ schemaVersion: 1, nickname: '嘉仪' }, {});
  assert.equal(custom.changed, true);
  assert.equal(custom.reason, 'schema-version');
  assert.equal(custom.config.nickname, '嘉仪');
  assert.equal(custom.config.schemaVersion, 2);

  // ③ state 里已经有 onboarded 字段 -> 名字不许被冲掉
  const onboarded = C.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, { onboarded: true });
  assert.equal(onboarded.reason, 'schema-version');
  assert.equal(onboarded.config.nickname, '琉斯');

  // ④ 已是新版本 -> changed=false（调用方不写盘）
  const current = C.migrateConfig({ schemaVersion: 2, nickname: '琉斯' }, {});
  assert.equal(current.changed, false);
  assert.equal(current.reason, 'current');
  assert.equal(current.config.nickname, '琉斯');
});

test('loadConfig / ensureConfig 接迁移：旧语义残留会被落盘改写（名字 + onboarded）', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'config.json');
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, nickname: '琉斯', size: 150 }), 'utf8');
  fs.writeFileSync(statePath, JSON.stringify({ paused: false }), 'utf8');
  const loaded = C.loadConfig(file, statePath);
  assert.equal(loaded.nickname, '你');
  assert.equal(loaded.size, 150, '迁移只动名字，其余字段原样');
  assert.equal(loaded.schemaVersion, 2);
  // ensureConfig 把迁移结果写回盘（否则每次启动都要重判，设置面板还显示旧值）
  const ensured = C.ensureConfig(file, statePath);
  assert.equal(ensured.nickname, '你');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).nickname, '你');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion, 2);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).onboarded, false);
  // 迁移完再判一次：changed=false（不重复写盘）
  assert.equal(C.migrateConfig(C.readJsonSafe(file), C.readJsonSafe(statePath)).changed, false);
  // 全新用户（文件不存在）不许被误判成旧语义残留
  const fresh = path.join(dir, 'fresh.json');
  assert.deepEqual(C.ensureConfig(fresh, path.join(dir, 'fresh-state.json')).nickname, C.NICKNAME_DEFAULT);
});

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
