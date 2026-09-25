# M1-R1 复核（杠精🔍）—— P0×5 / P1×7 闭合性

> 复核对象：`docs/M1R1-task.md`（v3）/ `docs/M1R1-spec.md`（v3）/ `docs/M1R1-features.md`（v3）+ `docs/M1R1-decisions.md`（代理裁定）
> 规则：**裁定优先**。代理三处改动（P0-4 A2 节拍、P1-2 Alt+M、P1-3 全屏）按裁定判，不因与原建议不同而判未闭合。
> 范围：只核我上一轮提的 P0×5 + P1×7，不重做全量审查。方式：只读（未改 spec/task/features/decisions）。
> 判定口径：该项的**修法要点是否能在 v3 里被检索到**（引原句/小节号）+ 是否引入新的互斥。二值：闭合 / 未闭合。

---

## 一、P0（5 条）

### P0-1 A5 穿透所有权 —— **闭合**
- 依据（spec §7）：「【P0-1-1】`setDnd(true)` **无条件**执行一次 `reassertPassThrough('dnd-on')`……并把 `lastInteractive = false`；`setDnd(false)` 保留 `reassertPassThrough('dnd-off')`。**写死「开 / 关两个方向都要重断言」**（堵「鼠标正压在猫身上时开 dnd，状态卡在 ignore=false」的洞）。」
- 依据（spec §7）：「【P0-1-2】`watchdogAction()` 加 dnd 维度：`dnd === true` 时无视 `lastInteractive`，一律返回 `'force-ignore'`……dnd 缺省/false 时 `lastInteractive === true` 仍必须 `'noop'`（M0 的 8 组合穷举测试不许改红，只追加 dnd 维度）。」
- 依据（spec §7）：「【P0-1-3】渲染进程在 dnd 短路时也要上报一次 `{ ignore: true }`」；「【P0-1-4】单测『dnd=true + lastInteractive=true → force-ignore』；selfcheck/冒烟加 dnd-locks-passthrough（开 dnd 后 2 秒内 `ignoreMouseActive` 必须 true，照 M0 第五轮 `probeMousePassThrough()` 光标无关模式做）」。
- 落到 task：§2.8（window-guards 加 dnd 维度 + 单测）、§2.9（`setDnd(true)` 无条件 `reassertPassThrough('dnd-on')`+`lastInteractive=false`；smokeOutcome 加 dnd 字段）、§2.11（A5 dnd 短路上报 ignore:true）、§3.2 A5 人工验收已补「（含『鼠标压猫上时开 dnd』场景）」。
- 四要素（双向断言 / 看门狗 dnd 维度 / 渲染短路上报 / 两条断言）**逐条对上，且 M0 红线被显式保住**。

### P0-2 A1 nickname 迁移 —— **闭合**
- 依据（spec §3.1）：「【P0-2-1】迁移不下沉进 `coerceNickname()`（否则 `tests/config.test.js:39` 的「'  琉斯  ' → '琉斯'」当场红）。新增独立纯函数 `migrateConfig(raw)`，只在 `loadConfig/ensureConfig` 层调用」；「【P0-2-2】规则：`schemaVersion < 2` 且 `nickname === '琉斯'` 且 `state.json` 无 `onboarded` 字段 → `nickname = '你'`、`onboarded = false`……`schemaVersion 1 → 2`」；「【P0-2-3】`skipOnboarding`（Esc/跳过）时 `nickname` 落「你」」；「【P0-2-5】验收硬判据：升级后第一条主动话术不得出现「琉斯」称呼；selfcheck 加 config-migrate-nickname」。
- 依据（spec §9 表）：`config.json | schemaVersion | 2 | 1→2，见 migrateConfig` —— 我上一轮判「保持 1 的结论错误」已被改掉。
- 落到 task：§2.7（migrateConfig + 注释改法）、§2.9（`onboard:skip` 落 `nickname='你'`）、§2.13（config-migrate-nickname）、§2.14（config 单测含 migrateConfig）、§3.2 A1 人工验收加了「升级后第一条主动话术不出现「琉斯」」。
- 五要素（不下沉/规则+版本号/skip 分支/注释/可验收）**全中**。（另见 §二 观察 1 的签名细节，不影响本条判定。）

