# hermes-pet M0 架构设计（架构裁定 + 契约）

> 版本：M0 ｜ 作者：blueprint（包工头👷）｜ 日期：2026-09-23
> 上游：产品设计 v0.1 + M0 功能集（脑洞）+ 派单任务书（调度者）
> 下游：codex（执行者）按 docs/M0-task.md 落地；杠精按本文接口契约做可测性审查

## 0. 结论速览（钉死的事，不要再来问）

1. 技术栈（已定，直接采纳）：Electron + 原生 HTML/CSS/JS；无构建步骤、无 UI 框架、除 electron 外零 npm 依赖。electron 装为 devDependency。
2. 进程分工：主进程 = 持久化 + 主动行为调度 + 回复适配器 + 托盘 + 设置窗口 + 窗口管理；渲染进程 = 精灵动画状态机 + 气泡 + 输入交互。纯逻辑下沉 core/，零 electron 依赖，容器内 node --test 可跑。
3. 单一事实源：core/*.js 用「UMD-lite」双导出（Node 下 module.exports、浏览器下挂 window.PetCore），主进程 / 渲染进程 / 单测三处共用同一份逻辑，杜绝状态机写两遍。
4. 适配器跑在主进程：.env 读取、网络请求都在主进程；渲染进程只通过 IPC 发 ask，绝不在渲染进程碰网络或密钥。
5. 素材：oneko.gif 实测为静态单帧图集（GIF89a，256×128，8×4 个 32×32 瓦片，Format8bppIndexed 索引透明），用 CSS background-position 逐帧播放，不是 GIF 帧动画。配套一张自绘 SVG 猫做保底可见素材（深蓝 #2D3748 + 金色 #ECC94B，透明背景）。
6. 精灵行/帧映射以经典 oneko.js 图集布局为准（见 3.3 映射表），但列为「需宿主目检核对」的数据项——错的是数据不是逻辑，改 sprite-map.js 即可。
7. 位置/设置/状态持久化到 Electron userData 目录（Windows 下 %APPDATA%\hermes-pet\），不写进项目源码目录；支持 HERMES_PET_DATA_DIR 环境变量覆盖（供测试与迁移）。

## 1. 目录 / 文件清单

```
hermes-pet/
├── package.json            # 仅 electron 依赖 + 入口 + 脚本（见 1.1）
├── main.js                 # Electron 主进程入口（见 1.2）
├── preload.js              # contextBridge 白名单 API（见 1.3）
├── renderer/               # 渲染进程（GUI，electron-bound）
│   ├── index.html          #   桌宠窗口页面，含 CSP，加载 core 与 pet 脚本
│   ├── pet.css             #   透明窗口 / 精灵播放 / 气泡 / 深夜模式样式
│   ├── pet.js              #   渲染主逻辑：状态机驱动、交互、气泡、打字机
│   ├── sprite.js           #   精灵帧循环器（消费 core/sprite-map 的布局）
│   ├── bubble.js           #   气泡 DOM：出现/消失动画、打字机、按钮
│   ├── settings.html       #   设置窗口页面
│   ├── settings.css
│   └── settings.js         #   设置面板表单 + 读写 IPC
├── core/                   # 纯逻辑，零 electron 依赖，node --test 可跑（UMD-lite）
│   ├── state-machine.js    #   精灵状态机：transition(current, event, ctx) -> next
│   ├── scheduler.js        #   主动行为纯函数：evaluate/applyEvent/rateLimit
│   ├── deep-night.js       #   深夜窗口判断 isDeepNight(date, config)
│   ├── config-schema.js    #   config/state 默认值 + 校验 + clamp
│   ├── mock-replies.js     #   本地关键词回复表 + 匹配（琉斯人格）
│   ├── sprite-map.js       #   状态 -> 行/帧/帧率映射（数据，目检核对项）
│   └── adapter-router.js   #   适配器选择 + 降级决策（纯函数）
├── adapters/               # 回复适配器实现
│   ├── adapter-interface.js#   接口契约（纯文档 + 类型注释，可被单测引用）
│   ├── local-mock.js       #   实现：本地关键词回复（包装 core/mock-replies）
│   └── hermes-gateway.js   #   实现：读 HERMES_GATEWAY_URL 走 OpenAI 兼容接口（主进程）
├── assets/
│   ├── oneko.gif           #   猫精灵图集（从 $env:TEMP 落位，二进制，勿手改）
│   └── pet.svg             #   自绘 SVG 猫（保底素材，规格见 task 6.2）
├── tests/                  # node --test 纯逻辑单测（零依赖）
│   ├── state-machine.test.js
│   ├── scheduler.test.js
│   ├── deep-night.test.js
│   ├── config-schema.test.js
│   ├── mock-replies.test.js
│   ├── sprite-map.test.js
│   └── sprite-dimension.test.js  # GIF 头尺寸 + 图集自洽断言
├── scripts/
│   └── verify-sprite.js    #   可选：解析 GIF 头并打印瓦片图（给目检用，零依赖）
├── .gitignore              #   追加忽略 config.json/state.json/.env/node_modules
├── 启动hermes-pet.cmd      #   双击启动器（全 ASCII、幂等）
├── README.md
└── .hermes-docker.md       #   容器工作流说明（Linux 无显示器，只跑 node --test）
```

> 现有 PySide6 骨架（src/、tests/test_dummy.py、pyproject.toml、.venv、.pytest_cache）本轮整体废弃，不兼容、不迁移、不删除（删除与否由站长定，执行者不碰）。

### 1.1 package.json 要点
- 字段：main 指向 main.js；scripts 提供 start = electron . 与 test = node --test tests/。
- 依赖：dependencies 为空；devDependencies 仅 electron。这是「无外网依赖」验收的判据。
- 不引入 electron-builder / electron-packager（打包不在 M0）。

### 1.2 main.js（主进程）职责
- 创建透明置顶桌宠窗口（BrowserWindow 参数见「已知坑」）。
- 加载 .env（手写 15 行内的 KEY=VALUE 解析，不引入 dotenv）。
- 持有 AppStore：读写 config.json / state.json（基于 core/config-schema 的默认值与校验）。
- 持有主动行为调度器：单个 setInterval 每 30s tick 一次，调用 core/scheduler.evaluate，把返回行为映射成 IPC 推送并 applyEvent 落盘。
- 持有适配器：按 core/adapter-router 选 local-mock 或 hermes-gateway，响应 dialog:ask。
- 托盘：建 Tray + 右键菜单（见 2.4）。
- 设置窗口：单例，双击猫或菜单唤起。
- 窗口管理：位置持久化、首次右下角、move-by、set-size（clamp 60-180）、鼠标靠近检测（screen.getCursorScreenPoint 轮询）。
- 开机自启：写/删 Windows 启动项（仅用户点开开关时执行）。

### 1.3 preload.js 职责
- contextBridge.exposeInMainWorld 暴露 petAPI（白名单，见 2.1），绝不暴露 ipcRenderer 本体。

### 1.4 其余文件
- renderer/pet.js：从 preload 拿到 petAPI 与 config/state，new PetCore.StateMachine 驱动 sprite.js；处理单击/双击/拖拽/Esc/Enter。
- renderer/sprite.js：setInterval 帧循环，按 core/sprite-map 的 {row,frames,fps,loop} 算 background-position；deep-night 时帧率减半由状态机上下文给出。
- renderer/bubble.js：只负责「把一段文本以打字机效果塞进气泡 + 出现/消失动画 + 渲染按钮」，不掺业务。

## 2. Electron 主进程 ↔ 渲染进程 IPC 契约

约定：invoke = 请求/响应（renderer 调 ipcRenderer.invoke，主进程 ipcMain.handle）；send = 单向（主进程 webContents.send 推给 renderer）。所有通道名以字符串常量集中定义在 main.js 与 preload.js 各一份，两侧保持一致。

### 2.1 preload 暴露的 petAPI（白名单，逐方法对应下面 invoke/send）

```
petAPI.getConfig()                 -> Promise<Config>
petAPI.setConfig(partial)          -> Promise<Config>   // 合并 + 校验 + clamp 后落盘
petAPI.getState()                  -> Promise<State>
petAPI.reportActivity(kind)        -> void              // kind: click|drag|type|key
petAPI.ask(message)                -> Promise<{ text, adapter, degraded }>
petAPI.moveBy(dx, dy)              -> Promise<{ x, y }>
petAPI.setSize(size)               -> Promise<{ size }> // 主进程 clamp 到 60..180
petAPI.openSettings()              -> void
petAPI.closeSettings()             -> void
petAPI.setAutoStart(enabled)       -> Promise<{ enabled }> // 返回实际生效值
petAPI.setTrayMode(mode)           -> void              // normal|thinking|paused|notify
petAPI.persistPosition(x, y)       -> void              // 拖拽结束时落盘
petAPI.quit()                      -> void
petAPI.on(event, cb)               -> unsubscribe      // 订阅 2.2 的推送事件
```

### 2.2 主进程 -> 渲染进程（webContents.send，经 petAPI.on 订阅）

| 通道 | payload | 语义 |
|------|---------|------|
| pet:greet | { text, buttons?: string[], timeoutMs } | 主动问候气泡（首启/归来） |
| pet:remind | { type: 'rest'|'sunset'|'drowse', text, buttons: string[], timeoutMs } | 主动提醒（休息/日落/打盹） |
| pet:approach | { near: boolean, distance?: number } | 鼠标是否进入靠近阈值（触发 alert） |
| pet:pause | { paused: boolean } | 托盘暂停/恢复动画 |
| pet:deep-night | { active: boolean } | 深夜模式开关（降饱和 + 帧率减半） |
| pet:size | { size: number } | 设置面板改大小后热更新 |
| pet:sleep | { active: boolean } | 空闲 30 分钟强制进入 sleeping |

### 2.3 渲染进程 -> 主进程（invoke/send）

| 通道 | 方向 | payload | 返回 |
|------|------|---------|------|
| config:get | invoke | — | Config |
| config:set | invoke | Partial<Config> | Config（已合并校验） |
| state:get | invoke | — | State |
| activity:report | send | { kind: string, at: number } | — |
| dialog:ask | invoke | { message: string } | { text, adapter, degraded } |
| window:move-by | invoke | { dx: number, dy: number } | { x, y } |
| window:set-size | invoke | { size: number } | { size } |
| settings:open | invoke | — | — |
| settings:close | invoke | — | — |
| autostart:set | invoke | { enabled: boolean } | { enabled } |
| tray:set-mode | send | { mode: string } | — |
| window:position-persist | send | { x: number, y: number } | — |
| app:quit | invoke | — | — |

### 2.4 托盘右键菜单（F6）
菜单项：对话（唤起输入框）/ 设置 / 固定位置（toggle，固定后禁止拖拽）/ 重置位置（回到右下角默认）/ 暂停（toggle 动画与主动行为）/ 退出。托盘单击 = 显示/隐藏窗口（toggle）。菜单行为全部由主进程实现，通过上面推送通道同步到渲染进程。

## 3. 精灵动画状态机

### 3.1 状态集合（渲染进程驱动，纯逻辑在 core/state-machine.js）
状态：idle / walk / alert / tired / sleeping / scratch / wash。附加两个「交互态」但不占精灵行，仅作为转移源：dragging（拖拽中，视觉复用 alert 或悬空）、listening（倾听，视觉复用 alert，气泡进入输入模式）。

### 3.2 状态转移表（触发条件 -> 目标状态）

| 当前态 | 事件 | 目标态 | 备注 |
|--------|------|--------|------|
| * | PAUSE | (冻结) | 不转移，仅停帧/停转移计时器 |
| (冻结) | RESUME | idle | 恢复 |
| idle | POINTER_NEAR | alert | 鼠标进入靠近阈值（默认 120px） |
| alert | POINTER_FAR | idle | 鼠标离开且无交互，300ms 冷却后 |
| idle | IDLE_T1（无交互 ~3 分钟） | tired | 安静陪伴的小倦意 |
| tired | IDLE_T2（累计 ~5 分钟无交互） | sleeping | 打盹 |
| tired/sleeping | INTERACT | idle | 任意点击/拖拽唤醒 |
| sleeping | SLEEP_CMD（来自主进程 pet:sleep） | sleeping | 保持，空闲 30 分钟由主进程强制 |
| idle | RANDOM_ACTION | scratch 或 wash | 按 actionFrequency 随机，各 ~50%，2-4s 后回 idle |
| idle | RANDOM_WALK（低频） | walk | 短促移动后回 idle |
| 任意 | DRAG_START | dragging | 视觉=alert/惊讶，身体跟手 |
| dragging | DRAG_END | idle | |
| 任意 | DEEP_NIGHT_ON | 不变 | 只改帧率与配色，不改状态 |

转移函数签名：transition(currentState, event, ctx) -> nextState；ctx = { lastActivityAt, now, config }。事件常量集中在 state-machine.js 顶部。所有阈值（3min/5min/120px 等）以常量形式放在 core/state-machine.js，可被单测直接断言。

### 3.3 精灵行/帧映射（oneko.gif，实测 256×128，8×4 瓦片，瓦片 32×32）

图内坐标约定：col 0..7 左到右，row 0..3 上到下；CSS background-position = -(col*32)px -(row*32)px。映射基于经典 oneko.js 图集布局，给出如下（(col,row) 绝对索引）：

| 状态 | 帧序列 (col,row) | 帧数 | 建议帧间隔 | 循环 |
|------|------------------|------|-----------|------|
| idle | (3,3) | 1 | — | 静止，CSS 加轻微呼吸 |
| alert | (7,3) | 1 | — | 静止 |
| tired | (3,2) | 1 | — | 静止 |
| sleeping | (2,2),(2,1) | 2 | 800ms | 循环（呼吸） |
| wash | (5,0),(6,0),(7,0) | 3 | 140ms | 循环 2-3 次回 idle |
| scratch | (0,0),(0,1) | 2 | 160ms | 循环 2-3 次回 idle |
| walk-N | (1,2),(1,3) | 2 | 120ms | 移动时循环 |
| walk-S | (6,3),(7,2) | 2 | 120ms | 移动时循环（默认朝向） |

> 硬要求：此表是「数据」，落在 core/sprite-map.js 一个对象里。codex 在宿主跑起来后必须逐状态目检，若某行实际是别的状态就改这张表（附上核对说明），不要改播放逻辑。SVG 猫是保底可见素材，GIF 映射未核对前不影响「能跑」。

## 4. 持久化 schema（userData 目录下两个 JSON）

### 4.1 config.json（用户偏好，默认值）

| 字段 | 类型 | 默认 | 说明 / 边界 |
|------|------|------|-------------|
| nickname | string | 琉斯 | 宠物名（气泡里的自称） |
| userName | string | （空） | 用户昵称，首次问候后写入并持久化 |
| size | number | 120 | 显示大小，clamp 60..180 |
| proactiveEnabled | boolean | true | 主动提醒总开关 |
| autoStart | boolean | false | 开机自启 |
| deepNightEnabled | boolean | true | 深夜模式开关 |
| actionFrequency | number | 45 | 小动作间隔秒数，clamp 30..90；深夜 ×2 |
| replyAdapter | string | auto | auto ｜ mock ｜ gateway |

### 4.2 state.json（运行时状态，默认值）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| firstRun | boolean | true | 首次启动标志（入场动画 + 问候） |
| greetedToday | string | （空） | 日期串 YYYY-MM-DD，当天已问候则非空 |
| lastActivityAt | number | 0 | 最近用户活动 epoch ms |
| lastSpokenAt | number | 0 | 最近主动说话时间戳（2h 频率上限用） |
| lastRestReminderAt | number | 0 | 最近休息提醒时间戳 |
| lastSunsetDate | string | （空） | 最近日落提醒日期串 |
| lastDrowseAt | number | 0 | 最近打盹时间戳 |
| lastSeenAt | number | 0 | 上次退出时间戳（计算离开时长） |
| windowPosition | object | { x:null, y:null } | null 表示首次启动用右下角 |
| paused | boolean | false | 托盘暂停态 |
| fixedPosition | boolean | false | 固定位置开关 |

> 读写规则：主进程 AppStore 用 config-schema.js 的默认值做深合并；setConfig 只允许白名单字段，未知字段丢弃，size/actionFrequency 做 clamp。JSON 用 UTF-8 无 BOM 写入。两个文件均在 .gitignore 中（密钥/状态不进 git）。

## 5. 主动行为的计时器设计（谁持有、防重、跨天）

### 5.1 谁持有计时器
- 长周期主动行为（问候/打盹/休息/日落）由「主进程」持有：一个 setInterval 每 30s tick，调用 core/scheduler.evaluate(now, state, config) 得到要触发的事件数组，逐条转 IPC 推送，再用 core/scheduler.applyEvent(state, event, now) 得到新 state 并落盘。渲染进程不持有任何业务计时器。
- 短周期视觉小动作（scratch/wash/walk、tired/sleeping 渐进）由「渲染进程」状态机持有（见 3.2），因为这些只需驱动动画、不落盘、不跨进程。

### 5.2 五个主动行为 + 触发与防重守卫

| 行为 | 触发条件（纯函数） | 防重守卫（落盘字段） | 频率上限 |
|------|--------------------|----------------------|----------|
| 首启问候 | firstRun 为真，或 greetedToday 非今天 | 置 greetedToday = 今天 | 每天 1 次 |
| 打盹 | 空闲 ≥ 30 分钟（now - lastActivityAt） | 置 lastDrowseAt；醒来后 INTERACT 才复位 | 一次空闲周期 1 次 |
| 休息提醒 | 连续工作 ≥ 40 分钟（见 5.3） | 置 lastRestReminderAt | 每次工作会话 1 次 |
| 数字日落 | 时间 ≥ 22:30 且 lastSunsetDate 非今天 | 置 lastSunsetDate = 今天 | 每天 1 次 |
| 任意主动说话 | 上述任意一条要说话时 | 检查 now - lastSpokenAt ≥ 2h，否则吞掉不补发 | 每 2h ≤ 1 次 |

### 5.3 连续工作的判定（可测）
- 定义「工作会话」：从一次活动开始，若两次活动间隔 > 5 分钟则视为会话结束。休息提醒在「当前会话持续 ≥ 40 分钟且期间无 > 5 分钟空闲」时触发，触发一次后本会话不再触发。
- scheduler.js 暴露纯函数 isWorkingContinuously(state, now) 与 shouldRestReminder(state, now)，单测覆盖边界（39:59 不触发、40:00 触发、5min 间隔切分会话、重复触发被守卫吞掉）。

### 5.4 跨天 / 重启处理
- 一切「每天一次」用本地日期串 YYYY-MM-DD 比较（core/scheduler.todayKey），不依赖进程存活时间；重启后 state.json 已落盘的守卫字段直接生效，不会重复问候/日落。
- 频率上限 2h 用 epoch ms 差值，跨天自然成立。

### 5.5 不回应则消失且不打扰
- 气泡自动消失由渲染进程按 payload.timeoutMs 执行（问候 10s、提醒 15s、日落 20s）。
- 「不重复打扰」由守卫字段保证：事件已 applyEvent 落盘即视为已消费，绝不因用户没理而再次推送同一条。

## 6. 回复适配器（可插拔）

### 6.1 接口契约（adapters/adapter-interface.js 文档化，两个实现都遵守）

```
adapter = {
  name,                          // 'local-mock' | 'hermes-gateway'
  async isAvailable(),            // -> boolean：是否能服务（gateway 探活 / mock 恒真）
  async reply(userInput, ctx)     // -> Promise<string>：单轮回复文本
  async greeting(ctx),            // -> Promise<string|null>：主动问候语（可为 null）
}
ctx = { userName, nickname, now, state, config }   // 只读，适配器不改 state
```

### 6.2 local-mock 实现
- 核心逻辑在 core/mock-replies.js（纯函数 match(input) -> reply），adapters/local-mock.js 只是薄封装。
- 关键词表（琉斯人格：温柔带毒舌的损友）：问候（早/早上/早啊）、你是谁/名字、累/困/休息、卡住/bug/报错、谢谢、再见/晚安、论文/学习、默认兜底（多条随机）。所有文案用「」内中文，语气克制、不卖萌、不啰嗦，默认 ≤ 2 句。
- 首次问候会走 greeting()：按时间分早/中/晚措辞，且询问用户昵称（对应产品设计场景 1）。

### 6.3 hermes-gateway 实现
- 从主进程读取 HERMES_GATEWAY_URL（.env 或进程环境），走 OpenAI 兼容 POST {url}/v1/chat/completions（model 可选、messages 一条 system + 一条 user，携带 HERMES_API_KEY 为 Bearer）。
- 无 HERMES_GATEWAY_URL 或请求失败：抛错/返回 null，由 adapter-router 优雅降级到 local-mock，并在气泡末尾追加说明（如「（AI 服务未配置，先用本地回复）」）。降级是否发生通过 dialog:ask 返回的 degraded 字段告知渲染进程。

### 6.4 选择与降级（core/adapter-router.js 纯函数）
- replyAdapter = mock -> 恒 local-mock；gateway -> 恒 gateway；auto（默认）-> gateway 可用则 gateway，否则 mock。
- 该纯函数可单测：无 url、url 空、gateway 抛错、显式 mock 四种分支。

## 7. 「视觉上怎么做出陪伴感」硬性约束（给 codex，5 条）

1. 入场不是瞬间出现：首次启动，猫从右下角外「探头再落位」，透明渐显 + 缓动 1.5-2s；日常启动不重复入场动画。
2. 动画克制：安静态每 3-5 分钟才一次小动作，幅度小（打哈欠/看爪子），不做高频弹跳；帧率 ≤ 30fps，只更新精灵背景位置，不整窗重绘。
3. 气泡有重量感：从猫头顶弹性弹出（300ms，spring 感），文字逐字打字机（每字 30-50ms），消失时渐隐上飘 0.3s；圆角 12px、底色 #F7FAFC 半透明、深色文字、箭头指向猫。
4. 配色硬约束：猫本体只用深蓝 #2D3748 身体 + 金色 #ECC94B 眼睛/点缀；透明背景；永不出现第三种主色。SVG 猫必须严格这套色。
5. 表情与状态通过眼睛/嘴巴/尾巴变化传达（眼睛圆形=正常、弯月=开心、一条线=打盹；尾巴竖起=开心、下垂=无聊），不引入复杂面部结构；所有对话文案用「」，不出现半角双引号。

## 8. 深夜模式（F8）
- 判断：core/deep-night.js 的 isDeepNight(date, config)，22:00-07:00 且 config.deepNightEnabled 为真时启用（22:00 含、07:00 不含，即 [22,24) ∪ [0,7)）。
- 生效：主进程每 30s tick 顺带重算，变化时推 pet:deep-night；渲染进程加 .deep-night 类 -> 猫/气泡 CSS filter 降饱和偏暖（saturate 0.6 + brightness 0.85），气泡/面板切换深色板（底色 #2D3748、文字 #E2E8F0、辅色 #D69E2E）。
- 帧率减半：状态机上下文里 deepNight 时把 actionFrequency 与动画 fps 都 ×2（即间隔翻倍、帧率减半）。

## 9. 🛡️ 安全考量

- 渲染进程 contextIsolation:true、nodeIntegration:false、禁用 remote；preload 只暴露白名单 petAPI，绝不透传 ipcRenderer。
- .env 只由主进程解析；HERMES_API_KEY 永不下发渲染进程、不写日志、不进 state/config、不进 git（.gitignore 强制）。
- index.html 加 CSP meta（default-src 'self'；img-src 'self' data:；style-src 'self' 'unsafe-inline'），限制脚本来源。
- 所有外部输入（用户消息、gateway 返回文本）进气泡前按纯文本渲染（textContent，绝不 innerHTML），防注入。
- window:set-size、config.size 一律主进程 clamp 60..180；setConfig 白名单字段 + 类型校验。
- 开机自启仅当用户在设置里显式开启才写注册表；不做任何静默自启。
- 不使用 shell.openExternal 打开不可信 URL（M0 无此需求）。

## 10. 已知坑与风险（给 codex 与站长）

1. 精灵行映射是数据不是逻辑：3.3 表基于经典 oneko.js 布局，但我在无显示器环境无法 100% 目检；codex 必须在宿主目检核对（task 验收项含此项），错就改 sprite-map.js。
2. 透明窗口在 Windows 需严格参数（transparent:true, frame:false, hasShadow:false, skipTaskbar:true, alwaysOnTop:true, resizable:false），且透明区域不响应鼠标——拖拽用 CSS -webkit-app-region:drag，交互元素（气泡/输入框/按钮）标 no-drag。
3. 鼠标「靠近」检测超出窗口边界，渲染进程收不到 mouseenter，必须由主进程 screen.getCursorScreenPoint 轮询（~300ms）算距离推 pet:approach，注意节流避免高频。
4. 设置窗口与桌宠窗口是两个 BrowserWindow：桌宠透明无框，设置窗用普通框（或自定义 frameless），避免把 480×600 面板塞进透明小窗。
5. 风险提示（站长知悉）：连续工作 40 分钟、空闲 30 分钟的判定是「行为近似」而非真实读屏/读情绪，符合产品设计「不读屏幕内容」的红线；M0 不做鼠标速度/退格频率等情绪信号（超出范围）。

（全文完，蓝图）