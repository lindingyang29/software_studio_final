// Global game state shared across scenes (plain module, not a component).

export interface Settings {
    sfx: number;        // 0..1
    bgm: number;        // 0..1
    speed: number;      // game speed multiplier 0.8 / 1.0 / 1.2
    scheme: number;     // color scheme index, see LevelBuilder.SCHEMES
    brightness: number; // 0.6 / 0.8 / 1.0
}

export default class GameData {
    static readonly MAX_LEVEL = 3;

    // Which level the Game scene should load.
    static currentLevel = 1;

    // 1 = solo, 2 = local co-op (P1=W, P2=UP/SPACE).
    static players = 1;

    static settings: Settings = GameData.loadSettings();

    private static readonly KEY = "gfr_unlocked";
    private static readonly SETTINGS_KEY = "gfr_settings";

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

    private static loadSettings(): Settings {
        const def: Settings = { sfx: 1, bgm: 0.6, speed: 1, scheme: 0, brightness: 1 };
        try {
            const raw = cc.sys.localStorage.getItem(GameData.SETTINGS_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                for (const k in def) {
                    if (typeof s[k] === "number") (def as any)[k] = s[k];
                }
            }
        } catch (e) { /* corrupted settings -> defaults */ }
        return def;
    }

    static saveSettings() {
        cc.sys.localStorage.setItem(GameData.SETTINGS_KEY, JSON.stringify(GameData.settings));
    }
}
