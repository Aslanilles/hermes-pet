# hermes-pet（M0）

一只住在 Windows 桌面上的深蓝色猫。它叫**琉斯**：温柔但有点毒舌的损友，口头禅是「拆解它」。

M0 的目标不是功能列表，是「桌面有人在」——它常驻置顶、会呼吸、会打盹、偶尔认真地说一句话，然后闭嘴。

---

## 这是什么

- **技术栈**：Electron + 原生 HTML/CSS/JS（CommonJS），**无构建步骤、无打包器、无 UI 框架、除 `electron` 外零 npm 依赖**。
- **本体**：`data/sprites/oneko.gif`（256x128 网格贴图，8 列 x 4 行，每格 32x32），用 `background-position` 取帧，`image-rendering: pixelated` 保持像素感。
- **状态**：`idle / alert / tired / sleeping / scratchSelf / talk / listen / drag`，节拍照抄 oneko 原版（安静但有活气）。
- **对话**：本地关键词 mock 是默认后端；配了 `HERMES_GATEWAY_URL` 就优先走网关，失败自动降级回本地，并在气泡里用一句人话说明。
- **主动行为**：每日问候 / 空闲 30 分钟打盹 / 连续活跃 40 分钟提醒休息 / 每天 22:30 数字日落；**全局护栏：主动说话每 2 小时最多 1 次**，说了没人理当天就不再提。

## 怎么跑

### 双击（推荐）

双击仓库里的 `启动hermes-pet.cmd`（全 ASCII 内容、幂等）。它会：

1. 检查 Node 是否在 PATH；
2. 若 `node_modules\electron\dist\electron.exe` 不存在，先用 npmmirror 镜像装依赖；
3. 然后启动桌宠（不会留一个黑乎乎的控制台窗口）。

### 命令行

```powershell
cd D:\Jiayi\Projects\hermes-pet
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # npm install 需要
npm install --registry=https://npmmirror.com
npx electron .
```