### P0-3 HANDOFF 自相矛盾 —— **闭合**
- 依据（task §4）：「【P0-3】不改 `HANDOFF.md` 第 1-13 节既有内容；只允许在文末追加 §14 M1-R1，追加不得修改任何已有行。」✓
- 依据（task §6）：「完成后写 `HANDOFF.md` 追加 §14 M1-R1（真实输出，≤120 行），git add -A && git commit」✓
- 两条现在互为补充而非互斥（§4 管「不许动 1-13 节」，§6 管「文末追加」）；spec §1 改动面总表也同步成「不改：……HANDOFF.md 第 1-13 节」。**无残留冲突。**

### P0-4 A2 节拍（代理改口径，按裁定判） —— **闭合**
- 依据（spec §4.1 常数块）：`WALK_COOLDOWN_MS = 180000`（上次散步结束起 3 分钟硬冷却，冷却期内不抽签）/ `WALK_CHANCE = 1/300`（冷却过后每个 200ms tick 抽签 0.33%，期望再等约 60s）→「平均 180s + 60s = 240s ≈ 4 分钟一次（约 15 次/小时）」。
- 算术自洽性（我复核了一遍）：200ms × 300 = 60s；180 + 60 = 240s → **15 次/小时**；features 验收「10 分钟内 2-3 次」= 12-18 次/小时，**均值 15 落在区间正中** ✓；1 小时虚拟时间断言 `[10,20]` 也含 15 ✓。三个数字（常数 / 人工验收 / 脚本断言）互不打架——这正是我上一轮点的问题，已解。
- 「删表述」已落实：「【P0-4】删掉『期望约 50 秒想走一次』表述」（spec §4.1）；features §2 明写「（删『5 分钟内 2-3 次』与『期望约 50 秒想走一次』）」。全文检索「50 秒」只剩在**删改说明**里出现，无残留活口径 ✓。
- 红线保留：「【P0-4 红线】『光标近 5s 累计位移 >120px 就不走』……不许碰；120px 停距、40px/s（深夜 20）、单次 ≤100px/≤3s、四类禁止态全部保留不动」（spec §4.1 / features §2 / task §2.3）✓。
- 落到 task：§2.3 写全 8 个常数 + 「加 1 小时虚拟时间断言散步次数∈[10,20]」+ 纯函数注入 now/random ✓。

### P0-5 A6 吸附 vs clampToArea —— **闭合**
- 依据（spec §8.1）：「【P0-5-1】drag-end 顺序写死：`clampFullyInside(窗口矩形, workAreaFor(矩形))` → 然后 `snapToEdge(bounds, workArea, 20, 4)` → 再 `clampFullyInside` 一次兜底。即吸附只在「完整在屏内」的窗口上判距离（堵 M0 `clampToArea(MIN_VISIBLE=48)` 允许窗口出屏 96px 导致永不吸附的洞）」；「【P0-5-2】……四边距离取最小；命中即贴该边并留 `breathe = 4px`」；「【P0-5-3】多边同时命中优先级写死：距离最小者优先；并列时 左 > 右 > 上 > 下」；「【P0-5-4】坐标一律 DIP……自证里禁止出现物理像素算式」；「【P0-5-5】单测：四边内侧 10px / 边界 20px、21px / 已在屏外 96px / 窗口大于 workArea / 多屏偏移 workArea」。
- 五条**逐条对上**，含我点名的两处缺失（顺序 + 并列优先级取值）。task §2.5（snapToEdge 签名 + 六场景）、§2.9（drag-end 顺序）同步 ✓。

---

## 二、P1（7 条）

### P1-1 walk/look 补用户交互出口 —— **闭合**
- 依据（spec §2.2）：「【P1-1】`ALLOWED.walk = ['idle','talk','listen','drag','walk','look']`；`ALLOWED.look = ['idle','talk','listen','drag','walk','look']`。`EVENT_TARGETS` 明确：收到 talk/listen/drag 类事件时先隐式 `walk:end`（走动中点猫→talk、走动中 drag:start→drag，用户主动永远优先，对齐 A13 反向边界）。单测：walk 中 click 到 talk、walk 中 drag:start 到 drag。M0 既有 8 态条目一条不改」。
- task §2.2 同样逐字落到位 ✓。我要求的两条单测与「只增不减」红线都在。

