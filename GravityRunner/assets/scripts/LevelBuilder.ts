// Builds a level from a JSON file in resources/levels/.
// All collision is plain AABB data (center x/y + w/h); visuals are tinted sprites.
//
// Corridor layout (world coordinates, y=0 is the corridor center):
//   ceiling surface  y = +250
//   floor surface    y = -250
// Solid bands are THICK px deep behind each surface.

export const FLOOR_Y = -250;
export const CEIL_Y = 250;
export const THICK = 70;

export interface RectDef {
    x: number; // center
    y: number; // center
    w: number;
    h: number;
}

export interface CrystalRef {
    x: number;
    y: number;
    taken: boolean;
    node: cc.Node;
}

export interface LevelData {
    name: string;
    speed: number;
    length: number;
    start: { x: number; y: number };
    solids: RectDef[];
    spikes: RectDef[];
    crystals: CrystalRef[];
    goal: RectDef;
    totalCrystals: number;
}

const COL_PLATFORM = cc.color(20, 26, 58);
const COL_EDGE_FLOOR = cc.color(53, 240, 255);   // cyan
const COL_EDGE_CEIL = cc.color(255, 122, 200);   // pink
const COL_GOAL_GLOW = cc.color(255, 181, 74);

export default class LevelBuilder {

    static build(world: cc.Node, data: any, frames: { [k: string]: cc.SpriteFrame }): LevelData {
        const solids: RectDef[] = [];
        const spikes: RectDef[] = [];
        const crystals: CrystalRef[] = [];

        const sprite = (frame: string, x: number, y: number, w: number, h: number, color?: cc.Color, z?: number) => {
            const n = new cc.Node(frame);
            const sp = n.addComponent(cc.Sprite);
            sp.spriteFrame = frames[frame];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            n.setContentSize(w, h);
            n.setPosition(x, y);
            if (color) n.color = color;
            if (z !== undefined) n.zIndex = z;
            world.addChild(n);
            return n;
        };

        // --- floor / ceiling segments ---
        for (const seg of (data.segments || [])) {
            const isFloor = seg.side === "floor";
            const cy = isFloor ? FLOOR_Y - THICK / 2 : CEIL_Y + THICK / 2;
            const cx = seg.x + seg.w / 2;
            solids.push({ x: cx, y: cy, w: seg.w, h: THICK });
            sprite("white", cx, cy, seg.w, THICK, COL_PLATFORM);
            // neon edge on the inner (corridor-facing) surface
            const edgeY = isFloor ? FLOOR_Y - 2 : CEIL_Y + 2;
            sprite("white", cx, edgeY, seg.w, 4, isFloor ? COL_EDGE_FLOOR : COL_EDGE_CEIL, 1);
        }

        // --- free-floating platforms (optional) ---
        for (const p of (data.platforms || [])) {
            solids.push({ x: p.x, y: p.y, w: p.w, h: p.h });
            sprite("white", p.x, p.y, p.w, p.h, COL_PLATFORM);
            sprite("white", p.x, p.y + p.h / 2 - 2, p.w, 4, COL_EDGE_FLOOR, 1);
            sprite("white", p.x, p.y - p.h / 2 + 2, p.w, 4, COL_EDGE_CEIL, 1);
        }

        // --- spikes ---
        for (const s of (data.spikes || [])) {
            const onFloor = s.side === "floor";
            const baseY = onFloor ? FLOOR_Y : CEIL_Y;
            const n = sprite("spike", s.x, baseY + (onFloor ? 19 : -19), 48, 40, undefined, 2);
            if (!onFloor) n.scaleY = -1;
            // forgiving hitbox, smaller than the visual
            spikes.push({ x: s.x, y: baseY + (onFloor ? 13 : -13), w: 22, h: 24 });
        }

        // --- crystals ---
        for (const c of (data.crystals || [])) {
            const n = sprite("crystal", c.x, c.y, 28, 28, undefined, 2);
            const glow = new cc.Node("glow");
            const gs = glow.addComponent(cc.Sprite);
            gs.spriteFrame = frames["glow"];
            gs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            glow.setContentSize(64, 64);
            glow.color = cc.color(127, 247, 255);
            glow.opacity = 120;
            n.addChild(glow, -1);
            cc.tween(n).by(2.4, { angle: 360 }).repeatForever().start();
            crystals.push({ x: c.x, y: c.y, taken: false, node: n });
        }

        // --- goal portal: a glowing column spanning the corridor ---
        const goalX = data.goal.x;
        const goal: RectDef = { x: goalX, y: 0, w: 56, h: 2 * CEIL_Y };
        const beam = sprite("white", goalX, 0, 24, 2 * CEIL_Y, COL_GOAL_GLOW, 1);
        beam.opacity = 90;
        const ring = sprite("portal", goalX, 0, 96, 160, undefined, 2);
        cc.tween(ring)
            .to(0.8, { scale: 1.12 })
            .to(0.8, { scale: 1.0 })
            .repeatForever()
            .start();
        cc.tween(beam)
            .to(0.6, { opacity: 150 })
            .to(0.6, { opacity: 60 })
            .repeatForever()
            .start();

        const startSide = (data.start && data.start.side) === "ceiling" ? 1 : -1;
        const startY = startSide === -1 ? FLOOR_Y + 18 : CEIL_Y - 18;

        return {
            name: data.name || "LEVEL",
            speed: data.speed || 300,
            length: data.length,
            start: { x: (data.start && data.start.x) || 0, y: startY },
            solids: solids,
            spikes: spikes,
            crystals: crystals,
            goal: goal,
            totalCrystals: crystals.length
        };
    }
}
