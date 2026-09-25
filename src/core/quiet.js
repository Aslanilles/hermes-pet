'use strict';

/**
 * A13「被打扰的边界」纯逻辑（禁止 require('electron')，容器里 node --test 直接覆盖）。
 *
 * 原则（docs/M1R1-spec.md §12.6）：猫一切**主动**行为让位于用户当前状态；
 * 信号优先级 = 前台窗口类型 > 输入活跃度 > 时间。
 * 这里只回答「现在该不该安静」，真正的闭嘴/停走接线在 src/main.js。
 *
 * 六个信号（任一为真 -> 安静，保留呼吸/待机）：
 *   foregroundFullscreen 前台窗口全屏（做汇报/看视频/玩游戏/网课录屏）
 *   typingBurst          高速打字（近 3s 持续击键）—— 渲染进程上报击键时刻，主进程判密度
 *   dnd                  别烦我 / 透明模式（A5）
 *   paused               暂停（会话级）
 *   hidden               猫窗口被隐藏
 *   deepNight            深夜 22:00-07:00
 *
 * 【P1-3】全屏探测本轮**真做**：Windows 上用 PowerShell（user32 GetForegroundWindow +
 * MonitorFromWindow + GetMonitorInfo）比前台窗口矩形与显示器矩形；节流 ~2s、失败降级 false、
 * 可注入/mock（options.runner）。没有「拿不准就跳过」这个选项。
 */

const { execFile } = require('child_process');

const FULLSCREEN_THROTTLE_MS = 2000; // 节流 ~2s（与穿透看门狗同量级）
const PROBE_TIMEOUT_MS = 8000; // PowerShell 单次探测超时（Add-Type 编译约 1s）
const TYPING_BURST_WINDOW_MS = 3000; // 「近 3s」
const TYPING_BURST_MIN_KEYS = 8; // 3s 内 >=8 次击键 = 高强度输入 = 闭嘴

/** 六个信号里有哪些为真（便于日志与自证门输出细节）。 */
function quietReasons(signals) {
  const s = signals || {};
  const reasons = [];
  if (s.foregroundFullscreen) reasons.push('foregroundFullscreen');
  if (s.typingBurst) reasons.push('typingBurst');
  if (s.dnd) reasons.push('dnd');
  if (s.paused) reasons.push('paused');
  if (s.hidden) reasons.push('hidden');
  if (s.deepNight) reasons.push('deepNight');
  return reasons;
}

/** 该不该安静：任一信号为真即真。缺参/空对象一律 false（不误伤）。 */
function shouldBeQuiet(signals) {
  return quietReasons(signals).length > 0;
}

/** 保留近 windowMs 内的击键时刻（纯函数，返回新数组）。 */
function recordKeystroke(keystrokes, now, options) {
  const opts = options || {};
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : TYPING_BURST_WINDOW_MS;
  const at = Number.isFinite(now) ? now : 0;
  const kept = (Array.isArray(keystrokes) ? keystrokes : []).filter(function (t) {
    return Number.isFinite(t) && t <= at && t >= at - windowMs;
  });
  kept.push(at);
  return kept;
}

/** 高速打字判定：近 3s 内击键次数 >= 8。 */
function isTypingBurst(keystrokes, now, options) {
  const opts = options || {};
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : TYPING_BURST_WINDOW_MS;
  const minKeys = Number.isFinite(opts.minKeys) ? opts.minKeys : TYPING_BURST_MIN_KEYS;
  const at = Number.isFinite(now) ? now : 0;
  if (!Array.isArray(keystrokes)) return false;
  let count = 0;
  for (let i = 0; i < keystrokes.length; i += 1) {
    const t = keystrokes[i];
    if (Number.isFinite(t) && t <= at && t >= at - windowMs) count += 1;
  }
  return count >= minKeys;
}

/**
 * PowerShell 探测脚本。输出一行 `FULLSCREEN <0|1> rect=... monitor=...`。
 * 用 -EncodedCommand（base64 / UTF-16LE）传参，绕开引号与转义的所有坑。
 * 判定：前台窗口矩形把所在显示器矩形**完整盖住**才算全屏；最大化窗口只盖 workArea，
 * 盖不住任务栏 -> 判 0（正确）。
 */
const FULLSCREEN_PROBE_SCRIPT = `$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
public static class HermesFs {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  public static string Probe() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "FULLSCREEN 0 reason=none";
    RECT r;
    if (!GetWindowRect(h, out r)) return "FULLSCREEN 0 reason=norect";
    IntPtr m = MonitorFromWindow(h, 2);
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(m, ref mi)) return "FULLSCREEN 0 reason=nomonitor";
    bool full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
    return String.Format("FULLSCREEN {0} rect={1},{2},{3},{4} monitor={5},{6},{7},{8}", full ? 1 : 0, r.Left, r.Top, r.Right, r.Bottom, mi.rcMonitor.Left, mi.rcMonitor.Top, mi.rcMonitor.Right, mi.rcMonitor.Bottom);
  }
}
'@
Add-Type -TypeDefinition $code -ErrorAction Stop
[HermesFs]::Probe()`;

