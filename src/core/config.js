'use strict';

/**
 * 配置 / 状态读写（纯 Node，禁止 require('electron')，路径由调用方注入）。
 *
 * 三条硬要求：
 * 1) 默认值合并：缺字段就补默认值，不因为老版本文件缺字段而崩。
 * 2) 原子写：先写 *.tmp，再 rename 覆盖，掉电不会写出半个文件。
 * 3) 损坏 / 缺失回落默认值，绝不抛给上层（上层拿到的一定是可用的对象）。
 */

const fs = require('fs');
const path = require('path');

// schemaVersion 1 -> 2（M1）：新增 config.dnd / config.shortcuts / state.onboarded，
// 并且把「旧语义的 nickname='琉斯'」迁移成 '你'（猫名写死在自我介绍里，不进这个字段）。
const SCHEMA_VERSION = 2;

// .env 在项目根目录，路径由 main.js 注入（path.join(__dirname, '..', '.env')）。
const ENV_FILE_HINT = '.env';

const SIZE_MIN = 60;
const SIZE_MAX = 180;
const SIZE_DEFAULT = 120;
const NICKNAME_MAX = 24;
// NICKNAME_DEFAULT = 猫对用户的称呼（猫名「琉斯」写死在自我介绍里，不进此字段）。
const NICKNAME_DEFAULT = '琉斯';
const ONBOARD_NICKNAME = '你'; // A1：跳过 / 拒绝起名时先这么叫

// A7 全局快捷键默认四键（Esc 不进、不可自定义：全局抢 Esc 是灾难）。
const SHORTCUT_KEYS = ['toggle', 'chat', 'settings', 'mute'];
const DEFAULT_SHORTCUTS = {
  toggle: 'Alt+H', // 显示 / 隐藏
  chat: 'Alt+T', // 打开对话输入框
  settings: 'Alt+S', // 打开设置面板
  mute: 'Alt+M', // 静音（= proactiveEnabled 取反，不复用 paused）
};
const MODIFIER_NAMES = ['Ctrl', 'Control', 'Alt', 'Shift', 'Super', 'Cmd', 'Command'];
const NAMED_ACCELERATOR_KEYS = ['Space', 'Tab', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'Insert', 'Delete', 'PageUp', 'PageDown'];

const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  nickname: NICKNAME_DEFAULT,
  size: SIZE_DEFAULT,
  proactiveEnabled: true,
  launchAtLogin: false,
  deepNightEnabled: true,
  dnd: false, // A5 别烦我 / 透明模式（偏好级；与会话级 paused 分家）
  shortcuts: DEFAULT_SHORTCUTS, // A7 四键绑定
};

const DEFAULT_STATE = {
  schemaVersion: SCHEMA_VERSION,
  x: null,
  y: null,
  paused: false,
  pinned: false,
  onboarded: false, // A1 初见流程走完没有（缺字段 -> false -> 走初见）
  scheduler: {},
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 只取 defaults 里声明过的键做合并（未知字段一律丢弃，避免脏数据扩散）。 */
function mergeDefaults(raw, defaults) {
  const out = Object.assign({}, defaults);
  if (!isPlainObject(raw)) return out;
  Object.keys(defaults).forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined && raw[key] !== null) {
      out[key] = raw[key];
    }
  });
  return out;
}

function clampSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SIZE_DEFAULT;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));
}

function coerceNickname(value) {
  if (typeof value !== 'string') return NICKNAME_DEFAULT;
  const trimmed = value.trim();
  if (!trimmed) return NICKNAME_DEFAULT;
  return trimmed.slice(0, NICKNAME_MAX);
}

function coerceBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * A4 滚轮缩放：+1 -> round(size * 1.1)、-1 -> round(size * 0.9)，再夹到 60-180。
 * 120 -> 132 -> 145 -> 159（验收：滚轮上 3 次）；到界不再动（60 / 180）。
 */
function zoomSize(size, delta) {
  const base = clampSize(size);
  const direction = Number(delta) >= 0 ? 1 : -1;
  // 先减掉一个远小于 1px 的 epsilon 再取整：浮点误差会把 145 × 1.1 算成 159.50000000000003，
  // 直接四舍五入得 160，与 docs/M1R1-features.md §A4 的验收链 120→132→145→159 冲突。
  const scaled = (base * (direction > 0 ? 11 : 9)) / 10;
  return clampSize(Math.round(scaled - 1e-6));
}

/**
 * A1【P1-5】用户名字净化。顺序**写死**（改顺序会改变结果）：
 *   ① 去掉控制字符 \u0000-\u001F（含 \r \n \t）-> ② trim -> ③ 截断 24 字。
 * 空 / 纯空白 / 非字符串 -> 空串（由调用方决定「继续等」还是回落默认值）——
 * 注意这里**不**回落 NICKNAME_DEFAULT：起名流程要能区分「用户还没输入」。
 */
function normaliseUserName(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, NICKNAME_MAX);
}

