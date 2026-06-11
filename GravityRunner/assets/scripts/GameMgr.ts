import GameData from "./GameData";
import LevelBuilder, { LevelData } from "./LevelBuilder";
import Player from "./Player";
import CameraFollow from "./CameraFollow";
import Sfx from "./Sfx";

const { ccclass } = cc._decorator;

type GameState = "loading" | "ready" | "run" | "dead" | "win" | "paused";

// Owns the Game scene: loads assets + level JSON, builds the world through
// LevelBuilder, spawns the Player, and runs the ready/run/dead/win state machine.
// Everything (world, HUD) is created in code — the .fire scene stays minimal.
@ccclass
export default class GameMgr extends cc.Component {

    private cameraNode: cc.Node = null;
    private world: cc.Node = null;
    private hud: cc.Node = null;
    private player: Player = null;
    private level: LevelData = null;
    private frames: { [k: string]: cc.SpriteFrame } = {};

    private state: GameState = "loading";
    private time = 0;
    private deaths = 0;
    private crystalsTaken = 0;

    private nameLabel: cc.Label = null;
    private crystalLabel: cc.Label = null;
    private deathLabel: cc.Label = null;
    private timeLabel: cc.Label = null;
    private msgLabel: cc.Label = null;
    private subLabel: cc.Label = null;

    isRunning(): boolean {
        return this.state === "run";
    }

    onLoad() {
        Sfx.preload();
        this.cameraNode = this.node.getChildByName("Main Camera");

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        this.node.on(cc.Node.EventType.TOUCH_START, this.onAction, this);

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
        // background rides along as a child of the camera
        const bg = new cc.Node("BG");
        const bgSp = bg.addComponent(cc.Sprite);
        bgSp.spriteFrame = this.frames["bg"];
        bgSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bg.setContentSize(970, 650);
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

        const pNode = new cc.Node("Player");
        const sp = pNode.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["player"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        pNode.setContentSize(36, 36);
        this.world.addChild(pNode, 5);
        this.player = pNode.addComponent(Player);
        this.player.init(this, this.level);

        const follow = this.cameraNode.addComponent(CameraFollow);
        follow.init(pNode, 0, this.level.length - 480);
        follow.snap();

        this.time = 0;
        this.deaths = 0;
        this.crystalsTaken = 0;
        this.nameLabel.string = "LEVEL " + GameData.currentLevel + " — " + this.level.name;
        this.refreshHud();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN", "SPACE / W / UP = FLIP GRAVITY    R = RESTART    ESC = PAUSE");
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
        // HUD is a sibling of the world; GameMgr keeps it glued to the camera.
        this.hud = new cc.Node("HUD");
        this.node.addChild(this.hud, 100);

        const cyan = cc.color(127, 247, 255);
        const pink = cc.color(255, 122, 200);
        const orange = cc.color(255, 181, 74);
        const white = cc.color(235, 240, 255);

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
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.onAction();
                break;
            case cc.macro.KEY.r:
                this.fullRestart();
                break;
            case cc.macro.KEY.escape:
                this.togglePause();
                break;
        }
    }

    private onAction() {
        switch (this.state) {
            case "ready":
                this.state = "run";
                this.setMsg("", "");
                break;
            case "run":
                this.player.flip();
                break;
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
            Sfx.stopBgm();
            cc.director.loadScene("Menu");
        }
    }

    private fullRestart() {
        if (this.state === "loading" || !this.player) return;
        this.unscheduleAllCallbacks();
        this.respawn();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN", "");
    }

    private respawn() {
        this.player.reset();
        for (const c of this.level.crystals) {
            c.taken = false;
            c.node.active = true;
        }
        this.crystalsTaken = 0;
        this.time = 0;
        const follow = this.cameraNode.getComponent(CameraFollow);
        if (follow) follow.snap();
        this.refreshHud();
    }

    // ---------- callbacks from Player ----------

    onCrystal() {
        this.crystalsTaken++;
        Sfx.play("crystal", 0.7);
        this.refreshHud();
    }

    onDeath() {
        if (this.state !== "run") return;
        this.deaths++;
        Sfx.play("death", 0.8);
        this.state = "dead";
        this.refreshHud();
        // quick auto-retry keeps the rhythm going
        this.scheduleOnce(() => {
            this.respawn();
            this.state = "run";
        }, 0.8);
    }

    onWin() {
        if (this.state !== "run") return;
        this.state = "win";
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
        if (this.state === "run") {
            this.time += dt;
            this.timeLabel.string = this.formatTime(this.time);
        }
    }
}
