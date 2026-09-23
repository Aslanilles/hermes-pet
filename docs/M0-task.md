# codex 执行任务书：hermes-pet M0（自包含）

> 执行者：codex（OpenAI Codex CLI）｜ 工作目录：D:\Jiayi\Projects\hermes-pet
> 上游设计：docs/M0-spec.md（架构 + 契约，先读完再动手）；产品设计 v0.1 供理解「陪伴感」取向，不改它
> 本轮目标：一小时内交付「能跑起来、有陪伴感」的 MVP；只写本任务书列出的文件，其余不动

## 0. 开工前必读（顺序）
1. 读 docs/M0-spec.md（这是你的唯一契约，IPC 通道、状态机、schema、阈值都在里面）。
2. 读项目根 .gitignore，确认 .env / node_modules 已被忽略（缺了就补，但别覆盖已有规则）。
3. 读 hermes-pet-product-design.md 的 4.1 气质、4.2 色彩、4.7 外观三节（理解为什么配色是深蓝+金、动画要克制）。
4. 确认素材：把 $env:TEMP\oneko.gif 复制到 assets\oneko.gif（见 6.1）。

## 1. 环境（已实测，不要重新探测）
- 宿主 Windows 11；Node v24.19.0 + npm 11.17（在 D:\SoftwareDownload\node.exe，PATH 里可能没有，启动器里用绝对路径）。
- 无 Rust（Tauri 出局，不用管）。Docker 29.6 可用（只用于容器内跑 node --test，见 7）。
- 装依赖的唯一正确姿势（否则 electron 二进制从 github 下载会失败）：

```
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
npm install --registry=https://registry.npmmirror.com
```

- 验证安装成功的判据：node_modules\electron\dist\electron.exe 存在，且 npx electron --version 能打印版本号。

## 2. 逐文件要写什么（关键签名 + 行为要求，不给完整代码）

### 2.1 core/（纯逻辑，零 electron 依赖，UMD-lite 双导出，node --test 直测）
UMD-lite 模式（每个 core 文件开头结尾统一）：开头判断 module 存在则 module.exports = api，否则挂到 window.PetCore（如 window.PetCore = window.PetCore || {}; window.PetCore.StateMachine = api）。这样同一份文件在 Node（require）与浏览器（script 标签）都能用。

- core/state-machine.js
  - 导出 STATES 常量与 EVENTS 常量（与 spec 3.2 一致：IDLE_T1 3min、IDLE_T2 5min、POINTER 阈值 120px）。
  - 导出 transition(currentState, event, ctx) -> nextState（纯函数，无副作用，不读时钟之外的东西）。
  - 导出 nextState 用到的辅助 isIdleTimeout(state, ctx)。
- core/scheduler.js
  - 导出 todayKey(date) -> 本地日期串 YYYY-MM-DD。
  - 导出 evaluate(now, state, config) -> 事件数组（元素形如 { type, text, buttons, timeoutMs }，type 取值 greet|rest|sunset|drowse）。
  - 导出 applyEvent(state, event, now) -> 新 state（纯函数，用于落盘）。
  - 导出 isWorkingContinuously(state, now)、shouldRestReminder(state, now)、rateLimitAllows(state, now, config)。
  - 内置阈值常量：空闲打盹 30min、工作会话 gap 5min、连续工作 40min、说话冷却 2h、日落 22:30。
- core/deep-night.js：导出 isDeepNight(date, config) -> boolean（22:00 含、07:00 不含，受 config.deepNightEnabled 控制）。
- core/config-schema.js：导出 DEFAULT_CONFIG、DEFAULT_STATE、sanitizeConfig(partial)（白名单字段 + 类型校验 + clamp size 60..180、actionFrequency 30..90）、mergeWithDefaults(partial, defaults)。
- core/mock-replies.js：导出 match(input) -> string（关键词表，琉斯人格：温柔带毒舌的损友，文案用「」，默认 ≤ 2 句，多条随机兜底）。
- core/sprite-map.js：导出 SPRITE_LAYOUT（一个对象：state -> { row, frames:[[col,row]...], fps, loop }，照 spec 3.3 的映射表）。这是纯数据，改它不改逻辑。
- core/adapter-router.js：导出 pickAdapter(config, gatewayAvailable) -> 'mock' | 'gateway'（覆盖 auto/mock/gateway 三态与降级）。

### 2.2 adapters/
- adapters/adapter-interface.js：注释形式写清契约（name / isAvailable / reply / greeting），并导出该接口的 JSDoc，供两个实现对齐。
- adapters/local-mock.js：实现契约，内部调 core/mock-replies.match；greeting(ctx) 按 ctx.now 分早/中/晚返回问候语并询问昵称。
- adapters/hermes-gateway.js：实现契约，读 HERMES_GATEWAY_URL（process.env），走 OpenAI 兼容 POST，带 Bearer HERMES_API_KEY；失败抛错或返回 null（由上层降级）。此文件只在主进程 require，不进 core（避免把网络带进单测）。

