// Firebase glue: email/password auth, per-account cloud save, leaderboard.
// Loads the v8 (compat) SDK from CDN at runtime, so nothing is bundled.
// Everything degrades gracefully: if FbConfig is empty, the SDK fails to
// load, or the user is logged out, the game keeps using localStorage only.

import FB_CONFIG from "./FbConfig";
import GameData from "./GameData";

const SDK_BASE = "https://www.gstatic.com/firebasejs/8.10.1/";
const SDK_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-database.js"];

export default class Fb {
    private static state = "idle"; // idle | loading | ready | failed
    private static authUser: any = null;

    // Single UI callback (the menu re-registers itself each time it loads).
    static onChanged: () => void = null;

    static enabled(): boolean {
        return !!(FB_CONFIG && FB_CONFIG.apiKey) && cc.sys.isBrowser;
    }

    static ready(): boolean {
        return Fb.state === "ready";
    }

    static user(): any {
        return Fb.authUser;
    }

    static userName(): string {
        if (!Fb.authUser) return "";
        const e = Fb.authUser.email || "";
        const at = e.indexOf("@");
        return at > 0 ? e.substring(0, at) : e;
    }

    private static emit() {
        if (Fb.onChanged) Fb.onChanged();
    }

    private static sdk(): any {
        return (window as any).firebase;
    }

    static init() {
        if (!Fb.enabled() || Fb.state !== "idle") return;
        Fb.state = "loading";
        let loaded = 0;
        for (const f of SDK_FILES) {
            const s = document.createElement("script");
            s.src = SDK_BASE + f;
            s.async = false; // preserve execution order: app -> auth -> database
            s.onload = () => {
                loaded++;
                if (loaded < SDK_FILES.length) return;
                try {
                    Fb.sdk().initializeApp(FB_CONFIG);
                    Fb.sdk().auth().onAuthStateChanged((u: any) => {
                        Fb.authUser = u;
                        if (u) Fb.pullAndMerge();
                        Fb.emit();
                    });
                    Fb.state = "ready";
                } catch (e) {
                    Fb.state = "failed";
                }
                Fb.emit();
            };
            s.onerror = () => {
                Fb.state = "failed";
                Fb.emit();
            };
            document.head.appendChild(s);
        }
    }

    // ---------- auth ----------

    static register(email: string, pw: string, done: (err: string) => void) {
        if (!Fb.ready()) return done("not ready");
        Fb.sdk().auth().createUserWithEmailAndPassword(email, pw)
            .then(() => done(null))
            .catch((e: any) => done(Fb.errMsg(e)));
    }

    static login(email: string, pw: string, done: (err: string) => void) {
        if (!Fb.ready()) return done("not ready");
        Fb.sdk().auth().signInWithEmailAndPassword(email, pw)
            .then(() => done(null))
            .catch((e: any) => done(Fb.errMsg(e)));
    }

    static logout() {
        if (Fb.ready()) Fb.sdk().auth().signOut();
    }

    private static errMsg(e: any): string {
        return (e && e.code) ? String(e.code).replace("auth/", "").replace(/-/g, " ") : "error";
    }

    // ---------- cloud save + leaderboard ----------

    // Push local progress to the account (called after unlock / new best).
    static syncUp() {
        if (!Fb.ready() || !Fb.authUser) return;
        const db = Fb.sdk().database();
        db.ref("saves/" + Fb.authUser.uid).set({
            unlocked: GameData.getUnlocked(),
            best: GameData.getBestDist(),
            t: Date.now()
        });
        db.ref("leaderboard/" + Fb.authUser.uid).set({
            name: Fb.userName(),
            best: GameData.getBestDist(),
            t: Date.now()
        });
    }

    // On login: merge cloud progress into local (keep the better of each),
    // then push the merged result back up.
    static pullAndMerge() {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.sdk().database().ref("saves/" + Fb.authUser.uid).once("value")
            .then((snap: any) => {
                const v = snap.val();
                if (v) {
                    if (v.unlocked > GameData.getUnlocked()) GameData.unlockNext(v.unlocked - 1);
                    if (v.best > GameData.getBestDist()) GameData.setBestDist(v.best);
                }
                Fb.syncUp();
                Fb.emit();
            })
            .catch(() => { /* offline: keep local */ });
    }

    static fetchTop(n: number, done: (rows: { name: string; best: number }[]) => void) {
        if (!Fb.ready()) return done(null);
        Fb.sdk().database().ref("leaderboard").orderByChild("best").limitToLast(n).once("value")
            .then((snap: any) => {
                const rows: { name: string; best: number }[] = [];
                snap.forEach((ch: any) => { rows.push(ch.val()); });
                rows.sort((a, b) => (b.best || 0) - (a.best || 0));
                done(rows);
            })
            .catch(() => done(null));
    }
}
