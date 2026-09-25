# M1-R1 代理裁定纪要（琉斯代站长裁）

> 站长 2026-09-23 授权：「好，你自行迭代。总之在操作上要不断优化、人性化。」
> 故本轮 P0/P1/P2 由琉斯以代理身份逐条裁定。**裁定依据**：① 站长指示（操作优化 + 人性化）；② 产品设计文档 v0.1；③ 杠精 `docs/M1R1-review.md` 的修法建议；④ M0 五轮踩过的坑。
> **本纪要优先于** `M1R1-spec.md` / `M1R1-task.md` / `M1R1-features.md` 的现存内容；包工头据此产出 v3。

---

## 一、P0 裁定（5 条，全部采纳杠精修法）

### P0-1 A5 穿透所有权（采纳杠精 4 条修法，一条不改）
1. `setDnd(true)` **无条件**执行一次 `reassertPassThrough('dnd-on')`（直接复用 `src/main.js:746` 那个函数，别另写），并把 `lastInteractive = false`；`setDnd(false)` 保留 `reassertPassThrough('dnd-off')`。**写死「开/关两个方向都要重断言」。**
2. `watchdogAction()` **加 dnd 维度**：`dnd === true` 时无视 `lastInteractive`，一律返回 `'force-ignore'`。**同时保留原红线**：`dnd` 缺省或 false 时，`lastInteractive === true` 仍必须 `'noop'`（M0 的 8 组合穷举测试不许改红，只追加 dnd 维度）。
3. 渲染进程在 dnd 短路时**也要上报一次** `{ ignore: true }`，保证 `lastInteractive` 缓存不在 dnd 下腐烂。
4. 加两条断言：单测「`dnd=true` + `lastInteractive=true` → `force-ignore`」；selfcheck/冒烟加 `dnd-locks-passthrough`（开 dnd 后 2 秒内 `ignoreMouseActive` 必须为 true，**照 M0 第五轮 `probeMousePassThrough()` 的光标无关模式做**）。

### P0-2 A1 nickname 迁移
1. **迁移不下沉进 `coerceNickname()`**（否则 `tests/config.test.js:39` 的 `'  琉斯  ' → '琉斯'` 当场红）。新增独立纯函数 `migrateConfig(raw)`，在 `loadConfig/ensureConfig` 这一层调用；单测单独写。
2. 规则写死：`schemaVersion < 2` **且** `nickname === '琉斯'` **且** `state.json` 无 `onboarded` 字段 → 判为旧语义残留：`nickname = '你'`、`onboarded = false`（走初见流程）。**`schemaVersion: 1 → 2`**。
3. **补上被漏掉的分支**：`skipOnboarding`（Esc / 跳过）时 `nickname` 落 `'你'`（别留 `'琉斯'`）。
4. `NICKNAME_DEFAULT` 那行注释改成「猫对用户的称呼（猫名『琉斯』写死在自我介绍里，不进此字段）」。
5. 验收写死一条硬判据：**升级后第一条主动话术不得出现「琉斯」称呼**；selfcheck 加 `config-migrate-nickname`（喂 `schemaVersion:1 + nickname:'琉斯'`，断言结果不为 `'琉斯'`）。

### P0-3 HANDOFF 自相矛盾
task §4「不要做什么」那条改成边界显式句：**不改 `HANDOFF.md` 第 1-13 节既有内容；只允许在文末追加 `§14 M1-R1`，追加不得修改任何已有行**。§6 的交接诉求保留。

### P0-4 ★ A2 节拍（**代理选择的方案，与杠精两个选项都不同，理由见下**）
杠精给的 (a)(b) 都没真正对齐；我按「文档 + 人性化」重新定：
- **目标节拍 = 每 3-5 分钟一次**（依据：产品设计文档「每 3-5 分钟一个小动作」「频率极低」；脑洞自己的 M0 F3 也写 3-5 分钟）。杠精算的 55 次/小时（≈每 65 秒）**偏快 4-6 倍**，与「安静陪伴」定位不符。
- **实现参数**：`WALK_COOLDOWN_MS = 180_000`（上次散步结束起算 3 分钟硬冷却）+ 抽签概率 **0.33%（1/300）** → 冷却后期望再等 60 秒 → **平均约 4 分钟一次（≈15 次/小时）**，落进 3-5 分钟区间。
- **删掉**「期望约 50 秒想走一次」这句表述（杠精点名：它会被 codex 当「已经调好了」的证据照抄）。
- **验收改写**：把「5 分钟内 2-3 次」改成「**10 分钟内能看到 2-3 次**」（与 3-5 分钟节拍自洽）。
- **必须加可脚本化判据**：注入 `random/now` 跑 **1 小时虚拟时间**，断言散步次数落在 `[10, 20]`。
- ⚠️ **杠精点名的红线：A2 的「光标近 5 秒累计位移 >120px 就不走」这条规则全篇最漂亮，调频率时不许碰它。** 120px 停距、40px/s（深夜 20）、单次 ≤100px/≤3s、四类禁止态，全部保留不动。

