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
    private rotCurrent = 0;
    private rotTarget = 0;

    private nameLabel: cc.Label = null;
    private crystalLabel: cc.Label = null;
    private deathLabel: cc.Label = null;
    private timeLabel: cc.Label = null;
    private msgLabel: cc.Label = null;
    private subLabel: cc.Label = null;
    private slowOverlay: cc.Node = null;
    private pausePanel: cc.Node = null;

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
            p.init(this, this.level, i, this.frames);
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
            case cc.macro.KEY.q:
                if (this.state === "paused") {
                    cc.director.loadScene("Menu");
                }
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
            this.buildPauseMenu();
        } else if (this.state === "paused") {
            this.state = "run";
            this.closePauseMenu();
            this.setMsg("", "");
        } else if (this.state === "win") {
            cc.director.loadScene("Menu");
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
        mkBtn("MAIN MENU  (Q)", -100, () => cc.director.loadScene("Menu"));
    }

    private closePauseMenu() {
        if (this.pausePanel) {
            this.pausePanel.destroy();
            this.pausePanel = null;
        }
    }

    private fullRestart() {
        if (this.state === "loading" || this.players.length === 0) return;
        this.unscheduleAllCallbacks();
        this.closePauseMenu();
        this.respawnAll();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN", "");
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
        this.refreshHud();
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
