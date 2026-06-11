import GameData from "./GameData";
import Sfx from "./Sfx";

const { ccclass } = cc._decorator;

// Main menu — built entirely in code (the .fire scene only has Canvas + Camera).
@ccclass
export default class MenuCtrl extends cc.Component {

    private frames: { [k: string]: cc.SpriteFrame } = {};

    onLoad() {
        Sfx.preload();
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

    private sprite(frame: string, x: number, y: number, w: number, h: number, color?: cc.Color): cc.Node {
        const n = new cc.Node(frame);
        const sp = n.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames[frame];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(w, h);
        n.setPosition(x, y);
        if (color) n.color = color;
        this.node.addChild(n);
        return n;
    }

    private label(parent: cc.Node, text: string, x: number, y: number, size: number, color: cc.Color): cc.Node {
        const n = new cc.Node("label");
        n.setPosition(x, y);
        n.color = color;
        const lb = n.addComponent(cc.Label);
        lb.string = text;
        lb.fontSize = size;
        lb.lineHeight = size + 6;
        parent.addChild(n);
        return n;
    }

    private buildUi() {
        const cyan = cc.color(127, 247, 255);
        const orange = cc.color(255, 181, 74);
        const white = cc.color(235, 240, 255);
        const dim = cc.color(110, 120, 150);

        this.sprite("bg", 0, 0, 970, 650);

        // title
        this.label(this.node, "GRAVITY FLIP RUNNER", 0, 200, 58, cyan);
        this.label(this.node, "— ESCAPE ASTRA-9 —", 0, 145, 20, orange);

        // decorative player + spinning crystals
        const deco = this.sprite("player", -330, 30, 48, 48);
        cc.tween(deco)
            .to(1.2, { y: 55 }, { easing: "sineInOut" })
            .to(1.2, { y: 30 }, { easing: "sineInOut" })
            .repeatForever()
            .start();
        const c1 = this.sprite("crystal", 330, 40, 30, 30);
        cc.tween(c1).by(2.4, { angle: 360 }).repeatForever().start();

        // level buttons
        const unlocked = GameData.getUnlocked();
        for (let i = 1; i <= GameData.MAX_LEVEL; i++) {
            const open = i <= unlocked;
            const y = 40 - (i - 1) * 80;
            const btn = this.sprite("white", 0, y, 260, 60, open ? cc.color(24, 34, 76) : cc.color(22, 24, 34));
            const edge = this.sprite("white", 0, y - 28, 260, 3, open ? cyan : dim);
            edge.parent = this.node;
            this.label(btn, open ? "LEVEL " + i : "LEVEL " + i + "  [LOCKED]", 0, 0, 26, open ? white : dim);
            if (open) {
                btn.on(cc.Node.EventType.TOUCH_END, () => {
                    Sfx.play("click", 0.8);
                    GameData.currentLevel = i;
                    cc.director.loadScene("Game");
                });
            }
        }

        this.label(this.node,
            "SPACE / W / UP : FLIP GRAVITY      R : RESTART      ESC : PAUSE",
            0, -250, 16, dim);
        this.label(this.node, "SPACE = START", 0, -290, 16, cyan);
    }

    private onKeyDown(e: cc.Event.EventKeyboard) {
        if (e.keyCode === cc.macro.KEY.space) {
            GameData.currentLevel = 1;
            cc.director.loadScene("Game");
        }
    }
}
