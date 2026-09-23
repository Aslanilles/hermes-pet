'use strict';

/**
 * 本地网关测试替身（**dev tool，不属于产品运行时**）。
 *
 * 用途：在宿主上真跑一遍 P1-2 冻结协议，证明「适配器 -> 网关 -> 取值」这条链路
 * 不是永远走降级的假绿。零依赖，只用 node:http。
 *
 *   node tools/gateway_stub.js [port=8742] [delayMs=0]
 *
 * 只认 POST /v1/chat/completions，回 { choices: [{ message: { content } }] }；
 * 会把收到的 prompt 与「有没有带 Authorization 头」写进回复，方便肉眼确认。
 */

const http = require('node:http');

const port = Number(process.argv[2]) || 8742;
const delayMs = Number(process.argv[3]) || 0;
const CHAT_PATH = '/v1/chat/completions';

function handle(req, res) {
  const chunks = [];
  req.on('data', function (chunk) {
    chunks.push(chunk);
  });
  req.on('end', function () {
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      body = null;
    }
    const first = body && Array.isArray(body.messages) && body.messages.length ? body.messages[0] : null;
    const prompt = first ? String(first.content) : '';
    const hasAuth = Boolean(req.headers.authorization);
    const valid = req.method === 'POST' && req.url === CHAT_PATH && body && body.model === 'default' && prompt;
    const reply = '本地替身网关收到「' + prompt + '」' + (hasAuth ? '，鉴权头已带上。' : '，没有鉴权头。');
    const payload = valid ? { choices: [{ message: { content: reply } }] } : { error: 'bad request' };
    const send = function () {
      res.writeHead(valid ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  });
}

const server = http.createServer(handle);
server.listen(port, '127.0.0.1', function () {
  process.stdout.write('gateway stub: http://127.0.0.1:' + port + CHAT_PATH + ' delay=' + delayMs + 'ms\n');
});
