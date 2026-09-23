# 派单任务书：hermes-pet M0 独立核验（给 杠精🔍）

## 背景（自包含）
站长（王嘉仪/阿斯兰）的桌宠项目 **hermes-pet** 今日 M0 交付：Electron + 原生 HTML/CSS/JS 的桌面宠物，一小时内要验收。你是质量门，任务是**只审不改**：读架构设计与 codex 执行任务书，找出会让交付失败的问题。

项目目录：`D:\Jiayi\Projects\hermes-pet`
### 待审文件（用 terminal 读，你没有 read_file）
- `D:\Jiayi\Projects\hermes-pet\docs\M0-CODEX-BRIEF.md` ← **本轮唯一权威任务书（最高优先级，重点审这份）**
- `D:\Jiayi\Projects\hermes-pet\docs\M0-spec.md`（架构设计，包工头出，可能与本 brief 有出入 → 出入处一律以 brief 为准，你要指出出入点）
- `D:\Jiayi\Projects\hermes-pet\docs\M0-features.md`（功能设计，脑洞出）
- `D:\Jiayi\Projects\hermes-pet\docs\M0-sprite-map.md`（精灵表映射，调度者实测产出）
- 上下文参考：`D:\Jiayi\Projects\hermes-pet\hermes-pet-product-design.md`（产品设计 v0.1，1027 行，只读需要部分）
- **已交付的代码**（codex 正在写，若 `src/` 下已有 .js 文件就一并审；没有就只审文档）

## 产出（落盘绝对路径）
`D:\Jiayi\Projects\hermes-pet\docs\M0-review.md`

格式要求：
- 发现按 **P0（阻塞交付）/ P1（必修）/ P2（建议）** 三级，每条给：问题 / 为什么是问题 / **具体修法**
- 结论一行：`放行 / 修订后放行 / 打回`
- 审查维度（逐项过，没有问题的也写「无」）：
  1. **Electron 透明窗口可行性**：`transparent:true` + `frame:false` + `skipTaskbar` + 拖拽 + 点击交互是否自相矛盾（例如整窗 `-webkit-app-region: drag` 会不会吃掉点击事件，导致点猫没反应）
  2. **IPC / preload 安全**：`contextIsolation`、白名单 API、有没有把 `nodeIntegration` 打开、有没有暴露 `ipcRenderer` 整体
  3. **状态机自洽性**：状态转移表有没有死锁/无法退出/互相覆盖的状态（例如打盹时被点击能不能醒、说话时被打断怎么处理）
  4. **主动行为计时器竞态**：多个计时器（问候/打盹/40分钟提醒/22:30 日落）同时到点会不会叠加弹气泡；跨天/睡眠唤醒/系统时间跳变有没有防护；「每 2 小时 ≤1 次」这个频率上限有没有被自己的多个触发源绕过
  5. **持久化**：config 读写原子性（写一半崩溃）、首次启动默认值缺失、路径是否落在 `app.getPath('userData')` 而不是项目目录
  6. **降级路径**：Hermes gateway 不可达时是否会卡住/白屏/报错弹窗，mock 是否真的能兜住
  7. **验收清单可信度**：`codex 自证`栏里有没有「codex 根本做不到却写进去」的项（例如在 Linux 无显示器容器里验证 GUI）；有没有该验却没验的（例如配置持久化、状态机边界）
  8. **范围/工具纪律**：任务书有没有禁止引入构建工具/框架/额外 npm 依赖；有没有误改产品设计文档/.env 的风险；有没有违反「禁止在 D:\Jiayi 根目录新建文件」
- 你**不要修改任何文件**，只写这一份 review

## 硬约束
- 只审不改，**不要写实现代码**，不要改 spec/task
- 你没有 read_file/write_file，用 terminal：读 `Get-Content -Encoding UTF8 -Raw`，写长中文用 PowerShell here-string + `[System.IO.File]::WriteAllText($p,$s,(New-Object System.Text.UTF8Encoding($false)))`；引号一律用「」
- **禁止在 `D:\Jiayi\` 根目录新建任何文件或文件夹**

## 交付纪律
写完只回 **≤12 行摘要**（P0/P1/P2 各几条 + 结论 + 最致命的一条），不要把全文回在聊天里。
