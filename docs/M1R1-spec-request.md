# 派单任务书：hermes-pet M1-R1 规格设计 + codex 执行任务书（给 包工头👷）

## 背景（自包含）
hermes-pet 的 **M0 已交付并可跑**（Electron 桌宠，Windows 右下角常驻；能拖拽/对话/托盘/设置/深夜模式；92 个单测全绿；内置 `--smoke-test` 与 `--self-check` 两道自证门）。现在是 **M1 第一轮**，你的活是**出规格 + 写出让 codex 能自主完成的执行任务书**。上限要求：精细到 codex 能自己跑完，不要过度设计。

- 项目目录：`D:\Jiayi\Projects\hermes-pet`（git 干净，HEAD = `a483826`）
- **M0 现状与交接**：`docs/M0-NEXT-SESSION.md`（**必读**）
- **M0 的实现交接（含每个修复的根因与验证原始输出）**：`HANDOFF.md`（**必读**，尤其 §11/§12/§13）
- M0 的执行任务书（了解既有约定）：`docs/M0-CODEX-BRIEF.md`
- 精灵表与状态映射：`docs/M0-sprite-map.md`
- 竞品配方（有可直接抄的）：`docs/M0-recon-github-pet.md`

## M0 既有架构（照着扩展，别重造）
```
src/core/     纯逻辑、零 electron 依赖、容器内 node --test 可跑
  sprite-frames.js   spriteSets 表 + 取帧（负索引直接乘 32）
  state-machine.js   8 态 + 转移表（含 talk/listen/drag/nap）
  scheduler.js       主动行为决策（纯函数，注入 now() 墙钟）
  config.js          config.json 读写 + .env 手写 parser + 原子写
  replies.js         mock 语料 + 主动话术
  position.js        右下角落点 / 恢复 / clamp
  window-guards.js   置顶与穿透看门狗（5000ms/2000ms）
src/adapters/  index(降级) / local-mock / hermes-gateway（协议已冻结）
src/renderer/  index.html + pet.css/pet.js + settings.html/css/js
src/main.js    主进程：窗口/托盘/菜单/单实例/调度接线/持久化/两道自证门
src/preload.js contextIsolation 白名单桥
tools/         selfcheck.js（交互链路自检）/ sprite_preview.html / gateway_stub.js / push_via_api.py
tests/         6 个文件 92 用例（node:test，零依赖）
```
**两道自证门（本轮必须扩展，不许绕过）**：`npx electron . --smoke-test` 打 `SMOKE_OK {...}`；`npx electron . --self-check` 打 `SELFCHECK_OK n/n`。

## 本轮范围（调度者圈定，不要增删）
- **A1 初见与命名**：首启（无存档）入场过程 → 问名字 → 记住 → 从此以名字称呼；再次启动不再问
- **A2 走路 + 偶尔追鼠标**：oneko 8 方向走帧；**低频**靠近光标但**追不到**；严格遵守「安静陪伴」气质
- **A3 悬停反应**：鼠标停在猫身上 ≥0.5s → 看向光标方向；离开 0.3s 过渡回正面
- **A4 滚轮缩放**：猫身上滚轮 ±10%，夹 60-180px，写回 config，不误触
- **A5 托盘「别烦我 / 透明模式」**：一键恒定穿透（猫不吃点击），托盘状态可见、可恢复、持久化
- **A6 边缘吸附 + 回来招呼**：拖拽松手距边缘 ≤20px 吸附；离开 >30 分钟回来说一句

⚠️ A1-A6 的**体验细节与行为数字**由脑洞另写一份 `docs/M1R1-features.md`（可能比你早或晚落盘）。**你先读它**（若已存在）作为设计输入；若还不存在，就自己定合理数字并在 spec 里标出「待脑洞对齐」的项。**范围以上面 6 条为准，细节数值冲突时以 `docs/M1R1-features.md` 为准**。

