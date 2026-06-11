# Rhythm / TJA Mode

這版把太鼓 `.tja` 轉成「兩軌重力跑酷音遊關卡」。

## 玩法設計

- 場上只有上下兩條軌道，而且軌道距離比原本 Gravity Runner 更窄。
- 紅色 note = Don：要在對的軌道上輕跳，身體碰到紅點才得分。
- 藍色 note = Ka：要翻轉到另一側，身體碰到藍點才得分。
- 按鍵本身不會直接給分；所有 note 都是碰撞判定。
- 沒吃到 note 不會直接死亡；只會 MISS、斷 combo、少分。
- 只有 TJA roll / 連打區間內，上下來回撞軌道才會額外 `+100`。
- 輕跳必須貼著平台才能跳，不能在空中連跳。
- 關卡結尾的平台會自動鋪到 portal 後方，所以不會在結束前掉下去。

操作預設值：

```text
F / J              = 輕跳
D / K              = 翻轉重力
R                   = 重新開始
ESC                 = 暫停
```

可以在 `SETTINGS` 裡自訂節奏模式按鍵：

```text
RHYTHM JUMP KEYS   = 輕跳按鍵
RHYTHM FLIP KEYS   = 翻轉按鍵
```

點進去後可以選：

```text
REPLACE NEXT KEY = 下一個按下的鍵會取代原本設定
ADD NEXT KEY     = 下一個按下的鍵會加入設定
RESET DEFAULT    = 回到 F/J 或 D/K
```

例如你想設定成 `A / L` 跳、`S / K` 翻，就分別進 Jump / Flip 設定，用 Replace 設第一顆，再用 Add 加第二顆。

基本想法是：

> 紅點要求你在原本軌道上輕跳；藍點要求你翻到另一邊。譜面會把目標點放在角色照節奏操作後剛好會經過的位置。


## TJA 時間軸解析規則

這版的 parser 已改成照 TJA 的小節規則解析，而不是用固定 16 分音符硬切。

- 一個 `,` 代表一小節結束。
- 一小節裡有幾個數字，就把這一小節切成幾等分。
  - 例如 4/4 小節有 48 個數字，就代表每格是 `1/48` 小節，也就是 12 分音符層級。
  - 4/4 小節有 72 個數字，就代表更細的切分。
- `#MEASURE 6/4` 會改變後續小節長度。
- `#BPMCHANGE` 會從當前位置開始影響後面的時間。
- `#DELAY` 會直接推進譜面時間。
- `5 / 6 / 7 ... 8` 會轉成 roll / 連打區間，不會被當成一般紅藍 note。

所以像 `幽玄ノ乱.tja` 這種大量 48 / 72 分割小節、途中 BPMCHANGE、還有 roll 的譜面，現在會保留原始切分與連打區間。

## BPM 與速度

轉譜工具預設會同時用 BPM 決定「角色速度」與「每拍水平距離」。

```text
pxPerBeat = clamp(basePxPerBeat + (BPM - 120) * bpmSpacingFactor, minPxPerBeat, maxPxPerBeat)
speed = BPM * pxPerBeat / 60
```

預設大約是：

```text
basePxPerBeat = 190
bpmSpacingFactor = 0.75
minPxPerBeat = 150
maxPxPerBeat = 300
```

所以 BPM 越高：

- 角色跑得越快
- 每拍的水平距離也會變大
- 高速歌比較不會全部擠在一起

另外，遊戲內的 `FLOW SPEED` 是在這個基礎上再乘倍率：

```text
finalSpeed = convertedSpeed * FLOW_SPEED
finalNoteDistance = convertedNoteDistance * FLOW_SPEED
```

例如轉譜後原本是 `1.0x`，你在選歌畫面改成 `1.5x`，速度跟 note 間隔都會變成 1.5 倍。

如果你想關掉這個自動縮放，可以手動指定固定值：

```bash
node tools/import_tja_song.js --all --px-per-beat 200
```

這版也把 camera lookahead 調大，所以節奏模式中角色會比一般關卡更靠左。

## 跳躍 / 翻轉時間

藍點翻轉維持接近瞬發，預設 `< 10 ms`。

紅點輕跳改成「輸入很快，但視覺上有短短跳躍弧線」：

