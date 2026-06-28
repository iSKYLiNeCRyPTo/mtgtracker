/**
 * MTGTracker Global Embedding Pipeline (Node.js / Xenova)
 * =========================================================
 * Uses the EXACT same Xenova/dinov2-base ONNX model as the browser worker,
 * guaranteeing vector compatibility. Runs on CPU via ONNX Runtime Node.
 *
 * Multi-crop embeddings — 4 crops per card for better camera match rates:
 *   1. Full card (baseline)
 *   2. Artwork region only (strips border/text — most discriminative)
 *   3. Top half (name + artwork top)
 *   4. Center crop at 85% (simulates slight zoom/perspective)
 *
 * Usage:
 *   npm install @xenova/transformers sharp
 *   node build_node.mjs              # full build
 *   node build_node.mjs --resume     # resume from checkpoint
 *   node build_node.mjs --upload-only
 *   node build_node.mjs --workers 4  # override worker count (default: CPU cores - 1)
 */

import { pipeline, env } from "@xenova/transformers";
// Use sharp bundled with @xenova/transformers to avoid duplicate libvips conflict
import sharp from "@xenova/transformers/node_modules/sharp/lib/index.js";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync,
  statSync,
} from "fs";
import { createHash } from "crypto";
import https from "https";
import http from "http";
import { URL } from "url";
import path from "path";
import os from "os";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config ────────────────────────────────────────────────────────────────────
const CARDS_CACHE    = "./all_cards.json";
const INDEX_FILE     = "./global_embeddings_v1.bin";
const META_FILE      = "./cards_meta.json";
const IMG_CACHE_DIR  = "./embedding_cache";
const CROP_CACHE_DIR = "./crop_cache";
const MAGIC          = Buffer.from("MTGT");
const ID_LEN         = 36;
const DIMS           = 768;
const CHECKPOINT     = "./checkpoint_v1.json";
const CHECKPOINT_INTERVAL = 25; // save more often for resume reliability

// ── Firebase — fill these in ─────────────────────────────────────────────────
const BUCKET  = "mtgtracker-a6c7c.firebasestorage.app";
const PROJECT = "mtgtracker-a6c7c";
const API_KEY = "AIzaSyAHDm094sclBfRMtmjsXyC4jsKzrF9kXTs";

// ── Concurrency ───────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const RESUME      = args.includes("--resume");
const UPLOAD_ONLY = args.includes("--upload-only");
const workerArg   = args.indexOf("--workers");
// Default: use (CPU cores - 1), minimum 1, maximum 8
// DINOv2 is memory-hungry; more than 6 workers rarely helps on CPU
const CPU_CORES   = os.cpus().length;
const NUM_WORKERS = workerArg >= 0
  ? Math.max(1, Math.min(16, parseInt(args[workerArg + 1]) || 4))
  : Math.max(1, Math.min(6, CPU_CORES - 1));