### P0-5 A6 吸附 vs `clampToArea(MIN_VISIBLE=48)`
1. drag-end 顺序**写死**：`clampFullyInside(窗口矩形, workAreaFor(矩形))` → `snapToEdge(bounds, workArea, 20, 4)` → 再 `clampFullyInside` 兜底。即**吸附只在「完整在屏内」的窗口上判距离**。
2. `snapToEdge` 判据写死：窗口四边到 workArea 四边的距离**取最小**；命中即贴该边并留 `breathe = 4px`。
3. **多边同时命中的优先级写死：距离最小者优先；并列时 左 > 右 > 上 > 下。**（杠精指出 spec 只说「要写死」却没给值，codex 会自己编）
4. 坐标一律 DIP；多屏取窗口所在显示器的 workArea；**自证里禁止出现物理像素算式**（M0 第三轮已错一次）。
5. 单测：四边内侧 10px / 边界 20px / 21px / 已在屏外 96px / 窗口大于 workArea / 多屏偏移 workArea。

---

## 二、P1 裁定（7 条）

### P1-1 walk / look 补用户交互出口（**只增不减**）
`walk: ['idle','talk','listen','drag','walk','look']`、`look: ['idle','talk','listen','drag','walk','look']`；`EVENT_TARGETS` 明确「收到 talk/listen/drag 类事件时先隐式 `walk:end`」。单测：「walk 中 click 必须到 talk」「walk 中 drag:start 必须到 drag」。
> 理由：这直接关系到 A13 自己写的反向边界——「用户主动点击永远优先」。走动中拖不动猫 = 违背人性化。

### P1-2 ★ Alt+M 语义（**代理裁定：不复用 paused，改绑已有的 `proactiveEnabled`**）
- **Alt+M = 切换 `config.proactiveEnabled`**，不新增 `muted` 字段、**不复用 `paused`**。
- 理由：① `paused` 会连带动 `shouldReassertTopmost`（暂停不抢置顶）与托盘「暂停动画」勾选态，语义串味；② M0 已有 `proactiveEnabled`（主动提醒总开关），「静音」在无音频的猫里**最诚实的意思就是「不主动说话」**，正好是这个字段；③ 不新增字段 = 不动 schema。
- 设置面板该项文案改为「**静音（不主动说话）**」；托盘菜单同步。幂等语义写清（再按一次恢复）。

### P1-3 A13 全屏（**代理裁定：本轮做真探测**）
- `quiet.js` 的 signals **必须**含 `foregroundFullscreen`（可注入 + true/false 单测）。
- **探测实现本轮做**：主进程 PowerShell 探测，节流 ~2s、失败降级 `false`、可注入/mock（task §5.6 已有三条要求）。
- **从 task 里删掉「拿不准可先只落打字/dnd/深夜、全屏留待拍板」这句降级许可**（不许「可跳过」与「必须过」并存）。
- 人工验收保留「全屏前台时猫不主动说话/走动，退出恢复，全屏中点击仍能唤对话」。

### P1-4 A6「回来招呼」判据
1. 判据文案改为「距上一次**猫窗口内活动** ≥30 分钟」（删掉「期间无鼠标/键盘」——M0 明确没有全局键鼠钩子，HANDOFF §5）。
2. `markActivity` 里 `returnPending` 的置位**必须在 `guardTick` 之后**：时间回拨 → 不置位；`drift`（合盖唤醒，`now - lastTickAt > 2min`）→ **允许置位一次**，并写明「唤醒后允许一次『回来了』」是**预期行为**。
3. 单测：跨天重置 / 时间回拨不置位 / 2 分钟内不置位 / 31 分钟置位。

