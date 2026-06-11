# 任務看板 — Gravity Flip Runner

> 認領規則：把任務從 Backlog 移到 In Progress 並標名字；完成移到 Done 並附 commit。
> Demo：6/13–14。優先序由上而下。

## In Progress

（無）

## Backlog — Codex

- [ ] **C1. CC0 BGM**：找一首 CC0/免署名的 synthwave 風 BGM（如 Kenney audio、OpenGameArt、
      itch.io CC0），下載放到 `GravityRunner/assets/resources/audio/bgm.mp3`（< 3MB），
      然後在 `MenuCtrl.onLoad` 和 `GameMgr.onLoad` 各加一行 `Sfx.playBgm()`。
      來源與授權寫進 codex-notes.md。
- [ ] **C2. Level 2/3 校對**：依 AGENTS.md「關卡設計規則」逐障礙驗算 level2.json、level3.json
      的可通關性（落點都有實體段、間隔合理），把驗算結果寫進 codex-notes.md。
      發現問題直接修 JSON（只能動 levels/*.json）。
- [ ] **C3. Menu 視覺加強**：MenuCtrl.ts 內加：標題霓虹閃爍 tween、背景漂浮水晶粒子
      （程式生成節點即可）。只能動 MenuCtrl.ts。
- [ ] **C4. 結算畫面強化**：GameMgr 的 win 訊息目前是純文字，改成半透明黑底面板
      （white.png 拉伸 + opacity）+ 排版好的統計。只能動 GameMgr.ts 的 HUD/win 區段，
      動手前在 codex-notes.md 說一聲。
- [ ] **C5. README**：GravityRunner/README.md：遊戲介紹、操作、開發方式、素材來源聲明。

## Backlog — Claude

- [ ] **A1. 首次可玩性驗證**：等使用者用 Creator 開啟並回報，修所有啟動問題。
- [ ] **A2. 手感調校**：依使用者試玩回饋調 GRAVITY / speed / 翻轉規則。
- [ ] **A3. 死亡特效強化**：粒子爆裂 + 螢幕震動。
- [ ] **A4. 部署**：firebase 或 GitHub Pages（參考 SoftStone 的 firebase 設定）。
- [ ] **A5. Demo 前 QA**：完整流程過一遍，凍結功能修 bug。

## Done

- [x] **專案骨架 + 核心玩法 + 3 關 + 素材 + 音效**（Claude, 6/11）
      Cocos Creator 2.4.8 專案、Menu/Game 場景、Player 物理、LevelBuilder、
      HUD、進度解鎖、程式生成霓虹素材與 chiptune 音效。tsc 0 error。