// ── Crop definitions ──────────────────────────────────────────────────────────
const CROPS = [
  { name: "full",    top: 0,    left: 0,    h: 1.00, w: 1.00 },
  { name: "art",     top: 0.18, left: 0.06, h: 0.47, w: 0.88 },
  { name: "tophalf", top: 0,    left: 0,    h: 0.55, w: 1.00 },
  { name: "center",  top: 0.08, left: 0.08, h: 0.84, w: 0.84 },
];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER THREAD — each worker loads its own DINOv2 model instance and processes
// a slice of cards assigned to it by the main thread.
// ═══════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
  env.allowLocalModels = false;

  const { workerId, imgCacheDir, cropCacheDir } = workerData;

  let extractor = null;
  async function getExtractor() {
    if (!extractor) {
      extractor = await pipeline("image-feature-extraction", "Xenova/dinov2-base", {
        device: "wasm",
      });
    }
    return extractor;
  }

  function extractCLS(out) {
    const data = out.data;
    const vec  = new Float32Array(DIMS);
    for (let i = 0; i < DIMS; i++) vec[i] = data[i];
    let norm = 0;
    for (let i = 0; i < DIMS; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) + 1e-8;
    for (let i = 0; i < DIMS; i++) vec[i] /= norm;
    return vec;
  }

  async function cropImage(imgPath, crop) {
    const meta   = await sharp(imgPath).metadata();
    const left   = Math.round(crop.left * meta.width);
    const top    = Math.round(crop.top  * meta.height);
    const width  = Math.round(crop.w   * meta.width);
    const height = Math.round(crop.h   * meta.height);
    const tmp    = path.join(cropCacheDir, `w${workerId}_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
    await sharp(imgPath)
      .extract({ left, top, width, height })
      .resize(224, 224, { fit: "fill" })
      .jpeg({ quality: 90 })
      .toFile(tmp);
    return tmp;
  }

  function rmTemp(p) { try { unlinkSync(p); } catch {} }

  async function embedCard(imgPath) {
    const ext = await getExtractor();
    const vecs = [];
    for (const crop of CROPS) {
      let tmp = null;
      try {
        if (crop.name === "full") {
          const out = await ext(imgPath);
          vecs.push(Array.from(extractCLS(out)));
        } else {
          tmp = await cropImage(imgPath, crop);
          const out = await ext(tmp);
          vecs.push(Array.from(extractCLS(out)));
        }
      } catch {} finally { if (tmp) rmTemp(tmp); }
    }
    return vecs;
  }

  // Main worker loop — receives jobs from parent
  parentPort.on("message", async (msg) => {
    if (msg.type === "init") {
      try {
        await getExtractor();
        parentPort.postMessage({ type: "ready", workerId });
      } catch (e) {
        parentPort.postMessage({ type: "error", workerId, msg: e.message });
      }
    }

    if (msg.type === "embed") {
      const { cardId, imgPath, jobId } = msg;
      try {
        const vecs = await embedCard(imgPath);
        parentPort.postMessage({ type: "done", workerId, cardId, vecs, jobId });
      } catch (e) {
        parentPort.postMessage({ type: "failed", workerId, cardId, jobId, msg: e.message });
      }
    }
  });

  // Signal ready after module load
  parentPort.postMessage({ type: "workerLoaded", workerId });
} else {
// ═══════════════════════════════════════════════════════════════════════════════
// MAIN THREAD
// ═══════════════════════════════════════════════════════════════════════════════

// ── ANSI progress display ─────────────────────────────────────────────────────
const ANSI = {
  clear:    "\x1b[2J\x1b[H",
  bold:     "\x1b[1m",
  reset:    "\x1b[0m",
  teal:     "\x1b[36m",
  green:    "\x1b[32m",
  yellow:   "\x1b[33m",
  red:      "\x1b[31m",
  grey:     "\x1b[90m",
  white:    "\x1b[97m",
};

function bar(fraction, width = 40) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const empty  = width - filled;
  return `${ANSI.teal}${"█".repeat(filled)}${ANSI.grey}${"░".repeat(empty)}${ANSI.reset}`;
}

function fmtTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "--:--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(n => String(n).padStart(2, "0")).join(":");
}

function fmtRate(cardsPerSec) {
  if (!isFinite(cardsPerSec) || cardsPerSec <= 0) return "...";
  return `${cardsPerSec.toFixed(2)} cards/s`;
}

class ProgressDisplay {
  constructor(total, numWorkers) {
    this.total      = total;
    this.done       = 0;
    this.errors     = 0;
    this.numWorkers = numWorkers;
    this.startTime  = Date.now();
    this.lastCards  = 0;
    this.lastTime   = Date.now();
    this.rate       = 0;
    this.workerStatus = Array.from({ length: numWorkers }, (_, i) => ({ id: i, card: "initializing..." }));
    this.lastRendered = "";
    this.renderInterval = setInterval(() => this.render(), 250);
  }

  update(done, errors, workerId, cardName) {
    this.done   = done;
    this.errors = errors;
    if (workerId !== undefined && cardName !== undefined) {
      this.workerStatus[workerId] = { id: workerId, card: cardName };
    }
    // Rolling rate (last 5 seconds)
    const now = Date.now();
    const dt  = (now - this.lastTime) / 1000;
    if (dt >= 2) {
      this.rate      = (this.done - this.lastCards) / dt;
      this.lastCards = this.done;
      this.lastTime  = now;
    }
  }

  render() {
    const fraction  = this.total > 0 ? this.done / this.total : 0;
    const elapsed   = (Date.now() - this.startTime) / 1000;
    const remaining = this.rate > 0 ? (this.total - this.done) / this.rate : Infinity;
    const pct       = (fraction * 100).toFixed(1);

    const lines = [
      "",
      `  ${ANSI.bold}${ANSI.teal}MTGTracker Embedding Pipeline${ANSI.reset}`,
      "",
      `  ${bar(fraction)}  ${ANSI.bold}${ANSI.white}${pct}%${ANSI.reset}`,
      "",
      `  ${ANSI.grey}Cards:   ${ANSI.reset}${ANSI.white}${this.done.toLocaleString()}${ANSI.reset}${ANSI.grey} / ${this.total.toLocaleString()}${ANSI.reset}`,
      `  ${ANSI.grey}Errors:  ${ANSI.reset}${this.errors > 0 ? ANSI.yellow : ANSI.grey}${this.errors}${ANSI.reset}`,
      `  ${ANSI.grey}Rate:    ${ANSI.reset}${ANSI.green}${fmtRate(this.rate)}${ANSI.reset}`,
      `  ${ANSI.grey}Elapsed: ${ANSI.reset}${fmtTime(elapsed)}`,
      `  ${ANSI.grey}ETA:     ${ANSI.reset}${ANSI.yellow}${fmtTime(remaining)}${ANSI.reset}`,
      "",
      `  ${ANSI.grey}Workers (${this.numWorkers} threads):${ANSI.reset}`,
      ...this.workerStatus.map(w =>
        `    ${ANSI.teal}#${w.id}${ANSI.reset}  ${ANSI.grey}${(w.card || "").slice(0, 45)}${ANSI.reset}`
      ),
      "",
    ];

    const rendered = lines.join("\n");
    // Only re-draw if content changed (avoids flicker)
    if (rendered !== this.lastRendered) {
      process.stdout.write(ANSI.clear + rendered);
      this.lastRendered = rendered;
    }
  }

  finish(count, elapsed) {
    clearInterval(this.renderInterval);
    process.stdout.write(ANSI.clear);
    console.log(`\n  ${ANSI.green}${ANSI.bold}✓ Done!${ANSI.reset}`);
    console.log(`  ${count.toLocaleString()} embeddings in ${fmtTime(elapsed / 1000)}`);
    console.log(`  ${ANSI.grey}${(count / (elapsed / 1000)).toFixed(1)} cards/s average${ANSI.reset}\n`);
  }

  error(msg) {
    clearInterval(this.renderInterval);
    process.stdout.write("\n");
    console.error(`  ${ANSI.red}✗ ${msg}${ANSI.reset}\n`);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const lib      = url.startsWith("https") ? https : http;
    const parsed   = new URL(url);
    const options  = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      port:     parsed.port || (url.startsWith("https") ? 443 : 80),
      method:   "GET",
      headers:  {
        "User-Agent":  "MTGTracker/1.0 (card investment tracker; github.com/iSKYLiNeCRyPTo/mtgtracker)",
        "Accept":      "*/*",
      },
    };
    const chunks = [];
    const req = lib.request(options, res => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchBuf(res.headers.location).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}
