// cache.js — IndexedDB-backed cache for all API calls
// Wraps Scryfall fetches, fetchAllSets, fetchSetCards with read-before-fetch logic
//
// TTLs:
//   Card metadata (images, name, rarity, etc.) — 7 days  (rarely changes)
//   Set lists                                   — 7 days
//   Prices                                      — 24 hours (Scryfall updates daily)
//   Search results                              — 1 hour

const DB_NAME    = "mtgtracker-cache";
const DB_VERSION = 1;
const STORES = {
  cards:   { name: "cards",   ttl: 7 * 86400_000 },   // card metadata by ID
  sets:    { name: "sets",    ttl: 7 * 86400_000 },   // set lists by set ID
  prices:  { name: "prices",  ttl:     86400_000 },   // price data by card ID
  search:  { name: "search",  ttl:  3600_000 },        // search query results
  groups:  { name: "groups",  ttl: 7 * 86400_000 },   // Scryfall API responses (sets, cards)
};

// ── Open DB ──────────────────────────────────────────────────────────────────
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      Object.values(STORES).forEach(({ name }) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "k" });
        }
      });
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
  });
}

// ── Generic get / set / del ──────────────────────────────────────────────────
async function cacheGet(storeName, key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec) return resolve(null);
        const ttl = STORES[storeName]?.ttl ?? 3600_000;
        if (Date.now() - rec.at > ttl) return resolve(null); // expired
        resolve(rec.v);
      };
      req.onerror = () => resolve(null);
    });
  } catch (_) { return null; }
}

async function cacheSet(storeName, key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put({ k: key, v: value, at: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => resolve(false);
    });
  } catch (_) { return false; }
}

// ── Public cache helpers ─────────────────────────────────────────────────────

/** Cache a card by its Scryfall UUID */
export async function cacheCard(card) {
  if (!card?.id) return;
  await cacheSet("cards", card.id, card);
}

/** Get a cached card by ID, or null */
export async function getCachedCard(id) {
  return cacheGet("cards", id);
}

/** Cache multiple cards at once */
export async function cacheCards(cards) {
  for (const card of cards) await cacheCard(card);
}

/** Cache a set's card list */
export async function cacheSetCards(setId, cards) {
  await cacheSet("sets", setId, cards);
}

/** Get cached set card list */
export async function getCachedSetCards(setId) {
  return cacheGet("sets", setId);
}

/** Cache price data for a card */
export async function cachePriceData(cardId, priceData) {
  await cacheSet("prices", cardId, priceData);
}

/** Get cached price data */
export async function getCachedPriceData(cardId) {
  return cacheGet("prices", cardId);
}

/** Cache a search result (by query string) */
export async function cacheSearchResult(query, results) {
  await cacheSet("search", query.toLowerCase().trim(), results);
}

/** Get cached search result */
export async function getCachedSearchResult(query) {
  return cacheGet("search", query.toLowerCase().trim());
}

/** Cache Scryfall API responses (sets, search, etc.) */
export async function cacheGroups(key, data) {
  await cacheSet("groups", key, data);
}

export async function getCachedGroups(key) {
  return cacheGet("groups", key);
}

/** Clear all caches (useful for debugging) */
export async function clearAllCaches() {
  try {
    const db = await openDB();
    await Promise.all(
      Object.keys(STORES).map(storeName =>
        new Promise((resolve) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).clear();
          tx.oncomplete = resolve;
        })
      )
    );
    console.log("[Cache] Cleared all caches");
  } catch (_) {}
}

/** Return cache stats (counts per store) */
export async function getCacheStats() {
  try {
    const db = await openDB();
    const stats = {};
    await Promise.all(
      Object.keys(STORES).map(storeName =>
        new Promise((resolve) => {
          const tx  = db.transaction(storeName, "readonly");
          const req = tx.objectStore(storeName).count();
          req.onsuccess = () => { stats[storeName] = req.result; resolve(); };
          req.onerror   = () => { stats[storeName] = 0; resolve(); };
        })
      )
    );
    return stats;
  } catch (_) { return {}; }
}
