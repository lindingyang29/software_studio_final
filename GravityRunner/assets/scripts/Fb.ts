// Firebase glue: email/password auth, per-account progress sync, six
// mid-run save-state slots, and the endless leaderboard.
// Loads the v8 (compat) SDK from CDN at runtime, so nothing is bundled.
// Everything degrades gracefully: if FbConfig is empty, the SDK fails to
// load, or the user is logged out, the game keeps using localStorage only.
//
// RTDB layout:
//   saves/{uid}        = { unlocked, best, states: {0..5}, t }
//   leaderboard/{uid}  = { name, best, t, _live: {...} }
//
// (Older accounts may still have the retired multi-slot schema
//  saves/{uid}/slots/{id}; loadCloud() migrates them by taking the best
//  progress across all slots.)

import FB_CONFIG from "./FbConfig";
import GameData from "./GameData";

const SDK_BASE = "https://www.gstatic.com/firebasejs/8.10.1/";
const SDK_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-database.js"];

export default class Fb {
    private static state = "idle"; // idle | loading | ready | failed
    private static authUser: any = null;
    // uid of the first auth event after page load; null = none seen yet.
    // Any LATER change (login / logout / account switch) hard-reloads the
    // page so no progress leaks between accounts.
    private static baseUid: string = null;
    private static allowAuthChangeNoReload = false;

    // Mid-run save states (6 fixed slots; null = empty). Cloud when logged
    // in, localStorage otherwise.
    static readonly MAX_STATES = 6;
    private static states: any[] = [null, null, null, null, null, null];
    private static readonly STATES_KEY = "gfr_states";

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

    static uid(): string {
        return Fb.authUser ? Fb.authUser.uid : "";
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
                        const uid = u ? u.uid : "";
                        if (Fb.baseUid !== null && uid !== Fb.baseUid) {
                            if (Fb.allowAuthChangeNoReload) {
                                Fb.allowAuthChangeNoReload = false;
                                Fb.baseUid = uid;
                                Fb.authUser = u;
                                if (u) {
                                    Fb.loadCloud();
                                } else {
                                    Fb.states = [null, null, null, null, null, null];
                                }
                                Fb.emit();
                                return;
                            }
                            // login / logout / account switch after page load:
                            // wipe guest-visible progress and restart clean.
                            if (!u) {
                                GameData.setUnlocked(1);
                                GameData.setBestDist(0);
                            }
                            (window as any).location.reload();
                            return;
                        }
                        Fb.baseUid = uid;
                        Fb.authUser = u;
                        if (u) {
                            Fb.loadCloud();
                        } else {
                            Fb.states = [null, null, null, null, null, null];
                        }
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
            .catch((e: any) => done(Fb.errMsg(e, false)));
    }

    static login(email: string, pw: string, done: (err: string) => void) {
        if (!Fb.ready()) return done("not ready");
        Fb.sdk().auth().signInWithEmailAndPassword(email, pw)
            .then(() => done(null))
            .catch((e: any) => done(Fb.errMsg(e, true)));
    }

    static logout() {
        if (Fb.ready()) Fb.sdk().auth().signOut();
    }

    static noReloadOnNextAuthChange() {
        Fb.allowAuthChangeNoReload = true;
    }

    private static errMsg(e: any, loggingIn: boolean): string {
        const code = (e && e.code) ? String(e.code).replace("auth/", "") : "";
        if (loggingIn) {
            if (code === "wrong-password"
                || code === "user-not-found"
                || code === "invalid-login-credentials"
                || code === "internal-error") {
                return "Incorrect email or password.";
            }
        }
        if (code === "invalid-email") return "Invalid email address.";
        if (code === "email-already-in-use") return "Email is already registered.";
        if (code === "weak-password") return "Password is too weak.";
        if (code === "too-many-requests") return "Too many attempts. Try again later.";
        if (code === "network-request-failed") return "Network error. Please try again.";
        return code ? code.replace(/-/g, " ") : "Error. Please try again.";
    }

    // ---------- progress sync ----------

