# 派单任务书：hermes-pet M1-R1 功能设计（给 脑洞🧠）

## 背景（自包含）
hermes-pet 的 **M0 已经交付并跑起来了**（Electron 桌宠，Windows 右下角，能拖拽/对话/托盘/设置/深夜模式）。现在是 **M1 第一轮**，你的活是设计这一轮的**功能与体验节奏**。

- 项目目录：`D:\Jiayi\Projects\hermes-pet`（git 干净，HEAD = `a483826`）
- 产品设计文档（1027 行，10 个用户旅程场景）：`hermes-pet-product-design.md`
- 你上一轮写的 M0 功能集：`docs/M0-features.md`（**先读它**，M1 是它的续章）
- M0 收了哪些尾、哪些留到 M1：`docs/M0-NEXT-SESSION.md`（**必读**，里面有「待站长拍板 5 条」和「M1 候选」）
- 精灵表与状态映射：`docs/M0-sprite-map.md`（含第 6 节 talk/listen/drag 复用映射）
- 竞品调研（有可抄的配方）：`docs/M0-recon-github-pet.md`

## 本轮范围（已由调度者圈定，**不要扩大也不要缩小**）
- **A1 初见与命名流程**：首启（无存档）时角色有入场过程 → 气泡问「你好，我是琉斯。你叫什么名字？」→ 用户输入 → 记住 → 从此气泡以名字称呼；**再次启动不再问**。依据：产品文档场景 1、你 M0 设计里的 F1（M0 漏做，本轮补）
- **A2 走路 + 偶尔追鼠标**：用 oneko 的 8 方向走帧；**低频**地朝光标缓慢靠近，但**追不到**（近到一定距离就停）；符合「安静陪伴」气质，不能变成追着鼠标满屏跑
- **A3 悬停反应**：鼠标停在猫身上 ≥0.5s → 猫看向光标方向；鼠标离开 → 0.3s 过渡回正面
- **A4 滚轮缩放**：在猫身上滚轮上/下 → 大小 ±10%，夹在 60-180px，写回配置；**不能误触**其它交互
- **A5 托盘「别烦我 / 透明模式」**：一键让整窗恒定鼠标穿透（猫不再吃点击），托盘可见状态、可一键恢复、持久化。依据：竞品 `isHarryh/Ark-Pets` 同名功能；这是当前最容易被感知的痛点（猫身下的桌面图标点不到）
- **A6 边缘吸附 + 回来招呼**：拖拽松手时距屏幕边缘 ≤20px 自动吸附贴边；离开 >30 分钟回来后一句「回来了。」

## 必读材料（用 terminal 读，你没有 read_file 工具）
```
Get-Content -Path "D:\Jiayi\Projects\hermes-pet\docs\M0-NEXT-SESSION.md" -Encoding UTF8 -Raw
Get-Content -Path "D:\Jiayi\Projects\hermes-pet\docs\M0-features.md" -Encoding UTF8 -Raw
Get-Content -Path "D:\Jiayi\Projects\hermes-pet\docs\M0-sprite-map.md" -Encoding UTF8 -Raw
```
（产品设计文档 1027 行，别整读——按需读场景 1/3/6 与 3.1 鼠标交互那几节）

## 产出（落盘绝对路径）
`D:\Jiayi\Projects\hermes-pet\docs\M1R1-features.md`

要求：
1. **A1-A6 逐条**：用户可见表现（能想象出画面）/ 为什么这轮做 / **验收方式**（站长怎么算这条生效了）
2. **★ A2 的行为规范是重头**（写具体数字）：多久才有一次走动机会？走多快？靠近到多少像素停下？什么状态下**禁止**走动（对话中 / 拖拽中 / 打盹中 / 别烦我模式 / 主动提醒额度耗尽）？用户连续工作的什么时候不该动？——写不清这条就会做成「追着鼠标满屏跑」的闹心玩意
3. **A1 的对话设计**：问名字那几句的原话、用户乱输入（空/超长/带脏话/直接打「不要」）时怎么办、跳过不答算不算「已问过」、改名字的入口在哪
4. **A5 的状态设计**：托盘图标在「别烦我」开/关时怎么区分；开着的时候点猫应该发生什么（提示？静默？）；和 M0 已有的「暂停动画」开关怎么区分（两个开关别混淆）
5. **节奏护栏的增补**：M0 已有「主动说话每 2 小时 ≤1 次 / 24h ≤6 次 / 10 秒不回应当天不再提」。A6 的「回来招呼」属于主动说话，**要不要占额度**？A2 的走动属不属于「主动行为」？给明确规则，别让新功能绕过已有护栏
6. **本轮明确不做的**（3-5 条 + 一句理由）
7. **「下一个最该做的 3 件事」**

## 硬约束
- 必须能在**现有架构**内实现：`src/core/`（纯逻辑，零 electron 依赖）+ `src/adapters/` + `src/renderer/`，**无构建步骤、除 electron 外零 npm 依赖**
- 复用已有能力，别重造：光标位置已由主进程 `tickCursor` 200ms 轮询并经 `pet:cursor` 推给渲染进程；主动行为调度在 `src/core/scheduler.js`（纯函数 + 墙钟）；状态机在 `src/core/state-machine.js`
- 不动素材风格（像素猫仍是 M0 占位，形象问题待站长拍板）
- 不写实现代码，只写功能设计与验收口径

## 交付纪律
- 你没有 write_file 工具，用 terminal 写文件。长中文用 PowerShell here-string + 显式 UTF-8：
  ```powershell
  $p = "D:\Jiayi\Projects\hermes-pet\docs\M1R1-features.md"
  $s = @'
  ...内容...
  '@
  [System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))
  ```
- 文本引号一律用「」，**不要用半角双引号**
- **禁止在 `D:\Jiayi\` 根目录新建任何文件或文件夹**（站长铁律）；中间产物放 `docs\_m1r1\`
- 写完只回 **≤10 行摘要**，不要把全文回在聊天里
