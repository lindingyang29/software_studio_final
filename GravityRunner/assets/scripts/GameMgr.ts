import GameData from "./GameData";
import LevelBuilder, { LevelData, FragmentManifest } from "./LevelBuilder";
import EndlessGen from "./EndlessGen";
import Player from "./Player";
import CameraFollow from "./CameraFollow";
import Sfx from "./Sfx";
import Fx from "./Fx";
import Fb from "./Fb";

const { ccclass } = cc._decorator;

type GameState = "loading" | "ready" | "run" | "dead" | "win" | "gameover" | "paused";

// Owns the Game scene: loads assets + level JSON, builds the world through
// LevelBuilder, spawns 1-2 Players, and runs the ready/run/dead/win state machine.
// Everything (world, HUD) is created in code — the .fire scene stays minimal.
//
// Co-op rules (GameData.players === 2): P1 = W key, P2 = UP/SPACE.
// If one player dies while the partner survives, they revive next to the
// partner after 3s. Each death costs team health; at 0 health, the run fails.
@ccclass
export default class GameMgr extends cc.Component {

    // global slow-motion factor (slow power-up); Player multiplies dt by this
    timeScale = 1;

    private cameraNode: cc.Node = null;
    private world: cc.Node = null;
    private hud: cc.Node = null;
    private players: Player[] = [];
    private level: LevelData = null;
    private frames: { [k: string]: cc.SpriteFrame } = {};

    private state: GameState = "loading";
    private time = 0;
    private deaths = 0;
    private maxHealth = 3;
    private health = 3;
    private crystalsTaken = 0;
    private slowT = 0;
    private enemyT = 0;
    private rotCurrent = 0;
    private rotTarget = 0;

    // endless mode (GameData.currentLevel === -1)
    private endless = false;
    private gen: EndlessGen = null;
    private chunks: { node: cc.Node; endX: number; m: FragmentManifest }[] = [];
    private distPx = 0;
    private distLabel: cc.Label = null;

    // hit feel
    private shakeT = 0;
    private hitStopT = 0;
    private resultPanel: cc.Node = null;
    private bumpCd = 0;

    // synced room start (server-clock timestamp; 0 = not a room race)
    private roomT0 = 0;

    // online ghosts (gvx/gvy = local velocity estimate, col = remote opted in to collision)
    private ghosts: { [uid: string]: { node: cc.Node; tx: number; ty: number; tsy: number; gvx: number; gvy: number; col: boolean; lastT: number; rxT: number; score: number; combo: number; name: string } } = {};
    private liveAccum = 0;
    private liveOn = false;

    // Rhythm battle split-screen layout.  In VS AI / online rhythm modes, the
    // playable chart is moved to the lower half, while AI / remote opponents are
    // rendered on a separate visual-only copy in the upper half.
    private rhythmSplitBattle = false;
    private rhythmSplitPlayerOffset = -165;
    private rhythmSplitOpponentOffset = 165;
    private rhythmSplitYScale = 1;
    private rhythmSplitLine: cc.Node = null;
    private rhythmSplitTopLabel: cc.Label = null;
    private rhythmSplitBottomLabel: cc.Label = null;

    private nameLabel: cc.Label = null;
    private crystalLabel: cc.Label = null;
    private deathLabel: cc.Label = null;
    private timeLabel: cc.Label = null;
    private msgLabel: cc.Label = null;
    private subLabel: cc.Label = null;
    private slowOverlay: cc.Node = null;
    private pausePanel: cc.Node = null;

    // rhythm mode state (generated from .tja charts)
    private rhythmLabel: cc.Label = null;
    private judgeLabel: cc.Label = null;
    private rhythmIndex = 0;
    private rhythmScore = 0;
    private rhythmCombo = 0;
    private rhythmMaxCombo = 0;
    private rhythmPerfect = 0;
    private rhythmGood = 0;
    private rhythmBad = 0;
    private rhythmMiss = 0;

    // local rhythm battle AI.  It does not mutate player-note judgement;
    // it runs a parallel score track over the same chart.
    private rhythmAiLabel: cc.Label = null;
    private rhythmAiNode: cc.Node = null;
    private rhythmAiIndex = 0;
    private rhythmAiScore = 0;
    private rhythmAiCombo = 0;
    private rhythmAiMaxCombo = 0;
    private rhythmAiPerfect = 0;
    private rhythmAiGood = 0;
    private rhythmAiBad = 0;
    private rhythmAiMiss = 0;
    private rhythmAiRailDir = -1;
    private rhythmAiLaneIndex = 0;
    private rhythmAiRollIndex = 0;
    private rhythmAiRollNextTap = 0;
    private rhythmAiRollFlipSide = false;

    // Rhythm fight mode: deterministic attack notes + temporary interference.
    // Attack notes are the same on both tracks; when hit, they jam the opponent
    // with one of three effects: speed-up, red/blue swap, or view blocker.
    private rhythmAttackSeq = 0;
    private rhythmAttackType = "";
    private rhythmAttackAt = 0;
    private rhythmRemoteAttackSeq: { [uid: string]: number } = {};
    private rhythmFxSpeedT = 0;
    private rhythmFxSwapT = 0;
    private rhythmFxBlindT = 0;
    private rhythmOppFxSpeedT = 0;
    private rhythmOppFxSwapT = 0;
    private rhythmOppFxBlindT = 0;
    private rhythmEffectLabel: cc.Label = null;
    private rhythmOpponentEffectLabel: cc.Label = null;
    private rhythmBlindNode: cc.Node = null;
    private rhythmTopBlindNode: cc.Node = null;
    private rhythmBottomBlindNode: cc.Node = null;
    private rhythmTopRightBlindNode: cc.Node = null;
    private rhythmBottomRightBlindNode: cc.Node = null;
    private rhythmTopHudBar: cc.Node = null;
    private rhythmBottomHudBar: cc.Node = null;
    private rhythmTopFxNode: cc.Node = null;
    private rhythmBottomFxNode: cc.Node = null;
    private rhythmTopFastLines: cc.Node[] = [];
    private rhythmBottomFastLines: cc.Node[] = [];
    private rhythmOpponentEffectTarget = "OPPONENT";
    private rhythmAiInterfereT = 0;
    private rhythmAiInterfereType = "";

    isRunning(): boolean {
        return this.state === "run";
    }

