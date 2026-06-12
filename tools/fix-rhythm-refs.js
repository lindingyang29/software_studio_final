// Reconciles rhythm_catalog.json + level jsons with the files that actually
// exist, then deletes unreferenced duplicate variants (#UXXXX / uXXXX vs
// proper unicode names left behind by broken-locale checkouts).
const fs = require("fs");
const path = require("path");

const ROOT = "C:/Users/lindi/Desktop/claude_code_and_codex/software_final_project/GravityRunner/assets/resources";
const CAT = ROOT + "/rhythm_catalog.json";

// decode "#U5343" and "u5343"-style escapes into real characters
function variants(p) {
  const out = [p];
  const a = p.replace(/#U([0-9a-fA-F]{4,5})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  if (a !== p) out.push(a);
  const b = a.replace(/u([0-9a-fA-F]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  if (b !== a) out.push(b);
  return out;
}

const cat = JSON.parse(fs.readFileSync(CAT, "utf8"));
let fixedPaths = 0, fixedAudio = 0, stillMissing = 0;
const referencedLevels = new Set();
const referencedAudio = new Set();

for (const s of cat.songs) {
  for (const d of s.difficulties) {
    let found = null;
    for (const v of variants(d.path)) {
      if (fs.existsSync(ROOT + "/" + v + ".json")) { found = v; break; }
    }
    if (!found) { console.log("STILL MISSING level:", d.path); stillMissing++; continue; }
    if (found !== d.path) { d.path = found; fixedPaths++; }
    referencedLevels.add(found + ".json");

    // fix the audio reference inside the level json
    const lp = ROOT + "/" + found + ".json";
    const lv = JSON.parse(fs.readFileSync(lp, "utf8"));
    if (lv.rhythm && lv.rhythm.audio) {
      let af = null;
      for (const v of variants(lv.rhythm.audio)) {
        if (fs.existsSync(ROOT + "/audio/" + v + ".ogg")) { af = v; break; }
      }
      if (!af) { console.log("STILL MISSING audio:", lv.rhythm.audio, "(in", found + ")"); stillMissing++; continue; }
      if (af !== lv.rhythm.audio) {
        lv.rhythm.audio = af;
        fs.writeFileSync(lp, JSON.stringify(lv));
        fixedAudio++;
      }
      referencedAudio.add("rhythm_" === af.slice(0, 7) ? af + ".ogg" : af + ".ogg");
      referencedAudio.add(af + ".ogg");
    }
  }
}
fs.writeFileSync(CAT, JSON.stringify(cat, null, 2));
console.log("catalog paths fixed:", fixedPaths, "| audio refs fixed:", fixedAudio, "| missing:", stillMissing);

// delete unreferenced duplicates (level jsons and rhythm_*.ogg) + their metas
let deleted = 0;
for (const f of fs.readdirSync(ROOT + "/levels/rhythm")) {
  if (!f.endsWith(".json")) continue;
  if (!referencedLevels.has("levels/rhythm/" + f)) {
    fs.unlinkSync(ROOT + "/levels/rhythm/" + f);
    if (fs.existsSync(ROOT + "/levels/rhythm/" + f + ".meta")) fs.unlinkSync(ROOT + "/levels/rhythm/" + f + ".meta");
    console.log("deleted unreferenced level:", f);
    deleted++;
  }
}
for (const f of fs.readdirSync(ROOT + "/audio")) {
  if (!f.startsWith("rhythm_") || !f.endsWith(".ogg")) continue;
  if (!referencedAudio.has(f)) {
    fs.unlinkSync(ROOT + "/audio/" + f);
    if (fs.existsSync(ROOT + "/audio/" + f + ".meta")) fs.unlinkSync(ROOT + "/audio/" + f + ".meta");
    console.log("deleted unreferenced audio:", f);
    deleted++;
  }
}
console.log("deleted unreferenced files:", deleted);
