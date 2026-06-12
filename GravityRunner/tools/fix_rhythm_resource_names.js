// Fix rhythm resource names for Cocos Creator web builds.
// Run from the GravityRunner project root:
//   node tools/fix_rhythm_resource_names.js --clean-cache
// It renames '#Uxxxx' / Unicode resource filenames into stable ASCII 'uxxxx'
// names, updates rhythm_catalog.json and level JSON audio fields, and patches
// GameMgr.ts / Sfx.ts to load old room paths as fallbacks.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const RES = path.join(ROOT, 'assets', 'resources');
const RHYTHM_DIR = path.join(RES, 'levels', 'rhythm');
const AUDIO_DIR = path.join(RES, 'audio');

function exists(p) { return fs.existsSync(p); }
function readText(p) { return fs.readFileSync(p, 'utf8'); }
function writeText(p, s) { fs.writeFileSync(p, s, 'utf8'); }

function safeName(s) {
  s = String(s || '').replace(/#U([0-9a-fA-F]{4})/g, (_, h) => 'u' + String(h).toLowerCase());
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c > 127 ? ('u' + c.toString(16).padStart(4, '0')) : s.charAt(i);
  }
  return out;
}

function renameBadFiles(dir) {
  if (!exists(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  // Longest first keeps .json.meta and .ogg.meta easy to read in logs.
  files.sort((a, b) => b.length - a.length);
  let changed = 0;
  for (const name of files) {
    const next = safeName(name);
    if (next === name) continue;
    const from = path.join(dir, name);
    const to = path.join(dir, next);
    if (exists(to)) {
      const a = fs.statSync(from).size;
      const b = fs.statSync(to).size;
      if (a === b) {
        fs.unlinkSync(from);
        console.log('[remove duplicate]', path.relative(ROOT, from));
      } else {
        console.warn('[collision: kept both, please inspect]', path.relative(ROOT, from), '->', path.relative(ROOT, to));
      }
    } else {
      fs.renameSync(from, to);
      console.log('[rename]', path.relative(ROOT, from), '->', path.relative(ROOT, to));
    }
    changed++;
  }
  return changed;
}

function updateCatalog() {
  const cat = path.join(RES, 'rhythm_catalog.json');
  if (!exists(cat)) return 0;
  const data = JSON.parse(readText(cat));
  let changed = 0;
  if (Array.isArray(data.songs)) {
    for (const song of data.songs) {
      if (song.id) {
        const n = safeName(song.id);
        if (n !== song.id) { song.id = n; changed++; }
      }
      if (Array.isArray(song.difficulties)) {
        for (const d of song.difficulties) {
          if (d.path) {
            const n = safeName(d.path);
            if (n !== d.path) { d.path = n; changed++; }
          }
        }
      }
    }
  }
  if (changed) writeText(cat, JSON.stringify(data, null, 2) + '\n');
  return changed;
}

function updateLevelJsons() {
  if (!exists(RHYTHM_DIR)) return 0;
  let changed = 0;
  for (const name of fs.readdirSync(RHYTHM_DIR)) {
    if (!name.endsWith('.json')) continue;
    const p = path.join(RHYTHM_DIR, name);
    let data;
    try { data = JSON.parse(readText(p)); } catch (e) { console.warn('[bad json]', p, e.message); continue; }
    if (data && data.rhythm) {
      for (const k of ['audio', 'source']) {
        if (data.rhythm[k]) {
          const n = safeName(data.rhythm[k]);
          if (n !== data.rhythm[k]) { data.rhythm[k] = n; changed++; }
        }
      }
    }
    if (changed) writeText(p, JSON.stringify(data, null, 2) + '\n');
  }
  return changed;
}

function patchGameMgr() {
  const p = path.join(ROOT, 'assets', 'scripts', 'GameMgr.ts');
  if (!exists(p)) return false;
  let text = readText(p);
  if (text.includes('private safeResourcePath(path: string)')) return false;
  const block = `    private cocosEscapedResourcePath(path: string): string {
        // Legacy fallback: older rooms / imported assets may still use #Uxxxx.
        let out = "";
        for (let i = 0; i < path.length; i++) {
            const c = path.charCodeAt(i);
            out += c > 127 ? ("#U" + c.toString(16).padStart(4, "0")) : path.charAt(i);
        }
        return out;
    }

    private safeResourcePath(path: string): string {
        // Stable resource names: avoid '#', because it can behave like a URL
        // fragment in web builds.  #U5343 and Unicode both map to u5343.
        const s = String(path || "").replace(/#U([0-9a-fA-F]{4})/g, (_m, h) => "u" + String(h).toLowerCase());
        let out = "";
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            out += c > 127 ? ("u" + c.toString(16).padStart(4, "0")) : s.charAt(i);
        }
        return out;
    }

    private resourcePathCandidates(path: string): string[] {
        const norm = this.normalizeResourcePath(path);
        const safe = this.safeResourcePath(norm);
        const esc = this.cocosEscapedResourcePath(norm);
        const arr = [norm, safe, esc];
        const out: string[] = [];
        for (const p of arr) if (p && out.indexOf(p) < 0) out.push(p);
        return out;
    }
`;
  const re = /    private cocosEscapedResourcePath\(path: string\): string \{[\s\S]*?\n    private resourcePathCandidates\(path: string\): string\[\] \{[\s\S]*?\n    \}\n/;
  if (!re.test(text)) {
    console.warn('[warn] Could not auto-patch GameMgr.ts. Patch it manually if old room paths fail.');
    return false;
  }
  text = text.replace(re, block);
  writeText(p, text);
  return true;
}

function patchSfx() {
  const p = path.join(ROOT, 'assets', 'scripts', 'Sfx.ts');
  if (!exists(p)) return false;
  let text = readText(p);
  if (text.includes('private static safeResourceName(name: string)')) return false;
  const block = `    private static escapeResourceName(name: string): string {
        let out = "";
        for (let i = 0; i < name.length; i++) {
            const c = name.charCodeAt(i);
            out += c > 127 ? ("#U" + c.toString(16).padStart(4, "0")) : name.charAt(i);
        }
        return out;
    }

    private static safeResourceName(name: string): string {
        const s = String(name || "").replace(/#U([0-9a-fA-F]{4})/g, (_m, h) => "u" + String(h).toLowerCase());
        let out = "";
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            out += c > 127 ? ("u" + c.toString(16).padStart(4, "0")) : s.charAt(i);
        }
        return out;
    }

    private static musicCandidates(name: string): string[] {
        const norm = String(name || "bgm_menu").trim().replace(/^audio\\//, "").replace(/\\.(ogg|wav|mp3)$/i, "");
        const safe = Sfx.safeResourceName(norm);
        const esc = Sfx.escapeResourceName(norm);
        const arr = [norm, safe, esc];
        const out: string[] = [];
        for (const p of arr) if (p && out.indexOf(p) < 0) out.push(p);
        return out;
    }
`;
  const re = /    private static escapeResourceName\(name: string\): string \{[\s\S]*?\n    private static musicCandidates\(name: string\): string\[\] \{[\s\S]*?\n    \}\n/;
  if (!re.test(text)) {
    console.warn('[warn] Could not auto-patch Sfx.ts. Patch it manually if music fallback fails.');
    return false;
  }
  text = text.replace(re, block);
  writeText(p, text);
  return true;
}

function verify() {
  const badFiles = [];
  for (const dir of [RHYTHM_DIR, AUDIO_DIR]) {
    if (!exists(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (/#U|[^\x00-\x7F]/.test(f)) badFiles.push(path.join(dir, f));
  }

  const missingLevels = [];
  const cat = path.join(RES, 'rhythm_catalog.json');
  if (exists(cat)) {
    const data = JSON.parse(readText(cat));
    for (const song of data.songs || []) {
      for (const d of song.difficulties || []) {
        if (d.path && !exists(path.join(RES, d.path + '.json'))) missingLevels.push(d.path);
      }
    }
  }

  const missingAudio = [];
  if (exists(RHYTHM_DIR)) {
    for (const f of fs.readdirSync(RHYTHM_DIR)) {
      if (!f.endsWith('.json')) continue;
      const data = JSON.parse(readText(path.join(RHYTHM_DIR, f)));
      const a = data && data.rhythm && data.rhythm.audio;
      if (a && !['.ogg', '.wav', '.mp3'].some(ext => exists(path.join(AUDIO_DIR, a + ext)))) missingAudio.push(`${f}: ${a}`);
    }
  }

  console.log('\nverify: bad #U/unicode filenames =', badFiles.length);
  console.log('verify: missing catalog levels =', missingLevels.length);
  console.log('verify: missing audio files =', missingAudio.length);
  if (badFiles.length) console.log(badFiles.slice(0, 10).map(p => '  ' + path.relative(ROOT, p)).join('\n'));
  if (missingLevels.length) console.log(missingLevels.slice(0, 10).map(x => '  ' + x).join('\n'));
  if (missingAudio.length) console.log(missingAudio.slice(0, 10).map(x => '  ' + x).join('\n'));
}

function rmrf(p) {
  if (exists(p)) fs.rmSync(p, { recursive: true, force: true });
}

console.log('Project:', ROOT);
if (!exists(RES)) {
  console.error('ERROR: run this from GravityRunner project root. Missing assets/resources');
  process.exit(1);
}
const renamed = renameBadFiles(RHYTHM_DIR) + renameBadFiles(AUDIO_DIR);
const catalog = updateCatalog();
const levels = updateLevelJsons();
const gm = patchGameMgr();
const sfx = patchSfx();
console.log('\nchanged files renamed:', renamed);
console.log('catalog entries updated:', catalog);
console.log('level json fields updated:', levels);
console.log('GameMgr patched:', gm);
console.log('Sfx patched:', sfx);

if (process.argv.includes('--clean-cache')) {
  rmrf(path.join(ROOT, 'library'));
  rmrf(path.join(ROOT, 'temp'));
  console.log('removed generated Cocos cache: library/, temp/');
}
verify();
console.log('\nNext: open Cocos Creator once to reimport assets, then rebuild / deploy.');
