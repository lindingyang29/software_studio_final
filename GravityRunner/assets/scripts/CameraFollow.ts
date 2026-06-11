const { ccclass } = cc._decorator;

// Follows the player horizontally with a forward look-ahead.
// Attached at runtime by GameMgr; configure via init().
@ccclass
export default class CameraFollow extends cc.Component {
    private target: cc.Node = null;
    private minX = 0;
    private maxX = 0;
    private lookAhead = 160;
    private smooth = 10;

    init(target: cc.Node, minX: number, maxX: number) {
        this.target = target;
        this.minX = minX;
        this.maxX = Math.max(minX, maxX);
        this.node.x = minX;
        this.node.y = 0;
    }

    snap() {
        if (!this.target) return;
        this.node.x = this.clampX(this.target.x + this.lookAhead);
    }

    private clampX(x: number): number {
        return Math.max(this.minX, Math.min(this.maxX, x));
    }

    update(dt: number) {
        if (!this.target || !this.target.isValid) return;
        const targetX = this.clampX(this.target.x + this.lookAhead);
        const t = Math.min(1, this.smooth * dt);
        this.node.x += (targetX - this.node.x) * t;
    }
}