首次安装若只拿到 JS 包、没有二进制（`node_modules\electron\dist\` 不存在），按 `.hermes-docker.md` 末尾的兜底配方补一下。

### 交互速查

| 操作 | 结果 |
|---|---|
| 单击猫 | 升起气泡 + 输入框（Enter 发送 / Shift+Enter 换行 / Esc 关闭） |
| 双击猫 | 打开设置面板（改昵称、大小、主动提醒、开机自启、深夜模式） |
| 按住拖拽（位移 > 5px） | 移动位置，松手后持久化；拖完还能正常点开对话 |
| 右键猫 | Electron 原生菜单：对话 / 设置 / 固定位置 / 重置位置 / 暂停 / 退出 |
| 托盘图标 | 单击显示/隐藏；右键菜单：显示/隐藏、暂停动画、重置位置、设置、退出 |
| 猫附近动鼠标 | 切 `alert`（警觉），走开回 `idle` |
| 透明区域 | **鼠标会穿透**：窗口默认 `setIgnoreMouseEvents(true, {forward:true})`，只有猫/气泡/按钮上才接管点击，不会在桌面上留一块看不见的挡板 |

## 怎么验收

### 1) 容器里跑零依赖纯逻辑（不需要显示器、不需要 npm install）

```powershell
docker exec -w /workspace hermes-pet-dev node --check src/main.js
docker exec -w /workspace hermes-pet-dev sh -c "for f in src/main.js src/preload.js src/core/*.js src/adapters/*.js src/renderer/*.js; do node --check \"$f\" || exit 1; done"
docker exec -w /workspace hermes-pet-dev node --test tests/
```

`tests/` 覆盖：取帧计算（含负索引）、状态转移（打盹→被点击唤醒、说话→被打断）、调度器（2 小时护栏被多触发源绕过仍只放行一次、跨天重置、22:30 当天只触发一次、拖拽/对话中不插话）、配置（默认值合并、损坏文件回落、原子写）、mock 回复命中、adapter 降级与密钥不外泄。

### 2) Windows 宿主上做 GUI 自证

```powershell
cd D:\Jiayi\Projects\hermes-pet
npx electron . --smoke-test     # 起窗口 + 托盘 + 猫，6 秒后打印 SMOKE_OK {...} 并退出码 0
npx electron . --self-check     # 再凿一层：点击→气泡→窗口变高→发消息拿回复→Esc 收回→设置面板
```

- `--smoke-test`：任何异常打印 `SMOKE_FAIL <原因>` 退出码 1。成功形如 `SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true}`。
- `--self-check`：逐项打印 `[selfcheck] OK/FAIL <name>`（16 项，含「穿透不误伤点击」「真实 submit 路径的『在想…』反馈」「设置面板回填」），全绿打印 `SELFCHECK_OK n/n` 退出码 0。

### 2.5) 连真实网关做一次真联调（可选）

tools/gateway_stub.js 是零依赖的**本地网关测试替身**（dev tool，不属于产品运行时），用来验证冻结协议真的通、而不是「每次都降级还全绿」：

```powershell
node tools/gateway_stub.js 8742 3000
$env:HERMES_GATEWAY_URL="http://127.0.0.1:8742"
npx electron . --self-check
```

### 3) 人工一眼核对精灵映射

用浏览器直接打开 `tools/sprite_preview.html`（file:// 即可，无依赖）。它复用 `src/core/sprite-frames.js` 里的同一张表，把每个状态的每一帧并排渲染出来，并标注帧序号与 `background-position`。

## 目录结构

```
src/main.js                Electron 主进程：窗口 / 托盘 / 菜单 / 单实例 / 调度器接线 / 持久化 / 冒烟自检
src/preload.js             contextIsolation 白名单桥（不含 ipcRenderer 本体）
src/core/sprite-frames.js  索引表 + 取帧（纯函数）
src/core/state-machine.js  状态机（纯逻辑）
src/core/scheduler.js      主动行为与频率护栏（纯逻辑，唯一决策入口）
src/core/config.js         配置/状态读写（默认值合并、原子写、损坏回落）
src/core/replies.js        本地语料（琉斯语气）
src/adapters/              local-mock（默认）/ hermes-gateway / 选择与降级
src/renderer/              index.html + pet.css + pet.js（本体）/ settings.*（设置面板）
tools/                     sprite_preview.html（映射核对）、selfcheck.js（GUI 自检）、gateway_stub.js（本地网关替身）、*.py（素材脚本，未改动）
tests/                     node:test，零依赖
data/sprites/              素材（oneko.gif 与图标，未改动）
```

配置与状态写在 `%APPDATA%\hermes-pet\`（`config.json` / `state.json`），**不落在项目目录**。写入是原子的（先写 `.tmp` 再 rename），文件损坏或缺字段会自动回落默认值，不会崩。

## 已知限制

- **只认自己窗口内的交互**：没有全局键鼠钩子，「连续活跃 / 空闲」用的是「猫附近的鼠标移动 + 与猫的点击/拖拽/打字」信号，不是全系统输入。想更准需要额外权限，M0 故意不做。
- **拖拽时窗口会随光标瞬移**：位移判定阈值 5px，超过才算拖拽，因此极短的抖动不会误触移动。
- **气泡与猫共用一个窗口**：气泡展开时窗口会临时变高（底部锚定，猫看起来不动），关闭后再收回去。
- **`hermes-gateway` 走的是 OpenAI 兼容的 `POST {URL}/v1/chat/completions`**（M0 冻结协议）：`Authorization: Bearer ${HERMES_API_KEY}`（配了才带）、body `{model:"default", messages:[{role:"user",content}], stream:false}`、取 `choices[0].message.content`、超时 10 秒；**除成功取值外的任何情况都降级**到本地 mock，并在气泡里用一句人话说明（不出现状态码）。密钥只从 `.env` 读、只在主进程用、绝不进渲染进程与日志。
- **深夜模式只做三件事**：猫降饱和、气泡/面板切深色、动画频率减半（22:00-07:00 自动）。
- **M0 明确不做**：多角色切换、语音、Live2D/VRM、真 LLM 联调、向量记忆、行为感知。

## 历史说明

`src/hermes_pet/`（旧的 PySide6 骨架）与 `pyproject.toml` 是历史记录，本轮只新增 Electron 版，未清理也未改动。
