'use strict';

/**
 * adapter 选择与降级。上层（main.js）只需要 await service.reply(text)。
 *
 * 规则：配了 HERMES_GATEWAY_URL 就优先走网关；未配置 / 超时 / 5xx / 网络不通，
 * 一律降级到 local-mock，并给一句人话提示（气泡里不出现 HTTP 状态码，也不出现任何密钥）。
 */

const { createLocalMockAdapter } = require('./local-mock');
const {
  GatewayError,
  loadGatewayUrl,
  loadApiKey,
  createHermesGatewayAdapter,
  DEFAULT_TIMEOUT_MS,
} = require('./hermes-gateway');

const DEGRADE_NOTICE = {
  not_configured: '后端还没接上，我先用自己的小脑袋回你。',
  timeout: '那边一直没吭声，我先用自己的话答你。',
  network: '网关没连上，我先用自己的话答你。',
  http_error: '网关那边没接住这条，我先用自己的话答你。',
  bad_response: '网关回了句看不懂的，我先用自己的话答你。',
  bad_payload: '网关回了句空的，我先用自己的话答你。',
  unsupported: '这台机器上连不上网关，我先用自己的话答你。',
  unknown: '那边出了点状况，我自己接一句。',
};

function noticeFor(code) {
  return DEGRADE_NOTICE[code] || DEGRADE_NOTICE.unknown;
}

function createReplyService(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const url = loadGatewayUrl({ envPath: opts.envPath, env: env });
  const apiKey = loadApiKey({ envPath: opts.envPath, env: env });
  const fallback = createLocalMockAdapter({ rng: opts.rng });
  const primary = url
    ? createHermesGatewayAdapter({
        url: url,
        apiKey: apiKey,
        timeoutMs: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS,
        fetchImpl: opts.fetchImpl,
      })
    : null;

  async function reply(text, ctx) {
    if (!primary) {
      const local = await fallback.reply(text, ctx);
      return Object.assign({}, local, { degraded: false, primary: fallback.name });
    }
    try {
      const remote = await primary.reply(text, ctx);
      return Object.assign({}, remote, { degraded: false, primary: primary.name });
    } catch (err) {
      // 只认 GatewayError 的分类；其余异常一律当作 unknown。
      // 关键：**任何异常都不允许冒泡到渲染进程**（否则气泡不动或白屏）。
      const code = err instanceof GatewayError ? err.code : 'unknown';
      const local = await fallback.reply(text, ctx);
      return Object.assign({}, local, {
        degraded: true,
        primary: primary.name,
        degradeCode: code,
        notice: noticeFor(code),
      });
    }
  }

  return {
    primaryName: primary ? primary.name : fallback.name,
    fallbackName: fallback.name,
    gatewayConfigured: Boolean(primary),
    reply: reply,
  };
}

module.exports = { DEGRADE_NOTICE, noticeFor, createReplyService };
