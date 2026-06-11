# AGENTS.md — Gravity Flip Runner 協作規範

**所有 AI agent（Claude Code 與 Codex）必須遵守本文件。**

## 專案概況

- 遊戲：**Gravity Flip Runner**（重力翻轉橫向跑酷）— NTHU CS2410 Software Studio final project
- 引擎：**Cocos Creator 2.4.8**（網頁遊戲，TypeScript）
- ⚠️ **Demo 日期：2026/6/13–14，時間極度緊迫，只做 MVP 必要的事**
- 玩法：角色自動前進，按 Space/W/↑ 翻轉重力在地板/天花板間切換，躲尖刺、過缺口、收集水晶、抵達傳送門
- 目錄：
  - `GravityRunner/` — 遊戲專案（主戰場）
  - `SoftStone/` — 舊的 Mario lab，**唯讀參考，禁止修改**
  - `collab/` — AI 協作溝通區
  - `spec/` — 課程與遊戲提案簡報

## 架構（重要，先讀懂再動手）

設計原則：**場景極簡、一切由程式碼生成**。兩個 `.fire` 場景（Menu、Game）都只有
Canvas + Main Camera + 一個入口腳本，所有 UI、關卡、角色都在執行期用程式碼建立。
這是刻意的——`.fire` 是 merge conflict 重災區，保持極簡就永遠不會衝突。

```
GravityRunner/assets/
  scenes/Menu.fire     入口=MenuCtrl    （不要動）
  scenes/Game.fire     入口=GameMgr     （不要動）
  scripts/
    GameMgr.ts       遊戲場景總管：載資源→建世界→狀態機(ready/run/dead/win/paused)→HUD
    Player.ts        玩家：自動前進+重力翻轉+AABB碰撞（純手寫運動學，無物理引擎）
    LevelBuilder.ts  讀 JSON 建關卡；走廊常數 FLOOR_Y=-250 / CEIL_Y=+250 / THICK=70
    CameraFollow.ts  相機水平跟隨
    MenuCtrl.ts      主選單（程式碼建 UI）
    GameData.ts      跨場景狀態 + localStorage 進度
    Sfx.ts           音效（resources/audio/*.wav，bgm.mp3 可選）
  resources/
    levels/level1~3.json   關卡資料（改關卡只動這裡）
    textures/*.png         程式生成的霓虹風素材（tools/gen-art.ps1）
    audio/*.wav            程式合成音效（tools/gen-sfx.js）
```

## Cocos Creator 2.4.8 API 鐵則（違反 = 遊戲直接掛掉）

這是 **2.x** 不是 3.x！網路上和訓練資料裡大量範例是 3.x，**絕對不要混用**：

| ❌ 3.x 寫法（禁止） | ✅ 2.4.8 寫法 |
|---|---|
| `import { _decorator, Component, Node } from 'cc'` | `const { ccclass, property } = cc._decorator;` 全域 `cc` 命名空間 |
| `@ccclass('Player')` | `@ccclass`（不帶字串） |
| `this.node.setPosition(new Vec3(...))` | `node.x / node.y / node.setPosition(x, y)` |
| `node.rotation`（四元數） | `node.angle`（度，逆時針為正） |
| `resources.load(...)` from 'cc' | `cc.resources.load(...)` |
| `director.loadScene` | `cc.director.loadScene("Game")` |
| `input.on(Input.EventType...)` | `cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, ...)` |
| `AudioSource` 元件 | `cc.audioEngine.play(clip, loop, volume)` |
| `UITransform` 取尺寸 | `node.width / node.height / node.setContentSize(w, h)` |

其他鐵則：
- TypeScript 寫法保守（target ES5）：不用 optional chaining `?.`、nullish `??`、`#private`
- 元件繼承 `cc.Component`，`export default class X extends cc.Component`
- 場景內動畫用 `cc.tween(node)`，不要用舊版 `cc.moveTo` action

## 檔案規則（避免互相踩踏）

1. **禁止手動編輯 `.fire` / `.meta` 檔**。新增 `.ts` 腳本時不要自己寫 .meta，
   讓 Cocos Creator 編輯器開啟時自動生成（使用者會定時開編輯器）。