- `jumpHitDelay` / `jumpReturnTime` 會依 BPM 推估
- BPM 越高，跳躍時間越短
- 夏祭り BPM 約 140 時，預設約 `0.098s`

這樣看起來會真的在跳，但因為紅點的 `x` 與 `hitTime` 也會一起補正，所以照節奏按仍然可以剛好碰到 note。

## Menu 裡的節奏模式

主選單現在變成：

```text
RHYTHM MODE
  -> 調 TRACK GAP / 選歌
      -> 選難度
          -> 開始遊戲
```

`TRACK GAP` 可以直接在 Rhythm Mode 選歌畫面用 `- / +` 調整，也可以在 SETTINGS 裡調。這個設定會即時影響上下軌道距離、note 高度、平台位置與起點，不需要重新轉譜。

`FLOW SPEED` 也可以直接在 Rhythm Mode 選歌畫面用 `- / +` 調整，範圍是：

```text
0.1x ~ 2.0x
```

這個倍率不是單純改角色速度而已。它會同時縮放：

- 角色跑速
- note 的水平間隔
- platform 長度與終點位置
- 鏡頭前看距離

所以音樂同步不會跑掉：距離和速度會一起乘上同一個倍率。

目前內建：

```text
夏祭り
  EASY   -> level6.json
  NORMAL -> level7.json
  HARD   -> level8.json
  ONI    -> level9.json
```

歌曲清單在：

```text
GravityRunner/assets/resources/rhythm_catalog.json
```

## 最簡單：自動匯入整個資料夾的 TJA

把所有譜面與音樂都放到：

```text
tools/charts/
```

建議檔名相同：

```text
tools/charts/千本桜.tja
tools/charts/千本桜.ogg
tools/charts/夏祭り.tja
tools/charts/夏祭り.ogg
```

然後在專案根目錄跑一行就好：

```bash
node tools/import_tja_song.js --all
```

或直接跑：

```bash
node tools/import_all_tja_songs.js
```

它會自動掃描 `tools/charts/` 裡所有 `.tja`，並做這些事：

1. 從 TJA 的 `TITLE:` 自動抓歌名。
2. 自動找 `WAVE:` 指定的音樂；如果沒有，就找同名 `.ogg / .mp3 / .wav`。
3. 只轉出 TJA 裡實際存在的難度。
4. 放到 `GravityRunner/assets/resources/levels/rhythm/`。
5. 複製音樂到 `GravityRunner/assets/resources/audio/`。
6. 更新 `GravityRunner/assets/resources/rhythm_catalog.json`，讓 menu 裡看得到新歌。

如果譜面放在別的資料夾，可以指定：

```bash
node tools/import_tja_song.js --all --charts-dir tools/my_charts
```

跑完之後，**重新用 Cocos Creator 開專案**，讓 Cocos 匯入新的 json / audio 資源。


### 編碼與日文檔名

匯入工具現在會自動嘗試：

```text
UTF-8
Shift-JIS / Windows-31J / CP932
```

所以像 `幽玄ノ乱.tja` 這種日文 TJA 常見的 Shift-JIS 編碼也可以正常解析，`TITLE:`、`WAVE:`、`COURSE:` 都會讀成正確文字。

如果 TJA 裡有：

```text
WAVE:幽玄ノ乱.ogg
```

請把音樂檔也放在同一個資料夾：

```text
tools/charts/幽玄ノ乱.tja
tools/charts/幽玄ノ乱.ogg
```

工具會優先找 `WAVE:` 指定的音樂，再找同名 `.ogg / .mp3 / .wav / .m4a`。找不到時仍然會轉出關卡，但不會亂拿資料夾裡其他音樂檔代替。

## 手動新增單一首 TJA

還是可以只匯入一首：

```bash
node tools/import_tja_song.js \
  --id your_song \
  --title "Your Song" \
  --tja tools/charts/your_song.tja \
  --audio tools/charts/your_song.ogg
```

## 只想手動轉單一難度

也可以直接用底層轉譜工具：

```bash
node tools/tja_to_level.js \
  --tja tools/charts/your_chart.tja \
  --audio tools/charts/your_song.ogg \
  --course Oni \
  --out GravityRunner/assets/resources/levels/level9.json \
  --audio-name rhythm_summer \
  --name "Your Song [Oni Jump Flip]" \
  --px-per-beat 200 \
  --min-note-gap 0.16
```

比較重要的參數：

