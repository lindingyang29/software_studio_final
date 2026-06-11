// Synthesizes chiptune-style SFX as 16-bit mono 44.1kHz WAVs into resources/audio.
const fs = require("fs");
const path = require("path");

const SR = 44100;
const OUT = "C:\\Users\\lindi\\Desktop\\claude_code_and_codex\\software_final_project\\GravityRunner\\assets\\resources\\audio";

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);     // PCM
  buf.writeUInt16LE(1, 22);     // mono
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
  console.log(name, buf.length, "bytes");
}

function seconds(t) { return Math.floor(SR * t); }

// flip: rising square sweep
{
  const n = seconds(0.11);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 280 + 2600 * t;
    const ph = 2 * Math.PI * (280 * t + 1300 * t * t);
    const env = Math.exp(-t * 18);
    s[i] = (Math.sin(ph) > 0 ? 0.5 : -0.5) * env * 0.6;
  }
  writeWav("flip.wav", s);
}

// crystal: two-note blip
{
  const n = seconds(0.16);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = t < 0.06 ? 880 : 1318.5;
    const env = t < 0.06 ? 1 : Math.exp(-(t - 0.06) * 22);
    s[i] = Math.sin(2 * Math.PI * f * t) * env * 0.45;
  }
  writeWav("crystal.wav", s);
}

// death: noise burst + falling tone
{
  const n = seconds(0.35);
  const s = new Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.pow(1 - t / 0.35, 2);
    const noise = (Math.random() * 2 - 1);
    last = last * 0.7 + noise * 0.3; // crude lowpass
    const f = 200 - 380 * t;
    const tone = Math.sin(2 * Math.PI * Math.max(40, f) * t);
    s[i] = (last * 0.6 + tone * 0.4) * env * 0.7;
  }
  writeWav("death.wav", s);
}

// win: ascending arpeggio C5 E5 G5 C6
{
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const per = 0.13;
  const n = seconds(per * notes.length + 0.15);
  const s = new Array(n).fill(0);
  for (let k = 0; k < notes.length; k++) {
    const start = seconds(per * k);
    const len = seconds(k === notes.length - 1 ? 0.28 : per);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / SR;
      const env = Math.exp(-t * 9);
      s[start + i] += Math.sin(2 * Math.PI * notes[k] * t) * env * 0.4;
    }
  }
  writeWav("win.wav", s);
}

// click
{
  const n = seconds(0.05);
  const s = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    s[i] = Math.sin(2 * Math.PI * 700 * t) * Math.exp(-t * 60) * 0.5;
  }
  writeWav("click.wav", s);
}