    private isRhythmAiBattle(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled
            && (GameData.rhythmBattleMode === "ai" || GameData.rhythmBattleMode === "fight-ai"));
    }

    private isRhythmOnlineBattle(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled
            && (GameData.rhythmBattleMode === "online"
                || GameData.rhythmBattleMode === "fight-online"
                || !!GameData.roomCode));
    }

    private isRhythmFightBattle(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled
            && (GameData.rhythmBattleMode === "fight-ai" || GameData.rhythmBattleMode === "fight-online"));
    }

    private isRhythmFightOnlineBattle(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled
            && GameData.rhythmBattleMode === "fight-online");
    }

    onLoad() {
        Sfx.preload();
        Sfx.playBgm("bgm_game");
        Fb.init();
        this.cameraNode = this.node.getChildByName("Main Camera");

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);

        cc.resources.loadDir("textures", cc.SpriteFrame, (err, assets: cc.SpriteFrame[]) => {
            if (err) {
                cc.error("texture load failed", err);
                return;
            }
            for (const a of assets) this.frames[a.name] = a;
            this.onTexturesReady();
        });
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        Fb.liveOff();
        Fb.liveClear();
    }

    private onTexturesReady() {
        Fx.setFrame(this.frames["white"]);
        // background rides along as a child of the camera (auto screen-aligned,
        // even when the camera rotates in rotation zones)
        const bg = new cc.Node("BG");
        const bgSp = bg.addComponent(cc.Sprite);
        bgSp.spriteFrame = this.frames["bg"];
        bgSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        bg.setContentSize(1400, 1400); // oversized: stays covering while rotated
        const b = GameData.settings.brightness;
        const tint = LevelBuilder.scheme().bgTint;
        bg.color = cc.color(Math.round(tint.r * b), Math.round(tint.g * b), Math.round(tint.b * b));
        this.cameraNode.addChild(bg, -10);

        this.world = new cc.Node("World");
        this.node.addChild(this.world);

        this.buildHud();
        Fx.fadeIn(this.hud);

        this.endless = GameData.currentLevel === -1;
        if (this.endless) {
            this.startEndless();
            return;
        }
        if (GameData.currentLevel === 0) {
            // player-made level from the editor
            let data: any = null;
            try {
                const raw = cc.sys.localStorage.getItem(GameData.CUSTOM_KEY);
                data = raw ? JSON.parse(raw) : null;
            } catch (e) { data = null; }
            if (!data || !data.goal) {
                this.setMsg("NO CUSTOM LEVEL SAVED", "PRESS Q FOR MENU");
                return;
            }
            this.startLevel(data);
            return;
        }
        const levelPath = GameData.currentLevelPath || ("levels/level" + GameData.currentLevel);
        this.loadLevelJson(levelPath);
    }

    private normalizeResourcePath(path: string): string {
        let p = String(path || "").trim().replace(/\\/g, "/");
        p = p.replace(/^db:\/\/assets\/resources\//, "");
        p = p.replace(/^assets\/resources\//, "");
        p = p.replace(/^resources\//, "");
        p = p.replace(/^\/+/, "");
        p = p.replace(/\.json$/i, "");
        return p;
    }

    private cocosEscapedResourcePath(path: string): string {
        // Imported TJA songs with Japanese file names are stored on disk as
        // #Uxxxx chunks.  The catalog may still contain readable Unicode, and
        // Firebase rooms can persist either format.  Try both when loading.
        let out = "";
        for (let i = 0; i < path.length; i++) {
            const c = path.charCodeAt(i);
            out += c > 127 ? ("#U" + c.toString(16).padStart(4, "0")) : path.charAt(i);
        }
        return out;
    }

    private resourcePathCandidates(path: string): string[] {
        const norm = this.normalizeResourcePath(path);
        const esc = this.cocosEscapedResourcePath(norm);
        const arr = [norm, esc];
        const out: string[] = [];
        for (const p of arr) if (p && out.indexOf(p) < 0) out.push(p);
        return out;
    }

    private loadLevelJson(path: string) {
        const candidates = this.resourcePathCandidates(path);
        let lastErr: any = null;
        const tryLoad = (i: number) => {
            if (i >= candidates.length) {
                this.setMsg("LEVEL LOAD ERROR", candidates.join("  |  "));
                if (lastErr) cc.error(lastErr);
                return;
            }
            const p = candidates[i];
            cc.resources.load(p, cc.JsonAsset, (err, asset: cc.JsonAsset) => {
                if (err || !asset) {
                    lastErr = err;
                    cc.warn("level load failed: " + p, err);
                    tryLoad(i + 1);
                    return;
                }
                if (GameData.currentLevelPath) GameData.currentLevelPath = p;
                this.startLevel(asset.json);
            });
        };
        tryLoad(0);
    }

    private startLevel(data: any) {
        this.level = LevelBuilder.build(this.world, data, this.frames);
        this.prepareRhythmFightNotes();
        this.prepareRhythmBattleSplit();
        this.spawnPlayersAndCamera(this.level.length - 480);
        if (this.isRhythmAiBattle()) this.spawnRhythmAi();
        this.applyRotationForX(this.level.start.x, true);
        const titlePrefix = this.isRhythmLevel() ? "RHYTHM — "
            : (GameData.currentLevel === 0 ? "CUSTOM — " : "LEVEL " + GameData.currentLevel + " — ");
        const modeTags: string[] = [];
        if (this.isRhythmAiBattle()) modeTags.push("AI");
        if (this.isRhythmOnlineBattle()) modeTags.push("ONLINE");
        if (this.isRhythmFightBattle()) modeTags.push("FIGHT");
        if (GameData.players === 2 && !this.isRhythmLevel()) modeTags.push("2P");
        let hudTitle = titlePrefix + this.level.name + (modeTags.length ? (" [" + modeTags.join("/") + "]") : "");
        const hudLimit = this.shouldSplitRhythmBattle() ? 50 : 72;
        if (hudTitle.length > hudLimit) hudTitle = hudTitle.substr(0, hudLimit - 1) + "…";
        this.nameLabel.string = hudTitle;
        if (this.isRhythmLevel()) {
            Sfx.stopBgm();
            this.resetRhythmState(true);
        }
        this.refreshHud();
        this.state = "ready";
        this.setMsg(this.isRhythmLevel() ? "PRESS RHYTHM KEY TO START" : "PRESS SPACE TO RUN", this.controlsHint());
        this.startLive();
        this.armRoomStart();
        // resume a mid-run save state, if one was loaded from the pause menu
        if (GameData.pendingState) {
            const ps = GameData.pendingState;
            GameData.pendingState = null;
            if (!this.endless && !this.isRhythmLevel()) this.applyState(ps);
        }
    }

    // ---------- mid-run save states (6 slots, pause menu) ----------

    private statePanel: cc.Node = null;

    private stateSavable(): boolean {
        return !this.endless && !this.isRhythmLevel() && this.players.length > 0;
    }

    private captureState(): any {
        const p0 = this.players[0];
        const takenC: number[] = [];
        for (let i = 0; i < this.level.crystals.length; i++) {
            if (this.level.crystals[i].taken) takenC.push(i);
        }
        const takenP: number[] = [];
        for (let i = 0; i < this.level.powerups.length; i++) {
            if (this.level.powerups[i].taken) takenP.push(i);
        }
        const st: any = {
            lv: GameData.currentLevel,
            path: GameData.currentLevelPath || null,
            pl: GameData.players,
            x: Math.round(p0.node.x),
            y: Math.round(p0.node.y),
            g: p0.getGravityDir(),
            time: Math.round(this.time * 10) / 10,
            deaths: this.deaths,
            crystals: this.crystalsTaken,
            takenC: takenC,
            takenP: takenP,
            label: (GameData.currentLevel === 0 ? "CUSTOM" : "L" + GameData.currentLevel)
                + "  " + this.formatTime(this.time)
                + "  x" + Math.round(p0.node.x)
                + (GameData.players === 2 ? "  [2P]" : ""),
            t: Date.now()
        };
        if (GameData.players === 2 && this.players[1]) {
            const p1 = this.players[1];
            st.p2 = { x: Math.round(p1.node.x), y: Math.round(p1.node.y), g: p1.getGravityDir() };
        }
        return st;
    }

    private applyState(ps: any) {
        const norm = (v: any): any[] => !v ? [] : (Array.isArray(v) ? v : Object.keys(v).map((k) => v[k]));
        const p0 = this.players[0];
        p0.respawnAt(ps.x || 0, ps.y || 0, ps.g || -1);
        if (ps.p2 && this.players[1]) {
            this.players[1].respawnAt(ps.p2.x || 0, ps.p2.y || 0, ps.p2.g || -1);
        }
        this.time = ps.time || 0;
        this.deaths = ps.deaths || 0;
        this.crystalsTaken = ps.crystals || 0;
        for (const i of norm(ps.takenC)) {
            const c = this.level.crystals[i];
            if (c) { c.taken = true; c.node.active = false; }
        }
        for (const i of norm(ps.takenP)) {
            const pu = this.level.powerups[i];
            if (pu) { pu.taken = true; pu.node.active = false; }
        }
        this.applyRotationForX(ps.x || 0, true);
        const follow = this.cameraNode.getComponent(CameraFollow);
        if (follow) follow.snap();
        this.refreshHud();
        this.setMsg("PRESS SPACE TO RESUME", this.controlsHint());
    }

    private closeStatePanel() {
        if (this.statePanel) {
            this.statePanel.destroy();
            this.statePanel = null;
        }
    }

    // confirmIdx: slot whose SAVE is in the two-click "SURE?" stage
    private buildStatePanel(confirmIdx: number = -1) {
        this.closeStatePanel();
        const panel = new cc.Node("StatePanel");
        this.hud.addChild(panel, 30);
        this.statePanel = panel;

        const mkSprite = (parent: cc.Node, w: number, h: number, x: number, y: number, color: cc.Color, opacity: number) => {
            const n = new cc.Node("s");
            const sp = n.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            n.setContentSize(w, h);
            n.setPosition(x, y);
            n.color = color;
            n.opacity = opacity;
            parent.addChild(n);
            return n;
        };

        const box = mkSprite(panel, 640, 480, 0, 0, cc.color(10, 12, 26), 250);
        box.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        const title = this.makeLabel(panel, 0, 210, 26, cc.color(255, 181, 74));
        title.string = "SAVE / LOAD STATE";
        const sub = this.makeLabel(panel, 0, 180, 13, cc.color(110, 120, 150));
        sub.string = Fb.user() ? "stored in your account" : "stored on this device (log in to sync)";

        const states = Fb.getStates();
        for (let i = 0; i < Fb.MAX_STATES; i++) {
            const st = states[i];
            const y = 130 - i * 52;
            const row = mkSprite(panel, 600, 44, 0, y, cc.color(22, 30, 60), 255);
            let text = "#" + (i + 1) + "   ";
            if (st) {
                const d = new Date(st.t || 0);
                const pad = (v: number) => (v < 10 ? "0" + v : "" + v);
                text += st.label + "   " + (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
            } else {
                text += "EMPTY";
            }
            const lb = this.makeLabel(row, -288, 0, 15, st ? cc.color(235, 240, 255) : cc.color(110, 120, 150), 0);
            lb.string = text;

            const mkBtn2 = (txt: string, x: number, color: cc.Color, cb: () => void) => {
                const b = mkSprite(row, 84, 32, x, 0, color, 255);
                const blb = this.makeLabel(b, 0, 0, 13, cc.color(235, 240, 255));
                blb.string = txt;
                b.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
                    e.stopPropagation();
                    Sfx.play("click", 0.7);
                    cb();
                });
            };
            const idx = i;
            if (st && confirmIdx !== idx) {
                // occupied: first SAVE click asks for overwrite confirmation
                mkBtn2("SAVE", 160, cc.color(70, 55, 15), () => this.buildStatePanel(idx));
            } else if (st && confirmIdx === idx) {
                mkBtn2("SURE?", 160, cc.color(140, 40, 40), () => {
                    Fb.saveState(idx, this.captureState());
                    this.buildStatePanel();
                });
            } else {
                mkBtn2("SAVE", 160, cc.color(20, 70, 40), () => {
                    Fb.saveState(idx, this.captureState());
                    this.buildStatePanel();
                });
            }
            if (st) {
                mkBtn2("LOAD", 255, cc.color(24, 34, 76), () => {
                    GameData.players = st.pl || 1;
                    GameData.currentLevel = st.lv || 1;
                    GameData.currentLevelPath = st.path || "";
                    GameData.pendingState = st;
                    Fx.fadeTo("Game", this.hud);
                });
            }
        }

        const closeB = mkSprite(panel, 160, 38, 0, -208, cc.color(50, 50, 60), 255);
        const clb = this.makeLabel(closeB, 0, 0, 15, cc.color(235, 240, 255));
        clb.string = "CLOSE";
        closeB.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
            e.stopPropagation();
            Sfx.play("click", 0.7);
            this.closeStatePanel();
        });
    }

    // ---------- rhythm fight mode ----------

    private rhythmFightRand(i: number): number {
        const source = this.level && this.level.rhythm ? String(this.level.rhythm.source || this.level.name || "") : "";
        let seed = 2166136261;
        for (let k = 0; k < source.length; k++) seed = (seed ^ source.charCodeAt(k)) * 16777619;
        const x = Math.sin((i + 1) * 17.231 + (seed % 9973)) * 43758.5453;
        return x - Math.floor(x);
    }

    private normalizeRhythmAttackType(type: string): string {
        // Supported fight-mode jams.  FAST is deliberately NOT implemented by
        // changing the runner's real x-speed; rhythm charts are synchronized by
        // music time and fixed note positions, so real speed changes desync the
        // chart.  Instead FAST is a short visual / pressure jam plus an AI skill
        // penalty, which keeps judgement stable.
        if (type === "speed") return "speed";
        if (type === "swap") return "swap";
        return "blind";
    }

    private rhythmAttackColor(type: string): cc.Color {
        type = this.normalizeRhythmAttackType(type);
        if (type === "speed") return cc.color(255, 196, 70);
        if (type === "swap") return cc.color(190, 130, 255);
        return cc.color(255, 90, 140);
    }

    private rhythmAttackName(type: string): string {
        type = this.normalizeRhythmAttackType(type);
        if (type === "speed") return "RIGHT BLIND";
        if (type === "swap") return "R/B SWAP";
        return "BLIND";
    }

    private rhythmAttackDuration(type: string): number {
        type = this.normalizeRhythmAttackType(type);
        if (type === "speed") return 3.4;
        if (type === "swap") return 4.5;
        return 3.6;
    }

    private rhythmAttackPulseOpacity(type: string): number {
        type = this.normalizeRhythmAttackType(type);
        if (type === "speed") return 116;
        if (type === "swap") return 72;
        return 82;
    }

    private makeRhythmFastLines(parent: cc.Node): cc.Node[] {
        const out: cc.Node[] = [];
        if (!parent || !parent.isValid) return out;
        for (let i = 0; i < 10; i++) {
            const line = new cc.Node("fastLine");
            const sp = line.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            line.setContentSize(150 + (i % 3) * 55, 4 + (i % 2) * 2);
            line.color = cc.color(255, 226, 90);
            line.opacity = 0;
            line.angle = (i % 2 === 0 ? -4 : 4);
            line.active = false;
            parent.addChild(line, 4);
            out.push(line);
        }
        return out;
    }

    private updateRhythmFastLines(lines: cc.Node[], active: boolean, offsetSeed: number) {
        const now = Date.now();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.isValid) continue;
            line.active = active;
            if (!active) {
                line.opacity = 0;
                continue;
            }
            // Move bright streaks right-to-left inside the affected half. This
            // gives FAST a clear speed-up feeling without changing real note or
            // player positions, so rhythm judgement stays synchronized.
            const phase = (now * 0.95 + offsetSeed + i * 137) % 1420;
            line.x = 710 - phase;
            line.y = -28 + (i % 5) * 14;
            line.scaleX = 0.75 + ((now / 90 + i) % 3) * 0.12;
            line.opacity = 125 + Math.floor((Math.sin(now / 70 + i) + 1) * 45);
        }
    }

    private decorateRhythmAttackNode(n: cc.Node, type: string, small: boolean = false) {
        if (!n || !n.isValid || n.getChildByName("attackAura")) return;
        const col = this.rhythmAttackColor(type);
        const aura = new cc.Node("attackAura");
        const sp = aura.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["white"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        const sz = small ? 34 : 46;
        aura.setContentSize(sz, sz);
        aura.color = col;
        aura.opacity = small ? 115 : 160;
        aura.angle = 45;
        n.addChild(aura, -1);
        cc.tween(aura)
            .to(0.45, { scale: 1.22, opacity: small ? 70 : 90 })
            .to(0.45, { scale: 1.0, opacity: small ? 115 : 160 })
            .repeatForever()
            .start();
        const mark = new cc.Node("attackMark");
        mark.color = cc.color(255, 255, 255);
        const lb = mark.addComponent(cc.Label);
        type = this.normalizeRhythmAttackType(type);
        lb.string = type === "speed" ? ">>" : (type === "swap" ? "↔" : "!");
        lb.fontSize = small ? 12 : 15;
        lb.lineHeight = small ? 14 : 17;
        n.addChild(mark, 3);
    }

    private prepareRhythmFightNotes() {
        if (!this.isRhythmFightBattle() || !this.level || !this.level.rhythm) return;
        const r = this.level.rhythm;
        const types = ["speed", "swap", "blind"];
        let lastT = -99;
        let picked = 0;
        for (let i = 0; i < r.notes.length; i++) {
            const n: any = r.notes[i];
            if (!n || n.kind === "roll") continue;
            const t = this.rhythmNoteTime(n);
            if (t < 4.0 || t - lastT < 5.5) continue;
            // Deterministic but not completely periodic: about one attack every
            // 12-18 notes, with a minimum time gap so dense charts stay readable.
            const randomPick = this.rhythmFightRand(i) < 0.075;
            const periodicPick = (i % 16) === 7;
            if (!randomPick && !periodicPick) continue;
            n.attack = true;
            n.attackType = types[picked % types.length];
            picked++;
            lastT = t;
            if (n.node && n.node.isValid) this.decorateRhythmAttackNode(n.node, n.attackType, false);
        }
    }

    rhythmSpeedMultiplier(): number {
        // Kept for compatibility with older Player.ts builds.  Runtime fight
        // effects must not change the runner's real x-speed because note timing
        // is tied to music time and fixed world positions.
        return 1;
    }

    private normalizeRhythmAction(action: string): string {
        if (this.rhythmFxSwapT > 0 && this.isJumpFlipRhythm()) {
            if (action === "jump") return "flip";
            if (action === "flip") return "jump";
        }
        return action;
    }

    private triggerRhythmAttack(attacker: string, note: any) {
        if (!this.isRhythmFightBattle() || !note || !note.attack) return;
        const type = this.normalizeRhythmAttackType(note.attackType || "blind");
        const x = Number.isFinite(Number(note.x)) ? Number(note.x) : 0;
        const y = attacker === "ai" ? this.rhythmOpponentNoteY(note) : (Number(note.y) || 0);
        Fx.popup(this.world, x, y + 42, "ATTACK " + this.rhythmAttackName(type), this.rhythmAttackColor(type));
        Sfx.play("power", 0.95);

        if (attacker === "ai") {
            this.applyRhythmInterference(type, "AI");
        } else if (this.isRhythmFightOnlineBattle()) {
            this.rhythmAttackSeq++;
            this.rhythmAttackType = type;
            this.rhythmAttackAt = Fb.serverNow();
            this.applyOpponentRhythmInterference(type, "OPPONENT");
            this.pushLiveNow();
        } else if (this.isRhythmAiBattle()) {
            this.rhythmAiInterfereT = Math.max(this.rhythmAiInterfereT, this.rhythmAttackDuration(type));
            this.rhythmAiInterfereType = type;
            this.applyOpponentRhythmInterference(type, "AI");
            if (this.rhythmAiNode && this.rhythmAiNode.isValid) {
                Fx.popup(this.world, this.rhythmAiNode.x, this.rhythmAiNode.y + 42, "JAMMED", this.rhythmAttackColor(type));
            }
        }
        this.updateRhythmEffectHud();
        this.updateRhythmOpponentEffectHud();
    }

    private applyRhythmInterference(type: string, from: string) {
        if (!this.isRhythmLevel()) return;
        const dur = this.rhythmAttackDuration(type);
        if (type === "speed") this.rhythmFxSpeedT = Math.max(this.rhythmFxSpeedT, dur);
        else if (type === "swap") this.rhythmFxSwapT = Math.max(this.rhythmFxSwapT, dur);
        else this.rhythmFxBlindT = Math.max(this.rhythmFxBlindT, dur);
        const p = this.players && this.players.length ? this.players[0] : null;
        const x = p && p.node ? p.node.x : this.cameraNode.x;
        const y = p && p.node ? p.node.y : -160;
        Fx.popup(this.world, x, y + 55, from + " JAM: " + this.rhythmAttackName(type), this.rhythmAttackColor(type));
        Sfx.play("teleport", 0.75);
        this.updateRhythmEffectHud();
    }

    private applyOpponentRhythmInterference(type: string, target: string) {
        if (!this.isRhythmLevel()) return;
        const dur = this.rhythmAttackDuration(type);
        this.rhythmOpponentEffectTarget = target || (this.isRhythmAiBattle() ? "AI" : "OPPONENT");
        if (type === "speed") this.rhythmOppFxSpeedT = Math.max(this.rhythmOppFxSpeedT, dur);
        else if (type === "swap") this.rhythmOppFxSwapT = Math.max(this.rhythmOppFxSwapT, dur);
        else this.rhythmOppFxBlindT = Math.max(this.rhythmOppFxBlindT, dur);
        this.updateRhythmOpponentEffectHud();
    }

    private rhythmTopActiveEffect(): string {
        if (this.rhythmOppFxBlindT > 0) return "blind";
        if (this.rhythmOppFxSwapT > 0) return "swap";
        if (this.rhythmOppFxSpeedT > 0) return "speed";
        return "";
    }

    private rhythmBottomActiveEffect(): string {
        if (this.rhythmFxBlindT > 0) return "blind";
        if (this.rhythmFxSwapT > 0) return "swap";
        if (this.rhythmFxSpeedT > 0) return "speed";
        return "";
    }

    private updateRhythmFightEffects(dt: number) {
        if (this.rhythmFxSpeedT > 0) this.rhythmFxSpeedT = Math.max(0, this.rhythmFxSpeedT - dt);
        if (this.rhythmFxSwapT > 0) this.rhythmFxSwapT = Math.max(0, this.rhythmFxSwapT - dt);
        if (this.rhythmFxBlindT > 0) this.rhythmFxBlindT = Math.max(0, this.rhythmFxBlindT - dt);
        if (this.rhythmOppFxSpeedT > 0) this.rhythmOppFxSpeedT = Math.max(0, this.rhythmOppFxSpeedT - dt);
        if (this.rhythmOppFxSwapT > 0) this.rhythmOppFxSwapT = Math.max(0, this.rhythmOppFxSwapT - dt);
        if (this.rhythmOppFxBlindT > 0) this.rhythmOppFxBlindT = Math.max(0, this.rhythmOppFxBlindT - dt);
        if (this.rhythmAiInterfereT > 0) this.rhythmAiInterfereT = Math.max(0, this.rhythmAiInterfereT - dt);

        // Red BLIND: keep the original cloud/blocker shape, but make every
        // blocker fully black and opaque.  Do NOT cover the whole half-screen;
        // yellow RIGHT BLIND is the half-screen blocker.
        const inFightRhythm = this.isRhythmFightBattle() && this.isRhythmLevel();
        const showTopBlind = inFightRhythm && this.rhythmOppFxBlindT > 0;
        const showBottomBlind = inFightRhythm && this.rhythmFxBlindT > 0;
        const showTopRightBlind = inFightRhythm && this.rhythmOppFxSpeedT > 0;
        const showBottomRightBlind = inFightRhythm && this.rhythmFxSpeedT > 0;
        if (this.rhythmTopBlindNode) this.rhythmTopBlindNode.active = showTopBlind;
        if (this.rhythmBottomBlindNode) this.rhythmBottomBlindNode.active = showBottomBlind;
        if (this.rhythmTopRightBlindNode) this.rhythmTopRightBlindNode.active = showTopRightBlind;
        if (this.rhythmBottomRightBlindNode) this.rhythmBottomRightBlindNode.active = showBottomRightBlind;
        // Backward-compatible alias used by older reset/clear code.
        if (this.rhythmBlindNode && this.rhythmBlindNode !== this.rhythmBottomBlindNode) {
            this.rhythmBlindNode.active = showBottomBlind;
            this.rhythmBlindNode.opacity = showBottomBlind ? 255 : 0;
        }

        const topType = this.rhythmTopActiveEffect();
        const botType = this.rhythmBottomActiveEffect();
        if (this.rhythmTopFxNode) {
            this.rhythmTopFxNode.active = this.isRhythmFightBattle() && !!topType;
            if (this.rhythmTopFxNode.active) {
                this.rhythmTopFxNode.color = this.rhythmAttackColor(topType);
                const pulse = topType === "speed" ? Math.floor((Math.sin(Date.now() / 70) + 1) * 24)
                    : Math.floor((Math.sin(Date.now() / 140) + 1) * 12);
                this.rhythmTopFxNode.opacity = this.rhythmAttackPulseOpacity(topType) + pulse;
            }
        }
        if (this.rhythmBottomFxNode) {
            this.rhythmBottomFxNode.active = this.isRhythmFightBattle() && !!botType;
            if (this.rhythmBottomFxNode.active) {
                this.rhythmBottomFxNode.color = this.rhythmAttackColor(botType);
                const pulse = botType === "speed" ? Math.floor((Math.sin(Date.now() / 70) + 1) * 24)
                    : Math.floor((Math.sin(Date.now() / 140) + 1) * 12);
                this.rhythmBottomFxNode.opacity = this.rhythmAttackPulseOpacity(botType) + pulse;
            }
        }
        // Yellow attack is RIGHT BLIND now: the actual obstruction is the
        // solid right-half blocker above, not the old speed-line overlay.
        this.updateRhythmFastLines(this.rhythmTopFastLines, false, 0);
        this.updateRhythmFastLines(this.rhythmBottomFastLines, false, 710);
        this.updateRhythmEffectHud();
        this.updateRhythmOpponentEffectHud();
    }

    private updateRhythmEffectHud() {
        if (!this.rhythmEffectLabel) return;
        if (!this.isRhythmLevel()) {
            this.rhythmEffectLabel.string = "";
            if (this.rhythmBlindNode) this.rhythmBlindNode.active = false;
            if (this.rhythmTopBlindNode) this.rhythmTopBlindNode.active = false;
            if (this.rhythmBottomBlindNode) this.rhythmBottomBlindNode.active = false;
            if (this.rhythmTopRightBlindNode) this.rhythmTopRightBlindNode.active = false;
            if (this.rhythmBottomRightBlindNode) this.rhythmBottomRightBlindNode.active = false;
            return;
        }
        const parts: string[] = [];
        if (this.rhythmFxSpeedT > 0) parts.push("RIGHT BLIND " + this.rhythmFxSpeedT.toFixed(1));
        if (this.rhythmFxSwapT > 0) parts.push("R/B SWAP " + this.rhythmFxSwapT.toFixed(1));
        if (this.rhythmFxBlindT > 0) parts.push("BLIND " + this.rhythmFxBlindT.toFixed(1));
        if (parts.length) {
            this.rhythmEffectLabel.node.color = cc.color(255, 122, 200);
            this.rhythmEffectLabel.string = "YOU JAMMED: " + parts.join("   ");
        } else if (this.isRhythmFightBattle()) {
            this.rhythmEffectLabel.node.color = cc.color(255, 181, 74);
            this.rhythmEffectLabel.string = "⚡ ATTACK NOTES: hit them to jam the opponent";
        } else {
            this.rhythmEffectLabel.string = "";
        }
    }

    private updateRhythmOpponentEffectHud() {
        if (!this.rhythmOpponentEffectLabel) return;
        if (!this.isRhythmLevel()) {
            this.rhythmOpponentEffectLabel.string = "";
            return;
        }
        const parts: string[] = [];
        if (this.rhythmOppFxSpeedT > 0) parts.push("RIGHT BLIND " + this.rhythmOppFxSpeedT.toFixed(1));
        if (this.rhythmOppFxSwapT > 0) parts.push("R/B SWAP " + this.rhythmOppFxSwapT.toFixed(1));
        if (this.rhythmOppFxBlindT > 0) parts.push("BLIND " + this.rhythmOppFxBlindT.toFixed(1));
        if (parts.length) {
            this.rhythmOpponentEffectLabel.node.color = cc.color(127, 247, 255);
            this.rhythmOpponentEffectLabel.string = this.rhythmOpponentEffectTarget + " JAMMED: " + parts.join("   ");
        } else if (this.isRhythmFightBattle()) {
            this.rhythmOpponentEffectLabel.node.color = cc.color(160, 190, 240);
            this.rhythmOpponentEffectLabel.string = this.isRhythmAiBattle()
                ? "AI can hit attack notes too"
                : "Opponent can hit attack notes too";
        } else {
            this.rhythmOpponentEffectLabel.string = "";
        }
    }

    // ---------- rhythm battle split-screen layout ----------

    private shouldSplitRhythmBattle(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled
            && (GameData.rhythmBattleMode === "ai"
                || GameData.rhythmBattleMode === "fight-ai"
                || GameData.rhythmBattleMode === "online"
                || GameData.rhythmBattleMode === "fight-online"
                || !!GameData.roomCode));
    }

    private prepareRhythmBattleSplit() {
        this.rhythmSplitBattle = false;
        this.rhythmSplitYScale = 1;
        if (!this.shouldSplitRhythmBattle()) return;

        const r = this.level.rhythm;
        const floorY0 = Number(r.floorY) || -140;
        const ceilingY0 = Number(r.ceilingY) || 140;
        const gap = Math.max(1, Math.abs(ceilingY0 - floorY0));
        // For VS modes, squeeze both tracks closer to the center so HUD text
        // and edge decorations do not cover important notes near the top/bottom.
        // This keeps a clearer neutral area around the middle divider.
        this.rhythmSplitYScale = Math.min(0.82, 220 / gap);
        this.rhythmSplitPlayerOffset = -130;
        this.rhythmSplitOpponentOffset = 130;
        this.rhythmSplitBattle = true;

        const fy = (y: number) => this.rhythmSplitYFromOriginal(Number(y) || 0, "player");
        for (const child of this.world.children) child.y = fy(child.y);

        this.level.start.y = fy(this.level.start.y);
        this.level.goal.y = fy(this.level.goal.y || 0);
        this.level.goal.h = Math.max(this.level.goal.h || 0, 620);
        for (const a of [this.level.solids, this.level.spikes]) {
            for (const rect of a) rect.y = fy(rect.y);
        }
        for (const c of this.level.crystals) { c.y = fy(c.y); if (c.node && c.node.isValid) c.node.y = c.y; }
        for (const p of this.level.powerups) { p.y = fy(p.y); if (p.node && p.node.isValid) p.node.y = p.y; }
        for (const t of this.level.teleports) { t.y = fy(t.y); t.ty = fy(t.ty); }
        for (const e of this.level.enemies) {
            e.y0 = fy(e.y0);
            if (e.node && e.node.isValid) e.node.y = e.y0;
        }
        for (const m of this.level.movers) {
            m.rect.y = fy(m.rect.y);
            m.baseY = fy(m.baseY);
            for (let i = 0; i < m.baseYs.length; i++) m.baseYs[i] = fy(m.baseYs[i]);
            for (let i = 0; i < m.nodes.length; i++) if (m.nodes[i] && m.nodes[i].isValid) m.nodes[i].y = m.baseYs[i];
        }

        r.floorY = fy(r.floorY || -140);
        r.ceilingY = fy(r.ceilingY || 140);
        if (r.laneYs && r.laneYs.length) r.laneYs = r.laneYs.map((y) => fy(y));
        for (const n of r.notes) {
            n.y = fy(n.y);
            if (Number.isFinite(Number(n.voidY))) n.voidY = fy(n.voidY);

            // Split-screen compresses the vertical chart space.  Red jump notes
            // that were only ~50px away from the rail could then overlap the
            // standing player hitbox, so players could score them without
            // jumping.  Keep blue flip notes on the rail, but push red jump
            // notes far enough from their rail to require an actual light jump.
            if (r.style === "jump-flip" && (n.action || "") === "jump" && r.laneYs && r.laneYs.length >= 2) {
                const laneIdx = Math.max(0, Math.min(r.laneYs.length - 1, Number(n.trackLane) || 0));
                const baseY = r.laneYs[laneIdx];
                const lane = (n.lane === "ceiling" || laneIdx === 1) ? "ceiling" : "floor";
                const dir = lane === "ceiling" ? -1 : 1;
                const minJumpOffset = Math.max(70, Math.min(92, (Number(r.jumpHeight) || 66) + 8));
                const curOffset = Math.abs(Number(n.y) - baseY);
                if (curOffset < minJumpOffset) n.y = Math.round(baseY + dir * minJumpOffset);
            }

            if (n.node && n.node.isValid) n.node.y = n.y;
        }

        this.buildOpponentRhythmTrack();
    }

    private rhythmSplitYFromOriginal(y: number, side: string): number {
        const off = side === "opponent" ? this.rhythmSplitOpponentOffset : this.rhythmSplitPlayerOffset;
        return y * this.rhythmSplitYScale + off;
    }

    private rhythmOpponentYFromPlayerY(y: number): number {
        if (!this.rhythmSplitBattle) return y;
        // y already includes the lower-track transform.  Move it by exactly the
        // vertical distance between the two track centers.
        return y - this.rhythmSplitPlayerOffset + this.rhythmSplitOpponentOffset;
    }

    private makeWorldRect(name: string, x: number, y: number, w: number, h: number, color: cc.Color, opacity: number, z: number): cc.Node {
        const n = new cc.Node(name);
        const sp = n.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["white"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(w, h);
        n.setPosition(x, y);
        n.color = color;
        n.opacity = opacity;
        this.world.addChild(n, z);
        return n;
    }

    private buildOpponentRhythmTrack() {
        if (!this.rhythmSplitBattle || !this.level || !this.level.rhythm) return;
        const r = this.level.rhythm;
        const sx = this.level.start.x;
        const lx = Math.max(1600, this.level.length || 10000);
        const baseX = sx + lx / 2 - 250;
        const palGuide = cc.color(110, 125, 165);
        const cyan = cc.color(90, 185, 255);
        const red = cc.color(255, 82, 78);
        const railColor = cc.color(28, 36, 72);

        const laneYs = r.laneYs && r.laneYs.length ? r.laneYs : [r.floorY + 18, r.ceilingY - 18];
        for (let i = 0; i < laneYs.length; i++) {
            const y = this.rhythmOpponentYFromPlayerY(laneYs[i]);
            const guide = this.makeWorldRect("opponentGuide", baseX, y, lx + 900, r.style === "jump-flip" ? 4 : 3,
                i === r.startLane ? cc.color(235, 240, 255) : palGuide, i === r.startLane ? 70 : 42, 0);
            guide.opacity = r.style === "jump-flip" ? 60 : guide.opacity;
        }

        if (r.style === "jump-flip") {
            const floorY = this.rhythmOpponentYFromPlayerY(r.floorY || -140);
            const ceilY = this.rhythmOpponentYFromPlayerY(r.ceilingY || 140);
            const h = 58;
            this.makeWorldRect("opponentFloor", baseX, floorY - h / 2, lx + 900, h, railColor, 125, 1);
            this.makeWorldRect("opponentCeiling", baseX, ceilY + h / 2, lx + 900, h, railColor, 125, 1);

            const rolls: any[] = (r as any).rolls || [];
            const centerY = (this.rhythmOpponentYFromPlayerY(laneYs[0]) + this.rhythmOpponentYFromPlayerY(laneYs[laneYs.length - 1])) / 2;
            const rollH = Math.max(26, Math.abs(this.rhythmOpponentYFromPlayerY(laneYs[laneYs.length - 1]) - this.rhythmOpponentYFromPlayerY(laneYs[0])) + 28);
            for (const rr of rolls) {
                const x1 = Number.isFinite(Number(rr.x1)) ? Number(rr.x1) : sx + Number(rr.start || 0) * (this.level.speed || 300);
                const x2 = Number.isFinite(Number(rr.x2)) ? Number(rr.x2) : sx + Number(rr.end || 0) * (this.level.speed || 300);
                const w = Math.max(12, Math.abs(x2 - x1));
                const cx = (x1 + x2) / 2;
                const band = this.makeWorldRect("opponentRollBand", cx, centerY, w, rollH, cc.color(255, 210, 95), 30, 2);
                const top = this.makeWorldRect("opponentRollTop", cx, this.rhythmOpponentYFromPlayerY(laneYs[laneYs.length - 1]), w, 5, cc.color(255, 240, 130), 92, 3);
                const bot = this.makeWorldRect("opponentRollBottom", cx, this.rhythmOpponentYFromPlayerY(laneYs[0]), w, 5, cc.color(255, 240, 130), 92, 3);
                (rr as any).opponentNode = band;
                (rr as any).opponentTopNode = top;
                (rr as any).opponentBottomNode = bot;
            }
        }

        const goalY = this.rhythmOpponentYFromPlayerY(this.level.goal.y || 0);
        this.makeWorldRect("opponentGoalBeam", this.level.goal.x, goalY, 24, 300, LevelBuilder.scheme().goal, 92, 2);
        const portal = new cc.Node("opponentPortal");
        const ps = portal.addComponent(cc.Sprite);
        ps.spriteFrame = this.frames["portal"];
        ps.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        portal.setContentSize(72, 120);
        portal.setPosition(this.level.goal.x, goalY);
        portal.opacity = 170;
        this.world.addChild(portal, 3);
        cc.tween(portal).to(0.8, { scale: 1.10 }).to(0.8, { scale: 1.0 }).repeatForever().start();

        for (const note of r.notes) {
            const color = note.attack ? this.rhythmAttackColor((note as any).attackType || "blind")
                : ((note.color === "blue" || note.action === "flip") ? cyan : red);
            const size = note.kind === "roll" ? 20 : (note.gogo ? 34 : 30);
            if (note.action === "flip" && Number.isFinite(Number(note.voidY))) {
                const hole = this.makeWorldRect("opponentHole", note.x, this.rhythmOpponentYFromPlayerY(Number(note.voidY)), 54, 18, cc.color(15, 15, 26), 80, 3);
                hole.opacity = 75;
            }
            const n = this.makeWorldRect("opponentNote", note.x, this.rhythmOpponentYFromPlayerY(note.y),
                note.action === "flip" ? size + 6 : size, note.action === "flip" ? size + 6 : size,
                color, 128, 4);
            n.angle = note.action === "flip" || r.style === "gravity-collect" ? 45 : 0;
            if ((note as any).attack) this.decorateRhythmAttackNode(n, (note as any).attackType || "blind", true);
            const center = new cc.Node("noteCenter");
            const cs = center.addComponent(cc.Sprite);
            cs.spriteFrame = this.frames["white"];
            cs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            center.setContentSize(note.action === "flip" ? 10 : 12, note.action === "flip" ? 10 : 12);
            center.color = cc.color(255, 255, 255);
            center.opacity = 120;
            n.addChild(center, 1);
            (note as any).opponentNode = n;
        }
    }

    private applyRhythmHudLayout() {
        const split = this.rhythmSplitBattle && this.isRhythmLevel();
        if (this.rhythmLabel) this.rhythmLabel.node.setPosition(0, split ? -262 : 256);
        if (this.rhythmAiLabel) this.rhythmAiLabel.node.setPosition(0, split ? 258 : 230);
        if (this.rhythmEffectLabel) this.rhythmEffectLabel.node.setPosition(0, split ? -232 : 216);
        if (this.rhythmOpponentEffectLabel) this.rhythmOpponentEffectLabel.node.setPosition(0, split ? 228 : 198);
        if (this.judgeLabel) this.judgeLabel.node.y = split ? -86 : 86;
        if (this.nameLabel) this.nameLabel.node.setPosition(-620, 286);
        if (this.crystalLabel) this.crystalLabel.node.setPosition(-40, 286);
        if (this.deathLabel) this.deathLabel.node.setPosition(330, 286);
        if (this.timeLabel) this.timeLabel.node.setPosition(620, 286);
        if (this.distLabel) this.distLabel.node.setPosition(0, 286);
    }

    private refreshRhythmSplitHud() {
        this.applyRhythmHudLayout();
        if (!this.rhythmSplitLine) return;
        const active = this.rhythmSplitBattle && this.isRhythmLevel();
        this.rhythmSplitLine.active = active;
        if (this.rhythmSplitTopLabel) {
            this.rhythmSplitTopLabel.node.active = active;
            this.rhythmSplitTopLabel.string = this.isRhythmAiBattle() ? "AI" : "OPPONENT";
        }
        if (this.rhythmSplitBottomLabel) {
            this.rhythmSplitBottomLabel.node.active = active;
            this.rhythmSplitBottomLabel.string = "YOU";
        }
        if (this.rhythmTopHudBar) this.rhythmTopHudBar.active = active;
        if (this.rhythmBottomHudBar) this.rhythmBottomHudBar.active = active;
        if (this.rhythmTopFxNode) this.rhythmTopFxNode.active = active && !!this.rhythmTopActiveEffect();
        if (this.rhythmBottomFxNode) this.rhythmBottomFxNode.active = active && !!this.rhythmBottomActiveEffect();
        if (this.rhythmOpponentEffectLabel) this.rhythmOpponentEffectLabel.node.active = active && this.isRhythmFightBattle();
    }

    // ---------- online ghosts ----------

    private startLive() {
        if (!Fb.enabled() || this.liveOn) return;
        if (!Fb.ready()) {
            this.scheduleOnce(() => this.startLive(), 0.4);
            return;
        }
        Fb.liveListen((entries) => this.onLiveEntries(entries));
        this.liveOn = true;
    }

    // Ghosts only meet inside the same content: path-loaded (rhythm) levels
    // key by their resource path, others by the level number.
    private liveLevelKey(): any {
        return GameData.currentLevelPath ? "p:" + GameData.currentLevelPath : GameData.currentLevel;
    }

    private onLiveEntries(entries: { uid: string; d: any }[]) {
        if (!this.world || !this.world.isValid) return;
        const now = Date.now();
        const seen: { [uid: string]: boolean } = {};
        for (const e of entries) {
            if (e.uid === Fb.uid()) continue;
            const d = e.d;
            if (GameData.roomCode) {
                // room race: only roommates are visible
                if (d.room !== GameData.roomCode) continue;
            } else {
                if (d.room) continue;                         // private racers hidden
                if (d.lv !== this.liveLevelKey()) continue;   // other mode/level
            }
            if (!d.t || now - d.t > 7000) continue;       // stale
            seen[e.uid] = true;
            let g = this.ghosts[e.uid];
            if (!g) {
                const n = new cc.Node("ghost");
                const sp = n.addComponent(cc.Sprite);
                // show the remote player's chosen skin
                sp.spriteFrame = this.frames[GameData.skinOf(d.sk || 0).frame]
                    || this.frames["player2"] || this.frames["player"];
                sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
                n.setContentSize(36, 36);
                n.opacity = 205;
                n.color = cc.Color.WHITE;
                n.zIndex = 4;
                n.setPosition(d.x, this.rhythmSplitBattle && this.isRhythmLevel() ? this.rhythmOpponentYFromPlayerY(Number(d.y) || 0) : d.y);
                const ln = new cc.Node("name");
                ln.setPosition(0, 34);
                ln.color = cc.color(255, 181, 74);
                const lb = ln.addComponent(cc.Label);
                lb.string = d.n || "ghost";
                lb.fontSize = 12;
                lb.lineHeight = 14;
                n.addChild(ln);
                this.world.addChild(n);
                g = this.ghosts[e.uid] = { node: n, tx: d.x, ty: this.rhythmSplitBattle && this.isRhythmLevel() ? this.rhythmOpponentYFromPlayerY(Number(d.y) || 0) : d.y, tsy: 1, gvx: 0, gvy: 0, col: false, lastT: d.t || 0, rxT: now, score: d.score || 0, combo: d.combo || 0, name: d.n || "ghost" };
            }
            // velocity estimate from consecutive network samples
            const dtNet = (now - g.rxT) / 1000;
            if (dtNet > 0.03 && dtNet < 2) {
                const mappedY = this.rhythmSplitBattle && this.isRhythmLevel() ? this.rhythmOpponentYFromPlayerY(Number(d.y) || 0) : d.y;
                g.gvx = (d.x - g.tx) / dtNet;
                g.gvy = (mappedY - g.ty) / dtNet;
            }
            g.lastT = d.t || 0;
            g.rxT = now;
            g.tx = d.x;
            g.ty = this.rhythmSplitBattle && this.isRhythmLevel() ? this.rhythmOpponentYFromPlayerY(Number(d.y) || 0) : d.y;
            g.tsy = d.sy || 1;
            g.col = !!d.col;
            g.score = d.score || 0;
            g.combo = d.combo || 0;
            g.name = d.n || "ghost";
            if (this.isRhythmFightOnlineBattle()) {
                const atkSeq = Number(d.atkSeq) || 0;
                const atkAt = Number(d.atkAt) || 0;
                // Attack events are sent as edge-triggered seq numbers.
                // Use server-synced time and a generous window, otherwise two
                // clients with slightly different clocks can silently drop jams.
                if (atkSeq > 0
                    && this.rhythmRemoteAttackSeq[e.uid] !== atkSeq
                    && (!atkAt || atkAt > Fb.serverNow() - 7000)) {
                    this.rhythmRemoteAttackSeq[e.uid] = atkSeq;
                    this.applyRhythmInterference(this.normalizeRhythmAttackType(String(d.atkType || "blind")), d.n || "opponent");
                }
            }
            const nameNode = g.node.getChildByName("name");
            if (nameNode) {
                const lb = nameNode.getComponent(cc.Label);
                if (lb) lb.string = (d.n || "ghost") + (this.isRhythmLevel() ? ("  SCORE " + (d.score || 0)) : "");
            }
        }
        for (const uid in this.ghosts) {
            if (!seen[uid]) {
                this.ghosts[uid].node.destroy();
                delete this.ghosts[uid];
                delete this.rhythmRemoteAttackSeq[uid];
            }
        }
        this.updateRhythmAiHud();
    }

    private controlsHint(): string {
        if (this.isJumpFlipRhythm()) {
            return "RED = " + this.rhythmKeyText("jump") + " LIGHT JUMP    BLUE = " + this.rhythmKeyText("flip") + " FLIP    TOUCH NOTES TO SCORE"
                + (this.isRhythmFightBattle() ? "    ⚡ = ATTACK" : "") + "    R = RESTART";
        }
        if (this.isRhythmLevel()) {
            return "RED/BLUE NOTES = FLIP TIMING    HIT NOTES TO STEP LANES    MISS = NO DEATH    R = RESTART";
        }
        return GameData.players === 2
            ? "P1: W flip / D dash / A brake / S slam      P2: ARROWS (UP flip, RIGHT dash, LEFT brake, DOWN slam)"
            : "SPACE/W/UP = FLIP    D = DASH    A = BRAKE    S = SLAM    R = RESTART    ESC = PAUSE";
    }

    private spawnPlayersAndCamera(maxX: number) {
        const count = GameData.players === 2 ? 2 : 1;
        this.players = [];
        for (let i = 0; i < count; i++) {
            const pNode = new cc.Node("Player" + (i + 1));
            const sp = pNode.addComponent(cc.Sprite);
            const skin = GameData.skinOf(i === 0 ? GameData.settings.skin1 : GameData.settings.skin2);
            sp.spriteFrame = this.frames[skin.frame] || this.frames["player"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            pNode.setContentSize(36, 36);
            this.world.addChild(pNode, 5);
            const p = pNode.addComponent(Player);
            p.init(this, this.level, i, this.frames);
            this.players.push(p);
        }

        const follow = this.cameraNode.addComponent(CameraFollow);
        const rhythmLookAhead = this.isRhythmLevel() ? (((this.level.rhythm as any).cameraLookAhead || 280)) : 160;
        follow.init(this.players[0].node, 0, maxX, rhythmLookAhead);
        follow.snap();

        this.time = 0;
        this.deaths = 0;
        this.maxHealth = this.endless ? 1 : 3;
        this.health = GameData.carriedHealth > 0
            ? Math.min(GameData.carriedHealth, this.maxHealth)
            : this.maxHealth;
        GameData.carriedHealth = 0;
        this.crystalsTaken = 0;
        this.timeScale = 1;
        this.enemyT = 0;
        this.distPx = 0;
    }

    // ---------- endless mode ----------

    private endlessBaseSpeed(): number {
        return 300 * GameData.settings.speed;
    }

    private startEndless() {
        this.level = LevelBuilder.emptyLevel("ENDLESS", this.endlessBaseSpeed());
        this.gen = new EndlessGen(1100);
        this.chunks = [];
        // starter pad so the run begins on safe ground
        this.appendChunk({
            segments: [
                { x: -500, w: 1600, side: "floor" },
                { x: -500, w: 1600, side: "ceiling" }
            ],
            crystals: [{ x: 300, y: -212 }, { x: 400, y: -212 }, { x: 500, y: -212 }]
        }, 1100);
        this.spawnPlayersAndCamera(1e15);
        this.applyRotationForX(this.level.start.x, true);
        this.nameLabel.string = "ENDLESS MODE" + (GameData.players === 2 ? "   [2P]" : "");
        this.refreshHud();
        this.state = "ready";
        this.setMsg("PRESS SPACE TO RUN",
            this.controlsHint() + "    BEST " + GameData.getBestDist() + "m");
        this.startLive();
        this.armRoomStart();
    }

    // Room races start everyone on the host's server-clock timestamp.
    private armRoomStart() {
        if (GameData.roomT0 > 0) {
            this.roomT0 = GameData.roomT0;
            GameData.roomT0 = 0;
            this.setMsg("GET READY", "ROOM " + GameData.roomCode + " — synced start");
        }
    }

    private appendChunk(frag: any, endX: number) {
        const cn = new cc.Node("chunk");
        this.world.addChild(cn);
        const m = LevelBuilder.append(cn, frag, this.frames, this.level);
        this.chunks.push({ node: cn, endX: endX, m: m });
    }

    private dropChunk(c: { node: cc.Node; endX: number; m: FragmentManifest }) {
        const rm = (arr: any[], items: any[]) => {
            for (const it of items) {
                const i = arr.indexOf(it);
                if (i >= 0) arr.splice(i, 1);
            }
        };
        rm(this.level.solids, c.m.solids);
        rm(this.level.spikes, c.m.spikes);
        rm(this.level.crystals, c.m.crystals);
        rm(this.level.powerups, c.m.powerups);
        rm(this.level.teleports, c.m.teleports);
        rm(this.level.enemies, c.m.enemies);
        rm(this.level.movers, c.m.movers);
        c.node.destroy();
    }

    private endlessGameOver() {
        this.state = "gameover";
        this.unscheduleAllCallbacks();
        const meters = Math.floor(this.distPx / 10);
        const best = GameData.getBestDist();
        const newBest = meters > best;
        if (newBest) {
            GameData.setBestDist(meters);
            Fb.syncUp();
        }
        this.setMsg("", "");
        this.scheduleOnce(() => {
            this.buildResultPanel(
                newBest ? "NEW BEST!" : "RUN OVER",
                newBest ? cc.color(255, 181, 74) : cc.color(255, 90, 100),
                [
                    "DISTANCE   " + meters + "m",
                    "BEST   " + Math.max(meters, best) + "m",
                    "CRYSTALS " + this.crystalsTaken + "    TIME " + this.formatTime(this.time)
                ],
                [
                    { text: "RESTART", cb: () => this.fullRestart() },
                    { text: "MENU (ESC)", cb: () => Fx.fadeTo("Menu", this.hud) }
                ]);
        }, 0.5);
    }

    // ---------- HUD ----------

    private makeLabel(parent: cc.Node, x: number, y: number, size: number, color: cc.Color, anchorX: number = 0.5): cc.Label {
        const n = new cc.Node("label");
        n.setPosition(x, y);
        n.anchorX = anchorX;
        n.color = color;
        const lb = n.addComponent(cc.Label);
        lb.fontSize = size;
        lb.lineHeight = size + 6;
        lb.string = "";
        parent.addChild(n);
        return lb;
    }

    private buildHud() {
        // HUD is a sibling of the world; update() keeps it glued to the camera
        // (position AND angle, so it stays upright in rotation zones).
        this.hud = new cc.Node("HUD");
        this.node.addChild(this.hud, 100);

        // Touch hit-testing goes through the camera in Cocos 2.x: a listener
        // on the static Canvas stops firing once the camera scrolls right.
        // The catcher rides inside the HUD, which follows the camera.
        const catcher = new cc.Node("touchCatcher");
        catcher.setContentSize(1700, 900);
        catcher.on(cc.Node.EventType.TOUCH_START, this.onTouch, this);
        this.hud.addChild(catcher, -2);

        const cyan = cc.color(127, 247, 255);
        const pink = cc.color(255, 122, 200);
        const orange = cc.color(255, 181, 74);
        const white = cc.color(235, 240, 255);

        this.slowOverlay = new cc.Node("slowFx");
        const so = this.slowOverlay.addComponent(cc.Sprite);
        so.spriteFrame = this.frames["white"];
        so.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.slowOverlay.setContentSize(1400, 1400);
        this.slowOverlay.color = cc.color(120, 150, 255);
        this.slowOverlay.opacity = 0;
        this.hud.addChild(this.slowOverlay, -1);

        const mkHudBar = (name: string, y: number, h: number, color: cc.Color, opacity: number, z: number) => {
            const n = new cc.Node(name);
            const sp = n.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            n.setContentSize(1320, h);
            n.setPosition(0, y);
            n.color = color;
            n.opacity = opacity;
            n.active = false;
            this.hud.addChild(n, z);
            return n;
        };

        this.rhythmTopHudBar = mkHudBar("rhythmTopHudBar", 258, 54, cc.color(8, 14, 30), 132, -1);
        this.rhythmBottomHudBar = mkHudBar("rhythmBottomHudBar", -258, 64, cc.color(8, 14, 30), 132, -1);
        this.rhythmTopFxNode = mkHudBar("rhythmTopFx", 184, 74, cc.color(127, 247, 255), 0, 1);
        this.rhythmBottomFxNode = mkHudBar("rhythmBottomFx", -184, 82, cc.color(255, 122, 200), 0, 1);
        this.rhythmTopFastLines = this.makeRhythmFastLines(this.rhythmTopFxNode);
        this.rhythmBottomFastLines = this.makeRhythmFastLines(this.rhythmBottomFxNode);

        const mkRightBlind = (name: string, y: number) => {
            const n = new cc.Node(name);
            const sp = n.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            // HUD coordinates use about 1320px width.  A 660px rectangle
            // centered at x=330 covers exactly the right half of the screen.
            n.setContentSize(660, 286);
            n.setPosition(330, y);
            n.color = cc.color(0, 0, 0);
            n.opacity = 255;
            n.active = false;
            this.hud.addChild(n, 9);

            const edge = new cc.Node("rightBlindEdge");
            const es = edge.addComponent(cc.Sprite);
            es.spriteFrame = this.frames["white"];
            es.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            edge.setContentSize(6, 286);
            edge.setPosition(-330, 0);
            edge.color = cc.color(255, 226, 90);
            edge.opacity = 220;
            n.addChild(edge, 1);
            return n;
        };
        this.rhythmTopRightBlindNode = mkRightBlind("rhythmTopRightBlindFx", 143);
        this.rhythmBottomRightBlindNode = mkRightBlind("rhythmBottomRightBlindFx", -143);

        this.nameLabel = this.makeLabel(this.hud, -620, 286, 20, cyan, 0);
        this.crystalLabel = this.makeLabel(this.hud, -40, 286, 18, white, 0.5);
        this.deathLabel = this.makeLabel(this.hud, 330, 286, 20, pink, 0.5);
        this.timeLabel = this.makeLabel(this.hud, 620, 286, 22, orange, 1);
        this.distLabel = this.makeLabel(this.hud, 0, 286, 24, orange);
        this.rhythmLabel = this.makeLabel(this.hud, 0, -262, 20, orange);
        this.rhythmAiLabel = this.makeLabel(this.hud, 0, 258, 18, cyan);
        this.rhythmEffectLabel = this.makeLabel(this.hud, 0, -232, 14, orange);
        this.rhythmOpponentEffectLabel = this.makeLabel(this.hud, 0, 228, 14, cyan);
        this.rhythmLabel.node.zIndex = 12;
        this.rhythmAiLabel.node.zIndex = 12;
        this.rhythmEffectLabel.node.zIndex = 12;
        this.rhythmOpponentEffectLabel.node.zIndex = 12;
        this.rhythmSplitLine = new cc.Node("rhythmSplitLine");
        const splitSp = this.rhythmSplitLine.addComponent(cc.Sprite);
        splitSp.spriteFrame = this.frames["white"];
        splitSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        this.rhythmSplitLine.setContentSize(1300, 3);
        this.rhythmSplitLine.setPosition(0, 0);
        this.rhythmSplitLine.color = cc.color(120, 135, 180);
        this.rhythmSplitLine.opacity = 110;
        this.rhythmSplitLine.active = false;
        this.hud.addChild(this.rhythmSplitLine, 0);
        this.rhythmSplitTopLabel = this.makeLabel(this.hud, -620, 232, 13, cyan, 0);
        this.rhythmSplitBottomLabel = this.makeLabel(this.hud, -620, -232, 13, orange, 0);
        this.rhythmSplitTopLabel.node.active = false;
        this.rhythmSplitBottomLabel.node.active = false;
        const mkCloudBlind = (name: string, y: number, mirrorY: boolean) => {
            const n = new cc.Node(name);
            n.setPosition(0, y);
            n.active = false;
            const rects = [
                { x: -255, y: 40, w: 250, h: 64 },
                { x: 110, y: 0, w: 310, h: 56 },
                { x: -25, y: -50, w: 360, h: 48 }
            ];
            for (const r of rects) {
                const b = new cc.Node("blindCloudBlock");
                const bs = b.addComponent(cc.Sprite);
                bs.spriteFrame = this.frames["white"];
                bs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
                b.setContentSize(r.w, r.h);
                b.setPosition(r.x, mirrorY ? -r.y : r.y);
                b.color = cc.color(0, 0, 0);
                b.opacity = 255;
                n.addChild(b);
            }
            this.hud.addChild(n, 8);
            return n;
        };
        this.rhythmTopBlindNode = mkCloudBlind("rhythmTopBlindFx", 155, true);
        this.rhythmBottomBlindNode = mkCloudBlind("rhythmBottomBlindFx", -155, false);
        // Keep the old name as an alias for player-side clear logic.
        this.rhythmBlindNode = this.rhythmBottomBlindNode;
        this.judgeLabel = this.makeLabel(this.hud, 0, -86, 34, white);
        this.judgeLabel.node.zIndex = 12;
        this.msgLabel = this.makeLabel(this.hud, 0, 40, 44, white);
        this.subLabel = this.makeLabel(this.hud, 0, -10, 18, cyan);
    }

    private refreshHud() {
        if (this.isRhythmLevel()) {
            const hit = this.rhythmPerfect + this.rhythmGood + this.rhythmBad;
            this.crystalLabel.string = "NOTES  " + hit + " / " + this.level.rhythm.notes.length;
        } else {
            this.crystalLabel.string = this.endless
                ? "CRYSTALS  " + this.crystalsTaken
                : "CRYSTALS  " + this.crystalsTaken + " / " + this.level.totalCrystals;
        }
        this.deathLabel.string = "HEALTH  " + this.health + " / " + this.maxHealth;
        this.timeLabel.string = this.formatTime(this.time);
        this.updateRhythmHud();
        this.refreshRhythmSplitHud();
    }

    private formatTime(t: number): string {
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        return (m < 10 ? "0" + m : "" + m) + ":" + (s < 10 ? "0" + s.toFixed(1) : s.toFixed(1));
    }

    private setMsg(main: string, sub: string) {
        this.msgLabel.string = main;
        this.subLabel.string = sub;
    }

    // ---------- input ----------

    private skill(who: number, kind: string) {
        if (this.isRhythmLevel()) return;
        if (this.state !== "run") return;
        const idx = GameData.players === 2 ? who : 0;
        const p = this.players[idx];
        if (!p || !p.alive) return;
        if (kind === "dash") p.dash();
        else if (kind === "brake") {
            p.brake();
            Fx.brakeBurst(this.world, p.node.x - 10, p.node.y);
            Fx.popup(this.world, p.node.x, p.node.y + 42, "BRAKE", cc.color(160, 150, 255));
        } else {
            p.slam();
            const dir = p.getGravityDir();
            Fx.slamBurst(this.world, p.node.x, p.node.y + dir * 22, dir);
            Fx.popup(this.world, p.node.x, p.node.y + 42, "SLAM", cc.color(255, 181, 74));
        }
    }

    private rhythmKeyName(code: number): string {
        const key: any = cc.macro.KEY as any;
        const preferred = ["space", "up", "down", "left", "right", "escape", "enter", "tab", "backspace",
            "shift", "ctrl", "alt", "semicolon", "comma", "period", "slash", "backslash", "quote", "bracketleft", "bracketright",
            "minus", "equal", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
            "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        for (const n of preferred) if (key[n] === code) return n;
        for (const n in key) if (key[n] === code) return String(n).toLowerCase();
        return String(code);
    }

    private rhythmKeyList(kind: string): string[] {
        const raw = kind === "jump"
            ? (GameData.settings.rhythmJumpKeys || "f,j")
            : (GameData.settings.rhythmFlipKeys || "d,k");
        return String(raw).split(",").map(x => x.trim().toLowerCase()).filter(x => !!x);
    }

    private isRhythmActionKey(kind: string, code: number): boolean {
        return this.rhythmKeyList(kind).indexOf(this.rhythmKeyName(code)) >= 0;
    }

    private rhythmKeyText(kind: string): string {
        return this.rhythmKeyList(kind).map(x => x.toUpperCase()).join("/");
    }

    private onKeyDown(e: cc.Event.EventKeyboard) {
        if (this.isJumpFlipRhythm()) {
            if (this.isRhythmActionKey("jump", e.keyCode)) {
                this.onRhythmButton("jump");
                return;
            }
            if (this.isRhythmActionKey("flip", e.keyCode)) {
                this.onRhythmButton("flip");
                return;
            }
        }
        switch (e.keyCode) {
            case cc.macro.KEY.space:
            case cc.macro.KEY.up:
                this.onAction(1);
                break;
            case cc.macro.KEY.w:
                this.onAction(0);
                break;
            case cc.macro.KEY.d:
                this.skill(0, "dash");
                break;
            case cc.macro.KEY.a:
                this.skill(0, "brake");
                break;
            case cc.macro.KEY.right:
                this.skill(1, "dash");
                break;
            case cc.macro.KEY.left:
                this.skill(1, "brake");
                break;
            case cc.macro.KEY.s:
                this.skill(0, "slam");
                break;
            case cc.macro.KEY.down:
                this.skill(1, "slam");
                break;
            case cc.macro.KEY.r:
                this.fullRestart();
                break;
            case cc.macro.KEY.escape:
                this.togglePause();
                break;
            case cc.macro.KEY.q:
                if (this.state === "paused" || this.state === "loading" || this.state === "win" || this.state === "gameover") {
                    Fx.fadeTo("Menu", this.hud);
                }
                break;
        }
    }

    private onRhythmButton(action: string) {
        switch (this.state) {
            case "ready":
                if (this.roomT0 > 0) break;
                this.startRhythmRun();
                break;
            case "run":
                this.rhythmInput(action);
                break;
            case "paused":
                this.togglePause();
                break;
            case "win":
                this.proceedAfterWin();
                break;
            case "gameover":
                this.fullRestart();
                break;
        }
    }

    private onTouch(e: cc.Event.EventTouch) {
        // while paused, only the pause-menu buttons react to clicks
        if (this.state === "paused") return;
        // 2P touch: left half of the screen = P1, right half = P2
        const half = cc.winSize.width / 2;
        this.onAction(e.getLocationX() < half ? 0 : 1);
    }

    // who: 0 = P1 input, 1 = P2 input (in solo mode every input drives P1)
    private onAction(who: number) {
        switch (this.state) {
            case "ready":
                if (this.roomT0 > 0) break; // room race: countdown starts the run
                if (this.isRhythmLevel()) this.startRhythmRun();
                else {
                    this.state = "run";
                    this.setMsg("", "");
                }
                break;
            case "run": {
                if (this.isRhythmLevel()) {
                    this.rhythmInput("flip");
                    break;
                }
                const idx = GameData.players === 2 ? who : 0;
                const p = this.players[idx];
                if (p && p.alive) p.flip();
                break;
            }
            case "paused":
                this.togglePause();
                break;
            case "win":
                this.proceedAfterWin();
                break;
            case "gameover":
                this.fullRestart();
                break;
        }
    }

    private togglePause() {
        if (this.state === "run") {
            this.state = "paused";
            if (this.isRhythmLevel()) Sfx.pauseMusic();
            this.buildPauseMenu();
        } else if (this.state === "paused") {
            this.state = "run";
            if (this.isRhythmLevel()) Sfx.resumeMusic();
            this.closePauseMenu();
            this.setMsg("", "");
        } else if (this.state === "win" || this.state === "gameover") {
            Fx.fadeTo("Menu", this.hud);
        }
    }

    private buildPauseMenu() {
        if (this.pausePanel) return;
        const panel = new cc.Node("PausePanel");
        this.hud.addChild(panel, 10);
        this.pausePanel = panel;

        const dim = new cc.Node("dim");
        const ds = dim.addComponent(cc.Sprite);
        ds.spriteFrame = this.frames["white"];
        ds.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        dim.setContentSize(1400, 1400);
        dim.color = cc.color(0, 0, 0);
        dim.opacity = 170;
        panel.addChild(dim);

        const title = this.makeLabel(panel, 0, 130, 44, cc.color(235, 240, 255));
        title.string = "PAUSED";

        const mkBtn = (text: string, y: number, cb: () => void) => {
            const btn = new cc.Node("btn");
            const bs = btn.addComponent(cc.Sprite);
            bs.spriteFrame = this.frames["white"];
            bs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            btn.setContentSize(260, 50);
            btn.setPosition(0, y);
            btn.color = cc.color(24, 34, 76);
            panel.addChild(btn);
            const lb = this.makeLabel(btn, 0, 0, 20, cc.color(235, 240, 255));
            lb.string = text;
            btn.on(cc.Node.EventType.TOUCH_END, () => {
                Sfx.play("click", 0.8);
                cb();
            });
        };
        mkBtn("RESUME  (SPACE)", 40, () => this.togglePause());
        mkBtn("RESTART  (R)", -30, () => this.fullRestart());
        mkBtn("MAIN MENU  (Q)", -100, () => Fx.fadeTo("Menu", this.hud));
        if (this.stateSavable()) {
            mkBtn("SAVE / LOAD STATE", -170, () => this.buildStatePanel());
        }
    }

    private closePauseMenu() {
        this.closeStatePanel();
        if (this.pausePanel) {
            this.pausePanel.destroy();
            this.pausePanel = null;
        }
    }

    private fullRestart() {
        if (this.state === "loading" || this.players.length === 0) return;
        GameData.carriedHealth = 0;
        if (this.endless) {
            Fx.fadeTo("Game", this.hud); // streamed chunks: clean reload
            return;
        }
        this.unscheduleAllCallbacks();
        this.closePauseMenu();
        if (this.resultPanel) {
            this.resultPanel.destroy();
            this.resultPanel = null;
        }
        if (this.isRhythmLevel()) Sfx.stopBgm();
        this.deaths = 0;
        this.maxHealth = this.endless ? 1 : 3;
        this.health = this.maxHealth;
        this.respawnAll();
        this.state = "ready";
        this.setMsg(this.isRhythmLevel() ? "PRESS RHYTHM KEY TO START" : "PRESS SPACE TO RUN", this.controlsHint());
    }

    private respawnAll() {
        for (const p of this.players) p.reset();
        for (const c of this.level.crystals) {
            c.taken = false;
            c.node.active = true;
            c.node.setPosition(c.x, c.y); // magnet may have dragged it around
        }
        for (const pu of this.level.powerups) {
            pu.taken = false;
            pu.node.active = true;
        }
        this.crystalsTaken = 0;
        this.time = 0;
        this.timeScale = 1;
        this.slowT = 0;
        this.slowOverlay.opacity = 0;
        this.enemyT = 0;
        const follow = this.cameraNode.getComponent(CameraFollow);
        if (follow) {
            follow.setTarget(this.players[0].node);
            follow.snap();
        }
        this.applyRotationForX(this.level.start.x, true);
        if (this.isRhythmLevel()) this.resetRhythmState(true);
        this.refreshHud();
    }


    // ---------- rhythm mode ----------

    isRhythmMode(): boolean {
        return this.isRhythmLevel();
    }

    private isRhythmLevel(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled);
    }

    private startRhythmRun() {
        if (!this.isRhythmLevel()) return;
        this.resetRhythmState(true);
        this.time = 0;
        this.refreshHud();
        this.state = "loading";
        this.setMsg("GET READY", "loading music...");
        Sfx.playMusic(this.level.rhythm.audio || "rhythm_song", false, () => {
            if (!this.node || !this.node.isValid || !this.isRhythmLevel()) return;
            if (this.state !== "loading") return;
            this.state = "run";
            this.setMsg("", "");
        });
    }

    private resetRhythmState(resetNodes: boolean) {
        this.rhythmIndex = 0;
        this.rhythmScore = 0;
        this.rhythmCombo = 0;
        this.rhythmMaxCombo = 0;
        this.rhythmPerfect = 0;
        this.rhythmGood = 0;
        this.rhythmBad = 0;
        this.rhythmMiss = 0;
        this.rhythmFxSpeedT = 0;
        this.rhythmFxSwapT = 0;
        this.rhythmFxBlindT = 0;
        this.rhythmOppFxSpeedT = 0;
        this.rhythmOppFxSwapT = 0;
        this.rhythmOppFxBlindT = 0;
        this.rhythmOpponentEffectTarget = this.isRhythmAiBattle() ? "AI" : "OPPONENT";
        this.rhythmAttackSeq = 0;
        this.rhythmAttackType = "";
        this.rhythmAttackAt = 0;
        this.rhythmRemoteAttackSeq = {};
        if (this.rhythmBlindNode) this.rhythmBlindNode.active = false;
        if (this.rhythmTopBlindNode) this.rhythmTopBlindNode.active = false;
        if (this.rhythmBottomBlindNode) this.rhythmBottomBlindNode.active = false;
        if (this.rhythmTopRightBlindNode) this.rhythmTopRightBlindNode.active = false;
        if (this.rhythmBottomRightBlindNode) this.rhythmBottomRightBlindNode.active = false;
        if (this.rhythmTopFxNode) this.rhythmTopFxNode.active = false;
        if (this.rhythmBottomFxNode) this.rhythmBottomFxNode.active = false;
        this.updateRhythmFastLines(this.rhythmTopFastLines, false, 0);
        this.updateRhythmFastLines(this.rhythmBottomFastLines, false, 0);
        this.resetRhythmAi(resetNodes);
        if (resetNodes && this.level && this.level.rhythm) {
            for (const n of this.level.rhythm.notes) {
                n.judged = false;
                if (n.node && n.node.isValid) {
                    n.node.opacity = (this.isCollectorRhythm() || this.isJumpFlipRhythm()) ? 238 : (n.flip ? 245 : 190);
                    n.node.scale = 1;
                }
                const opponentNode = (n as any).opponentNode as cc.Node;
                if (opponentNode && opponentNode.isValid) {
                    opponentNode.opacity = 128;
                    opponentNode.scale = 1;
                }
            }
            const rolls: any[] = (this.level.rhythm as any).rolls || [];
            for (const rr of rolls) {
                const band = (rr as any).opponentNode as cc.Node;
                const top = (rr as any).opponentTopNode as cc.Node;
                const bot = (rr as any).opponentBottomNode as cc.Node;
                if (band && band.isValid) { band.opacity = 30; band.scaleY = 1; }
                if (top && top.isValid) top.opacity = 92;
                if (bot && bot.isValid) bot.opacity = 92;
            }
        }
        this.updateRhythmHud();
        this.updateRhythmEffectHud();
    }

    private updateRhythmHud() {
        this.applyRhythmHudLayout();
        if (!this.rhythmLabel) return;
        if (!this.isRhythmLevel()) {
            this.rhythmLabel.string = "";
            if (this.rhythmAiLabel) this.rhythmAiLabel.string = "";
            if (this.rhythmEffectLabel) this.rhythmEffectLabel.string = "";
            if (this.rhythmOpponentEffectLabel) this.rhythmOpponentEffectLabel.string = "";
            if (this.judgeLabel) this.judgeLabel.string = "";
            this.refreshRhythmSplitHud();
            return;
        }
        this.rhythmLabel.string = "YOU  SCORE " + this.rhythmScore
            + "   COMBO " + this.rhythmCombo
            + "   HIT " + (this.rhythmPerfect + this.rhythmGood + this.rhythmBad)
            + "   MISS " + this.rhythmMiss;
        this.updateRhythmAiHud();
        this.updateRhythmEffectHud();
        this.refreshRhythmSplitHud();
    }

    private rhythmSummary(): string {
        if (!this.isRhythmLevel()) return "";
        const total = this.level.rhythm.notes.length || 1;
        const hit = this.rhythmPerfect + this.rhythmGood + this.rhythmBad;
        const acc = Math.round(1000 * (this.rhythmPerfect + this.rhythmGood * 0.7 + this.rhythmBad * 0.35) / total) / 10;
        return "SCORE " + this.rhythmScore
            + "    ACC " + acc.toFixed(1) + "%"
            + "    MAX COMBO " + this.rhythmMaxCombo
            + "    P/G/B/M " + this.rhythmPerfect + "/" + this.rhythmGood + "/" + this.rhythmBad + "/" + this.rhythmMiss;
    }


    private rhythmBattleLines(): string[] {
        if (this.isRhythmAiBattle()) {
            const verdict = this.rhythmScore === this.rhythmAiScore ? "DRAW"
                : (this.rhythmScore > this.rhythmAiScore ? "YOU WIN" : "AI WINS");
            return [
                "AI SCORE " + this.rhythmAiScore + "    MAX COMBO " + this.rhythmAiMaxCombo
                    + "    P/G/B/M " + this.rhythmAiPerfect + "/" + this.rhythmAiGood + "/" + this.rhythmAiBad + "/" + this.rhythmAiMiss,
                "BATTLE RESULT   " + verdict
            ];
        }
        if (this.isRhythmOnlineBattle()) {
            return ["ROOM " + (GameData.roomCode || "ONLINE") + "    " + this.rhythmOnlineScoreText()];
        }
        return [];
    }

    private showRhythmJudge(text: string, color: cc.Color) {
        if (!this.judgeLabel) return;
        this.judgeLabel.node.stopAllActions();
        this.judgeLabel.string = text;
        this.judgeLabel.node.color = color;
        this.judgeLabel.node.opacity = 255;
        this.judgeLabel.node.scale = 1.15;
        cc.tween(this.judgeLabel.node)
            .to(0.12, { scale: 1 })
            .delay(0.18)
            .to(0.18, { opacity: 0 })
            .start();
    }

    private isCollectorRhythm(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled && this.level.rhythm.style === "gravity-collect");
    }

    private isJumpFlipRhythm(): boolean {
        return !!(this.level && this.level.rhythm && this.level.rhythm.enabled && this.level.rhythm.style === "jump-flip");
    }

    private rhythmNoteTime(n: any): number {
        return Number(n && (n as any).hitTime !== undefined ? (n as any).hitTime : (n ? n.time : 0));
    }

    private spawnRhythmAi() {
        if (this.rhythmAiNode && this.rhythmAiNode.isValid) return;
        const n = new cc.Node("RhythmAI");
        const sp = n.addComponent(cc.Sprite);
        sp.spriteFrame = this.frames["player2"] || this.frames["player"];
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(36, 36);
        n.opacity = 205;
        n.color = cc.color(255, 210, 130);
        const name = new cc.Node("aiName");
        name.setPosition(0, 34);
        name.color = cc.color(255, 230, 150);
        const lb = name.addComponent(cc.Label);
        lb.string = "AI";
        lb.fontSize = 12;
        lb.lineHeight = 14;
        n.addChild(name);
        this.world.addChild(n, 4);
        this.rhythmAiNode = n;
        this.resetRhythmAi(true);
    }

    private resetRhythmAi(resetNode: boolean) {
        this.rhythmAiIndex = 0;
        this.rhythmAiScore = 0;
        this.rhythmAiCombo = 0;
        this.rhythmAiMaxCombo = 0;
        this.rhythmAiPerfect = 0;
        this.rhythmAiGood = 0;
        this.rhythmAiBad = 0;
        this.rhythmAiMiss = 0;
        this.rhythmAiRailDir = -1;
        this.rhythmAiLaneIndex = 0;
        this.rhythmAiRollIndex = 0;
        this.rhythmAiRollNextTap = 0;
        this.rhythmAiRollFlipSide = false;
        if (resetNode && this.isRhythmAiBattle()) {
            this.spawnRhythmAi();
            if (this.rhythmAiNode && this.level) {
                const r = this.level.rhythm;
                let y = this.level.start.y;
                if (r && r.enabled && r.style === "jump-flip") {
                    const ys = r.laneYs && r.laneYs.length ? r.laneYs : [(r.floorY || -240) + 18, (r.ceilingY || 240) - 18];
                    y = ys[Math.max(0, Math.min(ys.length - 1, r.startLane || 0))];
                }
                if (r && r.enabled && r.style === "gravity-collect") {
                    const ys = r.laneYs && r.laneYs.length ? r.laneYs : [-212, -106, 0, 106, 212];
                    y = ys[Math.max(0, Math.min(ys.length - 1, r.startLane || 0))];
                }
                if (this.rhythmSplitBattle) y = this.rhythmOpponentYFromPlayerY(y);
                this.rhythmAiNode.setPosition(this.level.start.x, y);
                this.rhythmAiNode.scaleX = 1;
                this.rhythmAiNode.scaleY = 1;
                this.rhythmAiNode.active = true;
                this.rhythmAiNode.opacity = 205;
            }
        } else if (this.rhythmAiNode) {
            this.rhythmAiNode.active = false;
        }
        this.updateRhythmAiHud();
    }

    private rhythmOnlineScoreText(): string {
        if (!this.isRhythmOnlineBattle()) return "";
        const rows: { name: string; score: number; combo: number }[] = [];
        for (const uid in this.ghosts) {
            const g = this.ghosts[uid];
            if (!g || !g.node || !g.node.isValid) continue;
            rows.push({ name: g.name || "opponent", score: g.score || 0, combo: g.combo || 0 });
        }
        rows.sort((a, b) => b.score - a.score);
        if (!rows.length) return "WAITING FOR OPPONENT SCORE";
        return rows.slice(0, 2).map(r => r.name + " " + r.score + " / C" + r.combo).join("   |   ");
    }

    private updateRhythmAiHud() {
        if (!this.rhythmAiLabel) return;
        if (this.isRhythmAiBattle()) {
            const lead = this.rhythmScore - this.rhythmAiScore;
            this.rhythmAiLabel.string = "AI   SCORE " + this.rhythmAiScore
                + "   COMBO " + this.rhythmAiCombo
                + "   DIFF " + (lead >= 0 ? "+" : "") + lead
                + (this.rhythmAiInterfereT > 0 ? ("   JAMMED " + this.rhythmAttackName(this.rhythmAiInterfereType) + " " + this.rhythmAiInterfereT.toFixed(1)) : "");
        } else if (this.isRhythmOnlineBattle()) {
            this.rhythmAiLabel.string = (GameData.roomCode ? ("ROOM " + GameData.roomCode + "   ") : "ONLINE   ") + this.rhythmOnlineScoreText();
        } else {
            this.rhythmAiLabel.string = "";
        }
    }

    private rhythmAiRand(i: number): number {
        const x = Math.sin((i + 1) * 12.9898 + 78.233) * 43758.5453;
        return x - Math.floor(x);
    }

    private rhythmAiSkill(): number {
        const judged = this.rhythmPerfect + this.rhythmGood + this.rhythmBad + this.rhythmMiss;
        const acc = judged > 0
            ? (this.rhythmPerfect + this.rhythmGood * 0.72 + this.rhythmBad * 0.35) / judged
            : 0.58;
        let skill = 0.34 + acc * 0.46;
        if (this.rhythmCombo >= 25) skill += 0.07;
        else if (this.rhythmCombo >= 10) skill += 0.04;
        if (this.rhythmMiss > this.rhythmPerfect + this.rhythmGood) skill -= 0.08;

        // Rubber-band the AI so it feels like a rival instead of a perfect bot.
        // If the AI is far ahead it intentionally becomes sloppier; if it is far
        // behind it becomes slightly sharper.
        const lead = this.rhythmAiScore - this.rhythmScore;
        if (lead > 80000) skill -= 0.18;
        else if (lead > 35000) skill -= 0.10;
        else if (lead < -50000) skill += 0.08;
        if (this.rhythmAiInterfereT > 0) {
            skill -= this.rhythmAiInterfereType === "blind" ? 0.18 : 0.13;
        }

        return Math.max(0.20, Math.min(0.88, skill));
    }

    private rhythmAiJudge(i: number): string {
        const skill = this.rhythmAiSkill();
        const r = this.rhythmAiRand(i + Math.floor(this.rhythmScore / 7000) * 13 + this.rhythmMiss * 31);
        const missRate = Math.max(0.07, 0.34 - skill * 0.24);
        const badRate = Math.max(0.08, 0.30 - skill * 0.18);
        const goodRate = Math.max(0.16, 0.42 - skill * 0.16);
        if (r < missRate) return "miss";
        if (r < missRate + badRate) return "bad";
        if (r < missRate + badRate + goodRate) return "good";
        return "perfect";
    }

    private rhythmOpponentNoteY(note: any): number {
        if (!this.rhythmSplitBattle) return Number(note.y) || 0;
        return this.rhythmOpponentYFromPlayerY(Number(note.y) || 0);
    }

    private rhythmOpponentLaneY(note: any): number {
        if (!this.level || !this.level.rhythm) return this.rhythmOpponentNoteY(note);
        const r = this.level.rhythm;
        const ys = r.laneYs && r.laneYs.length ? r.laneYs : [r.floorY + 18, r.ceilingY - 18];
        const idx = Math.max(0, Math.min(ys.length - 1, Number(note.trackLane) || 0));
        const y = ys[idx];
        return this.rhythmSplitBattle ? this.rhythmOpponentYFromPlayerY(y) : y;
    }

    private moveRhythmAiForNote(note: any) {
        if (!this.rhythmAiNode || !this.rhythmAiNode.isValid || !this.level || !this.level.rhythm) return;
        const r = this.level.rhythm;
        const noteY = this.rhythmOpponentNoteY(note);
        const laneY = this.rhythmOpponentLaneY(note);
        if (Number.isFinite(Number(note.x))) this.rhythmAiNode.x = Number(note.x);

        if (r.style === "gravity-collect") {
            this.rhythmAiLaneIndex = Math.max(0, Math.min((r.laneYs || []).length - 1, Number(note.trackLane) || 0));
            this.rhythmAiNode.stopAllActions();
            cc.tween(this.rhythmAiNode).to(0.07, { y: noteY }, { easing: "sineOut" }).start();
            return;
        }

        if (r.style === "jump-flip") {
            this.rhythmAiRailDir = (note.lane === "ceiling" || Number(note.trackLane) === 1) ? 1 : -1;
            this.rhythmAiNode.scaleY = this.rhythmAiRailDir > 0 ? -1 : 1;
            this.rhythmAiNode.stopAllActions();
            if ((note.action || "") === "jump") {
                this.rhythmAiNode.y = laneY;
                cc.tween(this.rhythmAiNode)
                    .to(0.035, { y: noteY, scaleX: 0.88 }, { easing: "sineOut" })
                    .to(0.085, { y: laneY, scaleX: 1 }, { easing: "sineIn" })
                    .start();
            } else {
                this.rhythmAiNode.y = noteY;
                cc.tween(this.rhythmAiNode)
                    .to(0.08, { angle: this.rhythmAiNode.angle + 120 }, { easing: "sineOut" })
                    .start();
            }
        }
    }

    private applyRhythmAiJudgement(note: any, judgement: string, index: number) {
        if (judgement === "perfect") {
            this.rhythmAiPerfect++;
            this.rhythmAiCombo++;
            this.rhythmAiScore += 1000 + this.rhythmAiCombo * 2;
        } else if (judgement === "good") {
            this.rhythmAiGood++;
            this.rhythmAiCombo++;
            this.rhythmAiScore += 650 + this.rhythmAiCombo;
        } else if (judgement === "bad") {
            this.rhythmAiBad++;
            this.rhythmAiCombo = 0;
            this.rhythmAiScore += 250;
        } else {
            this.rhythmAiMiss++;
            this.rhythmAiCombo = 0;
        }
        if (this.rhythmAiCombo > this.rhythmAiMaxCombo) this.rhythmAiMaxCombo = this.rhythmAiCombo;
        const opponentNode = (note as any).opponentNode as cc.Node;
        if (opponentNode && opponentNode.isValid) {
            opponentNode.stopAllActions();
            opponentNode.opacity = judgement === "miss" ? 35 : 72;
            opponentNode.scale = judgement === "miss" ? 0.75 : 1.18;
            cc.tween(opponentNode).to(0.12, { scale: 1 }).start();
        }
        if (judgement !== "miss") {
            if (judgement === "perfect" || judgement === "good") this.triggerRhythmAttack("ai", note);
            this.moveRhythmAiForNote(note);
            const y = this.rhythmOpponentNoteY(note);
            const x = Number.isFinite(Number(note.x)) ? Number(note.x) : (this.rhythmAiNode ? this.rhythmAiNode.x : 0);
            Fx.popup(this.world, x, y + 28, judgement.toUpperCase(), judgement === "perfect" ? cc.color(255, 240, 150) : cc.color(127, 247, 255));
        }
        this.updateRhythmAiHud();
    }

    private updateRhythmAiRoll(t: number) {
        if (!this.isRhythmAiBattle() || !this.isJumpFlipRhythm() || !this.level || !this.level.rhythm) return;
        const rolls: any[] = (this.level.rhythm as any).rolls || [];
        if (!rolls.length) return;
        const skill = this.rhythmAiSkill();
        const interval = Math.max(0.10, Math.min(0.24, 0.25 - skill * 0.16));

        while (this.rhythmAiRollIndex < rolls.length) {
            const rr = rolls[this.rhythmAiRollIndex];
            const start = Number(rr.start) || 0;
            const end = Number(rr.end) || 0;
            if (t < start) break;
            if (t > end) {
                const band = (rr as any).opponentNode as cc.Node;
                if (band && band.isValid) band.opacity = 16;
                this.rhythmAiRollIndex++;
                this.rhythmAiRollNextTap = 0;
                continue;
            }
            if (this.rhythmAiRollNextTap <= 0) this.rhythmAiRollNextTap = start;
            while (t >= this.rhythmAiRollNextTap && this.rhythmAiRollNextTap <= end) {
                const seed = this.rhythmAiRollIndex * 1000 + Math.round(this.rhythmAiRollNextTap * 100);
                const hit = this.rhythmAiRand(seed) < Math.max(0.35, Math.min(0.92, skill + 0.10));
                const x1 = Number.isFinite(Number(rr.x1)) ? Number(rr.x1) : this.level.start.x + start * (this.level.speed || 300);
                const x2 = Number.isFinite(Number(rr.x2)) ? Number(rr.x2) : this.level.start.x + end * (this.level.speed || 300);
                const span = Math.max(0.001, end - start);
                const x = x1 + (x2 - x1) * ((this.rhythmAiRollNextTap - start) / span);
                if (hit) {
                    this.rhythmAiScore += 100;
                    const laneYs = this.level.rhythm.laneYs && this.level.rhythm.laneYs.length ? this.level.rhythm.laneYs : [this.level.rhythm.floorY + 18, this.level.rhythm.ceilingY - 18];
                    const baseLane = this.rhythmAiRollFlipSide ? laneYs[laneYs.length - 1] : laneYs[0];
                    const y = this.rhythmSplitBattle ? this.rhythmOpponentYFromPlayerY(baseLane) : baseLane;
                    this.rhythmAiRollFlipSide = !this.rhythmAiRollFlipSide;
                    if (this.rhythmAiNode && this.rhythmAiNode.isValid) {
                        this.rhythmAiNode.stopAllActions();
                        this.rhythmAiNode.setPosition(x, y);
                        this.rhythmAiNode.scaleY = this.rhythmAiRollFlipSide ? -1 : 1;
                        cc.tween(this.rhythmAiNode).to(0.045, { angle: this.rhythmAiNode.angle + 95 }, { easing: "sineOut" }).start();
                    }
                    const band = (rr as any).opponentNode as cc.Node;
                    if (band && band.isValid) {
                        band.opacity = 58;
                        band.stopAllActions();
                        cc.tween(band).to(0.05, { scaleY: 1.08 }).to(0.08, { scaleY: 1 }).start();
                    }
                    Fx.popup(this.world, x, y + 34, "+100", cc.color(255, 240, 130));
                }
                this.rhythmAiRollNextTap += interval;
            }
            break;
        }
        this.updateRhythmAiHud();
    }

    private updateRhythmAi(dt: number) {
        if (!this.isRhythmAiBattle() || !this.level || !this.level.rhythm) return;
        if (!this.rhythmAiNode || !this.rhythmAiNode.isValid) this.spawnRhythmAi();
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const lead = this.players[0];
        if (this.rhythmAiNode && this.rhythmAiNode.isValid) {
            // Keep the AI avatar synchronized with the chart/music, not with the
            // player's current x.  Otherwise a local speed jam or network jitter
            // makes the top-track AI appear to chase/randomly jump around.
            const targetX = this.level.start.x + t * (this.level.speed || 300);
            const k = Math.min(1, 7 * dt);
            this.rhythmAiNode.x += (targetX - this.rhythmAiNode.x) * k;
        }
        while (this.rhythmAiIndex < r.notes.length) {
            const idx = this.rhythmAiIndex;
            const n = r.notes[idx];
            const hitTime = this.rhythmNoteTime(n);
            if (t < hitTime + 0.015) break;
            const judgement = this.rhythmAiJudge(idx);
            this.applyRhythmAiJudgement(n, judgement, idx);
            this.rhythmAiIndex++;
        }
        this.updateRhythmAiRoll(t);
    }

    private advanceRhythmIndex() {
        const r = this.level && this.level.rhythm;
        if (!r) return;
        while (this.rhythmIndex < r.notes.length && r.notes[this.rhythmIndex].judged) this.rhythmIndex++;
    }

    private rhythmInput(action: string = "flip") {
        if (!this.isRhythmLevel()) return;
        action = this.normalizeRhythmAction(action);
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const badW = r.badWindow || 0.17;
        const goodW = r.goodWindow || 0.11;
        const perfectW = r.perfectWindow || 0.055;
        const p = this.players[0];

        const doAction = (a: string) => {
            if (!p || !p.alive) return;
            if (this.isJumpFlipRhythm()) {
                if (a === "jump" && (p as any).rhythmLightJump) (p as any).rhythmLightJump();
                else p.flip();
            } else if (this.isCollectorRhythm() && (p as any).rhythmFreeStep) {
                (p as any).rhythmFreeStep();
            } else {
                p.flip();
            }
        };

        if (this.isJumpFlipRhythm()) {
            // Jump / flip only moves the player.  Notes are scored only when the
            // player actually overlaps the note node on the correct rail.
            doAction(action);
            this.updateJumpFlipTouches();
            return;
        }

        let best: any = null;
        let bestDiff = 1e9;
        for (let i = this.rhythmIndex; i < r.notes.length && i < this.rhythmIndex + 18; i++) {
            const n = r.notes[i];
            if (n.judged) continue;
            const diff = Math.abs(n.time - t);
            if (diff < bestDiff && diff <= badW) {
                best = n;
                bestDiff = diff;
            }
            if (n.time > t + badW) break;
        }

        if (best) {
            if (p && p.alive && this.isCollectorRhythm() && (p as any).rhythmStepToLane) {
                (p as any).rhythmStepToLane(best.trackLane || 0, best.dir || 0);
            } else if (p && p.alive) {
                p.flip();
            }
            let judgement = "bad";
            if (bestDiff <= perfectW) judgement = "perfect";
            else if (bestDiff <= goodW) judgement = "good";
            this.judgeNote(best, judgement);
            this.advanceRhythmIndex();
            return;
        }

        // Outside a note window, still allow free movement so it remains a
        // gravity-runner instead of a static rhythm game.
        doAction(action);
    }

    private judgeNote(note: any, judgement: string) {
        note.judged = true;
        if (note.node && note.node.isValid) {
            note.node.stopAllActions();
            note.node.opacity = judgement === "miss" ? 35 : 70;
            note.node.scale = judgement === "miss" ? 0.75 : 1.25;
            cc.tween(note.node).to(0.12, { scale: 1 }).start();
            if (judgement === "miss") Fx.rhythmMiss(this.world, note.x || note.node.x, note.y || note.node.y);
            else if ((note.action || "") === "jump") Fx.rhythmJump(this.world, note.x || note.node.x, note.y || note.node.y, -1);
            else if ((note.action || "") === "flip") Fx.rhythmFlip(this.world, note.x || note.node.x, note.y || note.node.y);
        }
        if (judgement === "perfect") {
            this.rhythmPerfect++;
            this.rhythmCombo++;
            this.rhythmScore += 1000 + this.rhythmCombo * 2;
            this.showRhythmJudge("PERFECT", cc.color(255, 240, 150));
        } else if (judgement === "good") {
            this.rhythmGood++;
            this.rhythmCombo++;
            this.rhythmScore += 650 + this.rhythmCombo;
            this.showRhythmJudge("GOOD", cc.color(127, 247, 255));
        } else if (judgement === "bad") {
            this.rhythmBad++;
            this.rhythmCombo = 0;
            this.rhythmScore += 250;
            this.showRhythmJudge("BAD", cc.color(255, 181, 74));
        } else {
            this.rhythmMiss++;
            this.rhythmCombo = 0;
            this.showRhythmJudge("MISS", cc.color(255, 90, 100));
        }
        if (judgement === "perfect" || judgement === "good") this.triggerRhythmAttack("player", note);
        if (this.rhythmCombo > this.rhythmMaxCombo) this.rhythmMaxCombo = this.rhythmCombo;
        this.updateRhythmHud();
        this.refreshHud();
    }

    private playerTouchesRhythmNote(note: any): boolean {
        const p = this.players[0];
        if (!p || !p.alive || !note || !note.node || !note.node.isValid) return false;
        const dx = Math.abs(p.node.x - note.node.x);
        const dy = Math.abs(p.node.y - note.node.y);

        // Judge jump/flip charts by the visible body-vs-note overlap.  Requiring
        // the rail string to match as well caused false MISSes when the player
        // was visibly touching a blue flip note during the same frame as a rail
        // transition or a split-screen coordinate transform.
        const rx = note.action === "flip" ? 64 : 58;
        const ry = note.action === "flip" ? 60 : 56;
        return dx <= rx && dy <= ry;
    }

    private updateJumpFlipTouches() {
        if (!this.isJumpFlipRhythm()) return;
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const badW = r.badWindow || 0.17;
        const goodW = r.goodWindow || 0.11;
        const perfectW = r.perfectWindow || 0.055;
        const touchLateGrace = 0.07;
        const touchEarlyGrace = 0.025;

        while (this.rhythmIndex < r.notes.length && r.notes[this.rhythmIndex].judged) this.rhythmIndex++;

        // Do not let one earlier note block a later note that the player is
        // visibly touching.  This especially matters for dense TJA charts where
        // a red note can still be inside its miss window while the next blue
        // flip note is already on the player.
        let best: any = null;
        let bestDiff = 1e9;
        let bestIdx = -1;
        for (let i = this.rhythmIndex; i < r.notes.length && i < this.rhythmIndex + 24; i++) {
            const n = r.notes[i];
            if (!n || n.judged) continue;
            const hitTime = this.rhythmNoteTime(n);
            if (hitTime > t + badW + touchEarlyGrace) break;
            if (t < hitTime - badW - touchEarlyGrace) continue;
            if (t > hitTime + badW + touchLateGrace) continue;
            if (!this.playerTouchesRhythmNote(n)) continue;
            const diff = Math.abs(hitTime - t);
            if (diff < bestDiff) {
                best = n;
                bestDiff = diff;
                bestIdx = i;
            }
        }

        if (best) {
            let judgement = "bad";
            if (bestDiff <= perfectW) judgement = "perfect";
            else if (bestDiff <= goodW) judgement = "good";
            this.judgeNote(best, judgement);
            if (bestIdx === this.rhythmIndex) this.rhythmIndex++;
        }

        while (this.rhythmIndex < r.notes.length) {
            const n = r.notes[this.rhythmIndex];
            if (n.judged) {
                this.rhythmIndex++;
                continue;
            }
            const hitTime = this.rhythmNoteTime(n);
            if (t > hitTime + badW + touchLateGrace) {
                this.judgeNote(n, "miss");
                this.rhythmIndex++;
                continue;
            }
            break;
        }
        this.updateRhythmHud();
    }

    private updateRhythm() {
        const r = this.level.rhythm;
        const t = Sfx.getMusicTime();
        const badW = r.badWindow || 0.17;

        // Jump/flip rhythm is collision-based: pressing the key only moves the
        // player; a note scores only when the body touches it on the right rail.
        if (this.isJumpFlipRhythm()) {
            this.updateJumpFlipTouches();
            return;
        }

        // In collector rhythm mode, notes are judged by input timing.  If the
        // player does not press inside the window, it is simply a MISS; no death.
        if (this.isCollectorRhythm()) {
            while (this.rhythmIndex < r.notes.length) {
                const n = r.notes[this.rhythmIndex];
                if (n.judged) {
                    this.rhythmIndex++;
                    continue;
                }
                const hitTime = Number((n as any).hitTime !== undefined ? (n as any).hitTime : n.time);
                if (t > hitTime + badW) {
                    this.judgeNote(n, "miss");
                    this.rhythmIndex++;
                    continue;
                }
                break;
            }
            this.updateRhythmHud();
            return;
        }

        const goodW = r.goodWindow || 0.11;
        const perfectW = r.perfectWindow || 0.055;
        const p = this.players[0];

        while (this.rhythmIndex < r.notes.length) {
            const n = r.notes[this.rhythmIndex];
            if (n.judged) {
                this.rhythmIndex++;
                continue;
            }

            if (t < n.time) break;

            const laneOk = !!(p && p.alive && (p as any).getLane && (p as any).getLane() === n.lane);
            const late = Math.max(0, t - n.time);
            if (laneOk) {
                let judgement = "bad";
                if (late <= perfectW) judgement = "perfect";
                else if (late <= goodW) judgement = "good";
                this.judgeNote(n, judgement);
                this.rhythmIndex++;
                continue;
            }

            if (late > badW) {
                this.judgeNote(n, "miss");
                this.rhythmIndex++;
                if (r.gateFatal !== false && p && p.alive && (p as any).rhythmGateFail) {
                    (p as any).rhythmGateFail();
                }
                continue;
            }
            break;
        }
        this.updateRhythmHud();
    }

    // ---------- rotation zones ----------

    private applyRotationForX(x: number, instant: boolean) {
        let target = 0;
        for (const r of this.level.rotations) {
            if (x >= r.x) target = r.angle;
        }
        if (target !== this.rotTarget) {
            this.rotTarget = target;
            if (!instant) Sfx.play("teleport", 0.4);
        }
        if (instant) {
            this.rotCurrent = target;
            this.applyWorldRotation();
        }
    }

    // Rotate the WORLD node (not the camera — cc.Camera in 2.4 ignores its
    // node's rotation) around the camera's focus point. Obstacles, players and
    // apparent gravity all rotate on screen, while physics stay 1D because
    // Player works in the world node's local coordinates.
    private applyWorldRotation() {
        const th = this.rotCurrent * Math.PI / 180;
        const px = this.cameraNode.x; // camera y is always 0
        this.world.angle = this.rotCurrent;
        this.world.x = px - px * Math.cos(th);
        this.world.y = -px * Math.sin(th);
    }

    // ---------- power-up support ----------

    applySlow(seconds: number, scale: number) {
        this.slowT = seconds;
        this.timeScale = scale;
        this.slowOverlay.opacity = 50;
    }

    // ---------- result panel (win / game-over) ----------

    private buildResultPanel(title: string, accent: cc.Color, lines: string[], buttons: { text: string; cb: () => void }[]) {
        if (this.resultPanel) this.resultPanel.destroy();
        const panel = new cc.Node("ResultPanel");
        this.hud.addChild(panel, 20);
        this.resultPanel = panel;

        const mkSprite = (parent: cc.Node, w: number, h: number, x: number, y: number, color: cc.Color, opacity: number) => {
            const n = new cc.Node("s");
            const sp = n.addComponent(cc.Sprite);
            sp.spriteFrame = this.frames["white"];
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            n.setContentSize(w, h);
            n.setPosition(x, y);
            n.color = color;
            n.opacity = opacity;
            parent.addChild(n);
            return n;
        };

        const dim = mkSprite(panel, 1700, 1100, 0, 0, cc.color(0, 0, 0), 130);
        dim.on(cc.Node.EventType.TOUCH_START, (e: cc.Event) => e.stopPropagation());
        const box = mkSprite(panel, 540, 340, 0, 0, cc.color(12, 14, 30), 245);
        mkSprite(panel, 540, 7, 0, 167, accent, 255);
        mkSprite(panel, 540, 3, 0, -170, accent, 160);

        const titleLb = this.makeLabel(panel, 0, 118, 38, accent);
        titleLb.string = title;
        for (let i = 0; i < lines.length; i++) {
            const lb = this.makeLabel(panel, 0, 52 - i * 36, 19, cc.color(235, 240, 255));
            lb.string = lines[i];
        }

        const bw = 170;
        const startX = -((buttons.length - 1) * (bw + 20)) / 2;
        for (let i = 0; i < buttons.length; i++) {
            const b = mkSprite(panel, bw, 48, startX + i * (bw + 20), -118, cc.color(24, 34, 76), 255);
            const lb = this.makeLabel(b, 0, 0, 18, cc.color(235, 240, 255));
            lb.string = buttons[i].text;
            const cb = buttons[i].cb;
            b.on(cc.Node.EventType.TOUCH_END, (e: cc.Event) => {
                e.stopPropagation();
                Sfx.play("click", 0.8);
                cb();
            });
        }

        // pop-in animation
        panel.scale = 0.7;
        panel.opacity = 0;
        cc.tween(panel)
            .to(0.25, { scale: 1, opacity: 255 }, { easing: "backOut" })
            .start();
    }

    private buildGameOverPanel(lines: string[]) {
        this.state = "gameover";
        this.unscheduleAllCallbacks();
        if (this.isRhythmLevel()) Sfx.stopBgm();
        this.timeScale = 1;
        this.slowT = 0;
        if (this.slowOverlay) this.slowOverlay.opacity = 0;
        this.msgLabel.node.color = cc.color(235, 240, 255);
        this.setMsg("", "");
        this.scheduleOnce(() => {
            this.buildResultPanel(
                "GAME OVER",
                cc.color(255, 90, 100),
                lines,
                [
                    { text: "RESTART", cb: () => this.fullRestart() },
                    { text: "MENU", cb: () => Fx.fadeTo("Menu", this.hud) }
                ]);
        }, 0.45);
    }

    // ---------- callbacks from Player ----------

    private isInRollBonusWindow(): boolean {
        if (!this.isJumpFlipRhythm() || !this.level || !this.level.rhythm) return false;
        const rolls: any[] = (this.level.rhythm as any).rolls || [];
        if (!rolls.length) return false;
        const t = Sfx.getMusicTime();
        return rolls.some(r => t >= Number(r.start) && t <= Number(r.end));
    }

    onRhythmSurfaceHit(x: number, y: number) {
        if (!this.isJumpFlipRhythm() || this.state !== "run") return;
        if (!this.isInRollBonusWindow()) return;
        this.rhythmScore += 100;
        Fx.popup(this.world, x, y + 34, "+100", cc.color(127, 247, 255));
        Fx.rhythmFlip(this.world, x, y);
        this.updateRhythmHud();
    }

    onCrystal() {
        this.crystalsTaken++;
        Sfx.play("crystal", 0.7);
        this.refreshHud();
    }

    onDeath(dead: Player) {
        if (this.state !== "run") return;
        this.deaths++;
        this.health = Math.max(0, this.health - 1);
        Sfx.play("death", 0.8);
        // hit feel: brief hit-stop + camera shake
        this.hitStopT = 0.09;
        this.timeScale = 0.05;
        this.shakeT = 0.35;
        this.refreshHud();

        if (this.health <= 0) {
            if (this.endless) {
                this.endlessGameOver();
                return;
            }
            const lines = this.isRhythmLevel()
                ? [this.rhythmSummary()].concat(this.rhythmBattleLines()).concat(["TIME   " + this.formatTime(this.time), "HEALTH   0 / " + this.maxHealth])
                : [
                    "CRYSTALS   " + this.crystalsTaken + " / " + this.level.totalCrystals,
                    "TIME   " + this.formatTime(this.time),
                    "HEALTH   0 / " + this.maxHealth
                ];
            this.buildGameOverPanel(lines);
            return;
        }

        const survivor = this.anyAlive();
        if (survivor) {
            // partner carries on; camera follows them, dead player revives in 3s
            const follow = this.cameraNode.getComponent(CameraFollow);
            if (follow) follow.setTarget(survivor.node);
            this.scheduleOnce(() => {
                const s = this.anyAlive();
                if (this.state === "run" && s) {
                    dead.respawnAt(s.node.x - 50, s.node.y, s.getGravityDir());
                    this.refreshHud();
                }
            }, 3);
            return;
        }

        // everyone is down
        if (this.endless) {
            this.state = "dead";
            this.unscheduleAllCallbacks();
            this.setMsg("CRASHED", "HEALTH " + this.health + " / " + this.maxHealth);
            this.scheduleOnce(() => {
                GameData.carriedHealth = this.health;
                Fx.fadeTo("Game", this.hud);
            }, 0.8);
            return;
        }
        if (this.isRhythmLevel()) {
            this.state = "dead";
            this.unscheduleAllCallbacks();
            Sfx.stopBgm();
            this.msgLabel.node.color = cc.color(255, 90, 100);
            this.setMsg("LIFE LOST", "HEALTH " + this.health + " / " + this.maxHealth);
            this.scheduleOnce(() => {
                this.msgLabel.node.color = cc.color(235, 240, 255);
                this.respawnAll();
                this.state = "ready";
                this.setMsg("PRESS RHYTHM KEY TO START", this.controlsHint());
            }, 1.0);
            return;
        }
        // brief fail screen, then auto-retry to keep the rhythm going
        this.state = "dead";
        this.unscheduleAllCallbacks();
        this.msgLabel.node.color = cc.color(255, 90, 100);
        this.setMsg("LIFE LOST", "HEALTH " + this.health + " / " + this.maxHealth);
        this.scheduleOnce(() => {
            this.msgLabel.node.color = cc.color(235, 240, 255);
            this.setMsg("", "");
            this.respawnAll();
            this.state = "run";
        }, 0.9);
    }

    private anyAlive(): Player {
        for (const p of this.players) {
            if (p.alive) return p;
        }
        return null;
    }

    onWin(winner?: Player) {
        if (this.state !== "run") return;
        this.state = "win";
        this.unscheduleAllCallbacks();
        Sfx.play("win", 0.9);
        if (this.isRhythmLevel()) Sfx.stopBgm();
        // win animation: portal sucks EVERY living runner in (in 2P the
        // partner's physics freeze on the state change, so animate them too)
        Fx.confetti(this.world, this.level.goal.x, this.level.goal.y || 0);
        for (const p of this.players) {
            const isWinner = p === winner;
            if (!isWinner && !p.alive) continue; // died earlier: nothing to animate
            p.alive = false; // stop the partner's physics as well
            if (!p.node || !p.node.isValid) continue;
            p.node.stopAllActions();
            cc.tween(p.node)
                .delay(isWinner ? 0 : 0.1)
                .to(0.55, { x: this.level.goal.x, y: this.level.goal.y || 0, scale: 0, angle: 360 }, { easing: "sineIn" })
                .start();
        }
        const custom = GameData.currentLevel === 0;
        const pathLevel = !!GameData.currentLevelPath;
        const rhythm = this.isRhythmLevel();
        if (!custom && !pathLevel && !rhythm) {
            GameData.unlockNext(GameData.currentLevel);
            Fb.syncUp();
        }
        const last = pathLevel || rhythm || (!custom && GameData.currentLevel >= GameData.MAX_LEVEL);
        this.setMsg("", "");
        const lines = rhythm
            ? [this.rhythmSummary()].concat(this.rhythmBattleLines()).concat(["TIME   " + this.formatTime(this.time)])
            : [
                "CRYSTALS   " + this.crystalsTaken + " / " + this.level.totalCrystals,
                "TIME   " + this.formatTime(this.time),
                "HEALTH   " + this.health + " / " + this.maxHealth
            ];
        const buttons = custom
            ? [{ text: "EDITOR (SPACE)", cb: () => this.proceedAfterWin() },
               { text: "MENU (ESC)", cb: () => Fx.fadeTo("Menu", this.hud) }]
            : last
            ? (pathLevel || rhythm
                ? [{ text: "MENU", cb: () => this.proceedAfterWin() }]
                : [{ text: "ENDLESS", cb: () => this.proceedAfterWin() },
                   { text: "MENU", cb: () => Fx.fadeTo("Menu", this.hud) }])
            : [{ text: "NEXT (SPACE)", cb: () => this.proceedAfterWin() },
               { text: "MENU (ESC)", cb: () => Fx.fadeTo("Menu", this.hud) }];
        // let the suck-into-portal animation play before the panel pops
        this.scheduleOnce(() => {
            this.buildResultPanel(
                rhythm ? "SONG CLEAR!" : last ? "YOU ESCAPED ASTRA-9!" : "LEVEL CLEAR!",
                cc.color(255, 181, 74), lines, buttons);
        }, 0.65);
    }

    private proceedAfterWin() {
        if (this.endless) {
            Fx.fadeTo("Game", this.hud); // retry a fresh run
        } else if (GameData.currentLevel === 0) {
            Fx.fadeTo("Editor", this.hud);
        } else if (GameData.currentLevelPath) {
            Fx.fadeTo("Menu", this.hud);
        } else if (GameData.currentLevel < GameData.MAX_LEVEL) {
            GameData.currentLevel++;
            Fx.fadeTo("Game", this.hud);
        } else {
            GameData.currentLevelPath = "";
            GameData.currentLevel = -1;
            Fx.fadeTo("Game", this.hud);
        }
    }

    // ---------- per-frame ----------

    private currentLivePayload(me: Player): any {
        const fight = this.isRhythmFightOnlineBattle();
        const now = Fb.serverNow();
        return {
            x: Math.round(me.node.x),
            y: Math.round(me.node.y),
            sy: me.node.scaleY < 0 ? -1 : 1,
            col: GameData.settings.onlineCollide ? 1 : 0,
            sk: me.index === 0 ? (GameData.settings.skin1 || 0) : (typeof GameData.settings.skin2 === "number" ? GameData.settings.skin2 : 1),
            room: GameData.roomCode || null,
            lv: this.liveLevelKey(),
            n: Fb.userName(),
            score: this.isRhythmLevel() ? this.rhythmScore : 0,
            combo: this.isRhythmLevel() ? this.rhythmCombo : 0,
            mode: this.isRhythmLevel() ? "rhythm" : "runner",
            atkSeq: fight ? this.rhythmAttackSeq : 0,
            atkType: fight ? this.rhythmAttackType : "",
            atkAt: fight ? this.rhythmAttackAt : 0,
            t: now
        };
    }

    private pushLiveNow() {
        if (!this.liveOn || !Fb.user()) return;
        const me = this.anyAlive();
        if (!me) return;
        Fb.liveSet(this.currentLivePayload(me));
    }

    update(dt: number) {
        // keep HUD glued to the camera viewport
        if (this.hud && this.cameraNode) {
            this.hud.x = this.cameraNode.x;
            this.hud.y = this.cameraNode.y;
        }
        // hit feel timers (run on real time, even outside the run state)
        if (this.hitStopT > 0) {
            this.hitStopT -= dt;
            if (this.hitStopT <= 0) this.timeScale = this.slowT > 0 ? 0.55 : 1;
        }
        if (this.shakeT > 0) {
            this.shakeT -= dt;
            this.cameraNode.y = this.shakeT <= 0 ? 0
                : (Math.random() * 2 - 1) * 16 * (this.shakeT / 0.35);
        }
        // room race countdown (server clock)
        if (this.state === "ready" && this.roomT0 > 0) {
            const remain = (this.roomT0 - Fb.serverNow()) / 1000;
            if (remain <= 0) {
                this.roomT0 = 0;
                if (this.isRhythmLevel()) {
                    this.startRhythmRun();
                } else {
                    this.state = "run";
                    this.setMsg("", "");
                    Sfx.play("power", 0.9);
                }
            } else {
                this.msgLabel.string = remain <= 3 ? remain.toFixed(1) : "GET READY";
            }
        }
        // online ghosts: smooth remote players and broadcast our position
        if (this.liveOn) {
            for (const uid in this.ghosts) {
                const g = this.ghosts[uid];
                const lead = Math.min(0.16, Math.max(0, (Date.now() - g.rxT) / 1000));
                const px = g.tx + Math.max(-260, Math.min(260, g.gvx || 0)) * lead;
                const py = g.ty + Math.max(-520, Math.min(520, g.gvy || 0)) * lead;
                const dist = Math.abs(px - g.node.x) + Math.abs(py - g.node.y);
                if (dist > 260) {
                    g.node.setPosition(px, py);
                } else {
                    const k = Math.min(1, 16 * dt);
                    g.node.x += (px - g.node.x) * k;
                    g.node.y += (py - g.node.y) * k;
                }
                g.node.scaleY = g.tsy;
                const nameN = g.node.getChildByName("name");
                if (nameN) nameN.scaleY = g.tsy; // keep the name upright
            }
            if (this.state === "run" && Fb.user()) {
                this.liveAccum += dt;
                if (this.liveAccum >= 0.06) {
                    this.liveAccum = 0;
                    const me = this.anyAlive();
                    if (me) {
                        Fb.liveSet(this.currentLivePayload(me));
                    }
                }
            }
        }
        // animate field rotation at a constant rate, and re-anchor every frame
        // because the pivot (camera focus) keeps moving
        if (this.rotCurrent !== this.rotTarget) {
            const step = 110 * dt;
            const diff = this.rotTarget - this.rotCurrent;
            if (Math.abs(diff) <= step) this.rotCurrent = this.rotTarget;
            else this.rotCurrent += diff > 0 ? step : -step;
        }
        if (this.world) this.applyWorldRotation();
        if (this.state !== "run") return;

        this.time += dt;
        this.timeLabel.string = this.formatTime(this.time);
        if (this.isRhythmLevel()) {
            this.updateRhythmFightEffects(dt);
            this.updateRhythm();
            this.updateRhythmAi(dt);
        }

        // endless: ramp speed, track distance, stream chunks ahead / drop behind
        if (this.endless) {
            this.level.speed = this.endlessBaseSpeed() + Math.min(240, this.distPx / 80);
            const lead = this.anyAlive();
            if (lead && lead.node.x > this.distPx) this.distPx = lead.node.x;
            this.distLabel.string = Math.floor(this.distPx / 10) + "m   BEST " + GameData.getBestDist() + "m";
            const camX = this.cameraNode.x;
            while (this.gen.getX() < camX + 1700) {
                const frag = this.gen.next(this.level.speed, this.distPx);
                this.appendChunk(frag, this.gen.getX());
            }
            while (this.chunks.length > 0 && this.chunks[0].endX < camX - 900) {
                this.dropChunk(this.chunks.shift());
            }
        }

        // slow-motion timer
        if (this.slowT > 0) {
            this.slowT -= dt;
            if (this.slowT <= 0) {
                this.timeScale = 1;
                this.slowOverlay.opacity = 0;
            }
        }

        // patrol drones oscillate on a fixed deterministic clock
        this.enemyT += dt * this.timeScale;
        for (const e of this.level.enemies) {
            const off = Math.sin((this.enemyT + e.phase) * Math.PI * 2 / e.period) * e.range;
            if (e.axis === "x") e.node.x = e.x0 + off;
            else e.node.y = e.y0 + off;
        }

        // piston bands: pow-shaped half-wave keeps them retracted >50% of the
        // cycle so they can be timed (or ridden while extending)
        for (const m of this.level.movers) {
            const s = Math.sin((this.enemyT + m.phase) * Math.PI * 2 / m.period);
            const off = s > 0 ? m.amp * Math.pow(s, 1.2) : 0;
            const d = m.dir * off;
            m.rect.y = m.baseY + d;
            for (let i = 0; i < m.nodes.length; i++) {
                m.nodes[i].y = m.baseYs[i] + d;
            }
        }

        // rotation zones track the leading living player
        const lead = this.anyAlive();
        if (lead) this.applyRotationForX(lead.node.x, false);

        // 2P: players collide elastically with each other
        if (this.bumpCd > 0) this.bumpCd -= dt;
        if (GameData.players === 2 && this.players.length === 2) {
            this.playersCollide();
        }
        // online: collide with remote players who also opted in
        if (GameData.settings.onlineCollide && !(this.rhythmSplitBattle && this.isRhythmLevel())) {
            this.ghostsCollide();
        }
    }

    // Local-side elastic response against remote players' interpolated
    // bodies. Both clients run the same symmetric logic, so the pair
    // separates consistently; only the local player is ever moved here.
    private ghostsCollide() {
        for (const uid in this.ghosts) {
            const g = this.ghosts[uid];
            if (!g.col || !g.node.isValid) continue;
            for (const p of this.players) {
                if (!p.alive) continue;
                const n = p.node;
                const px = 34 - Math.abs(n.x - g.node.x);
                if (px <= 0) continue;
                const py = 36 - Math.abs(n.y - g.node.y);
                if (py <= 0) continue;
                if (py <= px) {
                    const dir = n.y >= g.node.y ? 1 : -1;
                    n.y += dir * py;
                    p.setVelY((g.gvy || 0) * 0.9 + dir * 60);
                } else {
                    const dirx = n.x >= g.node.x ? 1 : -1;
                    n.x += dirx * px;
                    p.addPushX(dirx * 160);
                }
                if (this.bumpCd <= 0) {
                    this.bumpCd = 0.15;
                    Sfx.play("click", 0.5);
                    Fx.crystal(this.world, (n.x + g.node.x) / 2, (n.y + g.node.y) / 2, cc.color(200, 220, 255));
                }
            }
        }
    }

    // Equal-mass arcade elastic collision between the two runners:
    // separate along the shallow axis, swap vertical velocities (x0.9
    // restitution) or trade a decaying horizontal shove.
    private playersCollide() {
        const a = this.players[0];
        const b = this.players[1];
        if (!a.alive || !b.alive) return;
        const an = a.node;
        const bn = b.node;
        const W = 32, H = 36;
        const px = W - Math.abs(an.x - bn.x);
        if (px <= 0) return;
        const py = H - Math.abs(an.y - bn.y);
        if (py <= 0) return;

        if (py <= px) {
            const dir = an.y >= bn.y ? 1 : -1;
            an.y += dir * py / 2;
            bn.y -= dir * py / 2;
            const va = a.getVelY();
            const vb = b.getVelY();
            a.setVelY(vb * 0.9);
            b.setVelY(va * 0.9);
        } else {
            const dirx = an.x >= bn.x ? 1 : -1;
            an.x += dirx * px / 2;
            bn.x -= dirx * px / 2;
            a.addPushX(dirx * 160);
            b.addPushX(-dirx * 160);
        }
        if (this.bumpCd <= 0) {
            this.bumpCd = 0.15;
            Sfx.play("click", 0.5);
            Fx.crystal(this.world, (an.x + bn.x) / 2, (an.y + bn.y) / 2, cc.color(200, 220, 255));
        }
    }
}
