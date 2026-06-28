// Search worker — runs card filtering off the main thread.
// Receives a lightweight pre-lowercased index once, then handles search queries.
// Returns matched card IDs so the main thread can look up full objects.

let items = []; // [{ id, n, num, s, sid }] — all lowercase

self.onmessage = ({ data }) => {
  if (data.type === 'index') {
    items = data.items;
    self.postMessage({ type: 'ready', count: items.length });

  } else if (data.type === 'search') {
    const { query, reqId } = data;
    const q = query.toLowerCase().trim();
    if (!q) { self.postMessage({ type: 'results', reqId, ids: [] }); return; }

    const matched = [];
    for (let i = 0; i < items.length; i++) {
      const c = items[i];
      if (c.n.includes(q) || c.num === q || c.s.includes(q) || c.sid === q || c.r.includes(q)) {
        matched.push(i);
      }
    }

    matched.sort((ai, bi) => {
      const a = items[ai], b = items[bi];
      const as = a.n.startsWith(q) ? 0 : 1;
      const bs = b.n.startsWith(q) ? 0 : 1;
      return as - bs || a.n.localeCompare(b.n);
    });

    self.postMessage({ type: 'results', reqId, ids: matched.slice(0, 48).map(i => items[i].id) });
  }
};
