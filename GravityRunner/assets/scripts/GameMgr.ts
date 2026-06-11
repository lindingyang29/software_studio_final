import GameData from "./GameData";
import LevelBuilder, { LevelData, FragmentManifest } from "./LevelBuilder";
import EndlessGen from "./EndlessGen";
import Player from "./Player";
import CameraFollow from "./CameraFollow";
import Sfx from "./Sfx";
import Fx from "./Fx";
import Fb from "./Fb";

const { ccclass } = cc._decorator;

type GameState = "loading" | "ready" | "run" | "dead" | "win" | "paused";

// Owns the Game scene: loads assets + level JSON, builds the world through
// LevelBuilder, spawns 1-2 Players, and runs the ready/run/dead/win state machine.
// Everything (world, HUD) is created in code — the .fire scene stays minimal.
//
// Co-op rules (GameData.players === 2): P1 = W key, P2 = UP/SPACE.
// If one player dies while the partner survives, they revive next to the
// partner after 3s. If everyone is dead, the level restarts.
@ccclass
export default class GameMgr extends cc.Component {

    // global slow-motion factor (slow power-up); Player multiplies dt by this
    timeScale = 1;

    private cameraNode: cc.Node = null;
    private world: cc.Node = null;
    private hud: cc.Node = null;
    private players: Player[] = [];
    private level: LevelData = null;
    private frames: { [k: string]: cc.SpriteFrame } = {};

    private state: GameState = "loading";
    private time = 0;
    private deaths = 0;
    private crystalsTaken = 0;
    private slowT = 0;
    private enemyT = 0;
    private rotCurrent = 0;
    private rotTarget = 0;

    // endless mode (GameData.currentLevel === -1)
    private endless = false;
    private gen: EndlessGen = null;
    private chunks: { node: cc.Node; endX: number; m: FragmentManifest }[] = [];
    private distPx = 0;
    private distLabel: cc.Label = null;

    private nameLabel: cc.Label = null;
    private crystalLabel: cc.Label = null;
    private deathLabel: cc.Label = null;
    private timeLabel: cc.Label = null;
    private msgLabel: cc.Label = null;
    private subLabel: cc.Label = null;
    private slowOverlay: cc.Node = null;
    private pausePanel: cc.Node = null;

    // rhythm mode state (generated from .tja charts)
    private rhythmLabel: cc.Label = null;
    private judgeLabel: cc.Label = null;
    private rhythmIndex = 0;
    private rhythmScore = 0;
    private rhythmCombo = 0;
    private rhythmMaxCombo = 0;
    private rhythmPerfect = 0;
    private rhythmGood = 0;
    private rhythmBad = 0;
    private rhythmMiss = 0;

    isRunning(): boolean {
        return this.state === "run";
    }

    onLoad() {
        Sfx.preload();
        Sfx.playBgm();
        Fb.init();
        this.cameraNode = this.node.getChildByName("Main Camera");

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);

        cc.resources.loadDir("textures", cc.SpriteFrame, (err, assets: cc.SpriteFrame[]) => {
            if (err) {
                cc.error("texture load failed", err);
                return;
            }
            for (const a of assets) this.frames[a.name] = a;
            this.onTexturesReady();
        });
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    private onTexturesReady() {
        Fx.setFrame(this.frames["white"]);
        // background rides along as a child of the camera (auto screen-aligned,
        // even when the camera rotates in rotation zones)
        const bg = new cc.Node("BG");
        const bgSp = bg.addComponent(cc.Sprite);
        bgSp.spriteFrame = this.frames["bg"];
        bgSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bg.setContentSize(1400, 1400); // oversized: stays covering while rotated
        const b = GameData.settings.brightness;
        const tint = LevelBuilder.scheme().bgTint;
        bg.color = cc.color(Math.round(tint.r * b), Math.round(tint.g * b), Math.round(tint.b * b));
        this.cameraNode.addChild(bg, -10);

        this.world = new cc.Node("World");
        this.node.addChild(this.world);

        this.buildHud();
        Fx.fadeIn(this.hud);

        this.endless = GameData.currentLevel === -1;
        if (this.endless) {
            this.startEndless();
            return;
        }
        if (GameData.currentLevel === 0) {
            // player-made level from the editor
            let data: any = null;
            try {
                const raw = cc.sys.localStorage.getItem(GameData.CUSTOM_KEY);
                data = raw ? JSON.parse(raw) : null;
            } catch (e) { data = null; }
            if (!data || !data.goal) {
                this.setMsg("NO CUSTOM LEVEL SAVED", "PRESS Q FOR MENU");
                return;
            }
            this.startLevel(data);
            return;
        }
        const levelPath = GameData.currentLevelPath || ("levels/level" + GameData.currentLevel);
        cc.resources.load(levelPath, cc.JsonAsset, (err, asset: cc.JsonAsset) => {
            if (err) {
                this.setMsg("LEVEL LOAD ERROR", levelPath);
                cc.error(err);
                return;
            }
            this.startLevel(asset.json);
        });
    }

