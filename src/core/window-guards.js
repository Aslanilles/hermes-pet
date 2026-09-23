'use strict';

/**
 * 窗口看门狗纯逻辑（禁止 require('electron')，容器里 node --test 直接覆盖）。
 *
 * 这一层只负责回答两个「该不该动手」的问题，真正的 win.setAlwaysOnTop /
 * win.setIgnoreMouseEvents 调用留在 src/main.js。抽出来的原因：这两条都是
 * **环境级静默失效**（不报错、表现滞后），必须能在容器里被单测钉死，否则下一轮
 * 很容易被当成冗余定时器删掉。
 *
 * 依据：docs/M0-recon-github-pet.md §5（坑清单）/ §6（落地配方）。
 *   1) 置顶会丢（§5.2 / §6(a)）：Windows 上 alwaysOnTop 只在 BrowserWindow 构造器里
 *      设一次不够，任务栏 / 全屏窗扫过后会被压下去。竞品 rullerzhou-afk/clawd-on-desk
 *      的常数 TOPMOST_WATCHDOG_MS = 5000 就是周期重断言用的，层级 'pop-up-menu'
 *      才能压过任务栏。
 *   2) 穿透会丢（§5.2 / §6(b)）：win.setIgnoreMouseEvents(true, { forward: true })
 *      在 Windows 上「宠物页快速重载后」/「有全屏窗口扫过之后」会静默失效，
 *      **没有任何报错**，表现是透明区域又开始挡桌面点击。竞品 OpenPetsHQ/openpets
 *      配套了 cursor-probe watchdog 兜底。
 */

// 5000ms 依据 docs/M0-recon-github-pet.md §6(a) / §5.2，抄自竞品 clawd-on-desk 的 TOPMOST_WATCHDOG_MS。
const TOPMOST_WATCHDOG_MS = 5000;
// 2000ms 依据 docs/M0-recon-github-pet.md §5.2 / §6(b)：forward 静默失效要比重置顶更密的兜底。
const IGNORE_WATCHDOG_MS = 2000;
// clawd 压过任务栏用的置顶层级（§5.2 / §6(a)）。
const TOPMOST_LEVEL = 'pop-up-menu';

/**
 * 置顶看门狗要不要重断言（FIX-A）。
 * 四种取值组合：只有「存在 + 可见 + 未暂停」为 true，其余三种一律 false。
 * 暂停时必须不动手，否则「暂停」这个逃生口形同虚设。
 */
function shouldReassertTopmost(options) {
  const opts = options || {};
  if (opts.isDestroyed) return false;
  if (!opts.isVisible) return false;
  if (opts.paused) return false;
  return true;
}

/**
 * 穿透看门狗该做什么（FIX-B）。
 * 'force-ignore' = 重断言 setIgnoreMouseEvents(true, { forward: true })；
 * 'noop'        = 什么都不做。
 *
 * 关键：lastInteractive 是「渲染进程最近一次报的命中状态」。它一旦为真值
 * （命中了猫 / 气泡，穿透此刻本应关闭），就必须 noop —— 强行重开穿透会让点猫失效。
 * 只有「命中了交互元素」之外的状态（false / 未上报）才兜底重开穿透。
 */
function watchdogAction(options) {
  const opts = options || {};
  if (opts.isDestroyed) return 'noop';
  if (!opts.visible) return 'noop';
  if (opts.lastInteractive) return 'noop';
  return 'force-ignore';
}

module.exports = {
  TOPMOST_WATCHDOG_MS,
  IGNORE_WATCHDOG_MS,
  TOPMOST_LEVEL,
  shouldReassertTopmost,
  watchdogAction,
};
