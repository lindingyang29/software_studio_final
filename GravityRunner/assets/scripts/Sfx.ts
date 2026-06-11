import GameData from "./GameData";

// Tiny audio helper. Clips live in assets/resources/audio/<name>.wav (or .mp3).
// All volumes are scaled by the user's settings (GameData.settings).
export default class Sfx {
    private static clips: { [name: string]: cc.AudioClip } = {};
    private static bgmId = -1;
    private static bgmTrack = "";

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
        if (Sfx.bgmTrack === track && Sfx.bgmId >= 0) {
            Sfx.applyBgmVolume();
            return;
        }
        Sfx.stopBgm();
        Sfx.bgmTrack = track;
        cc.resources.load("audio/" + track, cc.AudioClip, (err, clip) => {
            if (!err && clip && Sfx.bgmTrack === track && Sfx.bgmId < 0) {
                Sfx.bgmId = cc.audioEngine.play(clip as any, true, GameData.settings.bgm * 0.8);
            }
        });
    }

    static applyBgmVolume() {
        if (Sfx.bgmId >= 0) cc.audioEngine.setVolume(Sfx.bgmId, GameData.settings.bgm);
    }

    static stopBgm() {
        if (Sfx.bgmId >= 0) {
            cc.audioEngine.stop(Sfx.bgmId);
            Sfx.bgmId = -1;
        }
        Sfx.bgmTrack = "";
    }
}
