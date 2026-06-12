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
    // online room lobby
    private roomPanel: cc.Node = null;
    private myRoom = "";
    private roomIsHost = false;
    private roomLaunched = false;
    private lastRooms: { uid: string; name: string; room: any }[] = [];
    private lastMembers: { uid: string; name: string; code: string }[] = [];
    private roomMembersBox: cc.Node = null;
    private roomStatus: cc.Label = null;
    private rhythmPanel: cc.Node = null;
    private keyBindPanel: cc.Node = null;
    private keyBindKind = "";
    private keyBindMode = "";
    private keyBindStatus: cc.Label = null;
    private accountLabel: cc.Node = null;
    private accountStatus: cc.Node = null;
    private gatePassed = false;
    private readonly gateKey = "gfr_auth_gate";
    private authOverlay: HTMLElement = null;
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
        this.gatePassed = this.getGate();
        Fb.init();
        // back in the menu: any previous room participation ends here
        GameData.roomCode = "";
        GameData.roomT0 = 0;
        Fb.leaveRoom();
        // When cloud slot data arrives after the scene was built (e.g. right
        // after the post-login reload), the level locks / best distance shown
        // are stale — rebuild the UI instead of just refreshing the label.
        Fb.onChanged = () => {
            if (Fx.isFading()) return;
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
        cc.director.preloadScene(this.isStartScene() ? "Menu" : "Game");
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        Fb.onChanged = null;
        this.removeAuthOverlay();
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

    private rotatingBlock(frame: string, x: number, y: number, size: number, color: cc.Color, spinTime: number, floatAmp: number = 0): cc.Node {
        const n = this.sprite(this.node, frame, x, y, size, size, color);
        cc.tween(n).by(spinTime, { angle: 360 }).repeatForever().start();
        if (floatAmp > 0) {
            cc.tween(n)
                .to(spinTime * 0.45, { y: y + floatAmp }, { easing: "sineInOut" })
                .to(spinTime * 0.45, { y: y - floatAmp }, { easing: "sineInOut" })
                .to(spinTime * 0.45, { y: y }, { easing: "sineInOut" })
                .repeatForever()
                .start();
        }
        return n;
    }

    private progressSig(): string {
        return (Fb.ready() ? "ready" : "loading") + "|" + (Fb.user() ? Fb.uid() : "guest")
            + "|" + (this.isStartScene() ? "start" : "menu")
            + "|" + GameData.getUnlocked() + "|" + GameData.getBestDist();
    }

    private getGate(): boolean {
        if (!cc.sys.isBrowser || !(window as any).sessionStorage) return false;
        return (window as any).sessionStorage.getItem(this.gateKey) === "1";
    }

    private saveGate() {
        if (cc.sys.isBrowser && (window as any).sessionStorage) {
            (window as any).sessionStorage.setItem(this.gateKey, "1");
        }
    }

    private clearGate() {
        if (cc.sys.isBrowser && (window as any).sessionStorage) {
            (window as any).sessionStorage.removeItem(this.gateKey);
        }
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
        const authStart = this.isStartScene();
        const title = this.sprite(this.node, "title", 0, authStart ? 78 : 234, authStart ? 420 : 330, authStart ? 280 : 220);
        title.scale = 0;
        title.opacity = 255;
        cc.tween(title)
            .to(0.6, { scale: 1 }, { easing: "backOut" })
            .call(() => {
                cc.tween(title)
                    .repeatForever(
                        cc.tween()
                            .to(0.55, { opacity: 90 }, { easing: "sineInOut" })
                            .to(0.55, { opacity: 255 }, { easing: "sineInOut" })
                    )
                    .start();
            })
            .start();

        // opening animation: a runner cube dashes across the screen
        const opener = this.sprite(this.node, "player", -560, -150, 40, 40);
        cc.tween(opener)
            .to(1.1, { x: 560 })
            .call(() => opener.destroy())
            .start();
        cc.tween(opener).by(1.1, { angle: -720 }).start();

        if (authStart) {
            this.buildStartAuthScreen();
            this.uiSig = this.progressSig();
            return;
        }

        // decorations
        this.rotatingBlock("player", -380, 76, 48, null, 1.8, 18);
        this.rotatingBlock("player2", 410, -78, 42, null, 1.4, 12);
        const deco2 = this.sprite(this.node, "player2", -340, -40, 40, 40);
        deco2.scaleY = -1;
        cc.tween(deco2)
            .to(1.5, { y: -65 }, { easing: "sineInOut" })
            .to(1.5, { y: -40 }, { easing: "sineInOut" })
            .repeatForever()
            .start();
        cc.tween(deco2).by(1.8, { angle: -360 }).repeatForever().start();
        this.rotatingBlock("crystal", 338, -28, 30, null, 2.4, 0);
        this.rotatingBlock("player2", -430, 170, 20, null, 1.7, 8);
        this.rotatingBlock("player", 430, -154, 20, null, 2.0, 10);
        this.rotatingBlock("player2", -410, -160, 18, null, 1.5, 8);
        this.rotatingBlock("crystal", 260, 174, 18, null, 2.2, 8);
        this.rotatingBlock("player", -250, 246, 18, null, 1.9, 6);
        this.rotatingBlock("player2", 452, 232, 18, null, 1.6, 6);
        this.rotatingBlock("crystal", -452, -244, 18, null, 2.2, 7);
        this.rotatingBlock("player2", 320, -262, 16, null, 1.5, 6);

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

        // account / saves / ranking / room / logout row
        const mkBottom = (text: string, x: number, color: cc.Color, cb: () => void) => {
            const b = this.sprite(this.node, "white", x, -272, 118, 38, color);
            this.label(b, text, 0, 0, 14, white);
            b.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                cb();
            });
        };
        mkBottom("ACCOUNT", -256, cc.color(35, 45, 95), () => this.toggleAccount());
        mkBottom("SAVES", -128, cc.color(35, 45, 95), () => this.toggleSaves());
        mkBottom("RANKING", 0, cc.color(35, 45, 95), () => this.toggleBoard());
        mkBottom("ROOM", 128, cc.color(58, 26, 84), () => this.toggleRoom());
        mkBottom("LOG OUT", 256, cc.color(70, 25, 35), () => this.logoutToStart());

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

    private shouldShowMainMenu(): boolean {
        return !this.isStartScene();
    }

    private isStartScene(): boolean {
        const s: any = cc.director.getScene();
        if (s) {
            if (s._id === "5a9a0499-a12e-4f3d-ad54-ff8fe9abfbd5") return true;
            if (s._id === "d7c6863d-a130-454f-9ef3-2c70b659103a") return false;
            if (s.name === "Start") return true;
            if (s.name === "Menu") return false;
        }
        return (window as any).__gfrSceneHint === "Start";
    }

    private buildStartAuthScreen() {
        const cyan = cc.color(127, 247, 255);
        const orange = cc.color(255, 181, 74);
        const white = cc.color(235, 240, 255);
        const dim = cc.color(110, 120, 150);

        this.rotatingBlock("player", -360, 54, 48, null, 1.8, 20);
        this.rotatingBlock("player2", 360, 46, 42, null, 1.4, 14);
        this.rotatingBlock("crystal", 330, -78, 30, null, 2.4, 0);
        this.rotatingBlock("player2", 246, 154, 18, null, 1.7, 8);
        this.rotatingBlock("player", 430, -174, 20, null, 2.0, 10);
        this.rotatingBlock("player2", -420, -118, 18, null, 1.5, 8);
        this.rotatingBlock("crystal", -250, 164, 18, null, 2.2, 8);
        this.rotatingBlock("player", -236, 248, 18, null, 1.9, 6);
        this.rotatingBlock("player2", 446, 234, 18, null, 1.6, 6);
        this.rotatingBlock("crystal", -452, -244, 18, null, 2.2, 7);
        this.rotatingBlock("player2", 322, -262, 16, null, 1.5, 6);

        if (!Fb.enabled()) {
            this.label(this.node, "Firebase is not configured.", 0, -12, 18, white);
            this.label(this.node, "Online account progress is unavailable.", 0, -42, 15, dim);
            const offlineBtn = this.sprite(this.node, "white", 0, -118, 180, 42, cc.color(35, 45, 95));
            this.label(offlineBtn, "PLAY OFFLINE", 0, 0, 17, white);
            offlineBtn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                this.rebuildUi();
            });
            return;
        }

        if (!Fb.ready()) {
            this.label(this.node, "CONNECTING TO FIREBASE...", 0, -24, 18, white);
            return;
        }

        const lBtn = this.sprite(this.node, "white", -96, -132, 170, 42, cc.color(20, 70, 40));
        this.label(lBtn, "LOG IN", 0, 0, 18, white);
        lBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.openAuthOverlay("login");
        });
        const rBtn = this.sprite(this.node, "white", 96, -132, 170, 42, cc.color(40, 30, 70));
        this.label(rBtn, "REGISTER", 0, 0, 18, white);
        rBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.openAuthOverlay("register");
        });
    }

    private openAuthOverlay(mode: string) {
        if (!cc.sys.isBrowser || typeof document === "undefined") {
            this.buildAuthForm(mode);
            return;
        }
        this.removeAuthOverlay();

        const registering = mode === "register";
        const accent = registering ? "#281e46" : "#144628";
        const accentLight = registering ? "#70cff0" : "#78e6a0";

        const backdrop = document.createElement("div");
        backdrop.style.cssText = [
            "position:fixed",
            "left:0",
            "top:0",
            "width:100%",
            "height:100%",
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "background:rgba(0,0,0,0.68)",
            "z-index:9999",
            "font-family:monospace"
        ].join(";");

        const card = document.createElement("div");
        card.style.cssText = [
            "width:360px",
            "max-width:86vw",
            "background:#0a0c1a",
            "border:2px solid #5fe1eb",
            "box-shadow:0 12px 44px rgba(0,0,0,0.65)",
            "padding:30px 34px 28px"
        ].join(";");

        const title = document.createElement("div");
        title.textContent = registering ? "REGISTER" : "LOG IN";
        title.style.cssText = "color:#ffb54a;font-size:28px;text-align:center;letter-spacing:3px;margin-bottom:22px";
        card.appendChild(title);

        const email = this.mkDomInput(card, "EMAIL", "email", "email");
        const pass = this.mkDomInput(card, "PASSWORD", "password", "password");

        const status = document.createElement("div");
        status.style.cssText = "min-height:20px;color:#ffb54a;font-size:13px;text-align:center;margin:4px 0 10px";
        card.appendChild(status);

        const submit = document.createElement("button");
        submit.textContent = registering ? "REGISTER" : "LOG IN";
        submit.style.cssText = [
            "width:100%",
            "height:44px",
            "background:" + accent,
            "border:2px solid " + accentLight,
            "color:#ebf0ff",
            "font-family:monospace",
            "font-size:18px",
            "letter-spacing:2px",
            "cursor:pointer"
        ].join(";");
        card.appendChild(submit);

        const cancel = document.createElement("button");
        cancel.textContent = "CANCEL";
        cancel.style.cssText = [
            "width:100%",
            "height:34px",
            "margin-top:9px",
            "background:transparent",
            "border:1px solid #4d5269",
            "color:#9ca5c6",
            "font-family:monospace",
            "font-size:14px",
            "letter-spacing:1px",
            "cursor:pointer"
        ].join(";");
        card.appendChild(cancel);

        backdrop.appendChild(card);
        document.body.appendChild(backdrop);
        this.authOverlay = backdrop;

        const doSubmit = () => {
            const em = email.value.trim();
            const pp = pass.value;
            if (!em || !pp) {
                status.textContent = "enter email and password";
                return;
            }
            status.textContent = registering ? "creating account..." : "logging in...";
            submit.setAttribute("disabled", "true");
            if (registering) {
                GameData.setUnlocked(1);
                GameData.setBestDist(0);
            }
            Fb.noReloadOnNextAuthChange();
            const fn = registering ? Fb.register : Fb.login;
            fn(em, pp, (err) => {
                if (err) {
                    status.textContent = err;
                    submit.removeAttribute("disabled");
                    return;
                }
                status.textContent = registering ? "saved to Firebase. loading..." : "loading your progress...";
                this.removeAuthOverlay();
                Fx.fadeTo("Menu", this.node);
            });
        };

        submit.onclick = doSubmit;
        cancel.onclick = () => this.removeAuthOverlay();
        email.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                pass.focus();
            }
        });
        pass.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                doSubmit();
            }
        });
        window.setTimeout(() => email.focus(), 50);
    }

    private mkDomInput(parent: HTMLElement, label: string, type: string, placeholder: string): HTMLInputElement {
        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-bottom:16px";
        const lb = document.createElement("label");
        lb.textContent = label;
        lb.style.cssText = "display:block;color:#96a5dc;font-size:14px;letter-spacing:1px;margin-bottom:6px";
        const input = document.createElement("input");
        input.type = type;
        input.placeholder = placeholder;
        input.style.cssText = [
            "box-sizing:border-box",
            "width:100%",
            "height:40px",
            "padding:0 14px",
            "background:#70cfd8",
            "border:0",
            "outline:none",
            "color:#081024",
            "font-family:monospace",
            "font-size:20px"
        ].join(";");
        wrap.appendChild(lb);
        wrap.appendChild(input);
        parent.appendChild(wrap);
        return input;
    }

    private removeAuthOverlay() {
        if (this.authOverlay && this.authOverlay.parentNode) {
            this.authOverlay.parentNode.removeChild(this.authOverlay);
        }
        this.authOverlay = null;
    }

    private buildAuthForm(mode: string) {
        this.closePanels();
        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const dim = cc.color(110, 120, 150);

        const panel = this.sprite(this.node, "white", 0, -20, 520, 330, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.accountPanel = panel;

        const registering = mode === "register";
        this.label(panel, registering ? "REGISTER" : "LOG IN", 0, 126, 30, orange);
        this.label(panel, registering ? "Create a Firebase account." : "Load your Firebase progress.", 0, 92, 15, dim);
        this.label(panel, "EMAIL", -188, 66, 13, cc.color(150, 165, 220), 0);
        this.authFieldBg(panel, 0, 40, 384, 34);
        const email = this.authEditBox(panel, 0, 40, 360, "email", false);
        this.label(panel, "PASSWORD", -188, 8, 13, cc.color(150, 165, 220), 0);
        this.authFieldBg(panel, 0, -18, 384, 34);
        const pw = this.authEditBox(panel, 0, -18, 360, "password (6+ chars)", true);
        this.accountStatus = this.label(panel, "", 0, -126, 15, orange);
        const status = (s: string) => {
            if (this.accountStatus && this.accountStatus.isValid) {
                (this.accountStatus.getComponent(cc.Label)).string = s;
            }
        };
        const submit = () => {
            const em = email.value().trim();
            const pp = pw.value();
            if (!em || !pp) return status("enter email and password");
            status(registering ? "creating account..." : "logging in...");
            if (registering) {
                GameData.setUnlocked(1);
                GameData.setBestDist(0);
            }
            const fn = registering ? Fb.register : Fb.login;
            fn(em, pp, (err) => {
                if (err) {
                    status(err);
                    return;
                }
                this.gatePassed = true;
                this.saveGate();
                status(registering ? "saved to Firebase. loading..." : "loading your progress...");
                this.scheduleOnce(() => this.rebuildUi(), 0.15);
            });
        };
        email.box.returnType = cc.EditBox.KeyboardReturnType.NEXT;
        pw.box.returnType = cc.EditBox.KeyboardReturnType.DONE;
        email.box.node.on("text-changed", () => {
            if (email.value().indexOf("\n") < 0 && email.value().indexOf("\r") < 0) return;
            email.setValue(email.value().replace(/[\r\n]/g, ""));
            this.scheduleOnce(() => pw.focus(), 0);
        });
        pw.box.node.on("text-changed", () => {
            if (pw.value().indexOf("\n") < 0 && pw.value().indexOf("\r") < 0) return;
            pw.setValue(pw.value().replace(/[\r\n]/g, ""));
            this.scheduleOnce(submit, 0);
        });
        email.box.node.on("editing-return", () => {
            this.scheduleOnce(() => pw.focus(), 0);
        });
        pw.box.node.on("editing-return", submit);

        const submitBtn = this.sprite(panel, "white", -92, -78, 170, 42,
            registering ? cc.color(40, 30, 70) : cc.color(20, 70, 40));
        this.label(submitBtn, registering ? "REGISTER" : "LOG IN", 0, 0, 18, white);
        submitBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            submit();
        });
        const closeBtn = this.sprite(panel, "white", 92, -78, 150, 42, cc.color(50, 50, 60));
        this.label(closeBtn, "CANCEL", 0, 0, 17, white);
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
    }

    private authFieldBg(parent: cc.Node, x: number, y: number, w: number, h: number) {
        const fill = this.sprite(parent, "white", x, y, w, h, cc.color(112, 207, 216));
        fill.opacity = 245;
        fill.zIndex = 0;
    }

    private authEditBox(parent: cc.Node, x: number, y: number, w: number, placeholder: string, password: boolean): {
        box: cc.EditBox;
        value: () => string;
        setValue: (s: string) => void;
        focus: () => void;
    } {
        const n = new cc.Node("authEditBox");
        n.setPosition(x, y);
        n.setContentSize(w, 30);
        n.zIndex = 5;
        const eb = n.addComponent(cc.EditBox);
        eb.backgroundImage = null;
        eb.placeholder = placeholder;
        eb.maxLength = 60;
        eb.inputMode = password ? cc.EditBox.InputMode.SINGLE_LINE : cc.EditBox.InputMode.EMAIL_ADDR;
        eb.fontSize = 18;
        eb.lineHeight = 30;
        eb.placeholderFontSize = 16;
        eb.fontColor = cc.color(8, 16, 36);
        eb.placeholderFontColor = cc.color(45, 72, 104);
        if (password) eb.inputFlag = cc.EditBox.InputFlag.PASSWORD;
        parent.addChild(n);

        const mirrorNode = this.label(parent, "", x - w / 2 + 10, y, 18, cc.color(8, 16, 36), 0);
        mirrorNode.zIndex = 8;
        const mirror = mirrorNode.getComponent(cc.Label);
        mirror.fontSize = 18;
        mirror.lineHeight = 30;
        mirrorNode.opacity = 0;
        let editing = false;
        const sync = () => {
            const raw = eb.string || "";
            mirror.string = password ? raw.replace(/./g, "*") : raw;
            mirrorNode.opacity = raw && !editing ? 255 : 0;
        };
        eb.node.on("text-changed", sync);
        eb.node.on("editing-did-began", () => {
            editing = true;
            mirrorNode.opacity = 0;
        });
        // eb.node.on("editing-did-ended", () => {
        //     editing = false;
        //     sync();
        // });
        eb.node.on("editing-did-ended", () => {
            this.scheduleOnce(() => {
                eb.node.active = false;
                eb.node.active = true;
            }, 0);
        });

        return {
            box: eb,
            value: () => eb.string || "",
            setValue: (s: string) => {
                eb.string = s;
                sync();
            },
            focus: () => eb.focus()
        };
    }

    private logoutToStart() {
        Sfx.play("click", 0.8);
        this.gatePassed = false;
        this.clearGate();
        GameData.setUnlocked(1);
        GameData.setBestDist(0);
        Fb.noReloadOnNextAuthChange();
        Fx.fadeTo("Start", this.node);
        Fb.logout();
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
        if (this.roomPanel) {
            this.roomPanel.destroy();
            this.roomPanel = null;
            Fb.lobbyOff();
            Fb.leaveRoom();
            this.myRoom = "";
            this.roomIsHost = false;
            this.roomMembersBox = null;
            this.roomStatus = null;
        }
        if (this.rhythmPanel) { this.rhythmPanel.destroy(); this.rhythmPanel = null; }
        if (this.keyBindPanel) { this.keyBindPanel.destroy(); this.keyBindPanel = null; }
        this.keyBindKind = "";
        this.keyBindMode = "";
        this.keyBindStatus = null;
    }

    private anyPanelOpen(): boolean {
        return !!(this.settingsPanel || this.accountPanel || this.boardPanel
            || this.savesPanel || this.helpPanel || this.roomPanel
            || this.rhythmPanel || this.keyBindPanel);
    }

    private toggleSettings() {
        if (this.settingsPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();
        this.buildSettingsPanel();
    }

    private closestIndex(values: number[], v: number): number {
        let best = 0;
        for (let i = 1; i < values.length; i++) {
            if (Math.abs(values[i] - v) < Math.abs(values[best] - v)) best = i;
        }
        return best;
    }

    // A draggable horizontal slider row: track + fill + knob + live value.
    // onChange fires on every drag step (live preview), onRelease on let-go.
    private sliderRow(panel: cc.Node, y: number, name: string,
        get: () => number, set: (v: number) => void,
        min: number, max: number, step: number,
        fmt: (v: number) => string,
        onChange?: () => void, onRelease?: () => void) {

        const white = cc.color(235, 240, 255);
        const cyan = cc.color(127, 247, 255);

        const row = this.sprite(panel, "white", 0, y, 520, 40, cc.color(24, 34, 76));
        this.label(row, name, -240, 0, 16, white, 0);
        const valNode = this.label(row, "", 240, 0, 16, cyan, 1);
        const valLb = valNode.getComponent(cc.Label);

        const trackW = 180;
        const trackX = 52; // track center within the row
        const left = trackX - trackW / 2;
        this.sprite(row, "white", trackX, 0, trackW, 5, cc.color(60, 70, 110));
        const fill = this.sprite(row, "white", left, 0, 1, 5, cyan);
        fill.anchorX = 0;
        const knob = this.sprite(row, "white", left, 0, 12, 24, white);

        const apply = (raw: number, fromDrag: boolean) => {
            const q = min + Math.round((raw - min) / step) * step;
            const v = Math.max(min, Math.min(max, Math.round(q * 1000) / 1000));
            set(v);
            const t = (max > min) ? (v - min) / (max - min) : 0;
            knob.x = left + t * trackW;
            fill.width = Math.max(1, t * trackW);
            valLb.string = fmt(v);
            if (fromDrag && onChange) onChange();
        };
        apply(get(), false);

        const hit = new cc.Node("hit");
        hit.setContentSize(trackW + 44, 40);
        hit.setPosition(trackX, 0);
        row.addChild(hit);
        const drag = (e: cc.Event.EventTouch) => {
            e.stopPropagation();
            const local = hit.convertToNodeSpaceAR(e.getLocation());
            const t = Math.max(0, Math.min(1, (local.x + trackW / 2) / trackW));
            apply(min + t * (max - min), true);
        };
        hit.on(cc.Node.EventType.TOUCH_START, drag);
        hit.on(cc.Node.EventType.TOUCH_MOVE, drag);
        const release = (e: cc.Event.EventTouch) => {
            e.stopPropagation();
            GameData.saveSettings();
            if (onRelease) onRelease();
        };
        hit.on(cc.Node.EventType.TOUCH_END, release);
        hit.on(cc.Node.EventType.TOUCH_CANCEL, release);
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
        this.label(panel, "drag the sliders", 0, 236, 14, cc.color(110, 120, 150));

        const s = GameData.settings;
        const pct = (v: number) => Math.round(v * 100) + "%";
        let rowY = 188;
        const nextY = () => { const r = rowY; rowY -= 42; return r; };

        this.sliderRow(panel, nextY(), "SFX VOLUME",
            () => s.sfx, (v) => { s.sfx = v; }, 0, 1, 0.05, pct,
            null, () => Sfx.play("crystal", 0.8));
        this.sliderRow(panel, nextY(), "MUSIC VOLUME",
            () => s.bgm, (v) => { s.bgm = v; }, 0, 1, 0.05, pct,
            () => Sfx.applyBgmVolume());
        this.sliderRow(panel, nextY(), "GAME SPEED",
            () => s.speed, (v) => { s.speed = v; }, 0.6, 1.4, 0.1, pct);
        this.sliderRow(panel, nextY(), "COLOR SCHEME",
            () => s.scheme, (v) => { s.scheme = Math.round(v); }, 0, SCHEMES.length - 1, 1,
            (v) => SCHEMES[Math.round(v)].name,
            () => this.applyBgTint());
        this.sliderRow(panel, nextY(), "BRIGHTNESS",
            () => s.brightness, (v) => { s.brightness = v; }, 0.6, 1, 0.05, pct,
            () => this.applyBgTint());
        this.sliderRow(panel, nextY(), "ONLINE CONTACT",
            () => s.onlineCollide ? 1 : 0, (v) => { s.onlineCollide = Math.round(v); }, 0, 1, 1,
            (v) => Math.round(v) === 1 ? "COLLIDE" : "GHOST");
        const gaps = this.rhythmGapValues;
        this.sliderRow(panel, nextY(), "RHYTHM TRACK GAP",
            () => this.closestIndex(gaps, s.rhythmGap),
            (v) => { s.rhythmGap = gaps[Math.round(v)]; },
            0, gaps.length - 1, 1,
            (v) => String(gaps[Math.round(v)]));
        const spds = this.rhythmSpeedValues;
        this.sliderRow(panel, nextY(), "RHYTHM FLOW SPEED",
            () => this.closestIndex(spds, s.rhythmSpeedScale),
            (v) => { s.rhythmSpeedScale = spds[Math.round(v)]; },
            0, spds.length - 1, 1,
            (v) => spds[Math.round(v)].toFixed(1) + "x");

        // key bindings open their own capture panel — stay click rows
        const keyRows = [
            { name: "RHYTHM JUMP KEYS", value: () => this.rhythmJumpKeyText(), kind: "jump" },
            { name: "RHYTHM FLIP KEYS", value: () => this.rhythmFlipKeyText(), kind: "flip" }
        ];
        for (const kr of keyRows) {
            const y = nextY();
            const rowNode = this.sprite(panel, "white", 0, y, 520, 40, cc.color(24, 34, 76));
            this.label(rowNode, kr.name, -240, 0, 17, white, 0);
            this.label(rowNode, kr.value() + "  >", 240, 0, 17, cyan, 1);
            rowNode.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.7);
                this.closePanels();
                this.buildRhythmKeyPanel(kr.kind);
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
        } else if (!Fb.user()) {
            this.label(panel, "Please log in from the start screen.", 0, 40, 18, white);
        } else {
            this.label(panel, "Logged in as", 0, 98, 16, dim);
            this.label(panel, Fb.userName(), 0, 66, 26, white);
            this.label(panel, "Save states sync to this account", 0, 30, 17, orange);
            this.label(panel, "Unlocked level: " + GameData.getUnlocked(), 0, -2, 16, dim);
            this.accountStatus = this.label(panel, "", 0, -118, 16, orange);
            const status = (s: string) => {
                (this.accountStatus.getComponent(cc.Label)).string = s;
            };
            const oBtn = this.sprite(panel, "white", 0, -62, 170, 40, cc.color(70, 25, 35));
            this.label(oBtn, "LOG OUT", 0, 0, 16, white);
            oBtn.on(cc.Node.EventType.TOUCH_END, () => {
                status("logging out...");
                this.logoutToStart();
            });
            this.label(panel, "progress + endless best sync to this account", 0, -150, 14, dim);
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

    // ---------- online room (host-started synced races) ----------

    private toggleRoom() {
        if (this.roomPanel) {
            this.closePanels();
            return;
        }
        this.closePanels();
        this.roomLaunched = false;
        this.buildRoomPanel();
        Fb.lobbyListen((rooms, members) => this.onLobby(rooms, members));
    }

    private roomBase(title: string): cc.Node {
        const panel = this.sprite(this.node, "white", 0, 0, 620, 500, cc.color(10, 12, 26));
        panel.opacity = 248;
        panel.zIndex = 50;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.roomPanel = panel;
        this.label(panel, title, 0, 218, 26, cc.color(255, 181, 74));
        const closeBtn = this.sprite(panel, "white", 0, -218, 160, 38, cc.color(50, 50, 60));
        this.label(closeBtn, "CLOSE", 0, 0, 17, cc.color(235, 240, 255));
        closeBtn.on(cc.Node.EventType.TOUCH_END, () => {
            Sfx.play("click", 0.8);
            this.closePanels();
        });
        return panel;
    }

    private buildRoomPanel() {
        const white = cc.color(235, 240, 255);
        const cyan = cc.color(127, 247, 255);
        const dim = cc.color(110, 120, 150);
        const panel = this.roomBase("ONLINE ROOM");

        if (!Fb.user()) {
            this.label(panel, "log in first (ACCOUNT panel)", 0, 40, 18, white);
            return;
        }

        this.label(panel, "CREATE A ROOM — pick the level:", 0, 160, 16, dim);
        const opts: { txt: string; lv: number }[] = [
            { txt: "L1", lv: 1 }, { txt: "L2", lv: 2 }, { txt: "L3", lv: 3 },
            { txt: "L4", lv: 4 }, { txt: "L5", lv: 5 }, { txt: "ENDLESS", lv: -1 }
        ];
        for (let i = 0; i < opts.length; i++) {
            const o = opts[i];
            const w = o.lv === -1 ? 120 : 70;
            const x = -235 + i * 82 + (o.lv === -1 ? 28 : 0);
            const b = this.sprite(panel, "white", x, 118, w, 42, cc.color(24, 34, 76));
            this.label(b, o.txt, 0, 0, 16, white);
            b.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
                e.stopPropagation();
                Sfx.play("click", 0.8);
                const code = this.genRoomCode();
                Fb.createRoom(code, o.lv);
                this.myRoom = code;
                this.roomIsHost = true;
                this.buildRoomLobby(o.lv);
            });
        }

        this.label(panel, "— or —", 0, 60, 14, dim);
        this.label(panel, "JOIN A ROOM:", -220, 10, 16, dim, 0);
        const codeEb = this.editBox(panel, -40, -40, 220, "room code", false);
        const jBtn = this.sprite(panel, "white", 150, -40, 130, 44, cc.color(20, 70, 40));
        this.label(jBtn, "JOIN", 0, 0, 17, white);
        const status = this.label(panel, "", 0, -110, 15, cyan);
        jBtn.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
            e.stopPropagation();
            Sfx.play("click", 0.8);
            const code = codeEb.string.trim().toUpperCase();
            if (!code) {
                (status.getComponent(cc.Label)).string = "enter a room code";
                return;
            }
            let found = false;
            for (const r of this.lastRooms) {
                if (r.room && r.room.code === code) { found = true; break; }
            }
            if (!found) {
                (status.getComponent(cc.Label)).string = "room " + code + " not found";
                return;
            }
            Fb.joinRoom(code);
            this.myRoom = code;
            this.roomIsHost = false;
            this.buildRoomLobby(0);
        });
    }

    private buildRoomLobby(lv: number) {
        if (this.roomPanel) { this.roomPanel.destroy(); this.roomPanel = null; }
        const white = cc.color(235, 240, 255);
        const cyan = cc.color(127, 247, 255);
        const dim = cc.color(110, 120, 150);
        const panel = this.roomBase("ROOM  " + this.myRoom);

        this.label(panel, this.roomIsHost
            ? "you are the HOST — share the code, then press START"
            : "waiting for the host to start...", 0, 170, 15, dim);
        this.roomStatus = this.label(panel, "", 0, 140, 14, cyan).getComponent(cc.Label);

        this.label(panel, "PLAYERS", 0, 105, 16, cc.color(255, 181, 74));
        this.roomMembersBox = new cc.Node("members");
        panel.addChild(this.roomMembersBox);
        this.renderRoomMembers();

        if (this.roomIsHost) {
            const sBtn = this.sprite(panel, "white", 0, -150, 220, 50, cc.color(20, 90, 45));
            this.label(sBtn, "START  (3s)", 0, 0, 19, white);
            sBtn.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
                e.stopPropagation();
                Sfx.play("power", 0.9);
                Fb.startRoom(Fb.serverNow() + 3500);
            });
        }
    }

    private renderRoomMembers() {
        if (!this.roomMembersBox || !this.roomMembersBox.isValid) return;
        this.roomMembersBox.removeAllChildren();
        const names: string[] = [];
        for (const r of this.lastRooms) {
            if (r.room && r.room.code === this.myRoom) names.push(r.name + "  (host)");
        }
        for (const m of this.lastMembers) {
            if (m.code === this.myRoom) names.push(m.name);
        }
        for (let i = 0; i < names.length && i < 6; i++) {
            this.label(this.roomMembersBox, names[i], 0, 70 - i * 30, 16, cc.color(235, 240, 255));
        }
        if (this.roomStatus) this.roomStatus.string = names.length + " player(s) in room";
    }

    private onLobby(rooms: { uid: string; name: string; room: any }[],
                    members: { uid: string; name: string; code: string }[]) {
        this.lastRooms = rooms;
        this.lastMembers = members;
        if (!this.roomPanel || !this.roomPanel.isValid) return;
        if (!this.myRoom) return;
        this.renderRoomMembers();
        // host pressed START (recent server timestamp) -> everyone launches
        for (const r of rooms) {
            if (!r.room || r.room.code !== this.myRoom) continue;
            const t0 = r.room.start || 0;
            if (t0 > Fb.serverNow() - 5000 && !this.roomLaunched) {
                this.roomLaunched = true;
                Fb.lobbyOff();
                GameData.roomCode = this.myRoom;
                GameData.roomT0 = t0;
                GameData.players = 1;
                GameData.currentLevelPath = "";
                GameData.pendingState = null;
                GameData.currentLevel = (r.room.lv === -1) ? -1 : (r.room.lv || 1);
                Fx.fadeTo("Game", this.node);
            }
            return;
        }
        // room vanished (host left)
        if (!this.roomIsHost && this.roomStatus) {
            this.roomStatus.string = "room closed by host";
        }
    }

    private genRoomCode(): string {
        const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        return code;
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
        if (!this.shouldShowMainMenu()) return;
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
