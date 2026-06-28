// firebase.js — Firebase/Firestore integration for MTGTracker
import { initializeApp }              from "firebase/app";
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signInWithRedirect, getRedirectResult,
         signOut, onAuthStateChanged }         from "firebase/auth";
import { getFirestore, doc, setDoc,
         getDoc, collection as coll, getDocs,
         onSnapshot, writeBatch,
         serverTimestamp }            from "firebase/firestore";

// ─── Replace with your own Firebase project config ────────────────────────────
// Create a new Firebase project at https://console.firebase.google.com
// Enable: Authentication (Google), Firestore, Storage
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || "REPLACE.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || "REPLACE_PROJECT_ID",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || "REPLACE.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| "REPLACE",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || "REPLACE",
};

let app, auth, db;
let _initialized = false;

export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith("REPLACE");
}

function init() {
  if (_initialized) return;
  app  = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db   = getFirestore(app);
  _initialized = true;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// On iOS Safari and standalone PWA, signInWithPopup is blocked.
// Use redirect-based flow on mobile; popup on desktop.
function isMobileBrowser() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) ||
    (navigator.standalone === true) || // iOS PWA
    window.matchMedia("(display-mode: standalone)").matches; // Android PWA
}

export async function signInWithGoogle() {
  init();
  if (!auth) return null;
  const provider = new GoogleAuthProvider();
  if (isMobileBrowser()) {
    // Redirect flow — result handled in handleRedirectResult() on next page load
    try { await signInWithRedirect(auth, provider); } catch (e) {
      console.error("[Firebase] Redirect sign in failed:", e);
    }
    return null; // page will redirect away
  }
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (e) {
    console.error("[Firebase] Sign in failed:", e);
    return null;
  }
}

// Call once on app startup to complete a pending redirect sign-in
export async function handleRedirectResult() {
  init();
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (e) {
    console.error("[Firebase] Redirect result failed:", e);
    return null;
  }
}

export async function signOutUser() {
  init();
  if (!auth) return;
  await signOut(auth);
}

export function onAuthChange(callback) {
  init();
  if (!auth) { callback(null); return () => {}; }
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  init();
  return auth?.currentUser || null;
}

// ── Collection sync ───────────────────────────────────────────────────────────

export async function saveCollectionToFirestore(uid, collection) {
  if (!db || !uid) return false;
  try {
    const chunks = chunkArray(collection, 400);
    const colRef = coll(db, "users", uid, "collection");

    // Read existing chunk docs to delete any that are now beyond the new chunk count
    const existing = await getDocs(colRef);
    const batch = writeBatch(db);
    existing.forEach(d => {
      const idx = parseInt(d.id.replace("chunk_", ""), 10);
      if (!isNaN(idx) && idx >= chunks.length) batch.delete(d.ref);
    });

    chunks.forEach((chunk, i) => {
      batch.set(doc(db, "users", uid, "collection", `chunk_${i}`), {
        items:       chunk,
        updatedAt:   serverTimestamp(),
        chunkIndex:  i,
        totalChunks: chunks.length,
      });
    });
    await batch.commit();
    return true;
  } catch (e) {
    console.error("[Firebase] saveCollection failed:", e);
    return false;
  }
}

export async function loadCollectionFromFirestore(uid) {
  if (!db || !uid) return null;
  try {
    const snap = await getDocs(coll(db, "users", uid, "collection"));
    if (snap.empty) return null;
    const chunks = [];
    snap.forEach(d => chunks.push(d.data()));
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return chunks.flatMap(c => c.items);
  } catch (e) {
    console.error("[Firebase] loadCollection failed:", e);
    return null;
  }
}

// ── Boxes sync ────────────────────────────────────────────────────────────────

export async function saveBoxesToFirestore(uid, boxes) {
  if (!db || !uid) return false;
  try {
    await setDoc(doc(db, "users", uid, "data", "boxes"), {
      boxes,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error("[Firebase] saveBoxes failed:", e);
    return false;
  }
}

export async function loadBoxesFromFirestore(uid) {
  if (!db || !uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid, "data", "boxes"));
    if (!snap.exists()) return null;
    return snap.data().boxes || [];
  } catch (e) {
    console.error("[Firebase] loadBoxes failed:", e);
    return null;
  }
}

// ── Shared embeddings ─────────────────────────────────────────────────────────

