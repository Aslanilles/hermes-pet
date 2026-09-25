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

// M1-R1【P1-6】新增自证门只读**纯逻辑 / 状态机 / config**（绝不读会被光标或命中态合法改写的活状态）。
// 这些模块本身禁止 require('electron')，容器里也被 node --test 覆盖过，这里直接引用同一份真源码。
const configCore = require('../src/core/config');
const positionCore = require('../src/core/position');
const schedulerCore = require('../src/core/scheduler');
const stateCore = require('../src/core/state-machine');
const walkCore = require('../src/core/walk');
const quietCore = require('../src/core/quiet');

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

// FIX-ROUND3 FIX-2 验收用的长中文文本：136px 宽的气泡里必然换行 + 超出 400px 上限 -> 必须能滚
const LONG_TEXT = '拆解它。把大目标拆成今天能做完的一小步，再拆成现在能做的第一步。'.repeat(6);

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

  // FIX-ROUND3 FIX-2 验收：把猫摆到 workArea 的最右 / 最下角（拖拽 clamp 允许的极限，
  // 窗口只留 48px 在屏内），再塞一段长文本 —— 气泡必须仍然完整可见、且能滚动。
  const originalBase = ctx.petBaseBounds();
  ctx.placePet({
    x: ctx.workArea.x + ctx.workArea.width - ctx.minVisible(),
    y: ctx.workArea.y + ctx.workArea.height - ctx.minVisible(),
    width: originalBase.width,
    height: originalBase.height,
  });
  await sleep(400);
  await evalInPage(win.webContents, function (text) {
    const bubble = document.getElementById('bubble');
    const bubbleText = document.getElementById('bubble-text');
    bubbleText.textContent = text;
    const rect = bubble.getBoundingClientRect();
    window.hermes.bubbleResize({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
    return true;
  }, LONG_TEXT);
  await sleep(800);
  const atEdge = await evalInPage(win.webContents, function () {
    const bubble = document.getElementById('bubble');
    const rect = bubble.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      left: Math.round(window.screenX + rect.left),
      top: Math.round(window.screenY + rect.top),
      right: Math.round(window.screenX + rect.right),
      bottom: Math.round(window.screenY + rect.bottom),
      scrollable: bubble.scrollHeight > bubble.clientHeight + 1,
    };
  });
  const inArea =
    Boolean(atEdge) &&
    atEdge.left >= ctx.workArea.x &&
    atEdge.right <= ctx.workArea.x + ctx.workArea.width &&
    atEdge.top >= ctx.workArea.y &&
    atEdge.bottom <= ctx.workArea.y + ctx.workArea.height;
  record(
    'bubble-fully-visible-at-screen-edge',
    inArea,
    '气泡屏幕矩形=' + JSON.stringify(atEdge) + ' workArea=' + JSON.stringify(ctx.workArea)
  );
  record('bubble-long-text-scrolls', Boolean(atEdge && atEdge.scrollable), 'scrollHeight > clientHeight = ' + (atEdge && atEdge.scrollable));

  // 收尾：文本复原 + 关气泡 + 猫回原位（自检期间不落盘）
  await evalInPage(win.webContents, function () {
    document.getElementById('bubble-text').textContent = '嗯，我在。';
    document.getElementById('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  });
  await sleep(400);
  ctx.placePet(originalBase);
  await sleep(300);

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

  /* ---------------- M1-R1 新增 19 项自证门（18 -> 37） ---------------- */

  // A2 walk 状态：只从 idle|alert 起走，8 方向 2 帧
  const zeroRandom = function () {
    return 0;
  };
  const walkMachine = stateCore.createStateMachine({ random: function () { return 0.99; } });
  walkMachine.send('walk:start', 'E');
  const walkPose = walkMachine.pose();
  record(
    'walk-state-exists',
    walkMachine.state === 'walk'
      && walkPose.sprite === 'E'
      && walkPose.frames === 2
      && stateCore.ALLOWED.walk.indexOf('talk') >= 0
      && stateCore.ALLOWED.walk.indexOf('drag') >= 0,
    'state=' + walkMachine.state + ' pose=' + JSON.stringify(walkPose)
  );

  // A3 look 状态：单帧定格（tick 也不换帧），look:end 回 idle
  const lookMachine = stateCore.createStateMachine({ random: function () { return 0.99; } });
  lookMachine.send('look:start', 'W');
  lookMachine.tick(1000);
  const lookPose = lookMachine.pose();
  const lookEnded = lookMachine.send('look:end').state;
  record(
    'look-state-exists',
    lookPose.sprite === 'W' && lookPose.frame === 0 && lookPose.frames === 2 && lookEnded === 'idle',
    'pose=' + JSON.stringify(lookPose) + ' -> look:end=' + lookEnded
  );

  // A5【P0-1】别烦我 -> 穿透锁死；关掉 -> 恢复；收尾还原
  const dndProbe = ctx.probeDndLocksPassthrough();
  record(
    'dnd-locks-passthrough',
    dndProbe.onLocks === true && dndProbe.offRestores === true && dndProbe.restored === true,
    JSON.stringify(dndProbe)
  );

  // A6 边缘吸附：内侧 10px 与边界 20px 命中、21px 不命中、已出屏 96px 拉回来
  const snapArea = { x: 0, y: 0, width: 1440, height: 900 };
  const snapRect = function (x, y) {
    return { x: x, y: y, width: 144, height: 144 };
  };
  const snapLeft10 = positionCore.snapToEdge(snapRect(10, 300), snapArea);
  const snapRight20 = positionCore.snapToEdge(snapRect(1440 - 144 - 20, 300), snapArea);
  const snapRight21 = positionCore.snapToEdge(snapRect(1440 - 144 - 21, 300), snapArea);
  const snapOffscreen = positionCore.snapToEdge(snapRect(1440 - 144 + 96, 300), snapArea);
  record(
    'snap-to-edge',
    snapLeft10.x === 4
      && snapLeft10.edge === 'left'
      && snapRight20.edge === 'right'
      && snapRight20.x === 1440 - 144 - 4
      && snapRight21.edge === null
      && snapRight21.x === 1440 - 144 - 21
      && snapOffscreen.edge === 'right'
      && snapOffscreen.x === 1440 - 144 - 4,
    JSON.stringify({ left10: snapLeft10, right20: snapRight20, right21: snapRight21, offscreen: snapOffscreen })
  );

  // A4 滚轮缩放：验收链 120 -> 132 -> 145 -> 159，到界夹紧
  const zoom1 = configCore.zoomSize(120, 1);
  const zoom2 = configCore.zoomSize(zoom1, 1);
  const zoom3 = configCore.zoomSize(zoom2, 1);
  const zoomTop = configCore.zoomSize(180, 1);
  const zoomBottom = configCore.zoomSize(60, -1);
  record(
    'zoom-clamp',
    zoom1 === 132 && zoom2 === 145 && zoom3 === 159 && zoomTop === 180 && zoomBottom === 60,
    '120->' + zoom1 + '->' + zoom2 + '->' + zoom3 + '；180->' + zoomTop + '；60->' + zoomBottom
  );

  // A1【P0-2】onboarded 字段 + 旧语义迁移（名字不再是「琉斯」）
  const migratedLegacy = configCore.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, {});
  record(
    'onboarded-field',
    configCore.DEFAULT_STATE.onboarded === false
      && migratedLegacy.changed === true
      && migratedLegacy.reason === 'legacy-nickname'
      && migratedLegacy.config.schemaVersion === 2
      && migratedLegacy.config.nickname === '你'
      && migratedLegacy.state.onboarded === false,
    'DEFAULT_STATE.onboarded=' + configCore.DEFAULT_STATE.onboarded + ' legacy=' + JSON.stringify(migratedLegacy.config) + ' state=' + JSON.stringify(migratedLegacy.state)
  );

  // A6【P1-4】return 触发源：缺席 31 分钟置位、2 分钟不置位
  const returnT0 = 1700000000000;
  const returnRuntime = schedulerCore.createRuntime(returnT0);
  const returnAway = schedulerCore.markActivity(returnRuntime, returnT0 + 31 * 60 * 1000).returnPending;
  const returnSoon = schedulerCore.markActivity(returnRuntime, returnT0 + 2 * 60 * 1000).returnPending;
  record(
    'return-trigger',
    returnAway === true && returnSoon === false && schedulerCore.TRIGGERS.indexOf('return') >= 0,
    '31min=' + returnAway + ' 2min=' + returnSoon + ' triggers=' + schedulerCore.TRIGGERS.join('/')
  );

  // A7 快捷键：真注册成功 / 被占用被 catch / unregisterAll 不留幽灵占用（只用不常用测试键，验完即注销）
  const shortcutProbe = ctx.probeShortcuts();
  record(
    'shortcut-register',
    shortcutProbe.register === true && shortcutProbe.unregistered === true,
    JSON.stringify(shortcutProbe)
  );
  record(
    'shortcut-occupied',
    shortcutProbe.occupied === true,
    'register false / 抛异常都降级成 {ok:false, occupied:true}：' + JSON.stringify(shortcutProbe)
  );
  const unregisterProbe = ctx.probeUnregisterAll();
  record(
    'shortcut-unregister-all',
    unregisterProbe.registered >= 1 && unregisterProbe.allCleared === true,
    JSON.stringify(unregisterProbe)
  );

  // A8 复制：preload -> 主进程剪贴板这条桥真的通
  const copyProbe = await evalInPage(win.webContents, function () {
    return window.hermes.copyText('你好，琉斯。');
  });
  record(
    'copy-bridge',
    Boolean(copyProbe && copyProbe.ok === true && copyProbe.copied === 6 && copyProbe.truncated === false),
    JSON.stringify(copyProbe)
  );

  // A9 ↑ 回填：走真实 submit 路径压历史栈，再空输入框按 ↑
  const historyProbe = await evalInPage(win.webContents, function () {
    const input = document.getElementById('input');
    input.value = '自证门历史';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const recalled = input.value;
    input.value = '';
    return { recalled: recalled };
  });
  record('history-↑', Boolean(historyProbe && historyProbe.recalled === '自证门历史'), JSON.stringify(historyProbe));

  // A10 长按 >=1s 固定气泡 + 图钉可见；再长按解除
  await evalInPage(win.webContents, function () {
    document.getElementById('bubble').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    return true;
  });
  await sleep(1200);
  const pinnedState = await evalInPage(win.webContents, function () {
    const pin = document.getElementById('bubble-pin');
    return {
      pinned: document.body.classList.contains('bubble-pinned'),
      pinVisible: !pin.classList.contains('is-hidden'),
      pinText: String(pin.textContent || ''),
    };
  });
  await evalInPage(win.webContents, function () {
    document.getElementById('bubble').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    return true;
  });
  await sleep(1200);
  const unpinnedState = await evalInPage(win.webContents, function () {
    return {
      pinned: document.body.classList.contains('bubble-pinned'),
      pinHidden: document.getElementById('bubble-pin').classList.contains('is-hidden'),
    };
  });
  record(
    'bubble-pin',
    pinnedState.pinned === true && pinnedState.pinVisible === true && unpinnedState.pinned === false && unpinnedState.pinHidden === true,
    JSON.stringify({ pinned: pinnedState, unpinned: unpinnedState })
  );

  // 【P1-6】A13 quiet：六信号各来一次 -> plan 不开口 + 走动不发（深夜只减速，不禁止走动）
  const quietSignals = ['foregroundFullscreen', 'typingBurst', 'dnd', 'paused', 'hidden', 'deepNight'];
  const quietT0 = 1700000000000; // 固定时刻（纯逻辑）：sunset/greeting 的日期哨兵都先置成「今天」，只留 return 一个候选
  const quietRuntime = Object.assign({}, schedulerCore.createRuntime(quietT0), {
    greetedDate: schedulerCore.dateKey(quietT0),
    sunsetDate: schedulerCore.dateKey(quietT0),
    returnPending: true, // 不安静时这条「回来了」是会说出口的
  });
  const quietBaseline = schedulerCore.plan({ now: quietT0, config: { proactiveEnabled: true }, runtime: quietRuntime, state: 'idle' });
  const quietFlagged = quietSignals.map(function (key) {
    const signals = {};
    signals[key] = true;
    return quietCore.shouldBeQuiet(signals);
  });
  const quietPlans = quietSignals.map(function () {
    return schedulerCore.plan({ now: quietT0, config: { proactiveEnabled: true }, runtime: quietRuntime, state: 'idle', quiet: true });
  });
  const walkBlockingSignals = ['foregroundFullscreen', 'typingBurst', 'dnd', 'paused', 'hidden'];
  const quietWalks = walkBlockingSignals.map(function (key) {
    const signals = {};
    signals[key] = true;
    return walkCore.shouldStartWalk({
      now: quietT0,
      lastWalkAt: quietT0 - 10 * 60 * 1000, // 冷却早过
      cursorQuiet: true,
      state: 'idle',
      random: zeroRandom, // 必中签：只有被挡才会是 false
      quiet: Boolean(signals.foregroundFullscreen || signals.typingBurst),
      dnd: signals.dnd === true,
      paused: signals.paused === true,
      hidden: signals.hidden === true,
    });
  });
  const deepNightStep = walkCore.walkStep({ from: { x: 0, y: 0 }, cursor: { x: 1000, y: 0 }, deepNight: true });
  record(
    'quiet-blocks-proactive',
    quietBaseline.speak === true
      && quietBaseline.kind === 'return'
      && quietFlagged.every(Boolean)
      && quietPlans.every(function (decision) { return decision.speak === false && decision.reason === 'quiet'; })
      && quietWalks.every(function (allowed) { return allowed === false; })
      && deepNightStep.dx === 2,
    'baseline=' + quietBaseline.kind + '/' + quietBaseline.speak
      + ' 六信号 plan 全闭嘴=' + quietPlans.every(function (d) { return d.speak === false; })
      + ' 走动被挡=' + quietWalks.join(',')
      + ' 深夜步长=' + deepNightStep.dx + 'px（不禁止走动，只减速）'
  );

  // 【P1-6】A2 walk-guards：dnd / 暂停 / 对话中 / 拖后 2s 内 一律不走；拖后满 2s 恢复
  const guardBase = {
    now: quietT0,
    lastWalkAt: quietT0 - 10 * 60 * 1000,
    cursorQuiet: true,
    state: 'idle',
    random: zeroRandom,
  };
  const walkGuards = {
    allowed: walkCore.shouldStartWalk(guardBase),
    dnd: walkCore.shouldStartWalk(Object.assign({}, guardBase, { dnd: true })),
    paused: walkCore.shouldStartWalk(Object.assign({}, guardBase, { paused: true })),
    dialogue: walkCore.shouldStartWalk(Object.assign({}, guardBase, { dialogueOpen: true })),
    'drag-settle': walkCore.shouldStartWalk(Object.assign({}, guardBase, { dragEndedAt: quietT0 - 1000 })),
    dragging: walkCore.shouldStartWalk(Object.assign({}, guardBase, { dragging: true })),
    'cursor-busy': walkCore.shouldStartWalk(Object.assign({}, guardBase, { cursorQuiet: false })),
    sleeping: walkCore.shouldStartWalk(Object.assign({}, guardBase, { state: 'sleeping' })),
    'drag-settled-2000': walkCore.shouldStartWalk(Object.assign({}, guardBase, { dragEndedAt: quietT0 - 2000 })),
  };
  record(
    'walk-guards',
    walkGuards.allowed === true
      && walkGuards.dnd === false
      && walkGuards.paused === false
      && walkGuards.dialogue === false
      && walkGuards['drag-settle'] === false
      && walkGuards.dragging === false
      && walkGuards['cursor-busy'] === false
      && walkGuards.sleeping === false
      && walkGuards['drag-settled-2000'] === true,
    JSON.stringify(walkGuards)
  );

  // 【P1-6】A1 config 迁移：喂 schemaVersion:1 + 琉斯 -> 名字不再是「琉斯」，改过名的不动
  const migrateLegacy = configCore.migrateConfig({ schemaVersion: 1, nickname: '琉斯' }, {});
  const migrateCustom = configCore.migrateConfig({ schemaVersion: 1, nickname: '嘉仪' }, {});
  const migrateCurrent = configCore.migrateConfig({ schemaVersion: 2, nickname: '琉斯' }, {});
  record(
    'config-migrate-nickname',
    migrateLegacy.config.nickname !== '琉斯'
      && migrateLegacy.config.nickname === '你'
      && migrateLegacy.state.onboarded === false
      && migrateCustom.config.nickname === '嘉仪'
      && migrateCurrent.changed === false,
    'legacy=' + migrateLegacy.config.nickname + '/' + migrateLegacy.reason
      + ' custom=' + migrateCustom.config.nickname
      + ' current.changed=' + migrateCurrent.changed
  );

  // 【P1-6】A6 墙钟护栏：回拨不置位 / 跨天清零 / 合盖唤醒只判一次
  const clockT0 = 1700000000000;
  const clockRuntime = schedulerCore.createRuntime(clockT0);
  const clockAway = schedulerCore.markActivity(clockRuntime, clockT0 + 31 * 60 * 1000);
  const clockRollback = schedulerCore.guardTick(clockT0 - 60 * 60 * 1000, clockAway);
  const clockAfterRollback = schedulerCore.markActivity(clockRollback.runtime, clockT0 - 60 * 60 * 1000);
  const clockCrossDay = schedulerCore.guardTick(
    clockT0 - 24 * 60 * 60 * 1000,
    Object.assign({}, clockAway, { dailyCount: 3 })
  );
  const wakeAt = clockT0 + 4 * 60 * 60 * 1000;
  // greeting / sunset 的日期哨兵都按「唤醒那一刻」置位 -> 无论机器时区怎么设，唯一候选都是 return
  const wakeRuntime = Object.assign({}, schedulerCore.createRuntime(clockT0), {
    greetedDate: schedulerCore.dateKey(wakeAt),
    sunsetDate: schedulerCore.dateKey(wakeAt),
  });
  const woke = schedulerCore.guardTick(wakeAt, wakeRuntime);
  const wokeActivity = schedulerCore.markActivity(woke.runtime, wakeAt);
  const wakeFirstPlan = schedulerCore.plan({ now: wakeAt, config: { proactiveEnabled: true }, runtime: wokeActivity, state: 'idle' });
  const wakeSpoken = schedulerCore.recordSpoken(wokeActivity, wakeAt, wakeFirstPlan.kind);
  // 就算紧接着又置位一次「回来了」，也必须被 2 小时主动说话护栏挡住（唤醒后只判一次）
  const wakeAgain = Object.assign({}, wakeSpoken, { returnPending: true });
  const wakeSecondPlan = schedulerCore.plan({ now: wakeAt + 1000, config: { proactiveEnabled: true }, runtime: wakeAgain, state: 'idle' });
  record(
    'return-clock-guard',
    clockRollback.reason === 'rollback'
      && clockRollback.runtime.returnPending === false
      && clockAfterRollback.returnPending === false
      && clockCrossDay.reason === 'rollback'
      && clockCrossDay.runtime.dailyCount === 0
      && woke.reason === 'drift'
      && wakeFirstPlan.speak === true
      && wakeFirstPlan.kind === 'return'
      && wakeSecondPlan.speak === false
      && wakeSecondPlan.reason === 'cooldown',
    'rollback.returnPending=' + clockRollback.runtime.returnPending
      + ' 跨天 dailyCount=' + clockCrossDay.runtime.dailyCount
      + ' 唤醒=' + woke.reason + ' 第一次=' + wakeFirstPlan.kind + '/' + wakeFirstPlan.speak
      + ' 第二次=' + wakeSecondPlan.reason
  );

  // 【P1-5】A8 超长文本被截断、非 string / 空白被拒绝
  const overlongText = new Array(5001).join('x');
  const truncateProbe = await evalInPage(win.webContents, function (text) {
    return window.hermes.copyText(text);
  }, overlongText);
  const rejectProbe = await evalInPage(win.webContents, function () {
    return window.hermes.copyText(null);
  });
  const emptyProbe = await evalInPage(win.webContents, function () {
    return window.hermes.copyText('   ');
  });
  record(
    'copy-overlong-truncated',
    Boolean(
      truncateProbe
        && truncateProbe.ok === true
        && truncateProbe.truncated === true
        && truncateProbe.copied === 4096
        && truncateProbe.requested === 5000
        && rejectProbe
        && rejectProbe.ok === false
        && rejectProbe.reason === 'not-a-string'
        && emptyProbe
        && emptyProbe.ok === false
        && emptyProbe.reason === 'empty'
    ),
    JSON.stringify({ overlong: truncateProbe, reject: rejectProbe, empty: emptyProbe })
  );

  // 【P1-7 复核补】A12 开机自启失败：注入一个抛错的 setLoginItem 替身 ->
  // 必须被调用**恰好一次**，且产生一条用户可见提示（绝不静默吞掉）
  let autoLaunchCalls = 0;
  const autoLaunchFailure = ctx.applyAutoLaunch({
    injectSetLoginItem: function () {
      autoLaunchCalls += 1;
      throw new Error('自证门注入的失败');
    },
  });
  record(
    'autolaunch-failure-injected',
    autoLaunchCalls === 1
      && autoLaunchFailure.ok === false
      && Boolean(autoLaunchFailure.notice)
      && ctx.lastUserNotice() === autoLaunchFailure.notice,
    'calls=' + autoLaunchCalls
      + ' ok=' + autoLaunchFailure.ok
      + ' notice=' + autoLaunchFailure.notice
      + ' error=' + autoLaunchFailure.error
  );

  const failed = steps.filter(function (step) {
    return !step.ok;
  });
  return { ok: failed.length === 0, steps: steps, failed: failed };
}

module.exports = { runSelfCheck };
