// Procedural fragment generator for endless mode.
//
// Anti-monotony design:
// - hand-authored pattern vocabulary (rhythm / cluster / gaps / pistons /
//   drones / teleporter / rotation waves / breathers), all SIDE-AGNOSTIC:
//   every pattern is fair no matter which side the player is currently on,
//   so fragments can be stitched freely
// - all spacing is derived from the CURRENT speed (reaction seconds), so the
//   speed ramp stays fair
// - difficulty: patterns unlock by distance, clusters grow, spacing tightens
// - variety rules: no immediate pattern repeats, a breather every <=5
//   patterns, and ~2.6k-px "theme blocks" that bias toward one pattern type
//   so sections feel distinct
//
// Fairness floor: reaction spacing never drops below 0.81s of travel, which
// stays above flip airtime (0.58s) + human reaction margin.

const REACT = 0.88;   // seconds of reaction time per obstacle
const TRAVEL = 0.58;  // flip airtime in seconds

interface Gap { side: string; x: number; w: number; }

export default class EndlessGen {
    private x: number;
    private lastId = "";
    private sinceBreather = 0;
    private theme = "rhythm";
    private themeLeft = 0;
    private nextPowerX: number;

    constructor(startX: number) {
        this.x = startX;
        this.nextPowerX = startX + 2200;
    }

    getX(): number {
        return this.x;
    }

    // Generates one pattern starting at this.x; returns a level-JSON fragment.
    next(speed: number, distPx: number): any {
        const f: any = {
            segments: [], spikes: [], crystals: [], powerups: [],
            teleports: [], enemies: [], movers: [], rotations: []
        };
        // spacing tightens with distance, never below the fairness floor
        const k = Math.max(0.92, 1.05 - (distPx / 30000) * 0.25);
        const react = speed * REACT * k;
        const travel = speed * TRAVEL;

        let id: string;
        if (this.sinceBreather >= 5) id = "breather";
        else id = this.pick(distPx);
        this.lastId = id;
        this.sinceBreather = id === "breather" ? 0 : this.sinceBreather + 1;

        const x0 = this.x;
        let len = 0;
        switch (id) {
            case "breather": len = this.pBreather(f, x0, react); break;
            case "rhythm": len = this.pRhythm(f, x0, react, travel, distPx); break;
            case "cluster": len = this.pCluster(f, x0, react, travel, speed, distPx); break;
            case "gapSingle": len = this.pGapSingle(f, x0, react, speed); break;
            case "gapDouble": len = this.pGapDouble(f, x0, react, travel, speed); break;
            case "gapSpike": len = this.pGapSpike(f, x0, react, travel, speed); break;
            case "piston": len = this.pPiston(f, x0, react, distPx); break;
            case "drone": len = this.pDrone(f, x0, react, distPx); break;
            case "tport": len = this.pTeleport(f, x0, react); break;
            case "rotwave": len = this.pRotWave(f, x0, react); break;
            default: len = this.pBreather(f, x0, react); break;
        }
        len = Math.max(len, 420);
        this.x = x0 + len;
        this.themeLeft -= len;
        return f;
    }

    // ---------- selection ----------

    private pool(distPx: number): string[] {
        const p = ["rhythm", "cluster", "gapSingle"];
        if (distPx > 800) p.push("piston");
        if (distPx > 1200) p.push("drone");
        if (distPx > 2000) p.push("rotwave");
        if (distPx > 2200) p.push("gapDouble");
        if (distPx > 3000) p.push("tport");
        if (distPx > 5000) p.push("gapSpike");
        return p;
    }

    private pick(distPx: number): string {
        const p = this.pool(distPx);
        if (this.themeLeft <= 0) {
            this.theme = p[Math.floor(Math.random() * p.length)];
            this.themeLeft = 2600;
        }
        // 60% theme bias, but never the same pattern twice in a row
        let id = (Math.random() < 0.6 && this.theme !== this.lastId)
            ? this.theme
            : p[Math.floor(Math.random() * p.length)];
        let guard = 8;
        while (id === this.lastId && guard-- > 0) {
            id = p[Math.floor(Math.random() * p.length)];
        }
        return id;
    }

