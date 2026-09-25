/**
 * M1-R1 独立复验脚本（调度者自用，不是 codex 的自证）
 * 直接调用交付的纯逻辑模块，验证杠精点名的 P0 修法**真的落地**，且 M0 红线未被改坏。
 *
 * 运行：node docs/_m1r1/verify_m1r1.js
 */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const guards = require(path.join(ROOT, 'src/core/window-guards.js'));
const config = require(path.join(ROOT, 'src/core/config.js'));
const walk = require(path.join(ROOT, 'src/core/walk.js'));
const quiet = require(path.join(ROOT, 'src/core/quiet.js'));
const position = require(path.join(ROOT, 'src/core/position.js'));

let pass = 0, fail = 0;
const failures = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : (fail++, failures.push(`${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  -> ${JSON.stringify(actual)}`);
}

console.log('=== P0-1 A5 穿透所有权：看门狗必须有 dnd 维度 ===');
check('dnd=true + lastInteractive=true -> force-ignore',
  guards.watchdogAction({ dnd: true, lastInteractive: true, isDestroyed: false, visible: true }), 'force-ignore');
console.log('--- 红线复验：M0 第五轮「点猫仍可用」不许被改坏 ---');
check('dnd=false + lastInteractive=true -> noop',
  guards.watchdogAction({ dnd: false, lastInteractive: true, isDestroyed: false, visible: true }), 'noop');
check('dnd 缺省 + lastInteractive=true -> noop',
  guards.watchdogAction({ lastInteractive: true, isDestroyed: false, visible: true }), 'noop');
check('TOPMOST_WATCHDOG_MS', guards.TOPMOST_WATCHDOG_MS, 5000);
check('IGNORE_WATCHDOG_MS', guards.IGNORE_WATCHDOG_MS, 2000);
check('TOPMOST_LEVEL', guards.TOPMOST_LEVEL, 'pop-up-menu');

console.log('\n=== P0-2 A1 迁移：旧 nickname「琉斯」必须被搬走 ===');
const m = config.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, {});
check('迁移后 nickname 落「你」', m.config.nickname, '你');
check('迁移后 schemaVersion 升到 2', m.config.schemaVersion, 2);
check('迁移后 onboarded=false（走初见流程）', m.state.onboarded, false);
check('迁移被标记为 changed 且给出 reason', [m.changed, m.reason], [true, 'legacy-nickname']);
const k = config.migrateConfig({ schemaVersion: 2, nickname: '阿斯兰' }, { onboarded: true });
check('已是 v2 + 有用户名 -> 原样保留、不覆盖', [k.config.nickname, k.changed], ['阿斯兰', false]);
console.log('--- M0 既有行为不许被迁移打坏（tests/config.test.js:39 那条）---');
check('coerceConfig 不承担迁移职责（「琉斯」原值保留）',
  config.coerceConfig({ nickname: '  琉斯  ' }).nickname, '琉斯');
check('normaliseUserName 去掉换行与控制字符',
  config.normaliseUserName('阿\u0000斯\n兰\r'), '阿斯兰');

console.log('\n=== P0-4 A2 节拍（代理裁定：平均约 4 分钟）===');
check('WALK_COOLDOWN_MS = 180000', walk.WALK_COOLDOWN_MS, 180000);
check('WALK_CHANCE ≈ 1/300', Math.abs(walk.WALK_CHANCE - 1 / 300) < 1e-12, true);
console.log('--- ★ 核心：固定种子跑 1 小时虚拟时间，散步次数必须落 [10,20] ---');
for (const seed of [1, 42, 20260925, 999999]) {
  const n = walk.walksPerHour(seed);
  check(`walksPerHour(seed=${seed}) ∈ [10,20]`, n >= 10 && n <= 20, true);
}
console.log('--- 光标安静红线（杠精点名不许碰）---');
check('光标忙（cursorQuiet=false）-> 绝不走',
  walk.shouldStartWalk({ now: 999999, lastWalkAt: 0, cursorQuiet: false, state: 'idle', random: () => 0 }), false);
check('冷却期内 -> 不走', walk.shouldStartWalk({ now: 1000, lastWalkAt: 0, cursorQuiet: true, state: 'idle', random: () => 0 }), false);
console.log('--- 四类禁止态 ---');
check('dnd -> 禁止', walk.walkBlockReason({ dnd: true }), 'dnd');
check('paused -> 禁止', walk.walkBlockReason({ paused: true }), 'paused');
check('hidden -> 禁止', walk.walkBlockReason({ hidden: true }), 'hidden');
check('quiet（全屏/打字）-> 禁止', walk.walkBlockReason({ quiet: true }), 'quiet');
check('对话中 -> 禁止', walk.walkBlockReason({ dialogueOpen: true }) !== null, true);

console.log('\n=== P0-5 A6 吸附 ===');
const wa = { x: 0, y: 0, width: 1440, height: 852 };
const box = (x, y) => ({ x, y, width: 144, height: 144 });
check('贴右边缘（距离 10px）-> 贴边留 4px', position.snapToEdge(box(1440 - 144 - 10, 400), wa, 20, 4).x, 1440 - 144 - 4);
check('距离 21px -> 不吸附', position.snapToEdge(box(1440 - 144 - 21, 400), wa, 20, 4).x, 1440 - 144 - 21);
check('贴左边缘 -> 贴到 4px', position.snapToEdge(box(10, 400), wa, 20, 4).x, 4);
check('贴下边缘 -> 贴到底留 4px', position.snapToEdge(box(400, 852 - 144 - 10), wa, 20, 4).y, 852 - 144 - 4);

console.log('\n=== P1-3 A13 静默：quiet 必须认全屏信号 ===');
const base = { foregroundFullscreen: false, typingBurst: false, dnd: false, paused: false, hidden: false, deepNight: false };
check('全部为假 -> 不静默', quiet.shouldBeQuiet(base), false);
check('全屏前台 -> 静默', quiet.shouldBeQuiet({ ...base, foregroundFullscreen: true }), true);
check('高速打字 -> 静默', quiet.shouldBeQuiet({ ...base, typingBurst: true }), true);
check('别烦我 -> 静默', quiet.shouldBeQuiet({ ...base, dnd: true }), true);
check('探测函数已导出（可单独真跑）', typeof quiet.detectForegroundFullscreen, 'function');

console.log(`\n===== 复验结果：通过 ${pass} / 失败 ${fail} =====`);
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('全部通过 —— P0/P1 修复已落地，且 M0 红线未被改坏');