- `--course Easy|Normal|Hard|Oni`：選 `.tja` 內的難度。
- `--px-per-beat`：固定每一拍對應多少世界座標距離。設定後會覆蓋 BPM 自動 spacing。
- `--base-px-per-beat`：BPM 自動 spacing 的基準值，預設 `190`。
- `--bpm-spacing-factor`：BPM 每增加 1 時，pxPerBeat 增加多少，預設 `0.75`。
- `--min-px-per-beat / --max-px-per-beat`：自動 spacing 的上下限。
- `--min-note-px`：太密 note 的最小水平距離。**不填時不會刪 note**；只有你明確設定這個參數時才會簡化密集譜面。
- `--speed`：手動指定角色前進速度。若有設這個，就不會自動用 BPM 算。
- `--min-note-gap`：太密的 note 會被略過，避免畫面與操作太擠。**預設是 0，不會略過任何原譜 note。**
- `--camera-lookahead`：節奏模式鏡頭前看距離。越大，角色越靠畫面左邊。
- `--floor-y / --ceiling-y`：轉譜時的上下軌道基準位置，預設 `-140 / 140`。實際遊玩時也可以在 Rhythm Mode 用 `TRACK GAP` 動態調整。
- `--jump-height`：紅點輕跳高度，預設 `66`。
- `--jump-hit-delay`：紅點位置時間補正；不填會依 BPM 推估。
- `--flip-hit-delay`：藍點位置時間補正；不填會依 BPM 推估，預設接近瞬發。
- `--jump-return-time`：輕跳回到平台的時間；不填會依 BPM 推估。
- `--flip-travel-time`：翻轉視覺動作時間；不填會依 BPM 推估。
- `--perfect-window / --good-window / --bad-window`：判定寬度，單位是秒。

## TJA note 對應

- `1 / 3` Don -> 紅色輕跳點
- `2 / 4 / 6` Ka -> 藍色翻轉點
- Roll 不會變成一般 note，但會變成連打 bonus 區間；只有這段時間內上下撞軌道才會 `+100`。

## 已知調參方向

如果玩起來覺得太擠，但仍想保留完整譜面，優先提高：

```bash
--base-px-per-beat 210
--bpm-spacing-factor 0.9
```

如果只是想做比較容易玩的版本，才額外加：

```bash
--min-note-px 120
```

如果覺得角色還不夠左，可以提高：

```bash
--camera-lookahead 340
```

如果覺得紅點跳得不明顯，可以提高：

```bash
--jump-return-time 0.12
--jump-height 74
```

如果覺得紅點跳太拖，可以降低：

```bash
--jump-return-time 0.075
--jump-hit-delay 0.075
```

如果覺得上下軌道太遠或太近，優先在遊戲內：

```text
RHYTHM MODE -> TRACK GAP - / +
```

不用重新轉譜。

## 如果匯入新 TJA 沒有出現在選單

這版 `tools/import_tja_song.js` 已修正幾個常見問題：

- `--id` 可以使用日文/中文，例如 `--id 千本桜`。
- TJA 裡如果寫 `COURSE:0/1/2/3/4`，會自動對應成 Easy / Normal / Hard / Oni / Edit。
- 只會匯入 TJA 裡真的存在的難度，不會因為缺 Easy 或 Normal 就整個失敗。

先檢查譜面有什麼難度：

```bash
node tools/import_tja_song.js --tja tools/charts/千本桜.tja --list-courses
```

再匯入：

```bash
node tools/import_tja_song.js \
  --id 千本桜 \
  --title "千本桜" \
  --tja tools/charts/千本桜.tja \
  --audio tools/charts/千本桜.ogg
```

如果你用的是 PowerShell，換行不是 `\`，要用反引號：

```powershell
node tools/import_tja_song.js `
  --id 千本桜 `
  --title "千本桜" `
  --tja tools/charts/千本桜.tja `
  --audio tools/charts/千本桜.ogg
```

## 歌曲很多時的選歌方式

`RHYTHM MODE` 的選歌畫面現在會自動分頁，每頁顯示 5 首歌。

```text
PREV / NEXT = 上一頁 / 下一頁
PAGE x / y  = 目前頁數
```

所以可以直接用 `node tools/import_tja_song.js --all` 匯入大量歌曲，不會再因為歌曲太多而超出畫面。
