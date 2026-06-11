// Builds a level from a JSON file in resources/levels/.
// All collision is plain AABB data (center x/y + w/h); visuals are tinted sprites.
//
// Corridor layout (world coordinates, y=0 is the corridor center):
//   ceiling surface  y = +250
//   floor surface    y = -250
// Solid bands are THICK px deep behind each surface.
//
// Supported JSON fields (see levels/level1.json for an example):
//   segments  [{x, w, side:"floor"|"ceiling"}]      solid floor/ceiling bands
//   platforms [{x, y, w, h}]                        free-floating solids
//   spikes    [{x, side}]                           lethal triangles on a surface
//   crystals  [{x, y}]                              collectibles
//   powerups  [{x, y, type:"shield"|"slow"|"magnet"}]
//   teleports [{x, y, tx, ty}]                      one-way A->B (tx MUST be > x+50)
//   enemies   [{x, y, axis:"x"|"y", range, period, phase?}]   patrol drones
//   rotations [{x, angle}]                          visual field rotation from x on
//   goal      {x}                                   portal column
//   speed, length, start {x, side}, name

import GameData from "./GameData";

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

export interface PowerupRef {
    x: number;
    y: number;
    type: string; // "shield" | "slow" | "magnet"
    taken: boolean;
    node: cc.Node;
}

export interface TeleportRef {
    x: number;
    y: number;
    tx: number;
    ty: number;
}

export interface EnemyRef {
    node: cc.Node;
    x0: number;
    y0: number;
    axis: string;  // "x" | "y"
    range: number;
    period: number;
    phase: number;
}

export interface RotationRef {
    x: number;
    angle: number;
}

export interface LevelData {
    name: string;
    speed: number;
    length: number;
    start: { x: number; y: number };
    solids: RectDef[];
    spikes: RectDef[];
    crystals: CrystalRef[];
    powerups: PowerupRef[];
    teleports: TeleportRef[];
    enemies: EnemyRef[];
    rotations: RotationRef[];
    goal: RectDef;
    totalCrystals: number;
}

// Color schemes selectable in settings. Index = GameData.settings.scheme.
export const SCHEMES = [
    {
        name: "NEON",
        floorEdge: cc.color(53, 240, 255),
        ceilEdge: cc.color(255, 122, 200),
        platform: cc.color(20, 26, 58),
        goal: cc.color(255, 181, 74),
        crystal: cc.color(127, 247, 255),
        bgTint: cc.color(255, 255, 255)
    },
    {
        name: "SUNSET",
        floorEdge: cc.color(255, 181, 74),
        ceilEdge: cc.color(255, 90, 90),
        platform: cc.color(46, 22, 38),
        goal: cc.color(255, 240, 150),
        crystal: cc.color(255, 214, 140),
        bgTint: cc.color(255, 196, 170)
    },
    {
        name: "MATRIX",
        floorEdge: cc.color(77, 255, 124),
        ceilEdge: cc.color(196, 255, 80),
        platform: cc.color(12, 34, 20),
        goal: cc.color(190, 255, 130),
        crystal: cc.color(170, 255, 190),
        bgTint: cc.color(180, 255, 200)
    }
];

const POWER_COLORS: { [t: string]: cc.Color } = {
    shield: cc.color(120, 220, 255),
    slow: cc.color(170, 140, 255),
    magnet: cc.color(255, 230, 110)
};

export default class LevelBuilder {

    static scheme() {
        const i = GameData.settings.scheme;
        return SCHEMES[i >= 0 && i < SCHEMES.length ? i : 0];
    }

