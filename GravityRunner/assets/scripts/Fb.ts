// Firebase glue: email/password auth, per-account save SLOTS (max 8, each
// independently named, holding unlocked levels + endless best), and a
// leaderboard whose entries display as "account:slotname".
// Loads the v8 (compat) SDK from CDN at runtime, so nothing is bundled.
// Everything degrades gracefully: if FbConfig is empty, the SDK fails to
// load, or the user is logged out, the game keeps using localStorage only.
//
// RTDB layout:
//   saves/{uid}/slots/{slotId} = { name, unlocked, best, t }
//   saves/{uid}/active         = slotId
//   leaderboard/{uid}/{slotId} = { n: "account:slotname", best, t }

import FB_CONFIG from "./FbConfig";
import GameData from "./GameData";

const SDK_BASE = "https://www.gstatic.com/firebasejs/8.10.1/";
const SDK_FILES = ["firebase-app.js", "firebase-auth.js", "firebase-database.js"];

export const MAX_SLOTS = 8;

export interface SaveSlot {
    name: string;
    unlocked: number;
    best: number;
    t: number;
}

export default class Fb {
    private static state = "idle"; // idle | loading | ready | failed
    private static authUser: any = null;
    // uid of the first auth event after page load; null = none seen yet.
    // Any LATER change (login / logout / account switch) hard-reloads the
    // page so no progress leaks between accounts.
    private static baseUid: string = null;

    static slots: { [id: string]: SaveSlot } = {};
    static activeSlot = "";

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

    static activeSlotName(): string {
        const s = Fb.slots[Fb.activeSlot];
        return s ? s.name : "";
    }