## 你的产出（两个文件，都要落盘）
1. `docs/M1R1-spec.md` —— 规格设计：
   - 每个功能点的**改动面**（改哪些文件、加哪些纯函数/状态/IPC 通道，逐条列）
   - **状态机与 A2/A3 的整合**：走动/看向是新增状态还是复用 8 方向帧？与既有 8 态（含 nap、talk、drag）的转移关系怎么定？**会不会破坏 M0 已有的转移白名单与护栏**？
   - **A5 与既有穿透机制的整合**（这是最容易做错的）：M0 现有 `setIgnoreMouseEvents(true,{forward:true})` + 渲染进程 `elementFromPoint` 命中测试 + 2000ms 看门狗重断言。**「别烦我」模式必须让看门狗一句话闭嘴**（否则看门狗刚重断言完又被命中测试关掉，两者打架）——把「谁拥有 ignore 状态的最终决定权」写清楚
   - **A1 的首启判定与状态字段**（放 config 还是 state？怎么和「已问过但用户跳过了」区分？）
   - **A4 滚轮与既有交互的冲突面**（气泡滚动 / 设置面板 / 拖拽）
   - **A6 吸附的坐标系**（workArea 而非物理像素；多屏与 DPI 缩放已踩过坑，见 `HANDOFF.md` §11）
   - 持久化 schema 变更（新字段 + 默认值 + 旧文件兼容）
   - **不许破坏 M0 的既有护栏**：每 2 小时 ≤1 次、24h ≤6 次、10 秒不回应当天不再提、跨天重置、墙钟回拨/挂起不补发。**明确 A2 的走动与 A6 的招呼算不算「主动说话」，是否占额度**
2. `docs/M1R1-task.md` —— **codex 执行任务书**（自包含）：
   - 执行者=codex；工作目录 `D:\Jiayi\Projects\hermes-pet`
   - 逐文件要写什么（可给关键接口签名与行为要求）
   - **验收清单分两栏**：`codex 自证`（`node --test` 两套全绿 **且 92 个旧用例一条都不许红** + 新增用例覆盖 A1-A6 + `--self-check` **必须为每个新功能加断言**（门从 18 项增加）+ `--smoke-test` 仍 `SMOKE_OK`）与 `人工（站长）`（入场动画好不好看、追鼠标烦不烦、吸附手感）
   - **明确的「不要做什么」清单**（不引构建工具/框架/依赖；不改已产出文档；不碰 `.env`；不动 `data/sprites/`）
   - **已知坑要写进去**：① 宿主 Node 24 用 `node --test tests/*.test.js`（glob），容器 Node 20 用 `node --test tests/`（目录），**两套写法跑同一批文件**；② 坐标一律 DIP，别混物理像素（`HANDOFF.md` §11 有我被抓过的实例）；③ 验收门**必须与用户物理环境解耦**（M0 第五轮的教训：断言读了会被光标合法改写的活状态 → 7 次冒烟 1 次红）；④ 改动后必须重启 electron 再验，别信热更新
   - 结尾给 codex 自我迭代条款：写完必须自己跑全部可脚本化验收、修自己引入的问题、不自证完不算完

## 硬约束
- 只设计，**不要写实现代码**（除上面两个 .md）
- 不改 `docs/M0-*.md`、`HANDOFF.md`、`hermes-pet-product-design.md`、`data/sprites/`、`tools/*.py`
- **禁止在 `D:\Jiayi\` 根目录新建任何文件或文件夹**；中间产物放 `docs\_m1r1\`
- 你没有 write_file，用 terminal 写：长中文用 PowerShell here-string + `[System.IO.File]::WriteAllText($p,$s,(New-Object System.Text.UTF8Encoding($false)))`；引号一律用「」
- 写完只回 **≤12 行摘要**（改动面 / 状态机整合结论 / 最易做错的一条 / 风险），不要把全文回在聊天里
