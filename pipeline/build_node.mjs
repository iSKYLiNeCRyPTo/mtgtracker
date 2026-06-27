/**
 * MTGTracker Global Embedding Pipeline (Node.js / Xenova)
 * =========================================================
 * Uses the EXACT same Xenova/dinov2-base ONNX model as the browser worker,
 * guaranteeing vector compatibility. Runs on CPU via ONNX Runtime Node.
 *
 * Fetches all MTG card printings from Scryfall bulk data, downloads card
 * images, and builds a binary MTGT-format embedding index.
 *
 * Multi-crop embeddings — 4 crops per card for better camera match rates:
 *   1. Full card (baseline)
 *   2. Artwork region only (strips border/text — most discriminative)
 *   3. Top half (name + artwork top)
 *   4. Center crop at 85% (simulates slight zoom/perspective)
 *
 * MTG card aspect ratio is 63:88 — same as Pokémon, crop fractions unchanged.
 *
 * Usage:
 *   npm install @xenova/transformers sharp
 *   node build_node.mjs              # full build
 *   node build_node.mjs --resume     # resume from checkpoint
 *   node build_node.mjs --upload-only
 *
 * Scryfall bulk data is free; please add a descriptive User-Agent and
 * respect their rate limits (10–50ms delay between image downloads).
 */

import { pipeline } from "@xenova/transformers";
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import https from "https";
import http from "http";
import { URL } from "url";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const CARDS_CACHE    = "./all_cards.json";
const INDEX_FILE     = "./global_embeddings_v1.bin";
const META_FILE      = "./cards_meta.json";
const IMG_CACHE_DIR  = "./embedding_cache";
const CROP_CACHE_DIR = "./crop_cache";
const MAGIC          = Buffer.from("MTGT");
const ID_LEN         = 36; // Scryfall UUID length
const DIMS           = 768;
const CHECKPOINT     = "./checkpoint_v1.json";
const CHECKPOINT_INTERVAL = 50;

// Firebase
const BUCKET  = "YOUR_FIREBASE_BUCKET.appspot.com";
const PROJECT = "YOUR_FIREBASE_PROJECT";
const API_KEY = "YOUR_FIREBASE_API_KEY";

const args        = process.argv.slice(2);
const RESUME      = args.includes("--resume");
const UPLOAD_ONLY = args.includes("--upload-only");

// ── Crop definitions ──────────────────────────────────────────────────────────
// MTG card aspect ratio is 63:88 — same as Pokémon so crop fractions are identical.
// Artwork box on a standard MTG card sits roughly 18%–65% from top, 6%–94% from sides.
const CROPS = [
  { name: "full",    top: 0,    left: 0,    h: 1.00, w: 1.00 },
  { name: "art",     top: 0.18, left: 0.06, h: 0.47, w: 0.88 },
  { name: "tophalf", top: 0,    left: 0,    h: 0.55, w: 1.00 },
  { name: "center",  top: 0.08, left: 0.08, h: 0.84, w: 0.84 },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const chunks = [];
    const req = lib.get(url, { headers: { "User-Agent": "MTGTracker/1.0 (card investment tracker)" } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchBuf(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function fetchJSON(url) { return fetchBuf(url).then(b => JSON.parse(b.toString())); }

function httpsUpload(urlStr, data, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": contentType, "Content-Length": buf.length },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.write(buf); req.end();
  });
}

function httpsPost(urlStr, data, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      method: "PATCH",
      headers: { "Content-Type": contentType, "Content-Length": buf.length },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.write(buf); req.end();
  });
}

// ── Scryfall card fetching ────────────────────────────────────────────────────
// Uses the "oracle_cards" bulk file — one entry per unique card face.
// For a per-printing index (foil/nonfoil separate images) use "all_cards" instead,
// but that's ~700MB and 7× more entries. oracle_cards (~100MB) is the sweet spot.
async function fetchAllCards() {
  if (existsSync(CARDS_CACHE)) {
    console.log("Loading cached card list...");
    return JSON.parse(readFileSync(CARDS_CACHE, "utf-8"));
  }

  console.log("Fetching Scryfall bulk-data manifest...");
  const manifest = await fetchJSON("https://api.scryfall.com/bulk-data");
  const oracleEntry = manifest.data.find(d => d.type === "oracle_cards");
  if (!oracleEntry) throw new Error("oracle_cards bulk entry not found");

  console.log(`Downloading bulk data from ${oracleEntry.download_uri} (~${Math.round(oracleEntry.size / 1024 / 1024)}MB)...`);
  const buf = await fetchBuf(oracleEntry.download_uri);
  const all = JSON.parse(buf.toString());

  // Filter to cards that have an image and aren't tokens/art cards/memorabilia
  const cards = all.filter(c =>
    c.image_uris?.large &&
    !["token", "emblem", "art_series", "double_faced_token", "reversible_card"].includes(c.layout) &&
    c.lang === "en"
  );

  writeFileSync(CARDS_CACHE, JSON.stringify(cards));
  console.log(`Cached ${cards.length} cards (filtered from ${all.length})`);
  return cards;
}

