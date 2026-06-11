// Global game state shared across scenes (plain module, not a component).
export default class GameData {
    static readonly MAX_LEVEL = 3;

    // Which level the Game scene should load.
    static currentLevel = 1;

    private static readonly KEY = "gfr_unlocked";

    static getUnlocked(): number {
        const raw = cc.sys.localStorage.getItem(GameData.KEY);
        const v = parseInt(raw || "1", 10);
        if (isNaN(v) || v < 1) return 1;
        return Math.min(v, GameData.MAX_LEVEL);
    }

    static unlockNext(clearedLevel: number) {
        const next = Math.min(clearedLevel + 1, GameData.MAX_LEVEL);
        if (next > GameData.getUnlocked()) {
            cc.sys.localStorage.setItem(GameData.KEY, String(next));
        }
    }
}
