// Global game state shared across scenes (plain module, not a component).

export interface Settings {
    sfx: number;        // 0..1
    bgm: number;        // 0..1
    speed: number;      // game speed multiplier 0.8 / 1.0 / 1.2
    scheme: number;     // color scheme index, see LevelBuilder.SCHEMES
    brightness: number; // 0.6 / 0.8 / 1.0
    rhythmGap: number; // rhythm mode floor/ceiling distance in px
    rhythmJumpKeys: string; // comma-separated key names, e.g. f,j
    rhythmFlipKeys: string; // comma-separated key names, e.g. d,k
    rhythmSpeedScale: number; // rhythm scroll / flow multiplier, 0.1..2.0
    onlineCollide: number;    // 0 = pass-through ghosts, 1 = elastic collision
    skin1: number;            // P1 skin index, see GameData.SKINS
    skin2: number;            // P2 skin index
}

export default class GameData {
    static readonly MAX_LEVEL = 5;

    // Player skins: texture frame name + accent color (death burst etc).
    static readonly SKINS = [
        { name: "CYAN", frame: "player", color: cc.color(56, 224, 255) },
        { name: "ORANGE", frame: "player2", color: cc.color(255, 170, 60) },
        { name: "GREEN", frame: "player_green", color: cc.color(90, 255, 120) },
        { name: "PURPLE", frame: "player_purple", color: cc.color(190, 120, 255) }
    ];

    static skinOf(index: number) {
        const i = Math.max(0, Math.min(GameData.SKINS.length - 1, Math.round(index) || 0));
        return GameData.SKINS[i];
    }

    // Which level the Game scene should load. 0 = the player-made custom
    // level stored in localStorage under CUSTOM_KEY (see EditorCtrl).
    static currentLevel = 1;
    // Optional resources path for rhythm levels, for example
    // "levels/rhythm/my_song_oni". When empty, GameMgr loads
    // the classic numbered path "levels/level" + currentLevel.
    static currentLevelPath = "";

    // A mid-run save state waiting to be applied by GameMgr after the level
    // is built (set by the pause-menu LOAD STATE flow).
    static pendingState: any = null;

    // Online room race: code shown to/entered by players, and the host-set
    // synchronized start time (server clock). Cleared when back in the menu.
    static roomCode: string = "";
    static roomT0 = 0;

    // Rhythm play style chosen from the song menu.
    // solo  = normal one-player rhythm
    // ai    = local score battle against an automated opponent
    // online= Firebase room race; remote players appear as score ghosts
    // fight-ai / fight-online = score battle plus attack notes and temporary jams
    static rhythmBattleMode: string = "solo";

    static readonly CUSTOM_KEY = "gfr_custom_level";

    static hasCustomLevel(): boolean {
        return !!cc.sys.localStorage.getItem(GameData.CUSTOM_KEY);
    }

    // Endless mode best distance, in meters. currentLevel === -1 -> endless.
    private static readonly BEST_KEY = "gfr_best_dist";

    // Transient value used only while reloading the Game scene after an
    // endless-mode life loss. 0 means "start a fresh run with full health".
    static carriedHealth = 0;

    static getBestDist(): number {
        const v = parseInt(cc.sys.localStorage.getItem(GameData.BEST_KEY) || "0", 10);
        return isNaN(v) ? 0 : v;
    }

    static setBestDist(m: number) {
        cc.sys.localStorage.setItem(GameData.BEST_KEY, String(Math.floor(m)));
    }

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

    // Raw overwrite — used when switching save slots.
    static setUnlocked(v: number) {
        const c = Math.max(1, Math.min(Math.floor(v) || 1, GameData.MAX_LEVEL));
        cc.sys.localStorage.setItem(GameData.KEY, String(c));
    }

    private static loadSettings(): Settings {
        const def: Settings = { sfx: 1, bgm: 0.6, speed: 1, scheme: 0, brightness: 1, rhythmGap: 280, rhythmJumpKeys: "f,j", rhythmFlipKeys: "d,k", rhythmSpeedScale: 1, onlineCollide: 0, skin1: 0, skin2: 1 };
        try {
            const raw = cc.sys.localStorage.getItem(GameData.SETTINGS_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                for (const k in def) {
                    if (typeof (def as any)[k] === "number" && typeof s[k] === "number") (def as any)[k] = s[k];
                    if (typeof (def as any)[k] === "string" && typeof s[k] === "string") (def as any)[k] = s[k];
                }
            }
        } catch (e) { /* corrupted settings -> defaults */ }
        return def;
    }

    static saveSettings() {
        cc.sys.localStorage.setItem(GameData.SETTINGS_KEY, JSON.stringify(GameData.settings));
    }
}
