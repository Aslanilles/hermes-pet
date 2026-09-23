'use strict';

/**
 * hermes-gateway adapter：读 .env 的 HERMES_GATEWAY_URL，走 OpenAI 兼容的 chat/completions。
 *
 * 协议（M0 冻结版）：
 *   POST {HERMES_GATEWAY_URL}/v1/chat/completions
 *   headers: Content-Type: application/json; Authorization: Bearer ${HERMES_API_KEY}（配了才带）
 *   body:    { model: 'default', messages: [{ role: 'user', content: text }], stream: false }
 *   取值:    json.choices[0].message.content，非字符串即抛 GatewayError
 *
 * 降级面：**除成功取值外的任何情况**都抛 GatewayError，由 index.js 统一降级到 local-mock。
 * 安全：HERMES_API_KEY 只从 .env 读、只在主进程用、绝不进渲染进程、绝不进日志与错误信息。
 * 纯 Node：禁止 require('electron')（fetch / 时钟 / .env 路径全部由调用方注入）。
 */

const { parseDotEnv, readEnvValue } = require('../core/config');

const ADAPTER_NAME = 'hermes-gateway';
const DEFAULT_TIMEOUT_MS = 10000;
const URL_ENV_KEY = 'HERMES_GATEWAY_URL';
const KEY_ENV_KEY = 'HERMES_API_KEY';
const CHAT_PATH = '/v1/chat/completions';
const MODEL = 'default';

class GatewayError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'GatewayError';
    this.code = code;
  }
}

/** 兼容旧名字（第一轮用它命名），语义完全一致。 */
const AdapterError = GatewayError;

/**
 * 把任意异常归一成四类可识别原因，外加 http_error / not_configured。
 * 注意：这里**只提取类别**，不把 URL、状态码、堆栈塞进 message。
 */
function mapReason(err, status) {
  if (err instanceof GatewayError) return err.code;
  if (status && status >= 400) return 'http_error';
  if (!err) return 'unknown';
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || (err.cause && err.cause.name === 'AbortError')) {
    return 'timeout';
  }
  if (err instanceof SyntaxError || err.name === 'SyntaxError') return 'bad_response';
  // Node 的 fetch 失败是 TypeError('fetch failed')，真正的 errno 藏在 err.cause.code
  const code = err.code || (err.cause && err.cause.code);
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'EAI_AGAIN' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  ) {
    return 'network';
  }
  if (code === 'EMPTY_CONTENT' || code === 'BAD_PAYLOAD') return 'bad_payload';
  return 'unknown';
}

function loadGatewayUrl(options) {
  const opts = options || {};
  return readEnvValue(opts.envPath, URL_ENV_KEY, opts.env);
}

function loadApiKey(options) {
  const opts = options || {};
  return readEnvValue(opts.envPath, KEY_ENV_KEY, opts.env);
}

/** 严格取值：choices[0].message.content 必须是非空字符串，否则算失败（降级）。 */
function pickContent(data) {
  if (!data || typeof data !== 'object') return null;
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const message = first.message;
  if (!message || typeof message !== 'object') return null;
  const content = message.content;
  if (typeof content !== 'string' || !content.trim()) return null;
  return content.trim();
}

function createHermesGatewayAdapter(options) {
  const opts = options || {};
  const url = opts.url || null;
  const apiKey = opts.apiKey || null;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  const endpoint = url ? url.replace(/\/+$/, '') + CHAT_PATH : null;

  async function reply(text) {
    if (!url) throw new GatewayError('not_configured', 'gateway url is not configured');
    if (typeof fetchImpl !== 'function') throw new GatewayError('unsupported', 'fetch is unavailable');

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(function () {
      if (controller) controller.abort();
    }, timeoutMs);
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    let status = 0;

    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: String(text == null ? '' : text) }],
          stream: false,
        }),
        signal: controller ? controller.signal : undefined,
      });
      if (!res || typeof res.ok !== 'boolean') throw new GatewayError('network', 'gateway response invalid');
      status = Number.isFinite(res.status) ? res.status : 0;
      if (!res.ok) throw new GatewayError('http_error', 'gateway responded with an error');
      let data = null;
      try {
        data = await res.json();
      } catch (parseErr) {
        throw new GatewayError('bad_response', 'gateway response is not json');
      }
      const content = pickContent(data);
      if (!content) throw new GatewayError('bad_payload', 'gateway response has no usable content');
      return { text: content, source: ADAPTER_NAME };
    } catch (err) {
      const code = mapReason(err, status);
      throw new GatewayError(code, 'gateway call failed: ' + code);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: ADAPTER_NAME,
    configured: Boolean(url),
    endpoint: endpoint,
    model: MODEL,
    reply: reply,
  };
}

module.exports = {
  ADAPTER_NAME,
  DEFAULT_TIMEOUT_MS,
  URL_ENV_KEY,
  KEY_ENV_KEY,
  CHAT_PATH,
  MODEL,
  GatewayError,
  AdapterError,
  mapReason,
  parseDotEnv,
  readEnvValue,
  loadGatewayUrl,
  loadApiKey,
  pickContent,
  createHermesGatewayAdapter,
};