    // On login: merge cloud progress into local (keep the better of each),
    // load save states, migrate retired multi-slot accounts, then push the
    // merged result back up.
    private static loadCloud() {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.sdk().database().ref("saves/" + Fb.authUser.uid).once("value")
            .then((snap: any) => {
                const v = snap.val();
                let cloudUnlocked = 1;
                let cloudBest = 0;
                if (v && v.slots) {
                    // retired multi-slot schema: best progress across slots
                    for (const id in v.slots) {
                        const s = v.slots[id];
                        if (s) {
                            cloudUnlocked = Math.max(cloudUnlocked, s.unlocked || 1);
                            cloudBest = Math.max(cloudBest, s.best || 0);
                        }
                    }
                } else if (v) {
                    cloudUnlocked = v.unlocked || 1;
                    cloudBest = v.best || 0;
                }
                if (cloudUnlocked > GameData.getUnlocked()) GameData.setUnlocked(cloudUnlocked);
                if (cloudBest > GameData.getBestDist()) GameData.setBestDist(cloudBest);

                Fb.states = [null, null, null, null, null, null];
                if (v && v.states) {
                    for (let i = 0; i < Fb.MAX_STATES; i++) {
                        if (v.states[i]) Fb.states[i] = v.states[i];
                    }
                }
                Fb.pushAll();
                Fb.emit();
            })
            .catch(() => { /* offline: keep local */ });
    }

    // Write progress + states + leaderboard entry to the cloud.
    private static pushAll() {
        if (!Fb.ready() || !Fb.authUser) return;
        const db = Fb.sdk().database();
        const statesObj: any = {};
        for (let i = 0; i < Fb.MAX_STATES; i++) {
            if (Fb.states[i]) statesObj[i] = Fb.states[i];
        }
        db.ref("saves/" + Fb.authUser.uid).set({
            unlocked: GameData.getUnlocked(),
            best: GameData.getBestDist(),
            states: statesObj,
            t: Date.now()
        });
        // whole-node set also clears retired per-slot entries; _live is
        // re-broadcast at 8Hz while playing, so losing it here is harmless
        db.ref("leaderboard/" + Fb.authUser.uid).set({
            name: Fb.userName(),
            best: GameData.getBestDist(),
            t: Date.now()
        });
    }

    // Auto-save current progress (called after level clears and new bests).
    static syncUp() {
        Fb.pushAll();
    }

    // ---------- mid-run save states ----------

    private static localStates(): any[] {
        try {
            const arr = JSON.parse(cc.sys.localStorage.getItem(Fb.STATES_KEY) || "[]");
            const out = [null, null, null, null, null, null];
            for (let i = 0; i < Fb.MAX_STATES; i++) out[i] = arr[i] || null;
            return out;
        } catch (e) {
            return [null, null, null, null, null, null];
        }
    }

    static getStates(): any[] {
        return Fb.user() ? Fb.states : Fb.localStates();
    }

    // st = null clears the slot.
    static saveState(i: number, st: any) {
        if (i < 0 || i >= Fb.MAX_STATES) return;
        if (Fb.user()) {
            Fb.states[i] = st;
            Fb.pushAll();
        } else {
            const arr = Fb.localStates();
            arr[i] = st;
            cc.sys.localStorage.setItem(Fb.STATES_KEY, JSON.stringify(arr));
        }
    }

    // ---------- rooms (host-started synced races) ----------
    // Host:   leaderboard/{hostUid}/room   = { code, lv, start?, t }
    // Member: leaderboard/{uid}/joined     = { code, name, t }
    // Both are owner-writable under the existing rules and removed on
    // disconnect, so rooms dissolve when the host drops.

    private static serverOffset = 0;
    private static offsetArmed = false;
    private static roomArmed = false;
    private static joinedArmed = false;
    private static lobbyHandle: { ref: any; handler: any } = null;

    static serverNow(): number {
        return Date.now() + Fb.serverOffset;
    }

    private static armServerClock() {
        if (Fb.offsetArmed || !Fb.ready()) return;
        Fb.offsetArmed = true;
        Fb.sdk().database().ref(".info/serverTimeOffset").on("value", (snap: any) => {
            Fb.serverOffset = snap.val() || 0;
        });
    }

    static createRoom(code: string, lv: number, path: string = "", title: string = "") {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.armServerClock();
        const r = Fb.sdk().database().ref("leaderboard/" + Fb.authUser.uid + "/room");
        if (!Fb.roomArmed) {
            r.onDisconnect().remove();
            Fb.roomArmed = true;
        }
        r.set({
            code: code,
            lv: lv,
            path: path || "",
            title: title || "",
            mode: path ? "rhythm" : "level",
            t: Date.now()
        });
    }

    static startRoom(t0: number) {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.sdk().database().ref("leaderboard/" + Fb.authUser.uid + "/room/start").set(t0);
    }