### P1-2 Alt+M = proactiveEnabled（代理改口径，按裁定判） —— **闭合**
- 依据（spec §11）：「【P1-2】Alt+M = 切换 `config.proactiveEnabled`（静音=不主动说话），**不复用 paused**、不新增 muted 字段。理由：paused 会连带动 `shouldReassertTopmost` 与托盘「暂停动画」勾选态串味；`proactiveEnabled` 是 M0 已有的主动提醒总开关，最诚实对应「静音」。设置面板文案改「静音（不主动说话）」，托盘同步；幂等（再按恢复）。」
- 落到 task：§2.9「Alt+M=切换 config.proactiveEnabled（非 paused）」、§2.12「『静音』项文案『静音（不主动说话）』绑 proactiveEnabled」、§3.2 A7「Alt+M 静音（不主动说话）」✓；features §6 A7 同文 ✓。
- 与我原建议（映射 paused）不同，但**语义唯一、验收判据唯一、不新增字段**，三点都满足 → 按裁定判闭合。

### P1-3 A13 全屏真探测（代理改口径，按裁定判） —— **闭合**
- 依据（task §5.6）：「A13 全屏探测**本轮必做**：PowerShell 探测节流~2s、失败降级 false、做成可注入/mock；**不许「拿不准就跳过」**。」（我点名的「降级许可」原句已消失）
- 依据（spec §12.6）：「【P1-3】`quiet.js` signals 必须含 `foregroundFullscreen`（可注入 + true/false 单测）。探测实现本轮做……**删掉「拿不准可先只落打字/dnd/深夜、全屏留待拍板」的降级许可**（不许「可跳过」与「必须过」并存）。」
- 验收侧：task §3.2 A13 保留「全屏前台不主动说话/走动、退出恢复、全屏中点击仍能唤对话」✓；task §2.13 有 quiet-blocks-proactive（六信号各一次）✓。「可跳过 × 必验收」的互斥已消除（现在两边都是「必做」）。

### P1-4 回来招呼判据 —— **闭合**
- 依据（spec §8.2）：「【P1-4-1】判据文案：距上一次「猫窗口内活动」≥30 分钟（删「期间无鼠标/键盘」——M0 无全局键鼠钩子，HANDOFF §5）」；「【P1-4-2】`markActivity` 里 `returnPending` 置位必须在 `guardTick` 之后：时间回拨 → 不置位；`drift`（合盖唤醒 `now-lastTickAt>2min`）→ 允许置位一次，写明「唤醒后允许一次『回来了』」是预期行为」；「【P1-4-3】单测：跨天重置 / 时间回拨不置位 / 2 分钟内不置位 / 31 分钟置位」。
- 落到 task：§2.6 同文 + §2.14（scheduler 单测含「跨天回拨」）✓；features §1 A6 与 §5 也同步成「猫窗口内活动」✓。我点名的「与 M0 只有窗口内信号」的矛盾已按事实改写。

### P1-5 安全（textContent / 净化 / copyText） —— **闭合**
- 依据（task §4 新增条）：「【P1-5】所有含用户输入或 AI 回复的 DOM 写入必须走 textContent/setText；onboarding 气泡、「已复制」标记、固定图钉标记一律不得用 innerHTML/insertAdjacentHTML。」
- 净化顺序（spec §3.2 / task §2.7）：「先去 `\u0000-\u001F` 与 `\r\n` → trim → 截断 24 字，顺序写死」✓
- copyText 约束（spec §12.1 / task §2.10 / features §6 A8）：「preload 侧校验 `typeof==='string'`、长度上限 4096（超出截断并在气泡说明）、只允许写当前气泡可见文本（不接受任意来源）」✓；task §2.13 补「【P1-5】copy 超长文本被截断/拒绝断言」✓
- 出口面（spec §12.6 / decisions）：「nickname 流向托盘 tooltip/state.json/设置面板同样净化」✓