    private startLevel(data: any) {
        this.level = LevelBuilder.build(this.world, data, this.frames);
        this.spawnPlayersAndCamera(this.level.length - 480);
        this.applyRotationForX(this.level.start.x, true);
        const titlePrefix = this.isRhythmLevel() ? "RHYTHM — "
            : (GameData.currentLevel === 0 ? "CUSTOM — " : "LEVEL " + GameData.currentLevel + " — ");
        this.nameLabel.string = titlePrefix + this.level.name
            + (GameData.players === 2 && !this.isRhythmLevel() ? "   [2P]" : "");
        if (this.isRhythmLevel()) {
            Sfx.stopBgm();
            this.resetRhythmState(true);
        }
        this.refreshHud();
        this.state = "ready";
        this.setMsg(this.isRhythmLevel() ? "PRESS RHYTHM KEY TO START" : "PRESS SPACE TO RUN", this.controlsHint());
    }

    private controlsHint(): string {
        if (this.isJumpFlipRhythm()) {
            return "RED = " + this.rhythmKeyText("jump") + " LIGHT JUMP    BLUE = " + this.rhythmKeyText("flip") + " FLIP    TOUCH NOTES TO SCORE    R = RESTART";
        }
        if (this.isRhythmLevel()) {
            return "RED/BLUE NOTES = FLIP TIMING    HIT NOTES TO STEP LANES    MISS = NO DEATH    R = RESTART";
        }
        return GameData.players === 2
            ? "P1: W flip, D dash, A brake      P2: UP flip, RIGHT dash, LEFT brake      R = RESTART"
            : "SPACE/W/UP = FLIP    D = DASH    A = BRAKE    R = RESTART    ESC = PAUSE";
    }

    private spawnPlayersAndCamera(maxX: number) {
        const count = GameData.players === 2 ? 2 : 1;
        this.players = [];
        for (let i = 0; i < count; i++) {
            const pNode = new cc.Node("Player" + (i + 1));
            const sp = pNode.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames[i === 0 ? "player" : "player2"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            pNode.setContentSize(36, 36);
            this.world.addChild(pNode, 5);
            const p = pNode.addComponent(Player);
            p.init(this, this.level, i, this.frames);
            this.players.push(p);
        }

        const follow = this.cameraNode.addComponent(CameraFollow);
        const rhythmLookAhead = this.isRhythmLevel() ? (((this.level.rhythm as any).cameraLookAhead || 280)) : 160;
        follow.init(this.players[0].node, 0, maxX, rhythmLookAhead);
        follow.snap();

        this.time = 0;
        this.deaths = 0;
        this.crystalsTaken = 0;
        this.timeScale = 1;
        this.enemyT = 0;
        this.distPx = 0;
    }

    // ---------- endless mode ----------

    private endlessBaseSpeed(): number {
        return 300 * GameData.settings.speed;
    }

    private startEndless() {
        this.level = LevelBuilder.emptyLevel("ENDLESS", this.endlessBaseSpeed());
        this.gen = new EndlessGen(1100);
        this.chunks = [];
        // starter pad so the run begins on safe ground
        this.appendChunk({
            segments: [
                { x: -500, w: 1600, side: "floor" },
                { x: -500, w: 1600, side: "ceiling" }
            ],
            crystals: [{ x: 300, y: -212 }, { x: 400, y: -212 }, { x: 500, y: -212 }]
        }, 1100);
        this.spawnPlayersAndCamera(1e15);
        this.applyRotationForX(this.level.start.x, true);
        this.nameLabel.string = "ENDLESS MODE" + (GameData.players === 2 ? "   [2P]" : "");
        this.refreshHud();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN",
            this.controlsHint() + "    BEST " + GameData.getBestDist() + "m");
    }

    private appendChunk(frag: any, endX: number) {
        const cn = new cc.Node("chunk");
        this.world.addChild(cn);
        const m = LevelBuilder.append(cn, frag, this.frames, this.level);
        this.chunks.push({ node: cn, endX: endX, m: m });
    }

    private dropChunk(c: { node: cc.Node; endX: number; m: FragmentManifest }) {
        const rm = (arr: any[], items: any[]) => {
            for (const it of items) {
                const i = arr.indexOf(it);
                if (i >= 0) arr.splice(i, 1);
            }
        };
        rm(this.level.solids, c.m.solids);
        rm(this.level.spikes, c.m.spikes);
        rm(this.level.crystals, c.m.crystals);
        rm(this.level.powerups, c.m.powerups);
        rm(this.level.teleports, c.m.teleports);
        rm(this.level.enemies, c.m.enemies);
        rm(this.level.movers, c.m.movers);
        c.node.destroy();
    }

    private endlessGameOver() {
        this.state = "win"; // reuses win input flow: SPACE = retry, ESC = menu
        this.unscheduleAllCallbacks();
        const meters = Math.floor(this.distPx / 10);
        const best = GameData.getBestDist();
        const newBest = meters > best;
        if (newBest) {
            GameData.setBestDist(meters);
            Fb.syncUp();
        }
        this.setMsg(
            newBest ? "NEW BEST!  " + meters + "m" : "RUN OVER  —  " + meters + "m",
            "BEST " + Math.max(meters, best) + "m    CRYSTALS " + this.crystalsTaken
            + "    TIME " + this.formatTime(this.time)
            + "    SPACE = RETRY    ESC = MENU"
        );
    }

    // ---------- HUD ----------