### 2.3 main.js（主进程）
- 手写 loadEnvFile() 解析 .env（15 行内，不引 dotenv），只覆盖尚未定义的 process.env 键。
- 建桌宠 BrowserWindow：transparent:true, frame:false, hasShadow:false, skipTaskbar:true, alwaysOnTop:true, resizable:false, contextIsolation:true, nodeIntegration:false, webPreferences.preload 指向 preload.js；首次位置右下角（用 screen.getPrimaryDisplay().workArea 算）。
- 注册 spec 2.3 全部 ipcMain.handle / ipcMain.on；实现 AppStore（读写 config.json/state.json，路径 app.getPath('userData')，若设了 HERMES_PET_DATA_DIR 则用该目录）。
- 主动调度：一个 setInterval 每 30s，evaluate -> 逐条 webContents.send（greet 走 pet:greet，rest/sunset/drowse 走 pet:remind）-> applyEvent 落盘；顺带重算 isDeepNight，变化时推 pet:deep-night。
- 鼠标靠近：setInterval ~300ms 读 screen.getCursorScreenPoint，算到窗口矩形距离，进/出 120px 阈值时推 pet:approach（只在变化时发，别每 tick 都发）。
- 托盘：建 Tray（图标可先用一个 16x16 的简易 png 或 icon 数据，见 6.3），单击 toggle 显示/隐藏，右键菜单按 spec 2.4（对话/设置/固定位置/重置位置/暂停/退出）。
- 设置窗口：单例 BrowserWindow 加载 renderer/settings.html，普通框即可。
- 开机自启：setAutoStart(true) 用 app.setLoginItemSettings（Windows 生效），false 反之；返回实际值。
- 退出前：写 state.json（含 lastSeenAt 与当前 windowPosition）。

### 2.4 preload.js
- contextBridge.exposeInMainWorld('petAPI', { ... }) 暴露 spec 2.1 全部方法；petAPI.on(event, cb) 用 ipcRenderer.on 订阅 2.2 的 7 个通道，返回取消订阅函数。绝不把 ipcRenderer 原样透出。

