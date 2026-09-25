# HANDOFF §11-§13 摘要（M1-R1 开工前按节读取，中间产物）

## §11 第三轮修复（FIX-1~4）
- FIX-1 首启落点：根因是 `coerceCoord(null)` 走 `Number(null)===0`；新增 `src/core/position.js`（defaultBounds/restoreBounds/clampToArea/clampFullyInside/fitInside），落盘加 `positionReady` 闸门。
- FIX-1 坐标一律 **DIP**：`1440x852` workArea、窗口 `144x144`、`scaleFactor=2` → `1272/684`。**不要把物理像素与逻辑像素混算**（任务书 §5-2 就是这条）。
- FIX-2 气泡：窗口宽度 = 猫大小 + 24，所以 320px 是上限不是承诺；长文本换行可滚，气泡永不被裁（`pet:window-shift` 的 catX/catY 反向平移）。
- FIX-3 `ensureConfig()` 首启原子写默认 config.json；损坏自愈；不覆盖用户值。
- FIX-4 `docs/M0-sprite-map.md` §6：talk→alert、listen→idle、drag→SE/SW。

## §12 第四轮（FIX-A/FIX-B）
- 两条「环境级静默失效」看门狗：置顶 5000ms `pop-up-menu`、穿透 2000ms + `did-finish-load/did-navigate` 立刻重断言。判定在 `src/core/window-guards.js`，**不是冗余代码，别删**。
- 红线：`watchdogAction({lastInteractive:true})` 必须 `'noop'`，否则点猫失效（8 组合穷举单测钉死）。

## §13 第五轮（FIX-1/FIX-2）
- `mousePassThrough` 断言改成**光标无关**：`ignoreMouseAtStart` 初始态快照 + 双向切换 + 恢复；直接读 `ignoreMouseActive` 会随用户光标位置随机变红（M0 第五轮教训 → 任务书 §5-3「验收门与物理环境解耦」）。
- 「光标压在猫身上时穿透合法关闭」是**设计不是 bug**：猫矩形是可交互区，命中即关穿透。
- 已知取舍：猫矩形内透明边角也会吃点击；M1 的缓解就是本轮的 A5「别烦我 / 透明模式」。