function fetchJSON(url) { return fetchBuf(url).then(b => JSON.parse(b.toString())); }

function httpsUpload(urlStr, data, contentType) {
  return new Promise((resolve, reject) => {
    const u   = new URL(urlStr);
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const req = https.request({
      hostname: u.hostname, port: 443,
      path: u.pathname + u.search,
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

function httpsPatch(urlStr, data) {
  return new Promise((resolve, reject) => {
    const u   = new URL(urlStr);
    const buf = Buffer.from(data);
    const req = https.request({
      hostname: u.hostname, port: 443,
      path: u.pathname + u.search,
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Content-Length": buf.length },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.write(buf); req.end();
  });
}

// ── Scryfall ──────────────────────────────────────────────────────────────────
async function fetchAllCards() {
  if (existsSync(CARDS_CACHE)) {
    process.stdout.write("  Loading cached card list...\n");
    return JSON.parse(readFileSync(CARDS_CACHE, "utf-8"));
  }
  process.stdout.write("  Fetching Scryfall bulk-data manifest...\n");
  const manifest   = await fetchJSON("https://api.scryfall.com/bulk-data");
  const oracleEntry = manifest.data.find(d => d.type === "oracle_cards");
  if (!oracleEntry) throw new Error("oracle_cards bulk entry not found");

  const sizeMB = (oracleEntry.size / 1024 / 1024).toFixed(0);
  process.stdout.write(`  Downloading bulk data (~${sizeMB}MB)...\n`);
  const buf  = await fetchBuf(oracleEntry.download_uri);
  const all  = JSON.parse(buf.toString());
  const cards = all.filter(c =>
    c.image_uris?.large &&
    !["token","emblem","art_series","double_faced_token","reversible_card"].includes(c.layout) &&
    c.lang === "en"
  );
  writeFileSync(CARDS_CACHE, JSON.stringify(cards));
  process.stdout.write(`  Cached ${cards.length} cards\n`);
  return cards;
}

// ── Image download ────────────────────────────────────────────────────────────
const _downloadQueue  = new Map(); // url → Promise (deduplicate concurrent fetches)

async function getImage(cardId, url) {
  mkdirSync(IMG_CACHE_DIR, { recursive: true });
  const p = path.join(IMG_CACHE_DIR, cardId.replace(/[^a-z0-9]/gi, "_") + ".jpg");
  if (existsSync(p)) return p;

  // Deduplicate: if another worker is fetching the same card, wait for it
  if (_downloadQueue.has(cardId)) return _downloadQueue.get(cardId);

  const promise = (async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const buf = await fetchBuf(url);
        writeFileSync(p, buf);
        await new Promise(r => setTimeout(r, 20)); // 20ms Scryfall courtesy delay
        _downloadQueue.delete(cardId);
        return p;
      } catch { await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
    }
    _downloadQueue.delete(cardId);
    return null;
  })();

  _downloadQueue.set(cardId, promise);
  return promise;
}

// ── Binary packing ────────────────────────────────────────────────────────────
function packIndex(embeddings) {
  const entrySize = ID_LEN + DIMS * 4;
  const buf = Buffer.alloc(16 + embeddings.length * entrySize);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(1, 4);
  buf.writeUInt32LE(embeddings.length, 8);
  buf.writeUInt32LE(DIMS, 12);
  let offset = 16;
  for (const { id, vec } of embeddings) {
    const idBuf = Buffer.alloc(ID_LEN, 0);
    Buffer.from(id.slice(0, ID_LEN)).copy(idBuf);
    idBuf.copy(buf, offset); offset += ID_LEN;
    for (let i = 0; i < DIMS; i++) { buf.writeFloatLE(vec[i], offset); offset += 4; }
  }
  return buf;
}

// ── Firebase upload ───────────────────────────────────────────────────────────
async function uploadStorage(localPath, remotePath, contentType) {
  const data    = readFileSync(localPath);
  const encoded = encodeURIComponent(remotePath);
  const url     = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}&key=${API_KEY}`;
  const res     = await httpsUpload(url, data, contentType);
  if (res.status !== 200) throw new Error(`Upload failed: ${res.status} ${res.body.slice(0, 200)}`);
  const mb = (data.length / 1024 / 1024).toFixed(1);
  console.log(`  ✓ Uploaded ${remotePath} (${mb} MB)`);
}

async function updateFirestore(fields) {
  const doc = { fields: Object.fromEntries(
    Object.entries(fields).map(([k, v]) =>
      [k, typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) }]
    )
  )};
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/meta/embeddingIndex?key=${API_KEY}`;
  const res = await httpsPatch(url, JSON.stringify(doc));
  if (res.status !== 200) console.warn(`  Firestore update: ${res.status}`);
  else console.log("  ✓ Firestore meta updated");
}

// ── Worker pool ───────────────────────────────────────────────────────────────
function spawnWorker(id) {
  return new Worker(__filename, {
    workerData: { workerId: id, imgCacheDir: IMG_CACHE_DIR, cropCacheDir: CROP_CACHE_DIR },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(IMG_CACHE_DIR,  { recursive: true });
  mkdirSync(CROP_CACHE_DIR, { recursive: true });

  if (UPLOAD_ONLY) {
    console.log("\n  Upload-only mode...");
    await uploadStorage(INDEX_FILE, "embeddings/global-v1.bin", "application/octet-stream");
    await uploadStorage(META_FILE,  "embeddings/cards-meta.json", "application/json");
    const buf     = readFileSync(INDEX_FILE);
    const count   = buf.readUInt32LE(8);
    const version = new Date().toISOString().slice(0, 10);
    await updateFirestore({
      version, count, dims: DIMS,
      checksum: createHash("md5").update(buf).digest("hex").slice(0, 8),
      model: "Xenova/dinov2-base-multicrop",
      storagePath: "embeddings/global-v1.bin",
      metaPath: "embeddings/cards-meta.json",
      updatedAt: version,
    });
    return;
  }

  // ── Load cards & checkpoint ──────────────────────────────────────────────
  process.stdout.write(ANSI.clear);
  console.log(`\n  ${ANSI.bold}${ANSI.teal}MTGTracker Embedding Pipeline${ANSI.reset}`);
  console.log(`  ${ANSI.grey}${NUM_WORKERS} worker threads · ${CPU_CORES} CPU cores detected${ANSI.reset}\n`);

  const cards = await fetchAllCards();
  const done  = {};

  if (RESUME && existsSync(CHECKPOINT)) {
    const cp = JSON.parse(readFileSync(CHECKPOINT, "utf-8"));
    Object.assign(done, cp);
    console.log(`  Resuming: ${Object.keys(done).length.toLocaleString()} / ${cards.length.toLocaleString()} already done\n`);
  }

  const todo  = cards.filter(c => !done[c.id] && c.image_uris?.large);
  const total = todo.length;

  if (total === 0) {
    console.log("  All cards already embedded — running upload...\n");
  } else {
    console.log(`  ${total.toLocaleString()} cards to embed (${CROPS.length} crops each = ~${(total * CROPS.length).toLocaleString()} embeddings)`);
    console.log(`  ${ANSI.grey}Tip: leave plugged in and don't let Mac sleep${ANSI.reset}\n`);

    // ── Spawn workers ────────────────────────────────────────────────────────
    console.log(`  Loading DINOv2 model on ${NUM_WORKERS} workers...`);
    const workers  = [];
    const freePool = []; // worker ids that are idle
    const pending  = new Map(); // jobId → { resolve, reject, cardId }
    let   jobIdSeq = 0;

    await new Promise((resolve, reject) => {
      let loaded = 0;
      for (let i = 0; i < NUM_WORKERS; i++) {
        const w = spawnWorker(i);
        workers.push(w);
        w.on("message", msg => {
          if (msg.type === "workerLoaded") {
            w.postMessage({ type: "init" });
          } else if (msg.type === "ready") {
            loaded++;
            freePool.push(msg.workerId);
            if (loaded === NUM_WORKERS) resolve();
          } else if (msg.type === "done" || msg.type === "failed") {
            const job = pending.get(msg.jobId);
            if (job) {
              pending.delete(msg.jobId);
              freePool.push(msg.workerId);
              if (msg.type === "done") job.resolve({ cardId: msg.cardId, vecs: msg.vecs, workerId: msg.workerId });
              else job.reject(new Error(msg.msg || "worker failed"));
            }
          } else if (msg.type === "error") {
            reject(new Error(`Worker ${msg.workerId}: ${msg.msg}`));
          }
        });
        w.on("error", reject);
      }
    });

    console.log(`  ${ANSI.green}✓ All ${NUM_WORKERS} workers ready${ANSI.reset}\n`);

    // ── Dispatch loop ────────────────────────────────────────────────────────
    const progress  = new ProgressDisplay(total, NUM_WORKERS);
    let   processed = 0;
    let   errors    = 0;
    const startTime = Date.now();

    // Submit a job to a specific worker
    function submitJob(workerId, card, imgPath) {
      return new Promise((resolve, reject) => {
        const jobId = jobIdSeq++;
        pending.set(jobId, { resolve, reject, cardId: card.id });
        workers[workerId].postMessage({ type: "embed", cardId: card.id, imgPath, jobId });
      });
    }

    // Pipeline: download images in main thread, embed in worker threads
    // Use a semaphore to keep NUM_WORKERS jobs in-flight at all times
    const inFlight  = new Set();
    const cardQueue = [...todo];
    let   queueIdx  = 0;

    async function drainOne() {
      if (queueIdx >= cardQueue.length) return false;
      const card = cardQueue[queueIdx++];

      // Download image (main thread, non-blocking for other downloads)
      const imgPath = await getImage(card.id, card.image_uris.large);

      if (!imgPath) {
        errors++;
        processed++;
        progress.update(processed, errors);
        return true;
      }

      // Wait for a free worker
      while (freePool.length === 0) await new Promise(r => setTimeout(r, 10));
      const workerId = freePool.shift();

      progress.update(processed, errors, workerId, card.name);

      submitJob(workerId, card, imgPath)
        .then(({ cardId, vecs, workerId: wid }) => {
          done[cardId] = vecs;
          processed++;
          errors = Math.max(0, errors); // keep error count
          progress.update(processed, errors, wid, "✓ " + card.name);

          // Checkpoint periodically
          if (processed % CHECKPOINT_INTERVAL === 0) {
            writeFileSync(CHECKPOINT, JSON.stringify(done));
          }
        })
        .catch(() => {
          errors++;
          processed++;
          progress.update(processed, errors);
        });

      return true;
    }

    // Flood the queue — keep NUM_WORKERS * 2 tasks dispatched at once
    // so workers are never starved waiting for image downloads
    const PREFETCH = NUM_WORKERS * 2;
    const active   = new Set();

    async function runQueue() {
      while (queueIdx < cardQueue.length || active.size > 0) {
        while (active.size < PREFETCH && queueIdx < cardQueue.length) {
          const p = drainOne();
          active.add(p);
          p.finally(() => active.delete(p));
        }
        await Promise.race([...active]);
      }
    }

    await runQueue();

    // Final checkpoint
    writeFileSync(CHECKPOINT, JSON.stringify(done));

    for (const w of workers) w.terminate();

    const elapsed = Date.now() - startTime;
    progress.finish(Object.keys(done).length, elapsed);
  }

  // ── Pack index ───────────────────────────────────────────────────────────
  console.log("  Packing binary index...");
  const embeddings = [];
  for (const [id, vecs] of Object.entries(done)) {
    for (const vec of vecs) embeddings.push({ id, vec });
  }
  const packed = packIndex(embeddings);
  writeFileSync(INDEX_FILE, packed);
  const sizeMB = (packed.length / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${embeddings.length.toLocaleString()} entries packed (${sizeMB} MB)`);

  // ── Build metadata ───────────────────────────────────────────────────────
  console.log("  Building card metadata...");
  const allCards = JSON.parse(readFileSync(CARDS_CACHE, "utf-8"));
  const byId  = Object.fromEntries(allCards.map(c => [c.id, c]));
  const meta  = {};
  for (const id of Object.keys(done)) {
    const c = byId[id];
    if (c) meta[id] = {
      id, name: c.name || "", set: c.set || "", set_name: c.set_name || "",
      number: c.collector_number || "", rarity: c.rarity || "",
      type_line: c.type_line || "",
      image_uris: { small: c.image_uris?.small || "", normal: c.image_uris?.normal || "" },
      prices: c.prices || {},
    };
  }
  writeFileSync(META_FILE, JSON.stringify(meta));
  console.log(`  ✓ Metadata for ${Object.keys(meta).length.toLocaleString()} cards`);

  // ── Upload ───────────────────────────────────────────────────────────────
  console.log("\n  Uploading to Firebase Storage...");
  await uploadStorage(INDEX_FILE, "embeddings/global-v1.bin", "application/octet-stream");
  await uploadStorage(META_FILE,  "embeddings/cards-meta.json", "application/json");

  const version  = new Date().toISOString().slice(0, 10);
  const checksum = createHash("md5").update(packed).digest("hex").slice(0, 8);
  await updateFirestore({
    version, count: embeddings.length, dims: DIMS, checksum,
    model: "Xenova/dinov2-base-multicrop",
    storagePath: "embeddings/global-v1.bin",
    metaPath: "embeddings/cards-meta.json",
    updatedAt: version,
  });

  console.log(`\n  ${ANSI.green}${ANSI.bold}Pipeline complete!${ANSI.reset}`);
  console.log(`  ${ANSI.grey}${Object.keys(done).length.toLocaleString()} cards · ${embeddings.length.toLocaleString()} embeddings${ANSI.reset}\n`);
}

main().catch(e => {
  console.error(`\n  ${ANSI.red}Fatal: ${e.message}${ANSI.reset}\n`);
  process.exit(1);
});
} // end else (main thread)
