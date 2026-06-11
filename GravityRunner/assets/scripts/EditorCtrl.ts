import GameData from "./GameData";
import LevelBuilder, { FLOOR_Y, CEIL_Y } from "./LevelBuilder";
import Sfx from "./Sfx";

const { ccclass } = cc._decorator;

const GRID = 25;
const TOOLBAR_TOP = 230;   // world-y above this = toolbar zone, ignore clicks
const HINT_BOTTOM = -280;  // world-y below this = hint bar zone

// In-game level editor. Players build a custom level with the same JSON
// schema as resources/levels/*.json, stored in localStorage
// (GameData.CUSTOM_KEY). TEST plays it via the Game scene
// (GameData.currentLevel = 0 means "custom level").
@ccclass
export default class EditorCtrl extends cc.Component {

    private frames: { [k: string]: cc.SpriteFrame } = {};
    private cameraNode: cc.Node = null;
    private world: cc.Node = null;
    private ui: cc.Node = null;

    private data: any = null;
    private tool = "floor";
    private toolButtons: { [t: string]: cc.Node } = {};
    private toolLabel: cc.Label = null;
    private hintLabel: cc.Label = null;
    private posLabel: cc.Label = null;
    private dragStart: { x: number; y: number } = null;
    private previewNode: cc.Node = null;
    private pendingTeleport: { x: number; y: number } = null;
    private hintTimer = 0;

    onLoad() {
        Sfx.preload();
        this.cameraNode = this.node.getChildByName("Main Camera");
        cc.resources.loadDir("textures", cc.SpriteFrame, (err, assets: cc.SpriteFrame[]) => {
            if (err) {
                cc.error("texture load failed", err);
                return;
            }
            for (const a of assets) this.frames[a.name] = a;
            this.start2();
        });
    }

