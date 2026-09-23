# M0 精灵表映射（oneko 32x32 网格）— 权威参考

> 由调度者（琉斯）实测产出，供 codex 直接使用，**不要凭猜测重排索引**。

## 1. 素材事实（实测）

| 项 | 值 |
|---|---|
| 文件 | `data/sprites/oneko.gif`（3316 字节，源自 oneko.js 项目，已落地） |
| 整表尺寸 | **256 x 128 px** |
| 单格尺寸 | **32 x 32 px** |
| 网格 | **8 列 x 4 行 = 32 格**（不是多帧 GIF，是网格贴图；Pillow 读出的 frame_count=1） |
| 权威参考实现 | `docs/_recon/oneko-ref.js`（oneko.js 原版，MIT/公共领域猫图，已随仓库保存） |

对表全貌的可视化对照图（放大 4 倍 + 行列标注）：`docs/_sprite-sheet-check.png`
逐格 ASCII 预览 + 不透明像素占比矩阵：`docs/_sprite-tiles.txt`

## 2. 索引公式（**照抄 oneko.js，不要自创**）

oneko.js 用一个 32x32 的 `div` 做背景贴图，索引 = 格子的**像素偏移 / 32**：

```js
// 索引表（直接复制自 docs/_recon/oneko-ref.js，无需改动）
const spriteSets = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  scratchSelf: [[-5, 0], [-6, 0], [-7, 0]],
  scratchWallN: [[0, 0], [0, -1]],
  scratchWallS: [[-7, -1], [-6, -2]],
  scratchWallE: [[-2, -2], [-2, -3]],
  scratchWallW: [[-4, 0], [-4, -1]],
  tired: [[-3, -2]],
  sleeping: [[-2, 0], [-2, -1]],
  N:  [[-1, -2], [-1, -3]],
  NE: [[0, -2], [0, -3]],
  E:  [[-3, 0], [-3, -1]],
  SE: [[-5, -1], [-5, -2]],
  S:  [[-6, -3], [-7, -2]],
  SW: [[-5, -3], [-6, -1]],
  W:  [[-4, -2], [-4, -3]],
  NW: [[-1, 0], [-1, -1]],
};

// 取帧公式（照抄）
function setSprite(name, frame) {
  const sprite = spriteSets[name][frame % spriteSets[name].length];
  el.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
}
```

注意：`background-position` 用**负数偏移**取靠右/靠下的格子——`-96px` 展示的是第 3 列（x 96..128），以此类推。所以**不要**把负索引自行换算成正列号再写 `background-position`，直接用乘法即可。

## 3. 状态映射（hermes-pet M0 用哪几组）

| hermes-pet 状态 | 用 oneko 的哪组 sprite | 帧序列 |
|---|---|---|
| 待机 idle | `idle` | 单帧 |
| 警觉 alert（鼠标靠近 / 被点名） | `alert` | 单帧 |
| 走动 walk（可选，M0 可只做静止，走动为 P1） | 按方向 `N/NE/E/SE/S/SW/W/NW` | 每组 2 帧交替 |
| 打盹 tired（刚犯困） | `tired` | 单帧 |
| 睡觉 sleeping | `sleeping` | 2 帧交替（慢） |
| 抓痒/洗脸 scratchSelf | `scratchSelf` | 3 帧 |
| 蹭墙 scratchWallN/S/E/W | 同名组 | 各 2 帧 |

## 4. 空闲行为时序（实测抄自 oneko.js 的 `idle()`）

这类参数的**量级**是陪伴感的来源，M0 直接沿用其节拍：
- 每帧 `idleTime += 1`；只有 `idleTime > 10` 之后才可能触发小动作，触发概率 `1/200` 每帧 → **大约每 20 秒有一次小动作的机会**（这是「安静但有活气」的关键数字）
- 小动作从 `[sleeping, scratchSelf, (+ 贴边的 scratchWallX)]` 里**随机**挑一个
- `sleeping` 分支：前 8 帧先显示 `tired`，之后切 `sleeping` 并缓慢交替（每 4 帧换一次）；超过 192 帧后复位回 idle
- `scratch*` 分支：播放 10 帧后复位回 idle
- 鼠标距离 < 48px 时不再走动，进入 idle 分支（即猫走进鼠标附近就停下）

## 5. 给 codex 的硬性要求

1. 必须写一个开发用页面 `tools/sprite_preview.html`（无依赖，直接 `file://` 打开），把**每个状态**在页面里并排渲染出来（含帧序号），供人工一眼核对映射是否正确
2. GIF 是网格贴图，**不要**用 `<img src="oneko.gif">` 当动画播放；用 `background-image` + `background-position` 或 canvas `drawImage(src, sx, sy, 32,32, ...)`
3. 若你验证发现某个状态的实际画面与名字不符（例如 sleeping 看起来不像睡觉），**以实测为准并在 `docs/M0-sprite-map.md` 末尾追加「实测修正」小节**记录你的修正与依据（附你观察到的帧位置），不要静默改表
4. 应用图标与托盘图标已生成好，直接用：`data/sprites/icon-256.png` / `icon-128.png` / `icon-64.png` / `icon-32.png` / `icon-night.png` / `tray.png`（深空蓝 #2D3748 + 星光金 #ECC94B，透明背景，与产品设计文档 4.2 色彩系统一致）
