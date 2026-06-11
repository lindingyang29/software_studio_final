# 任務看板 — Gravity Flip Runner

> 認領規則：把任務從 Backlog 移到 In Progress 並標名字；完成移到 Done 並附 commit。
> Demo：6/13–14。優先序由上而下。

## In Progress

（無）

## Backlog — 組員（人類）

- [ ] **H1. Firebase Console 設定**（13% 的開關，程式都寫好了，只差 console 三步）：
      專案 gravity-runner-2e4da → (1) Authentication 啟用 Email/Password；
      (2) Realtime Database 建立 + 貼上 FbConfig.ts 註解裡的規則 JSON；
      (3) Authentication → Settings → Authorized domains 加 `lindingyang29.github.io`。
      若 RTDB 網址不是 `gravity-runner-2e4da-default-rtdb.firebaseio.com`，
      改 FbConfig.ts 的 databaseURL。

## Backlog — Codex

- [ ] **C1. CC0 BGM**：找一首 CC0/免署名的 synthwave 風 BGM（如 Kenney audio、OpenGameArt、
      itch.io CC0），下載放到 `GravityRunner/assets/resources/audio/bgm.mp3`（< 3MB）。
      程式已會自動播放（Sfx.playBgm 已接好），放檔案即可。來源與授權寫進 codex-notes.md。
- [ ] **C2. Level 2/3 校對 + 新元素驗證**：依 AGENTS.md「關卡設計規則」逐障礙驗算
      level2/level3 的可通關性，特別檢查新加的 teleports/enemies/rotations 位置是否公平。
      把驗算結果寫進 codex-notes.md。發現問題直接修 JSON（只能動 levels/*.json）。
- [ ] **C3. 用新元素豐富關卡**：在 level2/3 加入更多 teleports/powerups/enemies 組合
      （每關至多 +3 個元素，避免雜亂），每個新增點都要附驗算。只能動 levels/*.json。
- [ ] **C4. 結算畫面強化**：GameMgr 的 win 訊息目前是純文字，改成半透明黑底面板
      （white.png 拉伸 + opacity）+ 排版好的統計。只能動 GameMgr.ts 的 HUD/win 區段，
      動手前在 codex-notes.md 說一聲。
- [ ] **C5. README**：GravityRunner/README.md：遊戲介紹、操作（含 2P）、設定選單、
      開發方式、素材來源聲明。

## Backlog — Claude

- [ ] **A1. 可玩性驗證**：等使用者試玩回報（特別是 2P、旋轉區、傳送門手感），修問題。
- [ ] **A2. 手感調校**：依回饋調 GRAVITY / speed / 翻轉規則 / 無人機難度。
- [ ] **A3. 死亡特效強化**：粒子爆裂 + 螢幕震動。
- [ ] **A4. 部署**：firebase 或 GitHub Pages（參考 SoftStone 的 firebase 設定）。
- [ ] **A5. Demo 前 QA**：完整流程過一遍（1P+2P 各過三關），凍結功能修 bug。

## Done

- [x] **大型功能更新**（Claude, 6/11）：傳送門、道具×3（護盾/慢動作/磁鐵）、巡邏無人機、
      場地旋轉90°（rotation zones）、雙人同畫面合作模式、設定選單（音效/音樂/速度/色系/亮度，
      localStorage 持久化）、3 關全部安插新元素。tsc 0 error。
- [x] **專案骨架 + 核心玩法 + 3 關 + 素材 + 音效**（Claude, 6/11）commit 8cb74d2