    private makeLabel(parent: cc.Node, x: number, y: number, size: number, color: cc.Color, anchorX: number = 0.5): cc.Label {
        const n = new cc.Node("label");
        n.setPosition(x, y);
        n.anchorX = anchorX;
        n.color = color;
        const lb = n.addComponent(cc.Label);
        lb.fontSize = size;
        lb.lineHeight = size + 6;
        lb.string = "";
        parent.addChild(n);
        return lb;
    }

    private buildHud() {
        // HUD is a sibling of the world; update() keeps it glued to the camera
        // (position AND angle, so it stays upright in rotation zones).
        this.hud = new cc.Node("HUD");
        this.node.addChild(this.hud, 100);

        // Touch hit-testing goes through the camera in Cocos 2.x: a listener
        // on the static Canvas stops firing once the camera scrolls right.
        // The catcher rides inside the HUD, which follows the camera.
        const catcher = new cc.Node("touchCatcher");
        catcher.setContentSize(1700, 900);
        catcher.on(cc.Node.EventType.TOUCH_START, this.onTouch, this);
        this.hud.addChild(catcher, -2);

        const cyan = cc.color(127, 247, 255);
        const pink = cc.color(255, 122, 200);
        const orange = cc.color(255, 181, 74);
        const white = cc.color(235, 240, 255);

        this.slowOverlay = new cc.Node("slowFx");
        const so = this.slowOverlay.addComponent(cc.Sprite);
        so.spriteFrame = this.frames["white"];
        so.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.slowOverlay.setContentSize(1400, 1400);
        this.slowOverlay.color = cc.color(120, 150, 255);
        this.slowOverlay.opacity = 0;
        this.hud.addChild(this.slowOverlay, -1);

        this.nameLabel = this.makeLabel(this.hud, -450, 296, 20, cyan, 0);
        this.crystalLabel = this.makeLabel(this.hud, -450, 268, 20, white, 0);
        this.deathLabel = this.makeLabel(this.hud, -450, 240, 20, pink, 0);
        this.timeLabel = this.makeLabel(this.hud, 450, 296, 20, orange, 1);
        this.distLabel = this.makeLabel(this.hud, 0, 296, 24, orange);
        this.rhythmLabel = this.makeLabel(this.hud, 0, 266, 20, orange);
        this.judgeLabel = this.makeLabel(this.hud, 0, 86, 34, white);
        this.msgLabel = this.makeLabel(this.hud, 0, 40, 44, white);
        this.subLabel = this.makeLabel(this.hud, 0, -10, 18, cyan);
    }

    private refreshHud() {
        if (this.isRhythmLevel()) {
            const hit = this.rhythmPerfect + this.rhythmGood + this.rhythmBad;
            this.crystalLabel.string = "NOTES  " + hit + " / " + this.level.rhythm.notes.length;
        } else {
            this.crystalLabel.string = this.endless
                ? "CRYSTALS  " + this.crystalsTaken
                : "CRYSTALS  " + this.crystalsTaken + " / " + this.level.totalCrystals;
        }
        this.deathLabel.string = this.isRhythmLevel() ? "MISSES  " + this.rhythmMiss : "DEATHS  " + this.deaths;
        this.timeLabel.string = this.formatTime(this.time);
        this.updateRhythmHud();
    }

