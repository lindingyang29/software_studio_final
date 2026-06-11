// Fetches a public notion.site page's text via the internal loadPageChunk API.
const https = require("https");

const HOST = "lava-summer-130.notion.site";
const raw = "1ebe48b2f93782bb9c2f01f332dc464d";
const pageId = raw.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: HOST,
      path: path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": "Mozilla/5.0"
      }
    }, (res) => {
      let out = "";
      res.on("data", (c) => out += c);
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const r = await post("/api/v3/loadPageChunk", {
    pageId: pageId,
    limit: 200,
    cursor: { stack: [] },
    chunkNumber: 0,
    verticalColumns: false
  });
  if (r.status !== 200) {
    console.log("HTTP", r.status, r.body.slice(0, 300));
    return;
  }
  const json = JSON.parse(r.body);
  const blocks = (json.recordMap && json.recordMap.block) || {};
  const order = Object.keys(blocks);
  console.log("BLOCKS:", order.length);
  for (const id of order) {
    const v = blocks[id].value && (blocks[id].value.value || blocks[id].value);
    if (!v) { console.log(id, "-> empty"); continue; }
    const t = v.properties && v.properties.title;
    const text = t ? t.map((seg) => seg[0]).join("") : "";
    console.log("[" + v.type + "]", text || "(no title)", "| children:", (v.content || []).length);
  }
})().catch((e) => console.error("ERR", e.message));
