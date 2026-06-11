#!/usr/bin/env node
/*
 * Import one TJA song into the Rhythm Mode song select.
 *
 * Auto-import every .tja in tools/charts:
 *   node tools/import_tja_song.js --all
 *
 * Example:
 *   node tools/import_tja_song.js \
 *     --id 千本桜 \
 *     --title "千本桜" \
 *     --tja tools/charts/千本桜.tja \
 *     --audio tools/charts/千本桜.ogg
 *
 * Notes:
 * - The song id may contain Japanese/Chinese characters.
 * - The importer only converts difficulties that actually exist in the TJA.
 * - COURSE:0/1/2/3/4 are treated as Easy/Normal/Hard/Oni/Edit.
 */
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const cp = require('child_process');
const crypto = require('crypto');

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes('--' + name); }

if (has('all') || has('scan')) {
  const pass = process.argv.slice(2).filter(x => x !== '--all' && x !== '--scan');
  cp.execFileSync(process.execPath, [path.join('tools', 'import_all_tja_songs.js'), ...pass], { stdio: 'inherit' });
  process.exit(0);
}

function cleanId(s) {
  // Keep Unicode song ids such as 千本桜. Only remove characters that are bad for
  // Windows/macOS/Linux filenames or Cocos resource paths.
  return String(s || '')
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+$/g, '')
    .replace(/^_+|_+$/g, '') || 'song';
}

function writeJsonMeta(file) {
  const meta = file + '.meta';
  if (fs.existsSync(meta)) return;
  fs.writeFileSync(meta, JSON.stringify({
    ver: '1.0.2',
    uuid: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    importer: 'json',
    subMetas: {}
  }, null, 2));
}