    private start2() {
        // background follows the camera
        const bg = new cc.Node("BG");
        const bgSp = bg.addComponent(cc.Sprite);
        bgSp.spriteFrame = this.frames["bg"];
        bgSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bg.setContentSize(1400, 1400);
        bg.color = cc.color(140, 140, 160); // dimmed: editor mode
        this.cameraNode.addChild(bg, -10);

        this.world = new cc.Node("World");
        this.node.addChild(this.world);

        this.ui = new cc.Node("UI");
        this.node.addChild(this.ui, 100);

        this.loadData();

        // Touch hit-testing goes through the camera in Cocos 2.x: a static
        // full-screen node stops receiving touches once the camera scrolls
        // away from it. So the click catcher lives inside `ui`, which is
        // re-glued to the camera every frame.
        const catcher = new cc.Node("inputCatcher");
        catcher.setContentSize(1700, 900);
        catcher.on(cc.Node.EventType.TOUCH_START, this.onTouchStart, this);
        catcher.on(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        catcher.on(cc.Node.EventType.TOUCH_END, this.onTouchEnd, this);
        catcher.on(cc.Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        catcher.on(cc.Node.EventType.MOUSE_WHEEL, this.onWheel, this);
        this.ui.addChild(catcher, -1);

        this.buildToolbar();
        this.rebuild();

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        this.cameraNode.x = 0;
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
    }

    // ---------- data ----------

    private starterData(): any {
        return {
            name: "MY LEVEL",
            speed: 300,
            length: 2400,
            start: { x: -300, side: "floor" },
            segments: [
                { x: -500, w: 2700, side: "floor" },
                { x: -500, w: 2700, side: "ceiling" }
            ],
            platforms: [],
            movers: [],
            powerups: [],
            teleports: [],
            enemies: [],
            rotations: [],
            spikes: [],
            crystals: [],
            goal: { x: 2000 }
        };
    }

    private loadData() {
        const raw = cc.sys.localStorage.getItem(GameData.CUSTOM_KEY);
        if (raw) {
            try {
                this.data = JSON.parse(raw);
            } catch (e) {
                this.data = null;
            }
        }
        if (!this.data || !this.data.goal) this.data = this.starterData();
    }

    private save(): boolean {
        // level length follows the content
        let maxX = this.data.goal.x;
        for (const s of this.data.segments) maxX = Math.max(maxX, s.x + s.w);
        this.data.length = Math.max(this.data.goal.x + 400, maxX);
        cc.sys.localStorage.setItem(GameData.CUSTOM_KEY, JSON.stringify(this.data));
        const hasStartFloor = this.data.segments.some((s: any) =>
            s.side === "floor" && s.x <= -320 && s.x + s.w >= -260);
        this.flashHint(hasStartFloor ? "SAVED!" : "SAVED — WARNING: NO FLOOR UNDER START (x=-300)!");
        return true;
    }

    // ---------- rendering ----------

    private rebuild() {
        this.world.destroyAllChildren();
        this.world.removeAllChildren();

        // corridor guide lines across the whole editable range
        const guideW = Math.max(this.data.goal.x, 4000) + 2000;
        const mk = (y: number) => {
            const g = new cc.Node("guide");
            const sp = g.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            g.setContentSize(guideW, 2);
            g.setPosition(guideW / 2 - 1000, y);
            g.opacity = 50;
            this.world.addChild(g, -1);
        };
        mk(FLOOR_Y);
        mk(CEIL_Y);

        LevelBuilder.build(this.world, this.data, this.frames);

        // start marker (ghost player)
        const ghost = new cc.Node("start");
        const gs = ghost.addComponent(cc.Sprite);
        gs.spriteFrame = this.frames["player"];
        gs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        ghost.setContentSize(36, 36);
        ghost.setPosition(-300, FLOOR_Y + 18);
        ghost.opacity = 140;
        this.world.addChild(ghost, 6);
    }

    // ---------- toolbar ----------

    private mkBtn(parent: cc.Node, text: string, x: number, y: number, w: number, color: cc.Color, cb: (e: cc.Event.EventTouch) => void): cc.Node {
        const btn = new cc.Node("btn-" + text);
        const sp = btn.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["white"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        btn.setContentSize(w, 30);
        btn.setPosition(x, y);
        btn.color = color;
        parent.addChild(btn);
        const lbn = new cc.Node("l");
        const lb = lbn.addComponent(cc.Label);
        lb.string = text;
        lb.fontSize = 13;
        lb.lineHeight = 15;
        btn.addChild(lbn);
        btn.on(cc.Node.EventType.TOUCH_END, (e: cc.Event.EventTouch) => {
            e.stopPropagation();
            cb(e);
        });
        btn.on(cc.Node.EventType.TOUCH_START, (e: cc.Event.EventTouch) => {
            e.stopPropagation();
        });
        return btn;
    }

    private buildToolbar() {
        const bar = new cc.Node("bar");
        const sp = bar.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["white"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bar.setContentSize(1400, 96);
        bar.setPosition(0, 320 - 48);
        bar.color = cc.color(8, 10, 22);
        bar.opacity = 235;
        bar.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.ui.addChild(bar);

        const hintBar = new cc.Node("hintbar");
        const hb = hintBar.addComponent(cc.Sprite);
        hb.spriteFrame = this.frames["white"];
        hb.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        hintBar.setContentSize(1400, 44);
        hintBar.setPosition(0, -320 + 22);
        hintBar.color = cc.color(8, 10, 22);
        hintBar.opacity = 235;
        hintBar.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.ui.addChild(hintBar);

        const toolDef: { id: string; label: string }[] = [
            { id: "floor", label: "FLOOR" },
            { id: "ceiling", label: "CEIL" },
            { id: "piston", label: "PISTON" },
            { id: "spike", label: "SPIKE" },
            { id: "goal", label: "GOAL" },
            { id: "drone", label: "DRONE" },
            { id: "tport", label: "TPORT" },
            { id: "crystal", label: "CRYST" },
            { id: "shield", label: "SHIELD" },
            { id: "slow", label: "SLOW" },
            { id: "magnet", label: "MAGNET" },
            { id: "erase", label: "ERASE" }
        ];
        const norm = cc.color(24, 34, 76);
        for (let i = 0; i < toolDef.length; i++) {
            const t = toolDef[i];
            const row = i < 7 ? 0 : 1;
            const col = i < 7 ? i : i - 7;
            const x = -445 + col * 78;
            const y = row === 0 ? 296 : 258;
            this.toolButtons[t.id] = this.mkBtn(this.ui, t.label, x, y, 72, norm, () => {
                this.tool = t.id;
                this.pendingTeleport = null;
                this.refreshToolbar();
                Sfx.play("click", 0.6);
            });
        }

        // actions on the right
        this.mkBtn(this.ui, "SPD:" + this.data.speed, 130, 258, 90, cc.color(40, 30, 70), () => {
            this.data.speed = this.data.speed >= 340 ? 260 : this.data.speed + 40;
            const b = this.ui.getChildByName("btn-SPD:260") || this.ui.getChildByName("btn-SPD:300") || this.ui.getChildByName("btn-SPD:340");
            if (b) b.getChildByName("l").getComponent(cc.Label).string = "SPD:" + this.data.speed;
            Sfx.play("click", 0.6);
        });
        this.mkBtn(this.ui, "SAVE", 230, 296, 80, cc.color(20, 70, 40), () => { this.save(); Sfx.play("power", 0.7); });
        this.mkBtn(this.ui, "TEST", 320, 296, 80, cc.color(70, 55, 15), () => {
            this.save();
            GameData.currentLevel = 0;
            cc.director.loadScene("Game");
        });
        this.mkBtn(this.ui, "CLEAR", 230, 258, 80, cc.color(70, 25, 35), () => {
            this.data = this.starterData();
            this.rebuild();
            this.flashHint("CLEARED TO STARTER LEVEL");
        });
        this.mkBtn(this.ui, "MENU", 320, 258, 80, cc.color(50, 50, 60), () => {
            cc.director.loadScene("Menu");
        });

        const tn = new cc.Node("toolLabel");
        tn.setPosition(420, 296);
        tn.color = cc.color(127, 247, 255);
        this.toolLabel = tn.addComponent(cc.Label);
        this.toolLabel.fontSize = 14;
        this.toolLabel.lineHeight = 16;
        this.ui.addChild(tn);

        const hn = new cc.Node("hint");
        hn.setPosition(-120, -320 + 22);
        hn.color = cc.color(180, 190, 220);
        this.hintLabel = hn.addComponent(cc.Label);
        this.hintLabel.fontSize = 14;
        this.hintLabel.lineHeight = 16;
        this.ui.addChild(hn);

        const pn = new cc.Node("pos");
        pn.setPosition(330, -320 + 22);
        pn.color = cc.color(255, 181, 74);
        this.posLabel = pn.addComponent(cc.Label);
        this.posLabel.fontSize = 14;
        this.posLabel.lineHeight = 16;
        this.ui.addChild(pn);

        this.refreshToolbar();
    }

    private refreshToolbar() {
        const sel = cc.color(53, 100, 150);
        const norm = cc.color(24, 34, 76);
        for (const id in this.toolButtons) {
            this.toolButtons[id].color = id === this.tool ? sel : norm;
        }
        this.toolLabel.string = "TOOL: " + this.tool.toUpperCase();
        this.flashHint(this.toolHint(), 9999);
    }

    private toolHint(): string {
        switch (this.tool) {
            case "floor": return "DRAG horizontally to draw a FLOOR band   |   A/D or WHEEL = scroll";
            case "ceiling": return "DRAG horizontally to draw a CEILING band";
            case "piston": return "CLICK to place a piston (lower half = floor side, upper = ceiling)";
            case "spike": return "CLICK to place a spike (lower half = floor, upper = ceiling)";
            case "goal": return "CLICK to move the goal portal (defines level end)";
            case "drone": return "CLICK to place a patrol drone (oscillates vertically)";
            case "tport": return this.pendingTeleport ? "CLICK the EXIT position (must be to the right)" : "CLICK the teleporter ENTRY position";
            case "erase": return "CLICK on an object to delete it";
            default: return "CLICK to place " + this.tool.toUpperCase();
        }
    }

    private flashHint(text: string, seconds: number = 2.5) {
        this.hintLabel.string = text;
        this.hintTimer = seconds;
    }

    // ---------- input ----------

    private toWorld(e: cc.Event.EventTouch): { x: number; y: number } {
        const loc = e.getLocation();
        return {
            x: this.cameraNode.x + (loc.x - cc.winSize.width / 2),
            y: loc.y - cc.winSize.height / 2
        };
    }

    private snap(v: number): number {
        return Math.round(v / GRID) * GRID;
    }

    private inUiZone(y: number): boolean {
        return y > TOOLBAR_TOP || y < HINT_BOTTOM;
    }

    private onTouchStart(e: cc.Event.EventTouch) {
        const p = this.toWorld(e);
        if (this.inUiZone(p.y)) {
            this.dragStart = null;
            return;
        }
        this.dragStart = p;
        if ((this.tool === "floor" || this.tool === "ceiling") && this.previewNode == null) {
            this.previewNode = new cc.Node("preview");
            const sp = this.previewNode.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            this.previewNode.opacity = 120;
            this.previewNode.color = cc.color(127, 247, 255);
            this.world.addChild(this.previewNode, 20);
            this.previewNode.active = false;
        }
    }

    private onTouchMove(e: cc.Event.EventTouch) {
        if (!this.dragStart || !this.previewNode) return;
        if (this.tool !== "floor" && this.tool !== "ceiling") return;
        const p = this.toWorld(e);
        const x0 = Math.min(this.dragStart.x, p.x);
        const x1 = Math.max(this.dragStart.x, p.x);
        const y = this.tool === "floor" ? FLOOR_Y - 35 : CEIL_Y + 35;
        this.previewNode.active = x1 - x0 > 30;
        this.previewNode.setContentSize(Math.max(10, x1 - x0), 70);
        this.previewNode.setPosition((x0 + x1) / 2, y);
    }

    private onTouchEnd(e: cc.Event.EventTouch) {
        if (this.previewNode) {
            this.previewNode.destroy();
            this.previewNode = null;
        }
        if (!this.dragStart) return;
        const start = this.dragStart;
        this.dragStart = null;
        const p = this.toWorld(e);
        if (this.inUiZone(p.y)) return;

        if (this.tool === "floor" || this.tool === "ceiling") {
            const x0 = this.snap(Math.min(start.x, p.x));
            const x1 = this.snap(Math.max(start.x, p.x));
            if (x1 - x0 < 75) {
                this.flashHint("DRAG a wider area for a band (min 75px)");
                return;
            }
            this.data.segments.push({ x: x0, w: x1 - x0, side: this.tool });
            this.commit();
            return;
        }

        const x = this.snap(p.x);
        const y = this.snap(p.y);
        const side = p.y < 0 ? "floor" : "ceiling";
        switch (this.tool) {
            case "spike":
                this.data.spikes.push({ x: x, side: side });
                break;
            case "piston":
                this.data.movers.push({ x: x - 140, w: 280, side: side, amp: 140, period: 2.2, phase: 0 });
                break;
            case "goal":
                this.data.goal.x = x;
                break;
            case "drone":
                this.data.enemies.push({ x: x, y: Math.max(-160, Math.min(160, y)), axis: "y", range: 120, period: 2 });
                break;
            case "crystal":
                this.data.crystals.push({ x: x, y: Math.max(-212, Math.min(212, y)) });
                break;
            case "shield":
            case "slow":
            case "magnet":
                this.data.powerups.push({ x: x, y: Math.max(-212, Math.min(212, y)), type: this.tool });
                break;
            case "tport":
                if (!this.pendingTeleport) {
                    this.pendingTeleport = { x: x, y: Math.max(-212, Math.min(212, y)) };
                    this.flashHint("CLICK the EXIT position (must be to the right)", 9999);
                    return;
                }
                if (x < this.pendingTeleport.x + 60) {
                    this.flashHint("EXIT must be at least 60px to the RIGHT of the entry!");
                    return;
                }
                this.data.teleports.push({
                    x: this.pendingTeleport.x, y: this.pendingTeleport.y,
                    tx: x, ty: Math.max(-212, Math.min(212, y))
                });
                this.pendingTeleport = null;
                break;
            case "erase":
                this.eraseAt(p.x, p.y);
                break;
        }
        this.commit();
    }

    private commit() {
        this.rebuild();
        Sfx.play("click", 0.4);
        if (this.tool !== "tport") this.flashHint(this.toolHint(), 9999);
    }

    private eraseAt(x: number, y: number) {
        const near = (ax: number, ay: number, r: number) =>
            Math.abs(ax - x) < r && Math.abs(ay - y) < r;
        const arrays: { list: any[]; pos: (o: any) => number[]; r: number }[] = [
            { list: this.data.crystals, pos: (o) => [o.x, o.y], r: 30 },
            { list: this.data.powerups, pos: (o) => [o.x, o.y], r: 35 },
            { list: this.data.enemies, pos: (o) => [o.x, o.y], r: 40 },
            { list: this.data.spikes, pos: (o) => [o.x, o.side === "floor" ? FLOOR_Y + 20 : CEIL_Y - 20], r: 40 }
        ];
        for (const a of arrays) {
            for (let i = 0; i < a.list.length; i++) {
                const pp = a.pos(a.list[i]);
                if (near(pp[0], pp[1], a.r)) {
                    a.list.splice(i, 1);
                    return;
                }
            }
        }
        // teleports: clicking entry or exit removes the pair
        for (let i = 0; i < this.data.teleports.length; i++) {
            const t = this.data.teleports[i];
            if (near(t.x, t.y, 40) || near(t.tx, t.ty, 40)) {
                this.data.teleports.splice(i, 1);
                return;
            }
        }
        // pistons: click inside the band
        for (let i = 0; i < this.data.movers.length; i++) {
            const m = this.data.movers[i];
            const cy = m.side === "floor" ? FLOOR_Y - 35 : CEIL_Y + 35;
            if (x >= m.x && x <= m.x + m.w && Math.abs(y - cy) < 60) {
                this.data.movers.splice(i, 1);
                return;
            }
        }
        // segments: click inside the band
        for (let i = 0; i < this.data.segments.length; i++) {
            const s = this.data.segments[i];
            const cy = s.side === "floor" ? FLOOR_Y - 35 : CEIL_Y + 35;
            if (x >= s.x && x <= s.x + s.w && Math.abs(y - cy) < 45) {
                this.data.segments.splice(i, 1);
                return;
            }
        }
        this.flashHint("nothing here to erase");
    }

    private onWheel(e: cc.Event.EventMouse) {
        this.scrollCamera(-e.getScrollY());
    }

    private onKeyDown(e: cc.Event.EventKeyboard) {
        switch (e.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                this.scrollCamera(-180);
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.scrollCamera(180);
                break;
        }
    }

    private scrollCamera(dx: number) {
        const maxX = Math.max(this.data.goal.x + 2000, 5000);
        this.cameraNode.x = Math.max(0, Math.min(maxX, this.cameraNode.x + dx));
    }

    // ---------- per-frame ----------

    update(dt: number) {
        if (this.ui && this.cameraNode) {
            this.ui.x = this.cameraNode.x;
        }
        if (this.hintTimer > 0) {
            this.hintTimer -= dt;
            if (this.hintTimer <= 0) this.hintLabel.string = this.toolHint();
        }
        if (this.posLabel && this.data) {
            let maxX = this.data.goal.x;
            for (const s of this.data.segments) maxX = Math.max(maxX, s.x + s.w);
            this.posLabel.string = "VIEW " + Math.round(this.cameraNode.x)
                + "   GOAL " + this.data.goal.x
                + "   LENGTH " + Math.max(this.data.goal.x + 400, maxX);
        }
    }
}
