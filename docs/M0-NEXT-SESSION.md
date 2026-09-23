# hermes-pet M0 — 下次开工单

> 写于 2026-09-23 收工前，由琉斯留。M0 已交付并**由调度者独立复验通过**，下面是「明天从哪继续」。

## 一、当前状态（已验证，可放心）
| 项 | 值 |
|---|---|
| 本地 HEAD | `4ff4608`（第五轮：冒烟断言与光标解耦） |
| 已验证 | 冒烟 **5/5 绿、退出码全 0**；单测 **92/92**（宿主 + 容器两套）；`--self-check` **18/18** |
| 工作树 | 干净 |
| 远端 | `github.com/Aslanilles/hermes-pet`（已同步） |
| 容器 | `hermes-pet-dev`（只跑零依赖 `node --test`，GUI 在宿主跑） |
| 猫 | 双击 `启动hermes-pet.cmd` 拉起；退出走托盘菜单或右键→退出 |

## 二、待站长拍板（5 条，按重要性排）
1. **技术选型**：产品文档附录 A 写 Tauri+React+Live2D，M0 实做 Electron+原生 JS（因本机无 Rust + 1 小时窗口）。**认不认？**不认则 M1 要重来。
2. **猫的形象**：M0 用的是经典 oneko **白色像素猫**做占位，与设计文档 4.7「矢量插画、明确不要像素小猫」冲突。深蓝金（#2D3748/#ECC94B）目前只落在图标上。真做定制猫 = 要美术产能。
3. **休息提醒间隔**：现实现 **40 分钟**（对齐站长走动喝水节奏）；脑洞设计文档写 **2 小时**（对齐产品文档场景 3）。定一个数。
4. **猫要不要在全屏程序前让位**：上游 clawd-on-desk 会在全屏游戏/视频占前台时主动撤下置顶。做汇报时被猫挡住会烦，建议让位。
5. **产品定位**（方向级，值得单聊）：冲浪反调——桌宠赛道已被「AI coding agent 状态显示器」吞并（cc-haha 14685⭐ / clawd 6276⭐ / openpets 1226⭐），建议 hermes-pet 第一身份定为「**琉斯运行状态的物理化身**」，陪伴当副产品。定了会影响 M1 功能排序。

## 三、M1 候选清单（已记，未排期）
- ★ **「初见与命名」流程**：首启从屏幕边缘探出、问「你叫什么名字」、记住后从此叫名字（脑洞 F1，M0 漏做，我建议 M1 第一个做）
- **「别烦我 / 透明模式」托盘开关**：一键让猫恒定穿透不吃点击（竞品 Ark-Pets 同名功能）。猫身下的图标现在点不到，这是当前最容易被感知的痛点
- **边缘吸附**（拖到屏幕边缘 20px 内吸附）
- **回来招呼**（离开 >30 分钟回来后一句「回来了」）
- **24h 主动说话硬上限 6 次 + 深夜额度放宽**（脑洞 2.1 提的，M0 只做了「每 2 小时 ≤1 次」）
- **真网关联调**（协议已冻结在 `handoff` 里、用本地替身网关验证过鉴权头，但没连过站长真网关）

## 四、已知遗留 / 技术债
1. **`docs/_recon/**` 约 1.3MB 被一并入库**（冲浪的调研中间产物：HTML 快照、缓存 JSON、猫素材 zip）。要瘦身：`git rm -r --cached docs/_recon` + 加 `.gitignore`（保留 `M0-recon-github-pet.md` 正文）。
2. **`src/hermes_pet/`（旧 PySide6 骨架）+ `pyproject.toml` + `.venv`** 仍在仓库里（M0 明文要求「不清理」）。M1 可考虑归档或移除 `.venv`。
3. **穿透看门狗周期 2000ms**：上游为补 5 秒盲窗用的是 ~1 秒快轮询。桌宠场景 2000ms 够用，嫌钝可改 `src/core/window-guards.js`。
4. **`--smoke-test` 的 `pet` 字段曾被杠精质疑可硬编码**（P1-17）；现读的是渲染进程回报的 `catRendered`，不是常量，但这条依赖渲染进程诚实。

## 五、复验命令速查（调度者自用）
```powershell
cd D:\Jiayi\Projects\hermes-pet
Get-Process electron -EA SilentlyContinue | Stop-Process -Force
npm test                                                      # 宿主 92 用例
docker exec -w /workspace hermes-pet-dev node --test tests/    # 容器同一套
npx electron . --self-check                                    # 交互链路 18/18
1..5 | % { npx electron . --smoke-test; "exit=$LASTEXITCODE" }  # GUI 冷启动 5/5 绿
git ls-files data/ ; git check-ignore -v data/sprites/oneko.gif # 素材必须 8 项入库
```
**首启落点复验**：删 `%APPDATA%\hermes-pet\state.json` 再跑，期望 `x:1272, y:684`（逻辑屏 1440x852、窗口 144x144、边距 24）。
⚠️ **别用物理像素算**：本机 scaleFactor=2，物理窗口 288 与逻辑屏 1440 混算会得出错的 1128/588（我在第三轮任务书里错过一次，被 codex 抓出来）。

## 六、派单书纪律（本轮踩过的）
- **单一权威**：任务书开头必须写「本文件为本轮唯一权威，冲突以本文件为准」。本轮出过一次自相矛盾（BRIEF §5「禁止改 sprite-map」× 我的 FIX 书「在该文件末尾追加」），codex 只能仲裁。
- **别在验收命令里写死自己算错的期望值**。
- **每条 P0 必带「验收方式」，判据必须确定性、可脚本化。**
- 通用经验已沉淀为 skill：`software-development/electron-desktop-app-pipeline`