    // ---------- helpers ----------

    // full floor+ceiling bands across [x0, x0+len], minus the given gaps
    private bands(f: any, x0: number, len: number, gaps?: Gap[]) {
        const sides = ["floor", "ceiling"];
        for (const side of sides) {
            const g = (gaps || []).filter((gg) => gg.side === side).sort((a, b) => a.x - b.x);
            let cur = x0;
            for (const gg of g) {
                if (gg.x > cur) f.segments.push({ x: cur, w: gg.x - cur, side: side });
                cur = gg.x + gg.w;
            }
            if (x0 + len > cur) f.segments.push({ x: cur, w: x0 + len - cur, side: side });
        }
    }

    private line(f: any, x: number, n: number, y: number, step: number = 80) {
        for (let i = 0; i < n; i++) f.crystals.push({ x: x + i * step, y: y });
    }

    private maybePowerup(f: any, x: number) {
        if (x < this.nextPowerX) return;
        const types = ["shield", "magnet", "slow"];
        const y = Math.random() < 0.5 ? -212 : 212;
        f.powerups.push({ x: x, y: y, type: types[Math.floor(Math.random() * types.length)] });
        this.nextPowerX = x + 3200 + Math.random() * 1600;
    }

    private side(): string {
        return Math.random() < 0.5 ? "floor" : "ceiling";
    }

    private lineY(side: string): number {
        return side === "floor" ? -212 : 212;
    }

    // ---------- patterns ----------

    private pBreather(f: any, x0: number, react: number): number {
        const len = Math.max(480, react * 1.8);
        this.bands(f, x0, len);
        this.line(f, x0 + 120, 4, this.lineY(this.side()));
        this.maybePowerup(f, x0 + len / 2);
        return len;
    }

    private pRhythm(f: any, x0: number, react: number, travel: number, distPx: number): number {
        const n = 2 + Math.floor(Math.random() * 2)
            + (distPx > 6000 ? 1 : 0) + (distPx > 14000 ? 1 : 0);
        const s = react * (0.95 + Math.random() * 0.15);
        let side = this.side();
        for (let i = 1; i <= n; i++) {
            f.spikes.push({ x: x0 + s * i, side: side });
            if (i % 2 === 1) f.crystals.push({ x: x0 + s * i - travel / 2, y: 0 });
            side = side === "floor" ? "ceiling" : "floor";
        }
        const len = s * (n + 1);
        this.bands(f, x0, len);
        return len;
    }

    private pCluster(f: any, x0: number, react: number, travel: number, speed: number, distPx: number): number {
        const m = 2 + (distPx > 4000 ? 1 : 0) + (distPx > 12000 ? 1 : 0);
        const a = x0 + react;
        const b = a + Math.max(1.5 * react, travel + 0.4 * speed);
        const firstFloor = Math.random() < 0.5;
        for (let i = 0; i < m; i++) {
            f.spikes.push({ x: a + i * 40, side: firstFloor ? "floor" : "ceiling" });
            f.spikes.push({ x: b + i * 40, side: firstFloor ? "ceiling" : "floor" });
        }
        const len = b + m * 40 + react - x0;
        this.bands(f, x0, len);
        this.line(f, x0 + 100, 3, this.lineY(firstFloor ? "ceiling" : "floor"));
        return len;
    }

    private pGapSingle(f: any, x0: number, react: number, speed: number): number {
        const side = this.side();
        const g = speed * (0.6 + Math.random() * 0.2);
        const gapX = x0 + react;
        const len = react * 2 + g;
        this.bands(f, x0, len, [{ side: side, x: gapX, w: g }]);
        f.crystals.push({ x: gapX + g / 2, y: 0 });
        f.crystals.push({ x: gapX + g / 2, y: side === "floor" ? 100 : -100 });
        return len;
    }

