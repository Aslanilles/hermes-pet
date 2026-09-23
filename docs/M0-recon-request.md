# 派单任务书：GitHub 桌宠产品调研（给 冲浪🏄）

## 背景（自包含）
站长（王嘉仪/阿斯兰）正在开发「琉斯计划」桌宠前端 **hermes-pet**，技术选型已定：**Electron + 原生 HTML/CSS/JS（无构建步骤）、透明无边框置顶窗口、精灵图动画**。本轮要一个小时内出可运行 MVP。你是调研手，任务是**把 GitHub 上同类产品与可用素材摸清**，让实现少走弯路。

项目目录：`D:\Jiayi\Projects\hermes-pet`

## 产出（落盘绝对路径）
`D:\Jiayi\Projects\hermes-pet\docs\M0-recon-github-pet.md`

必需章节：
1. **同类开源项目清单（10-15 个）**，表格逐条给：仓库全名 / star 数（**必须用 GitHub API 实时抓，禁止凭记忆写**）/ 主要语言 / 技术栈 / 一句话它是什么 / **值得偷学的 1-2 个具体做法** / 许可证（明确写 MIT / Apache-2.0 / GPL / 无 LICENSE，写不对比写不出更糟）
   - 检索面要覆盖：Electron 桌宠、Shimeji/Shimeji-ee 及其移植、oneko.js 类鼠标追逐猫、live2d 桌宠、Tauri 桌宠、Windows 原生桌宠、以及「桌面宠物 + LLM/AI 对话」这一类
2. **技术范式对比表**：Electron 透明窗 vs Tauri vs 原生 Win32/WPF vs 浏览器注入脚本——各自怎么实现「透明置顶、鼠标穿透 vs 可交互、拖拽、跟随鼠标」；哪些做法在 Windows 11 上有已知坑
3. **可用素材来源（重点）**：列出**许可证清晰（CC0 / 公共领域 / MIT / CC-BY 且标明署名要求）**的桌宠精灵图或像素猫素材来源，每条给**直链**，并**用 curl 验证过可达（给出 HTTP 状态码）**。至少覆盖：oneko 系列、shimeji 素材、以及任何可直接用于 Electron 的 32x32/64x64 猫精灵表
4. **陪伴感的设计先例**：这些项目里谁做了「主动行为 / 空闲状态 / 不被讨厌的频率控制」，摘出具体做法（有数字最好）
5. **坑清单**：Windows 透明窗口 / 置顶 / 点击穿透 / 多显示器 方面的实测坑（来自 issue 或 README 的都标来源）

## 硬约束
- **禁止编造**：star 数、许可证、URL 可达性都必须有实测来源；查不到就写「未找到」，不许猜
- 所有中间产物（脚本/日志/缓存）一律写入 `D:\Jiayi\Projects\hermes-pet\docs\_recon\`，**禁止在 `D:\Jiayi\` 根目录新建任何文件或文件夹**（站长铁律）
- 你没有 read_file/write_file 工具，用 terminal：读用 `Get-Content -Encoding UTF8 -Raw`，写长中文用 PowerShell here-string + `[System.IO.File]::WriteAllText($p,$s,(New-Object System.Text.UTF8Encoding($false)))`；文本引号一律用「」
- 抓 GitHub 数据用 `gh api` 或 `curl.exe`（PowerShell 里 gh api 带查询串会拆参，改用 curl.exe 或把查询串放 URL 里）

## 交付纪律
写完只回 **≤10 行摘要**（覆盖了多少项目 / 素材来源几条可用 / 最大的坑 / 你的反调），**不要把全文回在聊天里**。
