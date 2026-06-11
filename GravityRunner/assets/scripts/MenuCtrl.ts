import GameData from "./GameData";
import LevelBuilder, { SCHEMES } from "./LevelBuilder";
import Sfx from "./Sfx";
import Fx from "./Fx";
import Fb from "./Fb";

const { ccclass } = cc._decorator;

// Main menu — built entirely in code (the .fire scene only has Canvas + Camera).
// Mode select (1P / 2P), level buttons, and a settings overlay
// (sfx/bgm volume, game speed, color scheme, brightness).
@ccclass
export default class MenuCtrl extends cc.Component {

    private frames: { [k: string]: cc.SpriteFrame } = {};
    private bgNode: cc.Node = null;
    private modeButtons: cc.Node[] = [];
    private hintLabel: cc.Node = null;
    private settingsPanel: cc.Node = null;
    private accountPanel: cc.Node = null;
    private boardPanel: cc.Node = null;
    private savesPanel: cc.Node = null;
    private helpPanel: cc.Node = null;
    private uiSig = "";          // progress snapshot the UI was built from
    private suppressFade = false;
    private rhythmPanel: cc.Node = null;
    private keyBindPanel: cc.Node = null;
    private keyBindKind = "";
    private keyBindMode = "";
    private keyBindStatus: cc.Label = null;
    private accountLabel: cc.Node = null;
    private accountStatus: cc.Node = null;
    private rhythmSongs: any[] = [
        {
            id: "summer",
            title: "夏祭り",
            difficulties: [
                { name: "EASY", level: 6 },
                { name: "NORMAL", level: 7 },
                { name: "HARD", level: 8 },
                { name: "ONI", level: 9 }
            ]
        }
    ];
    private rhythmGapValues = [140, 160, 180, 200, 220, 240, 260, 280, 320, 360, 400];
    private rhythmSpeedValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];
    private rhythmSongPage = 0;
    private readonly rhythmSongsPerPage = 5;
    private rhythmJumpKeyOptions = [
        { label: "F / J", value: "f,j" },
        { label: "SPACE / F / J", value: "space,f,j" },
        { label: "S / DOWN", value: "s,down" },
        { label: "A / L", value: "a,l" }
    ];
    private rhythmFlipKeyOptions = [
        { label: "D / K", value: "d,k" },
        { label: "W / UP", value: "w,up" },
        { label: "D / K / W / UP", value: "d,k,w,up" },
        { label: "LEFT / RIGHT", value: "left,right" }
    ];

    onLoad() {
        Sfx.preload();
        Sfx.playBgm("bgm_menu");
        Fb.init();
        // When cloud slot data arrives after the scene was built (e.g. right
        // after the post-login reload), the level locks / best distance shown
        // are stale — rebuild the UI instead of just refreshing the label.
        Fb.onChanged = () => {
            if (this.uiSig && this.uiSig !== this.progressSig()) {
                this.rebuildUi();
            } else {
                this.refreshAccount();
            }
        };
        cc.resources.loadDir("textures", cc.SpriteFrame, (err, assets: cc.SpriteFrame[]) => {
            if (err) {
                cc.error("texture load failed", err);
                return;
            }
            for (const a of assets) this.frames[a.name] = a;
            cc.resources.load("rhythm_catalog", cc.JsonAsset, (catErr, cat: cc.JsonAsset) => {
                if (!catErr && cat && cat.json && Array.isArray((cat.json as any).songs)) {
                    this.rhythmSongs = (cat.json as any).songs;
                    this.rhythmSongPage = 0;
                }
                this.buildUi();
            });
        });
        cc.director.preloadScene("Game");
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        Fb.onChanged = null;
    }

    private sprite(parent: cc.Node, frame: string, x: number, y: number, w: number, h: number, color?: cc.Color): cc.Node {
        const n = new cc.Node(frame);
        const sp = n.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames[frame];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(w, h);
        n.setPosition(x, y);
        if (color) n.color = color;
        parent.addChild(n);
        return n;
    }

    private label(parent: cc.Node, text: string, x: number, y: number, size: number, color: cc.Color, anchorX: number = 0.5): cc.Node {
        const n = new cc.Node("label");
        n.setPosition(x, y);
        n.anchorX = anchorX;
        n.color = color;
        const lb = n.addComponent(cc.Label);
        lb.string = text;
        lb.fontSize = size;
        lb.lineHeight = size + 6;
        parent.addChild(n);
        return n;
    }

    private progressSig(): string {
        return GameData.getUnlocked() + "|" + GameData.getBestDist();
    }

    private rebuildUi() {
        const cam = this.node.getChildByName("Main Camera");
        const doomed: cc.Node[] = [];
        for (const c of this.node.children) {
            if (c !== cam) doomed.push(c);
        }
        for (const d of doomed) d.destroy();
        this.modeButtons = [];
        this.settingsPanel = null;
        this.accountPanel = null;
        this.boardPanel = null;
        this.savesPanel = null;
        this.helpPanel = null;
        this.rhythmPanel = null;
        this.keyBindPanel = null;
        this.keyBindKind = "";
        this.keyBindMode = "";
        this.keyBindStatus = null;
        this.accountLabel = null;
        this.accountStatus = null;
        this.suppressFade = true; // no black flash on an in-place rebuild
        this.buildUi();
        this.suppressFade = false;
    }

    private applyBgTint() {
        if (!this.bgNode) return;
        const b = GameData.settings.brightness;
        const t = LevelBuilder.scheme().bgTint;
        this.bgNode.color = cc.color(Math.round(t.r * b), Math.round(t.g * b), Math.round(t.b * b));
    }

    private buildUi() {
        const cyan = cc.color(127, 247, 255);
        const orange = cc.color(255, 181, 74);
        const white = cc.color(235, 240, 255);
        const dim = cc.color(110, 120, 150);

        Fx.setFrame(this.frames["white"]);
        this.bgNode = this.sprite(this.node, "bg", 0, 0, 970, 650);
        this.applyBgTint();
        if (!this.suppressFade) Fx.fadeIn(this.node);

        // title (with a short opening animation: pop in + pulse)
        const title = this.label(this.node, "GRAVITY FLIP RUNNER", 0, 230, 56, cyan);
        title.scale = 0;
        cc.tween(title)
            .to(0.6, { scale: 1 }, { easing: "backOut" })
            .then(cc.tween()
                .to(1.4, { opacity: 170 }, { easing: "sineInOut" })
                .to(1.4, { opacity: 255 }, { easing: "sineInOut" })
                .union()
                .repeatForever())
            .start();
        this.label(this.node, "— ESCAPE ASTRA-9 —", 0, 178, 18, orange);

        // opening animation: a runner cube dashes across the screen
        const opener = this.sprite(this.node, "player", -560, -150, 40, 40);
        cc.tween(opener)
            .to(1.1, { x: 560 })
            .call(() => opener.destroy())
            .start();
        cc.tween(opener).by(1.1, { angle: -720 }).start();

        // decorations
        const deco = this.sprite(this.node, "player", -340, 60, 48, 48);
        cc.tween(deco)
            .to(1.2, { y: 85 }, { easing: "sineInOut" })
            .to(1.2, { y: 60 }, { easing: "sineInOut" })
            .repeatForever()
            .start();
        const deco2 = this.sprite(this.node, "player2", -340, -40, 40, 40);
        deco2.scaleY = -1;
        cc.tween(deco2)
            .to(1.5, { y: -65 }, { easing: "sineInOut" })
            .to(1.5, { y: -40 }, { easing: "sineInOut" })
            .repeatForever()
            .start();
        const c1 = this.sprite(this.node, "crystal", 340, 20, 30, 30);
        cc.tween(c1).by(2.4, { angle: 360 }).repeatForever().start();

        // mode select: 1P / 2P
        this.modeButtons = [];
        for (let m = 1; m <= 2; m++) {
            const x = m === 1 ? -75 : 75;
            const btn = this.sprite(this.node, "white", x, 142, 130, 40, cc.color(24, 34, 76));
            this.label(btn, m === 1 ? "1 PLAYER" : "2 PLAYERS", 0, 0, 18, white);
            btn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                GameData.players = m;
                this.refreshModeButtons();
            });
            this.modeButtons.push(btn);
        }
        this.refreshModeButtons();

        // endless mode
        const best = GameData.getBestDist();
        const enBtn = this.sprite(this.node, "white", 0, 96, 260, 40, cc.color(58, 26, 84));
        this.sprite(this.node, "white", 0, 78, 260, 3, orange);
        this.label(enBtn, best > 0 ? "ENDLESS  —  BEST " + best + "m" : "ENDLESS MODE", 0, 0, 18, orange);
        enBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            GameData.currentLevelPath = "";
            GameData.currentLevel = -1;
            Fx.fadeTo("Game", this.node);
        });

        // Rhythm mode opens a nested song-select / difficulty-select menu.
        const rhythmBtn = this.sprite(this.node, "white", 330, 86, 230, 48, cc.color(80, 38, 66));
        this.sprite(this.node, "white", 330, 63, 230, 3, orange);
        this.label(rhythmBtn, "RHYTHM MODE", 0, 6, 20, orange);
        this.label(rhythmBtn, "song select", 0, -14, 13, dim);
        rhythmBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleRhythmMode();
        });

        // level buttons
        const unlocked = GameData.getUnlocked();
        for (let i = 1; i <= GameData.MAX_LEVEL; i++) {
            const open = i <= unlocked;
            const y = 44 - (i - 1) * 48;
            const btn = this.sprite(this.node, "white", 0, y, 260, 42, open ? cc.color(24, 34, 76) : cc.color(22, 24, 34));
            this.sprite(this.node, "white", 0, y - 20, 260, 3, open ? cyan : dim);
            this.label(btn, open ? "LEVEL " + i : "LEVEL " + i + "  [LOCKED]", 0, 0, 18, open ? white : dim);
            if (open) {
                btn.on(cc.Node.EventType.TOUCH_END, () => {
                    Sfx.play("click", 0.8);
                    GameData.currentLevelPath = "";
                    GameData.currentLevel = i;
                    Fx.fadeTo("Game", this.node);
                });
            }
        }

        // settings + level editor buttons
        const sBtn = this.sprite(this.node, "white", -110, -226, 200, 44, cc.color(40, 30, 70));
        this.label(sBtn, "SETTINGS", 0, 0, 20, orange);
        sBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleSettings();
        });
        const eBtn = this.sprite(this.node, "white", 110, -226, 200, 44, cc.color(20, 60, 45));
        this.label(eBtn, "LEVEL EDITOR", 0, 0, 20, cyan);
        eBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            Fx.fadeTo("Editor", this.node);
        });

        // account / saves / leaderboard row
        const aBtn = this.sprite(this.node, "white", -160, -272, 150, 38, cc.color(35, 45, 95));
        this.label(aBtn, "ACCOUNT", 0, 0, 16, white);
        aBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleAccount();
        });
        const sBtn2 = this.sprite(this.node, "white", 0, -272, 150, 38, cc.color(35, 45, 95));
        this.label(sBtn2, "SAVES", 0, 0, 16, white);
        sBtn2.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleSaves();
        });
        const rBtn = this.sprite(this.node, "white", 160, -272, 150, 38, cc.color(35, 45, 95));
        this.label(rBtn, "RANKING", 0, 0, 16, white);
        rBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleBoard();
        });

        // login status (top-right corner)
        this.accountLabel = this.label(this.node, "", 462, 300, 14, dim, 1);
        this.refreshAccount();

        // help button (top-left corner)
        const hBtn = this.sprite(this.node, "white", -430, 300, 100, 26, cc.color(40, 50, 100));
        this.label(hBtn, "? HOW TO PLAY", 0, 0, 11, white);
        hBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleHelp();
        });

        this.hintLabel = this.label(this.node,
            "SPACE / W / UP : FLIP      R : RESTART      ESC : PAUSE      [SPACE = QUICK START]",
            0, -308, 15, dim);

        this.uiSig = this.progressSig();
    }

    private refreshModeButtons() {
        const sel = cc.color(53, 100, 150);
        const norm = cc.color(24, 34, 76);
        for (let m = 0; m < 2; m++) {
            this.modeButtons[m].color = GameData.players === m + 1 ? sel : norm;
        }
        if (this.hintLabel) {
            const lb = this.hintLabel.getComponent(cc.Label);
            lb.string = GameData.players === 2
                ? "P1 : W = FLIP      P2 : UP / SPACE = FLIP      R : RESTART      ESC : PAUSE"
                : "SPACE / W / UP : FLIP      R : RESTART      ESC : PAUSE      [SPACE = QUICK START]";
        }
    }


    private toggleRhythmMode() {
        if (this.rhythmPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();
        this.buildRhythmSongPanel();
    }

    private buildRhythmBasePanel(title: string): cc.Node {
        const panel = this.sprite(this.node, "white", 0, 0, 600, 470, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.rhythmPanel = panel;
        this.label(panel, title, 0, 198, 30, cc.color(255, 181, 74));
        return panel;
    }

    private rhythmLaunch(diff: any) {
        GameData.players = 1;
        GameData.currentLevelPath = diff.path || "";
        GameData.currentLevel = Number(diff.level) || 6;
        Fx.fadeTo("Game", this.node);
    }

    private changeRhythmGap(delta: number) {
        const values = this.rhythmGapValues;
        let best = 0;
        let bd = 1e9;
        for (let i = 0; i < values.length; i++) {
            const d = Math.abs(values[i] - (GameData.settings.rhythmGap || 280));
            if (d < bd) { bd = d; best = i; }
        }
        let next = best + delta;
        if (next < 0) next = values.length - 1;
        if (next >= values.length) next = 0;
        GameData.settings.rhythmGap = values[next];
        GameData.saveSettings();
        Sfx.play("click", 0.65);
    }

    private rhythmGapText(): string {
        return (GameData.settings.rhythmGap || 280) + " px";
    }

    private changeRhythmSpeedScale(delta: number) {
        const values = this.rhythmSpeedValues;
        const cur = Number(GameData.settings.rhythmSpeedScale) || 1;
        let best = 0;
        let bd = 1e9;
        for (let i = 0; i < values.length; i++) {
            const d = Math.abs(values[i] - cur);
            if (d < bd) { bd = d; best = i; }
        }
        let next = best + delta;
        if (next < 0) next = values.length - 1;
        if (next >= values.length) next = 0;
        GameData.settings.rhythmSpeedScale = values[next];
        GameData.saveSettings();
        Sfx.play("click", 0.65);
    }

    private rhythmSpeedText(): string {
        const v = Number(GameData.settings.rhythmSpeedScale) || 1;
        return v.toFixed(1) + "x";
    }

    private rhythmKeyNameFromCode(code: number): string {
        const key: any = cc.macro.KEY as any;
        const preferred = ["space", "up", "down", "left", "right", "escape", "enter", "tab", "backspace",
            "shift", "ctrl", "alt", "semicolon", "comma", "period", "slash", "backslash", "quote", "bracketleft", "bracketright",
            "minus", "equal", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p",
            "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        for (const n of preferred) if (key[n] === code) return n;
        for (const n in key) if (key[n] === code) return String(n).toLowerCase();
        return String(code);
    }

    private normalizeKeyList(raw: string, fallback: string): string {
        const parts = String(raw || "").split(",")
            .map(x => x.trim().toLowerCase())
            .filter(x => !!x);
        const out: string[] = [];
        for (const k of parts) {
            if (out.indexOf(k) < 0) out.push(k);
        }
        return out.length ? out.join(",") : fallback;
    }

    private rhythmKeyDisplay(raw: string, fallback: string): string {
        return this.normalizeKeyList(raw, fallback).split(",").map(x => x.toUpperCase()).join(" / ");
    }

    private keyOptionText(value: string, opts: { label: string; value: string }[]): string {
        const v = String(value || "");
        for (const o of opts) if (o.value === v) return o.label;
        return v.split(",").map(x => x.trim().toUpperCase()).join(" / ") || "NONE";
    }

    private cycleRhythmKeys(kind: string) {
        const opts = kind === "jump" ? this.rhythmJumpKeyOptions : this.rhythmFlipKeyOptions;
        const cur = kind === "jump" ? GameData.settings.rhythmJumpKeys : GameData.settings.rhythmFlipKeys;
        let idx = opts.findIndex(o => o.value === cur);
        idx = (idx + 1 + opts.length) % opts.length;
        if (kind === "jump") GameData.settings.rhythmJumpKeys = opts[idx].value;
        else GameData.settings.rhythmFlipKeys = opts[idx].value;
        GameData.saveSettings();
        Sfx.play("click", 0.65);
    }

    private rhythmJumpKeyText(): string {
        return this.rhythmKeyDisplay(GameData.settings.rhythmJumpKeys || "f,j", "f,j");
    }

    private rhythmFlipKeyText(): string {
        return this.rhythmKeyDisplay(GameData.settings.rhythmFlipKeys || "d,k", "d,k");
    }

    private buildRhythmSongPanel() {
        const white = cc.color(235, 240, 255);
        const cyan = cc.color(127, 247, 255);
        const dim = cc.color(110, 120, 150);
        const panel = this.buildRhythmBasePanel("RHYTHM MODE");
        this.label(panel, "Choose a song", 0, 164, 16, dim);

        const gapLabel = this.label(panel, "TRACK GAP  " + this.rhythmGapText(), 0, 134, 16, cyan);
        const gapMinus = this.sprite(panel, "white", -185, 134, 44, 30, cc.color(35, 45, 95));
        this.label(gapMinus, "-", 0, 0, 22, white);
        const gapPlus = this.sprite(panel, "white", 185, 134, 44, 30, cc.color(35, 45, 95));
        this.label(gapPlus, "+", 0, 0, 22, white);
        const refreshGap = () => { (gapLabel.getComponent(cc.Label)).string = "TRACK GAP  " + this.rhythmGapText(); };
        gapMinus.on(cc.Node.EventType.TOUCH_END, () => { this.changeRhythmGap(-1); refreshGap(); });
        gapPlus.on(cc.Node.EventType.TOUCH_END, () => { this.changeRhythmGap(1); refreshGap(); });

        const speedLabel = this.label(panel, "FLOW SPEED  " + this.rhythmSpeedText(), 0, 100, 16, cyan);
        const speedMinus = this.sprite(panel, "white", -185, 100, 44, 30, cc.color(35, 45, 95));
        this.label(speedMinus, "-", 0, 0, 22, white);
        const speedPlus = this.sprite(panel, "white", 185, 100, 44, 30, cc.color(35, 45, 95));
        this.label(speedPlus, "+", 0, 0, 22, white);
        const refreshSpeed = () => { (speedLabel.getComponent(cc.Label)).string = "FLOW SPEED  " + this.rhythmSpeedText(); };
        speedMinus.on(cc.Node.EventType.TOUCH_END, () => { this.changeRhythmSpeedScale(-1); refreshSpeed(); });
        speedPlus.on(cc.Node.EventType.TOUCH_END, () => { this.changeRhythmSpeedScale(1); refreshSpeed(); });
        this.label(panel, "flow speed changes both run speed and note spacing", 0, 76, 13, dim);

        const songs = this.rhythmSongs || [];
        const pageSize = this.rhythmSongsPerPage;
        const totalPages = Math.max(1, Math.ceil(songs.length / pageSize));
        if (this.rhythmSongPage < 0) this.rhythmSongPage = totalPages - 1;
        if (this.rhythmSongPage >= totalPages) this.rhythmSongPage = 0;
        const page = this.rhythmSongPage;
        const first = page * pageSize;
        const shown = songs.slice(first, first + pageSize);

        if (!songs.length) {
            this.label(panel, "No rhythm songs found.", 0, 14, 18, white);
            this.label(panel, "Put .tja + audio files in tools/charts, then run import.", 0, -16, 14, dim);
        }

        for (let i = 0; i < shown.length; i++) {
            const song = shown[i];
            const y = 42 - i * 38;
            const btn = this.sprite(panel, "white", 0, y, 460, 36, cc.color(24, 34, 76));
            this.sprite(btn, "white", 0, -17, 460, 3, cyan);
            const title = String(song.title || song.id || ("SONG " + (first + i + 1)));
            const clipped = title.length > 24 ? title.substr(0, 23) + "…" : title;
            this.label(btn, clipped, -210, 0, 18, white, 0);
            this.label(btn, ((song.difficulties || []).length || 0) + " difficulties", 210, 0, 14, dim, 1);
            btn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                this.buildRhythmDifficultyPanel(song);
            });
        }

        const pageText = songs.length ? ("PAGE " + (page + 1) + " / " + totalPages + "    " + songs.length + " songs") : "";
        this.label(panel, pageText, 0, -152, 14, dim);

        const prevBtn = this.sprite(panel, "white", -125, -152, 94, 34, cc.color(35, 45, 95));
        this.label(prevBtn, "PREV", 0, 0, 15, white);
        prevBtn.opacity = totalPages > 1 ? 255 : 110;
        prevBtn.on(cc.Node.EventType.TOUCH_END, () => {
            if (totalPages <= 1) return;
            Sfx.play("click", 0.8);
            this.rhythmSongPage--;
            this.closePanels();
            this.buildRhythmSongPanel();
        });
        const nextBtn = this.sprite(panel, "white", 125, -152, 94, 34, cc.color(35, 45, 95));
        this.label(nextBtn, "NEXT", 0, 0, 15, white);
        nextBtn.opacity = totalPages > 1 ? 255 : 110;
        nextBtn.on(cc.Node.EventType.TOUCH_END, () => {
            if (totalPages <= 1) return;
            Sfx.play("click", 0.8);
            this.rhythmSongPage++;
            this.closePanels();
            this.buildRhythmSongPanel();
        });

        const closeBtn = this.sprite(panel, "white", 0, -198, 160, 40, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    private buildRhythmDifficultyPanel(song: any) {
        this.closePanels();
        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const dim = cc.color(110, 120, 150);
        const panel = this.buildRhythmBasePanel(song.title || "RHYTHM SONG");
        this.label(panel, "Choose difficulty", 0, 164, 16, dim);

        const diffs = song.difficulties || [];
        for (let i = 0; i < diffs.length && i < 7; i++) {
            const d = diffs[i];
            const y = 118 - i * 48;
            const btn = this.sprite(panel, "white", 0, y, 420, 40, cc.color(80, 38, 66));
            this.sprite(btn, "white", 0, -19, 420, 3, orange);
            this.label(btn, d.name || ("DIFFICULTY " + (i + 1)), 0, 0, 18, white);
            btn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                this.rhythmLaunch(d);
            });
        }

        const backBtn = this.sprite(panel, "white", -90, -190, 150, 40, cc.color(35, 45, 95));
        this.label(backBtn, "BACK", 0, 0, 18, white);
        backBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
            this.buildRhythmSongPanel();
        });
        const closeBtn = this.sprite(panel, "white", 90, -190, 150, 40, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    // ---------- settings panel ----------

    private closePanels() {
        if (this.settingsPanel) { this.settingsPanel.destroy(); this.settingsPanel = null; }
        if (this.accountPanel) { this.accountPanel.destroy(); this.accountPanel = null; }
        if (this.boardPanel) { this.boardPanel.destroy(); this.boardPanel = null; }
        if (this.savesPanel) { this.savesPanel.destroy(); this.savesPanel = null; }
        if (this.helpPanel) { this.helpPanel.destroy(); this.helpPanel = null; }
        if (this.rhythmPanel) { this.rhythmPanel.destroy(); this.rhythmPanel = null; }
        if (this.keyBindPanel) { this.keyBindPanel.destroy(); this.keyBindPanel = null; }
        this.keyBindKind = "";
        this.keyBindMode = "";
        this.keyBindStatus = null;
    }

    private anyPanelOpen(): boolean {
        return !!(this.settingsPanel || this.accountPanel || this.boardPanel
            || this.savesPanel || this.helpPanel || this.rhythmPanel || this.keyBindPanel);
    }

    private toggleSettings() {
        if (this.settingsPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();
        this.buildSettingsPanel();
    }

    private buildSettingsPanel() {
        const white = cc.color(235, 240, 255);
        const cyan = cc.color(127, 247, 255);
        const orange = cc.color(255, 181, 74);

        const panel = this.sprite(this.node, "white", 0, 0, 600, 610, cc.color(10, 12, 26));
        panel.opacity = 245;
        panel.zIndex = 50;
        this.settingsPanel = panel;
        // swallow clicks behind the panel
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => { e.stopPropagation(); });

        this.label(panel, "SETTINGS", 0, 268, 30, orange);
        this.label(panel, "click a row to change", 0, 236, 14, cc.color(110, 120, 150));

        const s = GameData.settings;
        const pct = (v: number) => Math.round(v * 100) + "%";
        const rows: { name: string; value: () => string; next: () => void }[] = [
            {
                name: "SFX VOLUME",
                value: () => pct(s.sfx),
                next: () => { s.sfx = s.sfx >= 1 ? 0 : Math.min(1, s.sfx + 0.25); Sfx.play("crystal", 0.8); }
            },
            {
                name: "MUSIC VOLUME",
                value: () => pct(s.bgm),
                next: () => { s.bgm = s.bgm >= 1 ? 0 : Math.min(1, s.bgm + 0.2); Sfx.applyBgmVolume(); }
            },
            {
                name: "GAME SPEED",
                value: () => pct(s.speed),
                next: () => { s.speed = s.speed >= 1.4 ? 0.6 : Math.round((s.speed + 0.2) * 10) / 10; }
            },
            {
                name: "COLOR SCHEME",
                value: () => SCHEMES[s.scheme].name,
                next: () => { s.scheme = (s.scheme + 1) % SCHEMES.length; this.applyBgTint(); }
            },
            {
                name: "BRIGHTNESS",
                value: () => pct(s.brightness),
                next: () => { s.brightness = s.brightness <= 0.6 ? 1 : Math.round((s.brightness - 0.2) * 10) / 10; this.applyBgTint(); }
            },
            {
                name: "RHYTHM TRACK GAP",
                value: () => this.rhythmGapText(),
                next: () => { this.changeRhythmGap(1); }
            },
            {
                name: "RHYTHM FLOW SPEED",
                value: () => this.rhythmSpeedText(),
                next: () => { this.changeRhythmSpeedScale(1); }
            },
            {
                name: "RHYTHM JUMP KEYS",
                value: () => this.rhythmJumpKeyText(),
                next: () => { this.closePanels(); this.buildRhythmKeyPanel("jump"); }
            },
            {
                name: "RHYTHM FLIP KEYS",
                value: () => this.rhythmFlipKeyText(),
                next: () => { this.closePanels(); this.buildRhythmKeyPanel("flip"); }
            }
        ];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const y = 188 - i * 42;
            const rowNode = this.sprite(panel, "white", 0, y, 520, 40, cc.color(24, 34, 76));
            this.label(rowNode, row.name, -240, 0, 17, white, 0);
            const valNode = this.label(rowNode, row.value(), 240, 0, 17, cyan, 1);
            rowNode.on(cc.Node.EventType.TOUCH_END, () => {
                row.next();
                GameData.saveSettings();
                if (valNode && valNode.isValid) (valNode.getComponent(cc.Label)).string = row.value();
            });
        }

        const closeBtn = this.sprite(panel, "white", 0, -278, 160, 36, cc.color(70, 30, 50));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleSettings();
        });
    }

    private setRhythmKey(kind: string, keyName: string, append: boolean) {
        const fallback = kind === "jump" ? "f,j" : "d,k";
        const cur = this.normalizeKeyList(kind === "jump" ? GameData.settings.rhythmJumpKeys : GameData.settings.rhythmFlipKeys, fallback);
        let keys = append ? cur.split(",") : [];
        if (keys.indexOf(keyName) < 0) keys.push(keyName);
        const value = this.normalizeKeyList(keys.join(","), fallback);
        if (kind === "jump") GameData.settings.rhythmJumpKeys = value;
        else GameData.settings.rhythmFlipKeys = value;
        GameData.saveSettings();
        Sfx.play("crystal", 0.7);
    }

    private buildRhythmKeyPanel(kind: string) {
        this.closePanels();
        const white = cc.color(235, 240, 255);
        const cyan = cc.color(127, 247, 255);
        const orange = cc.color(255, 181, 74);
        const dim = cc.color(110, 120, 150);
        const panel = this.sprite(this.node, "white", 0, 0, 560, 430, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 60;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.keyBindPanel = panel;
        this.label(panel, kind === "jump" ? "SET JUMP KEYS" : "SET FLIP KEYS", 0, 178, 30, orange);
        const current = this.label(panel, "CURRENT  " + (kind === "jump" ? this.rhythmJumpKeyText() : this.rhythmFlipKeyText()), 0, 136, 18, cyan);
        this.keyBindStatus = this.label(panel, "Click a button, then press any keyboard key.", 0, 100, 15, dim).getComponent(cc.Label);

        const refresh = () => {
            if (current && current.isValid) {
                (current.getComponent(cc.Label)).string = "CURRENT  " + (kind === "jump" ? this.rhythmJumpKeyText() : this.rhythmFlipKeyText());
            }
        };
        const arm = (mode: string) => {
            this.keyBindKind = kind;
            this.keyBindMode = mode;
            if (this.keyBindStatus) this.keyBindStatus.string = (mode === "replace" ? "Press a key to replace this binding..." : "Press a key to add to this binding...");
            Sfx.play("click", 0.7);
        };

        const replaceBtn = this.sprite(panel, "white", -115, 48, 210, 42, cc.color(24, 34, 76));
        this.label(replaceBtn, "REPLACE NEXT KEY", 0, 0, 16, white);
        replaceBtn.on(cc.Node.EventType.TOUCH_END, () => arm("replace"));
        const addBtn = this.sprite(panel, "white", 115, 48, 210, 42, cc.color(24, 34, 76));
        this.label(addBtn, "ADD NEXT KEY", 0, 0, 16, white);
        addBtn.on(cc.Node.EventType.TOUCH_END, () => arm("add"));

        const clearBtn = this.sprite(panel, "white", -115, -12, 210, 38, cc.color(80, 38, 66));
        this.label(clearBtn, "RESET DEFAULT", 0, 0, 16, white);
        clearBtn.on(cc.Node.EventType.TOUCH_END, () => {
            if (kind === "jump") GameData.settings.rhythmJumpKeys = "f,j";
            else GameData.settings.rhythmFlipKeys = "d,k";
            GameData.saveSettings();
            refresh();
            if (this.keyBindStatus) this.keyBindStatus.string = "Reset.";
            Sfx.play("click", 0.7);
        });
        const oneKeyBtn = this.sprite(panel, "white", 115, -12, 210, 38, cc.color(80, 38, 66));
        this.label(oneKeyBtn, "USE ONE KEY", 0, 0, 16, white);
        oneKeyBtn.on(cc.Node.EventType.TOUCH_END, () => arm("replace"));

        this.label(panel, "Tip: use ADD NEXT KEY to keep multiple keys, like F / J.", 0, -66, 14, dim);

        const backBtn = this.sprite(panel, "white", -90, -162, 150, 40, cc.color(35, 45, 95));
        this.label(backBtn, "BACK", 0, 0, 18, white);
        backBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
            this.buildSettingsPanel();
        });
        const closeBtn = this.sprite(panel, "white", 90, -162, 150, 40, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    // ---------- account & leaderboard panels ----------

    private refreshAccount() {
        if (this.accountLabel && this.accountLabel.isValid) {
            const lb = this.accountLabel.getComponent(cc.Label);
            lb.string = !Fb.enabled() ? "OFFLINE MODE"
                : Fb.user() ? "PLAYER: " + Fb.userName()
                : "NOT LOGGED IN";
        }
        if (this.accountStatus && this.accountStatus.isValid) {
            const lb = this.accountStatus.getComponent(cc.Label);
            if (Fb.user()) lb.string = "logged in as " + Fb.userName();
        }
    }

    private editBox(parent: cc.Node, x: number, y: number, w: number, placeholder: string, password: boolean): cc.EditBox {
        const n = new cc.Node("eb");
        n.setPosition(x, y);
        n.setContentSize(w, 42);
        const eb = n.addComponent(cc.EditBox);
        eb.backgroundImage = this.frames["white"];
        eb.placeholder = placeholder;
        eb.maxLength = 60;
        eb.fontSize = 18;
        eb.placeholderFontSize = 16;
        if (password) eb.inputFlag = cc.EditBox.InputFlag.PASSWORD;
        parent.addChild(n);
        return eb;
    }

    private toggleAccount() {
        if (this.accountPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();

        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const dim = cc.color(110, 120, 150);

        const panel = this.sprite(this.node, "white", 0, 0, 560, 440, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.accountPanel = panel;

        this.label(panel, "ACCOUNT", 0, 185, 30, orange);

        if (!Fb.enabled()) {
            this.label(panel, "Online features are disabled.", 0, 80, 18, white);
            this.label(panel, "Paste the Firebase web config into", 0, 40, 16, dim);
            this.label(panel, "assets/scripts/FbConfig.ts to enable them.", 0, 14, 16, dim);
        } else {
            const email = this.editBox(panel, 0, 110, 380, "email", false);
            const pw = this.editBox(panel, 0, 50, 380, "password (6+ chars)", true);
            this.accountStatus = this.label(panel, "", 0, -150, 16, orange);
            const status = (s: string) => {
                (this.accountStatus.getComponent(cc.Label)).string = s;
            };
            const act = (fn: (e: string, p: string, cb: (err: string) => void) => void) => {
                const em = email.string.trim();
                const pp = pw.string;
                if (!em || !pp) return status("enter email and password");
                status("...");
                fn(em, pp, (err) => {
                    status(err ? err : "OK!");
                    this.refreshAccount();
                });
            };
            const lBtn = this.sprite(panel, "white", -95, -20, 170, 44, cc.color(20, 70, 40));
            this.label(lBtn, "LOG IN", 0, 0, 18, white);
            lBtn.on(cc.Node.EventType.TOUCH_END, () => act(Fb.login));
            const rBtn = this.sprite(panel, "white", 95, -20, 170, 44, cc.color(40, 30, 70));
            this.label(rBtn, "REGISTER", 0, 0, 18, white);
            rBtn.on(cc.Node.EventType.TOUCH_END, () => act(Fb.register));
            const oBtn = this.sprite(panel, "white", 0, -80, 170, 40, cc.color(70, 25, 35));
            this.label(oBtn, "LOG OUT", 0, 0, 16, white);
            oBtn.on(cc.Node.EventType.TOUCH_END, () => {
                Fb.logout();
                status("logged out");
                this.refreshAccount();
            });
            this.label(panel, "progress + endless best sync to your account", 0, -120, 14, dim);
            this.refreshAccount();
        }

        const closeBtn = this.sprite(panel, "white", 0, -185, 160, 40, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    // ---------- how to play panel ----------

    private toggleHelp() {
        if (this.helpPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();

        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const cyan = cc.color(127, 247, 255);
        const dim = cc.color(150, 160, 190);

        const panel = this.sprite(this.node, "white", 0, 0, 700, 580, cc.color(10, 12, 26));
        panel.opacity = 250;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.helpPanel = panel;

        this.label(panel, "HOW TO PLAY", 0, 258, 28, orange);

        const row = (y: number, key: string, desc: string, keyColor: cc.Color) => {
            this.label(panel, key, -320, y, 17, keyColor, 0);
            this.label(panel, desc, -110, y, 16, white, 0);
        };
        this.label(panel, "— CONTROLS (P1 / P2 in co-op) —", 0, 218, 15, dim);
        row(184, "SPACE / W   |   UP", "FLIP GRAVITY (only while on a surface)", cyan);
        row(152, "D   |   RIGHT", "DASH - speed burst x1.55 (2.5s cooldown)", cyan);
        row(120, "A   |   LEFT", "BRAKE - slow to x0.55, for timing pistons", cyan);
        row(88, "S   |   DOWN", "SLAM - instant drop while airborne", cyan);
        row(56, "R / ESC / Q", "restart / pause / quit to menu (paused)", cyan);
        this.label(panel, "2P: P1 starts on the FLOOR, P2 on the CEILING — and you bounce off each other!",
            0, 32, 13, dim);

        this.label(panel, "— PICKUPS & HAZARDS —", 0, 12, 15, dim);
        const icon = (x: number, y: number, frame: string, desc: string) => {
            const ic = this.sprite(panel, frame, x, y, 30, 30);
            this.label(panel, desc, x + 25, y, 14, white, 0);
            return ic;
        };
        icon(-320, -26, "shield", "SHIELD: survive one hit");
        icon(-320, -62, "slow", "SLOW-MO: everything 4s slower");
        icon(-320, -98, "magnet", "MAGNET: pulls crystals 6s");
        icon(40, -26, "crystal", "CRYSTAL: collect them all");
        icon(40, -62, "drone", "DRONE: deadly patrol, time your flip");
        const tp = icon(40, -98, "tport", "TELEPORTER: one-way jump");
        tp.color = cc.color(190, 120, 255);

        this.label(panel, "PISTONS (orange-edged bands) extend and retract — pass when retracted, or ride on top.",
            0, -150, 14, dim);
        this.label(panel, "Falling through a gap or touching spikes = death. Reach the portal column to clear the level.",
            0, -178, 14, dim);

        const closeBtn = this.sprite(panel, "white", 0, -240, 160, 40, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 17, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    // ---------- save states panel (mid-run saves; saving happens in-game) ----------

    private toggleSaves() {
        if (this.savesPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();
        this.buildSavesPanel(-1);
    }

    // confirmIdx: slot whose DEL is in the two-click "SURE?" stage
    private buildSavesPanel(confirmIdx: number) {
        if (this.savesPanel) { this.savesPanel.destroy(); this.savesPanel = null; }
        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const dim = cc.color(110, 120, 150);

        const panel = this.sprite(this.node, "white", 0, 0, 660, 540, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.savesPanel = panel;

        this.label(panel, "SAVE STATES", 0, 240, 26, orange);
        this.label(panel, Fb.user()
            ? "stored in your account — save from the in-game PAUSE menu"
            : "stored on this device — save from the in-game PAUSE menu", 0, 208, 13, dim);

        const states = Fb.getStates();
        let any = false;
        for (let i = 0; i < Fb.MAX_STATES; i++) {
            const st = states[i];
            const y = 158 - i * 56;
            const row = this.sprite(panel, "white", 0, y, 620, 46, cc.color(22, 30, 60));
            let text = "#" + (i + 1) + "   ";
            if (st) {
                any = true;
                const d = new Date(st.t || 0);
                const pad = (v: number) => (v < 10 ? "0" + v : "" + v);
                text += st.label + "   " + (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
            } else {
                text += "EMPTY";
            }
            this.label(row, text, -296, 0, 15, st ? white : dim, 0);
            if (!st) continue;

            const mk = (txt: string, x: number, color: cc.Color, cb: () => void) => {
                const b = this.sprite(row, "white", x, 0, 84, 32, color);
                this.label(b, txt, 0, 0, 13, white);
                b.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
                    e.stopPropagation();
                    Sfx.play("click", 0.7);
                    cb();
                });
            };
            const idx = i;
            mk("PLAY", 170, cc.color(20, 70, 40), () => {
                GameData.players = st.pl || 1;
                GameData.currentLevel = st.lv || 1;
                GameData.currentLevelPath = st.path || "";
                GameData.pendingState = st;
                Fx.fadeTo("Game", this.node);
            });
            if (confirmIdx === idx) {
                mk("SURE?", 265, cc.color(140, 40, 40), () => {
                    Fb.saveState(idx, null);
                    this.buildSavesPanel(-1);
                });
            } else {
                mk("DEL", 265, cc.color(70, 25, 35), () => this.buildSavesPanel(idx));
            }
        }
        if (!any) {
            this.label(panel, "no save states yet — pause during a level and pick SAVE / LOAD STATE",
                0, -190, 14, dim);
        }

        const closeBtn = this.sprite(panel, "white", 0, -240, 160, 38, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 17, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    private toggleBoard() {
        if (this.boardPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();

        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const cyan = cc.color(127, 247, 255);

        const panel = this.sprite(this.node, "white", 0, 0, 600, 610, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.boardPanel = panel;

        this.label(panel, "ENDLESS RANKING", 0, 195, 28, orange);
        const loading = this.label(panel, Fb.enabled() ? "loading..." : "offline mode — no online ranking", 0, 140, 16, white);

        Fb.fetchTop(10, (rows) => {
            if (!this.boardPanel || !this.boardPanel.isValid) return;
            if (!rows) {
                (loading.getComponent(cc.Label)).string = "could not load ranking";
                return;
            }
            loading.destroy();
            if (rows.length === 0) {
                this.label(panel, "no records yet — be the first!", 0, 140, 16, white);
            }
            for (let i = 0; i < rows.length && i < 10; i++) {
                const y = 150 - i * 32;
                this.label(panel, (i + 1) + ".", -220, y, 18, cyan, 0);
                this.label(panel, rows[i].name || "???", -180, y, 18, white, 0);
                this.label(panel, (rows[i].best || 0) + "m", 220, y, 18, orange, 1);
            }
        });

        const closeBtn = this.sprite(panel, "white", 0, -195, 160, 40, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    private onKeyDown(e: cc.Event.EventKeyboard) {
        if (this.keyBindPanel && this.keyBindKind && this.keyBindMode) {
            if (e.keyCode === cc.macro.KEY.escape) {
                this.keyBindKind = "";
                this.keyBindMode = "";
                if (this.keyBindStatus) this.keyBindStatus.string = "Canceled.";
                return;
            }
            const keyName = this.rhythmKeyNameFromCode(e.keyCode);
            this.setRhythmKey(this.keyBindKind, keyName, this.keyBindMode === "add");
            if (this.keyBindStatus) this.keyBindStatus.string = "Bound: " + keyName.toUpperCase();
            const kind = this.keyBindKind;
            this.keyBindKind = "";
            this.keyBindMode = "";
            if (this.keyBindPanel && this.keyBindPanel.isValid) {
                this.keyBindPanel.destroy();
                this.keyBindPanel = null;
                this.buildRhythmKeyPanel(kind);
            }
            return;
        }
        if (e.keyCode === cc.macro.KEY.space && !this.anyPanelOpen()) {
            GameData.currentLevelPath = "";
            GameData.currentLevel = 1;
            Fx.fadeTo("Game", this.node);
        }
        if (e.keyCode === cc.macro.KEY.escape && this.anyPanelOpen()) {
            this.closePanels();
        }
    }
}
