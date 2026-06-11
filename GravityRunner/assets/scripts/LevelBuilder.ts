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
//   movers    [{x, w, side, amp, period, phase}]    piston bands
//   goal      {x}                                   portal column
//   speed, length, start {x, side}, name
//
// Endless mode uses emptyLevel() + append() to stream fragments in chunks;
// append() returns a manifest so a chunk's data can be removed again.

import GameData from "./GameData";
import Fx from "./Fx";

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

export interface RhythmNoteRef {
    time: number;
    hitTime?: number;
    kind: string;
    code?: string;
    action?: string; // jump | flip
    flip: boolean;
    lane?: string;
    trackLane?: number;
    dir?: number;
    color?: string;
    x: number;
    y: number;
    voidY?: number;
    gogo?: boolean;
    judged: boolean;
    node?: cc.Node;
}

export interface RhythmLevelData {
    enabled: boolean;
    style?: string;
    source?: string;
    course?: string;
    audio: string;
    noteCount: number;
    flipCount: number;
    perfectWindow: number;
    goodWindow: number;
    badWindow: number;
    gateFatal?: boolean;
    baseBpm?: number;
    pxPerBeat?: number;
    laneCount?: number;
    laneYs?: number[];
    startLane?: number;
    floorY?: number;
    ceilingY?: number;
    trackGap?: number;
    gravity?: number;
    maxFall?: number;
    flipImpulse?: number;
    jumpImpulse?: number;
    jumpHitDelay?: number;
    flipHitDelay?: number;
    jumpReturnTime?: number;
    flipTravelTime?: number;
    jumpHeight?: number;
    cameraLookAhead?: number;
    rolls?: { start: number; end: number; x1?: number; x2?: number }[];
    bpmChanges?: { time: number; bpm: number }[];
    measures?: { index: number; start: number; end: number; divisions: number; measure: string }[];
    rawNoteCount?: number;
    notes: RhythmNoteRef[];
}

// A floor/ceiling band that pistons toward the corridor center and back.
// The waveform (in GameMgr) keeps it retracted >50% of the cycle so it can
// be timed; players can also ride on top of an extending piston.
export interface MoverRef {
    rect: RectDef;      // lives inside solids[], GameMgr moves it every frame
    nodes: cc.Node[];   // visual band + edge
    baseYs: number[];   // rest y per node
    baseY: number;      // rest y of the rect
    dir: number;        // +1 floor (extends up), -1 ceiling (extends down)
    amp: number;
    period: number;
    phase: number;      // seconds
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
    movers: MoverRef[];
    rhythm: RhythmLevelData;
    goal: RectDef;
    totalCrystals: number;
}

// What one append() call added — used by endless mode to drop old chunks.
export interface FragmentManifest {
    solids: RectDef[];
    spikes: RectDef[];
    crystals: CrystalRef[];
    powerups: PowerupRef[];
    teleports: TeleportRef[];
    enemies: EnemyRef[];
    movers: MoverRef[];
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

    static emptyLevel(name: string, speed: number): LevelData {
        return {
            name: name,
            speed: speed,
            length: 1e15,
            start: { x: -300, y: FLOOR_Y + 18 },
            solids: [],
            spikes: [],
            crystals: [],
            powerups: [],
            teleports: [],
            enemies: [],
            rotations: [],
            movers: [],
            rhythm: null,
            goal: { x: 1e15, y: 0, w: 56, h: 2 * CEIL_Y },
            totalCrystals: 0
        };
    }

    // Builds the elements described by `data` into `world` and pushes their
    // collision/data refs into `level`. Returns what was added.
    static append(world: cc.Node, data: any, frames: { [k: string]: cc.SpriteFrame }, level: LevelData): FragmentManifest {
        const pal = LevelBuilder.scheme();
        const m: FragmentManifest = {
            solids: [], spikes: [], crystals: [], powerups: [],
            teleports: [], enemies: [], movers: []
        };

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
            const rect = { x: cx, y: cy, w: seg.w, h: THICK };
            level.solids.push(rect);
            m.solids.push(rect);
            sprite("white", cx, cy, seg.w, THICK, pal.platform);
            const edgeY = isFloor ? FLOOR_Y - 2 : CEIL_Y + 2;
            sprite("white", cx, edgeY, seg.w, 4, isFloor ? pal.floorEdge : pal.ceilEdge, 1);
        }

