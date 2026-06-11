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
    private accountLabel: cc.Node = null;
    private accountStatus: cc.Node = null;

    onLoad() {
        Sfx.preload();
        Sfx.playBgm();
        Fb.init();
        Fb.onChanged = () => this.refreshAccount();
        cc.resources.loadDir("textures", cc.SpriteFrame, (err, assets: cc.SpriteFrame[]) => {
            if (err) {
                cc.error("texture load failed", err);
                return;
            }
            for (const a of assets) this.frames[a.name] = a;
            this.buildUi();
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
        Fx.fadeIn(this.node);

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
            GameData.currentLevel = -1;
            Fx.fadeTo("Game", this.node);
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

        this.hintLabel = this.label(this.node,
            "SPACE / W / UP : FLIP      R : RESTART      ESC : PAUSE      [SPACE = QUICK START]",
            0, -308, 15, dim);
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

    // ---------- settings panel ----------

    private closePanels() {
        if (this.settingsPanel) { this.settingsPanel.destroy(); this.settingsPanel = null; }
        if (this.accountPanel) { this.accountPanel.destroy(); this.accountPanel = null; }
        if (this.boardPanel) { this.boardPanel.destroy(); this.boardPanel = null; }
        if (this.savesPanel) { this.savesPanel.destroy(); this.savesPanel = null; }
    }

    private anyPanelOpen(): boolean {
        return !!(this.settingsPanel || this.accountPanel || this.boardPanel || this.savesPanel);
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

        const panel = this.sprite(this.node, "white", 0, 0, 560, 460, cc.color(10, 12, 26));
        panel.opacity = 245;
        panel.zIndex = 50;
        this.settingsPanel = panel;
        // swallow clicks behind the panel
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => { e.stopPropagation(); });

        this.label(panel, "SETTINGS", 0, 190, 30, orange);
        this.label(panel, "click a row to change", 0, 158, 14, cc.color(110, 120, 150));

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
                next: () => { s.speed = s.speed >= 1.2 ? 0.8 : Math.round((s.speed + 0.2) * 10) / 10; }
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
            }
        ];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const y = 100 - i * 56;
            const rowNode = this.sprite(panel, "white", 0, y, 480, 44, cc.color(24, 34, 76));
            this.label(rowNode, row.name, -220, 0, 18, white, 0);
            const valNode = this.label(rowNode, row.value(), 220, 0, 18, cyan, 1);
            rowNode.on(cc.Node.EventType.TOUCH_END, () => {
                row.next();
                GameData.saveSettings();
                (valNode.getComponent(cc.Label)).string = row.value();
            });
        }

        const closeBtn = this.sprite(panel, "white", 0, -190, 160, 40, cc.color(70, 30, 50));
        this.label(closeBtn, "CLOSE", 0, 0, 18, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.toggleSettings();
        });
    }

    // ---------- account & leaderboard panels ----------

    private refreshAccount() {
        if (this.accountLabel && this.accountLabel.isValid) {
            const lb = this.accountLabel.getComponent(cc.Label);
            const slot = Fb.activeSlotName();
            lb.string = !Fb.enabled() ? "OFFLINE MODE"
                : Fb.user() ? "PLAYER: " + Fb.userName() + (slot ? "  [" + slot + "]" : "")
                : "NOT LOGGED IN";
        }
        if (this.accountStatus && this.accountStatus.isValid) {
            const lb = this.accountStatus.getComponent(cc.Label);
            if (Fb.user()) lb.string = "logged in as " + Fb.userName();
        }
    }

    // cc.EditBox created via addComponent has NO internal background/label
    // nodes (the editor normally creates those), so build them explicitly.
    private editBox(parent: cc.Node, x: number, y: number, w: number, placeholder: string, password: boolean): cc.EditBox {
        const h = 44;
        const n = new cc.Node("eb");
        n.setPosition(x, y);
        n.setContentSize(w, h);
        parent.addChild(n);

        const bgN = new cc.Node("bg");
        const bg = bgN.addComponent(cc.Sprite);
        bg.spriteFrame = this.frames["white"];
        bg.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bgN.setContentSize(w, h);
        bgN.color = cc.color(28, 38, 80);
        n.addChild(bgN);

        const mkLabel = (name: string, color: cc.Color) => {
            const ln = new cc.Node(name);
            ln.setContentSize(w - 24, h);
            ln.anchorX = 0;
            ln.anchorY = 0.5;
            ln.setPosition(-w / 2 + 12, 0);
            ln.color = color;
            const lb = ln.addComponent(cc.Label);
            lb.string = "";
            lb.fontSize = 18;
            lb.lineHeight = h;
            lb.horizontalAlign = cc.Label.HorizontalAlign.LEFT;
            lb.verticalAlign = cc.Label.VerticalAlign.CENTER;
            lb.overflow = cc.Label.Overflow.CLAMP;
            n.addChild(ln);
            return lb;
        };
        const textLb = mkLabel("text", cc.color(235, 240, 255));
        const phLb = mkLabel("placeholder", cc.color(130, 140, 170));
        phLb.string = placeholder;

        const eb = n.addComponent(cc.EditBox);
        eb.background = bg;
        eb.textLabel = textLb;
        eb.placeholderLabel = phLb;
        eb.placeholder = placeholder;
        eb.maxLength = 60;
        if (password) eb.inputFlag = cc.EditBox.InputFlag.PASSWORD;
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

    // ---------- save slots panel ----------

    private toggleSaves() {
        if (this.savesPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();
        this.buildSavesPanel();
    }

    private buildSavesPanel() {
        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const cyan = cc.color(127, 247, 255);
        const dim = cc.color(110, 120, 150);

        const panel = this.sprite(this.node, "white", 0, 0, 620, 540, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.savesPanel = panel;

        this.label(panel, "SAVE SLOTS  (" + Fb.slotIds().length + "/8)", 0, 240, 26, orange);

        const closeBtn = this.sprite(panel, "white", 0, -240, 160, 38, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 17, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });

        if (!Fb.user()) {
            this.label(panel, "log in first (ACCOUNT panel)", 0, 40, 18, white);
            return;
        }

        const nameEb = this.editBox(panel, -90, 196, 300, "slot name (for NEW / REN)", false);
        const status = this.label(panel, "", 0, -205, 15, orange);
        const say = (s: string) => { (status.getComponent(cc.Label)).string = s || ""; };

        const newBtn = this.sprite(panel, "white", 180, 196, 130, 40, cc.color(20, 70, 40));
        this.label(newBtn, "+ NEW", 0, 0, 16, white);
        newBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            const err = Fb.createSlot(nameEb.string.trim());
            if (err) { say(err); return; }
            this.refreshAccount();
            this.closePanels();
            this.buildSavesPanel(); // re-render list
        });

        const ids = Fb.slotIds();
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const s = Fb.slots[id];
            const active = id === Fb.activeSlot;
            const y = 150 - i * 44;
            const row = this.sprite(panel, "white", 0, y, 580, 38,
                active ? cc.color(30, 60, 90) : cc.color(22, 30, 60));
            this.label(row, (active ? "> " : "") + s.name, -270, 0, 16, active ? cyan : white, 0);
            this.label(row, "Lv" + s.unlocked + "   " + s.best + "m", -60, 0, 14, dim, 0);
            const mk = (text: string, x: number, color: cc.Color, cb: () => void) => {
                const b = this.sprite(row, "white", x, 0, 62, 28, color);
                this.label(b, text, 0, 0, 12, white);
                b.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
                    e.stopPropagation();
                    Sfx.play("click", 0.7);
                    cb();
                });
            };
            mk("LOAD", 120, cc.color(20, 70, 40), () => {
                const err = Fb.loadSlot(id);
                if (err) { say(err); return; }
                // reload the menu so level locks / endless best reflect the slot
                cc.director.loadScene("Menu");
            });
            mk("SAVE", 190, cc.color(70, 55, 15), () => {
                const err = Fb.overwriteSlot(id);
                say(err ? err : "current progress saved to \"" + s.name + "\"");
                this.refreshAccount();
                this.closePanels();
                this.buildSavesPanel();
            });
            mk("REN", 258, cc.color(40, 30, 70), () => {
                const err = Fb.renameSlot(id, nameEb.string.trim());
                if (err) { say(err); return; }
                this.refreshAccount();
                this.closePanels();
                this.buildSavesPanel();
            });
        }

        this.label(panel,
            "LOAD = play this slot     SAVE = overwrite slot with current progress     REN = rename",
            0, -175, 13, dim);
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

        const panel = this.sprite(this.node, "white", 0, 0, 560, 460, cc.color(10, 12, 26));
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
        if (e.keyCode === cc.macro.KEY.space && !this.anyPanelOpen()) {
            GameData.currentLevel = 1;
            Fx.fadeTo("Game", this.node);
        }
        if (e.keyCode === cc.macro.KEY.escape && this.anyPanelOpen()) {
            this.closePanels();
        }
    }
}