export async function saveEmbeddingsToFirestore(setId, embeddings) {
  if (!db) return false;
  try {
    await setDoc(doc(db, "shared", "embeddings", "sets", setId), {
      embeddings: JSON.stringify(embeddings),
      count:      embeddings.length,
      updatedAt:  serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error("[Firebase] saveEmbeddings failed:", e);
    return false;
  }
}

export async function loadEmbeddingsFromFirestore(setId) {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, "shared", "embeddings", "sets", setId));
    if (!snap.exists()) return null;
    return JSON.parse(snap.data().embeddings);
  } catch (e) {
    return null;
  }
}

// ── Real-time listener ────────────────────────────────────────────────────────

export function listenToUserData(uid, onUpdate) {
  if (!db || !uid) return () => {};

  // Batch independent snapshot callbacks so they arrive as one update,
  // preventing the UI from rendering an intermediate state where boxes are
  // updated but the collection isn't (or vice versa) during initial load.
  let pending = {};
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    const snapshot = { ...pending };
    pending = {};
    if (snapshot.boxes !== undefined) onUpdate("boxes", snapshot.boxes);
    if (snapshot.collection !== undefined) onUpdate("collection", snapshot.collection);
  };
  const schedule = (key, value) => {
    pending[key] = value;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 30);
  };

  const unsubs = [];
  unsubs.push(
    onSnapshot(doc(db, "users", uid, "data", "boxes"), (snap) => {
      if (snap.exists()) schedule("boxes", snap.data().boxes || []);
    }, (e) => console.warn("[Firebase] boxes listener:", e))
  );
  unsubs.push(
    onSnapshot(coll(db, "users", uid, "collection"), (snap) => {
      if (!snap.empty) {
        const chunks = [];
        snap.forEach(d => chunks.push(d.data()));
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        schedule("collection", chunks.flatMap(c => c.items));
      }
    }, (e) => console.warn("[Firebase] collection listener:", e))
  );
  return () => { clearTimeout(flushTimer); unsubs.forEach(u => u()); };
}

// ── Global Embedding Index ────────────────────────────────────────────────────
// Binary index of DINOv2 embeddings for all MTG cards (MTGT format).
// Built by pipeline/build_node.mjs, stored in Firebase Storage.
// All users share the same index — downloaded once, cached in IndexedDB.

export async function getEmbeddingIndexMeta() {
  init();
  const apiKey    = firebaseConfig.apiKey;
  const projectId = firebaseConfig.projectId;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/meta/embeddingIndex?key=${apiKey}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const f = data.fields || {};
    return {
      version:     f.version?.stringValue || null,
      count:       parseInt(f.count?.integerValue || 0),
      storagePath: f.storagePath?.stringValue || "embeddings/global-v1.bin",
      metaPath:    f.metaPath?.stringValue || "embeddings/cards-meta.json",
      checksum:    f.checksum?.stringValue || null,
    };
  } catch { return null; }
}

export async function downloadEmbeddingIndex(storagePath) {
  const bucket  = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket;
  const encoded = encodeURIComponent(storagePath);
  // Try CF worker proxy first if configured (avoids CORS on large binary files)
  const cfWorker = import.meta.env.VITE_CF_WORKER || "";
  if (cfWorker) {
    try {
      const resp = await fetch(`${cfWorker}/firebase-storage/${bucket}/${encoded}`);
      if (resp.ok) return await resp.arrayBuffer();
    } catch {}
  }
  // Direct Firebase Storage (works when bucket is public or auth token is present)
  const direct = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?alt=media`;
  const resp = await fetch(direct);
  if (!resp.ok) throw new Error(`Storage fetch failed: ${resp.status}`);
  return await resp.arrayBuffer();
}

export async function downloadCardsMeta(metaPath) {
  const bucket  = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket;
  const encoded = encodeURIComponent(metaPath);
  const cfWorker = import.meta.env.VITE_CF_WORKER || "";
  if (cfWorker) {
    try {
      const resp = await fetch(`${cfWorker}/firebase-storage/${bucket}/${encoded}`);
      if (resp.ok) return await resp.json();
    } catch {}
  }
  const direct = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?alt=media`;
  const resp = await fetch(direct);
  if (!resp.ok) throw new Error(`Cards meta fetch failed: ${resp.status}`);
  return await resp.json();
}

export async function loadGlobalFingerprints() {
  init();
  const apiKey    = firebaseConfig.apiKey;
  const projectId = firebaseConfig.projectId;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shared/globalFingerprints?key=${apiKey}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return {};
    const data = await resp.json();
    const f = data.fields?.fingerprints?.mapValue?.fields || {};
    // Convert Firestore array format back to {cardId: [{vec: [...]}]}
    const result = {};
    for (const [cardId, val] of Object.entries(f)) {
      const arr = val.arrayValue?.values || [];
      result[cardId] = arr.map(v => {
        const vecVals = v.mapValue?.fields?.vec?.arrayValue?.values || [];
        return { vec: vecVals.map(n => parseFloat(n.doubleValue || n.integerValue || 0)) };
      });
    }
    return result;
  } catch { return {}; }
}

