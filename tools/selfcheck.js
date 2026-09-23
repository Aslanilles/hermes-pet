'use strict';

/**
 * `npx electron . --self-check` 用的深度自检脚本。
 *
 * 冒烟测试（--smoke-test）只证明「窗口 + 托盘 + 猫渲染出来了」；
 * 这里再往下凿一层，把交互链路真正跑一遍：点击 -> 气泡升起 -> 窗口变高 ->
 * 发消息拿回复 -> Esc 关闭 -> 窗口收回 -> 设置面板加载并回填配置。
 *
 * 纯 Node，不 require('electron')；所有能力由 main.js 通过 ctx 注入。
 */

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitFor(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + (timeoutMs || 10000);
  for (;;) {
    let value = null;
    try {
      value = await fn();
    } catch (err) {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs || 120);
  }
}

/** 在渲染进程里执行一个小函数（序列化，避免拼字符串带来的引号问题）。 */
function evalInPage(webContents, fn, arg) {
  const source = '(' + fn.toString() + ')(' + (arg === undefined ? '' : JSON.stringify(arg)) + ')';
  return webContents.executeJavaScript(source);
}

async function runSelfCheck(ctx) {
  const steps = [];
  function record(name, ok, detail) {
    steps.push({ name: name, ok: Boolean(ok), detail: detail == null ? '' : String(detail) });
  }

  const win = ctx.win;
  record('window-visible', Boolean(win && !win.isDestroyed() && win.isVisible()), '窗口可见');
  record('tray-created', Boolean(ctx.tray && !ctx.tray.isDestroyed()), '托盘图标已创建');

  const report = await waitFor(function () {
    return ctx.rendererReport();
  }, 15000, 150);
  record('renderer-ready', Boolean(report && report.catRendered), report ? JSON.stringify(report) : '渲染进程未上报 pet:ready');

  const dom = await evalInPage(win.webContents, function () {
    const cat = document.getElementById('cat');
    const bubble = document.getElementById('bubble');
    return {
      hasCat: Boolean(cat),
      hasBubble: Boolean(bubble),
      backgroundPosition: cat ? window.getComputedStyle(cat).backgroundPosition : null,
      petState: window.hermes.pet.state(),
      petSize: document.documentElement.style.getPropertyValue('--pet-size'),
    };
  });
  record('sprite-applied', dom.hasCat && dom.backgroundPosition === '-96px -96px', 'background-position=' + dom.backgroundPosition);
  record('state-machine-idle', dom.petState === 'idle', 'state=' + dom.petState);
  record('pet-size-var', dom.petSize === ctx.config.size + 'px', '--pet-size=' + dom.petSize);

  // 先确保气泡是关的，再点一次猫
  await evalInPage(win.webContents, function () {
    const input = document.getElementById('input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  });
  await sleep(400);
  const collapsed = win.getBounds();

  await evalInPage(win.webContents, function () {
    const slot = document.getElementById('cat-slot');
    const rect = slot.getBoundingClientRect();
    const x = window.screenX + rect.left + rect.width / 2;
    const y = window.screenY + rect.top + rect.height / 2;
    slot.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, screenX: x, screenY: y }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, screenX: x, screenY: y }));
    return true;
  });
  await sleep(600);
  const opened = win.getBounds();
  const afterClick = await evalInPage(win.webContents, function () {
    const bubble = document.getElementById('bubble');
    const composer = document.getElementById('composer');
    return {
      bubbleHidden: bubble.classList.contains('is-hidden'),
      composerVisible: !composer.classList.contains('is-hidden'),
      bubbleWidth: Math.round(bubble.getBoundingClientRect().width),
    };
  });
  record('click-opens-dialogue', afterClick.bubbleHidden === false && afterClick.composerVisible === true, JSON.stringify(afterClick));
  record('window-grows-for-bubble', opened.height > collapsed.height, collapsed.height + ' -> ' + opened.height);
  record('bubble-width-capped', afterClick.bubbleWidth <= 320, '宽度 ' + afterClick.bubbleWidth + 'px（上限 320）');

  const reply = await evalInPage(win.webContents, function () {
    return window.hermes.send('你好').then(function (res) {
      return { text: res.text, source: res.source, degraded: res.degraded };
    });
  });
  record('chat-reply', Boolean(reply && reply.text && reply.text.length > 0), (reply && reply.source) + ' -> ' + (reply && reply.text));
  record('chat-no-status-code-leak', !/[0-9]{3}/.test(String(reply && reply.text)), '气泡文案里没有状态码');

  // P1-4：走**真实 submit 路径**（输入框 + Enter，不是直接调 send）。
  // 网关慢的时候气泡必须先给「在想…」，否则用户看到的是空气泡 = 以为对话坏了。
  const submitFlow = await evalInPage(win.webContents, function () {
    const input = document.getElementById('input');
    const bubbleText = document.getElementById('bubble-text');
    input.value = '慢一点回我';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const started = Date.now();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return new Promise(function (resolve) {
      const thinkingText = '在想…';
      let sawThinking = false;
      let repliedAt = 0;
      let lastText = null;
      let stableTicks = 0;
      const timer = setInterval(function () {
        const text = String(bubbleText.textContent || '');
        const elapsed = Date.now() - started;
        const isThinking = text.length > 0 && thinkingText.indexOf(text) === 0; // 在 / 在想 / 在想…
        if (isThinking) sawThinking = true;
        else if (text.length > 0 && !repliedAt) repliedAt = elapsed;
        if (text.length > 0 && text === lastText) stableTicks += 1;
        else stableTicks = 0;
        lastText = text;
        const settled = repliedAt > 0 && stableTicks >= 2 && !isThinking;
        if ((settled && (sawThinking || repliedAt < 1500)) || elapsed > 20000) {
          clearInterval(timer);
          resolve({ sawThinking: sawThinking, repliedAt: repliedAt, elapsedMs: elapsed, finalText: text });
        }
      }, 80);
    });
  });
  const thinkOk = Boolean(submitFlow) && (submitFlow.sawThinking === true || submitFlow.repliedAt < 1500);
  record(
    'chat-thinking-feedback',
    thinkOk,
    'sawThinking=' + (submitFlow && submitFlow.sawThinking) + ' repliedAt=' + (submitFlow && submitFlow.repliedAt) + 'ms'
  );
  record(
    'chat-submit-path-answered',
    Boolean(submitFlow && submitFlow.finalText && submitFlow.finalText.length > 0) && !/[0-9]{3}/.test(String(submitFlow.finalText)),
    '气泡最终文案=' + (submitFlow && submitFlow.finalText)
  );

  await evalInPage(win.webContents, function () {
    const input = document.getElementById('input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  });
  await sleep(500);
  const closed = win.getBounds();
  record('esc-closes-and-shrinks', closed.height === collapsed.height, closed.height + ' vs ' + collapsed.height);

  ctx.openSettings();
  const settingsWin = await waitFor(function () {
    return ctx.settingsWindow();
  }, 6000, 150);
  record('settings-window', Boolean(settingsWin), settingsWin ? '已创建' : '未创建');

  if (settingsWin && !settingsWin.isDestroyed()) {
    await waitFor(function () {
      return !settingsWin.webContents.isLoading();
    }, 6000, 100);
    const settingsDom = await evalInPage(settingsWin.webContents, function () {
      const nickname = document.getElementById('nickname');
      const size = document.getElementById('size');
      return {
        nickname: nickname ? nickname.value : null,
        size: size ? size.value : null,
        hasBridge: Boolean(window.hermes && window.hermes.setConfig),
      };
    });
    record('settings-bound-to-config', settingsDom.nickname === ctx.config.nickname && settingsDom.size === String(ctx.config.size), JSON.stringify(settingsDom));
    ctx.closeSettings();
  }

  const failed = steps.filter(function (step) {
    return !step.ok;
  });
  return { ok: failed.length === 0, steps: steps, failed: failed };
}

module.exports = { runSelfCheck };
