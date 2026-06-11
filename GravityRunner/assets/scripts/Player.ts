import { LevelData, RectDef } from "./LevelBuilder";
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
        // P2 trails slightly behind so the cubes don't overlap
        this.node.setPosition(this.level.start.x - this.index * 60, this.level.start.y);
        this.vy = 0;
        this.gravityDir = -1;
        this.grounded = true;
        this.alive = true;
        this.shield = false;
        this.magnetT = 0;
        this.invincibleT = 0;
        this.dashT = 0;
        this.dashCd = 0;
        this.brakeT = 0;
        this.brakeCd = 0;
        this.wasGrounded = true;
        this.shieldNode.active = false;
        this.magnetAura.active = false;
        this.node.active = true;
        this.node.opacity = 255;
        this.node.scaleX = 1;
        this.node.scaleY = 1;
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

    flip() {
        if (!this.alive || !this.grounded) return;
        const feetY = this.node.y + this.gravityDir * 17;
        this.gravityDir *= -1;
        this.grounded = false;
        this.wasGrounded = false;
        // animated spin-flip instead of an instant mirror
        cc.tween(this.node)
            .to(0.16, { scaleY: this.gravityDir > 0 ? -1 : 1 })
            .start();
        Fx.flipDust(this.node.parent, this.node.x, feetY, this.gravityDir);
        Sfx.play("flip", 0.8);
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
        n.x += this.level.speed * speedFactor * dt;
        // dash afterimage trail
        if (this.dashT > 0) {
            this.ghostT -= rawDt;
            if (this.ghostT <= 0) {
                Fx.ghost(n.parent, n);
                this.ghostT = 0.05;
            }
        }
        this.vy += this.gravityDir * GRAVITY * dt;
        this.vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, this.vy));
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
        Fx.death(this.node.parent, this.node.x, this.node.y,
            this.index === 0 ? cc.color(56, 224, 255) : cc.color(255, 170, 60));
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

    getGravityDir(): number {
        return this.gravityDir;
    }
}
