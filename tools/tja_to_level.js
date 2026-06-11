#!/usr/bin/env node
/*
 * Convert a Taiko no Tatsujin .tja chart into a Gravity Flip Runner rhythm level.
 *
 * Current rhythm design: two-rail jump / flip rhythm runner
 * - Red (Don) notes become light-jump targets on the current rail.
 * - Blue (Ka) notes become gravity-flip targets on the opposite rail.
 * - Missing a note does not kill; it only breaks combo and lowers score.
 * - The converter delays each target's world-x position by the expected jump/flip
 *   travel time, so pressing on the beat makes the runner physically meet the dot.
 * - Horizontal speed is derived from BPM: speed = BPM * pxPerBeat / 60.
 *
 * Usage:
 *   node tools/tja_to_level.js --tja tools/charts/夏祭り.tja --audio tools/charts/夏祭り.ogg --course Oni --out GravityRunner/assets/resources/levels/level9.json --audio-name rhythm_summer
 */
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes('--' + name); }
function numArg(name, fallback) {
  const v = parseFloat(arg(name, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
}
function intArg(name, fallback) {
  const v = parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(v) ? v : fallback;
}
function readTextLoose(file) {
  const buf = fs.readFileSync(file);
  for (const enc of ['utf-8', 'shift_jis', 'windows-31j']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
    } catch (e) {
      // try next encoding
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/^\uFEFF/, '');
}
function stripComment(line) {
  const i = line.indexOf('//');
  return (i >= 0 ? line.slice(0, i) : line).trim();
}

function firstHeader(text, key) {
  const want = key.toUpperCase();
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = stripComment(raw);
    if (!line) continue;
    if (line.toUpperCase() === '#START') break;
    const m = line.match(/^([^:#]+)\s*:\s*(.*)$/);
    if (m && m[1].trim().toUpperCase() === want) return m[2].trim();
  }
  return '';
}
function findAudioForTja(tja, text) {
  const dir = path.dirname(tja);
  const wave = firstHeader(text, 'WAVE');
  if (wave) {
    const direct = path.resolve(dir, wave);
    if (fs.existsSync(direct)) return direct;
    // Case-insensitive fallback, useful on Linux when the TJA and actual file
    // use slightly different casing.
    const target = path.basename(wave).toLowerCase();
    if (fs.existsSync(dir)) {
      const hit = fs.readdirSync(dir).find(f => f.toLowerCase() === target);
      if (hit) return path.join(dir, hit);
    }
  }
  const base = path.join(dir, path.basename(tja, path.extname(tja)));
  for (const ext of ['.ogg', '.mp3', '.wav', '.m4a']) {
    const p = base + ext;
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function parseHeadersAndCourses(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const global = {};
  const courses = [];
  let cur = null;
  let inChart = false;

  for (let raw of lines) {
    let line = stripComment(raw);
    if (!line) continue;
    const up = line.toUpperCase();

    if (up === '#START') {
      if (!cur) {
        cur = { headers: Object.assign({}, global, { COURSE: 'Default' }), chart: [] };
        courses.push(cur);
      }
      inChart = true;
      continue;
    }
    if (inChart) {
      cur.chart.push(line);
      if (up === '#END') inChart = false;
      continue;
    }

    const m = line.match(/^([^:#]+)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1].trim().toUpperCase();
      const val = m[2].trim();
      if (key === 'COURSE') {
        cur = { headers: Object.assign({}, global, { COURSE: val }), chart: [] };
        courses.push(cur);
      } else if (cur) {
        cur.headers[key] = val;
      } else {
        global[key] = val;
      }
    }
  }
  return courses.filter(c => c.chart.length > 0);
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
function courseMatches(actual, wanted) {
  const a = String(actual || '').trim();
  const w = String(wanted || '').trim();
  if (!w) return false;
  return a.toLowerCase() === w.toLowerCase() || canonicalCourseName(a).toLowerCase() === canonicalCourseName(w).toLowerCase();
}
function chooseCourse(courses, wanted) {
  if (!courses.length) throw new Error('No playable #START/#END course found in this TJA.');
  if (!wanted) {
    const pref = ['Oni', 'Edit', 'Hard', 'Normal', 'Easy'];
    for (const p of pref) {
      const c = courses.find(x => courseMatches(x.headers.COURSE, p));
      if (c) return c;
    }
    return courses[0];
  }
  const c = courses.find(x => courseMatches(x.headers.COURSE, wanted));
  if (!c) throw new Error('Course not found: ' + wanted + '. Available: ' + courses.map(x => `${canonicalCourseName(x.headers.COURSE)}(COURSE:${x.headers.COURSE})`).join(', '));
  return c;
}
function parseChart(course) {
  let bpm = parseFloat(course.headers.BPM || '120') || 120;
  const offset = parseFloat(course.headers.OFFSET || '0') || 0;
  let measureNum = 1;
  let measureDen = 1;
  let scroll = 1;
  let gogo = false;
  let t = 0;
  let rollStart = null;
  const notes = [];
  const rolls = [];
  const bpmChanges = [{ time: 0, bpm: +bpm.toFixed(4) }];
  const measures = [];

  // TJA rule that matters here:
  //   - One comma closes one measure.
  //   - The number of numeric symbols inside that measure decides the subdivision.
  //     Example: 48 symbols in a 4/4 measure => each symbol is 1/48 measure
  //     = 1/12 beat, so charts with 12th / 24th feel are preserved.
  //   - Commands such as #BPMCHANGE / #MEASURE / #DELAY take effect at their
  //     current cursor position, not by guessing a fixed note grid.
  let measureTokens = [];
  let measureDigitCount = 0;

  function parseCommand(line) {
    const parts = line.trim().split(/\s+/);
    const cmd = (parts[0] || '').toUpperCase();
    const val = parts.slice(1).join(' ').trim();
    return { type: 'command', cmd, val, pos: measureDigitCount };
  }
  function pushDigit(ch) {
    if (/[0-9]/.test(ch)) {
      measureTokens.push({ type: 'digit', ch, pos: measureDigitCount });
      measureDigitCount++;
    }
  }
  function applyCommand(tok) {
    const cmd = tok.cmd;
    const val = tok.val;
    if (cmd === '#BPMCHANGE') {
      const x = parseFloat(val);
      if (Number.isFinite(x) && x > 0) {
        bpm = x;
        bpmChanges.push({ time: +(t - offset).toFixed(4), bpm: +bpm.toFixed(4) });
      }
    } else if (cmd === '#MEASURE') {
      const m = val.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
      if (m) {
        measureNum = parseFloat(m[1]) || 1;
        measureDen = parseFloat(m[2]) || 1;
      }
    } else if (cmd === '#DELAY') {
      const x = parseFloat(val);
      if (Number.isFinite(x)) t += x;
    } else if (cmd === '#SCROLL') {
      const x = parseFloat(val);
      if (Number.isFinite(x)) scroll = x;
    } else if (cmd === '#GOGOSTART') {
      gogo = true;
    } else if (cmd === '#GOGOEND') {
      gogo = false;
    }
  }
  function closeRoll(rawTime) {
    if (rollStart === null) return;
    const end = rawTime - offset;
    if (end > rollStart + 0.02) {
      rolls.push({ start: +rollStart.toFixed(4), end: +end.toFixed(4) });
    }
    rollStart = null;
  }
  function emitDigit(ch, rawTime, measureIndex, pos, total) {
    const time = rawTime - offset;
    if (ch === '8') {
      closeRoll(rawTime);
      return;
    }
    if (ch === '0') return;

    let kind = 'don';
    if (ch === '2' || ch === '4' || ch === '6') kind = 'ka';
    if (ch === '3' || ch === '4') kind = 'big';
    if (ch === '5' || ch === '6' || ch === '7') {
      kind = 'roll';
      if (rollStart === null) rollStart = time;
    }
    if (time < -0.001) return;
    notes.push({
      time: +time.toFixed(4),
      rawTime: +rawTime.toFixed(4),
      kind,
      code: ch,
      bpm: +bpm.toFixed(4),
      gogo,
      scroll,
      measure: measureIndex,
      indexInMeasure: pos,
      measureDivisions: total,
      measureNum,
      measureDen
    });
  }
  function flushMeasure() {
    if (!measureTokens.length) return;

    const total = measureDigitCount;
    // Commands before an empty / metadata-only measure still need to take effect.
    if (total <= 0) {
      for (const tok of measureTokens) if (tok.type === 'command') applyCommand(tok);
      measureTokens = [];
      measureDigitCount = 0;
      return;
    }

    const measureIndex = measures.length;
    const startTime = t;
    const beatPerCell = (4 * measureNum / measureDen) / total;
    let pos = 0;

    // Group commands by the subdivision index where they appear.
    const commandsAt = new Map();
    const digits = [];
    for (const tok of measureTokens) {
      if (tok.type === 'command') {
        const k = Math.max(0, Math.min(total, tok.pos | 0));
        if (!commandsAt.has(k)) commandsAt.set(k, []);
        commandsAt.get(k).push(tok);
      } else if (tok.type === 'digit') {
        digits.push(tok.ch);
      }
    }

    const applyAt = (k) => {
      const list = commandsAt.get(k);
      if (list) for (const tok of list) applyCommand(tok);
    };

    applyAt(0);
    for (let i = 0; i < total; i++) {
      if (i > 0) applyAt(i);
      emitDigit(digits[i] || '0', t, measureIndex, i, total);
      // This cell's duration uses the BPM active after commands at this cell.
      t += beatPerCell * 60 / bpm;
      pos = i + 1;
    }
    applyAt(total);
    measures.push({
      index: measureIndex,
      start: +(startTime - offset).toFixed(4),
      end: +(t - offset).toFixed(4),
      divisions: total,
      measure: `${measureNum}/${measureDen}`
    });

    measureTokens = [];
    measureDigitCount = 0;
  }

  for (const raw of course.chart) {
    let line = stripComment(raw);
    if (!line) continue;
    const up = line.toUpperCase();
    if (up === '#END') { flushMeasure(); break; }
    if (up.startsWith('#')) {
      measureTokens.push(parseCommand(line));
      continue;
    }

    // One measure may be split across multiple physical lines; only comma
    // closes the measure. This is important for long 6/4 measures split across
    // two lines in charts such as 幽玄ノ乱.
    for (const ch of line) {
      if (ch === ',') flushMeasure();
      else pushDigit(ch);
    }
  }
  flushMeasure();
  if (rollStart !== null) closeRoll(t);

  notes.sort((a, b) => a.time - b.time);
  notes.rolls = rolls.filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
  notes.bpmChanges = bpmChanges.filter((x, i, arr) => i === 0 || x.bpm !== arr[i - 1].bpm || Math.abs(x.time - arr[i - 1].time) > 1e-4);
  notes.measures = measures;
  return notes;
}

function noteColor(n) {
  if (n.kind === 'ka' || n.code === '2' || n.code === '4' || n.code === '6') return 'blue';
  return 'red';
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function adaptivePxPerBeat(bpm) {
  const base = numArg('base-px-per-beat', 190);
  const factor = numArg('bpm-spacing-factor', 0.75);
  const minPx = numArg('min-px-per-beat', 150);
  const maxPx = numArg('max-px-per-beat', 300);
  return Math.round(clamp(base + (bpm - 120) * factor, minPx, maxPx));
}

function makeRhythmTargets(notes, opts) {
  const speed = opts.speed;
  const startX = opts.startX;
  const xOf = t => Math.round(startX + t * speed);
  const floorCenterY = opts.floorY + 18;
  const ceilCenterY = opts.ceilingY - 18;
  const laneYs = [floorCenterY, ceilCenterY];
  const minNoteGap = opts.minNoteGap;
  const notesOut = [];

  let lastAcceptedTime = -1e9;
  let side = 'floor';
  let flipCount = 0;
  for (const n of notes) {
    if (n.kind === 'roll') continue;
    // By default we keep every playable TJA note.  If the caller explicitly
    // asks for --min-note-gap, only then simplify dense charts.
    if (minNoteGap > 0 && n.time - lastAcceptedTime < minNoteGap) continue;

    const color = noteColor(n);
    const action = color === 'blue' ? 'flip' : 'jump';
    if (action === 'flip') {
      side = side === 'floor' ? 'ceiling' : 'floor';
      flipCount++;
    }

    const isFloor = side === 'floor';
    // Keep the visual chart spacing faithful to the TJA timeline.
    // Older versions placed jump notes at time + jumpHitDelay and flip notes at
    // time + flipHitDelay.  Since those delays are different, equal musical
    // intervals such as triplets looked uneven whenever colors changed.
    // Use one shared lead time for every note, then let the player action
    // timing/physics decide whether the note is actually touched.
    const visualDelay = Number.isFinite(Number(opts.visualHitDelay))
      ? Number(opts.visualHitDelay)
      : Math.max(Number(opts.jumpHitDelay) || 0, Number(opts.flipHitDelay) || 0, 0);
    const x = xOf(n.time + visualDelay);
    const baseY = isFloor ? floorCenterY : ceilCenterY;
    const y = action === 'jump'
      ? baseY + (isFloor ? opts.jumpHeight : -opts.jumpHeight)
      : baseY;
    const voidY = side === 'floor' ? ceilCenterY : floorCenterY;

    notesOut.push({
      time: n.time,
      hitTime: +(n.time + visualDelay).toFixed(4),
      kind: n.kind,
      code: n.code,
      color,
      action,
      lane: side,
      trackLane: side === 'floor' ? 0 : 1,
      flip: action === 'flip',
      x,
      y: Math.round(y),
      voidY,
      gogo: !!n.gogo,
      bpm: n.bpm,
      scroll: n.scroll
    });
    lastAcceptedTime = n.time;
  }

  const lastX = notesOut.length ? notesOut[notesOut.length - 1].x : xOf(12);
  const segmentStart = startX - 900;
  const segmentEnd = opts.platformEnd || (lastX + opts.tailPx);
  const cx = Math.round(segmentStart + (segmentEnd - segmentStart) / 2);
  const w = Math.round(segmentEnd - segmentStart);
  const platforms = [
    { x: cx, y: Math.round(opts.floorY - opts.trackThickness / 2), w, h: opts.trackThickness },
    { x: cx, y: Math.round(opts.ceilingY + opts.trackThickness / 2), w, h: opts.trackThickness }
  ];
  return { notesOut, platforms, laneYs, flipCount };
}
function makeLevel(notes, opts) {
  const speed = opts.speed;
  const startX = opts.startX;
  const lastT = notes.length ? notes[notes.length - 1].time : 10;
  const levelLength = Math.max(3000, Math.ceil(startX + (lastT + opts.tailSeconds) * speed + 900));
  opts.platformEnd = levelLength + 1000;
  const { notesOut, platforms, laneYs, flipCount } = makeRhythmTargets(notes, opts);
  const rhythmNotes = [];

  for (const item of notesOut) {
    rhythmNotes.push({
      time: item.time,
      hitTime: item.hitTime,
      kind: item.kind,
      code: item.code,
      action: item.action,
      color: item.color,
      trackLane: item.trackLane,
      lane: item.lane,
      flip: !!item.flip,
      x: item.x,
      y: item.y,
      voidY: item.voidY,
      gogo: !!item.gogo,
      bpm: item.bpm,
      scroll: item.scroll
    });
  }

  return {
    name: opts.name,
    speed,
    length: levelLength,
    start: { x: startX, y: laneYs[0], side: 'floor', lane: 0 },
    segments: [],
    platforms,
    powerups: [],
    spikes: [],
    crystals: [],
    rhythm: {
      enabled: true,
      style: 'jump-flip',
      source: opts.source,
      course: opts.course,
      audio: opts.audioName,
      baseBpm: opts.baseBpm,
      pxPerBeat: opts.pxPerBeat,
      minNotePx: opts.minNotePx,
      laneCount: 2,
      laneYs,
      startLane: 0,
      floorY: opts.floorY,
      ceilingY: opts.ceilingY,
      trackGap: opts.ceilingY - opts.floorY,
      noteCount: rhythmNotes.length,
      flipCount,
      rolls: (opts.rolls || []).map(r => ({
        start: +Number(r.start).toFixed(4),
        end: +Number(r.end).toFixed(4),
        x1: Math.round(startX + Number(r.start) * speed),
        x2: Math.round(startX + Number(r.end) * speed)
      })),
      bpmChanges: opts.bpmChanges || [],
      measures: opts.measures || [],
      rawNoteCount: opts.rawNoteCount || rhythmNotes.length,
      perfectWindow: opts.perfectWindow,
      goodWindow: opts.goodWindow,
      badWindow: opts.badWindow,
      gateFatal: false,
      gravity: opts.gravity,
      maxFall: opts.maxFall,
      flipImpulse: opts.flipImpulse,
      jumpImpulse: opts.jumpImpulse,
      jumpHitDelay: opts.jumpHitDelay,
      flipHitDelay: opts.flipHitDelay,
      visualHitDelay: opts.visualHitDelay,
      jumpReturnTime: opts.jumpReturnTime,
      flipTravelTime: opts.flipTravelTime,
      jumpHeight: opts.jumpHeight,
      cameraLookAhead: opts.cameraLookAhead,
      notes: rhythmNotes
    },
    goal: { x: levelLength - 500 }
  };
}
function resourcesRootFor(outLevel) {
  let dir = path.dirname(path.resolve(outLevel));
  while (dir && path.basename(dir) !== 'resources') {
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return path.basename(dir) === 'resources'
    ? dir
    : path.join(process.cwd(), 'GravityRunner', 'assets', 'resources');
}
function copyAudioMaybe(audioPath, outLevel, audioName) {
  if (!audioPath || !fs.existsSync(audioPath)) return null;
  const ext = path.extname(audioPath) || '.ogg';
  const projectRoot = resourcesRootFor(outLevel); // .../assets/resources
  const audioDir = path.join(projectRoot, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const dst = path.join(audioDir, audioName + ext);
  fs.copyFileSync(audioPath, dst);
  return dst;
}
function main() {
  const tja = arg('tja');
  if (!tja) {
    console.error('Usage: node tools/tja_to_level.js --tja chart.tja --out GravityRunner/assets/resources/levels/level6.json [--audio song.ogg] [--course Oni]');
    process.exit(1);
  }
  const out = arg('out', path.join('GravityRunner', 'assets', 'resources', 'levels', 'level6.json'));
  const audioName = arg('audio-name', 'rhythm_song');
  let audio = arg('audio', null);
  const text = readTextLoose(tja);
  if (!audio) {
    audio = findAudioForTja(tja, text);
  }

  const courses = parseHeadersAndCourses(text);
  const course = chooseCourse(courses, arg('course', null));
  const notes = parseChart(course);
  const nameBase = path.basename(tja, path.extname(tja));
  const baseBpm = parseFloat(course.headers.BPM || '') || (notes[0] && notes[0].bpm) || 120;
  const beat = 60 / baseBpm;
  // If --px-per-beat is not specified, the beat spacing itself scales with BPM.
  // This makes fast songs both move faster and visually spread their notes out,
  // instead of compressing every song into the same per-beat distance.
  const pxPerBeat = has('px-per-beat') ? numArg('px-per-beat', 200) : adaptivePxPerBeat(baseBpm);
  const speed = has('speed') ? numArg('speed', 300) : Math.round(baseBpm * pxPerBeat / 60);

  const floorY = Math.round(numArg('floor-y', -140));
  const ceilingY = Math.round(numArg('ceiling-y', 140));
  const trackThickness = Math.round(numArg('track-thickness', 58));
  const jumpHeight = Math.round(numArg('jump-height', 66));
  const instantDelay = clamp(beat * 0.02, 0.004, 0.009);
  // Flip should stay nearly instant.  Light-jump has a visible arc, but the
  // target's x / hitTime are shifted by the same delay, so pressing on the beat
  // still feels correct.
  const visibleJumpDelay = clamp(beat * 0.23, 0.075, 0.13);
  const jumpHitDelay = numArg('jump-hit-delay', visibleJumpDelay);
  const flipHitDelay = numArg('flip-hit-delay', instantDelay);
  const visualHitDelay = numArg('visual-hit-delay', Math.max(jumpHitDelay, flipHitDelay));
  const jumpReturnTime = numArg('jump-return-time', visibleJumpDelay);
  const flipTravelTime = numArg('flip-travel-time', instantDelay);
  const trackGap = (ceilingY - 18) - (floorY + 18);
  const gravity = Math.round(numArg('gravity', 3200));
  const jumpImpulse = Math.round(numArg('jump-impulse', 0));
  const flipImpulse = Math.round(numArg('flip-impulse', 0));
  // Minimum note filtering is based on physical distance, then converted back
  // to seconds.  This keeps dense high-BPM charts readable while still making
  // high-BPM songs faster and more spacious on screen.
  // Keep the original chart by default.  Passing --min-note-px or --min-note-gap
  // is now opt-in simplification, not part of parsing.
  const minNotePx = has('min-note-px') ? numArg('min-note-px', Math.round(clamp(pxPerBeat * 0.46, 72, 132))) : 0;
  const minGapDefault = has('min-note-px') ? clamp(minNotePx / Math.max(1, speed), 0.055, 0.22) : 0;

  const level = makeLevel(notes, {
    name: arg('name', `${nameBase} [${course.headers.COURSE || 'TJA'} Jump Flip Rhythm]`),
    source: path.basename(tja),
    course: course.headers.COURSE || 'Unknown',
    audioName,
    baseBpm,
    rolls: notes.rolls || [],
    bpmChanges: notes.bpmChanges || [],
    measures: notes.measures || [],
    rawNoteCount: notes.filter(n => n.kind !== 'roll').length,
    pxPerBeat,
    speed,
    floorY,
    ceilingY,
    trackThickness,
    jumpHeight,
    jumpHitDelay,
    flipHitDelay,
    visualHitDelay,
    jumpReturnTime,
    flipTravelTime,
    startX: Math.round(numArg('start-x', -300)),
    tailPx: Math.round(numArg('tail-px', 1300)),
    tailSeconds: numArg('tail-seconds', 5),
    minNotePx,
    minNoteGap: numArg('min-note-gap', minGapDefault),
    perfectWindow: numArg('perfect-window', 0.06),
    goodWindow: numArg('good-window', 0.12),
    badWindow: numArg('bad-window', 0.18),
    gravity,
    maxFall: Math.round(numArg('max-fall', Math.max(2400, gravity * 0.30))),
    flipImpulse,
    jumpImpulse,
    cameraLookAhead: Math.round(numArg('camera-lookahead', 300))
  });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(level, null, 2));
  const copied = copyAudioMaybe(audio, out, audioName);
  console.log(`Wrote ${out}`);
  console.log(`Course: ${level.rhythm.course}, notes: ${level.rhythm.noteCount}, flips: ${level.rhythm.flipCount}`);
  console.log(`BPM: ${level.rhythm.baseBpm}, px/beat: ${level.rhythm.pxPerBeat}, min note px: ${level.rhythm.minNotePx}, speed: ${level.speed}px/s`);
  console.log(`Tracks: floor ${level.rhythm.floorY}, ceiling ${level.rhythm.ceilingY}, gravity ${level.rhythm.gravity}, jump ${level.rhythm.jumpImpulse}, flip ${level.rhythm.flipImpulse}`);
  if (copied) console.log(`Copied audio to ${copied}`);
  else console.log('No audio copied. Pass --audio song.ogg if needed.');
}
main();
