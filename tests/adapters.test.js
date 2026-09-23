'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReplyService, noticeFor } = require('../src/adapters');
const {
  AdapterError,
  GatewayError,
  mapReason,
  createHermesGatewayAdapter,
  parseDotEnv,
  readEnvValue,
} = require('../src/adapters/hermes-gateway');
const { createLocalMockAdapter } = require('../src/adapters/local-mock');

test('local-mock：默认可用，命中关键词，返回 source=local-mock', async () => {
  const adapter = createLocalMockAdapter({ rng: function () { return 0; } });
  const result = await adapter.reply('你好');
  assert.equal(result.source, 'local-mock');
  assert.equal(result.matched, true);
  assert.equal(result.ruleId, 'greeting');
  assert.ok(result.text.length > 0);
});

test('未配置 HERMES_GATEWAY_URL 时直接走 local-mock（不降级、不报错）', async () => {
  const svc = createReplyService({ env: {} });
  assert.equal(svc.primaryName, 'local-mock');
  assert.equal(svc.gatewayConfigured, false);
  const result = await svc.reply('这个 bug 报错了');
  assert.equal(result.degraded, false);
  assert.equal(result.source, 'local-mock');
  assert.equal(result.ruleId, 'debug');
});

test('5xx -> 降级到 local-mock，并给人话提示（不含状态码 / HTTP 字样）', async () => {
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid' },
    fetchImpl: async function () {
      return { ok: false, status: 503 };
    },
  });
  assert.equal(svc.primaryName, 'hermes-gateway');
  const result = await svc.reply('你好');
  assert.equal(result.degraded, true);
  assert.equal(result.degradeCode, 'http_error');
  assert.equal(result.source, 'local-mock');
  assert.ok(result.text.length > 0);
  assert.equal(/[0-9]{3}/.test(result.notice), false, '提示里不能出现状态码');
  assert.equal(/HTTP/i.test(result.notice), false);
});

test('超时（10s 上限可注入）-> 降级 timeout', async () => {
  const fetchImpl = function (url, options) {
    return new Promise(function (resolve, reject) {
      if (options && options.signal) {
        options.signal.addEventListener('abort', function () {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
  };
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid' },
    fetchImpl: fetchImpl,
    timeoutMs: 30,
  });
  const result = await svc.reply('你好');
  assert.equal(result.degraded, true);
  assert.equal(result.degradeCode, 'timeout');
  assert.equal(result.source, 'local-mock');
});

test('网络不通 -> 降级 network', async () => {
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid' },
    fetchImpl: async function () {
      const err = new Error('getaddrinfo ENOTFOUND gateway.invalid');
      err.code = 'ENOTFOUND';
      throw err;
    },
  });
  const result = await svc.reply('你好');
  assert.equal(result.degradeCode, 'network');

  // Node 原生 fetch 的真实形状：TypeError(fetch failed)，errno 在 cause 上
  const undici = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid' },
    fetchImpl: async function () {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:8642');
      cause.code = 'ECONNREFUSED';
      throw new TypeError('fetch failed', { cause: cause });
    },
  });
  assert.equal((await undici.reply('你好')).degradeCode, 'network');
});

test('绝不回显密钥：错误路径下返回体里没有 token', async () => {
  const secret = 'sk-this-must-never-leak-12345';
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid', HERMES_API_KEY: secret },
    fetchImpl: async function () {
      return { ok: false, status: 500 };
    },
  });
  const result = await svc.reply('你好');
  assert.equal(JSON.stringify(result).indexOf(secret), -1);
  const adapter = createHermesGatewayAdapter({ url: 'http://gateway.invalid', apiKey: secret });
  const error = await adapter.reply('x').catch(function (err) {
    return err;
  });
  assert.equal(String(error.message).indexOf(secret), -1);
});