/** 单个加速键是否合法（末段：单个字母数字 / F1-F24 / 少数命名键）。Esc 绝不进全局。 */
function isAcceleratorKey(value) {
  if (typeof value !== 'string' || !value) return false;
  if (/^[A-Za-z0-9]$/.test(value)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(value)) return true;
  return NAMED_ACCELERATOR_KEYS.indexOf(value) >= 0;
}

/** 绑定串是否合法：`修饰键(+修饰键)*+加速键`，修饰键至少一个。 */
function isValidShortcut(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('+').map(function (part) {
    return part.trim();
  });
  if (parts.length < 2 || parts.some(function (part) { return !part; })) return false;
  const key = parts[parts.length - 1];
  if (!isAcceleratorKey(key)) return false;
  return parts.slice(0, -1).every(function (modifier) {
    return MODIFIER_NAMES.indexOf(modifier) >= 0;
  });
}

/**
 * A7 快捷键校验：四键名必须在、绑定串格式合法、**四键不许撞车**；
 * 任何一条不合法就整项回落默认（宁可回到 Alt+H，也不要留一个按不出来的键）。
 */
function coerceShortcuts(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const out = {};
  const used = {};
  const invalid = SHORTCUT_KEYS.some(function (key) {
    const value = source[key];
    if (value !== undefined && value !== null && !isValidShortcut(value)) return true;
    const candidate = isValidShortcut(value) ? value : DEFAULT_SHORTCUTS[key];
    if (used[candidate]) return true;
    used[candidate] = true;
    out[key] = candidate;
    return false;
  });
  if (invalid) return Object.assign({}, DEFAULT_SHORTCUTS);
  return out;
}

/**
 * 读一个坐标：null / undefined / 空串 / 非数字 一律 -> null（「没有坐标」）。
 * 注意 Number(null) === 0：老实现把「文件里没有 x」读成了「x = 0」，
 * 于是首启窗口落在屏幕左上角（FIX-ROUND3 FIX-1 的根因），这里显式挡掉。
 */
function coerceCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 校验 + 归一化用户配置。任何非法值都回落到合法值，不抛错。 */
function coerceConfig(raw) {
  const merged = mergeDefaults(raw, DEFAULT_CONFIG);
  return {
    schemaVersion: SCHEMA_VERSION,
    nickname: coerceNickname(merged.nickname),
    size: clampSize(merged.size),
    proactiveEnabled: coerceBool(merged.proactiveEnabled, DEFAULT_CONFIG.proactiveEnabled),
    launchAtLogin: coerceBool(merged.launchAtLogin, DEFAULT_CONFIG.launchAtLogin),
    deepNightEnabled: coerceBool(merged.deepNightEnabled, DEFAULT_CONFIG.deepNightEnabled),
    dnd: coerceBool(merged.dnd, DEFAULT_CONFIG.dnd),
    shortcuts: coerceShortcuts(merged.shortcuts),
  };
}

function coerceState(raw) {
  const merged = mergeDefaults(raw, DEFAULT_STATE);
  return {
    schemaVersion: SCHEMA_VERSION,
    x: coerceCoord(merged.x),
    y: coerceCoord(merged.y),
    paused: coerceBool(merged.paused, false),
    pinned: coerceBool(merged.pinned, false),
    onboarded: coerceBool(merged.onboarded, false),
    scheduler: isPlainObject(merged.scheduler) ? Object.assign({}, merged.scheduler) : {},
  };
}

/**
 * A1【P0-2】旧语义迁移（**独立纯函数**，只在 loadConfig / ensureConfig 层调用；
 * 绝不下沉进 coerceNickname —— 那会把 tests/config.test.js 的「'  琉斯  ' -> '琉斯'」当场弄红）。
 *
 * 规则：schemaVersion < 2 且 nickname === '琉斯' 且 state 里**没有** onboarded 字段
 *       -> 判「旧语义残留」：nickname = '你'、onboarded = false（走一遍初见流程）。
 * 不管是否残留，schemaVersion 一律 1 -> 2。
 *
 * 签名必须**同时**拿到 config 与 state（第三个条件要看 state 有没有 onboarded 字段）；
 * rawState 传 null 表示「没有 state.json」，按没有 onboarded 处理。
 *
 * 返回 { config, state, changed, reason }：调用方只写回自己那份，changed=false 就不写盘。
 */
function migrateConfig(rawConfig, rawState) {
  const config = isPlainObject(rawConfig) ? rawConfig : {};
  const state = isPlainObject(rawState) ? rawState : null;
  const version = Number(config.schemaVersion);
  const legacyVersion = !Number.isFinite(version) || version < SCHEMA_VERSION;
  const hasOnboarded = Boolean(state) && Object.prototype.hasOwnProperty.call(state, 'onboarded');
  if (legacyVersion && config.nickname === NICKNAME_DEFAULT && !hasOnboarded) {
    return {
      config: Object.assign({}, config, { schemaVersion: SCHEMA_VERSION, nickname: ONBOARD_NICKNAME }),
      state: Object.assign({}, state || {}, { onboarded: false }),
      changed: true,
      reason: 'legacy-nickname',
    };
  }
  if (legacyVersion) {
    return {
      config: Object.assign({}, config, { schemaVersion: SCHEMA_VERSION }),
      state: state,
      changed: true,
      reason: 'schema-version',
    };
  }
  return { config: config, state: state, changed: false, reason: 'current' };
}