function readTextLoose(file) {
  const buf = fs.readFileSync(file);
  for (const enc of ['utf-8', 'shift_jis', 'windows-31j']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf).replace(/^\uFEFF/, '').replace(/\r/g, '');
    } catch (e) {
      // try next encoding
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/^\uFEFF/, '').replace(/\r/g, '');
}
function stripComment(line) {
  const i = line.indexOf('//');
  return (i >= 0 ? line.slice(0, i) : line).trim();
}
function firstHeader(text, key) {
  const want = key.toUpperCase();
  for (const raw of text.split('\n')) {
    const line = stripComment(raw);
    if (!line) continue;
    if (line.toUpperCase() === '#START') break;
    const m = line.match(/^([^:#]+)\s*:\s*(.*)$/);
    if (m && m[1].trim().toUpperCase() === want) return m[2].trim();
  }
  return '';
}
function canonicalCourseName(v) {
  const s = String(v || '').trim();
  const k = s.toLowerCase();
  if (k === '0' || k === 'easy' || k === 'kantan' || k === 'かんたん') return 'Easy';
  if (k === '1' || k === 'normal' || k === 'futsuu' || k === 'ふつう') return 'Normal';
  if (k === '2' || k === 'hard' || k === 'muzukashii' || k === 'むずかしい') return 'Hard';
  if (k === '3' || k === 'oni' || k === 'extreme' || k === 'おに' || k === '鬼') return 'Oni';
  if (k === '4' || k === 'edit' || k === 'ura' || k === 'inner' || k === 'uraoni' || k === '裏' || k === '裏譜面') return 'Edit';
  return s || 'Unknown';
}
function courseOrder(name) {
  const order = { Easy: 0, Normal: 1, Hard: 2, Oni: 3, Edit: 4 };
  return Object.prototype.hasOwnProperty.call(order, name) ? order[name] : 99;
}
function parseAvailableCourses(text) {
  const lines = text.split('\n');
  const courses = [];
  let globalCourse = null;
  let cur = null;
  let inChart = false;

  for (const raw of lines) {
    const line = stripComment(raw);
    if (!line) continue;
    const up = line.toUpperCase();
    const m = line.match(/^([^:#]+)\s*:\s*(.*)$/);

    if (up === '#START') {
      if (!cur) cur = { raw: globalCourse || 'Default', hasChart: false };
      inChart = true;
      continue;
    }
    if (inChart) {
      if (up === '#END') {
        cur.hasChart = true;
        courses.push(cur);
        cur = null;
        inChart = false;
      }
      continue;
    }
    if (m) {
      const key = m[1].trim().toUpperCase();
      const val = m[2].trim();
      if (key === 'COURSE') cur = { raw: val, hasChart: false };
      else if (key === 'COURSESTYLE') {
        // ignored; some TJAs include it near COURSE
      } else if (key === 'TITLE' && !cur) {
        // ignored
      }
      if (key === 'COURSE' && !cur) globalCourse = val;
    }
  }

  const seen = new Set();
  const out = [];
  for (const c of courses) {
    const name = canonicalCourseName(c.raw);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ raw: c.raw, name });
  }
  out.sort((a, b) => courseOrder(a.name) - courseOrder(b.name));
  return out;
}

const tja = arg('tja');
if (!tja) {
  console.error('Usage: node tools/import_tja_song.js --all   OR   node tools/import_tja_song.js --id song_id --title "Song Title" --tja chart.tja [--audio song.ogg]');
  process.exit(1);
}
if (!fs.existsSync(tja)) {
  console.error('TJA file not found:', tja);
  process.exit(1);
}

const text = readTextLoose(tja);
const id = cleanId(arg('id', path.basename(tja, path.extname(tja))));
const title = arg('title', firstHeader(text, 'TITLE') || path.basename(tja, path.extname(tja)));
const audio = arg('audio', '');
if (audio && !fs.existsSync(audio)) {
  console.error('Audio file not found:', audio);
  process.exit(1);
}

let available = parseAvailableCourses(text);
if (has('list-courses')) {
  console.log('Available courses:');
  for (const c of available) console.log(`- ${c.name} (COURSE:${c.raw})`);
  process.exit(0);
}
if (!available.length) {
  console.error('No playable #START/#END course found in this TJA:', tja);
  process.exit(1);
}

// Optional: import only one requested course.
const onlyCourse = arg('course', null);
if (onlyCourse) {
  const wanted = canonicalCourseName(onlyCourse);
  available = available.filter(c => c.name.toLowerCase() === wanted.toLowerCase() || String(c.raw).toLowerCase() === String(onlyCourse).toLowerCase());
  if (!available.length) {
    console.error('Requested course not found:', onlyCourse);
    console.error('Available:', parseAvailableCourses(text).map(c => `${c.name}(COURSE:${c.raw})`).join(', '));
    process.exit(1);
  }
}

const audioName = 'rhythm_' + id;
const root = process.cwd();
const outDir = path.join(root, 'GravityRunner', 'assets', 'resources', 'levels', 'rhythm');
fs.mkdirSync(outDir, { recursive: true });

const difficulties = [];
for (const courseInfo of available) {
  const label = courseInfo.name.toUpperCase();
  const lower = courseInfo.name.toLowerCase();
  const out = path.join(outDir, `${id}_${lower}.json`);
  const args = [
    path.join('tools', 'tja_to_level.js'),
    '--tja', tja,
    '--course', courseInfo.raw,
    '--out', out,
    '--audio-name', audioName,
    '--name', `${title} [${label}]`
  ];
  if (audio) args.push('--audio', audio);
  // Allow global tuning flags to pass through.
  for (const flag of [
    'px-per-beat', 'base-px-per-beat', 'bpm-spacing-factor', 'min-px-per-beat', 'max-px-per-beat', 'min-note-px',
    'floor-y', 'ceiling-y', 'track-thickness', 'jump-height',
    'min-note-gap', 'camera-lookahead', 'jump-hit-delay', 'flip-hit-delay',
    'jump-return-time', 'flip-travel-time', 'speed'
  ]) {
    const v = arg(flag, null);
    if (v !== null) args.push('--' + flag, v);
  }
  console.log(`Converting ${label} (COURSE:${courseInfo.raw}) ...`);
  cp.execFileSync(process.execPath, args, { stdio: 'inherit' });
  writeJsonMeta(out);
  difficulties.push({ name: label, path: `levels/rhythm/${id}_${lower}` });
}

const catalogPath = path.join(root, 'GravityRunner', 'assets', 'resources', 'rhythm_catalog.json');
let catalog = { songs: [] };
try {
  if (fs.existsSync(catalogPath)) catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
} catch (e) {
  catalog = { songs: [] };
}
if (!Array.isArray(catalog.songs)) catalog.songs = [];
catalog.songs = catalog.songs.filter(s => s.id !== id);
catalog.songs.push({ id, title, difficulties });
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
writeJsonMeta(catalogPath);

console.log('Updated', catalogPath);
console.log('Imported song id:', id);
console.log('Imported difficulties:', difficulties.map(d => d.name).join(', '));
console.log('Done. Reopen Cocos Creator so it imports the new resources, then play from Rhythm Mode.');
