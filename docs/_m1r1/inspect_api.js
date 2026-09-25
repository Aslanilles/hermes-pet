/** 探查交付模块的真实导出与返回形状（供修正复验脚本用） */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const config = require(path.join(ROOT, 'src/core/config.js'));
const walk = require(path.join(ROOT, 'src/core/walk.js'));

console.log('--- config 导出 ---');
console.log(Object.keys(config).sort().join(', '));
console.log('\n--- walk 导出 ---');
console.log(Object.keys(walk).sort().join(', '));

console.log('\n--- migrateConfig 真实返回 ---');
const r = config.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, {});
console.log(JSON.stringify(r, null, 2));
console.log('typeof:', typeof r);

console.log('\n--- migrateConfig 已是 v2 时 ---');
console.log(JSON.stringify(config.migrateConfig({ schemaVersion: 2, nickname: '阿斯兰' }, { onboarded: true })));

console.log('\n--- walk 里和「该不该走」相关的导出 ---');
for (const k of Object.keys(walk)) {
  if (typeof walk[k] === 'function') console.log('  fn', k, '| 参数个数', walk[k].length);
  else console.log('  const', k, '=', JSON.stringify(walk[k]));
}
