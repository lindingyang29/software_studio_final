import GameData from "./GameData";
import LevelBuilder, { LevelData } from "./LevelBuilder";
import Player from "./Player";
import CameraFollow from "./CameraFollow";
import Sfx from "./Sfx";

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
    private curRotation = 0;

    private nameLabel: cc.Label = null;
    private crystalLabel: cc.Label = null;
    private deathLabel: cc.Label = null;
    private timeLabel: cc.Label = null;
    private msgLabel: cc.Label = null;
    private subLabel: cc.Label = null;
    private slowOverlay: cc.Node = null;

    isRunning(): boolean {
        return this.state === "run";
    }

    onLoad() {
        Sfx.preload();
        Sfx.playBgm();
        this.cameraNode = this.node.getChildByName("Main Camera");

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        this.node.on(cc.Node.EventType.TOUCH_START, this.onTouch, this);

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

        cc.resources.load("levels/level" + GameData.currentLevel, cc.JsonAsset, (err, asset: cc.JsonAsset) => {
            if (err) {
                this.setMsg("LEVEL " + GameData.currentLevel + " LOAD ERROR", "");
                cc.error(err);
                return;
            }
            this.startLevel(asset.json);
        });
    }

    private startLevel(data: any) {
        this.level = LevelBuilder.build(this.world, data, this.frames);

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
            p.init(this, this.level, i, this.frames["shield"]);
            this.players.push(p);
        }

        const follow = this.cameraNode.addComponent(CameraFollow);
        follow.init(this.players[0].node, 0, this.level.length - 480);
        follow.snap();

        this.time = 0;
        this.deaths = 0;
        this.crystalsTaken = 0;
        this.timeScale = 1;
        this.enemyT = 0;
        this.applyRotationForX(this.level.start.x, true);
        this.nameLabel.string = "LEVEL " + GameData.currentLevel + " — " + this.level.name
            + (count === 2 ? "   [2P]" : "");
        this.refreshHud();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN",
            count === 2
                ? "P1: W = FLIP      P2: UP / SPACE = FLIP      R = RESTART"
                : "SPACE / W / UP = FLIP GRAVITY    R = RESTART    ESC = PAUSE");
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
        this.msgLabel = this.makeLabel(this.hud, 0, 40, 44, white);
        this.subLabel = this.makeLabel(this.hud, 0, -10, 18, cyan);
    }

    private refreshHud() {
        this.crystalLabel.string = "CRYSTALS  " + this.crystalsTaken + " / " + this.level.totalCrystals;
        this.deathLabel.string = "DEATHS  " + this.deaths;
        this.timeLabel.string = this.formatTime(this.time);
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

    private onKeyDown(e: cc.Event.EventKeyboard) {
        switch (e.keyCode) {
            case cc.macro.KEY.space:
            case cc.macro.KEY.up:
                this.onAction(1);
                break;
            case cc.macro.KEY.w:
                this.onAction(0);
                break;
            case cc.macro.KEY.r:
                this.fullRestart();
                break;
            case cc.macro.KEY.escape:
                this.togglePause();
                break;
        }
    }

    private onTouch(e: cc.Event.EventTouch) {
        // 2P touch: left half of the screen = P1, right half = P2
        const half = cc.winSize.width / 2;
        this.onAction(e.getLocationX() < half ? 0 : 1);
    }

    // who: 0 = P1 input, 1 = P2 input (in solo mode every input drives P1)
    private onAction(who: number) {
        switch (this.state) {
            case "ready":
                this.state = "run";
                this.setMsg("", "");
                break;
            case "run": {
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
            this.setMsg("PAUSED", "SPACE = RESUME    R = RESTART");
        } else if (this.state === "paused") {
            this.state = "run";
            this.setMsg("", "");
        } else if (this.state === "win") {
            cc.director.loadScene("Menu");
        }
    }

    private fullRestart() {
        if (this.state === "loading" || this.players.length === 0) return;
        this.unscheduleAllCallbacks();
        this.respawnAll();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN", "");
    }

    private respawnAll() {
        for (const p of this.players) p.reset();
        for (const c of this.level.crystals) {
            c.taken = false;
            c.node.active = true;
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
        this.refreshHud();
    }

    // ---------- rotation zones ----------

    // Visual trick: rotating the camera node makes the whole corridor appear
    // rotated (gravity "becomes" left/right at 90deg) while physics stay 1D.
    // BG (camera child) and HUD (angle-synced) stay screen-aligned.
    private applyRotationForX(x: number, instant: boolean) {
        let target = 0;
        for (const r of this.level.rotations) {
            if (x >= r.x) target = r.angle;
        }
        if (target === this.curRotation && !instant) return;
        if (target !== this.curRotation) Sfx.play("teleport", 0.4);
        this.curRotation = target;
        cc.Tween.stopAllByTarget(this.cameraNode);
        if (instant) {
            this.cameraNode.angle = -target;
        } else {
            cc.tween(this.cameraNode)
                .to(0.9, { angle: -target }, { easing: "sineInOut" })
                .start();
        }
    }

    // ---------- power-up support ----------

    applySlow(seconds: number, scale: number) {
        this.slowT = seconds;
        this.timeScale = scale;
        this.slowOverlay.opacity = 50;
    }

    // ---------- callbacks from Player ----------

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

        // everyone is down — quick auto-retry keeps the rhythm going
        this.state = "dead";
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => {
            this.respawnAll();
            this.state = "run";
        }, 0.8);
    }

    private anyAlive(): Player {
        for (const p of this.players) {
            if (p.alive) return p;
        }
        return null;
    }

    onWin() {
        if (this.state !== "run") return;
        this.state = "win";
        this.unscheduleAllCallbacks();
        Sfx.play("win", 0.9);
        GameData.unlockNext(GameData.currentLevel);
        const last = GameData.currentLevel >= GameData.MAX_LEVEL;
        this.setMsg(
            last ? "YOU ESCAPED ASTRA-9!" : "LEVEL CLEAR!",
            "CRYSTALS " + this.crystalsTaken + "/" + this.level.totalCrystals
            + "    TIME " + this.formatTime(this.time)
            + "    DEATHS " + this.deaths
            + (last ? "    SPACE = MENU" : "    SPACE = NEXT    ESC = MENU")
        );
    }

    private proceedAfterWin() {
        if (GameData.currentLevel < GameData.MAX_LEVEL) {
            GameData.currentLevel++;
            cc.director.loadScene("Game");
        } else {
            cc.director.loadScene("Menu");
        }
    }

    // ---------- per-frame ----------

    update(dt: number) {
        // keep HUD glued to the camera viewport (position + rotation)
        if (this.hud && this.cameraNode) {
            this.hud.x = this.cameraNode.x;
            this.hud.y = this.cameraNode.y;
            this.hud.angle = this.cameraNode.angle;
        }
        if (this.state !== "run") return;

        this.time += dt;
        this.timeLabel.string = this.formatTime(this.time);

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

        // rotation zones track the leading living player
        const lead = this.anyAlive();
        if (lead) this.applyRotationForX(lead.node.x, false);
    }
}