### 2.5 renderer/
- index.html：加载 ../core/*.js（script 标签，顺序：先 core 后 renderer）、pet.css、pet.js、sprite.js、bubble.js；加 CSP meta（default-src 'self'；img-src 'self' data:；style-src 'self' 'unsafe-inline'）。body 内：精灵元素（32x32 底图，background-image 指向 assets/oneko.gif，background-size 256x128）、气泡容器、输入框（默认隐藏）。
- pet.css：透明背景 body；.pet 用 -webkit-app-region: drag；气泡/输入框/按钮 -webkit-app-region: no-drag；.deep-night 的降饱和与深色板；气泡圆角 12px 底色 #F7FAFC 半透明；入场/弹泡/消失关键帧。
- sprite.js：帧循环器 setInterval，按 SPRITE_LAYOUT 算 background-position = -(col*32)px -(row*32)px；接受 fps 与 loop 次数；deep-night 时由 pet.js 传入减半后的 fps。
- bubble.js：show(text, {buttons, timeoutMs}) 做打字机（每字 30-50ms）+ 出现/消失动画 + 按钮渲染；全部用 textContent，不用 innerHTML。
- pet.js：初始化时 petAPI.getConfig/getState；new PetCore.StateMachine 驱动 sprite.js；绑单击（唤起气泡+输入框，Enter 发送走 petAPI.ask、Esc 关闭）、双击（petAPI.openSettings）、拖拽结束（petAPI.persistPosition）、交互上报（petAPI.reportActivity）；订阅 petAPI.on 全部事件并派发到状态机/气泡/样式。
- settings.html/settings.css/settings.js：表单五项（昵称/显示大小 60-180/主动提醒开关/开机自启/深夜模式开关），载入时 getConfig 回填，改动即 setConfig，保存反馈；深夜模式说明文字用「」。

### 2.6 tests/（node --test，零依赖，容器可跑）
每个文件对应一个 core 模块，用 node:test + node:assert。覆盖：
- state-machine.test.js：POINTER_NEAR/FAR、IDLE_T1/T2、INTERACT 唤醒、RANDOM_ACTION、PAUSE/RESUME。
- scheduler.test.js：首启问候只一次、打盹 30min、休息 40min 边界（39:59 否 / 40:00 是）、5min gap 切分会话、说话 2h 冷却吞掉、日落跨天只一次。
- deep-night.test.js：21:59 否 / 22:00 是 / 06:59 是 / 07:00 否、deepNightEnabled:false 恒否。
- config-schema.test.js：默认值、未知字段丢弃、size clamp（59->60、181->180）、actionFrequency clamp。
- mock-replies.test.js：每类关键词命中、兜底非空、返回是 string。
- sprite-map.test.js：SPRITE_LAYOUT 八态齐全、每个 (col,row) 在 0..7 / 0..3 内、fps 为正。
- sprite-dimension.test.js：读 assets/oneko.gif 头部字节，断言 magic 是 GIF89a（或 GIF87a）、宽 256、高 128（这是本素材实测值）；再断言 SPRITE_LAYOUT 引用到的瓦片不越界（见 6.1）。

### 2.7 交付件（全 ASCII / 幂等 / 说明）
- 启动hermes-pet.cmd（纯 ASCII，禁中文，禁注释里放中文）：cd 到脚本所在目录；用绝对路径调 node/npx；若 node_modules\electron 不存在则先跑一次带镜像的 npm install（见 1）；然后启动 electron（. 或 main.js）；幂等 = 重复双击不会重复安装、不会残留进程。
- README.md：中文说明（怎么装、怎么跑、镜像注意事项、数据存哪、怎么暂停/退出）。
- .hermes-docker.md：说明容器（Linux、无显示器）只跑 node --test tests/（零依赖），GUI 只在 Windows 宿主跑；给出容器内一条验证命令。
- scripts/verify-sprite.js（可选）：零依赖解析 GIF 头并打印每瓦片非透明像素数，辅助目检（可跑 node scripts/verify-sprite.js）。

## 3. 验收清单（两栏）

### A 栏：codex 自证（脚本化，跑完把命令与输出贴回来，逐条）
1. node --check 通过：对 main.js / preload.js / renderer 下所有 .js / core 下所有 .js / adapters 下所有 .js 逐个 node --check，全绿。
2. node --test tests/ 全绿（零依赖，容器里也能跑，本机更该跑）。
3. npm install --registry=... 成功，且 node_modules/electron/dist/electron.exe 存在、npx electron --version 有输出。
4. 无外网依赖断言：node -e 打印 package.json，dependencies 为空、devDependencies 仅 electron。
5. GIF 尺寸断言：node --test tests/sprite-dimension.test.js 通过（宽 256 高 128、magic 正确）。
6. 精灵瓦片自洽：SPRITE_LAYOUT 所有 (col,row) 在 8x4 网格内（sprite-map.test.js 覆盖）。
7. 宿主目检精灵映射：跑 npx electron . 让猫出现，逐一确认 8 个状态的帧对应正确（用 scripts/verify-sprite.js 打印的瓦片像素分布 + 肉眼核对），有偏差就改 core/sprite-map.js 并在提交说明里写清改了什么。
8. 中文文案自证：grep（findstr / Select-String）renderer 与 core 里的文案，确认无半角双引号包裹中文、全部用「」。

### B 栏：人工（站长）在桌面 GUI 验收（不是脚本，逐条）
1. 双击「启动hermes-pet.cmd」，右下角出现一只猫，有入场动画（不是瞬间蹦出来）。
2. 窗口透明、无边框、置顶、任务栏无图标；鼠标按住猫能拖走，重启后回到上次位置；首次启动落在右下角。
3. 鼠标靠近猫 -> 变 alert（抬头/警觉）；离开 -> 回到 idle；长时间不动 -> 渐入 tired -> sleeping（打盹）。
4. 单击猫 -> 头顶弹气泡 + 输入框，Enter 有打字机回复（local-mock 语气是温柔带毒舌损友），Esc 关闭；双击 -> 打开设置面板。
5. 托盘图标在系统托盘；右键菜单六项齐全，逐项能点：对话/设置/固定位置/重置位置/暂停/退出；单击 toggle 显隐。
6. 设置面板改昵称、大小（60-180 滑杆）、三个开关，重开仍在（持久化）。
7. 等 40 分钟连续工作 -> 休息提醒带「休息5分钟」按钮；空闲 30 分钟 -> 打盹；22:30 -> 日落提醒（可用改系统时间或临时把阈值调小来加速验证，验证完改回）。
8. 深夜模式（22:00-07:00）自动降饱和、动画变慢（可改系统时间验证）。
9. 主动说话频率上限：验证后 2 小时内不重复主动打扰（以 state.json 的 lastSpokenAt 判断）。

## 4. 不要做什么（硬约束）
1. 不引入任何构建工具 / bundler / UI 框架 / 运行时依赖（electron 除外）；不引 dotenv、不引 node-fetch（用 Node 24 内置 fetch）。
2. 不改 hermes-pet-product-design.md 与 docs/M0-spec.md / docs/M0-task.md。
3. 不碰 .env 与 .env.example 的写入；只读 .env，且绝不打印 HERMES_API_KEY、绝不把密钥写进任何 JSON/日志/git。
4. 不在 D:\Jiayi\ 根目录新建任何文件或文件夹（站长铁律），所有产物落在 D:\Jiayi\Projects\hermes-pet 内。
5. 不删、不迁移现有 PySide6 骨架（src/、pyproject.toml、.venv、.pytest_cache、tests/test_dummy.py），就当它们不存在。
6. 不用 nodeIntegration:true、不用 remote、不把 ipcRenderer 透出 preload；渲染进程不碰 fs/网络/进程环境。
7. 不做多角色、语音、Live2D/VRM、向量记忆、读屏读情绪（超出 M0 范围）。
8. 不给气泡用 innerHTML；外部文本一律 textContent。

## 5. 已知坑（务必避开）
1. 容器是 Linux 且无显示器：electron GUI 绝不在容器里跑；容器只跑零依赖的 node --test tests/。GUI 与 npm install 都在 Windows 宿主。
2. 装 electron 必须设镜像：npm install --registry=https://registry.npmmirror.com 且 $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'，否则 electron 二进制从 github 下载失败。
3. Windows 透明窗口参数一个不能少：transparent:true, frame:false, hasShadow:false, skipTaskbar:true（加 alwaysOnTop:true, resizable:false）；拖拽用 CSS -webkit-app-region: drag，交互元素标 no-drag；备选方案 IPC + win.setPosition。
4. 别用 nodeIntegration:true + remote；用 contextIsolation:true + preload.js 暴露白名单 API。
5. 透明窗口的透明区域不响应鼠标：别指望在透明处收 mouseenter；鼠标「靠近」必须主进程 screen.getCursorScreenPoint 轮询，节流只在阈值翻转时发。
6. 托盘图标需要真实图片文件：没有现成 icon 就生成一个 16x16 简易 png（或用 assets 里深蓝猫的缩略），否则 Tray 建不出来或白图标。
7. oneko.gif 是「静态单帧图集」不是「逐帧 GIF 动画」：用 CSS background-position 切帧，别用 img 循环帧；瓦片 32x32，图集 256x128 = 8 列 x 4 行。

## 6. 素材处理

### 6.1 oneko.gif 落位
- 从 $env:TEMP\oneko.gif 复制到 assets\oneko.gif（二进制原样，勿改内容、勿重命名）。用 PowerShell：Copy-Item $env:TEMP\oneko.gif D:\Jiayi\Projects\hermes-pet\assets\oneko.gif（先 New-Item -ItemType Directory -Force assets）。
- sprite-dimension.test.js 里写死断言：magic 为 GIF89a（兼容 GIF87a 也可）、宽 256、高 128（这是素材实测值，不是猜的）。

### 6.2 自绘 SVG 猫（assets/pet.svg，保底可见素材）
规格（必须满足，否则不算完成）：
- 透明背景；猫本体只用深蓝 #2D3748，眼睛/点缀只用金色 #ECC94B，无第三种主色。
- 形态：几何化猫——圆头、三角耳、大金色圆眼、深蓝身体、简洁线条；尾巴可作情绪指示（此处静态一版即可）。
- 尺寸：viewBox 0 0 32 32（与 GIF 瓦片同尺寸，可直接替换精灵底图）。
- 用途：当 GIF 映射未目检到位或图集加载失败时，渲染进程 fallback 到 pet.svg，保证「猫一定可见」。
- 实现提示：CSS 里给 .pet 同时准备 background-image: url(assets/pet.svg) 的兜底类，GIF 正常时用图集类。

### 6.3 托盘图标
- 若无现成 16x16 png，用一个 16x16 的深蓝猫头 png 或直接复用 SVG 转出的小图（NativeImage.createFromDataURL 或从 assets 读）；不要留空，否则托盘不显示。

## 7. 容器（Docker）工作流（.hermes-docker.md 要写清）
- 容器只验证逻辑：node --test tests/（零依赖、无显示器、无 electron）。
- 一条命令示意：docker run --rm -v ${PWD}:/app -w /app node:24 node --test tests/（注意容器内不需要 npm install，因为 tests/ 只 require core/ 里的纯逻辑）。
- 明确写：GUI 无法在容器跑，Windows 宿主才是验收环境。

## 8. 自我迭代条款（结尾，必须遵守）
- 写完所有文件后，你必须自己跑完 A 栏全部可脚本化验收项（node --check、node --test、npm install、依赖断言、GIF 断言、文案自证），修掉自己引入的每一处失败，直到全绿。
- 目检精灵映射发现偏差就改 core/sprite-map.js（这是允许你改数据的唯一情况），并在交付说明里写清改了什么、为什么。
- 自证清单 + 每条的命令与输出，随交付一起贴出；不自证完、不贴证据，不算完成。

（全文完，蓝图）