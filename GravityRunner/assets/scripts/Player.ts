import { LevelData, RectDef, FLOOR_Y, CEIL_Y } from "./LevelBuilder";
import GameData from "./GameData";
import Sfx from "./Sfx";
import Fx from "./Fx";
import GameMgr from "./GameMgr";

const { ccclass } = cc._decorator;

const GRAVITY = 2600;
const MAX_FALL = 1000;
const BODY_W = 30;
const BODY_H = 34;

// Auto-runner with flippable gravity. Pure kinematic AABB physics —
// no physics engine, so behavior is deterministic and easy to tune.
// Created and configured at runtime by GameMgr via init().
@ccclass
export default class Player extends cc.Component {
    alive = true;
    index = 0; // 0 = P1, 1 = P2

    private mgr: GameMgr = null;
    private level: LevelData = null;
    private vy = 0;
    private gravityDir = -1; // -1: pulls toward floor, +1: toward ceiling
    private grounded = false;
    private rhythmLaneIndex = 0;
    private rhythmTargetY = 0;
    private rhythmFlipAirborne = false;
    private rhythmLastSurfaceDir = -1;
    private rhythmSnapBackT = 0;
    private rhythmSnapBackY = 0;
    private rhythmSnapBackDir = -1;

    // power-up state
    private shield = false;
    private magnetT = 0;
    private invincibleT = 0;

    // active skills: dash (speed burst) and brake (slow down)
    private dashT = 0;
    private dashCd = 0;
    private brakeT = 0;
    private brakeCd = 0;
    private ghostT = 0;
    private wasGrounded = true;
    // decaying horizontal impulse from player-vs-player bumps
    private pushVx = 0;

    private shieldNode: cc.Node = null;
    private magnetAura: cc.Node = null;

    init(mgr: GameMgr, level: LevelData, index: number, frames: { [k: string]: cc.SpriteFrame }) {
        this.mgr = mgr;
        this.level = level;
        this.index = index;

        this.shieldNode = new cc.Node("shieldFx");
        const sp = this.shieldNode.addComponent(cc.Sprite);
        sp.spriteFrame = frames["shield"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.shieldNode.setContentSize(54, 54);
        this.shieldNode.active = false;
        this.node.addChild(this.shieldNode, 1);

        this.magnetAura = new cc.Node("magnetFx");
        const ms = this.magnetAura.addComponent(cc.Sprite);
        ms.spriteFrame = frames["glow"];
        ms.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.magnetAura.setContentSize(120, 120);
        this.magnetAura.color = cc.color(255, 230, 110);
        this.magnetAura.opacity = 150;
        this.magnetAura.active = false;
        this.node.addChild(this.magnetAura, -1);

        this.reset();
    }

    reset() {
        this.node.stopAllActions();
        // P1 spawns on the floor, P2 on the ceiling (no overlap, ever)
        const onCeiling = this.index === 1;
        this.node.setPosition(this.level.start.x,
            onCeiling ? -this.level.start.y : this.level.start.y);
        this.vy = 0;
        this.pushVx = 0;
        this.gravityDir = onCeiling ? 1 : -1;
        this.grounded = true;
        this.rhythmLaneIndex = this.nearestRhythmLane(this.level.start.y);
        this.rhythmTargetY = this.getRhythmLaneY(this.rhythmLaneIndex);
        if (this.isMultiLaneRhythm()) this.node.y = this.rhythmTargetY;
        this.alive = true;
        this.shield = false;
        this.magnetT = 0;
        this.invincibleT = 0;
        this.dashT = 0;
        this.dashCd = 0;
        this.brakeT = 0;
        this.brakeCd = 0;
        this.wasGrounded = true;
        this.rhythmFlipAirborne = false;
        this.rhythmLastSurfaceDir = this.gravityDir;
        this.rhythmSnapBackT = 0;
        this.rhythmSnapBackY = this.node.y;
        this.rhythmSnapBackDir = this.gravityDir;
        this.shieldNode.active = false;
        this.magnetAura.active = false;
        this.node.active = true;
        this.node.opacity = 255;
        this.node.scaleX = 1;
        this.node.scaleY = this.gravityDir > 0 ? -1 : 1;
        this.node.angle = 0;
    }

    // Co-op revive: drop in next to the surviving partner.
    respawnAt(x: number, y: number, gravityDir: number) {
        this.node.stopAllActions();
        this.node.setPosition(x, y);
        this.vy = 0;
        this.gravityDir = gravityDir;
        this.grounded = false;
        this.alive = true;
        this.shield = false;
        this.magnetT = 0;
        this.shieldNode.active = false;
        this.magnetAura.active = false;
        this.node.active = true;
        this.node.opacity = 255;
        this.node.scaleX = 1;
        this.node.scaleY = this.gravityDir > 0 ? -1 : 1;
        this.node.angle = 0;
        this.setInvincible(1.5);
    }

    setInvincible(seconds: number) {
        this.invincibleT = seconds;
        this.node.stopAllActions();
        cc.tween(this.node)
            .repeat(Math.ceil(seconds / 0.3),
                cc.tween().to(0.15, { opacity: 90 }).to(0.15, { opacity: 255 }))
            .start();
    }

    private isMultiLaneRhythm(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled && this.level.rhythm.style === "gravity-collect");
    }

