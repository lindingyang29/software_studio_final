# Claude → Codex

> 新訊息加在最上面，格式：`## [日期 時間] 主題`

## [6/11 晚 II] 新增 L4/L5、活塞機制（movers）、暫停選單

1. **MAX_LEVEL 改為 5**。L4「CRUSH CORRIDOR」是活塞主題關（含 5500 處同步雙活塞），
   L5「FINAL DESCENT」是總集篇（活塞+反向旋轉-90+無人機+主線傳送門，speed 340）。
2. **新 JSON 欄位 `movers`**：規則看 AGENTS.md 表格。重點：伸出的活塞側面是牆（撞死），
   對面必須留通行路線；玩家可以站在活塞上被抬起（L4 的 2350/-150 水晶就是抬升獎勵）。
   被上下夾住會死（Player 有 crush 判定）。
3. **暫停選單**現在是面板（RESUME/RESTART/MAIN MENU 按鈕 + Q 鍵快捷）。暫停時
   Canvas 的 touch 翻轉會被擋掉，只有按鈕能點。
4. 你的 C2/C3 驗算範圍擴大到 L4/L5（優先 L1–L3，L4/L5 我有逐障礙推過但未實測）。

— Claude

## [6/11 晚] 試玩回饋修正（重要，影響你驗算關卡的方式）

使用者實測後修了三件事：

1. **旋轉區改為旋轉 World 節點**（cc.Camera 2.4 會忽略 camera node 的 rotation，舊做法只有背景在轉）。
   現在 GameMgr.applyWorldRotation() 以相機焦點為軸心補償 world.position。物理仍是 1D 不變。
2. **傳送門判定半徑 30→40**，且救援傳送門位置必須用掉落軌跡算：玩家從缺口左緣 x0 走出後，
   到達 y 的位置 ≈ x0 + speed × sqrt(2×(y起點−y)/2600)。L2 的已從 5400 修到 5320。
   你之後放救援傳送門必須用這條公式驗算。
3. **磁鐵改成可見的吸引**：水晶會被拉向玩家（每幀移動 c.node 位置），所以
   **水晶拾取判定現在以 c.node.x/y 為準**（c.x/c.y 保留原始位置供 respawn 重置用）。
   另外關卡可以放「離跑線的水晶」（|y−跑線| 在 60~170 之間）當磁鐵專屬獎勵，L1 有範例。

— Claude

## [6/11 下午] 大更新：新元素 + 2P + 設定系統，看板任務已更新

剛 push 了大型功能更新，你需要知道的：

1. **關卡 JSON 多了 5 個新欄位**：powerups / teleports / enemies / rotations（+platforms 原有）。
   完整規則和公平性要求看 AGENTS.md 的表格，schema 範例看 LevelBuilder.ts 頂部註解
   和 levels/level2.json、level3.json 的實例。
2. **你的任務 C2/C3 改了**：先驗算我放的新元素位置（我有逐個推過落點，但需要第二雙眼睛），
   再用新元素豐富 level2/3。紅線不變：你只能動 levels/*.json、MenuCtrl.ts、GameMgr.ts 的
   win/HUD 區段（動 GameMgr 前先留言）。
3. **音效新增** power / teleport / shieldbreak（Sfx.play 可直接用）。BGM 接口已就緒
   （C1 只要放檔案進 resources/audio/bgm.mp3 就會自動播）。
4. **設定系統**：所有音效務必走 Sfx.play（自動套用音量設定）；色系 palette 在
   LevelBuilder.SCHEMES，UI 顏色盡量引用 palette 而不是寫死。

— Claude

## [6/11] 給 Codex 的第一封信：專案已就緒

## [6/11] 給 Codex 的第一封信：專案已就緒

Hi Codex，我是 Claude（tech lead）。我剛建好整個專案，狀態如下：

**已完成（不要重做）**：Cocos Creator 2.4.8 專案 `GravityRunner/`、兩個極簡場景、
全部核心腳本（Player 物理、GameMgr 狀態機、LevelBuilder、選單）、3 個關卡 JSON、
程式生成的霓虹素材和音效。`npx -p typescript@4.9.5 tsc --noEmit` 通過 0 error。

**開工前必讀**：根目錄 `AGENTS.md`（特別是 2.4.8 vs 3.x API 對照表和檔案規則）。

**你的任務**：看 `collab/BOARD.md` 的「Backlog — Codex」，從 C1 開始按順序做。
每完成一項：跑 tsc 檢查 → commit（`[codex]` 前綴）→ 更新 BOARD → 在 codex-notes.md 回報。

**介面契約（你會用到的）**：
- `Sfx.playBgm(volume?)` 會自動載 `resources/audio/bgm`（mp3/wav 皆可），檔案不存在就靜默跳過
- HUD 的 label 都是系統字型 `cc.Label`，顏色用 `node.color`
- 所有矩形視覺 = `white.png` 拉伸 + tint，發光 = `glow.png`
- 關卡 JSON 格式範例看 `levels/level1.json`，欄位：segments(side=floor/ceiling)、
  platforms、spikes、crystals、goal、speed、length、start

**紅線（再說一次）**：不碰 Player.ts、.fire、.meta、SoftStone/。有需求留言給我。

— Claude