/** 解析探测输出（纯函数，可单测）：`FULLSCREEN 1 ...` -> true。认不出 -> false（降级）。 */
function parseFullscreenProbe(stdout) {
  const text = String(stdout == null ? '' : stdout);
  const match = /FULLSCREEN\s+([01])/.exec(text);
  return Boolean(match) && match[1] === '1';
}

function encodePowerShell(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

/** 默认探测执行器：跑一次 PowerShell，回 stdout。失败抛错（由上层降级）。 */
function defaultProbeRunner(script) {
  return new Promise(function (resolve, reject) {
    if (process.platform !== 'win32') {
      reject(new Error('unsupported-platform:' + process.platform));
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 256 },
      function (err, stdout) {
        if (err) reject(err);
        else resolve(String(stdout || ''));
      }
    );
  });
}

/** 真跑一次探测（不过节流）。返回 { fullscreen, raw, error, durationMs }；失败降级 false。 */
function probeForegroundFullscreen(options) {
  const o = options || {};
  const startedAt = Date.now();
  const runner = typeof o.runner === 'function' ? o.runner : defaultProbeRunner;
  const script = typeof o.script === 'string' ? o.script : FULLSCREEN_PROBE_SCRIPT;
  if (o.enabled === false) {
    return Promise.resolve({ fullscreen: false, raw: '', error: 'disabled', durationMs: 0 });
  }
  return Promise.resolve()
    .then(function () {
      return runner(script);
    })
    .then(function (raw) {
      return {
        fullscreen: parseFullscreenProbe(raw),
        raw: String(raw || '').trim(),
        error: null,
        durationMs: Date.now() - startedAt,
      };
    })
    .catch(function (err) {
      // 失败一律降级 false（绝不让探测失败变成「猫不说话了」或崩溃）
      return {
        fullscreen: false,
        raw: '',
        error: err && err.message ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    });
}

// 节流缓存（模块级单写者）：detectForegroundFullscreen 同步返回**最近一次**结果，
// 过期就顺手在后台刷新一次。主进程每 2s 调一次，调度/渲染永远不被探测阻塞。
let cache = { at: 0, value: false, raw: '', error: null, pending: null };

function resetForegroundFullscreenCache() {
  cache = { at: 0, value: false, raw: '', error: null, pending: null };
}

function foregroundFullscreenStatus() {
  return { at: cache.at, fullscreen: cache.value, raw: cache.raw, error: cache.error, pending: Boolean(cache.pending) };
}

/**
 * 【P1-3】可单独调用的全屏探测入口。
 * - 默认（同步）：返回最近一次结果（Boolean），过期则后台刷新 —— 主进程用这个；
 * - `{ wait: true }`：真跑一次并把 Promise 交回去（`--self-check` / 手工自测用这个，
 *   证明探测**真的出结果**，而不只是接口存在）；
 * - `{ runner: fn }`：注入替身（自证门里 mock，零依赖）。
 */
function detectForegroundFullscreen(options) {
  const o = options || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const throttleMs = Number.isFinite(o.throttleMs) ? o.throttleMs : FULLSCREEN_THROTTLE_MS;
  if (o.wait) {
    return probeForegroundFullscreen(o).then(function (result) {
      cache = { at: Date.now(), value: result.fullscreen, raw: result.raw, error: result.error, pending: null };
      return result;
    });
  }
  const stale = !cache.at || now - cache.at >= throttleMs;
  if (o.refresh !== false && stale && !cache.pending) {
    const pending = probeForegroundFullscreen(o).then(function (result) {
      cache = { at: Date.now(), value: result.fullscreen, raw: result.raw, error: result.error, pending: null };
      return result;
    });
    cache.pending = pending;
  }
  return cache.value;
}

module.exports = {
  FULLSCREEN_THROTTLE_MS,
  PROBE_TIMEOUT_MS,
  TYPING_BURST_WINDOW_MS,
  TYPING_BURST_MIN_KEYS,
  FULLSCREEN_PROBE_SCRIPT,
  quietReasons,
  shouldBeQuiet,
  recordKeystroke,
  isTypingBurst,
  parseFullscreenProbe,
  encodePowerShell,
  probeForegroundFullscreen,
  detectForegroundFullscreen,
  resetForegroundFullscreenCache,
  foregroundFullscreenStatus,
};
