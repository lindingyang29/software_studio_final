import GameData from "./GameData";
import LevelBuilder, { SCHEMES } from "./LevelBuilder";
import Sfx from "./Sfx";

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

    onLoad() {
        Sfx.preload();
        Sfx.playBgm();
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

        this.bgNode = this.sprite(this.node, "bg", 0, 0, 970, 650);
        this.applyBgTint();

        // title
        const title = this.label(this.node, "GRAVITY FLIP RUNNER", 0, 230, 56, cyan);
        cc.tween(title)
            .to(1.4, { opacity: 170 }, { easing: "sineInOut" })
            .to(1.4, { opacity: 255 }, { easing: "sineInOut" })
            .repeatForever()
            .start();
        this.label(this.node, "— ESCAPE ASTRA-9 —", 0, 178, 18, orange);

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
            const btn = this.sprite(this.node, "white", x, 126, 130, 44, cc.color(24, 34, 76));
            this.label(btn, m === 1 ? "1 PLAYER" : "2 PLAYERS", 0, 0, 18, white);
            btn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                GameData.players = m;
                this.refreshModeButtons();
            });
            this.modeButtons.push(btn);
        }
        this.refreshModeButtons();

        // level buttons
        const unlocked = GameData.getUnlocked();
        for (let i = 1; i <= GameData.MAX_LEVEL; i++) {
            const open = i <= unlocked;
            const y = 64 - (i - 1) * 56;
            const btn = this.sprite(this.node, "white", 0, y, 260, 48, open ? cc.color(24, 34, 76) : cc.color(22, 24, 34));
            this.sprite(this.node, "white", 0, y - 23, 260, 3, open ? cyan : dim);
            this.label(btn, open ? "LEVEL " + i : "LEVEL " + i + "  [LOCKED]", 0, 0, 20, open ? white : dim);
            if (open) {
                btn.on(cc.Node.EventType.TOUCH_END, () => {
                    Sfx.play("click", 0.8);
                    GameData.currentLevel = i;
                    cc.director.loadScene("Game");
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
            cc.director.loadScene("Editor");
        });

        this.hintLabel = this.label(this.node,
            "SPACE / W / UP : FLIP      R : RESTART      ESC : PAUSE      [SPACE = QUICK START]",
            0, -286, 15, dim);
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

    private toggleSettings() {
        if (this.settingsPanel) {
            this.settingsPanel.destroy();
            this.settingsPanel = null;
            return;
        }
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

    private onKeyDown(e: cc.Event.EventKeyboard) {
        if (e.keyCode === cc.macro.KEY.space && !this.settingsPanel) {
            GameData.currentLevel = 1;
            cc.director.loadScene("Game");
        }
        if (e.keyCode === cc.macro.KEY.escape && this.settingsPanel) {
            this.toggleSettings();
        }
    }
}
