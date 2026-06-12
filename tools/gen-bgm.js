// Synthesizes two loopable synthwave BGM tracks (menu + game) as 22.05kHz
// mono WAVs. Loops are exact bar multiples with no tail, so cc.audioEngine's
// loop mode is seamless.
const fs = require("fs");
const path = require("path");

const SR = 22050;
const OUT = "C:\\Users\\lindi\\Desktop\\claude_code_and_codex\\software_final_project\\GravityRunner\\assets\\resources\\audio";

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name, (buf.length / 1024 / 1024).toFixed(2) + "MB");
}

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Adds a tone into `mix` starting at sample `start`.
function tone(mix, start, durS, midi, amp, kind) {
  const f = freq(midi);
  const n = Math.floor(durS * SR);
  for (let i = 0; i < n && start + i < mix.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 60) * Math.exp(-t * (kind === "pad" ? 0.4 : 3.5));
    let v;
    const ph = 2 * Math.PI * f * t;
    if (kind === "square") v = Math.sin(ph) > 0 ? 0.6 : -0.6;
    else if (kind === "saw") v = Math.sin(ph) * 0.7 + Math.sin(2 * ph) * 0.25 + Math.sin(3 * ph) * 0.12;
    else v = Math.sin(ph) + 0.35 * Math.sin(2 * ph); // pad/sine-ish
    mix[start + i] += v * amp * env;
  }
}

function kick(mix, start) {
  const n = Math.floor(0.14 * SR);
  for (let i = 0; i < n && start + i < mix.length; i++) {
    const t = i / SR;
    const f = 95 - 380 * t;
    mix[start + i] += Math.sin(2 * Math.PI * Math.max(35, f) * t) * Math.exp(-t * 22) * 0.8;
  }
}

function hat(mix, start) {
  const n = Math.floor(0.04 * SR);
  for (let i = 0; i < n && start + i < mix.length; i++) {
    mix[start + i] += (Math.random() * 2 - 1) * Math.exp(-(i / SR) * 90) * 0.16;
  }
}

// ---------- menu track: 84 bpm, 8 bars, Am - F - C - G pad + gentle arp ----------
{
  const bpm = 84, bars = 8;
  const beat = 60 / bpm;
  const total = Math.floor(bars * 4 * beat * SR);
  const mix = new Array(total).fill(0);
  const chords = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C
    [55, 59, 62]  // G
  ];
  for (let bar = 0; bar < bars; bar++) {
    const ch = chords[bar % 4];
    const s = Math.floor(bar * 4 * beat * SR);
    for (const m of ch) tone(mix, s, 4 * beat, m - 12, 0.10, "pad");
    // arp: eighth notes climbing the chord two octaves
    for (let e = 0; e < 8; e++) {
      const m = ch[e % 3] + 12 * (e % 2);
      tone(mix, s + Math.floor(e * beat * 0.5 * SR), beat * 0.5, m + 12, 0.07, "sine");
    }
  }
  writeWav("bgm_menu.wav", mix);
}

// ---------- game track: 140 bpm, 8 bars, driving bass + arp + kick/hat ----------
{
  const bpm = 140, bars = 8;
  const beat = 60 / bpm;
  const total = Math.floor(bars * 4 * beat * SR);
  const mix = new Array(total).fill(0);
  const roots = [45, 45, 41, 43, 45, 45, 48, 43]; // A A F G A A C G
  const arpsets = [
    [57, 60, 64, 67],
    [53, 57, 60, 65],
    [48, 52, 55, 60],
    [55, 59, 62, 67]
  ];
  for (let bar = 0; bar < bars; bar++) {
    const s = Math.floor(bar * 4 * beat * SR);
    const root = roots[bar];
    const arp = arpsets[bar % 2 === 0 ? 0 : (bar % 4 === 1 ? 1 : (bar < 6 ? 2 : 3))];
    for (let b = 0; b < 4; b++) {
      const bs = s + Math.floor(b * beat * SR);
      kick(mix, bs);
      hat(mix, bs + Math.floor(beat * 0.5 * SR));
      // bass: two eighths per beat, octave bounce
      tone(mix, bs, beat * 0.45, root - 12, 0.16, "square");
      tone(mix, bs + Math.floor(beat * 0.5 * SR), beat * 0.4, root, 0.13, "square");
    }
    // lead arp: sixteenths
    for (let x = 0; x < 16; x++) {
      const m = arp[x % 4] + (x % 8 >= 4 ? 12 : 0);
      tone(mix, s + Math.floor(x * beat * 0.25 * SR), beat * 0.22, m, 0.055, "saw");
    }
  }
  writeWav("bgm_game.wav", mix);
}
