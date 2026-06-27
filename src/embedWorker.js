import { pipeline, env } from "@xenova/transformers";
env.allowLocalModels = false;

const log = (msg) => self.postMessage({ type: "log", msg });

let extractor        = null;
let setEmbeddings    = [];  // [{id, vec: Float32Array}] — current set
let globalEmbeddings = []; // [{id, vec: Float32Array}] — all cards, global index
let useGlobal        = false;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function getExtractor() {
  if (!extractor) {
    log("Loading DINOv2 model...");
    extractor = await pipeline("image-feature-extraction", "Xenova/dinov2-base", {
      device: "wasm",
      progress_callback: (p) => {
        if (p.status === "downloading") {
          const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
          log(`Downloading ${p.file}: ${pct}%`);
        }
      }
    });
    log("DINOv2 model ready");
  }
  return extractor;
}

function extractCLS(out, dims = 768) {
  const data = out.data;
  const vec  = new Float32Array(dims);
  for (let i = 0; i < dims; i++) vec[i] = data[i];
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) + 1e-8;
  for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

function scoreAll(queryVec, embeddings) {
  const best = {};
  for (const e of embeddings) {
    const s = cosine(queryVec, e.vec);
    if (best[e.id] === undefined || s > best[e.id]) best[e.id] = s;
  }
  return Object.entries(best)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ── Binary index parsing (MTGT format) ───────────────────────────────────────
const MAGIC  = [0x4D, 0x54, 0x47, 0x54]; // "MTGT"
const ID_LEN = 36; // Scryfall UUIDs are 36 chars

function parseGlobalIndex(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  for (let i = 0; i < 4; i++) {
    if (view.getUint8(offset + i) !== MAGIC[i]) throw new Error("Invalid index magic");
  }
  offset += 4;

  const version = view.getUint32(offset, true); offset += 4;
  const count   = view.getUint32(offset, true); offset += 4;
  const dims    = view.getUint32(offset, true); offset += 4;

  log(`Parsing global index: ${count} cards, ${dims} dims (v${version})`);

  const embeddings = [];
  const textDecoder = new TextDecoder("ascii");

  for (let i = 0; i < count; i++) {
    const idBytes = new Uint8Array(buffer, offset, ID_LEN);
    let idEnd = idBytes.indexOf(0);
    if (idEnd === -1) idEnd = ID_LEN;
    const id = textDecoder.decode(idBytes.slice(0, idEnd));
    offset += ID_LEN;

    const vec = new Float32Array(buffer, offset, dims);
    offset += dims * 4;

    embeddings.push({ id, vec: new Float32Array(vec) });
  }

  log(`✓ Parsed ${embeddings.length} global embeddings`);
  return embeddings;
}

self.onmessage = async (e) => {
  const { type } = e.data;

  if (type === "preload") {
    getExtractor().catch(() => {});
    return;
  }

  if (type === "init") {
    try {
      await getExtractor();
      self.postMessage({ type: "ready" });
    } catch (err) {
      log(`Init error: ${err.message}`);
      self.postMessage({ type: "error", msg: `Init failed: ${err.message}` });
    }
  }

  if (type === "loadEmbeddings") {
    setEmbeddings = e.data.embeddings.map(e => ({
      id:  e.id,
      vec: new Float32Array(e.vec),
    }));
    useGlobal = false;
    log(`Loaded ${setEmbeddings.length} set embeddings`);
    self.postMessage({ type: "loadedEmbeddings", count: setEmbeddings.length });
  }

  if (type === "loadGlobalIndex") {
    try {
      globalEmbeddings = parseGlobalIndex(e.data.buffer);
      if (e.data.fingerprints) {
        let added = 0;
        for (const [cardId, fps] of Object.entries(e.data.fingerprints)) {
          for (const fp of fps) {
            globalEmbeddings.push({ id: cardId, vec: new Float32Array(fp.vec) });
            added++;
          }
        }
        if (added) log(`Merged ${added} crowdsourced fingerprints`);
      }
      log("Pre-loading DINOv2 model...");
      await getExtractor();
      self.postMessage({ type: "globalIndexLoaded", count: globalEmbeddings.length });
    } catch (err) {
      log(`Global index parse error: ${err.message}`);
      self.postMessage({ type: "error", msg: `Global index failed: ${err.message}` });
    }
  }

  if (type === "setMode") {
    useGlobal = e.data.global === true;
    log(`Query mode: ${useGlobal ? "global" : "set-scoped"}`);
  }

  if (type === "embedSet") {
    const cards = e.data.cards;
    setEmbeddings = [];
    let done = 0;
    log(`Embedding ${cards.length} cards...`);

    const ext = await getExtractor();
    const CONCURRENCY = 3;
    let idx = 0;
    const results = new Array(cards.length);

    const worker = async () => {
      while (idx < cards.length) {
        const myIdx = idx++;
        const card = cards[myIdx];
        try {
          const out = await ext(card.imageUrl);
          const vec = extractCLS(out);
          results[myIdx] = { id: card.id, vec };
        } catch (err) {
          log(`Skip ${card.name}: ${err.message}`);
        }
        done++;
        self.postMessage({ type: "progress", done, total: cards.length, name: card.name });
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    setEmbeddings = results.filter(Boolean);
    log(`Done: ${setEmbeddings.length}/${cards.length} embedded`);

    self.postMessage({
      type: "setEmbeddings",
      embeddings: setEmbeddings.map(e => ({ id: e.id, vec: e.vec })),
    });
  }

  if (type === "embedQuery") {
    try {
      const ext = await getExtractor();
      const out = await ext(e.data.dataURL);
      const queryVec = extractCLS(out);
      const index = useGlobal ? globalEmbeddings : setEmbeddings;
      const matches = scoreAll(queryVec, index).slice(0, 8);
      self.postMessage({
        type: "queryResult",
        matches,
        queryVec: Array.from(queryVec),
        wasGlobal: useGlobal,
        gen: e.data.gen,
      });
    } catch (err) {
      log(`Query error: ${err.message}`);
      self.postMessage({ type: "error", msg: `Query failed: ${err.message}` });
    }
  }

  if (type === "addFingerprint") {
    const vec = new Float32Array(e.data.vec);
    const id  = e.data.id;

    if (useGlobal) {
      globalEmbeddings.push({ id, vec });
    } else {
      setEmbeddings.push({ id, vec });
    }
    log(`Added fingerprint for ${id} (global: ${useGlobal})`);

    if (!useGlobal) {
      self.postMessage({
        type: "setEmbeddings",
        embeddings: setEmbeddings.map(e => ({ id: e.id, vec: Array.from(e.vec) })),
        cacheKey: e.data.cacheKey,
      });
    }
  }
};