// ── Image caching ─────────────────────────────────────────────────────────────
async function getImage(cardId, url) {
  mkdirSync(IMG_CACHE_DIR, { recursive: true });
  const p = path.join(IMG_CACHE_DIR, cardId.replace(/[^a-z0-9]/gi, "_") + ".jpg");
  if (existsSync(p)) return p;
  for (let i = 0; i < 3; i++) {
    try {
      const buf = await fetchBuf(url);
      writeFileSync(p, buf);
      // Respect Scryfall rate limit — 10ms between requests
      await new Promise(r => setTimeout(r, 10));
      return p;
    } catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  return null;
}

// ── Crop an image and save to temp file ───────────────────────────────────────
async function cropImage(imgPath, crop) {
  mkdirSync(CROP_CACHE_DIR, { recursive: true });
  const meta = await sharp(imgPath).metadata();
  const w = meta.width, h = meta.height;

  const left   = Math.round(crop.left * w);
  const top    = Math.round(crop.top  * h);
  const width  = Math.round(crop.w   * w);
  const height = Math.round(crop.h   * h);

  const tmpName = `crop_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
  const tmpPath = path.join(CROP_CACHE_DIR, tmpName);

  await sharp(imgPath)
    .extract({ left, top, width, height })
    .resize(224, 224, { fit: "fill" })
    .jpeg({ quality: 90 })
    .toFile(tmpPath);

  return tmpPath;
}

function rmTemp(p) { try { unlinkSync(p); } catch {} }

// ── Extract + L2-normalize CLS token ─────────────────────────────────────────
async function embedImage(extractor, imgPath) {
  const out  = await extractor(imgPath);
  const data = out.data;
  const vec  = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) vec[i] = data[i];
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) + 1e-8;
  for (let i = 0; i < DIMS; i++) vec[i] /= norm;
  return vec;
}

// ── Binary packing ────────────────────────────────────────────────────────────
// Format: 16-byte header + N × (36-byte ID + 768×float32)
// Multiple entries can share the same ID (multi-crop) — worker takes max score.
function packIndex(embeddings) {
  const entrySize = ID_LEN + DIMS * 4;
  const buf = Buffer.alloc(16 + embeddings.length * entrySize);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(1, 4);                    // version
  buf.writeUInt32LE(embeddings.length, 8);    // count
  buf.writeUInt32LE(DIMS, 12);                // dims

  let offset = 16;
  for (const { id, vec } of embeddings) {
    const idBuf = Buffer.alloc(ID_LEN, 0);
    Buffer.from(id.slice(0, ID_LEN)).copy(idBuf);
    idBuf.copy(buf, offset); offset += ID_LEN;
    for (let i = 0; i < DIMS; i++) {
      buf.writeFloatLE(vec[i], offset); offset += 4;
    }
  }
  return buf;
}

// ── Firebase ──────────────────────────────────────────────────────────────────
async function uploadStorage(localPath, remotePath, contentType) {
  const data = readFileSync(localPath);
  const encoded = encodeURIComponent(remotePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}&key=${API_KEY}`;
  const res = await httpsUpload(url, data, contentType);
  if (res.status !== 200) throw new Error(`Upload failed: ${res.status} ${res.body.slice(0, 200)}`);
  console.log(`Uploaded ${remotePath} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function updateFirestore(fields) {
  const doc = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) =>
    [k, typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) }]
  ))};
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/meta/embeddingIndex?key=${API_KEY}`;
  const res = await httpsPost(url, JSON.stringify(doc), "application/json");
  if (res.status !== 200) console.warn(`Firestore update warning: ${res.status}`);
  else console.log("Firestore meta updated");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (UPLOAD_ONLY) {
    console.log("Upload-only mode...");
    await uploadStorage(INDEX_FILE, "embeddings/global-v1.bin", "application/octet-stream");
    await uploadStorage(META_FILE,  "embeddings/cards-meta.json", "application/json");
    const buf = readFileSync(INDEX_FILE);
    const count = buf.readUInt32LE(8);
    await updateFirestore({
      version: new Date().toISOString().slice(0, 10),
      count, dims: DIMS,
      checksum: createHash("md5").update(buf).digest("hex").slice(0, 8),
      model: "Xenova/dinov2-base-multicrop",
      storagePath: "embeddings/global-v1.bin",
      metaPath: "embeddings/cards-meta.json",
      updatedAt: new Date().toISOString().slice(0, 10),
    });
    return;
  }

  const cards = await fetchAllCards();

  const done = {};
  if (RESUME && existsSync(CHECKPOINT)) {
    const cp = JSON.parse(readFileSync(CHECKPOINT, "utf-8"));
    Object.assign(done, cp);
    console.log(`Resuming: ${Object.keys(done).length} cards already embedded`);
  }

  console.log("\nLoading Xenova/dinov2-base...");
  const extractor = await pipeline("image-feature-extraction", "Xenova/dinov2-base");
  console.log("Model loaded\n");

  const todo = cards.filter(c => !done[c.id] && c.image_uris?.large);
  console.log(`${todo.length} cards to embed (${Object.keys(done).length} done)`);
  console.log(`${CROPS.length} crops per card = ~${todo.length * CROPS.length} total embeddings\n`);

  let processed = 0;
  let errors = 0;

  for (const card of todo) {
    const imgUrl  = card.image_uris.large;
    const imgPath = await getImage(card.id, imgUrl);
    if (!imgPath) { processed++; errors++; continue; }

    const vecs = [];
    for (const crop of CROPS) {
      let cropPath = null;
      try {
        if (crop.name === "full") {
          vecs.push(await embedImage(extractor, imgPath));
        } else {
          cropPath = await cropImage(imgPath, crop);
          vecs.push(await embedImage(extractor, cropPath));
        }
      } catch (e) {
        // Skip this crop variant silently
      } finally {
        if (cropPath) rmTemp(cropPath);
      }
    }

    if (vecs.length > 0) done[card.id] = vecs;

    processed++;
    if (processed % CHECKPOINT_INTERVAL === 0) {
      const pct = ((processed / todo.length) * 100).toFixed(1);
      process.stdout.write(`\r${pct}% (${processed}/${todo.length}, cards: ${Object.keys(done).length}, errors: ${errors})`);
      writeFileSync(CHECKPOINT, JSON.stringify(done));
    }
  }
  console.log(`\nDone: ${Object.keys(done).length} cards`);
  writeFileSync(CHECKPOINT, JSON.stringify(done));

  // Flatten multi-crop vecs into individual index entries
  const embeddings = [];
  for (const [id, vecs] of Object.entries(done)) {
    for (const vec of vecs) embeddings.push({ id, vec });
  }
  console.log(`Total index entries: ${embeddings.length} (${CROPS.length} crops × ${Object.keys(done).length} cards)`);

  const packed = packIndex(embeddings);
  writeFileSync(INDEX_FILE, packed);
  console.log(`Packed: ${(packed.length / 1024 / 1024).toFixed(1)} MB`);

  // Build metadata — store what the browser needs to display a match
  const byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const meta = {};
  for (const id of Object.keys(done)) {
    const c = byId[id];
    if (c) meta[id] = {
      id:       c.id,
      name:     c.name || "",
      set:      c.set || "",
      set_name: c.set_name || "",
      number:   c.collector_number || "",
      rarity:   c.rarity || "",
      type_line: c.type_line || "",
      image_uris: { small: c.image_uris?.small || "", normal: c.image_uris?.normal || "" },
      prices:   c.prices || {},
    };
  }
  writeFileSync(META_FILE, JSON.stringify(meta));
  console.log(`Metadata: ${Object.keys(meta).length} cards`);

  console.log("\nUploading to Firebase...");
  await uploadStorage(INDEX_FILE, "embeddings/global-v1.bin", "application/octet-stream");
  await uploadStorage(META_FILE,  "embeddings/cards-meta.json", "application/json");
  const checksum = createHash("md5").update(packed).digest("hex").slice(0, 8);
  const version  = new Date().toISOString().slice(0, 10);
  await updateFirestore({
    version, count: embeddings.length, dims: DIMS, checksum,
    model: "Xenova/dinov2-base-multicrop",
    storagePath: "embeddings/global-v1.bin",
    metaPath: "embeddings/cards-meta.json",
    updatedAt: version,
  });

  console.log(`\nDone! ${embeddings.length} index entries (${Object.keys(done).length} unique cards) live.`);
}

main().catch(e => { console.error(e); process.exit(1); });