2. **uuid 永遠不要改**。動了 meta 的 uuid，場景引用全斷。
3. `library/`、`temp/`、`local/`、`build/` 是生成物，已 gitignore，不要碰。
4. 一個任務只動 BOARD.md 上列給你的檔案。要動別人負責的檔案 → 先在 notes 留言。
5. **Codex 不可修改**：`Player.ts`（物理手感）、兩個 `.fire`、所有 `.meta`。
   需要改的話在 `collab/codex-notes.md` 留言給 Claude。

## 協作流程

- 任務看板：`collab/BOARD.md`（認領時把任務移到 In Progress 並寫上名字）
- Claude → Codex 訊息：`collab/claude-notes.md`（新訊息加在最上面，帶日期時間）
- Codex → Claude 訊息：`collab/codex-notes.md`（同上）
- git commit 訊息前綴：`[claude]` / `[codex]`，小步提交
- 開工前先 `git log --oneline -10` + 讀對方 notes 的新訊息
- Claude 是 tech lead：架構決定以 Claude 為準，Claude 會 review Codex 的 commit

## 驗證方式

- 型別檢查：`cd GravityRunner && npx -p typescript@4.9.5 tsc --noEmit -p tsconfig.json`（必須 0 error 才能 commit）
- 真正測試：使用者用 Cocos Creator 2.4.8 開 `GravityRunner/` 按 preview。
  AI 改完程式碼請在 notes 寫清楚「要測什麼、預期看到什麼」。

## 關卡設計規則（改 levels/*.json 前必讀）

- 走廊：地板表面 y=-250，天花板表面 y=+250；玩家只能在貼地時翻轉
- 翻轉滯空時間 ≈ 0.58s → 水平位移 ≈ `speed × 0.58`（speed 280→162px, 300→175px, 330→191px）
- **每次強制翻轉的落點，對面必須有實體段**（segment 覆蓋落點 x ± 100）
- 兩次強制翻轉間隔 ≥ 0.75s（即 `speed × 0.75` px），Level 1 建議 ≥ 1.1s
- 尖刺強制翻轉點 ≈ 尖刺 x − 翻轉位移；缺口強制翻轉點 ≈ 缺口左緣 − 少量提前量
- 改完 JSON 要在腦中跑一遍完整路徑驗證（從 start 逐個障礙推落點），把驗證過程寫進 notes

### 關卡 JSON 全部欄位（完整 schema 見 LevelBuilder.ts 開頭註解）

| 欄位 | 格式 | 注意事項 |
|---|---|---|
| segments | `{x, w, side}` | 地板/天花板實體段 |
| platforms | `{x, y, w, h}` | 走廊中的懸浮平台 |
| spikes | `{x, side}` | 尖刺 |
| crystals | `{x, y}` | 跑線 y：地板 -212 / 天花板 +212 / 翻轉途中 0 |
| powerups | `{x, y, type}` | type: `shield`(擋一次尖刺/敵人) / `slow`(全場慢動作4s) / `magnet`(磁吸5s) |
| teleports | `{x, y, tx, ty}` | 單向 A→B，**tx 必須 > x+50**（否則無限循環）；ty 的正負決定出口貼哪面 |
| enemies | `{x, y, axis, range, period, phase?}` | 巡邏無人機，sin 振盪，碰到死；放置處必須留給玩家「提早/延後翻轉」的迴避空間 |
| rotations | `{x, angle}` | 視覺場地旋轉（90=走廊轉直、重力看起來變左右）；物理不變，純相機旋轉；不要放在強制翻轉密集區 |

### 雙人模式（已實作）

- 選單選 1P/2P；2P：P1=W、P2=↑/Space，觸控左半=P1 右半=P2
- 兩人同速並行（P2 起點落後 60px）；一人死且隊友存活 → 3 秒後在隊友旁復活（1.5s 無敵）；全滅 → 重來
- 任一人到達終點 = 過關

### 設定系統（已實作）

- `GameData.settings`：sfx / bgm / speed(0.8~1.2) / scheme(0=NEON,1=SUNSET,2=MATRIX) / brightness(0.6~1)
- localStorage 持久化；色系 palette 在 `LevelBuilder.SCHEMES`，新增色系只要加一個 entry
- 音效一律走 `Sfx.play(name, vol)`，不要直接呼叫 cc.audioEngine（會繞過音量設定）