### P1-6 补 4 条自证门 —— **闭合**
- 依据（task §2.13）：「【P1-6】quiet-blocks-proactive（六信号各一次→plan 不开口且 walk 不发）/ walk-guards（dnd/paused/对话中/拖后2s 四种 shouldWalk 假）/ config-migrate-nickname（喂 schemaVersion:1+nickname:'琉斯'→非「琉斯」）/ return-clock-guard（回拨不置位/跨天重置/合盖唤醒只判一次）」——四条**点名落到位**，且前置条件「全确定性，不读真实光标」保留 ✓。

### P1-7 A12 失败路径可注入 —— **未闭合（缺最后一步：自证门条目）**
- 已闭合的一半：
  - 接线（task §2.9）：「A12【P1-7】：`applyAutoLaunch(options.injectSetLoginItem)`；catch 里给用户可见提示（托盘 tooltip/气泡）」✓
  - 规则（spec §12.5）：「【P1-7】失败路径做成可注入……人工验收改『打开开关 → 系统登录项出现 hermes-pet（可脚本查 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`）』」✓；task §3.2 A12 已改成查注册表 ✓
  - 甚至断言内容在 spec §12.5 也写了：「selfcheck 注入抛错替身，断言『调用一次 + 产生一条用户可见提示（托盘 tooltip 或气泡）』」✓
- **缺口**：`tools/selfcheck.js` 的**权威清单**（task §2.13，这是「本文件为本轮唯一权威」里逐文件交付清单）从 §2.13 主线 13 条 → 【P1-6】4 条 → 【P1-5】1 条，**没有一条对应 A12 的注入式断言**；清单里检索不到 `autolaunch` / `injectSetLoginItem` / `自启失败` 任何关键词。执行者若照 task §2.13 建门，这条断言会漏掉——而它正是我上一轮判定 P1-7 为「该验却验不了」的唯一可脚本化出口。
- 附带一处算术不自洽（同一处）：§2.13 清单实为 13+4+1 = **18 条新增 → 18+18 = 36**，但 §2.13 开头写「目标 18 → 约 38 项」、§3.1 第 5 条写「SELFCHECK_OK n/n（**n≥38**）」。清单条数与验收阈值差 2。
- **具体修法（一行）**：在 task §2.13 清单里补 `autolaunch-failure-prompt`（注入抛错替身 → 断言调用一次 + 有用户可见提示），并把阈值口径对齐（补完后为 37，建议写成「n≥36」或以实际清单条数为准；若坚持 38，请再点名第 2 条缺失项）。spec §12.5 无需改（表述已对）。

---

## 三、以下不影响上述判定，仅供包工头顺手处理（P2 级，非复核项）

1. P0-2 的签名细节：`migrateConfig(raw)` 只吃 config，但规则第三个条件要用 `state.json` 是否含 `onboarded`——签名需带 state（或由调用方注入一个布尔），否则第三个条件判不了。规则本身已写死，只是传参口径没写。
2. P0-4 的脚本断言 `[10,20]`：均值 15、单小时计数标准差约 √15≈3.9，若用真随机单次抽样约有 ±1.3σ 之外的概率落空 → 建议写「固定种子 / 注入确定随机序列」再断言区间（task §2.3 已写「纯函数注入 now/random」，只差「固定序列」四字）。
3. P1-3 的「真探测」只能靠人工验收：§3.1 五条命令里没有一条能证明 PowerShell 探测真出结果（quiet 单测是注入式）。可选补一条可复制的探测自测命令。
4. features §1 A5 表现行仍写「猫仍呼吸/看鼠标/偶尔动」，「偶尔动」与 §2/§4 的「dnd 禁走动」措辞有歧义（§2/§4/spec §10 三处已对齐，这处措辞没同步）。

---

## 四、复核结论

P0 五条 **5/5 闭合**（含代理改口径的 P0-4，按裁定判闭合）；
P1 七条 **6/7 闭合**，未闭合 1 条：**P1-7**（task §2.13 缺 A12 注入式自证门条目，且 §3.1 的 n≥38 与清单 36 条不自洽）——**补一行即可转 PASS，不需要动 spec/features**。

**总判：STILL-BLOCKED**