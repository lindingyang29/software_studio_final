#!/usr/bin/env node
/*
 * Import every .tja in a charts folder into Rhythm Mode.
 *
 * Usage:
 *   node tools/import_all_tja_songs.js
 *   node tools/import_all_tja_songs.js --charts-dir tools/charts
 *
 * It looks for audio in this order:
 *   1. WAVE:xxx inside the TJA
 *   2. same basename: song.ogg / song.mp3 / song.wav
 */
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const cp = require('child_process');

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes('--' + name); }
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
function cleanId(s) {
  return String(s || '')
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+$/g, '')
    .replace(/^_+|_+$/g, '') || 'song';
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
function listTjaFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.tja$/i.test(ent.name)) out.push(p);
    }
  };
  walk(dir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
function findAudio(tja, text) {
  const dir = path.dirname(tja);
  const wave = firstHeader(text, 'WAVE');
  if (wave) {
    const p = path.resolve(dir, wave);
    if (fs.existsSync(p)) return p;
  }
  const base = path.join(dir, path.basename(tja, path.extname(tja)));
  for (const ext of ['.ogg', '.mp3', '.wav', '.m4a']) {
    const p = base + ext;
    if (fs.existsSync(p)) return p;
  }
  return '';
}

const chartsDir = arg('charts-dir', path.join('tools', 'charts'));
const tjas = listTjaFiles(chartsDir);
if (!tjas.length) {
  console.error('No .tja files found in:', chartsDir);
  process.exit(1);
}

console.log(`Found ${tjas.length} TJA file(s) in ${chartsDir}`);

if (!has('append')) {
  const catalogPath = path.join(process.cwd(), 'GravityRunner', 'assets', 'resources', 'rhythm_catalog.json');
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify({ songs: [] }, null, 2));
  console.log('Rebuilding rhythm catalog from charts folder. Use --append to keep existing catalog entries.');
}

let ok = 0;
let failed = 0;
for (const tja of tjas) {
  const text = readTextLoose(tja);
  const base = path.basename(tja, path.extname(tja));
  const id = cleanId(base);
  const headerTitle = firstHeader(text, 'TITLE');
  const title = headerTitle && !/[\uFFFD]/.test(headerTitle) ? headerTitle : base;
  const audio = findAudio(tja, text);
  const args = [
    path.join('tools', 'import_tja_song.js'),
    '--id', id,
    '--title', title,
    '--tja', tja
  ];
  if (audio) args.push('--audio', audio);

  for (const flag of [
    'px-per-beat', 'base-px-per-beat', 'bpm-spacing-factor', 'min-px-per-beat', 'max-px-per-beat', 'min-note-px',
    'floor-y', 'ceiling-y', 'track-thickness', 'jump-height',
    'min-note-gap', 'camera-lookahead', 'jump-hit-delay', 'flip-hit-delay',
    'jump-return-time', 'flip-travel-time', 'speed'
  ]) {
    const v = arg(flag, null);
    if (v !== null) args.push('--' + flag, v);
  }

  console.log('\n==============================');
  console.log(`Importing: ${title}`);
  console.log(`TJA:   ${tja}`);
  console.log(`Audio: ${audio || '(not found; level will still import)'}`);
  try {
    cp.execFileSync(process.execPath, args, { stdio: 'inherit' });
    ok++;
  } catch (e) {
    failed++;
    console.error('Failed to import:', tja);
    if (!has('keep-going')) break;
  }
}

console.log('\n==============================');
console.log(`Finished. Success: ${ok}, failed: ${failed}`);
console.log('Reopen Cocos Creator so it imports the generated resources.');
if (failed) process.exit(1);
