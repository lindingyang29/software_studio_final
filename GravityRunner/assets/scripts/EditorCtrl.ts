import GameData from "./GameData";
import LevelBuilder, { FLOOR_Y, CEIL_Y } from "./LevelBuilder";
import Sfx from "./Sfx";
import Fx from "./Fx";

const { ccclass } = cc._decorator;

const GRID = 25;
const TOOLBAR_LEFT = -300; // screen-x left of this = toolbar zone, ignore clicks
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
    private toolbar: cc.Node = null;
    private toolbarVisible = true;
    private toggleLabel: cc.Label = null;
    private dragStart: { x: number; y: number } = null;
    private previewNode: cc.Node = null;
    private pendingTeleport: { x: number; y: number } = null;
    private hintTimer = 0;
    private mapPanel: cc.Node = null;
    private selectedMapSlot = -1;
    private readonly MAP_SLOTS_KEY = "gfr_editor_map_slots";

    onLoad() {
        Sfx.preload();
        Sfx.playBgm("bgm_menu");
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

        Fx.setFrame(this.frames["white"]);
        Fx.fadeIn(this.ui);
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
        this.data = this.starterData();
    }

    private saveCurrent(): boolean {
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

    private loadMapSlots(): any[] {
        let slots: any[] = [];
        try {
            const raw = cc.sys.localStorage.getItem(this.MAP_SLOTS_KEY);
            slots = raw ? JSON.parse(raw) : [];
        } catch (e) {
            slots = [];
        }
        while (slots.length < 3) slots.push(null);
        return slots.slice(0, 3);
    }

    private saveMapSlots(slots: any[]) {
        cc.sys.localStorage.setItem(this.MAP_SLOTS_KEY, JSON.stringify(slots.slice(0, 3)));
    }

    private mapSlotTitle(slot: any, idx: number): string {
        if (!slot || !slot.data) return "SLOT " + (idx + 1) + "   EMPTY";
        const d = new Date(slot.t || 0);
        const pad = (v: number) => (v < 10 ? "0" + v : "" + v);
        return "SLOT " + (idx + 1) + "   " + (slot.data.name || "MY LEVEL")
            + "   " + (d.getMonth() + 1) + "/" + d.getDate()
            + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    private closeMapPanel() {
        if (this.mapPanel) {
            this.mapPanel.destroy();
            this.mapPanel = null;
        }
        this.selectedMapSlot = -1;
    }

    private openMapPanel(selected: number = -1) {
        this.closeMapPanel();
        this.selectedMapSlot = selected;
        const white = cc.color(235, 240, 255);
        const orange = cc.color(255, 181, 74);
        const dim = cc.color(110, 120, 150);
        const slots = this.loadMapSlots();

        const panel = new cc.Node("mapSlots");
        const sp = panel.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["white"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        panel.setContentSize(560, selected >= 0 ? 320 : 270);
        panel.setPosition(130, 26);
        panel.color = cc.color(10, 12, 26);
        panel.opacity = 248;
        panel.zIndex = 80;
        panel.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.ui.addChild(panel);
        this.mapPanel = panel;

        const title = new cc.Node("title");
        title.setPosition(0, selected >= 0 ? 126 : 104);
        title.color = orange;
        const tl = title.addComponent(cc.Label);
        tl.string = "MAP SLOTS";
        tl.fontSize = 24;
        tl.lineHeight = 28;
        panel.addChild(title);

        const note = new cc.Node("note");
        note.setPosition(0, selected >= 0 ? 96 : 74);
        note.color = dim;
        const nl = note.addComponent(cc.Label);
        nl.string = "choose a slot, then save or load it into the editor";
        nl.fontSize = 13;
        nl.lineHeight = 16;
        panel.addChild(note);

        for (let i = 0; i < 3; i++) {
            const y = (selected >= 0 ? 52 : 30) - i * 48;
            const row = this.mkBtn(panel, this.mapSlotTitle(slots[i], i), 0, y, 500,
                i === selected ? cc.color(53, 100, 150) : cc.color(22, 30, 60), () => {
                    Sfx.play("click", 0.6);
                    this.openMapPanel(i);
                });
            const lb = row.getChildByName("l").getComponent(cc.Label);
            lb.fontSize = 14;
            lb.lineHeight = 16;
            row.getChildByName("l").color = slots[i] ? white : dim;
        }

        if (selected >= 0) {
            const slot = slots[selected];
            this.mkBtn(panel, "SAVE", -72, -122, 118, cc.color(20, 70, 40), () => {
                this.saveCurrent();
                const next = this.loadMapSlots();
                next[selected] = { t: Date.now(), data: JSON.parse(JSON.stringify(this.data)) };
                this.saveMapSlots(next);
                Sfx.play("power", 0.8);
                this.flashHint("SAVED TO SLOT " + (selected + 1));
                this.openMapPanel(selected);
            });
            const goBtn = this.mkBtn(panel, "GO TO MAP", 76, -122, 138,
                slot ? cc.color(24, 34, 76) : cc.color(36, 38, 46), () => {
                    const cur = this.loadMapSlots()[selected];
                    if (!cur || !cur.data) {
                        this.flashHint("SLOT " + (selected + 1) + " IS EMPTY");
                        return;
                    }
                    this.data = JSON.parse(JSON.stringify(cur.data));
                    cc.sys.localStorage.setItem(GameData.CUSTOM_KEY, JSON.stringify(this.data));
                    this.rebuild();
                    Sfx.play("click", 0.8);
                    this.flashHint("LOADED SLOT " + (selected + 1));
                    this.openMapPanel(selected);
                });
            goBtn.getChildByName("l").color = slot ? white : dim;
        }

        this.mkBtn(panel, "CLOSE", 0, selected >= 0 ? -164 : -108, 120, cc.color(50, 50, 60), () => {
            Sfx.play("click", 0.6);
            this.closeMapPanel();
        });
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
        // everything except the hint bar and the toggle tab lives in this
        // container so it can be hidden to reveal the full play area
        this.toolbar = new cc.Node("toolbar");
        this.ui.addChild(this.toolbar);

        // left-side vertical panel
        const bar = new cc.Node("bar");
        const sp = bar.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["white"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bar.setContentSize(180, 900);
        bar.setPosition(-394, 0);
        bar.color = cc.color(8, 10, 22);
        bar.opacity = 235;
        bar.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        this.toolbar.addChild(bar);

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
            const row = Math.floor(i / 2);
            const col = i % 2;
            const x = -437 + col * 84;
            const y = 282 - row * 40;
            this.toolButtons[t.id] = this.mkBtn(this.toolbar, t.label, x, y, 78, norm, () => {
                this.tool = t.id;
                this.pendingTeleport = null;
                this.refreshToolbar();
                Sfx.play("click", 0.6);
            });
        }

        // actions below the tool grid
        const spdBtn = this.mkBtn(this.toolbar, "SPD:" + this.data.speed, -395, 20, 162, cc.color(40, 30, 70), () => {
            this.data.speed = this.data.speed >= 340 ? 260 : this.data.speed + 40;
            spdBtn.getChildByName("l").getComponent(cc.Label).string = "SPD:" + this.data.speed;
            Sfx.play("click", 0.6);
        });
        this.mkBtn(this.toolbar, "SAVE", -437, -24, 78, cc.color(20, 70, 40), () => {
            Sfx.play("click", 0.7);
            this.openMapPanel();
        });
        this.mkBtn(this.toolbar, "TEST", -353, -24, 78, cc.color(70, 55, 15), () => {
            this.saveCurrent();
            GameData.currentLevel = 0;
            Fx.fadeTo("Game", this.ui);
        });
        this.mkBtn(this.toolbar, "CLEAR", -437, -64, 78, cc.color(70, 25, 35), () => {
            this.data = this.starterData();
            this.rebuild();
            this.flashHint("CLEARED TO STARTER LEVEL");
        });
        this.mkBtn(this.toolbar, "MENU", -353, -64, 78, cc.color(50, 50, 60), () => {
            Fx.fadeTo("Menu", this.ui);
        });

        const tn = new cc.Node("toolLabel");
        tn.setPosition(-395, -104);
        tn.color = cc.color(127, 247, 255);
        this.toolLabel = tn.addComponent(cc.Label);
        this.toolLabel.fontSize = 14;
        this.toolLabel.lineHeight = 16;
        this.toolbar.addChild(tn);

        // always-visible toggle tab at the top-left corner (also the T key)
        const tab = this.mkBtn(this.ui, "HIDE (T)", -430, 312, 90, cc.color(60, 70, 110), () => {
            this.toggleToolbar();
        });
        tab.setContentSize(90, 18);
        this.toggleLabel = tab.getChildByName("l").getComponent(cc.Label);
        this.toggleLabel.fontSize = 11;

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
            case "floor": return "DRAG horizontally to draw a FLOOR band   |   A/D or WHEEL = scroll   T = toolbar";
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

    private inUiZone(p: { x: number; y: number }): boolean {
        const screenX = p.x - this.cameraNode.x;
        return (this.toolbarVisible && screenX < TOOLBAR_LEFT) || p.y < HINT_BOTTOM;
    }

    private toggleToolbar() {
        this.toolbarVisible = !this.toolbarVisible;
        this.toolbar.active = this.toolbarVisible;
        this.toggleLabel.string = this.toolbarVisible ? "HIDE (T)" : "SHOW (T)";
        Sfx.play("click", 0.6);
    }

    private onTouchStart(e: cc.Event.EventTouch) {
        const p = this.toWorld(e);
        if (this.inUiZone(p)) {
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
        if (this.inUiZone(p)) return;

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
            case cc.macro.KEY.t:
                this.toggleToolbar();
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