    private isJumpFlipRhythm(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled && this.level.rhythm.style === "jump-flip");
    }

    private rhythmLaneYs(): number[] {
        const r = this.level && this.level.rhythm;
        if (r && r.laneYs && r.laneYs.length >= 2) return r.laneYs;
        return [-212, -106, 0, 106, 212];
    }

    private getRhythmLaneY(idx: number): number {
        const ys = this.rhythmLaneYs();
        const i = Math.max(0, Math.min(ys.length - 1, idx | 0));
        return ys[i];
    }

    private nearestRhythmLane(y: number): number {
        const ys = this.rhythmLaneYs();
        let best = 0;
        let bd = 1e9;
        for (let i = 0; i < ys.length; i++) {
            const d = Math.abs(ys[i] - y);
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    rhythmStepToLane(idx: number, dir: number) {
        if (!this.alive || !this.isMultiLaneRhythm()) return;
        const ys = this.rhythmLaneYs();
        this.rhythmLaneIndex = Math.max(0, Math.min(ys.length - 1, idx | 0));
        this.rhythmTargetY = ys[this.rhythmLaneIndex];
        if (dir !== 0) this.gravityDir = dir > 0 ? 1 : -1;
        this.vy = 0;
        this.grounded = true;
        this.wasGrounded = true;
        this.node.stopAllActions();
        this.node.scaleY = this.gravityDir > 0 ? -1 : 1;
        cc.tween(this.node)
            .to(0.09, { y: this.rhythmTargetY, angle: this.node.angle + (this.gravityDir > 0 ? -120 : 120) }, { easing: "sineOut" })
            .start();
        Fx.flipDust(this.node.parent, this.node.x, this.node.y, this.gravityDir);
        Sfx.play("flip", 0.65);
    }

    rhythmFreeStep() {
        if (!this.alive || !this.isMultiLaneRhythm()) { this.flip(); return; }
        this.gravityDir *= -1;
        const ys = this.rhythmLaneYs();
        const next = Math.max(0, Math.min(ys.length - 1, this.rhythmLaneIndex + (this.gravityDir > 0 ? 1 : -1)));
        this.rhythmStepToLane(next, this.gravityDir);
    }

    getRhythmLaneIndex(): number {
        if (this.isMultiLaneRhythm()) return this.rhythmLaneIndex;
        return this.nearestRhythmLane(this.node.y);
    }

    flip() {
        const rhythmMode = !!(this.mgr && (this.mgr as any).isRhythmMode && (this.mgr as any).isRhythmMode());
        if (!this.alive || (!this.grounded && !rhythmMode)) return;
        const feetY = this.node.y + this.gravityDir * 17;

        if (this.isJumpFlipRhythm()) {
            // Rhythm mode must feel like a key tap, not a slow platformer arc.
            // Flip is therefore effectively instant (< 10 ms): the player snaps
            // to the opposite rail, while the squash / flash gives visual feedback.
            this.rhythmSnapBackT = 0;
            const oldDir = this.gravityDir;
            this.gravityDir *= -1;
            const r = this.level.rhythm;
            const targetY = this.gravityDir > 0 ? (r.ceilingY - 18) : (r.floorY + 18);
            this.vy = 0;
            this.node.y = targetY;
            this.grounded = true;
            this.wasGrounded = true;
            this.rhythmFlipAirborne = false;
            this.rhythmLastSurfaceDir = this.gravityDir;
            this.node.stopAllActions();
            this.node.scaleY = this.gravityDir > 0 ? -1 : 1;
            cc.tween(this.node)
                .by(Math.max(0.001, Math.min(0.009, r.flipTravelTime || 0.008)), { angle: this.gravityDir > 0 ? -90 : 90 })
                .start();
            Fx.flipDust(this.node.parent, this.node.x, feetY, this.gravityDir);
            Fx.rhythmFlip(this.node.parent, this.node.x, this.node.y);
            Sfx.play("flip", 0.8);
            if (oldDir !== this.gravityDir && this.mgr && (this.mgr as any).onRhythmSurfaceHit) {
                (this.mgr as any).onRhythmSurfaceHit(this.node.x, this.node.y);
            }
            return;
        }

        this.gravityDir *= -1;
        this.grounded = false;
        this.wasGrounded = false;
        if (rhythmMode && this.level && this.level.rhythm) {
            // Rhythm charts can be faster than normal platforming.  Use chart-tuned
            // gravity / impulse so flip travel time follows the BPM.
            const impulse = this.level.rhythm.flipImpulse || 0;
            this.vy = this.gravityDir * Math.max(Math.abs(this.vy), impulse);
        }
        // animated spin-flip instead of an instant mirror
        cc.tween(this.node)
            .to(0.16, { scaleY: this.gravityDir > 0 ? -1 : 1 })
            .start();
        Fx.flipDust(this.node.parent, this.node.x, feetY, this.gravityDir);
        Sfx.play("flip", 0.8);
    }

    rhythmLightJump() {
        if (!this.alive) return;
        if (!this.isJumpFlipRhythm()) { this.flip(); return; }
        // No air-jump.  This prevents repeated light-jumps from launching the
        // player out of the corridor.
        if (!this.grounded) return;

        const r = this.level.rhythm;
        const hop = r.jumpHeight || 62;
        const startY = this.node.y;
        const peakY = startY - this.gravityDir * hop;
        const dur = Math.max(0.055, Math.min(0.16, r.jumpReturnTime || 0.10));
        const upT = Math.max(0.018, Math.min(0.045, dur * 0.38));
        const downT = Math.max(0.025, dur - upT);
        this.rhythmSnapBackT = dur + 0.02;
        this.rhythmSnapBackY = startY;
        this.rhythmSnapBackDir = this.gravityDir;

        // Movement is responsive, but the visual arc lasts long enough to read as
        // a real light jump. Scoring is still collision-based in GameMgr, so
        // pressing jump alone does not award points.
        this.vy = 0;
        this.grounded = false;
        this.wasGrounded = false;
        this.rhythmFlipAirborne = false;
        this.node.stopAllActions();
        const sign = this.gravityDir > 0 ? -1 : 1;
        this.node.scaleX = 0.86;
        this.node.scaleY = sign * 1.18;
        cc.tween(this.node)
            .parallel(
                cc.tween().to(upT, { y: peakY }, { easing: "sineOut" })
                    .to(downT, { y: startY }, { easing: "sineIn" }),
                cc.tween().to(0.06, { scaleX: 1, scaleY: sign })
            )
            .call(() => {
                if (this.alive && this.isJumpFlipRhythm() && this.gravityDir === this.rhythmSnapBackDir) {
                    this.node.y = startY;
                    this.vy = 0;
                    this.grounded = true;
                    this.wasGrounded = true;
                    this.rhythmSnapBackT = 0;
                }
            })
            .start();
        Fx.rhythmJump(this.node.parent, this.node.x, peakY, this.gravityDir);
        Sfx.play("click", 0.75);
    }


    rhythmWarpToLane(lane: string) {
        if (!this.alive) return;
        const targetDir = lane === "ceiling" ? 1 : -1;
        const targetY = targetDir > 0 ? CEIL_Y - 18 : FLOOR_Y + 18;
        const fromY = this.node.y;
        this.gravityDir = targetDir;
        this.vy = 0;
        this.grounded = true;
        this.wasGrounded = true;
        this.node.stopAllActions();
        this.node.scaleY = targetDir > 0 ? -1 : 1;
        // Rhythm mode keeps the original flip fantasy, but makes switching lanes
        // snappy enough for music charts. The player is attached to the selected rail.
        cc.tween(this.node)
            .to(0.10, { y: targetY, angle: this.node.angle + (targetDir > 0 ? -180 : 180) }, { easing: "sineOut" })
            .start();
        Fx.flipDust(this.node.parent, this.node.x, fromY, this.gravityDir);
        Sfx.play("flip", 0.75);
    }

    getLane(): string {
        return this.gravityDir > 0 ? "ceiling" : "floor";
    }

    // speed burst with afterimages (cooldown 2.5s)
    dash() {
        if (!this.alive || this.dashCd > 0) return;
        this.dashT = 0.4;
        this.dashCd = 2.5;
        this.ghostT = 0;
        Sfx.play("power", 0.5);
    }

    // momentary slow-down for timing pistons/drones (cooldown 2.5s)
    brake() {
        if (!this.alive || this.brakeCd > 0) return;
        this.brakeT = 0.35;
        this.brakeCd = 2.5;
        Sfx.play("click", 0.7);
    }

    // slam: instant drop toward the current gravity side (airborne only)
    slam() {
        if (!this.alive || this.grounded) return;
        this.vy = this.gravityDir * MAX_FALL;
        Fx.flipDust(this.node.parent, this.node.x, this.node.y, -this.gravityDir);
        Sfx.play("flip", 0.45);
    }

    applyPower(type: string) {
        if (type === "shield") {
            this.shield = true;
            this.shieldNode.active = true;
        } else if (type === "magnet") {
            this.magnetT = 6;
        } else if (type === "slow") {
            this.mgr.applySlow(4, 0.55);
        }
        Sfx.play("power", 0.9);
    }

    update(rawDt: number) {
        if (!this.alive || !this.mgr || !this.mgr.isRunning()) return;
        const dt = Math.min(rawDt, 1 / 30) * this.mgr.timeScale;
        if (this.invincibleT > 0) this.invincibleT -= rawDt;
        if (this.magnetT > 0) this.magnetT -= rawDt;

        // skill timers run on real time
        if (this.dashT > 0) this.dashT -= rawDt;
        if (this.dashCd > 0) this.dashCd -= rawDt;
        if (this.brakeT > 0) this.brakeT -= rawDt;
        if (this.brakeCd > 0) this.brakeCd -= rawDt;

        const n = this.node;
        const speedFactor = this.dashT > 0 ? 1.55 : (this.brakeT > 0 ? 0.55 : 1);
        const rhythmSpeed = (this.mgr && (this.mgr as any).rhythmSpeedMultiplier)
            ? Math.max(0.5, Math.min(1.8, Number((this.mgr as any).rhythmSpeedMultiplier()) || 1))
            : 1;
        n.x += (this.level.speed * speedFactor * rhythmSpeed + this.pushVx) * dt;
        if (this.pushVx !== 0) {
            this.pushVx *= Math.max(0, 1 - rawDt * 6);
            if (Math.abs(this.pushVx) < 5) this.pushVx = 0;
        }
        // dash afterimage trail
        if (this.dashT > 0) {
            this.ghostT -= rawDt;
            if (this.ghostT <= 0) {
                Fx.ghost(n.parent, n);
                this.ghostT = 0.05;
            }
        }
        const rhythm = this.level ? this.level.rhythm : null;
        if (rhythm && rhythm.enabled && rhythm.style === "jump-flip" && this.rhythmSnapBackT > 0) {
            // During the scripted light-jump arc, keep the player under direct
            // rhythm control instead of normal gravity, so the hop is readable
            // and cannot accidentally launch the cube out of the corridor.
            this.rhythmSnapBackT -= rawDt;
            if (this.rhythmSnapBackT <= 0 && this.gravityDir === this.rhythmSnapBackDir) {
                this.node.y = this.rhythmSnapBackY;
                this.vy = 0;
                this.grounded = true;
                this.wasGrounded = true;
            }
            if (this.overlaps(this.level.goal, 0)) {
                this.alive = false;
                this.mgr.onWin(this);
            }
            return;
        }
        if (rhythm && rhythm.enabled && rhythm.style === "gravity-collect") {
            // Multi-lane rhythm mode: the runner is a rail-rider.  Gravity flips
            // choose which rhythm lane to move toward; missing notes does not kill.
            const diffY = this.rhythmTargetY - n.y;
            const maxStep = 1800 * dt;
            if (Math.abs(diffY) <= maxStep) n.y = this.rhythmTargetY;
            else n.y += diffY > 0 ? maxStep : -maxStep;
            if (this.overlaps(this.level.goal, 0)) {
                this.alive = false;
                this.mgr.onWin(this);
            }
            return;
        }
        const gravity = rhythm && rhythm.enabled ? (rhythm.gravity || GRAVITY) : GRAVITY;
        const maxFall = rhythm && rhythm.enabled ? (rhythm.maxFall || MAX_FALL) : MAX_FALL;
        this.vy += this.gravityDir * gravity * dt;
        this.vy = Math.max(-maxFall, Math.min(maxFall, this.vy));
        n.y += this.vy * dt;

        this.grounded = false;
        let pushUp = false;
        let pushDown = false;
        for (const r of this.level.solids) {
            const px = (BODY_W + r.w) / 2 - Math.abs(n.x - r.x);
            if (px <= 0) continue;
            const py = (BODY_H + r.h) / 2 - Math.abs(n.y - r.y);
            if (py <= 0) continue;

            if (py <= px) {
                // vertical resolve (land or head-bump)
                const dir = n.y >= r.y ? 1 : -1;
                n.y += dir * py;
                this.vy = 0;
                if (dir === -this.gravityDir) this.grounded = true;
                if (dir > 0) pushUp = true; else pushDown = true;
            } else {
                // horizontal resolve — running into a wall face is lethal
                const dirx = n.x >= r.x ? 1 : -1;
                n.x += dirx * px;
                if (dirx < 0 && px > 6) {
                    this.hit("wall");
                    if (!this.alive) return;
                }
            }
        }
        // squeezed between two solids (e.g. a piston and the opposite band)
        if (pushUp && pushDown) {
            this.die();
            return;
        }

        // landing squash animation
        if (this.grounded && !this.wasGrounded) {
            const sign = this.gravityDir > 0 ? -1 : 1;
            n.scaleX = 1.18;
            n.scaleY = sign * 0.8;
            cc.tween(n).to(0.12, { scaleX: 1, scaleY: sign }).start();
            if (this.isJumpFlipRhythm()) {
                if (this.rhythmFlipAirborne && this.gravityDir !== this.rhythmLastSurfaceDir &&
                    this.mgr && (this.mgr as any).onRhythmSurfaceHit) {
                    (this.mgr as any).onRhythmSurfaceHit(this.node.x, this.node.y);
                }
                this.rhythmLastSurfaceDir = this.gravityDir;
                this.rhythmFlipAirborne = false;
            }
        }
        this.wasGrounded = this.grounded;

        // teleporters (one-way, exits are always forward so no re-trigger)
        for (const t of this.level.teleports) {
            if (Math.abs(n.x - t.x) < 40 && Math.abs(n.y - t.y) < 40) {
                Fx.teleport(n.parent, n.x, n.y);
                n.setPosition(t.tx, t.ty);
                this.vy = 0;
                this.gravityDir = t.ty >= 0 ? 1 : -1;
                this.grounded = false;
                this.node.scaleY = this.gravityDir > 0 ? -1 : 1;
                Fx.teleport(n.parent, t.tx, t.ty);
                Sfx.play("teleport", 0.9);
                break;
            }
        }

        // fell/flew out of the corridor through a gap (shield can't save this)
        if (Math.abs(n.y) > 520) {
            this.die();
            return;
        }

        // spikes (slightly forgiving hitbox)
        for (const s of this.level.spikes) {
            if (this.overlaps(s, -8)) {
                this.hit("spike");
                if (!this.alive) return;
                break;
            }
        }

        // patrol drones
        for (const e of this.level.enemies) {
            if (Math.abs(n.x - e.node.x) < 32 && Math.abs(n.y - e.node.y) < 32) {
                this.hit("enemy");
                if (!this.alive) return;
                break;
            }
        }

        // crystals — the magnet visibly drags them toward the player
        this.magnetAura.active = this.magnetT > 0;
        for (const c of this.level.crystals) {
            if (c.taken) continue;
            if (this.magnetT > 0) {
                const ddx = c.node.x - n.x;
                const ddy = c.node.y - n.y;
                const d = Math.sqrt(ddx * ddx + ddy * ddy);
                if (d > 1 && d < 230) {
                    const m = Math.min(1, (900 * dt) / d);
                    c.node.x -= ddx * m;
                    c.node.y -= ddy * m;
                }
            }
            if (Math.abs(c.node.x - n.x) < 38 && Math.abs(c.node.y - n.y) < 38) {
                c.taken = true;
                c.node.active = false;
                Fx.crystal(n.parent, c.node.x, c.node.y, c.node.color);
                this.mgr.onCrystal();
            }
        }

        // powerups
        for (const p of this.level.powerups) {
            if (!p.taken && Math.abs(n.x - p.x) < 36 && Math.abs(n.y - p.y) < 36) {
                p.taken = true;
                p.node.active = false;
                this.applyPower(p.type);
            }
        }

        // goal
        if (this.overlaps(this.level.goal, 0)) {
            this.alive = false;
            this.mgr.onWin(this);
        }
    }

    private overlaps(r: RectDef, shrink: number): boolean {
        const n = this.node;
        return Math.abs(n.x - r.x) < (BODY_W + shrink + r.w) / 2 &&
               Math.abs(n.y - r.y) < (BODY_H + shrink + r.h) / 2;
    }

    // Lethal contact that a shield / invincibility may absorb.
    // Shield only saves spike/enemy hits — a wall face stops you physically,
    // so surviving it would leave the runner stuck (worse than death).
    private hit(cause: string) {
        if (this.invincibleT > 0) return;
        if (this.shield && cause !== "wall") {
            this.shield = false;
            this.shieldNode.active = false;
            Sfx.play("shieldbreak", 0.9);
            this.setInvincible(1.2);
            return;
        }
        this.die();
    }

    private die() {
        if (!this.alive) return;
        this.alive = false;
        const skin = GameData.skinOf(this.index === 0
            ? GameData.settings.skin1 : GameData.settings.skin2);
        Fx.death(this.node.parent, this.node.x, this.node.y, skin.color);
        this.node.stopAllActions();
        cc.tween(this.node)
            .parallel(
                cc.tween().to(0.35, { scale: 2.2, opacity: 0 }),
                cc.tween().by(0.35, { angle: 180 })
            )
            .call(() => { this.node.active = false; })
            .start();
        this.mgr.onDeath(this);
    }

    rhythmGateFail() {
        if (this.isMultiLaneRhythm()) return;
        this.die();
    }

    getGravityDir(): number {
        return this.gravityDir;
    }

    // ---------- player-vs-player elastic collision support ----------

    getVelY(): number {
        return this.vy;
    }

    setVelY(v: number) {
        this.vy = v;
    }

    addPushX(v: number) {
        this.pushVx += v;
    }
}
