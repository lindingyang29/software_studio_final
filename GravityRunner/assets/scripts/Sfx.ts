// Tiny audio helper. Clips live in assets/resources/audio/<name>.wav (or .mp3).
export default class Sfx {
    private static clips: { [name: string]: cc.AudioClip } = {};
    private static bgmId = -1;

    static preload() {
        const names = ["flip", "crystal", "death", "win", "click"];
        for (const n of names) {
            if (Sfx.clips[n]) continue;
            cc.resources.load("audio/" + n, cc.AudioClip, (err, clip) => {
                if (!err && clip) Sfx.clips[n] = clip as any;
            });
        }
    }

    static play(name: string, volume: number = 1) {
        const clip = Sfx.clips[name];
        if (clip) cc.audioEngine.play(clip, false, volume);
    }

    // BGM is optional: drop a file at resources/audio/bgm.mp3 and this picks it up.
    static playBgm(volume: number = 0.4) {
        if (Sfx.bgmId >= 0) return;
        cc.resources.load("audio/bgm", cc.AudioClip, (err, clip) => {
            if (!err && clip && Sfx.bgmId < 0) {
                Sfx.bgmId = cc.audioEngine.play(clip as any, true, volume);
            }
        });
    }

    static stopBgm() {
        if (Sfx.bgmId >= 0) {
            cc.audioEngine.stop(Sfx.bgmId);
            Sfx.bgmId = -1;
        }
    }
}