    private pGapDouble(f: any, x0: number, react: number, travel: number, speed: number): number {
        const g = 0.65 * speed;
        const a = x0 + react;
        const b = a + Math.max(1.6 * react, travel + 0.4 * speed);
        const len = b + g + react - x0;
        this.bands(f, x0, len, [
            { side: "floor", x: a, w: g },
            { side: "ceiling", x: b, w: g }
        ]);
        f.crystals.push({ x: a + g / 2, y: 0 });
        f.crystals.push({ x: b + g / 2, y: 0 });
        return len;
    }

    // gap, then a spike waiting near where you land on the other side
    private pGapSpike(f: any, x0: number, react: number, travel: number, speed: number): number {
        const side = this.side();
        const other = side === "floor" ? "ceiling" : "floor";
        const g = speed * (0.55 + Math.random() * 0.15);
        const a = x0 + react;
        const spikeX = a + travel + 0.85 * react;
        const len = spikeX + react - x0;
        this.bands(f, x0, len, [{ side: side, x: a, w: g }]);
        f.spikes.push({ x: spikeX, side: other });
        f.crystals.push({ x: a + g / 2, y: 0 });
        return len;
    }

    private pPiston(f: any, x0: number, react: number, distPx: number): number {
        const side = this.side();
        const period = Math.max(1.5, 2.2 - distPx / 20000);
        const px = x0 + react;
        f.movers.push({ x: px, w: 280, side: side, amp: 140, period: period, phase: 0 });
        f.crystals.push({ x: px + 140, y: side === "floor" ? -150 : 150 });
        let len = react * 2 + 280;
        if (distPx > 3000 && Math.random() < 0.65) {
            const other = side === "floor" ? "ceiling" : "floor";
            f.movers.push({ x: px + 480, w: 280, side: other, amp: 140, period: period, phase: period * 0.5 });
            f.crystals.push({ x: px + 620, y: other === "floor" ? -150 : 150 });
            len += 480;
        }
        this.bands(f, x0, len);
        return len;
    }

    private pDrone(f: any, x0: number, react: number, distPx: number): number {
        const n = 1
            + (distPx > 4000 && Math.random() < 0.5 ? 1 : 0)
            + (distPx > 12000 && Math.random() < 0.4 ? 1 : 0);
        for (let i = 1; i <= n; i++) {
            const horizontal = Math.random() < 0.25;
            f.enemies.push({
                x: x0 + react * 1.4 * i,
                y: -100 + Math.random() * 200,
                axis: horizontal ? "x" : "y",
                range: horizontal ? 80 : 110 + Math.random() * 70,
                period: 1.3 + Math.random() * 0.6
            });
        }
        const len = react * (1.4 * n + 1.4);
        this.bands(f, x0, len);
        this.line(f, x0 + 100, 3, this.lineY(this.side()));
        return len;
    }

    private pTeleport(f: any, x0: number, react: number): number {
        const side = this.side();
        const ex = x0 + react;
        const exitY = -this.lineY(side);
        f.teleports.push({ x: ex, y: this.lineY(side), tx: ex + 650, ty: exitY });
        this.line(f, ex + 700, 4, exitY);
        const len = react * 2 + 650;
        this.bands(f, x0, len);
        return len;
    }

    private pRotWave(f: any, x0: number, react: number): number {
        const angle = Math.random() < 0.5 ? 90 : -90;
        const s = react * 1.1;
        const inner = 4;
        const len = s * (inner + 2) + 500;
        f.rotations.push({ x: x0 + react * 0.6, angle: angle });
        f.rotations.push({ x: x0 + len - react * 0.4, angle: 0 });
        let side = this.side();
        for (let i = 1; i <= inner; i++) {
            f.spikes.push({ x: x0 + react + s * i, side: side });
            side = side === "floor" ? "ceiling" : "floor";
        }
        this.bands(f, x0, len);
        return len;
    }
}
