# M0 第五轮修复任务书（codex）— 修一条「看光标脸色的验收门」

> 执行者：codex ｜ 工作目录：`D:\Jiayi\Projects\hermes-pet`
> 依据：琉斯在第四轮交付后的**独立复验**（7 次冒烟里 1 次红、6 次绿）。本轮只修验收门的确定性 + 补文档，**不改任何产品行为**。

## 复验现场（我的原始实测，不是你的自述）

第 4 轮产物 `b0c5b7d` 上，我连续跑 `npx electron . --smoke-test` 共 7 次：

| 次数 | 结果 | 退出码 |
|---|---|---|
| 第 1 次（我 kill 旧实例 + 删 state.json 后立刻跑） | `SMOKE_FAIL {"window":true,"tray":true,"pet":true,"mousePassThrough":false,"topmostWatchdog":true,"ignoreWatchdog":true}` | **1** |
| 第 2~7 次 | `SMOKE_OK {... "mousePassThrough":true, "topmostWatchdog":true, "ignoreWatchdog":true}` | 0 |

**我另外排除了两个假设，你不必再查**：
- ❌ 不是「首启问候气泡」导致：删 `state.json` 触发问候后重跑，**依然是 `SMOKE_OK` + `mousePassThrough:true`**；
- ❌ 不是「位置漂移」：问候弹出期间落盘位置**始终是 `(1272,684)`**（正确右下角），没有漂。

**真因（实测支撑）**：猫常驻屏幕右下角，`(1272,684)-(1416,828)`；**当时宿主的物理光标在 `1259,702`——紧贴猫的左边 13 像素**。一旦光标压进猫的矩形，`forward:true` 转发的 mousemove 会让渲染进程命中测试判定「可交互」→ 合法地把 `ignoreMouseActive` 置为 `false` → 那条断言读到 `false` → `SMOKE_FAIL` → 退出码 1。

也就是说：**产品行为是对的，错的是断言**——它读了一个会被合法改写的状态，于是这条验收门会随用户光标位置随机变红。`SMOKE_FAIL` 的退出码 1 还会让任何 CI/自动化随机挂掉。这种门比没有门更坏。

---

## FIX-1（P0）把 `mousePassThrough` 断言改成**光标无关的确定性断言**

要求（三条一起做，缺一不可）：

1. **断言初始态**，而不是断言「当前态」：在窗口创建后、渲染进程任何命中测试发生**之前**，把 `ignoreMouseActive` 的初值快照到一个独立变量（如 `ignoreMouseAtStart`），断言**它**为 `true`。这才是 P0-1/P0-2 真正要保护的东西（「初始不能留一块挡板」）。
2. **断言双向可切换**（这才是「穿透真的接线了」的证据）：让断言主动走一遍 IPC 路径——
   - 合成一次「命中交互元素」→ 断言 `ignoreMouseActive` 变为 `false`；
   - 再合成一次「未命中」→ 断言它回到 `true`；
   - 断言结束后把状态恢复成 `ignoreMouseActive = true`。
   合成方式你自己选（直接调 `ipcMain` handler、或让渲染进程发一次测试用消息），但**必须是确定性的、不依赖真实光标位置**。
3. **保留 `mousePassThrough` 这个字段名不变**（HANDOFF 与历史证据都引用了它），但它的语义改为「初始 ignore=true **且** 双向切换都验证通过」的合取结果。**不要删字段、不要改名。**

**验收（必须自证 + 给我命令）**：
```powershell
# 连跑 5 次必须 5/5 SMOKE_OK、5/5 退出码 0
1..5 | ForEach-Object { npx electron . --smoke-test; "exit=$LASTEXITCODE" }
```
把 5 次的**原始输出**贴进 HANDOFF.md。另外**在光标处于不同位置时各跑一次**（如果你无法控制光标，就在 HANDOFF 里说明「断言已与光标位置解耦」并给出你怎么论证的）。

## FIX-2（P2）把「光标压在猫身上时穿透会合法关闭」写进 `HANDOFF.md`

新增 / 追加一节，说明：① 猫的矩形是**可交互区**，光标进入时穿透会（且应当）关闭；② 因此在猫的矩形内点击会被猫吃掉，这是「猫可点」的代价；③ **已知的产品级缓解方案**（不在本轮做）：托盘加一个「别烦我 / 透明模式」开关（竞品 `isHarryh/Ark-Pets` 有同名功能），打开后整窗恒定穿透、猫不再吃点击 —— 记为 M1 候选。

---

## 交付纪律

- **回归不能掉**：容器与宿主两套 `node --test` 必须全绿（当前基线 **92 用例**，一条都不许红）；
- `--self-check` 必须仍然 `SELFCHECK_OK 18/18`；
- `npx electron . --smoke-test` 连跑 5 次必须 5/5 绿、退出码 5/5 为 0；
- `HANDOFF.md` 贴原始输出；`git add -A && git commit`（**不要 push**）；
- 最终回复 **≤12 行摘要**，不要把代码贴进聊天；
- ❌ 不改 `docs/` 下任何已产出的文档（`M0-recon-github-pet.md` / `M0-review.md` / `M0-features.md` / `M0-spec.md` / `M0-task.md` / `M0-sprite-map.md` 的前四节 / `M0-CODEX-BRIEF.md` / `M0-FIX-ROUND2·3·4.md`）与 `hermes-pet-product-design.md`；
- ❌ 不引入任何新 npm 依赖；❌ 禁止在 `D:\Jiayi\` 根目录新建任何文件；
- ⚠️ 屏幕上有一个正在运行的猫实例，测前 `Get-Process electron | Stop-Process -Force`；测完不用拉起来。