        // --- free-floating platforms ---
        for (const p of (data.platforms || [])) {
            const rect = { x: p.x, y: p.y, w: p.w, h: p.h };
            level.solids.push(rect);
            m.solids.push(rect);
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
            const rect = { x: s.x, y: baseY + (onFloor ? 13 : -13), w: 22, h: 24 };
            level.spikes.push(rect);
            m.spikes.push(rect);
        }

        // --- crystals ---
        for (const c of (data.crystals || [])) {
            const n = sprite("crystal", c.x, c.y, 28, 28, pal.crystal, 2);
            addGlow(n, 64, pal.crystal, 120);
            cc.tween(n).by(2.4, { angle: 360 }).repeatForever().start();
            const ref = { x: c.x, y: c.y, taken: false, node: n };
            level.crystals.push(ref);
            m.crystals.push(ref);
            level.totalCrystals++;
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
            const ref = { x: p.x, y: p.y, type: p.type, taken: false, node: n };
            level.powerups.push(ref);
            m.powerups.push(ref);
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
            const ref = { x: t.x, y: t.y, tx: t.tx, ty: t.ty };
            level.teleports.push(ref);
            m.teleports.push(ref);
        }

        // --- patrol drones ---
        for (const e of (data.enemies || [])) {
            const n = sprite("drone", e.x, e.y, 36, 36, undefined, 3);
            addGlow(n, 70, cc.color(255, 90, 90), 130);
            cc.tween(n).by(1.2, { angle: 360 }).repeatForever().start();
            const ref = {
                node: n,
                x0: e.x,
                y0: e.y,
                axis: e.axis === "x" ? "x" : "y",
                range: e.range || 120,
                period: e.period || 2,
                phase: e.phase || 0
            };
            level.enemies.push(ref);
            m.enemies.push(ref);
        }

        // --- piston bands (movers) ---
        for (const mv of (data.movers || [])) {
            const isFloor = mv.side === "floor";
            const cy = isFloor ? FLOOR_Y - THICK / 2 : CEIL_Y + THICK / 2;
            const cx = mv.x + mv.w / 2;
            const rect: RectDef = { x: cx, y: cy, w: mv.w, h: THICK };
            level.solids.push(rect);
            m.solids.push(rect);
            const lite = cc.color(
                Math.min(255, pal.platform.r + 36),
                Math.min(255, pal.platform.g + 36),
                Math.min(255, pal.platform.b + 60));
            const band = sprite("white", cx, cy, mv.w, THICK, lite, 1);
            const edgeY = isFloor ? FLOOR_Y - 2 : CEIL_Y + 2;
            const edge = sprite("white", cx, edgeY, mv.w, 5, pal.goal, 2);
            const ref: MoverRef = {
                rect: rect,
                nodes: [band, edge],
                baseYs: [cy, edgeY],
                baseY: cy,
                dir: isFloor ? 1 : -1,
                amp: mv.amp || 120,
                period: mv.period || 2.4,
                phase: mv.phase || 0
            };
            level.movers.push(ref);
            m.movers.push(ref);
        }



