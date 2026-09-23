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

const SCHEMA_VERSION = 1;

// .env 在项目根目录，路径由 main.js 注入（path.join(__dirname, '..', '.env')）。
const ENV_FILE_HINT = '.env';

const SIZE_MIN = 60;
const SIZE_MAX = 180;
const SIZE_DEFAULT = 120;
const NICKNAME_MAX = 24;
const NICKNAME_DEFAULT = '琉斯';

const DEFAULT_CONFIG = {
  schemaVersion: SCHEMA_VERSION,
  nickname: NICKNAME_DEFAULT,
  size: SIZE_DEFAULT,
  proactiveEnabled: true,
  launchAtLogin: false,
  deepNightEnabled: true,
};

const DEFAULT_STATE = {
  schemaVersion: SCHEMA_VERSION,
  x: null,
  y: null,
  paused: false,
  pinned: false,
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
    scheduler: isPlainObject(merged.scheduler) ? Object.assign({}, merged.scheduler) : {},
  };
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

function loadConfig(filePath) {
  return coerceConfig(readJsonSafe(filePath));
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
function ensureConfig(filePath) {
  const raw = readJsonSafe(filePath);
  if (raw === null) {
    try {
      return saveConfig(filePath, DEFAULT_CONFIG);
    } catch (err) {
      return coerceConfig(null);
    }
  }
  return coerceConfig(raw);
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
  DEFAULT_CONFIG,
  DEFAULT_STATE,
  isPlainObject,
  mergeDefaults,
  clampSize,
  coerceConfig,
  coerceState,
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