/** 读 JSON：文件缺失 / 空 / 损坏 / 类型不对，一律返回 null（由调用方回落默认值）。 */
function readJsonSafe(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

/**
 * 手写的极简 .env 解析（不引 dotenv 之类的依赖）。
 * 规则：按行 trim；跳过空行与 # 开头；按**第一个** = 切分；去掉成对引号。
 * 不支持多行值、不支持变量展开。返回值只给主进程用，绝不写日志。
 */
function parseDotEnv(text) {
  const out = {};
  String(text == null ? '' : text)
    .split(/\r?\n/)
    .forEach(function (line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.charAt(0) === '#') return;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      const key = trimmed.slice(0, eq).trim();
      if (!key) return;
      let value = trimmed.slice(eq + 1).trim();
      const first = value.charAt(0);
      if (value.length >= 2 && (first === '\u0027' || first === '\u0022') && value.charAt(value.length - 1) === first) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    });
  return out;
}

/** 环境变量优先，其次 .env 文件；都没有返回 null。文件不存在不算错误。 */
function readEnvValue(envPath, key, env) {
  const source = env || (typeof process !== 'undefined' ? process.env : null) || {};
  const fromEnv = source[key];
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  if (envPath) {
    try {
      const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
      const fromFile = parsed[key];
      if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim();
    } catch (err) {
      return null;
    }
  }
  return null;
}

/** 原子写：先写 <file>.tmp，fsync 后 rename 覆盖。 */
function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  const payload = JSON.stringify(value, null, 2) + '\n';
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

/**
 * 读配置。给了 statePath 就先跑一遍 migrateConfig（P0-2）；
 * 文件缺失 / 损坏（readJsonSafe -> null）**不迁移** —— 那本来就是「全新用户」，
 * 直接拿默认值即可（也因此不会把「首启默认值」误判成「旧语义残留」）。
 */
function loadConfig(filePath, statePath) {
  const raw = readJsonSafe(filePath);
  if (raw === null) return coerceConfig(null);
  const state = statePath ? readJsonSafe(statePath) : null;
  return coerceConfig(migrateConfig(raw, state).config);
}

function saveConfig(filePath, config) {
  const next = coerceConfig(config);
  writeJsonAtomic(filePath, next);
  return next;
}

/**
 * 首启就把默认配置落盘（原子写）。文件缺失 / 空 / 损坏 -> 写一份含**全部默认值**的
 * config.json；已经能解析的文件原样返回，绝不覆盖用户改过的值。
 * 这样「设置持久化」这条功能可以打开文件直接验收，以后加字段也有迁移锚点
 * （FIX-ROUND3 FIX-3）。写盘失败（只读目录等）也不能让程序起不来。
 */
function ensureConfig(filePath, statePath) {
  const raw = readJsonSafe(filePath);
  if (raw === null) {
    try {
      return saveConfig(filePath, DEFAULT_CONFIG);
    } catch (err) {
      return coerceConfig(null);
    }
  }
  const rawState = statePath ? readJsonSafe(statePath) : null;
  const migrated = migrateConfig(raw, rawState);
  if (migrated.changed) {
    // 迁移结果**落盘**（否则每次启动都要重判一遍，而且设置面板会一直显示旧值）
    try {
      writeJsonAtomic(filePath, coerceConfig(migrated.config));
      if (statePath && migrated.state) writeJsonAtomic(statePath, coerceState(migrated.state));
    } catch (err) {
      /* 只读目录 / 落盘失败也不能让程序起不来：内存里仍用迁移后的值 */
    }
  }
  return coerceConfig(migrated.config);
}

function patchConfig(filePath, patch) {
  const current = loadConfig(filePath);
  return saveConfig(filePath, Object.assign({}, current, isPlainObject(patch) ? patch : {}));
}

function loadState(filePath) {
  return coerceState(readJsonSafe(filePath));
}

function saveState(filePath, state) {
  const next = coerceState(state);
  writeJsonAtomic(filePath, next);
  return next;
}

module.exports = {
  SCHEMA_VERSION,
  ENV_FILE_HINT,
  SIZE_MIN,
  SIZE_MAX,
  SIZE_DEFAULT,
  NICKNAME_MAX,
  NICKNAME_DEFAULT,
  ONBOARD_NICKNAME,
  SHORTCUT_KEYS,
  DEFAULT_SHORTCUTS,
  DEFAULT_CONFIG,
  DEFAULT_STATE,
  isPlainObject,
  mergeDefaults,
  clampSize,
  zoomSize,
  normaliseUserName,
  isAcceleratorKey,
  isValidShortcut,
  coerceShortcuts,
  coerceConfig,
  coerceState,
  migrateConfig,
  readJsonSafe,
  parseDotEnv,
  readEnvValue,
  writeJsonAtomic,
  loadConfig,
  saveConfig,
  ensureConfig,
  patchConfig,
  loadState,
  saveState,
};
