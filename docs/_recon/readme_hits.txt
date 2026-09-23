### ayangweb/BongoCat  (readme lines=152)
  ![BongoCat](https://socialify.git.ci/ayangweb/BongoCat/image?custom_description=&description=1&font=Source+Code+Pro&forks=1&issues=1&logo=https%3A%2F%2Fgithub.com%2Fayangweb%2FBongoCat%2Fblob%2Fmaster%2Fsrc-tauri%2Fassets%2Flogo-mac.png%3Fraw%3Dtrue&name=1&owner=1&pattern=Floating+Cogs&pulls=1&stargazers=1&theme=Auto)
  同时，得益于 [Tauri](https://github.com/tauri-apps/tauri) 强大的跨平台能力，本项目不仅支持 macOS，还兼容 Windows 和 Linux(x11)，让更多的用户都能与这只可爱的猫咪互动！
  - 完全开源，代码公开透明，绝不收集任何用户数据。
### rullerzhou-afk/clawd-on-desk  (readme lines=425)
  - **CodeWhale** — optional state-only lifecycle hooks via `~/.codewhale/config.toml` (`[[hooks.hooks]]` entries) (install from Settings → Agents or run `npm run install:codewhale-hooks`); Phase 1 drives idle, thinking, working, sleeping, error, attention, and sweeping animations only, without permission bubbles or subagent tracking
  - **TraeCode (Trae CN)** — experimental, state-only hook integration via `~/.trae-cn/hooks.json` (install from Settings → Agents or run `npm run install:traecode-hooks`, uninstall with `npm run uninstall:traecode-hooks`). Trae stores the session title server-side, so Clawd derives it from the first prompt line and keeps the first one per session. Hooks must be enabled manually in Trae (**Settings → Hooks → Enable**, run mode: **Sandbox**) — see the [official Trae hooks doc](https://docs.trae.cn/ide/automate-actions-with-hooks). First release is scoped to Trae CN; the international Trae build is not covered. State-only: no permission decisions (stdout is always `{}`) and no `SessionEnd` — closed conversations retire via the desktop idle-timeout cleanup
  - **12 animated states** — idle, thinking, typing, building, subagent groove, multi-subagent juggling, error, happy, notification, sweeping, carrying, sleeping
  - **Eye tracking** — Clawd follows your cursor in idle state, with body lean and shadow stretch
  - **Sleep sequence** — yawning, dozing, collapsing, sleeping after 60s idle; mouse movement triggers a startled wake-up animation
  - **Drag from any state** — grab Clawd anytime (Pointer Capture prevents fast-flick drops), release to resume
  - **Mini mode** — drag to right edge or right-click "Mini Mode"; Clawd hides at screen edge with peek-on-hover, mini alerts/celebrations, and parabolic jump transitions
  - **Click-through** — transparent areas pass clicks to windows below; only Clawd's body is interactive
  <td align="center"><img src="assets/gif/clawd-idle.gif" width="100"><br><sub>Idle</sub></td>
  <td align="center"><img src="assets/gif/calico-idle.gif" width="80"><br><sub>Calico Idle</sub></td>
  <td align="center"><img src="assets/gif/cloudling-idle.gif" width="120"><br><sub>Cloudling Idle</sub></td>
  Clawd adapts to multi-monitor setups: proportional sizing uses the display Clawd launches on, portrait monitors get a bounded boost so the pet stays readable on tall narrow screens, and you can drag Clawd across displays.
  <p align="center"><sub>Want to see the real multi-monitor behavior? <a href="assets/videos/clawd-multi-monitor-demo.mp4">Watch the demo video in this repository</a>.</sub></p>
  Run from source only if you're contributing, testing unreleased code, or debugging integrations. Source installs download Electron/build tooling and can create a large `node_modules` tree.
  **Minimum viable theme:** 1 SVG (idle with eye tracking) + 7 GIF/APNG files (thinking, working, error, happy, notification, sleeping, waking). Eye tracking can be disabled to use any format for all states.
  Theme cards in `Settings…` → `Theme` now expose capability badges such as `Tracked idle`, `Static theme`, `Mini`, `Direct sleep`, and `No reactions`, so users can tell what a theme supports before switching.
### OpenPetsHQ/openpets  (readme lines=312)
  - **Desktop pets**: animated companions that idle, wander, react, and keep your workspace from feeling empty.
  Launch the Electron application in local developer mode:
  apps/desktop Electron desktop application
  - [`docs/desktop.md`](docs/desktop.md) - The Electron app: process model, tray-first UX, Control Center, security model.
### nucket/NekoAI  (readme lines=450)
  [![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%202-blue?logo=tauri)](https://tauri.app)
  | 😴 Dynamic mood — energy changes with time of day & idle time | ✅ |
  | 🔔 Proactive nudges ("coding 90 min — take a break!") | ✅ |
  # Prerequisites: Node.js 22+, pnpm 11+, Rust 1.75+, Tauri CLI
  pnpm tauri dev # Development with hot reload
  pnpm tauri build # Production build
  | OS idle time | Energy drains gradually while inactive |
  - **Animations** — yawns after 3 min idle, falls asleep after 5 min
  ├── src-tauri/ # Rust backend (Tauri v2)
  │ ├── lib.rs # App setup, tray, Tauri commands, resize_window
  │ ├── desktop_monitor.rs # Active window & idle time (Windows + Linux/X11)
  │ ├── HouseWindow.tsx # Pet house widget (separate Tauri window "house")
  │ │ ├── useIdleSequencer.ts # Classic Neko stop→wash→scratch→yawn→sleep idle sequence
  │ └── configStore.ts # AI config & pet size persisted via Tauri commands
  NekoAI uses a Tauri command (`resize_window`) to bypass OS-level restrictions when the window has `resizable: false` in its configuration. This is necessary because:
  NVIDIA's `integrate.api.nvidia.com` endpoint is designed for server-to-server usage and does not send CORS headers. Unlike the other providers (Anthropic, OpenAI, Gemini) which explicitly support browser CORS, a direct `fetch()` from Tauri's WebView would be silently blocked.
  NekoAI works around this with a dedicated `nvidia_chat` Tauri command (`lib.rs`) that makes the HTTP request from native Rust via `reqwest`, completely bypassing the WebView's CORS enforcement. The TypeScript provider uses `invoke('nvidia_chat', ...)` instead of `fetch`. This keeps the same `AIProvider` interface for all providers while letting NVIDIA NIM work correctly.
  | **v0.1** ✅ | Core: transparent window, Neko sprite, cursor tracking, AI chat |
### kirbystudy/chatgpt-desktopPet  (readme lines=122)
  ✨ 基于 Electron 开发的桌面宠物 ✨
  - [x] 支持 拖拽模型(单屏/双屏)
  - Electron As Wallpaper [electron-as-wallpaper](https://github.com/meslzy/electron-as-wallpaper)
  7. Electron 版本号 v24.1.1 不兼容 win7，因此降级版本号 v21.4.4
### ChanceYu/CoPet  (readme lines=153)
  Built with Tauri, Rust, and React. Lightweight, local-first, no cloud.
  <td align="center"><img src="./public/pets/dragon.gif" width="96" alt="Azure Dragon"><br><sub>Azure Dragon</sub></td>
  - Rich pet interactions: hover, click, double-click, rapid-click petting, long-press, drag reactions, and native context menu.
  Drag `CoPet.app` into `/Applications`. The build is not notarized, so run once to clear the quarantine flag:
  pnpm tauri:dev # development
  pnpm tauri:build # production bundle
  - `src-tauri/` — Rust core, agent adapters, runtime server.
  - `src-tauri/assets/pets/` — built-in pet packages bundled with the app.
  - `src-tauri/assets/sounds/` — built-in global sound packs bundled with the app.
### isHarryh/Ark-Pets  (readme lines=175)
  2. 桌宠可以被拖拽到扩展显示屏上；
  2. 菜单可用于开启手动模式和启用透明模式；
  - 支持透明模式等配置的记忆
  - **透明模式** ：为防止用户在游戏、观看视频等情景下误触到桌宠，只需在托盘菜单中打开 “透明模式”，即可屏蔽桌宠和鼠标的一切交互（鼠标操作将穿透到下层窗口）。
### ChaozhongLiu/DyberPet  (readme lines=723)
  - 新增了客制化鼠标光标：进入桌宠范围、拍拍、拖拽均显示不同光标
  - 优化了迷你宠物仅在 X 轴跟随角色时的行为（左右行走、被拖拽开后自动回到角色身边）
  - 在左键拖拽情况下锁定右键菜单
  - 给宠物拖拽添加了反弹机制
  - 优化了番茄钟和专注时间倒计时UI的显示区域及其对主动画模块的影响
  - 数据存写大概花费0.43ms，有极小概率在该间隔内关闭软件导致数据丢失。本次优化在每次关闭前主动存储一次数据，并冻结数据，执行退出。
  - 设置内添加是否置顶的选项
  - 删除了``pet_config``中的 ``gravity``, ``hp_interval``, ``fv_interval``
  - 添加了设置界面，可以改变大小、重力、拖拽速度、音量
  - 更新了饱食度随时间下降的计算逻辑，每一分钟都会变化，但只显示百分比，与用户定义的 ``hp_interval`` 相关
  - 框架拖拽掉落的计算逻辑参考了 [WolfChen1996](https://github.com/WolfChen1996/DesktopPet)
### runcat-dev/RunCat365  (readme lines=60)
### shinyflvre/Mate-Engine  (readme lines=621)
  Generates cute messages when you drag the avatar, make it dance, or let it sit on windows or the taskbar.
  | Idle Animation | ✅ | ✅ | ✅ |
  | Dragging Animation | ✅ | ✅ | ✅ |
  | Always On Top Toggle | ❌ | ✅ | ✅ |
  | 拖拽动画 | ✅ | ✅ | ✅ |
  | 始终置顶切换 | ❌ | ✅ | ✅ |
  - **拖拽动画** – 移动时轻轻漂浮
  - **FPS设置、始终置顶、迷你模式** 等功能也已搭载
### yanhanruan/Mutsumi  (readme lines=360)
  <img src="app-icon-cucumber-puppy-transparent-compress.png" alt="Mutsumi Logo" width="120" />
  <!-- 建议这里放一张角色的透明底头像 -->
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white" alt="Tauri 2"></a>
  <td align="center"><img src="docs/images/idle.avif" width="200" alt="Mutsumi idle" /><br/><sub>🌿 静静陪伴 · just hanging out</sub></td>
  她不会打扰你工作，只是自顾自地待在那里。当你播放音乐时，她会默默戴上耳机感受节奏；当你感到疲惫时，可以戳戳她、喂杯茶。得益于 **Tauri 2 + Rust** 的底层驱动，她非常轻量，几乎不占用系统资源。
  👻 **无感陪伴，穿透点击**：始终悬浮在屏幕最前方，但透明区域完全穿透，绝不遮挡你点击底部的代码或网页。你可以随时把她拖拽到屏幕的任意角落。
  > 🐍如果用毒蛇的毒毒毒蛇，毒蛇会不会被毒蛇蛇毒的毒毒死？😆众所周知，作为最猛没有之一的大爬虫，各大浏览器引擎厂商采用了及其严苛的底层加密（浏览器高级指纹识别、自动化框架特征检测、 引擎混淆与反调试、TLS/JA3 指纹、HTTP/2 帧指纹等等）以实现anti-scraping & bot-detection，原始的搜索增强方案主包采用了rust的reqwest plus fallback 切换引擎处理，效果并不理想，究其原因就是前文的底层加密，深入研究后发现如果真的攻克这些技术难点，主包可能会被通缉(，并且时间花费性价比太低。因此主包采用了一种更为巧妙的实现方式，类似于Python的无头浏览器，区别在于tauri框架会根据操作系统自动匹配WebView，因此所需额外的lib依赖为零。通过这种方式，成功实现“以彼之矛，攻彼之盾”，同时每个客户端独立、安全、隐私，不需要任何额外的ip连接池或者指纹破解。
  - **渲染后的 HTML 传递问题：** Tauri v2 的安全模型下，一个远程页面不允许调用应用命令。解法：给这个 `serp-fetcher` 窗口单独授一份能力（`capabilities/webview-serp.json`），注入的 init-script 通过核心 event 插件（`plugin:event|emit`）把渲染后的 `outerHTML` 发回 Rust。每次导航在 URL 的 **query**（`&__serpid=…`——故意用 query 而非 fragment，这样即便被 `continue=` 重定向包裹也能存活）里带一个请求 id，脚本在 document-start 读到并回传以对上号；当某引擎在重定向里丢了这个参数时，再用"当前唯一在途导航"兜底路由——因为所有导航都串行，在途永远只有一个。
  如果你想研究 Tauri 的异形窗口或系统音频捕获逻辑，欢迎克隆代码！
  npm run tauri dev
  Tauri 2（Rust 后端）+ Vue 3 前端，打包为单文件原生 Windows 应用。
  ├── src-tauri/src/ Rust 后端
  │ └── idle.rs 待机行为逻辑
  Mutsumi is a quiet little companion living in the corner of your screen. She minds her own business, puts on her headphones when you play some tunes, and reacts when you interact with her. Powered by **Tauri 2 + Rust**, she is exceptionally lightweight and consumes virtually no system resources.
  Stays on top of all your windows, while fully transparent areas let your clicks pass straight through. Your code, browser, and apps remain completely accessible. Drag her anywhere on your screen at any time.
  After your computer has been idle for a configurable period (6–30 minutes), Muto will take off with a tiny cucumber balloon and gently float around your screen. It’s a fun little screensaver that also helps protect your display. You can enable or disable it anytime in Settings.
  Start playing music or a video, and she'll instantly put on her headphones and groove along to the beat. When the audio stops, she'll take them off and quietly return to idle.
  A little speaker icon sits in the bottom-right corner and pulses along with your audio. Hover to expand a control panel — play/pause, previous/next, skip ±10s, replay, plus system volume and mute — alongside the current track, artist, and a progress bar you can click or drag to seek. When multiple apps are playing at once, switch between sources or let it auto-follow whichever one is most active. Built on Windows System Media Transport Controls (SMTC), so it drives anything that's playing: Spotify, NetEase Cloud Music, browser media, and more (Update to the latest version). Toggle it anytime from Settings.
### JianguSheng/yuns-desktop-pet  (readme lines=334)
  <img src="https://img.shields.io/badge/Electron-28.0.0-47848F?logo=electron" alt="Electron"/>
  ├── main.js # Electron 主进程
  ### 窗口置顶
  在 **设置** → **通用设置** 中可开启窗口置顶功能。
  | electron | 桌面应用框架 |
  | electron-store | 数据持久化 |
  | electron-builder | 应用打包 |
