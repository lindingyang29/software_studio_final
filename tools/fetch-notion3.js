// Fetches a public Notion page (host/pageId via argv) incl. collection tables.
const https = require("https");

const HOST = process.argv[2] || "app.notion.com";
const raw = (process.argv[3] || "").replace(/-/g, "");
const pageId = raw.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: HOST, path: path, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "User-Agent": "Mozilla/5.0" }
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

function textOf(prop) {
  if (!prop) return "";
  return prop.map((seg) => seg[0]).join("");
}

(async () => {
  const r = await post("/api/v3/loadPageChunk", {
    pageId: pageId, limit: 300, cursor: { stack: [] }, chunkNumber: 0, verticalColumns: false
  });
  if (r.status !== 200) { console.log("HTTP", r.status, r.body.slice(0, 200)); return; }
  const json = JSON.parse(r.body);
  const blocks = (json.recordMap && json.recordMap.block) || {};
  const views = [];
  console.log("== PAGE BLOCKS ==");
  for (const id in blocks) {
    const v = blocks[id].value && (blocks[id].value.value || blocks[id].value);
    if (!v) continue;
    if (v.type === "collection_view") {
      views.push({ collectionId: v.collection_id || (v.format && v.format.collection_pointer && v.format.collection_pointer.id), viewId: (v.view_ids || [])[0], spaceId: v.space_id || (v.format && v.format.collection_pointer && v.format.collection_pointer.spaceId) });
      continue;
    }
    const t = textOf(v.properties && v.properties.title);
    if (t.trim()) console.log("[" + v.type + "] " + t);
  }
  for (const cv of views) {
    const q = await post("/api/v3/queryCollection", {
      collection: { id: cv.collectionId, spaceId: cv.spaceId },
      collectionView: { id: cv.viewId },
      loader: { type: "reducer", reducers: { collection_group_results: { type: "results", limit: 100 } }, searchQuery: "", userTimeZone: "Asia/Taipei" }
    });
    if (q.status !== 200) { console.log("== TABLE HTTP", q.status); continue; }
    const qq = JSON.parse(q.body);
    const cols = (qq.recordMap && qq.recordMap.collection) || {};
    const col = cols[cv.collectionId] && (cols[cv.collectionId].value.value || cols[cv.collectionId].value);
    const schema = (col && col.schema) || {};
    console.log("\n== TABLE: " + textOf(col && col.name) + " ==");
    const bl = (qq.recordMap && qq.recordMap.block) || {};
    const rowIds = ((qq.result && qq.result.reducerResults && qq.result.reducerResults.collection_group_results) || {}).blockIds || [];
    for (const rid of rowIds) {
      const rv = bl[rid] && (bl[rid].value.value || bl[rid].value);
      if (!rv || !rv.properties) continue;
      const parts = [];
      for (const key in schema) {
        const val = textOf(rv.properties[key]);
        if (val) parts.push(schema[key].name + ": " + val);
      }
      console.log("- " + parts.join(" | "));
    }
  }
})().catch((e) => console.error("ERR", e.message));
