# M0 第四轮修复任务书（codex）— 补两条「静默失效」防线

> 执行者：codex ｜ 工作目录：`D:\Jiayi\Projects\hermes-pet`
> 依据：`docs/M0-recon-github-pet.md`（冲浪的竞品调研，§5 坑清单 / §6 落地配方）——**该报告里两条情报与你交付的代码对不上，本轮补齐**。
> 本轮只加防线与回归，不新增用户可见功能。

## 情报来源（先去读，别只听我转述）
用 terminal 读 `D:\Jiayi\Projects\hermes-pet\docs\M0-recon-github-pet.md`，重点看 §5（Windows 透明窗/置顶/穿透坑）与 §6（可直接抄的配方 + 三个阈值）。其中两条与本轮直接相关：
- **置顶必须周期重断言**：竞品 `rullerzhou-afk/clawd-on-desk` 源码里有常数 `TOPMOST_WATCHDOG_MS = 5000`，每 5 秒重新断言一次置顶，层级用 `pop-up-menu`（可压过任务栏）。设一次不够。
- **穿透会静默失效**：`win.setIgnoreMouseEvents(true, { forward: true })` 在 Windows 上，**宠物页快速重载 / 有全屏窗口扫过之后会静默失效**（竞品 `OpenPetsHQ/openpets` 源码注释里的实测），失效后表现是「透明区域又开始挡桌面点击」，且**没有任何报错**。它配套了光标探测看门狗兜底。

## 我的独立核实（你可以在代码里自行确认）
- `src/main.js` 里 `alwaysOnTop: true` **只出现在 BrowserWindow 构造器**（第 ~251 行、第 ~452 行两处），**全文件没有任何重断言**；
- **没有穿透看门狗**；主进程现有定时器只有：`tickCursor` 200ms、`schedulerTick` 1000ms、`deepNight` 60s、`breakTimer`（临时）。

---

## FIX-A（P1）置顶看门狗

**要求**：
1. 窗口创建后启动一个 **5000ms** 的看门狗，重断言置顶：`win.setAlwaysOnTop(true, 'pop-up-menu')`；
2. 只在窗口**存在、未销毁、可见、且未暂停**时断言（暂停时不要抢置顶，否则「暂停」这个逃生口形同虚设）；
3. 抽成**纯函数**便于单测：`shouldReassertTopmost({ isDestroyed, isVisible, paused }) -> boolean`；
4. 常数写进注释并标来源：`// 5000ms 依据 docs/M0-recon-github-pet.md §6 / clawd-on-desk T OPMOST_WATCHDOG_MS`（注释文字自拟，但必须指回该文档，不要写成我瞎编的）。

**验收（自动）**：单测覆盖 `shouldReassertTopmost` 的 4 种取值组合；`--smoke-test` 输出里增加 `"topmostWatchdog":true` 表示已接线。

## FIX-B（P1）穿透看门狗 + 重载后重断言

**要求**：
1. 启动一个 **2000ms** 的看门狗：若当前**没有**任何交互元素命中（即渲染进程报的最近一次命中状态是「不穿透应关闭」之外的稳定态），就**重断言** `win.setIgnoreMouseEvents(true, { forward: true })`；
   - 注意别与渲染进程的命中测试打架：正确做法是让**主进程持有一个 `lastInteractive` 缓存**（渲染进程每次命中变化时经 IPC 告知），看门狗只在 `lastInteractive === false` 时重断言 true；`lastInteractive === true` 时**什么都不做**（不要强行关闭穿透，否则点猫会失效）；
2. **`win.webContents.on('did-finish-load')` 时立刻重断言一次**（这就是「页面重载后静默失效」的现场）；`did-navigate` / `did-navigate-in-page` 同样处理；
3. 抽成纯函数便于单测：`watchdogAction({ lastInteractive, isDestroyed, visible }) -> 'force-ignore' | 'noop'`；
4. 注释标来源，指回 `docs/M0-recon-github-pet.md §5/§6`。

**验收（自动）**：单测覆盖 `watchdogAction` 的全部输入组合（重点：`lastInteractive:true` 必须是 `'noop'`，不能误关穿透）；`--smoke-test` 输出里增加 `"ignoreWatchdog":true`。

## FIX-C（P2）把这两条坑写进 `HANDOFF.md`

新增一节「环境级静默失效与对策」：写清 ① 置顶会丢、② 穿透会丢、③ 各自的对策与常数、④ 来源（竞品名 + 文档 §号）。**下一步维护者读到这一节就知道为什么有这两个定时器**，别再被当成冗余代码删掉。

---

## 交付纪律

- **回归不能掉**：本轮结束前后，容器与宿主两套 `node --test` 都必须**全绿**（应 ≥ 86 用例，新增 FIX-A/B 的用例后更多），一条都不许红；
- `npx electron . --smoke-test` 必须打出 `SMOKE_OK` 且**新增两个断言字段**为 true，退出码 0；
- `HANDOFF.md` 贴原始输出；`git add -A && git commit`（**不要 push**）；
- 最终回复 **≤12 行摘要**，不要把代码贴进聊天；
- ❌ 不改 `docs/M0-recon-github-pet.md`、`M0-review.md`、`M0-features.md`、`M0-spec.md`、`M0-CODEX-BRIEF.md`、`M0-FIX-ROUND2/3.md`、`hermes-pet-product-design.md`；
- ❌ 不引入任何新 npm 依赖；❌ 禁止在 `D:\Jiayi\` 根目录新建任何文件；
- ⚠️ 屏幕上有一个正在运行的猫实例（4 个 electron 进程），测前先 `Get-Process electron | Stop-Process -Force`；测完**不用**把它重新拉起来，调度者会拉。
