# M0 第三轮修复任务书（codex）— 调度者独立复验发现的缺陷

> 执行者：codex ｜ 工作目录：`D:\Jiayi\Projects\hermes-pet`
> 依据：琉斯在 M0 交付后做的**独立复验**（不是 codex 自证）。前两轮产物已提交在 `03375c5`，本轮在其上修复。
> 本轮**只修缺陷与补文档**，不新增功能。

## 复验环境事实（我已实测，直接采信）
- 宿主屏幕 **1440 x 900**，Electron 窗口实测 **288 x 288**
- 容器内 `node --test tests/`：**75/75 通过** ✅
- 宿主 `npx electron . --smoke-test`：`SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true}` 退出码 0 ✅
- `git ls-files data/` = 8 项 ✅；`.env` 未被跟踪 ✅；`data/sprites` 命中 `!data/sprites/**` 放行 ✅
- 像素猫已真实渲染（AX 树：`Document 'hermes-pet'` + `Group 'cat-slot'`；视觉确认有尖耳/方块眼/细颈/前爪）✅
- 托盘、右键菜单、问候触发、频率护栏（`ignoredKinds: ["greeting"]` 在 10 秒无响应后正确记录）✅

---

## FIX-1（P0）首次启动位置落到左上角 (0,0)，而不是右下角

**现象（实测复现）**：删掉 `%APPDATA%\hermes-pet\state.json` 后全新启动，落盘的位置是
```json
{ "x": 0, "y": 0, ... }
```
窗口出现在**屏幕左上角**，而功能要求 F1 是「首次启动出现在右下角」。

**判断**：`defaultBaseBounds()` 的算式（`wa.x + wa.width - size.width - EDGE_MARGIN`）本身是对的，所以问题在**时序**——很可能 `persistPosition()` 读到的 `win.getBounds()` 发生在窗口按默认位置摆放**之前**（或 `setBounds` 尚未生效/`baseBounds` 仍为初始值），把 `(0,0)` 写进了 state.json，下次启动又按 (0,0) 恢复，形成「永久左上角」。

**改法要求**：
1. 首次运行（无 state.json 或 x/y 字段缺失/非法）→ 用 `defaultBaseBounds()` 的结果**先 `setBounds`**，**等窗口 `ready-to-show` / `setBounds` 回调后再**才允许落盘；
2. `persistPosition()` 加防御：**读到 x===undefined || y===undefined 时不写**；写之前用 `win.getBounds()` 的**实际值**再 clamp 一次；
3. 恢复位置时也 clamp；若 state.json 里 x/y 都是 `0` 且不是用户拖过去的（无法判断时），**视为非法一律回到默认右下角**——宁可回到右下角，也不要蹲在左上角挡开始菜单；
4. 加一条单测（纯逻辑层）覆盖：无 state → 期望右下角算式结果；x/y 缺失或为 0 → 走默认；超出 workArea → clamp 回可见区。

**验收（必须自证）**：
```powershell
Remove-Item "$env:APPDATA\hermes-pet\state.json" -Force
npx electron . --smoke-test        # 期望 SMOKE_OK
Get-Content "$env:APPDATA\hermes-pet\state.json"   # 期望 x≈1128、y≈588（1440-288-24 / 900-288-24）
```
把上面三条命令的**原始输出**贴进 HANDOFF.md。

---

## FIX-2（P1）窗口 288x288 与「气泡最大宽 320」不自洽

`docs/M0-CODEX-BRIEF.md` P0-1 要求窗口尺寸固定到能容纳猫 + 320px 气泡（推荐 360x440），但实测窗口是 **288x288**。若气泡 `max-width:320px`，在 288px 宽的窗口里**必然被裁**。

**改法要求**（二选一，选定后写进 HANDOFF 说明理由）：
- (a) 窗口调到 **360 x 440**，猫 `bottom:0` 居中、气泡在猫上方，位置持久化按窗口矩形算；**或**
- (b) 保持 288 宽，但气泡 `max-width` 改为**不超过窗口内宽**（如 `max-width: min(320px, calc(100vw - 16px))`），并保证长文本换行 + 滚动可见。

**验收**：单击猫 → 气泡完整可见（左右不被裁）、长文本能滚动；把猫缩到 60px、放到屏幕最右/最下边缘，气泡仍完整可见。

---

## FIX-3（P2）`config.json` 首次运行不落盘

实测 `%APPDATA%\hermes-pet\` 下只有 `state.json`，没有 `config.json`（`Test-Path` = False）。用户设置走内存默认值直到第一次改动才写盘。
**改法**：首次运行即写入一份**含全部默认值**的 `config.json`（原子写），并在 HANDOFF 记录默认值清单。这样「设置持久化」这条功能可以**可视化验收**（打开文件就能看到默认值），也让以后加字段有迁移锚点。

## FIX-4（P2）`M0-sprite-map.md` 的 talk/listen/drag 映射缺位

`docs/M0-review.md` P0-3a 要求把 talk/listen/drag 的复用映射**追加进 `docs/M0-sprite-map.md` 末尾**；实际实现写在代码里，**文档没同步**。
**改法**：在 `docs/M0-sprite-map.md` **末尾追加**一节「M0 状态补充映射（复用，不改动原始 17 组）」，写清 talk/listen/drag 各用什么帧 + 什么 CSS 动效，并注明「本节的权威实现见 `src/core/sprite-frames.js`，两者必须一致」。**不要改动该文件已有的 1-4 节。**

---

## 交付纪律

- 改完必须重跑并**在 HANDOFF.md 贴原始输出**：容器内 `node --test tests/` 全绿；宿主 `npx electron . --smoke-test` → `SMOKE_OK`；FIX-1 的三条命令输出
- `git add -A && git commit`（**不要 push**，push 由调度者做）
- 最终回复 **≤12 行摘要**，不要把代码贴进聊天
- ❌ 不改 `docs/M0-review.md` / `M0-features.md` / `M0-spec.md` / `hermes-pet-product-design.md` / `M0-CODEX-BRIEF.md` / `M0-FIX-ROUND2.md`
- ❌ 不引入任何新 npm 依赖；❌ 禁止在 `D:\Jiayi\` 根目录新建任何文件
- ⚠️ 修复期间可能需要重启正在运行的猫（当前屏幕上有一个实例，先 `Get-Process electron | Stop-Process -Force` 再测，测完不用管）