    static joinRoom(code: string) {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.armServerClock();
        const r = Fb.sdk().database().ref("leaderboard/" + Fb.authUser.uid + "/joined");
        if (!Fb.joinedArmed) {
            r.onDisconnect().remove();
            Fb.joinedArmed = true;
        }
        r.set({ code: code, name: Fb.userName(), t: Date.now() });
    }

    static leaveRoom() {
        if (!Fb.ready() || !Fb.authUser) return;
        const db = Fb.sdk().database();
        db.ref("leaderboard/" + Fb.authUser.uid + "/room").remove();
        db.ref("leaderboard/" + Fb.authUser.uid + "/joined").remove();
    }

    // Streams the whole lobby picture: every open room and every member.
    static lobbyListen(cb: (rooms: { uid: string; name: string; room: any }[],
                            members: { uid: string; name: string; code: string }[]) => void) {
        if (!Fb.ready()) return;
        Fb.lobbyOff();
        Fb.armServerClock();
        const ref = Fb.sdk().database().ref("leaderboard");
        const handler = (snap: any) => {
            const rooms: { uid: string; name: string; room: any }[] = [];
            const members: { uid: string; name: string; code: string }[] = [];
            snap.forEach((child: any) => {
                const v = child.val();
                if (!v) return;
                if (v.room && v.room.code) {
                    rooms.push({ uid: child.key, name: v.name || "host", room: v.room });
                }
                if (v.joined && v.joined.code) {
                    members.push({ uid: child.key, name: v.joined.name || "player", code: v.joined.code });
                }
            });
            cb(rooms, members);
        };
        ref.on("value", handler);
        Fb.lobbyHandle = { ref: ref, handler: handler };
    }

    static lobbyOff() {
        if (Fb.lobbyHandle) {
            Fb.lobbyHandle.ref.off("value", Fb.lobbyHandle.handler);
            Fb.lobbyHandle = null;
        }
    }

    // ---------- live presence (online ghosts) ----------
    // Stored at leaderboard/{uid}/_live so it fits the existing security
    // rules (owner-writable, publicly readable). fetchTop skips it because
    // it has no .best field.

    private static liveHandle: { ref: any; handler: any } = null;
    private static liveDisconnectArmed = false;

    static liveSet(data: any) {
        if (!Fb.ready() || !Fb.authUser) return;
        const r = Fb.sdk().database().ref("leaderboard/" + Fb.authUser.uid + "/_live");
        if (!Fb.liveDisconnectArmed) {
            r.onDisconnect().remove();
            Fb.liveDisconnectArmed = true;
        }
        r.set(data);
    }

    static liveClear() {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.sdk().database().ref("leaderboard/" + Fb.authUser.uid + "/_live").remove();
    }

    static liveListen(cb: (entries: { uid: string; d: any }[]) => void) {
        if (!Fb.ready()) return;
        Fb.liveOff();
        const ref = Fb.sdk().database().ref("leaderboard");
        const handler = (snap: any) => {
            const out: { uid: string; d: any }[] = [];
            snap.forEach((child: any) => {
                const v = child.val();
                if (v && v._live && typeof v._live.x === "number") {
                    out.push({ uid: child.key, d: v._live });
                }
            });
            cb(out);
        };
        ref.on("value", handler);
        Fb.liveHandle = { ref: ref, handler: handler };
    }

    static liveOff() {
        if (Fb.liveHandle) {
            Fb.liveHandle.ref.off("value", Fb.liveHandle.handler);
            Fb.liveHandle = null;
        }
    }

    // ---------- leaderboard ----------

    // Tolerates: current flat {name,best}, retired per-slot {slotId:{n,best}}.
    static fetchTop(n: number, done: (rows: { name: string; best: number }[]) => void) {
        if (!Fb.ready()) return done(null);
        Fb.sdk().database().ref("leaderboard").once("value")
            .then((snap: any) => {
                const rows: { name: string; best: number }[] = [];
                snap.forEach((userChild: any) => {
                    const v = userChild.val();
                    if (!v) return;
                    if (typeof v.best === "number") {
                        rows.push({ name: v.name || "???", best: v.best });
                        return;
                    }
                    for (const k in v) {
                        if (k === "_live") continue;
                        const e = v[k];
                        if (e && typeof e.best === "number") {
                            rows.push({ name: e.n || e.name || "???", best: e.best });
                        }
                    }
                });
                rows.sort((a, b) => (b.best || 0) - (a.best || 0));
                done(rows.slice(0, n));
            })
            .catch(() => done(null));
    }
}