        // --- rhythm notes (from converted TJA charts) ---
        if (data.rhythm && data.rhythm.enabled && !level.rhythm) {
            const rd = data.rhythm;
            level.rhythm = {
                enabled: true,
                style: rd.style || "color-gate",
                source: rd.source || "",
                course: rd.course || "",
                audio: rd.audio || "rhythm_song",
                noteCount: rd.noteCount || ((rd.notes || []).length),
                flipCount: rd.flipCount || 0,
                perfectWindow: rd.perfectWindow || 0.055,
                goodWindow: rd.goodWindow || 0.11,
                badWindow: rd.badWindow || 0.17,
                gateFatal: rd.gateFatal !== false,
                baseBpm: Number(rd.baseBpm) || 120,
                pxPerBeat: Number(rd.pxPerBeat) || 160,
                laneCount: Number(rd.laneCount) || 2,
                laneYs: Array.isArray(rd.laneYs) ? rd.laneYs.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v)) : null,
                startLane: Number(rd.startLane) || 0,
                floorY: Number(rd.floorY) || -160,
                ceilingY: Number(rd.ceilingY) || 160,
                trackGap: Number(rd.trackGap) || 320,
                gravity: Number(rd.gravity) || 7800,
                maxFall: Number(rd.maxFall) || 2600,
                flipImpulse: Number(rd.flipImpulse) || 0,
                jumpImpulse: Number(rd.jumpImpulse) || 900,
                jumpHitDelay: Number(rd.jumpHitDelay) || 0.008,
                flipHitDelay: Number(rd.flipHitDelay) || 0.008,
                jumpReturnTime: Number(rd.jumpReturnTime) || 0.008,
                flipTravelTime: Number(rd.flipTravelTime) || 0.008,
                jumpHeight: Number(rd.jumpHeight) || 54,
                cameraLookAhead: Number(rd.cameraLookAhead) || 280,
                rolls: Array.isArray(rd.rolls) ? rd.rolls.map((r: any) => ({
                    start: Number(r.start) || 0,
                    end: Number(r.end) || 0,
                    x1: Number(r.x1),
                    x2: Number(r.x2)
                })).filter((r: any) => r.end > r.start) : [],
                bpmChanges: Array.isArray(rd.bpmChanges) ? rd.bpmChanges.map((b: any) => ({ time: Number(b.time) || 0, bpm: Number(b.bpm) || 120 })) : [],
                measures: Array.isArray(rd.measures) ? rd.measures.map((m: any) => ({ index: Number(m.index) || 0, start: Number(m.start) || 0, end: Number(m.end) || 0, divisions: Number(m.divisions) || 0, measure: String(m.measure || '') })) : [],
                rawNoteCount: Number(rd.rawNoteCount) || Number(rd.noteCount) || 0,
                notes: []
            };
            if (!level.rhythm.laneYs || level.rhythm.laneYs.length < 2) level.rhythm.laneYs = [-212, 212];
            const isCollector = level.rhythm.style === "gravity-collect";
            const isJumpFlip = level.rhythm.style === "jump-flip";
            if (isCollector || isJumpFlip) {
                const laneYs = level.rhythm.laneYs;
                const sx = (data.start && Number(data.start.x)) || -300;
                const lx = Number(data.length) || 10000;
                for (let i = 0; i < laneYs.length; i++) {
                    const guide = sprite("white", sx + lx / 2 - 250, laneYs[i], lx + 900, isJumpFlip ? 4 : 3,
                        i === level.rhythm.startLane ? cc.color(255, 255, 255) : cc.color(95, 110, 150), 0);
                    guide.opacity = isJumpFlip ? 70 : (i === level.rhythm.startLane ? 80 : 42);
                }
            }
            if (isJumpFlip && Array.isArray(rd.rolls)) {
                const floorCenter = Number(rd.floorY || -140) + 18;
                const ceilCenter = Number(rd.ceilingY || 140) - 18;
                const centerY = (floorCenter + ceilCenter) / 2;
                const height = Math.max(26, Math.abs(ceilCenter - floorCenter) + 28);
                const sx = (data.start && Number(data.start.x)) || -300;
                const speed = Number(data.speed) || 300;
                for (const rr of rd.rolls) {
                    const x1 = Number.isFinite(Number(rr.x1)) ? Number(rr.x1) : sx + Number(rr.start || 0) * speed;
                    const x2 = Number.isFinite(Number(rr.x2)) ? Number(rr.x2) : sx + Number(rr.end || 0) * speed;
                    const w = Math.max(12, Math.abs(x2 - x1));
                    const cx = (x1 + x2) / 2;
                    const band = sprite("white", cx, centerY, w, height, cc.color(255, 210, 95), 2);
                    band.opacity = 36;
                    const top = sprite("white", cx, ceilCenter, w, 5, cc.color(255, 240, 130), 3);
                    const bot = sprite("white", cx, floorCenter, w, 5, cc.color(255, 240, 130), 3);
                    top.opacity = 120;
                    bot.opacity = 120;
                }
            }

            for (const raw of (rd.notes || [])) {
                const flip = !!raw.flip;
                const kind = raw.kind || "don";
                const dir = Number(raw.dir) || 0;
                const noteColor = raw.color === "blue" ? "blue" : "red";
                const trackLane = Number.isFinite(Number(raw.trackLane)) ? Number(raw.trackLane) : 0;
                const lane = raw.lane || (raw.lane === "ceiling" ? "ceiling" : "floor");
                const action = raw.action || (noteColor === "blue" ? "flip" : "jump");
                const col = (isCollector || isJumpFlip)
                    ? (noteColor === "blue" ? cc.color(85, 185, 255) : cc.color(255, 82, 78))
                    : (lane === "ceiling" ? cc.color(85, 185, 255) : cc.color(255, 82, 78));
                const size = kind === "roll" ? 20 : (raw.gogo ? 34 : 30);
                let n: cc.Node;
                if (isJumpFlip) {
                    const y = Number(raw.y) || 0;
                    const x = Number(raw.x) || 0;
                    if (action === "flip") {
                        const voidY = Number(raw.voidY);
                        if (Number.isFinite(voidY)) {
                            const hole = sprite("white", x, voidY, 54, 18, cc.color(15, 15, 26), 3);
                            hole.opacity = 120;
                        }
                    }
                    n = sprite("white", x, y, action === "flip" ? size + 6 : size, action === "flip" ? size + 6 : size, col, 4);
                    n.opacity = 242;
                    n.angle = action === "flip" ? 45 : 0;
                    const center = new cc.Node("noteCenter");
                    const cs = center.addComponent(cc.Sprite);
                    cs.spriteFrame = frames["white"];
                    cs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
                    center.setContentSize(action === "flip" ? 12 : 14, action === "flip" ? 12 : 14);
                    center.color = cc.color(255, 255, 255);
                    center.opacity = 190;
                    n.addChild(center, 1);
                    addGlow(n, action === "flip" ? 90 : 72, col, action === "flip" ? 150 : 120);
                } else if (isCollector) {
                    const y = Number(raw.y) || 0;
                    const x = Number(raw.x) || 0;
                    n = sprite("white", x, y, size, size, col, 4);
                    n.opacity = 238;
                    n.angle = 45;
                    const center = new cc.Node("noteCenter");
                    const cs = center.addComponent(cc.Sprite);
                    cs.spriteFrame = frames["white"];
                    cs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
                    center.setContentSize(Math.max(10, size - 16), Math.max(10, size - 16));
                    center.color = cc.color(255, 255, 255);
                    center.opacity = 180;
                    n.addChild(center, 1);
                    addGlow(n, raw.gogo ? 86 : 66, col, raw.gogo ? 145 : 105);
                } else {
                    // Legacy color-gate rhythm mode.
                    const safeY = lane === "ceiling" ? CEIL_Y - 38 : FLOOR_Y + 38;
                    const voidY = lane === "ceiling" ? FLOOR_Y + 38 : CEIL_Y - 38;
                    const hole = sprite("white", raw.x || 0, voidY, 42, 42, cc.color(18, 18, 28), 3);
                    hole.opacity = 135;
                    hole.angle = 45;
                    n = sprite("white", raw.x || 0, safeY, size, size, col, 4);
                    n.opacity = 235;
                    n.angle = 45;
                    addGlow(n, flip ? 78 : 62, col, flip ? 140 : 95);
                }
                level.rhythm.notes.push({
                    time: Number(raw.time) || 0,
                    hitTime: Number.isFinite(Number(raw.hitTime)) ? Number(raw.hitTime) : undefined,
                    kind: kind,
                    code: raw.code || "",
                    action: action,
                    flip: flip,
                    lane: lane,
                    trackLane: trackLane,
                    dir: dir,
                    color: noteColor,
                    x: raw.x || 0,
                    y: raw.y || 0,
                    voidY: raw.voidY,
                    gogo: !!raw.gogo,
                    judged: false,
                    node: n
                });
            }
            level.rhythm.notes.sort((a, b) => a.time - b.time);
        }

        // --- visual rotation zones (data only + marker; no cleanup needed) ---
        for (const r of (data.rotations || [])) {
            level.rotations.push({ x: r.x, angle: r.angle || 0 });
            const marker = sprite("white", r.x, 0, 6, 2 * CEIL_Y, pal.goal, 0);
            marker.opacity = 40;
        }

        return m;
    }

    private static applyRhythmGapSetting(data: any): any {
        if (!data || !data.rhythm || !data.rhythm.enabled || data.rhythm.style !== "jump-flip") return data;

        const out = JSON.parse(JSON.stringify(data));

        // Runtime flow-speed setting.  This scales BOTH the runner speed and the
        // horizontal positions of all rhythm objects around the start line.  As a
        // result, note arrival time remains synchronized with the music:
        //     scaledDistance / scaledSpeed == originalDistance / originalSpeed
        const flow = Math.max(0.1, Math.min(2.0, Number(GameData.settings.rhythmSpeedScale) || 1));
        const sx = (out.start && Number(out.start.x)) || -300;
        const scaleX = (x: any) => Math.round(sx + (Number(x) - sx) * flow);
        const scaleW = (w: any) => Math.max(1, Math.round(Number(w) * flow));

        if (flow !== 1) {
            out.speed = Math.max(1, Math.round((Number(out.speed) || 300) * flow));
            out.length = scaleX(Number(out.length) || 10000);
            if (out.goal && Number.isFinite(Number(out.goal.x))) out.goal.x = scaleX(out.goal.x);
            if (out.rhythm) out.rhythm.flowSpeedScale = flow;
            if (out.rhythm && Number.isFinite(Number(out.rhythm.pxPerBeat))) {
                out.rhythm.pxPerBeat = Math.round(Number(out.rhythm.pxPerBeat) * flow);
            }
            if (out.rhythm && Number.isFinite(Number(out.rhythm.minNotePx))) {
                out.rhythm.minNotePx = Math.round(Number(out.rhythm.minNotePx) * flow);
            }
            if (out.rhythm && Number.isFinite(Number(out.rhythm.cameraLookAhead))) {
                out.rhythm.cameraLookAhead = Math.round(Number(out.rhythm.cameraLookAhead) * Math.max(0.6, Math.min(1.8, flow)));
            }

            const scaleRectArray = (arr: any[], scaleWidth: boolean = false) => {
                if (!Array.isArray(arr)) return;
                for (const o of arr) {
                    if (Number.isFinite(Number(o.x))) o.x = scaleX(o.x);
                    if (scaleWidth && Number.isFinite(Number(o.w))) o.w = scaleW(o.w);
                    if (Number.isFinite(Number(o.tx))) o.tx = scaleX(o.tx);
                }
            };
            scaleRectArray(out.segments || [], true);
            scaleRectArray(out.platforms || [], true);
            scaleRectArray(out.spikes || []);
            scaleRectArray(out.crystals || []);
            scaleRectArray(out.powerups || []);
            scaleRectArray(out.teleports || []);
            scaleRectArray(out.enemies || []);
            scaleRectArray(out.rotations || []);
            if (out.rhythm && Array.isArray(out.rhythm.notes)) {
                for (const n of out.rhythm.notes) {
                    if (Number.isFinite(Number(n.x))) n.x = scaleX(n.x);
                }
            }
            if (out.rhythm && Array.isArray(out.rhythm.rolls)) {
                for (const r of out.rhythm.rolls) {
                    if (Number.isFinite(Number(r.x1))) r.x1 = scaleX(r.x1);
                    if (Number.isFinite(Number(r.x2))) r.x2 = scaleX(r.x2);
                }
            }
        }

        const desiredGap = Number(GameData.settings.rhythmGap) || Number(out.rhythm.trackGap) || 280;
        const oldFloor = Number(out.rhythm.floorY);
        const oldCeil = Number(out.rhythm.ceilingY);
        const floor0 = Number.isFinite(oldFloor) ? oldFloor : -140;
        const ceil0 = Number.isFinite(oldCeil) ? oldCeil : 140;
        const center = (floor0 + ceil0) / 2;
        const gap = Math.max(120, Math.min(420, desiredGap));
        const floorY = Math.round(center - gap / 2);
        const ceilingY = Math.round(center + gap / 2);
        const trackThickness = Number(out.rhythm.trackThickness) || 58;
        const jumpHeight = Number(out.rhythm.jumpHeight) || 66;
        const floorCenter = floorY + 18;
        const ceilingCenter = ceilingY - 18;
        const oldCenter = (floor0 + ceil0) / 2;

        out.rhythm.floorY = floorY;
        out.rhythm.ceilingY = ceilingY;
        out.rhythm.trackGap = ceilingY - floorY;
        out.rhythm.laneYs = [floorCenter, ceilingCenter];

        if (out.start) {
            const side = out.start.side || "floor";
            out.start.y = side === "ceiling" ? ceilingCenter : floorCenter;
        }

        if (Array.isArray(out.platforms)) {
            for (const p of out.platforms) {
                const h = Number(p.h) || trackThickness;
                p.y = Number(p.y) > oldCenter ? Math.round(ceilingY + h / 2) : Math.round(floorY - h / 2);
            }
        }

        if (out.rhythm && Array.isArray(out.rhythm.notes)) {
            for (const n of out.rhythm.notes) {
                const lane = (n.lane === "ceiling" || Number(n.trackLane) === 1) ? "ceiling" : "floor";
                const baseY = lane === "ceiling" ? ceilingCenter : floorCenter;
                if ((n.action || "") === "jump") n.y = Math.round(baseY + (lane === "ceiling" ? -jumpHeight : jumpHeight));
                else n.y = Math.round(baseY);
                n.voidY = lane === "ceiling" ? floorCenter : ceilingCenter;
            }
        }
        return out;
    }

    static build(world: cc.Node, data: any, frames: { [k: string]: cc.SpriteFrame }): LevelData {
        data = LevelBuilder.applyRhythmGapSetting(data);
        const pal = LevelBuilder.scheme();
        // Rhythm levels use TJA-derived speed, optionally adjusted by the runtime
        // flow-speed scale in applyRhythmGapSetting().
        const baseSpeed = (data.rhythm && data.rhythm.enabled)
            ? (data.speed || 300)
            : (data.speed || 300) * GameData.settings.speed;
        const level = LevelBuilder.emptyLevel(data.name || "LEVEL", baseSpeed);

        LevelBuilder.append(world, data, frames, level);
        level.rotations.sort((a, b) => a.x - b.x);
        level.length = data.length;

        // --- goal portal: a glowing column spanning the corridor ---
        const goalX = data.goal.x;
        level.goal = { x: goalX, y: 0, w: 56, h: 2 * CEIL_Y };
        const beam = new cc.Node("beam");
        const bs = beam.addComponent(cc.Sprite);
        bs.spriteFrame = frames["white"];
        bs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        beam.setContentSize(24, 2 * CEIL_Y);
        beam.setPosition(goalX, 0);
        beam.color = pal.goal;
        beam.opacity = 90;
        beam.zIndex = 1;
        world.addChild(beam);
        const ring = new cc.Node("portal");
        const rs = ring.addComponent(cc.Sprite);
        rs.spriteFrame = frames["portal"];
        rs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        ring.setContentSize(96, 160);
        ring.setPosition(goalX, 0);
        ring.zIndex = 2;
        world.addChild(ring);
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
        Fx.portalAmbient(world, goalX, 0, pal.goal);

        const startSide = (data.start && data.start.side) === "ceiling" ? 1 : -1;
        level.start = {
            x: (data.start && data.start.x) || 0,
            y: (data.start && Number.isFinite(Number(data.start.y)))
                ? Number(data.start.y)
                : (startSide === -1 ? FLOOR_Y + 18 : CEIL_Y - 18)
        };
        return level;
    }
}
