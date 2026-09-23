'use strict';

/**
 * 默认 adapter：本地 mock 关键词回复。零网络、零依赖、纯函数，可单测。
 */

const replies = require('../core/replies');

const ADAPTER_NAME = 'local-mock';

function createLocalMockAdapter(options) {
  const opts = options || {};
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;

  async function reply(text) {
    const hit = replies.matchReply(text, { rng: rng });
    return { text: hit.text, source: ADAPTER_NAME, matched: hit.matched, ruleId: hit.ruleId };
  }

  return { name: ADAPTER_NAME, configured: true, reply: reply };
}

module.exports = { ADAPTER_NAME, createLocalMockAdapter };