    static build(world: cc.Node, data: any, frames: { [k: string]: cc.SpriteFrame }): LevelData {
        const pal = LevelBuilder.scheme();
        const solids: RectDef[] = [];
        const spikes: RectDef[] = [];
        const crystals: CrystalRef[] = [];
        const powerups: PowerupRef[] = [];
        const teleports: TeleportRef[] = [];
        const enemies: EnemyRef[] = [];
        const rotations: RotationRef[] = [];

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

        const addGlow = (parent: cc.Node, size: number, color: cc.Color, opacity: number) => {
            const glow = new cc.Node("glow");
            const gs = glow.addComponent(cc.Sprite);
            gs.spriteFrame = frames["glow"];
            gs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            glow.setContentSize(size, size);
            glow.color = color;
            glow.opacity = opacity;
            parent.addChild(glow, -1);
            return glow;
        };

        // --- floor / ceiling segments ---
        for (const seg of (data.segments || [])) {
            const isFloor = seg.side === "floor";
            const cy = isFloor ? FLOOR_Y - THICK / 2 : CEIL_Y + THICK / 2;
            const cx = seg.x + seg.w / 2;
            solids.push({ x: cx, y: cy, w: seg.w, h: THICK });
            sprite("white", cx, cy, seg.w, THICK, pal.platform);
            const edgeY = isFloor ? FLOOR_Y - 2 : CEIL_Y + 2;
            sprite("white", cx, edgeY, seg.w, 4, isFloor ? pal.floorEdge : pal.ceilEdge, 1);
        }

        // --- free-floating platforms ---
        for (const p of (data.platforms || [])) {
            solids.push({ x: p.x, y: p.y, w: p.w, h: p.h });
            sprite("white", p.x, p.y, p.w, p.h, pal.platform);
            sprite("white", p.x, p.y + p.h / 2 - 2, p.w, 4, pal.floorEdge, 1);
            sprite("white", p.x, p.y - p.h / 2 + 2, p.w, 4, pal.ceilEdge, 1);
        }

        // --- spikes ---
        for (const s of (data.spikes || [])) {
            const onFloor = s.side === "floor";
            const baseY = onFloor ? FLOOR_Y : CEIL_Y;
            const n = sprite("spike", s.x, baseY + (onFloor ? 19 : -19), 48, 40, undefined, 2);
            if (!onFloor) n.scaleY = -1;
            spikes.push({ x: s.x, y: baseY + (onFloor ? 13 : -13), w: 22, h: 24 });
        }

        // --- crystals ---
        for (const c of (data.crystals || [])) {
            const n = sprite("crystal", c.x, c.y, 28, 28, pal.crystal, 2);
            addGlow(n, 64, pal.crystal, 120);
            cc.tween(n).by(2.4, { angle: 360 }).repeatForever().start();
            crystals.push({ x: c.x, y: c.y, taken: false, node: n });
        }

        // --- powerups ---
        for (const p of (data.powerups || [])) {
            const col = POWER_COLORS[p.type] || cc.Color.WHITE;
            const n = sprite(p.type, p.x, p.y, 34, 34, undefined, 2);
            addGlow(n, 80, col, 140);
            cc.tween(n)
                .to(0.8, { y: p.y + 8 }, { easing: "sineInOut" })
                .to(0.8, { y: p.y - 8 }, { easing: "sineInOut" })
                .repeatForever()
                .start();
            powerups.push({ x: p.x, y: p.y, type: p.type, taken: false, node: n });
        }

        // --- teleports (one-way entry -> exit) ---
        for (const t of (data.teleports || [])) {
            const entry = sprite("tport", t.x, t.y, 52, 52, cc.color(190, 120, 255), 2);
            addGlow(entry, 90, cc.color(190, 120, 255), 150);
            cc.tween(entry).by(1.6, { angle: -360 }).repeatForever().start();
            const exit = sprite("tport", t.tx, t.ty, 52, 52, cc.color(120, 255, 210), 2);
            exit.opacity = 170;
            addGlow(exit, 70, cc.color(120, 255, 210), 100);
            cc.tween(exit).by(2.2, { angle: 360 }).repeatForever().start();
            teleports.push({ x: t.x, y: t.y, tx: t.tx, ty: t.ty });
        }

        // --- patrol drones ---
        for (const e of (data.enemies || [])) {
            const n = sprite("drone", e.x, e.y, 36, 36, undefined, 3);
            addGlow(n, 70, cc.color(255, 90, 90), 130);
            cc.tween(n).by(1.2, { angle: 360 }).repeatForever().start();
            enemies.push({
                node: n,
                x0: e.x,
                y0: e.y,
                axis: e.axis === "x" ? "x" : "y",
                range: e.range || 120,
                period: e.period || 2,
                phase: e.phase || 0
            });
        }

        // --- visual rotation zones ---
        for (const r of (data.rotations || [])) {
            rotations.push({ x: r.x, angle: r.angle || 0 });
            // subtle marker so players see something changed here
            const marker = sprite("white", r.x, 0, 6, 2 * CEIL_Y, pal.goal, 0);
            marker.opacity = 40;
        }
        rotations.sort((a, b) => a.x - b.x);

        // --- goal portal: a glowing column spanning the corridor ---
        const goalX = data.goal.x;
        const goal: RectDef = { x: goalX, y: 0, w: 56, h: 2 * CEIL_Y };
        const beam = sprite("white", goalX, 0, 24, 2 * CEIL_Y, pal.goal, 1);
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
            speed: (data.speed || 300) * GameData.settings.speed,
            length: data.length,
            start: { x: (data.start && data.start.x) || 0, y: startY },
            solids: solids,
            spikes: spikes,
            crystals: crystals,
            powerups: powerups,
            teleports: teleports,
            enemies: enemies,
            rotations: rotations,
            goal: goal,
            totalCrystals: crystals.length
        };
    }
}
