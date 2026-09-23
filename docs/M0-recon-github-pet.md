# M0 调研报告：GitHub 桌宠产品与可用素材

- 抓取时间：2026-09-23 19:00–19:06（+08:00）
- 抓取方式：`gh api`（本机已认证账号 Aslanilles，core 限额 5000/h）+ `curl.exe -L`
- 纪律声明：本文件中每一个 star 数、语言、许可证、URL 可达性均为本次实测结果，未使用记忆值。查不到的写「未找到」。
- 中间产物（原始 JSON / TSV / 日志 / HTML 抓取）：`D:\Jiayi\Projects\hermes-pet\docs\_recon\`
  - `repos_raw.tsv`（仓库 × star × 语言 × 许可 × 时间戳）、`repos_cache.json`（完整 API 响应缓存）
  - `search_raw.txt`（12 组关键词原始搜索结果）、`issues_raw.txt`、`issues_electron.txt`
  - `asset_check.log`、`asset_check2.log`（素材直链 HTTP 状态码与字节数实测）
  - `oga_licenses.txt`、`oga_*.html`、`el_docs_md2.txt`、`window_configs.txt`、`readme_hits.txt`、`clawd_notes.txt`、`clawd_topmost.txt`、`code_notes.txt`
- 抓取瑕疵（如实记录）：本次唯一的失败外链是 Wikimedia Commons API（curl 退出码 35 / HTTP 000，本机网络到该域失败），故素材来源缺少 Commons 一路，其余来源不受影响。

---

## 1. 同类开源项目清单（15 个）

### A. Electron 系（与 hermes-pet 技术栈同源，优先看这一组）

| 仓库全名 | ⭐ | 语言 | 技术栈 | 一句话它是什么 | 值得偷学的 1–2 个具体做法 | 许可证 |
|---|---|---|---|---|---|---|
| `rullerzhou-afk/clawd-on-desk` | 6276 | JavaScript | Electron + 原生 JS，监听 AI coding agent 事件 | 像素螃蟹桌宠，实时映射 Claude Code / Codex / Cursor 等 agent 的跑、想、写、报错、要权限、睡 | ①双窗口架构：renderWin（画宠物）+ hitWin（只负责接收鼠标），`setIgnoreMouseEvents` 全程单写入者，避免两个窗口抢状态；②`TOPMOST_WATCHDOG_MS = 5000` 每 5 秒重新断言置顶，层级用 `pop-up-menu`（压过任务栏）；③跨屏拖拽用 `screen.getAllDisplays().workArea` 夹取，并把 Windows 强制的屏幕边缘 inset「学习」下来（`getObservedClampInset`） | AGPL-3.0 |
| `OpenPetsHQ/openpets` | 1226 | TypeScript | Electron + 插件 SDK，平台化 | 本地优先的桌面陪伴平台：宠物动画 + 插件 + agent 集成 | ①把「能否转发鼠标事件」抽成无依赖纯函数 `canForwardMouseEvents(platform)`，只认 darwin/win32，Linux 直接放弃穿透——把平台差异收敛到一处；②配套 `cursor-probe watchdog` 兜底（见 §5.2）；③tray-first 的 UX（先在托盘活，宠物后出现） | MIT |
| `JianguSheng/yuns-desktop-pet` | 140 | JavaScript | Electron 28 + electron-store + electron-builder | 中文 AI 桌宠：多模型对话 + MCP 工具调用 + 视觉分析 | 把「窗口置顶」做成设置页里的可关开关，而不是硬编码 `alwaysOnTop: true`——对「不被讨厌」很关键 | MIT |
| `kirbystudy/chatgpt-desktopPet` | 90 | JavaScript | Electron + Live2D | 基于 Electron 的 Live2D 桌宠（中文） | ①README 明确记录了「Electron v24.1.1 不兼容 Win7，故降级 v21.4.4」——Electron 版本与 Windows 版本强相关，选型时要显式钉版本；②拖拽支持单屏/双屏两种模式；③引用了 `electron-as-wallpaper` 处理桌面层 | BSD-2-Clause |

### B. Tauri 系（同类里工程质量最高的一组，配置文件可直接对照）

| 仓库全名 | ⭐ | 语言 | 技术栈 | 一句话它是什么 | 值得偷学的 1–2 个具体做法 | 许可证 |
|---|---|---|---|---|---|---|
| `ayangweb/BongoCat` | 23549 | Vue | Tauri 2 + Vue，Live2D 猫 | 跨平台互动桌宠 BongoCat（本清单 star 冠军） | `src-tauri/tauri.conf.json` 的透明窗六件套：`transparent: true` / `decorations: false` / `alwaysOnTop: true` / `skipTaskbar: true` / `shadow: false` / `titleBarStyle: "Overlay"`——这 6 行是整个 B 组所有项目共享的「能跑底线」 | MIT |
| `yanhanruan/Mutsumi` | 238 | Rust | Tauri 2（Rust 后端）+ Vue 3，单文件原生应用 | 轻量 AI 桌面伴侣：全局音频感知 + 迷你播放器 + 角色对话 | ①用「系统空闲 6–30 分钟（可配）后飘气球当屏保」把长时间不互动变成正向功能；②透明区域完全穿透 + 随时拖拽到任意角落，README 明确承诺「绝不遮挡你点击底部的代码」；③Tauri v2 里给远程 WebView 单独授 capability 的做法 | **无 LICENSE**（建议只看思路，别抄代码） |
| `nucket/NekoAI` | 17 | TypeScript + Rust | Tauri 2 + Rust + React | 经典 Neko 猫的 AI 复刻：满屏游走 + 感知活动窗口 + 接 Gemini/Claude/OpenAI/Ollama | ①`resizable: false` 时窗口尺寸锁死，它用自建 Tauri 命令 `resize_window` 从 Rust 侧绕过系统限制；②`useIdleSequencer.ts` 实现了经典 Neko 的空闲序列「停 → 洗脸 → 挠 → 打哈欠 → 睡」，并用 3 分钟/5 分钟两个阈值分档；③provider 层用 `invoke('nvidia_chat')` 绕 WebView 的 CORS 限制 | MIT |

### C. 原生 Windows / 其他桌面框架

| 仓库全名 | ⭐ | 语言 | 技术栈 | 一句话它是什么 | 值得偷学的 1–2 个具体做法 | 许可证 |
|---|---|---|---|---|---|---|
| `runcat-dev/RunCat365` | 10312 | C# | 原生 C#（任务栏内嵌动画） | 在 Windows 任务栏上按 CPU 占用速度奔跑的猫 | 用「跑得多快」而不是文字/弹窗表达系统状态——零打扰的状态可视化范式，可直接迁移成「宠物奔跑速度 = 你的 GPU/推理负载」 | Apache-2.0 |
| `Adrianotiger/desktopPet` | 1150 | C# | WinForms 分层窗口（eSheep 复刻） | 复活 1995 年 eSheep 桌宠的现代实现 | 十年级长寿项目，issue 区就是一部 Windows 透明窗/多屏坑的编年史（#136 Win11 起不来、#156 不同分辨率多屏出错），选型前值得先读 issue | **无 LICENSE**（仓库无许可文件；仅可参考行为设计） |
| `MidraLab/uDesktopMascot` | 353 | C# | Unity 工程（已核验：仓库含 `Assets/`、`ProjectSettings/`、`Packages/`） | 开源桌面吉祥物项目，多语言 README（中/英/日/西/法） | ①Apache-2.0 + NOTICE 文件的完整合规姿势，是「要商用/要署名」时的干净模板；②Unity + `setup.iss`（Inno Setup）做 Windows 安装包 | Apache-2.0 |
| `shinyflvre/Mate-Engine` | 3694 | ShaderLab（Unity） | Unity + VRM 模型 | 免费版 Desktop Mate：轻量界面 + 自定义 VRM 角色 | 产品层面的「待机动画 / 拖拽悬浮 / 点击台词 / 可坐任务栏 / 置顶可关」四件套齐全，适合当功能清单照抄 | **自定义「MateEngine Pro License v2.1」**：允许私有使用与修改，禁止公开分发衍生版——不是开源许可，只能当产品参考 |

### D. Shimeji / oneko / 桌宠行为引擎血统（行为与素材的真正源头）

| 仓库全名 | ⭐ | 语言 | 技术栈 | 一句话它是什么 | 值得偷学的 1–2 个具体做法 | 许可证 |
|---|---|---|---|---|---|---|
| `adryd325/oneko.js` | 1320 | JavaScript | 单文件 JS，把猫塞进网页 | 「猫追鼠标」经典 oneko 的网页版，一行 script 引入 | ①单张 256×128 px 精灵表（实测尺寸），按 32×32 网格切即 8 列 × 4 行，追逐状态机可直接借用；②素材 `oneko.gif` 在 MIT 仓库内，可直接进 Electron | MIT |
| `isHarryh/Ark-Pets` | 1099 | Java | JavaFX/JNA，明日方舟桌宠 | 明日方舟桌宠 ArkPets，工程完成度很高 | ①托盘里一个「透明模式」开关：一键屏蔽桌宠与鼠标的全部交互、点击直接穿透到下层——把「别烦我」做成用户可见的开关；②README 明确支持拖拽到扩展显示器；③配置记忆（透明模式状态可持久化） | GPL-3.0 |
| `pixelomer/Shijima-Qt` | 200 | C++ | Qt，Shimeji 运行时重实现 | 用 Qt 重写的 Shimeji 桌宠运行器 | ①issue #12「Make the Shijimas clickthrough?」证明：Shimeji 血统默认**不能**点击穿透，这是要额外做的事；②issue #17 讨论「所有 shimeji 合成单个全屏窗口」以减少 N 个窗口的开销 | GPL-3.0 |
| `DalekCraft2/Shimeji-Desktop` | 51 | Java | Java 25 + Maven（Kilkakon 分支的现代移植） | 最活跃的 Shimeji-ee 移植：JRE 6 → JDK 25，含 Linux/macOS 支持与 DPI 修复 | ①`conf/behaviors.xml` + `conf/actions.xml` 用 XML 描述「行为 → 动作 → 图像帧」，README 明说「想关掉某个行为就把 frequency 设成 0」——最优雅的陪伴度旋钮；②`img/<名字>/shime1–46.png` 素材集命名约定 + `img/unused/` 隐藏素材集 | zlib/libpng（原版 Shimeji，Yuki Yamada）+ New BSD（Shimeji-ee Group）+ Kilkakon 要求署名 |

> 补充：Kilkakon 本人的 GitHub 账号（`Kilkakon`）存在但 `public_repos = 0`，即**Shimeji-ee 主线不在 GitHub 上**，官方站为 https://kilkakon.com/shimeji/ （实测 200）。GitHub 上的 Shimeji 都是社区移植。

### 附录观察名单（不计入 15 个清单，仅供扩展检索）

`ChaozhongLiu/DyberPet` 982（Python/PySide6，GPL-3.0，桌宠框架，饱食度/番茄钟/重力参数齐全）· `NanmiCoder/cc-haha` 14685（TypeScript，MIT，agent 工作台，桌宠只是其中一块）· `ntd4996/agentpet` 364（Swift，MIT，跨 mac/Win 的 agent 桌宠 + 养成/排行榜）· `ChanceYu/CoPet` 31（Rust/Tauri，MIT，悬停/双击/连点/长按/拖拽的多级互动）· `funAgent/ai-bubu` 28（Tauri+Vue，MIT，AI 编码量 → 宠物步数）· `glreno/oneko` 261（Java，Unlicense，32 个 32×32 px 公共领域 GIF 素材的代码宿主）· `tie/oneko` 149（C，**无 LICENSE**）· `estenv/linux-shimeji` 166（Java，Zlib）· `CluelessCatBurger/wl_shimeji` 201（C，GPL-2.0，Wayland）· `stevenjoezhang/live2d-widget` 10968（TypeScript，GPL-3.0，网页看板娘，Live2D 接入姿势参考）· `guansss/pixi-live2d-display` 1506（TypeScript，MIT，PixiJS 跑 Live2D，Electron 里做 Live2D 的首选）。

---

## 2. 技术范式对比：透明置顶 / 穿透 / 拖拽 / 跟随鼠标

| 范式 | 透明 + 置顶怎么实现 | 鼠标穿透 vs 可交互 | 拖拽 | 跟随鼠标 | Windows 11 已知坑 |
|---|---|---|---|---|---|
| **Electron 透明窗**（hermes-pet 选型） | `new BrowserWindow({ transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, resizable: false, focusable: false, backgroundColor: '#00000000', webPreferences: {…} })`；置顶要靠定时重断言，不能只设一次 | 全局二值：`win.setIgnoreMouseEvents(true, { forward: true })` 让整窗穿透但仍收到 mousemove；要「只有宠物身体能点」必须按元素动态切换 ignore 状态（官方 fiddle 用的是 `mouseenter`/`mouseleave` 切），或用 clawd 的双窗口（renderWin + hitWin）方案 | 渲染进程 `pointerdown` + `setPointerCapture` → `ipcRenderer.send` → 主进程 `win.setPosition`；务必对 `screen.getAllDisplays().workArea` 做夹取 | `screen.getCursorScreenPoint()` 轮询（macOS 上若用 `forward: true` 也可直接吃 mousemove 事件） | ①**透明区域无法点击穿透**（官方文档明写，issue #1335 至今 open）；②透明窗**不可 resize**，把 `resizable` 设 true 可能让某些平台直接失效；③**DevTools 一开窗口就不透明**——调试期会误判；④透明窗不能双击标题栏/系统菜单最大化；⑤`setResizable(false)` 之后又 `setResizable(true)` 会掉透明（issue #51094）；⑥无系统阴影 |
| **Tauri 2** | `tauri.conf.json` 的 `transparent/decorations:false/alwaysOnTop/skipTaskbar/shadow:false` 六件套（BongoCat、Mutsumi、NekoAI、CoPet 四个项目配置完全一致，可当标准答案） | `window.setIgnoreCursorEvents(true)`；同样只能整窗，按元素判定要在 Rust/前端两端配合 | 前端 `data-tauri-drag-region` 或 `startDragging()`；或自建 Rust 命令移动（NekoAI 的 `resize_window` 就是绕 `resizable:false` 的自建命令） | 前端 `mousemove`（WebView 内）+ Rust 侧 `window.cursor_position()` | ①`decorations:false + transparent:true` 每次 `window.show()` **白闪**（#15490）；②Win11 透明窗**自带阴影**，必须显式 `shadow:false`（#14636）；③拖拽/焦点变化出现**幽灵标题栏背景**（#14764）；④Win11 `transparent:true` 初始尺寸区域**背景为白**（#10318）；⑤Win10 透明+置顶窗在切换 cursor events 或最小化后**偶发黑块/壁纸黑**（#15947，仍 open） |
| **原生 Win32 / WPF / WinForms**（含 C# 分层窗口） | WinForms：`FormBorderStyle=None` + `TopMost=true` + `ShowInTaskbar=false` + `TransparencyKey` 或 `WS_EX_LAYERED` + `UpdateLayeredWindow`（每帧自己画 ARGB）；WPF：`AllowsTransparency=true` + `WindowStyle=None` | 用 `WS_EX_TRANSPARENT | WS_EX_LAYERED` 让整窗穿透；要按像素判定需自己做 `WM_NCHITTEST` 返回 `HTTRANSPARENT`（可精确到「只有猫的身体可点」） | 原生 `WM_NCHITTEST` + `ReleaseCapture` + `WM_NCLBUTTONDOWN`，最顺滑；或自己跟 `WM_MOUSEMOVE` 移动窗口 | `GetCursorPos()` 轮询，或低级鼠标钩子 | ①最灵活（可按像素决定穿透、可精确控制 z-order），但代码量最大；②老项目在 Win11 上翻车多：`Adrianotiger/desktopPet` #136「1.3.1 does not launch on Windows 11」、#156「Multi-monitor with different resolutions」；③`TransparencyKey` 颜色键方案在高 DPI/多屏混合缩放下会出现边缘杂色 |
| **Unity / 游戏引擎**（Mate-Engine、uDesktopMascot） | Unity 透明窗需 `SetWindowLong` 改 `WS_EX_LAYERED` + 相机 `clearColor` alpha=0 的自定义脚本；uDesktopMascot 走 Unity 全量工程路线 | 同样要自己改窗口样式（或用插件），默认不穿透 | 引擎内射线检测 + 拖拽回调 | 引擎内读鼠标位置（`Input.mousePosition`） | ①窗口样式要自己打，跨版本 Unity 容易碎；②包体大（uDesktopMascot 是完整 Unity 工程）；③优势是模型渲染质量最高、天然支持 VRM/3D、物理与动画系统现成 |
| **浏览器注入脚本**（oneko.js、webmeji、live2d-widget） | 不需要透明窗：宠物直接画在宿主页面的 `position: fixed` 层上 | 靠 CSS：容器 `pointer-events: none` + 精灵 `pointer-events: auto`——**这正是 Electron 里按元素穿透要抄的同一套 CSS 思路** | 直接监听 DOM 拖拽 | 监听 `mousemove` 即可，天然无跨进程开销 | 无窗口层坑，但也拿不到桌面级能力（不能跨应用置顶、不能读系统空闲、不能拖到桌面图标上） |

---

## 3. 可用素材来源（每一条直链都实测过 HTTP 状态码与字节数）

| # | 素材 | 直链 | HTTP | 许可 | 署名要求 | 实测细节 |
|---|---|---|---|---|---|---|
| 1 | oneko 精灵表（网页版，含在 MIT 仓库内） | https://raw.githubusercontent.com/adryd325/oneko.js/main/oneko.gif | 200 | MIT（仓库根 LICENSE） | 无强制署名，保留许可声明即可 | **256×128 px**，按 32×32 网格切即 8 列 × 4 行——可直接当 Electron 的 sprite sheet |
| 2 | oneko 经典 GIF 帧集（32 个文件） | https://raw.githubusercontent.com/glreno/oneko/master/src/main/resources/images/1.GIF （同目录 1.GIF – 32.GIF） | 1.GIF = 200（230 B）；25.GIF 首测 200（232 B）、复测超时 000 | **Unlicense（公共领域）** | 无（公共领域，可商用可改） | 单元尺寸实测 **32×32 px**；素材许可正文：https://raw.githubusercontent.com/glreno/oneko/master/src/main/resources/LICENSE （200，Unlicense 全文） |
| 3 | oneko 动画预览 GIF | https://raw.githubusercontent.com/glreno/oneko/master/docs/Neko_animated.gif | 200（2,847 B） | Unlicense | 无 | 用来肉眼确认「猫追鼠标」的动作设计 |
| 4 | OGA「Cat sprites」四方向行走猫 | https://opengameart.org/sites/default/files/cat%20sprite.zip （页面 https://opengameart.org/content/cat-sprites ） | 页面 200 / zip 200（19,170 B） | **CC0**（页面 License(s) 字段实测为 CC0） | 无 | **下载解压实测**：catspritesoriginal.gif 137×50、catspritesx2.gif 274×100、catspritesx4.gif 548×200、catwalkx2.gif 36×30、catwalkx4.gif 72×60、catrunx2.gif 40×34、catrunx4.gif 80×68 → 原图 137×50，已带 x2/x4 放大版，适合高 DPI |
| 5 | OGA「Cat and Dog Free Sprites」 | https://opengameart.org/sites/default/files/CatnDog.zip | 200（9,685,855 B） | **CC0** | 无 | 体量最大（9.6 MB），8 帧行走循环集合 |
| 6 | OGA「cat-2」 | https://opengameart.org/sites/default/files/kitka.gif | 200（3,841 B） | **CC0** | 无 | 单只猫的动画 GIF |
| 7 | OGA「Cats Rework」 | https://opengameart.org/sites/default/files/cat-1.0.zip | 200（30,246 B） | CC-BY 3.0 / CC-BY-SA 3.0 | 必须署名作者；CC-BY-SA 分支需同许可分发 | 32×48 px，白/橘/棕/黑四色猫（单帧已单独提供 PNG） |
| 8 | OGA「LPC rat cat and dog」 | https://opengameart.org/sites/default/files/lpccatratdog.png | 200（26,854 B） | CC-BY 3.0 / CC-BY-SA 3.0 | 同上 | **32×32**，LPC 标准规格（社区工具链最友好） |
| 9 | OGA「DENZI public domain art」 | https://opengameart.org/sites/default/files/DENZI_CC0_32x32_tileset.png | 200（469,424 B） | CC0 | 无 | 32×32 通用像素素材（猫只是其中一类） |
| 10 | Shimeji 默认素材集（shime1–46.png） | https://raw.githubusercontent.com/DalekCraft2/Shimeji-Desktop/main/img/Shimeji/shime1.png | 200（3,248 B，抽查 shime1） | zlib/libpng（原版 Shimeji，Yuki Yamada）+ New BSD（Shimeji-ee 代码）+ Kilkakon 要求署名 | **必须**保留许可声明、不得声称原创；Kilkakon 明确要求署名并建议链接 kilkakon.com | 命名必须严格为 shime1.png – shime46.png，缺一张行为就崩；素材集按 `img/<名字>/` 放，`img/unused/` 可隐藏 |
| 11 | Shimeji 行为定义范本（不是图像，是设计范式） | https://raw.githubusercontent.com/DalekCraft2/Shimeji-Desktop/main/conf/behaviors.xml | 200（10,142 B） | 同 #10 | 同 #10 | 「行为 → 动作 → 帧」+ frequency 的完整写法，抄它的结构比抄代码划算 |
| 12 | Live2D 官方样例模型 | https://www.live2d.com/en/learn/sample/ | 200（59,800 B） | **Live2D Cubism 官方样例模型许可（不是 CC0）** | 按官方页条款 | 想要「好看的模型」才走这条路，30 分钟 MVP 不要碰 |
| 13 | pixi-live2d-display（Electron 里跑 Live2D 的首选） | https://github.com/guansss/pixi-live2d-display | 200（364,324 B） | MIT | 无 | 与 #12 配套 |
| 14 | Kenney 素材站（CC0 站点） | https://kenney.nl/assets/animal-pack-remastered | 200（16,437 B） | 站点声明 CC0（**本次仅验证页面可达，未逐项核验许可字段——降级信任**） | 按站点要求 | 注意旧链接已死：`/assets/animal-pack-redux` → 404、`/assets/animal-pixel-pack` → 404 |

**实测失效 / 不可用（如实记录，别踩）**

- https://opengameart.org/content/lpc-cat → **404**（旧链接，别引用）
- https://raw.githubusercontent.com/DalekCraft2/Shimeji-Desktop/main/img/Shimeji/conf/actions.xml → **404**（真实路径是仓库根 `conf/actions.xml`）
- `tie/oneko`（149⭐）→ 仓库**无 LICENSE 文件**，明确许可「未找到」→ 不要用它家的素材
- Wikimedia Commons API → **000**（本机到该域失败，退出码 35）→ Commons 这一路来源本次未能覆盖
- 字节数/状态码来源：`_recon\asset_check.log`、`asset_check2.log`、`assets_probe.txt`

**选材结论（给 MVP）**：直接用 **#2（Unlicense，32×32×32 帧，零许可风险）**；要更可爱就用 **#4（CC0，自带 x2/x4）**；要四色猫用 **#7（CC-BY，记得署名）**；#10 只在「要复刻 Shimeji 行为」时才用，且必须带署名。

---

## 4. 陪伴感的设计先例（把数字抠出来）

| 项目 | 空闲 / 主动行为设计 | 具体数字（都来自 README 或源码） |
|---|---|---|
| `clawd-on-desk` | 12 个动画状态 + 睡眠序列 + 惊醒 | 空闲 **60 秒** → 打哈欠→打瞌睡→倒下→睡着；鼠标一动 → 惊醒动画；双击 = poke，**连点 4 次** = flail；跑到屏幕右缘收起成 mini 模式，hover 探头；agent 还在跑时重启 → 保持清醒不睡 |
| `nucket/NekoAI` | 经典 Neko 空闲序列 | 空闲 **3 分钟** 打哈欠、**5 分钟** 睡着（`useIdleSequencer.ts`：停→洗脸→挠→打哈欠→睡）；能量随时间与系统空闲下降；主动提醒「coding **90 min** — take a break!」 |
| `yanhanruan/Mutsumi` | 长时间不互动 → 变成正向功能 | 系统空闲 **6–30 分钟（可配置）** → 飘气球环游屏幕当屏保（顺带护屏）；有音乐时戴耳机律动，音乐停自动回到待机 |
| Shimeji 血统（`DalekCraft2/Shimeji-Desktop`） | 用配置表控制「烦不烦」 | 每个行为在 `behaviors.xml` 里有 **frequency** 字段，README 原话：想关掉某行为就把 **frequency 设成 0**；托盘有「Call Shimeji」随机再生成一只；右键桌宠可单独调教这一只 |
| `isHarryh/Ark-Pets` | 一键全局免打扰 | 托盘「透明模式」→ 屏蔽桌宠与鼠标的一切交互、点击直接穿透到下层窗口；该状态可持久化记忆 |
| `ChaozhongLiu/DyberPet` | 数值与交互细节 | 饱食度**每分钟**结算但只显示百分比（不刷屏）；拖拽有反弹；迷你宠物仅在 X 轴跟随、被拖开后自动回到角色身边；番茄钟与主动画模块解耦；退出前冻结并落盘（作者测得写数据约 **0.43 ms**） |
| `runcat-dev/RunCat365` | 零打扰状态表达 | 猫的奔跑速度 = CPU 占用，永远不弹窗、不发通知 |
| `ChanceYu/CoPet`、`Mutsumi` | 多级互动反馈 | 悬停 / 单击 / 双击 / 连点 / 长按 / 拖拽 各有不同反应 + 原生右键菜单 |

**三条可直接执行的陪伴律**：
1. 空闲必须**分档**（60s / 3min / 5min / 10min+），不要只有一个「待机」状态——有分档才像活的。
2. 主动行为一律**低频 + 可关 + 单次**：NekoAI 的 90 分钟提醒之所以不被骂，是因为它是低频且讲具体事实。
3. **用户动作触发 > 定时触发**；且任何「自己动起来」都要能被静音（Ark-Pets 的透明模式、Shimeji 的 frequency=0）。

---

## 5. 坑清单（Windows 透明窗 / 置顶 / 穿透 / 多显示器）

### 5.1 Electron 官方文档明写的（来源：仓库 `docs/tutorial/custom-window-styles.md` 原文，本次已抓取）
- **透明区域无法点击穿透**，官方直接指向 issue #1335（至今 open）。
- **透明窗不可 resize**；把 `resizable` 设 `true` 可能让透明窗在部分平台直接失效。
- **DevTools 一打开，窗口就不透明**（调试期极易误判「我的透明生效了」）。
- Windows 上：透明窗**无法**用系统菜单或双击标题栏最大化。
- 透明窗**不会显示系统原生阴影**。
- `blur()` 只能作用于窗口自身内容，无法模糊下层应用。

### 5.2 Electron 源码 / issue 级坑
- `setIgnoreMouseEvents(true, { forward: true })` **只有 macOS 与 Windows** 会转发鼠标移动；Linux 完全不转发。openpets 把这写成纯函数 `canForwardMouseEvents(platform)`，Linux 直接放弃穿透、保持可交互（源码 `apps/desktop/src/mouse-forwarding.ts`）。
- Windows 上 Chromium 的转发鼠标**会静默失效**：原文列出「pet 页面快速重载后」和「全屏扫过（fullscreen sweeps）」两种触发场景；macOS 上则会在 Space 切换 / 显示器睡眠 / 全屏切换后停止转发 → openpets 因此加了 **cursor-probe watchdog** 主动探测光标。**结论：不要把「光标是否在宠物身上」的判定 100% 押在 forward 事件上。**
- `setResizable(false)` 之后再 `setResizable(true)` 会让**透明失效**（electron#51094）——BongoCat/NekoAI 的绕法是干脆锁死 `resizable:false` 再用自建命令改尺寸。
- 置顶不是「设一次就好」：clawd 用 **5 秒看门狗**（`TOPMOST_WATCHDOG_MS = 5000`）反复 `setAlwaysOnTop(true, 'pop-up-menu')`，层级选 `pop-up-menu` 才能压过任务栏。
- 有焦点的置顶窗会**把全屏游戏踢出全屏**：clawd 单独用 **1 秒**轮询（`FOCUSABLE_POLL_MS = 1000`）在全屏时把 hit 窗切成非激活态，注释原文说慢看门狗会留出约 5 秒的空窗期。
- Windows 会**把窗口位置夹在屏幕边缘**，实际坐标与你请求的不一致 → clawd 会「学习」每个显示器的 clamp inset（`getObservedClampInset`）再据此算夹取边界。
- 显示器断开/重连后要恢复窗口位置（clawd PR #118）；前台有全屏应用时自动隐藏宠物（clawd PR #942/#973）。

### 5.3 Tauri（如果你未来想换栈，或想解释为什么 Tauri 项目都写 `shadow:false`）
- 每次 `window.show()` 在 `decorations:false + transparent:true` 下**白闪**（tauri#15490）。
- Windows 11 透明窗**自带阴影**，必须显式 `shadow:false`（tauri#14636）——这解释了为什么 BongoCat/Mutsumi/NekoAI/CoPet 四个项目的配置里都有这一行。
- 拖拽或焦点变化时出现**幽灵标题栏背景**（tauri#14764）。
- Windows 11 下 `transparent:true` 的**初始尺寸区域背景为白**（tauri#10318）。
- Windows 10 透明+置顶窗在**切换 cursor events 或最小化后偶发黑块 / 壁纸变黑**（tauri#15947，仍 open）。

### 5.4 其他项目的 issue（原生方案的老病）
- `Adrianotiger/desktopPet` #136：1.3.1 在 **Windows 11 上起不来**；#156：**不同分辨率的多显示器**出错（WinForms 分层窗口老坑）。
- `ayangweb/BongoCat` #857：Windows 下用 **OBS / Streamlabs 窗口捕获**透明窗 → 预览全黑或全透明（任何人做录屏 demo 都会遇到，issue 仍 open）。
- `pixelomer/Shijima-Qt` #12：Shimeji 系**默认不能点击穿透**，需要额外实现；#17：建议「所有 shimeji 合成单个全屏窗」以减少窗口数量（Wayland 下尤其必要）。

### 5.5 本次实测的环境备注
- 本机是 Windows 11 + PowerShell 5.1；`gh` 已认证（Aslanilles），匿名 `curl` 的 GitHub API 限额只有 60/h，**带 token 才是 5000/h**，本次全部走 `gh api`。
- 本机到 `commons.wikimedia.org` 请求失败（000），素材核对少一条来源。

---

## 6. 给 hermes-pet 的落地配方（可直接抄）

**(a) 窗口参数（Electron，一次写对，别后期补）**

```js
const win = new BrowserWindow({
  width: 192, height: 192,
  transparent: true, frame: false,
  alwaysOnTop: true, skipTaskbar: true,
  hasShadow: false, resizable: false, focusable: false,
  backgroundColor: '#00000000',
  webPreferences: { preload: path.join(__dirname, 'preload.js') }
})
// 置顶看门狗：抄 clawd 的 5 秒
setInterval(() => win.setAlwaysOnTop(true, 'pop-up-menu'), 5000)
```

**(b) 「只有宠物身体能点，其余穿透」**

```css
html, body { background: transparent; pointer-events: none; }
#pet { pointer-events: auto; }              /* 容器穿透，精灵可点 */
```
```js
// preload.js：鼠标进入/离开精灵时切换整窗忽略状态
el.addEventListener('mouseenter', () => ipcRenderer.send('ignore-mouse', false))
el.addEventListener('mouseleave', () => ipcRenderer.send('ignore-mouse', true, { forward: true }))
```
要点：容器 `pointer-events:none` + 精灵 `auto` 是**唯一**能实现「点空白穿透、点猫可交互」的组合；`forward:true` 只是保命（让你还能收到 mousemove），**不要**把它当作光标位置的唯一来源（见 §5.2）。

**(c) 三个该抄的数字**：置顶看门狗 **5000 ms**；全屏/焦点轮询 **1000 ms**；空闲沉睡阈值 **60 s**（再配 3 min 哈欠、5 min 深睡、90 min 单次主动提醒，且全部可关）。

**(d) 拖拽**：渲染进程 `pointerdown` + `setPointerCapture`（防止快速甩手丢事件），主进程 `win.setPosition`，并用 `screen.getAllDisplays()` 的 **workArea**（不是 bounds）做边界夹取——这样不会被任务栏压住。

**(e) 多显示器**：保存位置时记下**显示器 id**，重连后按 id 恢复；不要用绝对坐标（clawd 专门修过这个）。

---

## 7. 反调（站长如果只想听我不同意的部分）

1. **star 数在本清单里几乎不构成质量信号。** 23549⭐ 的 BongoCat 对 hermes-pet 的实际价值只是 `tauri.conf.json` 里那 6 行；而 **17⭐** 的 `nucket/NekoAI` 才是「Neko 形态 + AI 对话 + 空闲序列」的完整参考实现。按 star 排序会直接选错参考对象。
2. **Electron 派在这个赛道明显落后于 Tauri 派。** 15 个清单里 Electron 桌宠的 star 天花板只有 6276（且是 agent 状态显示器，不是宠物本体）；唯一「Electron + Live2D」的中文样本只有 90⭐ 且 2023 年后停更。想抄 Electron 透明窗的成熟做法，实际上没什么可抄的，得自己趟 §5.1/5.2 那些坑。**如果技术选型还能改，Tauri 在这个细分方向上的公开先例质量高一个档次**；既然已定 Electron，就老老实实按 §6(a)(b) 写对，别指望抄现成。
3. **「桌宠」这个赛道的真竞品已经不是桌宠，而是「AI coding agent 的状态显示器」**：`cc-haha` 14685⭐、`clawd-on-desk` 6276⭐、`openpets` 1226⭐、`agentpet` 364⭐、`ai-bubu` 28⭐、`chara-desk` 50⭐——全是把 agent 状态映射成一只会动的像素生物。hermes-pet 若只把自己定位成「陪伴」，会被这批工具顺手覆盖；建议**第一身份明确为「琉斯运行状态的物理化身」**（陪伴是副产品），这样连 §4 的频率设计都有了天然约束：状态驱动 > 随机卖萌。
4. **素材维度别指望「好看」和「干净」兼得。** 实测能直接进 Electron 且许可最干净（Unlicense/CC0）的猫精灵表，全是 1990s–2000s 血统的老像素素材（oneko 32×32）、观感一般；好看的（Live2D 官方样例模型、Lovely 系）许可都不干净。**30 分钟 MVP：用 oneko 的 32×32 帧 + x2 放大渲染（`image-rendering: pixelated`）**，审美问题留给 M1。
5. **Shimeji 血统最值钱的不是代码，是 `behaviors.xml`。** 那套「行为 + frequency + 前置条件」的 XML 就是一套现成的「陪伴度调参面板」，用 JSON 复刻它比移植 Java 代码划算一个数量级。

---

## 8. 未完成 / 存疑（不装懂）

- star 数是 2026-09-23 抓取瞬时值，会变；引用时请注明日期。
- `NOASSERTION` 类许可我逐个额外调了 `/license` 端点核对文件（`gil/shimeji-ee`、`DalekCraft2/Shimeji-Desktop`、`TigerHix/shimeji-universal`、`shinyflvre/Mate-Engine`）；但「无 LICENSE」只代表仓库根没有许可文件，不代表作者不主张权利。
- Kenney 站点的 CC0 声明为站点级声明，本次**未逐项核验**其许可字段（已在表中降级标注）。
- `nucket/NekoAI` 的 3 min / 5 min 阈值来自 README 文字描述，未逐行核对 `useIdleSequencer.ts` 源码常数。
- §5 各条 issue 的**编号与标题**为实测抓取，但 issue 正文我只逐字读了 BongoCat #857 与 clawd 源码注释；其余为标题级证据。
- 未做的事：没有 clone 任何仓库本地复现运行；没有实测 Electron 在本机的透明窗行为（本报告 §5.1/6 的窗口配方是官方文档 + 三个成熟项目的配置归纳，未经 hermes-pet 本体验证）。**建议 MVP 第一步就先跑一个 10 行的透明窗 demo 验证 §6(a)。**

（报告结束）