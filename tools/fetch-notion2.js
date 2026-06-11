// Fetches the three requirement tables (collection views) from the Notion spec page.
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

function textOf(prop) {
  if (!prop) return "";
  return prop.map((seg) => seg[0]).join("");
}

(async () => {
  const r = await post("/api/v3/loadPageChunk", {
    pageId: pageId, limit: 200, cursor: { stack: [] }, chunkNumber: 0, verticalColumns: false
  });
  const json = JSON.parse(r.body);
  const blocks = (json.recordMap && json.recordMap.block) || {};

  const views = [];
  for (const id in blocks) {
    const v = blocks[id].value && (blocks[id].value.value || blocks[id].value);
    if (v && v.type === "collection_view") {
      views.push({ blockId: id, collectionId: v.collection_id, viewId: (v.view_ids || [])[0], pointer: v.format && v.format.collection_pointer });
    }
  }
  console.log("collection views:", JSON.stringify(views, null, 1).slice(0, 800));

  for (const cv of views) {
    const colId = cv.collectionId || (cv.pointer && cv.pointer.id);
    const q = await post("/api/v3/queryCollection", {
      collection: { id: colId, spaceId: cv.pointer && cv.pointer.spaceId },
      collectionView: { id: cv.viewId },
      loader: {
        type: "reducer",
        reducers: { collection_group_results: { type: "results", limit: 100 } },
        searchQuery: "",
        userTimeZone: "Asia/Taipei"
      }
    });
    if (q.status !== 200) { console.log("=== view", cv.viewId, "HTTP", q.status, q.body.slice(0, 200)); continue; }
    const qq = JSON.parse(q.body);
    const cols = (qq.recordMap && qq.recordMap.collection) || {};
    const col = cols[colId] && (cols[colId].value.value || cols[colId].value);
    const schema = (col && col.schema) || {};
    console.log("\n===== TABLE: " + textOf(col && col.name) + " =====");
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
