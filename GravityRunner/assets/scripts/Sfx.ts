import GameData from "./GameData";

// Tiny audio helper. Clips live in assets/resources/audio/<name>.wav (or .mp3).
// All volumes are scaled by the user's settings (GameData.settings).
export default class Sfx {
    private static clips: { [name: string]: cc.AudioClip } = {};
    private static bgmId = -1;

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

    // BGM is optional: drop a file at resources/audio/bgm.mp3 and this picks it up.
    static playBgm() {
        if (Sfx.bgmId >= 0) {
            Sfx.applyBgmVolume();
            return;
        }
        cc.resources.load("audio/bgm", cc.AudioClip, (err, clip) => {
            if (!err && clip && Sfx.bgmId < 0) {
                Sfx.bgmId = cc.audioEngine.play(clip as any, true, GameData.settings.bgm);
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
    }
}
