const crypto = require("crypto");
const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function compress(uuid) {
  const hex = uuid.replace(/-/g, "");
  let out = hex.slice(0, 5);
  for (let i = 5; i < 32; i += 3) {
    const v = parseInt(hex.slice(i, i + 3), 16);
    out += KEYS[v >> 6] + KEYS[v & 63];
  }
  return out;
}
const names = ["project","MenuScene","GameScene","GameMgr","MenuCtrl","Player","LevelBuilder","CameraFollow","GameData","Sfx","n1","n2","n3","n4","n5","n6","n7","n8"];
for (const n of names) {
  const u = crypto.randomUUID();
  console.log(n + "  " + u + "  " + compress(u));
}
console.log("CHECK", compress("943dc4d9-f755-4786-b6d1-26b98a66c7f0"), "expect 943dcTZ91VHhrbRJrmKZsfw");
