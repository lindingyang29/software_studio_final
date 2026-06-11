import GameData from "./GameData";

// Tiny audio helper. Clips live in assets/resources/audio/<name>.wav (or .mp3).
// All volumes are scaled by the user's settings (GameData.settings).
export default class Sfx {
    private static clips: { [name: string]: cc.AudioClip } = {};
    private static bgmId = -1;
    private static musicName = "";
    private static loadingMusicName = "";

    static preload() {
        const names = ["flip", "crystal", "death", "win", "click", "power", "teleport", "shieldbreak"];
        for (const n of names) {
            if (Sfx.clips[n]) continue;
            cc.resources.load("audio/" + n, cc.AudioClip, (err, clip) => {
                if (!err && clip) Sfx.clips[n] = clip as any;
            });
        }
    }

    static play(name: string, volume: number = 1) {
        const clip = Sfx.clips[name];
        const v = volume * GameData.settings.sfx;
        if (clip && v > 0) cc.audioEngine.play(clip, false, v);
    }

    // Per-scene looping BGM: pass a track name under resources/audio/
    // (e.g. "bgm_menu", "bgm_game"). Re-calling with the same track is a no-op.
    static playBgm(track: string = "bgm_menu") {
        Sfx.playMusic(track, true);
    }

    // Plays a named music clip from resources/audio/<name>.
    // Used by rhythm levels so the chart can start exactly when the run starts.
    static playMusic(name: string, loop: boolean = true, onStarted?: () => void) {
        if (!name) name = "bgm_menu";
        if (Sfx.bgmId >= 0 && Sfx.musicName === name) {
            Sfx.applyBgmVolume();
            if (onStarted) onStarted();
            return;
        }

        Sfx.stopBgm();
        Sfx.loadingMusicName = name;
        cc.resources.load("audio/" + name, cc.AudioClip, (err, clip) => {
            if (Sfx.loadingMusicName !== name) return;
            if (err || !clip) {
                cc.warn("music load failed: audio/" + name, err);
                Sfx.loadingMusicName = "";
                if (onStarted) onStarted(); // keep the level playable even without audio
                return;
            }
            Sfx.bgmId = cc.audioEngine.play(clip as any, loop, GameData.settings.bgm);
            Sfx.musicName = name;
            Sfx.loadingMusicName = "";
            if (onStarted) onStarted();
        });
    }

    static getMusicTime(): number {
        if (Sfx.bgmId < 0) return 0;
        try {
            return cc.audioEngine.getCurrentTime(Sfx.bgmId) || 0;
        } catch (e) {
            return 0;
        }
    }

    static pauseMusic() {
        if (Sfx.bgmId >= 0) cc.audioEngine.pause(Sfx.bgmId);
    }

    static resumeMusic() {
        if (Sfx.bgmId >= 0) cc.audioEngine.resume(Sfx.bgmId);
    }

    static applyBgmVolume() {
        if (Sfx.bgmId >= 0) cc.audioEngine.setVolume(Sfx.bgmId, GameData.settings.bgm);
    }

    static stopBgm() {
        Sfx.loadingMusicName = "";
        if (Sfx.bgmId >= 0) {
            cc.audioEngine.stop(Sfx.bgmId);
            Sfx.bgmId = -1;
        }
        Sfx.musicName = "";
    }
}