### P1-5 安全（一票否决级）
1. task §4 增加一条：**所有含用户输入或 AI 回复的 DOM 写入必须走 `textContent`/`setText`；本轮新增的 onboarding 气泡、「已复制」标记、固定图钉标记一律不得用 `innerHTML` / `insertAdjacentHTML`。**
2. `normaliseUserName` 增加：**先去 `\u0000-\u001F` 控制字符与 `\r\n` → 再 trim → 再截断 24 字**（顺序写死）。
3. `copyText(text)`：preload 侧校验 `typeof === 'string'`、**长度上限 4096（超出截断并在气泡说明）**、**只允许写当前气泡可见文本**（不接受任意来源）。selfcheck 加「超长文本被截断/拒绝」断言。
4. nickname 流向托盘 tooltip / state.json / 设置面板时同样走上述净化。

### P1-6 补 4 条自证门（全部确定性、不读真实光标/活状态）
`quiet-blocks-proactive`（注入六种信号各一次，断言 `plan()` 不开口且 `walk` 不发散步）/ `walk-guards`（dnd / paused / 对话中 / 拖拽结束后 2s 内 四种情况 `shouldWalk` 为假）/ `config-migrate-nickname` / `return-clock-guard`（回拨不置位、跨天重置、合盖唤醒只判一次）。

### P1-7 A12 失败路径做成可注入
`applyAutoLaunch(options.injectSetLoginItem)`；selfcheck 注入一个**抛错的替身**，断言「调用了一次 + 产生了一条用户可见提示」。人工验收改成「打开开关 → 系统登录项出现 hermes-pet（可脚本查 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`）」。

---

## 三、P2 裁定（9 条，全部采纳，给死口径）

| # | 裁定 |
|---|---|
| P2-1 | **保持 `DOUBLE_CLICK_MS = 320`**，只把**单击动作延迟到该窗口之后**（不改常数，避免无谓行为变更） |
| P2-2 | A3 方向用**主进程下发的窗口矩形**（复用 `pet:window-shift` 的 `catX/catY`）修正后再量化；**不得用渲染进程 `window.screenX`**（HANDOFF §13 记过它滞后） |
| P2-3 | 三处对齐成一句：**「dnd 下：不听主动话术、不走动；仍可看光标（look）」**。「看光标」属被动反应，**保留** |
| P2-4 | `walkTick` 每步**同步 `baseBounds`**；`bubbleContent` 非空或 `dialogueOpen` 时停走；走动期间若发生 `pet:bubble-resize`，**先 `walk:end` 再 `syncWindowBounds`** |
| P2-5 | 缩放落盘（debounce 那次）**顺带走一遍 `snapToEdge`**：贴着哪条边就还贴哪条边 |
| P2-6 | ① Alt+T 的抢焦点取舍**写进文档承认**（触发后前台化窗口）；② 「被占用列表」放**主进程运行时内存 + 通道广播**，**不写进 config.json**（运行时态别污染偏好文件） |
| P2-7 | task §0 **不给**「整读 HANDOFF.md」；改成「按小节标题定位后只读该节」（给可复制命令），并要求先把 §11-§13 摘成 `docs/_m1r1/handoff-digest.md`。features/spec/supplement/sprite-map 同理给「最小必要片段」清单 |
| P2-8 | 证据贴法：**只贴每轮 `SMOKE_OK {...}` 行 + 汇总行**；完整日志落 `docs/_m1r1/`，正文只给路径 |
| P2-9 | `src/preload.js` 的 `bubbleClosed → 'bubble:closed'` 死通道：**补 handler**（顺手对齐），并在 HANDOFF 记一笔 |

另：杠精发现 **13 条冲突点里第 11 条已核实「不是冲突」**（`user-select:none` 保留），无需处理；第 12 条要求 task §0 补一句权威链，**采纳**：「**数字类冲突以 `features` 为准，架构类冲突以 `task` 为准**」。

---

## 四、给包工头的执行要求
1. 产出 **v3**：`docs/M1R1-spec.md` / `docs/M1R1-task.md` / `docs/M1R1-features.md` 三份都要改（features 的数字要按 P0-4/P2-3 改），各在开头注明「v3：依 `docs/M1R1-review.md` 与 `docs/M1R1-decisions.md` 修订」。
2. **每条 P0/P1 的修法要能在 v3 文档里被逐条检索到**（用与杠精相同的编号或关键词），否则杠精复核会打回。
3. 不许改动已被杠精确认「不是冲突」的结论（`user-select:none` 保留、A11 砍长按门槛、A2 的光标安静规则）。
4. 写完只回 **≤12 行摘要**：P0 五条各一句「怎么改的」+ v3 版本号 + 你认为还有哪条有风险。
