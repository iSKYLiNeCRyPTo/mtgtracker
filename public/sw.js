const APP_CACHE   = "mtgtracker-v1";
const IMAGE_CACHE = "mtgtracker-images-v1";
const STATIC = ["/", "/index.html"];

const NO_CACHE_HOSTS = [
  "api.scryfall.com", "api.anthropic.com",
  "workers.dev", "firestore.googleapis.com", "firebase.googleapis.com",
  "identitytoolkit.googleapis.com", "securetoken.googleapis.com",
];

const IMAGE_HOSTS = [
  "cards.scryfall.io",
  "c1.scryfall.com",
  "svgs.scryfall.io",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(APP_CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== APP_CACHE && k !== IMAGE_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Pre-cache images sent from the app
self.addEventListener("message", e => {
  if (e.data?.type === "PRECACHE_IMAGES") {
    precacheImages(e.data.urls || []);
  }
});

async function precacheImages(urls) {
  const cache = await caches.open(IMAGE_CACHE);
  const BATCH = 5;
  for (let i = 0; i < urls.length; i += BATCH) {
    await Promise.allSettled(
      urls.slice(i, i + BATCH).map(async url => {
        if (await cache.match(url)) return; // already cached
        try {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) await cache.put(url, res); // res only used once — no clone needed
        } catch (_) {}
      })
    );
  }
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (!url.protocol.startsWith("http")) return;

  // Never cache live APIs
  if (NO_CACHE_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Cross-origin images: don't intercept — let the browser handle <img> requests
  // directly (no-cors). Re-fetching via the SW upgrades the request to cors mode
  // and triggers CORS errors. Precaching still happens via PRECACHE_IMAGES messages.
  if (IMAGE_HOSTS.some(h => url.hostname.includes(h))) {
    return;
  }

  // Same-origin assets: network-first, cache fallback
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          caches.open(APP_CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