    static slotIds(): string[] {
        const ids: string[] = [];
        for (const id in Fb.slots) ids.push(id);
        ids.sort((a, b) => (Fb.slots[a].t || 0) - (Fb.slots[b].t || 0));
        return ids;
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
                            // login / logout / account switch after page load:
                            // wipe guest-visible progress and restart clean.
                            // After the reload, the persisted session loads the
                            // new account's slots (most recently updated one).
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
                            Fb.loadSlots();
                        } else {
                            Fb.slots = {};
                            Fb.activeSlot = "";
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

    // ---------- save slots ----------

    private static newSlotId(): string {
        return "s" + Date.now();
    }

    private static applySlotToLocal(id: string) {
        const s = Fb.slots[id];
        if (!s) return;
        GameData.setUnlocked(s.unlocked || 1);
        GameData.setBestDist(s.best || 0);
    }

    private static captureLocal(into: SaveSlot) {
        into.unlocked = GameData.getUnlocked();
        into.best = GameData.getBestDist();
        into.t = Date.now(); // bump: "most recently updated" wins on login
    }

    // On login: fetch slots; migrate legacy flat saves; create the first slot
    // from local progress for brand-new accounts.
    private static loadSlots() {
        if (!Fb.ready() || !Fb.authUser) return;
        Fb.sdk().database().ref("saves/" + Fb.authUser.uid).once("value")
            .then((snap: any) => {
                const v = snap.val();
                Fb.slots = {};
                if (v && v.slots) {
                    let newest = "";
                    for (const id in v.slots) {
                        const s = v.slots[id];
                        Fb.slots[id] = {
                            name: s.name || "SAVE",
                            unlocked: s.unlocked || 1,
                            best: s.best || 0,
                            t: s.t || 0
                        };
                        if (!newest || Fb.slots[id].t > Fb.slots[newest].t) newest = id;
                    }
                    // on login, the most recently updated slot becomes active
                    Fb.activeSlot = newest || Fb.slotIds()[0];
                    Fb.applySlotToLocal(Fb.activeSlot);
                } else {
                    // legacy flat record or brand-new account: seed slot 1,
                    // keeping the better of cloud/local progress
                    const id = Fb.newSlotId();
                    const legacyUnlocked = (v && v.unlocked) || 1;
                    const legacyBest = (v && v.best) || 0;
                    Fb.slots[id] = {
                        name: "SAVE 1",
                        unlocked: Math.max(legacyUnlocked, GameData.getUnlocked()),
                        best: Math.max(legacyBest, GameData.getBestDist()),
                        t: Date.now()
                    };
                    Fb.activeSlot = id;
                    Fb.applySlotToLocal(id);
                }
                Fb.pushAll();
                Fb.emit();
            })
            .catch(() => { /* offline: keep local */ });
    }

    // Write everything (slots + active + leaderboard mirror) to the cloud.
    private static pushAll() {
        if (!Fb.ready() || !Fb.authUser || !Fb.activeSlot) return;
        const db = Fb.sdk().database();
        db.ref("saves/" + Fb.authUser.uid).set({
            slots: Fb.slots,
            active: Fb.activeSlot
        });
        const board: any = {};
        for (const id in Fb.slots) {
            const s = Fb.slots[id];
            board[id] = { n: Fb.userName() + ":" + s.name, best: s.best || 0, t: s.t || 0 };
        }
        db.ref("leaderboard/" + Fb.authUser.uid).set(board);
    }

    // Auto-save current progress into the active slot (called after level
    // clears and new endless bests).
    static syncUp() {
        if (!Fb.activeSlot || !Fb.slots[Fb.activeSlot]) return;
        Fb.captureLocal(Fb.slots[Fb.activeSlot]);
        Fb.pushAll();
    }

    // Create a new slot from the current progress. Returns an error string.
    static createSlot(name: string): string {
        if (!Fb.authUser) return "log in first";
        if (Fb.slotIds().length >= MAX_SLOTS) return "max " + MAX_SLOTS + " slots";
        const id = Fb.newSlotId();
        Fb.slots[id] = { name: name || ("SAVE " + (Fb.slotIds().length + 1)), unlocked: 1, best: 0, t: Date.now() };
        Fb.captureLocal(Fb.slots[id]);
        Fb.activeSlot = id;
        Fb.pushAll();
        return null;
    }

    // Overwrite an existing slot with the current progress and make it active.
    static overwriteSlot(id: string): string {
        if (!Fb.slots[id]) return "no such slot";
        Fb.captureLocal(Fb.slots[id]);
        Fb.activeSlot = id;
        Fb.pushAll();
        return null;
    }

    // Switch to a slot: its progress replaces the local progress.
    static loadSlot(id: string): string {
        if (!Fb.slots[id]) return "no such slot";
        Fb.activeSlot = id;
        Fb.slots[id].t = Date.now(); // it is now the most recently used
        Fb.applySlotToLocal(id);
        Fb.pushAll();
        return null;
    }

    static renameSlot(id: string, name: string): string {
        if (!Fb.slots[id]) return "no such slot";
        if (!name) return "enter a name";
        Fb.slots[id].name = name.substring(0, 16);
        Fb.pushAll();
        return null;
    }

    // ---------- live presence (online ghosts) ----------
    // Stored at leaderboard/{uid}/_live so it fits the existing security
    // rules (owner-writable, publicly readable). fetchTop skips it because
    // it has no .best field.

    private static liveHandle: { ref: any; handler: any } = null;
    private static liveDisconnectArmed = false;

    static uid(): string {
        return Fb.authUser ? Fb.authUser.uid : "";
    }

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

    // Flattens leaderboard/{uid}/{slotId} entries (and tolerates legacy flat
    // {name,best} records) into a sorted top-N list.
    static fetchTop(n: number, done: (rows: { name: string; best: number }[]) => void) {
        if (!Fb.ready()) return done(null);
        Fb.sdk().database().ref("leaderboard").once("value")
            .then((snap: any) => {
                const rows: { name: string; best: number }[] = [];
                snap.forEach((userChild: any) => {
                    const v = userChild.val();
                    if (!v) return;
                    if (typeof v.best === "number") {
                        // legacy flat record
                        rows.push({ name: v.name || "???", best: v.best });
                        return;
                    }
                    for (const slotId in v) {
                        const e = v[slotId];
                        if (e && typeof e.best === "number") {
                            rows.push({ name: e.n || "???", best: e.best });
                        }
                    }
                });
                rows.sort((a, b) => (b.best || 0) - (a.best || 0));
                done(rows.slice(0, n));
            })
            .catch(() => done(null));
    }
}