export async function pushGlobalFingerprint(cardId, vec) {
  // Store anonymously in shared/globalFingerprints Firestore doc
  // Cap at 10 vectors per card to limit storage
  init();
  const apiKey    = firebaseConfig.apiKey;
  const projectId = firebaseConfig.projectId;
  try {
    // Read current
    const existing = await loadGlobalFingerprints();
    const cardFps  = (existing[cardId] || []).slice(-9); // keep last 9, add new = 10 max
    cardFps.push({ vec: Array.from(vec), addedAt: Date.now() });

    // Build Firestore map field
    const cardMap = {};
    for (const [id, fps] of Object.entries({ ...existing, [cardId]: cardFps })) {
      cardMap[id] = {
        arrayValue: {
          values: fps.map(fp => ({
            mapValue: {
              fields: {
                vec: { arrayValue: { values: fp.vec.map(v => ({ doubleValue: v })) } },
                addedAt: { integerValue: String(fp.addedAt || Date.now()) },
              }
            }
          }))
        }
      };
    }

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shared/globalFingerprints?key=${apiKey}`;
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { fingerprints: { mapValue: { fields: cardMap } } } }),
    });
  } catch { /* non-blocking */ }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export function getFirestoreInstance() { init(); return db; }
export function getAuthInstance()      { init(); return auth; }

// ── Shared Price History ───────────────────────────────────────────────────────
// All users contribute to and read from a shared price history per card.
// We merge local snapshots with cloud snapshots, dedup by date, keep newest price.

export async function mergeSharedPriceHistory(cardId, localHistory) {
  if (!db) return localHistory;
  try {
    const ref  = doc(db, "shared", "prices", "cards", cardId);
    const snap = await getDoc(ref);
    const cloudHistory = snap.exists() ? (snap.data().history || []) : [];

    // Merge: combine local + cloud, dedup by date (keep highest price per date)
    const merged = new Map();
    [...cloudHistory, ...localHistory].forEach(entry => {
      const existing = merged.get(entry.date);
      // Prefer real (non-synthetic) snapshots, then highest price
      if (!existing ||
          (!entry.synthetic && existing.synthetic) ||
          (entry.synthetic === existing.synthetic && entry.price > existing.price)) {
        merged.set(entry.date, entry);
      }
    });

    return Array.from(merged.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-730);
  } catch (e) {
    return localHistory;
  }
}

export async function pushPriceSnapshotToShared(cardId, snapshot) {
  if (!db) return;
  try {
    const ref  = doc(db, "shared", "prices", "cards", cardId);
    const snap = await getDoc(ref);
    const history = snap.exists() ? (snap.data().history || []) : [];

    // Only update today's entry
    const idx = history.findIndex(h => h.date === snapshot.date);
    if (idx >= 0) {
      // Update if this is a real price or higher than stored
      if (!snapshot.synthetic && (history[idx].synthetic || snapshot.price > history[idx].price)) {
        history[idx] = snapshot;
      }
    } else {
      history.push(snapshot);
    }

    // Keep last 730 days, sorted
    const trimmed = history
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-730);

    await setDoc(ref, { history: trimmed, updatedAt: serverTimestamp() });
  } catch (e) {
    // Non-blocking — local save still works
  }
}

// ── Shared Fingerprints (extra per-card vectors from real scans) ──────────────
// Different from set embeddings — these are additional CLIP vectors from
// real camera scans, one per card per user scan. Improves recognition for
// all users over time.

export async function pushFingerprintToShared(setId, cardNumber, vec) {
  if (!db) return;
  try {
    const ref  = doc(db, "shared", "fingerprints", "sets", setId);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : { fingerprints: {} };
    const fps  = data.fingerprints || {};

    // Each card can have up to 20 extra fingerprint vectors
    const cardFps = fps[cardNumber] || [];
    cardFps.push({ vec: Array.from(vec), addedAt: Date.now() });
    if (cardFps.length > 20) cardFps.splice(0, cardFps.length - 20);
    fps[cardNumber] = cardFps;

    await setDoc(ref, {
      fingerprints: fps,
      updatedAt:    serverTimestamp(),
    });
  } catch (e) {}
}

export async function loadSharedFingerprints(setId) {
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, "shared", "fingerprints", "sets", setId));
    if (!snap.exists()) return null;
    return snap.data().fingerprints || null;
  } catch (e) {
    return null;
  }
}
