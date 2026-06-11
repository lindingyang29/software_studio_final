import { LevelData, RectDef } from "./LevelBuilder";
import Sfx from "./Sfx";
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

    private mgr: GameMgr = null;
    private level: LevelData = null;
    private vy = 0;
    private gravityDir = -1; // -1: pulls toward floor, +1: toward ceiling
    private grounded = false;

    init(mgr: GameMgr, level: LevelData) {
        this.mgr = mgr;
        this.level = level;
        this.reset();
    }

    reset() {
        this.node.stopAllActions();
        this.node.setPosition(this.level.start.x, this.level.start.y);
        this.vy = 0;
        this.gravityDir = -1;
        this.grounded = true;
        this.alive = true;
        this.node.active = true;
        this.node.opacity = 255;
        this.node.scaleX = 1;
        this.node.scaleY = 1;
        this.node.angle = 0;
    }

    flip() {
        if (!this.alive || !this.grounded) return;
        this.gravityDir *= -1;
        this.grounded = false;
        this.node.scaleY = this.gravityDir > 0 ? -1 : 1;
        Sfx.play("flip", 0.8);
    }

    update(dt: number) {
        if (!this.alive || !this.mgr || !this.mgr.isRunning()) return;
        dt = Math.min(dt, 1 / 30); // avoid tunneling after a hitch

        const n = this.node;
        n.x += this.level.speed * dt;
        this.vy += this.gravityDir * GRAVITY * dt;
        this.vy = Math.max(-MAX_FALL, Math.min(MAX_FALL, this.vy));
        n.y += this.vy * dt;

        this.grounded = false;
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
            } else {
                // horizontal resolve — running into a wall face is lethal
                const dirx = n.x >= r.x ? 1 : -1;
                n.x += dirx * px;
                if (dirx < 0 && px > 6) {
                    this.die();
                    return;
                }
            }
        }

        // fell/flew out of the corridor through a gap
        if (Math.abs(n.y) > 520) {
            this.die();
            return;
        }

        // spikes (slightly forgiving hitbox)
        for (const s of this.level.spikes) {
            if (this.overlaps(s, -8)) {
                this.die();
                return;
            }
        }

        // crystals
        for (const c of this.level.crystals) {
            if (!c.taken && Math.abs(n.x - c.x) < 36 && Math.abs(n.y - c.y) < 36) {
                c.taken = true;
                c.node.active = false;
                this.mgr.onCrystal();
            }
        }

        // goal
        if (this.overlaps(this.level.goal, 0)) {
            this.alive = false;
            this.mgr.onWin();
        }
    }

    private overlaps(r: RectDef, shrink: number): boolean {
        const n = this.node;
        return Math.abs(n.x - r.x) < (BODY_W + shrink + r.w) / 2 &&
               Math.abs(n.y - r.y) < (BODY_H + shrink + r.h) / 2;
    }

    private die() {
        if (!this.alive) return;
        this.alive = false;
        cc.tween(this.node)
            .parallel(
                cc.tween().to(0.35, { scale: 2.2, opacity: 0 }),
                cc.tween().by(0.35, { angle: 180 })
            )
            .call(() => { this.node.active = false; })
            .start();
        this.mgr.onDeath();
    }
}