    private formatTime(t: number): string {
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s.toFixed(1) : s.toFixed(1));
    }

    private setMsg(main: string, sub: string) {
        this.msgLabel.string = main;
        this.subLabel.string = sub;
    }

    // ---------- input ----------

    private skill(who: number, kind: string) {
        if (this.isRhythmLevel()) return;
        if (this.state !== "run") return;
        const idx = GameData.players === 2 ? who : 0;
        const p = this.players[idx];
        if (!p || !p.alive) return;
        if (kind === "dash") p.dash();
        else p.brake();
    }

    private rhythmKeyName(code: number): string {
        const key: any = cc.macro.KEY as any;
        const preferred = ["space", "up", "down", "left", "right", "escape", "enter", "tab", "backspace",
            "shift", "ctrl", "alt", "semicolon", "comma", "period", "slash", "backslash", "quote", "bracketleft", "bracketright",
            "minus", "equal", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
            "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        for (const n of preferred) if (key[n] === code) return n;
        for (const n in key) if (key[n] === code) return String(n).toLowerCase();
        return String(code);
    }

    private rhythmKeyList(kind: string): string[] {
        const raw = kind === "jump"
            ? (GameData.settings.rhythmJumpKeys || "f,j")
            : (GameData.settings.rhythmFlipKeys || "d,k");
        return String(raw).split(",").map(x => x.trim().toLowerCase()).filter(x => !!x);
    }

    private isRhythmActionKey(kind: string, code: number): boolean {
        return this.rhythmKeyList(kind).indexOf(this.rhythmKeyName(code)) >= 0;
    }

    private rhythmKeyText(kind: string): string {
        return this.rhythmKeyList(kind).map(x => x.toUpperCase()).join("/");
    }

    private onKeyDown(e: cc.Event.EventKeyboard) {
        if (this.isJumpFlipRhythm()) {
            if (this.isRhythmActionKey("jump", e.keyCode)) {
                this.onRhythmButton("jump");
                return;
            }
            if (this.isRhythmActionKey("flip", e.keyCode)) {
                this.onRhythmButton("flip");
                return;
            }
        }
        switch (e.keyCode) {
            case cc.macro.KEY.space:
            case cc.macro.KEY.up:
                this.onAction(1);
                break;
            case cc.macro.KEY.w:
                this.onAction(0);
                break;
            case cc.macro.KEY.d:
                this.skill(0, "dash");
                break;
            case cc.macro.KEY.a:
                this.skill(0, "brake");
                break;
            case cc.macro.KEY.right:
                this.skill(1, "dash");
                break;
            case cc.macro.KEY.left:
                this.skill(1, "brake");
                break;
            case cc.macro.KEY.r:
                this.fullRestart();
                break;
            case cc.macro.KEY.escape:
                this.togglePause();
                break;
            case cc.macro.KEY.q:
                if (this.state === "paused" || this.state === "loading") {
                    Fx.fadeTo("Menu", this.hud);
                }
                break;
        }
    }

    private onRhythmButton(action: string) {
        switch (this.state) {
            case "ready":
                this.startRhythmRun();
                break;
            case "run":
                this.rhythmInput(action);
                break;
            case "paused":
                this.togglePause();
                break;
            case "win":
                this.proceedAfterWin();
                break;
        }
    }

    private onTouch(e: cc.Event.EventTouch) {
        // while paused, only the pause-menu buttons react to clicks
        if (this.state === "paused") return;
        // 2P touch: left half of the screen = P1, right half = P2
        const half = cc.winSize.width / 2;
        this.onAction(e.getLocationX() < half ? 0 : 1);
    }

    // who: 0 = P1 input, 1 = P2 input (in solo mode every input drives P1)
    private onAction(who: number) {
        switch (this.state) {
            case "ready":
                if (this.isRhythmLevel()) this.startRhythmRun();
                else {
                    this.state = "run";
                    this.setMsg("", "");
                }
                break;
            case "run": {
                if (this.isRhythmLevel()) {
                    this.rhythmInput("flip");
                    break;
                }
                const idx = GameData.players === 2 ? who : 0;
                const p = this.players[idx];
                if (p && p.alive) p.flip();
                break;
            }
            case "paused":
                this.togglePause();
                break;
            case "win":
                this.proceedAfterWin();
                break;
        }
    }

    private togglePause() {
        if (this.state === "run") {
            this.state = "paused";
            if (this.isRhythmLevel()) Sfx.pauseMusic();
            this.buildPauseMenu();
        } else if (this.state === "paused") {
            this.state = "run";
            if (this.isRhythmLevel()) Sfx.resumeMusic();
            this.closePauseMenu();
            this.setMsg("", "");
        } else if (this.state === "win") {
            Fx.fadeTo("Menu", this.hud);
        }
    }

    private buildPauseMenu() {
        if (this.pausePanel) return;
        const panel = new cc.Node("PausePanel");
        this.hud.addChild(panel, 10);
        this.pausePanel = panel;

        const dim = new cc.Node("dim");
        const ds = dim.addComponent(cc.Sprite);
        ds.spriteFrame = this.frames["white"];
        ds.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        dim.setContentSize(1400, 1400);
        dim.color = cc.color(0, 0, 0);
        dim.opacity = 170;
        panel.addChild(dim);

        const title = this.makeLabel(panel, 0, 130, 44, cc.color(235, 240, 255));
        title.string = "PAUSED";

        const mkBtn = (text: string, y: number, cb: () => void) => {
            const btn = new cc.Node("btn");
            const bs = btn.addComponent(cc.Sprite);
            bs.spriteFrame = this.frames["white"];
            bs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            btn.setContentSize(260, 50);
            btn.setPosition(0, y);
            btn.color = cc.color(24, 34, 76);
            panel.addChild(btn);
            const lb = this.makeLabel(btn, 0, 0, 20, cc.color(235, 240, 255));
            lb.string = text;
            btn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                cb();
            });
        };
        mkBtn("RESUME  (SPACE)", 40, () => this.togglePause());
        mkBtn("RESTART  (R)", -30, () => this.fullRestart());
        mkBtn("MAIN MENU  (Q)", -100, () => Fx.fadeTo("Menu", this.hud));
    }

    private closePauseMenu() {
        if (this.pausePanel) {
            this.pausePanel.destroy();
            this.pausePanel = null;
        }
    }

    private fullRestart() {
        if (this.state === "loading" || this.players.length === 0) return;
        if (this.endless) {
            cc.director.loadScene("Game"); // streamed chunks: clean reload
            return;
        }
        this.unscheduleAllCallbacks();
        this.closePauseMenu();
        if (this.isRhythmLevel()) Sfx.stopBgm();
        this.respawnAll();
        this.state = "ready";
        this.setMsg(this.isRhythmLevel() ? "PRESS RHYTHM KEY TO START" : "PRESS SPACE TO RUN", this.controlsHint());
    }

    private respawnAll() {
        for (const p of this.players) p.reset();
        for (const c of this.level.crystals) {
            c.taken = false;
            c.node.active = true;
            c.node.setPosition(c.x, c.y); // magnet may have dragged it around
        }
        for (const pu of this.level.powerups) {
            pu.taken = false;
            pu.node.active = true;
        }
        this.crystalsTaken = 0;
        this.time = 0;
        this.timeScale = 1;
        this.slowT = 0;
        this.slowOverlay.opacity = 0;
        this.enemyT = 0;
        const follow = this.cameraNode.getComponent(CameraFollow);
        if (follow) {
            follow.setTarget(this.players[0].node);
            follow.snap();
        }
        this.applyRotationForX(this.level.start.x, true);
        if (this.isRhythmLevel()) this.resetRhythmState(true);
        this.refreshHud();
    }


    // ---------- rhythm mode ----------

    isRhythmMode(): boolean {
        return this.isRhythmLevel();
    }

    private isRhythmLevel(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled);
    }

    private startRhythmRun() {
        if (!this.isRhythmLevel()) return;
        this.resetRhythmState(true);
        this.time = 0;
        this.refreshHud();
        this.state = "loading";
        this.setMsg("GET READY", "loading music...");
        Sfx.playMusic(this.level.rhythm.audio || "rhythm_song", false, () => {
            if (!this.node || !this.node.isValid || !this.isRhythmLevel()) return;
            if (this.state !== "loading") return;
            this.state = "run";
            this.setMsg("", "");
        });
    }

    private resetRhythmState(resetNodes: boolean) {
        this.rhythmIndex = 0;
        this.rhythmScore = 0;
        this.rhythmCombo = 0;
        this.rhythmMaxCombo = 0;
        this.rhythmPerfect = 0;
        this.rhythmGood = 0;
        this.rhythmBad = 0;
        this.rhythmMiss = 0;
        if (resetNodes && this.level && this.level.rhythm) {
            for (const n of this.level.rhythm.notes) {
                n.judged = false;
                if (n.node && n.node.isValid) {
                    n.node.opacity = (this.isCollectorRhythm() || this.isJumpFlipRhythm()) ? 238 : (n.flip ? 245 : 190);
                    n.node.scale = 1;
                }
            }
        }
        this.updateRhythmHud();
    }

    private updateRhythmHud() {
        if (!this.rhythmLabel) return;
        if (!this.isRhythmLevel()) {
            this.rhythmLabel.string = "";
            if (this.judgeLabel) this.judgeLabel.string = "";
            return;
        }
        this.rhythmLabel.string = "SCORE " + this.rhythmScore
            + "   COMBO " + this.rhythmCombo
            + "   HIT " + (this.rhythmPerfect + this.rhythmGood + this.rhythmBad)
            + "   MISS " + this.rhythmMiss;
    }

    private rhythmSummary(): string {
        if (!this.isRhythmLevel()) return "";
        const total = this.level.rhythm.notes.length || 1;
        const hit = this.rhythmPerfect + this.rhythmGood + this.rhythmBad;
        const acc = Math.round(1000 * (this.rhythmPerfect + this.rhythmGood * 0.7 + this.rhythmBad * 0.35) / total) / 10;
        return "SCORE " + this.rhythmScore
            + "    ACC " + acc.toFixed(1) + "%"
            + "    MAX COMBO " + this.rhythmMaxCombo
            + "    P/G/B/M " + this.rhythmPerfect + "/" + this.rhythmGood + "/" + this.rhythmBad + "/" + this.rhythmMiss;
    }

    private showRhythmJudge(text: string, color: cc.Color) {
        if (!this.judgeLabel) return;
        this.judgeLabel.node.stopAllActions();
        this.judgeLabel.string = text;
        this.judgeLabel.node.color = color;
        this.judgeLabel.node.opacity = 255;
        this.judgeLabel.node.scale = 1.15;
        cc.tween(this.judgeLabel.node)
            .to(0.12, { scale: 1 })
            .delay(0.18)
            .to(0.18, { opacity: 0 })
            .start();
    }

    private isCollectorRhythm(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled && this.level.rhythm.style === "gravity-collect");
    }

    private isJumpFlipRhythm(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled && this.level.rhythm.style === "jump-flip");
    }

    private advanceRhythmIndex() {
        const r = this.level && this.level.rhythm;
        if (!r) return;
        while (this.rhythmIndex < r.notes.length && r.notes[this.rhythmIndex].judged) this.rhythmIndex++;
    }

    private rhythmInput(action: string = "flip") {
        if (!this.isRhythmLevel()) return;
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const badW = r.badWindow || 0.17;
        const goodW = r.goodWindow || 0.11;
        const perfectW = r.perfectWindow || 0.055;
        const p = this.players[0];

        const doAction = (a: string) => {
            if (!p || !p.alive) return;
            if (this.isJumpFlipRhythm()) {
                if (a === "jump" && (p as any).rhythmLightJump) (p as any).rhythmLightJump();
                else p.flip();
            } else if (this.isCollectorRhythm() && (p as any).rhythmFreeStep) {
                (p as any).rhythmFreeStep();
            } else {
                p.flip();
            }
        };

        if (this.isJumpFlipRhythm()) {
            // Jump / flip only moves the player.  Notes are scored only when the
            // player actually overlaps the note node on the correct rail.
            doAction(action);
            this.updateJumpFlipTouches();
            return;
        }

        let best: any = null;
        let bestDiff = 1e9;
        for (let i = this.rhythmIndex; i < r.notes.length && i < this.rhythmIndex + 18; i++) {
            const n = r.notes[i];
            if (n.judged) continue;
            const diff = Math.abs(n.time - t);
            if (diff < bestDiff && diff <= badW) {
                best = n;
                bestDiff = diff;
            }
            if (n.time > t + badW) break;
        }

        if (best) {
            if (p && p.alive && this.isCollectorRhythm() && (p as any).rhythmStepToLane) {
                (p as any).rhythmStepToLane(best.trackLane || 0, best.dir || 0);
            } else if (p && p.alive) {
                p.flip();
            }
            let judgement = "bad";
            if (bestDiff <= perfectW) judgement = "perfect";
            else if (bestDiff <= goodW) judgement = "good";
            this.judgeNote(best, judgement);
            this.advanceRhythmIndex();
            return;
        }

        // Outside a note window, still allow free movement so it remains a
        // gravity-runner instead of a static rhythm game.
        doAction(action);
    }

    private judgeNote(note: any, judgement: string) {
        note.judged = true;
        if (note.node && note.node.isValid) {
            note.node.stopAllActions();
            note.node.opacity = judgement === "miss" ? 35 : 70;
            note.node.scale = judgement === "miss" ? 0.75 : 1.25;
            cc.tween(note.node).to(0.12, { scale: 1 }).start();
            if (judgement === "miss") Fx.rhythmMiss(this.world, note.x || note.node.x, note.y || note.node.y);
            else if ((note.action || "") === "jump") Fx.rhythmJump(this.world, note.x || note.node.x, note.y || note.node.y, -1);
            else if ((note.action || "") === "flip") Fx.rhythmFlip(this.world, note.x || note.node.x, note.y || note.node.y);
        }
        if (judgement === "perfect") {
            this.rhythmPerfect++;
            this.rhythmCombo++;
            this.rhythmScore += 1000 + this.rhythmCombo * 2;
            this.showRhythmJudge("PERFECT", cc.color(255, 240, 150));
        } else if (judgement === "good") {
            this.rhythmGood++;
            this.rhythmCombo++;
            this.rhythmScore += 650 + this.rhythmCombo;
            this.showRhythmJudge("GOOD", cc.color(127, 247, 255));
        } else if (judgement === "bad") {
            this.rhythmBad++;
            this.rhythmCombo = 0;
            this.rhythmScore += 250;
            this.showRhythmJudge("BAD", cc.color(255, 181, 74));
        } else {
            this.rhythmMiss++;
            this.rhythmCombo = 0;
            this.showRhythmJudge("MISS", cc.color(255, 90, 100));
        }
        if (this.rhythmCombo > this.rhythmMaxCombo) this.rhythmMaxCombo = this.rhythmCombo;
        this.updateRhythmHud();
        this.refreshHud();
    }

    private playerTouchesRhythmNote(note: any): boolean {
        const p = this.players[0];
        if (!p || !p.alive || !note || !note.node || !note.node.isValid) return false;
        const laneOk = !note.lane || !(p as any).getLane || (p as any).getLane() === note.lane;
        if (!laneOk) return false;
        const dx = Math.abs(p.node.x - note.node.x);
        const dy = Math.abs(p.node.y - note.node.y);
        const radius = note.action === "flip" ? 48 : 42;
        return dx <= radius && dy <= radius;
    }

    private updateJumpFlipTouches() {
        if (!this.isJumpFlipRhythm()) return;
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const badW = r.badWindow || 0.17;
        const goodW = r.goodWindow || 0.11;
        const perfectW = r.perfectWindow || 0.055;

        while (this.rhythmIndex < r.notes.length) {
            const n = r.notes[this.rhythmIndex];
            if (n.judged) {
                this.rhythmIndex++;
                continue;
            }
            const hitTime = Number((n as any).hitTime !== undefined ? (n as any).hitTime : n.time);
            if (t < hitTime - badW) break;

            if (this.playerTouchesRhythmNote(n)) {
                const diff = Math.abs(hitTime - t);
                let judgement = "bad";
                if (diff <= perfectW) judgement = "perfect";
                else if (diff <= goodW) judgement = "good";
                this.judgeNote(n, judgement);
                this.rhythmIndex++;
                continue;
            }

            if (t > hitTime + badW) {
                this.judgeNote(n, "miss");
                this.rhythmIndex++;
                continue;
            }
            break;
        }
        this.updateRhythmHud();
    }

    private updateRhythm() {
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const badW = r.badWindow || 0.17;

        // Jump/flip rhythm is collision-based: pressing the key only moves the
        // player; a note scores only when the body touches it on the right rail.
        if (this.isJumpFlipRhythm()) {
            this.updateJumpFlipTouches();
            return;
        }

        // In collector rhythm mode, notes are judged by input timing.  If the
        // player does not press inside the window, it is simply a MISS; no death.
        if (this.isCollectorRhythm()) {
            while (this.rhythmIndex < r.notes.length) {
                const n = r.notes[this.rhythmIndex];
                if (n.judged) {
                    this.rhythmIndex++;
                    continue;
                }
                const hitTime = Number((n as any).hitTime !== undefined ? (n as any).hitTime : n.time);
                if (t > hitTime + badW) {
                    this.judgeNote(n, "miss");
                    this.rhythmIndex++;
                    continue;
                }
                break;
            }
            this.updateRhythmHud();
            return;
        }

        const goodW = r.goodWindow || 0.11;
        const perfectW = r.perfectWindow || 0.055;
        const p = this.players[0];

        while (this.rhythmIndex < r.notes.length) {
            const n = r.notes[this.rhythmIndex];
            if (n.judged) {
                this.rhythmIndex++;
                continue;
            }

            if (t < n.time) break;

            const laneOk = !!(p && p.alive && (p as any).getLane && (p as any).getLane() === n.lane);
            const late = Math.max(0, t - n.time);
            if (laneOk) {
                let judgement = "bad";
                if (late <= perfectW) judgement = "perfect";
                else if (late <= goodW) judgement = "good";
                this.judgeNote(n, judgement);
                this.rhythmIndex++;
                continue;
            }

            if (late > badW) {
                this.judgeNote(n, "miss");
                this.rhythmIndex++;
                if (r.gateFatal !== false && p && p.alive && (p as any).rhythmGateFail) {
                    (p as any).rhythmGateFail();
                }
                continue;
            }
            break;
        }
        this.updateRhythmHud();
    }

    // ---------- rotation zones ----------

    private applyRotationForX(x: number, instant: boolean) {
        let target = 0;
        for (const r of this.level.rotations) {
            if (x >= r.x) target = r.angle;
        }
        if (target !== this.rotTarget) {
            this.rotTarget = target;
            if (!instant) Sfx.play("teleport", 0.4);
        }
        if (instant) {
            this.rotCurrent = target;
            this.applyWorldRotation();
        }
    }

    // Rotate the WORLD node (not the camera — cc.Camera in 2.4 ignores its
    // node's rotation) around the camera's focus point. Obstacles, players and
    // apparent gravity all rotate on screen, while physics stay 1D because
    // Player works in the world node's local coordinates.
    private applyWorldRotation() {
        const th = this.rotCurrent * Math.PI / 180;
        const px = this.cameraNode.x; // camera y is always 0
        this.world.angle = this.rotCurrent;
        this.world.x = px - px * Math.cos(th);
        this.world.y = -px * Math.sin(th);
    }

    // ---------- power-up support ----------

    applySlow(seconds: number, scale: number) {
        this.slowT = seconds;
        this.timeScale = scale;
        this.slowOverlay.opacity = 50;
    }

    // ---------- callbacks from Player ----------

    private isInRollBonusWindow(): boolean {
        if (!this.isJumpFlipRhythm() || !this.level || !this.level.rhythm) return false;
        const rolls: any[] = (this.level.rhythm as any).rolls || [];
        if (!rolls.length) return false;
        const t = Sfx.getMusicTime();
        return rolls.some(r => t >= Number(r.start) && t <= Number(r.end));
    }

    onRhythmSurfaceHit(x: number, y: number) {
        if (!this.isJumpFlipRhythm() || this.state !== "run") return;
        if (!this.isInRollBonusWindow()) return;
        this.rhythmScore += 100;
        Fx.popup(this.world, x, y + 34, "+100", cc.color(127, 247, 255));
        Fx.rhythmFlip(this.world, x, y);
        this.updateRhythmHud();
    }

    onCrystal() {
        this.crystalsTaken++;
        Sfx.play("crystal", 0.7);
        this.refreshHud();
    }

    onDeath(dead: Player) {
        if (this.state !== "run") return;
        this.deaths++;
        Sfx.play("death", 0.8);
        this.refreshHud();

        const survivor = this.anyAlive();
        if (survivor) {
            // partner carries on; camera follows them, dead player revives in 3s
            const follow = this.cameraNode.getComponent(CameraFollow);
            if (follow) follow.setTarget(survivor.node);
            this.scheduleOnce(() => {
                const s = this.anyAlive();
                if (this.state === "run" && s) {
                    dead.respawnAt(s.node.x - 50, s.node.y, s.getGravityDir());
                }
            }, 3);
            return;
        }

        // everyone is down
        if (this.isRhythmLevel()) {
            this.state = "dead";
            this.unscheduleAllCallbacks();
            Sfx.stopBgm();
            this.msgLabel.node.color = cc.color(255, 90, 100);
            this.setMsg("FAILED", this.rhythmSummary());
            this.scheduleOnce(() => {
                this.msgLabel.node.color = cc.color(235, 240, 255);
                this.respawnAll();
                this.state = "ready";
                this.setMsg("PRESS RHYTHM KEY TO START", this.controlsHint());
            }, 1.0);
            return;
        }
        if (this.endless) {
            this.endlessGameOver();
            return;
        }
        // brief fail screen, then auto-retry to keep the rhythm going
        this.state = "dead";
        this.unscheduleAllCallbacks();
        this.msgLabel.node.color = cc.color(255, 90, 100);
        this.setMsg("FAILED", "");
        this.scheduleOnce(() => {
            this.msgLabel.node.color = cc.color(235, 240, 255);
            this.setMsg("", "");
            this.respawnAll();
            this.state = "run";
        }, 0.9);
    }

    private anyAlive(): Player {
        for (const p of this.players) {
            if (p.alive) return p;
        }
        return null;
    }

    onWin(winner?: Player) {
        if (this.state !== "run") return;
        this.state = "win";
        this.unscheduleAllCallbacks();
        Sfx.play("win", 0.9);
        if (this.isRhythmLevel()) Sfx.stopBgm();
        // win animation: portal sucks the runner in + celebration burst
        Fx.confetti(this.world, this.level.goal.x, 0);
        if (winner && winner.node && winner.node.isValid) {
            winner.node.stopAllActions();
            cc.tween(winner.node)
                .to(0.55, { x: this.level.goal.x, y: 0, scale: 0, angle: 360 }, { easing: "sineIn" })
                .start();
        }
        const custom = GameData.currentLevel === 0;
        const pathLevel = !!GameData.currentLevelPath;
        const rhythm = this.isRhythmLevel();
        if (!custom && !pathLevel && !rhythm) {
            GameData.unlockNext(GameData.currentLevel);
            Fb.syncUp();
        }
        const last = pathLevel || rhythm || (!custom && GameData.currentLevel >= GameData.MAX_LEVEL);
        this.setMsg(
            last ? "YOU ESCAPED ASTRA-9!" : "LEVEL CLEAR!",
            (this.isRhythmLevel() ? this.rhythmSummary() : "CRYSTALS " + this.crystalsTaken + "/" + this.level.totalCrystals)
            + "    TIME " + this.formatTime(this.time)
            + (this.isRhythmLevel() ? "" : "    DEATHS " + this.deaths)
            + (custom ? "    SPACE = EDITOR    ESC = MENU"
                : last ? "    SPACE = MENU" : "    SPACE = NEXT    ESC = MENU")
        );
    }

    private proceedAfterWin() {
        if (this.endless) {
            Fx.fadeTo("Game", this.hud); // retry a fresh run
        } else if (GameData.currentLevel === 0) {
            Fx.fadeTo("Editor", this.hud);
        } else if (GameData.currentLevelPath) {
            Fx.fadeTo("Menu", this.hud);
        } else if (GameData.currentLevel < GameData.MAX_LEVEL) {
            GameData.currentLevel++;
            Fx.fadeTo("Game", this.hud);
        } else {
            Fx.fadeTo("Menu", this.hud);
        }
    }

    // ---------- per-frame ----------

    update(dt: number) {
        // keep HUD glued to the camera viewport
        if (this.hud && this.cameraNode) {
            this.hud.x = this.cameraNode.x;
            this.hud.y = this.cameraNode.y;
        }
        // animate field rotation at a constant rate, and re-anchor every frame
        // because the pivot (camera focus) keeps moving
        if (this.rotCurrent !== this.rotTarget) {
            const step = 110 * dt;
            const diff = this.rotTarget - this.rotCurrent;
            if (Math.abs(diff) <= step) this.rotCurrent = this.rotTarget;
            else this.rotCurrent += diff > 0 ? step : -step;
        }
        if (this.world) this.applyWorldRotation();
        if (this.state !== "run") return;

        this.time += dt;
        this.timeLabel.string = this.formatTime(this.time);
        if (this.isRhythmLevel()) this.updateRhythm();

        // endless: ramp speed, track distance, stream chunks ahead / drop behind
        if (this.endless) {
            this.level.speed = this.endlessBaseSpeed() + Math.min(240, this.distPx / 80);
            const lead = this.anyAlive();
            if (lead && lead.node.x > this.distPx) this.distPx = lead.node.x;
            this.distLabel.string = Math.floor(this.distPx / 10) + "m   BEST " + GameData.getBestDist() + "m";
            const camX = this.cameraNode.x;
            while (this.gen.getX() < camX + 1700) {
                const frag = this.gen.next(this.level.speed, this.distPx);
                this.appendChunk(frag, this.gen.getX());
            }
            while (this.chunks.length > 0 && this.chunks[0].endX < camX - 900) {
                this.dropChunk(this.chunks.shift());
            }
        }

        // slow-motion timer
        if (this.slowT > 0) {
            this.slowT -= dt;
            if (this.slowT <= 0) {
                this.timeScale = 1;
                this.slowOverlay.opacity = 0;
            }
        }

        // patrol drones oscillate on a fixed deterministic clock
        this.enemyT += dt * this.timeScale;
        for (const e of this.level.enemies) {
            const off = Math.sin((this.enemyT + e.phase) * Math.PI * 2 / e.period) * e.range;
            if (e.axis === "x") e.node.x = e.x0 + off;
            else e.node.y = e.y0 + off;
        }

        // piston bands: pow-shaped half-wave keeps them retracted >50% of the
        // cycle so they can be timed (or ridden while extending)
        for (const m of this.level.movers) {
            const s = Math.sin((this.enemyT + m.phase) * Math.PI * 2 / m.period);
            const off = s > 0 ? m.amp * Math.pow(s, 1.2) : 0;
            const d = m.dir * off;
            m.rect.y = m.baseY + d;
            for (let i = 0; i < m.nodes.length; i++) {
                m.nodes[i].y = m.baseYs[i] + d;
            }
        }

        // rotation zones track the leading living player
        const lead = this.anyAlive();
        if (lead) this.applyRotationForX(lead.node.x, false);
    }
}