test('网关成功时用远端回复，不降级', async () => {
  let seenBody = null;
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid/', HERMES_API_KEY: 'k' },
    fetchImpl: async function (url, options) {
      seenBody = { url: url, body: JSON.parse(options.body), auth: options.headers.Authorization };
      return {
        ok: true,
        status: 200,
        json: async function () {
          return { choices: [{ message: { content: '远端回你一句。' } }] };
        },
      };
    },
  });
  const result = await svc.reply('你好');
  assert.equal(result.text, '远端回你一句。');
  assert.equal(result.source, 'hermes-gateway');
  assert.equal(result.degraded, false);
  assert.equal(seenBody.url, 'http://gateway.invalid/v1/chat/completions');
  assert.equal(seenBody.auth, 'Bearer k');
  assert.equal(seenBody.body.messages[0].content, '你好');
  assert.equal(seenBody.body.model, 'default');
  assert.equal(seenBody.body.stream, false);
});

test('网关返回空内容也算失败 -> 降级', async () => {
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid' },
    fetchImpl: async function () {
      return { ok: true, status: 200, json: async function () { return { choices: [] }; } };
    },
  });
  const result = await svc.reply('你好');
  assert.equal(result.degraded, true);
  assert.equal(result.degradeCode, 'bad_payload');
});

test('未配置时 gateway adapter 抛可识别的 not_configured', async () => {
  const adapter = createHermesGatewayAdapter({ url: null });
  await assert.rejects(
    function () {
      return adapter.reply('x');
    },
    function (err) {
      return err instanceof AdapterError && err.code === 'not_configured';
    }
  );
});

test('.env 解析：只认 KEY=VALUE，忽略注释与引号，不打印内容', () => {
  const parsed = parseDotEnv('# 注释\nHERMES_GATEWAY_URL=http://localhost:8642\n\nHERMES_API_KEY=\u0027quoted-key\u0027\nBAD_LINE\n');
  assert.equal(parsed.HERMES_GATEWAY_URL, 'http://localhost:8642');
  assert.equal(parsed.HERMES_API_KEY, 'quoted-key');
  assert.equal(parsed.BAD_LINE, undefined);
});

test('readEnvValue：环境变量优先于文件，都没有则 null', () => {
  assert.equal(readEnvValue(null, 'HERMES_GATEWAY_URL', { HERMES_GATEWAY_URL: 'http://from-env' }), 'http://from-env');
  assert.equal(readEnvValue('/definitely/not/here.env', 'HERMES_GATEWAY_URL', {}), null);
  assert.equal(readEnvValue('/definitely/not/here.env', 'HERMES_GATEWAY_URL', { OTHER: 'x' }), null);
});

test('降级提示表覆盖全部已知错误码，且都是人话', () => {
  ['not_configured', 'timeout', 'network', 'http_error', 'bad_response', 'bad_payload', 'unsupported', 'unknown'].forEach(function (code) {
    const notice = noticeFor(code);
    assert.ok(notice.length > 0);
    assert.equal(/[0-9]{3}|HTTP|http/i.test(notice), false);
  });
});

test('mapReason 归一四类：超时 / 网络 / 非 JSON / 字段缺失', () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(mapReason(abort), 'timeout');
  const refused = new Error('refused');
  refused.code = 'ECONNREFUSED';
  assert.equal(mapReason(refused), 'network');
  const dns = new Error('dns');
  dns.code = 'ENOTFOUND';
  assert.equal(mapReason(dns), 'network');
  const wrapped = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  assert.equal(mapReason(wrapped), 'network');
  assert.equal(mapReason(new SyntaxError('bad json')), 'bad_response');
  assert.equal(mapReason(null), 'unknown');
  assert.equal(mapReason(new Error('weird')), 'unknown');
  assert.equal(mapReason(new GatewayError('not_configured', 'x')), 'not_configured');
  assert.equal(mapReason(new Error('boom'), 503), 'http_error');
});

test('网关回 HTML（不是 JSON）-> 降级 bad_response，且不把原文回显到气泡', async () => {
  const svc = createReplyService({
    env: { HERMES_GATEWAY_URL: 'http://gateway.invalid' },
    fetchImpl: async function () {
      return {
        ok: true,
        status: 200,
        json: async function () {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      };
    },
  });
  const result = await svc.reply('你好');
  assert.equal(result.degraded, true);
  assert.equal(result.degradeCode, 'bad_response');
  assert.equal(result.source, 'local-mock');
  assert.equal(/Unexpected token|<html|<HTML/i.test(String(result.text) + String(result.notice)), false);
  assert.equal(/[0-9]{3}|http|HTTP/i.test(String(result.notice)), false);
});
