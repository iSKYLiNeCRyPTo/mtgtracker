/**
 * DecksView.jsx — Deck builder + life counter + portfolio for MTGTracker
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { computeAutoTags, getTagMeta } from "./cardTags.jsx";

// ── Constants ─────────────────────────────────────────────────────────────────
const TEAL   = "#00D4AA";
const CARD   = "#111111";
const BORDER = "#1e1e1e";
const BG     = "#0a0a0a";

const FORMATS = [
  { id:"commander",   label:"Commander",    life:40,  maxCards:100, singleton:true  },
  { id:"oathbreaker", label:"Oathbreaker",  life:20,  maxCards:60,  singleton:true  },
  { id:"standard",    label:"Standard",     life:20,  maxCards:60,  singleton:false },
  { id:"pioneer",     label:"Pioneer",      life:20,  maxCards:60,  singleton:false },
  { id:"modern",      label:"Modern",       life:20,  maxCards:60,  singleton:false },
  { id:"legacy",      label:"Legacy",       life:20,  maxCards:60,  singleton:false },
  { id:"vintage",     label:"Vintage",      life:20,  maxCards:60,  singleton:false },
  { id:"pauper",      label:"Pauper",       life:20,  maxCards:60,  singleton:false },
  { id:"brawl",       label:"Brawl",        life:25,  maxCards:60,  singleton:true  },
  { id:"draft",       label:"Limited/Draft",life:20,  maxCards:40,  singleton:false },
  { id:"casual",      label:"Casual",       life:20,  maxCards:60,  singleton:false },
];

const FORMAT_COLORS = {
  commander:"#a855f7", oathbreaker:"#ec4899", standard:"#3b82f6",
  pioneer:"#06b6d4", modern:"#f59e0b", legacy:"#ef4444",
  vintage:"#f97316", pauper:"#6b7280", brawl:"#8b5cf6",
  draft:"#10b981", casual:"#6b7280",
};

const TYPE_ORDER = ["Creature","Planeswalker","Instant","Sorcery","Artifact","Enchantment","Land","Other"];

const COND_COLORS = { near_mint:"#00D4AA", lightly_played:"#3b82f6", moderately_played:"#f97316", heavily_played:"#ef4444", damaged:"#7f1d1d" };
const COND_ABBR   = { near_mint:"NM", lightly_played:"LP", moderately_played:"MP", heavily_played:"HP", damaged:"DMG" };

function PortfolioSpark({ history, color = TEAL }) {
  if (!history?.length) return null;
  const W = 56, H = 20;
  const vals = history.map(d => d.price || 0);
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => {
    const x = n > 1 ? (i / (n-1)) * W : W/2;
    const y = H - ((v-min)/rng)*(H-4)-2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display:"block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

const fmt = (n) => {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1000) return "$" + (n/1000).toFixed(1) + "k";
  return "$" + (+n).toFixed(2);
};

// ── Storage ───────────────────────────────────────────────────────────────────
const DECKS_KEY = "mtg-decks-v1";

function loadDecks() {
  try { return JSON.parse(localStorage.getItem(DECKS_KEY) || "[]"); } catch { return []; }
}
function saveDecks(decks) {
  try { localStorage.setItem(DECKS_KEY, JSON.stringify(decks)); } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCardType(card) {
  const tl = (card.type_line || "").toLowerCase();
  if (tl.includes("creature"))     return "Creature";
  if (tl.includes("planeswalker")) return "Planeswalker";
  if (tl.includes("instant"))      return "Instant";
  if (tl.includes("sorcery"))      return "Sorcery";
  if (tl.includes("artifact"))     return "Artifact";
  if (tl.includes("enchantment"))  return "Enchantment";
  if (tl.includes("land"))         return "Land";
  return "Other";
}

function deckCardCount(deck) {
  return (deck.cards || []).reduce((s, c) => s + (c.qty || 1), 0);
}

function deckValue(deck) {
  return (deck.cards || []).reduce((s, c) => {
    const price = parseFloat((c.foil ? c.card?.prices?.usd_foil : c.card?.prices?.usd) || c.card?.prices?.usd || 0);
    return s + price * (c.qty || 1);
  }, 0);
}

function deckOwnedCount(deck) {
  return (deck.cards || []).filter(c => c.owned).reduce((s, c) => s + (c.qty || 1), 0);
}

function colorIdentityPips(deck) {
  const colors = new Set();
  (deck.cards || []).forEach(c => {
    (c.card?.color_identity || []).forEach(col => colors.add(col));
  });
  return [...colors].sort();
}

function isDeckLegal(deck) {
  const legalFormats = ["commander","standard","pioneer","modern","legacy","vintage","pauper","brawl","oathbreaker"];
  if (!legalFormats.includes(deck.format)) return null;
  if (!deck.cards?.length) return null;
  return deck.cards.every(c => {
    const leg = c.card?.legalities?.[deck.format];
    return leg === "legal" || leg === "restricted";
  });
}

const MANA_COLORS = { W:"#f9fafb", U:"#3b82f6", B:"#a855f7", R:"#ef4444", G:"#22c55e" };

function ManaSymbol({ color, size = 14 }) {
  const bg = MANA_COLORS[color] || "#6b7280";
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:bg, border:"1.5px solid rgba(0,0,0,0.4)",
      display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <span style={{ fontSize:size*0.55, fontWeight:800, color: color === "W" ? "#000" : "#fff", lineHeight:1 }}>
        {color}
      </span>
    </div>
  );
}

// ── Mana Curve Chart ──────────────────────────────────────────────────────────
function ManaCurve({ cards }) {
  const maxCmc = 7;
  const buckets = Array.from({ length: maxCmc + 1 }, (_, i) => ({ cmc: i, count: 0 }));
  (cards || []).forEach(c => {
    const type = getCardType(c.card);
    if (type === "Land") return;
    const cmc = Math.min(Math.floor(c.card?.cmc || 0), maxCmc);
    buckets[cmc].count += (c.qty || 1);
  });
  const max = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div style={{ padding:"14px 16px", background:CARD, borderRadius:12, border:`1px solid ${BORDER}` }}>
      <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:10 }}>MANA CURVE</div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:4, height:56 }}>
        {buckets.map(b => (
          <div key={b.cmc} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <div style={{ width:"100%", background:TEAL+"44", borderRadius:"3px 3px 0 0",
              height: b.count > 0 ? `${(b.count / max) * 48}px` : 2,
              transition:"height 0.3s ease",
              ...(b.count > 0 ? { background: TEAL+"66" } : {}) }}/>
            <span style={{ fontSize:9, color:"#444" }}>{b.cmc === maxCmc ? `${maxCmc}+` : b.cmc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Deck List Item ────────────────────────────────────────────────────────────
function DeckCard({ deck, onOpen, onPlay, onDelete }) {
  const fmt_obj = FORMATS.find(f => f.id === deck.format) || FORMATS[0];
  const col = FORMAT_COLORS[deck.format] || "#6b7280";
  const cardCount = deckCardCount(deck);
  const value = deckValue(deck);
  const owned = deckOwnedCount(deck);
  const total = cardCount;
  const pips = colorIdentityPips(deck);
  const wins   = deck.record?.wins   || 0;
  const losses = deck.record?.losses || 0;
  const draws  = deck.record?.draws  || 0;
  const games  = wins + losses + draws;
  const winPct = games > 0 ? Math.round((wins / games) * 100) : null;
  const legal  = isDeckLegal(deck);

  return (
    <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:"16px",
      display:"flex", flexDirection:"column", gap:12 }}>
      {/* Header row */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:0.5,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"55vw" }}>
              {deck.name}
            </div>
            <span style={{ background:col+"22", border:`1px solid ${col}44`, color:col,
              fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:20, letterSpacing:0.5,
              flexShrink:0 }}>
              {fmt_obj.label.toUpperCase()}
            </span>
            {legal === true && (
              <span style={{ background:"#00D4AA22", border:"1px solid #00D4AA44", color:TEAL,
                fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:20, flexShrink:0 }}>
                ✓ LEGAL
              </span>
            )}
            {legal === false && (
              <span style={{ background:"#ef444422", border:"1px solid #ef444444", color:"#ef4444",
                fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:20, flexShrink:0 }}>
                ✗ ILLEGAL
              </span>
            )}
          </div>
          {deck.commander && (
            <div style={{ color:"#666", fontSize:12, marginTop:2 }}>⚔ {deck.commander}</div>
          )}
          {pips.length > 0 && (
            <div style={{ display:"flex", gap:4, marginTop:5 }}>
              {pips.map(p => <ManaSymbol key={p} color={p} size={16}/>)}
            </div>
          )}
        </div>
        <button onClick={(e)=>{ e.stopPropagation(); onDelete(deck.id); }}
          style={{ background:"none", border:"none", cursor:"pointer", padding:4, flexShrink:0, color:"#333" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2l10 10M12 2L2 12" stroke="#444" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display:"flex", gap:12 }}>
        <div style={{ flex:1 }}>
          <div style={{ color:"#444", fontSize:9, letterSpacing:0.5 }}>CARDS</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff" }}>
            {cardCount}
            {deck.format !== "draft" && (
              <span style={{ color:"#444", fontSize:12, fontWeight:400 }}>/{fmt_obj.maxCards}</span>
            )}
          </div>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ color:"#444", fontSize:9, letterSpacing:0.5 }}>OWNED</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
            color: owned === total && total > 0 ? TEAL : "#fff" }}>
            {owned}<span style={{ color:"#444", fontSize:12 }}>/{total}</span>
          </div>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ color:"#444", fontSize:9, letterSpacing:0.5 }}>VALUE</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:TEAL }}>{fmt(value)}</div>
        </div>
        {games > 0 && (
          <div style={{ flex:1 }}>
            <div style={{ color:"#444", fontSize:9, letterSpacing:0.5 }}>W/L</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
              color: winPct >= 60 ? TEAL : winPct >= 40 ? "#f59e0b" : "#ef4444" }}>
              {wins}–{losses}{draws > 0 ? `–${draws}` : ""}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => onOpen(deck)} style={{
          flex:1, padding:"10px 0", background:"#1a1a1a", border:`1px solid ${BORDER}`,
          borderRadius:10, color:"#888", fontSize:13, cursor:"pointer", fontFamily:"inherit",
        }}>Edit</button>
        <button onClick={() => onPlay(deck)} style={{
          flex:2, padding:"10px 0", background:TEAL, border:"none",
          borderRadius:10, color:"#000", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
          display:"flex", alignItems:"center", justifyContent:"center", gap:6,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <polygon points="3,2 12,7 3,12" fill="#000"/>
          </svg>
          Play
        </button>
      </div>
    </div>
  );
}

// ── New Deck Modal ────────────────────────────────────────────────────────────
function NewDeckModal({ onSave, onClose }) {
  const [name, setName]           = useState("");
  const [format, setFormat]       = useState("commander");
  const [commander, setCommander] = useState("");
  const [cmdSearch, setCmdSearch] = useState([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef(null);

  const isEDH = ["commander","brawl","oathbreaker"].includes(format);

  const searchCommander = async (q) => {
    if (!q.trim() || q.length < 2) { setCmdSearch([]); return; }
    setSearching(true);
    try {
      const filter = format === "commander"
        ? `${q} is:commander`
        : format === "oathbreaker" ? `${q} t:planeswalker` : q;
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(filter)}&unique=cards&order=released`, {
        headers:{ "User-Agent":"MTGTracker/1.0" }
      });
      if (res.ok) {
        const d = await res.json();
        setCmdSearch((d.data || []).slice(0, 6));
      }
    } catch {}
    setSearching(false);
  };

  return createPortal(
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", zIndex:10000,
      display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#141414", borderRadius:"20px 20px 0 0", width:"100%",
        padding:"20px 20px", paddingBottom:"calc(32px + env(safe-area-inset-bottom, 0px))", maxHeight:"90vh", overflowY:"auto" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff",
          letterSpacing:1, marginBottom:20 }}>NEW DECK</div>

        <div style={{ marginBottom:14 }}>
          <div style={{ color:"#555", fontSize:11, marginBottom:6, letterSpacing:0.5 }}>DECK NAME</div>
          <input value={name} onChange={e=>setName(e.target.value)}
            placeholder="My Deck..."
            style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
              padding:"12px 14px", color:"#fff", fontSize:15, fontFamily:"inherit",
              outline:"none", boxSizing:"border-box" }}/>
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ color:"#555", fontSize:11, marginBottom:6, letterSpacing:0.5 }}>FORMAT</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            {FORMATS.map(f => (
              <button key={f.id} onClick={()=>setFormat(f.id)} style={{
                padding:"8px 4px", borderRadius:8, cursor:"pointer", fontSize:11,
                fontWeight: format===f.id ? 700 : 400,
                background: format===f.id ? FORMAT_COLORS[f.id]+"33" : "#1a1a1a",
                border: `1.5px solid ${format===f.id ? FORMAT_COLORS[f.id] : BORDER}`,
                color: format===f.id ? FORMAT_COLORS[f.id] : "#555",
                fontFamily:"inherit",
              }}>{f.label}</button>
            ))}
          </div>
        </div>

        {isEDH && (
          <div style={{ marginBottom:14 }}>
            <div style={{ color:"#555", fontSize:11, marginBottom:6, letterSpacing:0.5 }}>
              {format === "oathbreaker" ? "PLANESWALKER" : "COMMANDER"}
            </div>
            <input value={commander} onChange={e=>{
              setCommander(e.target.value);
              clearTimeout(timerRef.current);
              timerRef.current = setTimeout(()=>searchCommander(e.target.value), 350);
            }}
              placeholder={format === "oathbreaker" ? "Search planeswalker..." : "Search legendary creature..."}
              style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
                padding:"12px 14px", color:"#fff", fontSize:14, fontFamily:"inherit",
                outline:"none", boxSizing:"border-box" }}/>
            {cmdSearch.length > 0 && (
              <div style={{ background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10, marginTop:4,
                overflow:"hidden" }}>
                {cmdSearch.map(c => (
                  <button key={c.id} onClick={()=>{ setCommander(c.name); setCmdSearch([]); }}
                    style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                      width:"100%", background:"none", border:"none", borderBottom:`1px solid ${BORDER}`,
                      cursor:"pointer", textAlign:"left" }}>
                    {c.image_uris?.small && (
                      <img src={c.image_uris.small} alt={c.name}
                        style={{ height:36, borderRadius:3, flexShrink:0 }}/>
                    )}
                    <div>
                      <div style={{ color:"#fff", fontSize:13 }}>{c.name}</div>
                      <div style={{ color:"#555", fontSize:11 }}>{c.type_line}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={()=>{
            if (!name.trim()) return;
            onSave({
              id: `deck-${Date.now()}`,
              name: name.trim(),
              format,
              commander: isEDH ? commander : "",
              cards: [],
              record: { wins:0, losses:0, draws:0, games:[] },
              createdAt: Date.now(),
            });
          }}
          style={{ width:"100%", padding:"14px 0", background: name.trim() ? TEAL : "#1a1a1a",
            border:"none", borderRadius:12, color: name.trim() ? "#000" : "#444",
            fontSize:15, fontWeight:700, cursor: name.trim() ? "pointer" : "default",
            fontFamily:"inherit", transition:"all 0.2s" }}>
          Create Deck
        </button>
      </div>
    </div>,
    document.body
  );
}

// ── Deck List Import Helpers ──────────────────────────────────────────────────
// Supports Archidekt .txt and ManaBox exports
function parseArchidektTxt(text) {
  const lines = text.trim().split("\n");
  const entries = [];
  let commanderName = null;
  let currentSection = ""; // tracks // COMMANDER, // MAINBOARD etc for ManaBox

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ManaBox / Moxfield section headers: // COMMANDER, // MAINBOARD, // SIDEBOARD
    if (line.startsWith("//")) {
      currentSection = line.replace(/^\/\/\s*/, "").toUpperCase();
      continue;
    }

    // Archidekt format: "1x CardName (set) 123 *F* [Category,tags]"
    // ManaBox format:   "1 CardName (SET) 123 *F*"
    // Unified regex — categories bracket is optional
    const match = line.match(/^(\d+)x?\s+(.+?)\s+\((\w+)\)\s+(\w+)(?:\s+\*F\*)?\s*(?:\[([^\]]*)\])?\s*$/);
    if (!match) continue;

    const [, qtyStr, name, set, number, catStr = ""] = match;

    // Skip maybeboard / token placeholders
    if (catStr.includes("{noDeck}")) continue;

    const qty  = parseInt(qtyStr, 10);
    const foil = line.includes("*F*");

    // Determine category from Archidekt tags OR from ManaBox section header
    const rawCats    = catStr ? catStr.split(",").map(c => c.trim()) : [];
    const categories = rawCats.map(c => c.replace(/\{[^}]*\}/g, "").trim()).filter(Boolean);
    const isCommander = catStr.includes("Commander{top}") || currentSection === "COMMANDER";
    if (isCommander && !commanderName) commanderName = name;
    const primaryCat = isCommander ? "Commander" : (categories[0] || currentSection || "Other");

    entries.push({ qty, name, set: set.toLowerCase(), number, foil, categories, primaryCat });
  }
  return { entries, commanderName };
}

async function scryfallBatchLookup(entries, onProgress) {
  const resultMap = new Map(); // entry.name -> card
  const CHUNK = 75;

  // Pass 1: lookup by set + collector_number
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const identifiers = chunk.map(e => ({ set: e.set, collector_number: e.number }));
    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "MTGTracker/1.0" },
        body: JSON.stringify({ identifiers }),
      });
      if (res.ok) {
        const data = await res.json();
        const found = data.data || [];
        for (const entry of chunk) {
          const card = found.find(c => c.set === entry.set && c.collector_number === entry.number)
            || found.find(c => c.name.split(" // ")[0].toLowerCase() === entry.name.split(" // ")[0].toLowerCase());
          if (card) resultMap.set(entry.name, card);
        }
      }
    } catch { /* will retry by name */ }
    onProgress?.(Math.round((i + CHUNK) / entries.length * 55), 100);
    if (i + CHUNK < entries.length) await new Promise(r => setTimeout(r, 150));
  }

  // Pass 2: name-based fallback for anything still missing
  const missing = entries.filter(e => !resultMap.has(e.name));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      const identifiers = chunk.map(e => ({ name: e.name.split(" // ")[0] }));
      try {
        const res = await fetch("https://api.scryfall.com/cards/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "MTGTracker/1.0" },
          body: JSON.stringify({ identifiers }),
        });
        if (res.ok) {
          const data = await res.json();
          const found = data.data || [];
          for (const entry of chunk) {
            const frontName = entry.name.split(" // ")[0].toLowerCase();
            const card = found.find(c => c.name.split(" // ")[0].toLowerCase() === frontName);
            if (card) resultMap.set(entry.name, card);
          }
        }
      } catch { /* will retry with fuzzy */ }
      onProgress?.(55 + Math.round((i + CHUNK) / missing.length * 25), 100);
      if (i + CHUNK < missing.length) await new Promise(r => setTimeout(r, 150));
    }
  }

  // Pass 3: fuzzy name search via /cards/named?fuzzy= for anything still missing
  const stillMissing = entries.filter(e => !resultMap.has(e.name));
  if (stillMissing.length > 0) {
    for (let i = 0; i < stillMissing.length; i++) {
      const entry = stillMissing[i];
      const searchName = entry.name.split(" // ")[0];
      try {
        const res = await fetch(
          `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(searchName)}`,
          { headers: { "User-Agent": "MTGTracker/1.0" } }
        );
        if (res.ok) {
          const card = await res.json();
          if (card.object === "card") resultMap.set(entry.name, card);
        }
      } catch { /* card stays missing */ }
      onProgress?.(80 + Math.round((i + 1) / stillMissing.length * 20), 100);
      if (i + 1 < stillMissing.length) await new Promise(r => setTimeout(r, 100));
    }
  }

  onProgress?.(100, 100);
  return entries.map(entry => ({ entry, card: resultMap.get(entry.name) || null }));
}

// ── Import Modal ──────────────────────────────────────────────────────────────
function ImportModal({ initialText, onClose, onImported }) {
  const [step, setStep]         = useState(initialText ? "preview" : "select");
  const [parsed, setParsed]     = useState(null);
  const [progress, setProgress] = useState([0, 0]);
  const [results, setResults]   = useState([]);
  const [deckName, setDeckName] = useState("");
  const [error, setError]       = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (initialText) {
      const p = parseArchidektTxt(initialText);
      setParsed(p);
      setDeckName(p.commanderName ? `${p.commanderName} EDH` : "Imported Deck");
    }
  }, [initialText]);

  const handleFile = (file) => {
    if (!file) return;
    setError("");
    file.text().then(text => {
      const p = parseArchidektTxt(text);
      if (!p.entries.length) { setError("No valid cards found — make sure this is an Archidekt .txt export."); return; }
      setParsed(p);
      setDeckName(p.commanderName ? `${p.commanderName} EDH` : file.name.replace(/\.txt$/i, ""));
      setStep("preview");
    }).catch(() => setError("Could not read file."));
  };

  const runLookup = async () => {
    if (!parsed?.entries?.length) return;
    setStep("loading");
    const res = await scryfallBatchLookup(parsed.entries, (pct) => setProgress([pct, 100]));
    setResults(res);
    setStep("confirm");
  };

  const createDeck = () => {
    const cards = [];
    for (const { entry, card } of results) {
      if (!card) continue;
      cards.push({ card, qty: entry.qty, owned: true, foil: entry.foil, addedAt: Date.now(), primaryCat: entry.primaryCat });
    }
    const totalCost = results.reduce((s, { entry, card }) => {
      if (!card) return s;
      const p = parseFloat((entry.foil ? card.prices?.usd_foil : card.prices?.usd) || card.prices?.usd || 0);
      return s + p * entry.qty;
    }, 0);
    onImported({
      id: `deck-${Date.now()}`,
      name: deckName.trim() || "Imported Deck",
      format: "commander",
      commander: parsed.commanderName || "",
      cards,
      hasCategories: true,
      estCost: totalCost,
      record: { wins:0, losses:0, draws:0, games:[] },
      createdAt: Date.now(),
    });
  };

  const catCounts = parsed ? parsed.entries.reduce((acc, e) => {
    acc[e.primaryCat] = (acc[e.primaryCat] || 0) + e.qty; return acc;
  }, {}) : {};
  const totalCards   = parsed?.entries.reduce((s, e) => s + e.qty, 0) || 0;
  const foundCount   = results.filter(r => r.card).length;
  const totalEntries = parsed?.entries.length || 0;
  const totalEstCost = results.reduce((s, { entry, card }) => {
    if (!card) return s;
    return s + parseFloat((entry.foil ? card.prices?.usd_foil : card.prices?.usd) || card.prices?.usd || 0) * entry.qty;
  }, 0);

  return createPortal(
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:10000,
      display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#141414", borderRadius:"20px 20px 0 0", width:"100%",
        padding:"20px", paddingBottom:"calc(32px + env(safe-area-inset-bottom,0px))",
        maxHeight:"88vh", overflowY:"auto" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1 }}>
            IMPORT DECK
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"#555", fontSize:22, lineHeight:1 }}>✕</button>
        </div>

        {/* Step: select */}
        {step === "select" && (
          <div>
            <div style={{ color:"#666", fontSize:13, marginBottom:20, lineHeight:1.7 }}>
              Export your deck from Archidekt as a <strong style={{ color:"#888" }}>.txt file</strong>, then select it here.
            </div>
            <input ref={fileRef} type="file" accept=".txt" style={{ display:"none" }}
              onChange={e => handleFile(e.target.files?.[0])}/>
            <button onClick={() => fileRef.current?.click()} style={{
              width:"100%", padding:"28px 20px", background:"#1a1a1a",
              border:`2px dashed ${BORDER}`, borderRadius:14, cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"center", gap:10,
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div style={{ color:"#888", fontSize:14 }}>Tap to select .txt file</div>
              <div style={{ color:"#444", fontSize:11 }}>Archidekt deck export format</div>
            </button>
            {error && <div style={{ color:"#ef4444", fontSize:12, marginTop:12 }}>{error}</div>}
          </div>
        )}

        {/* Step: preview */}
        {step === "preview" && parsed && (
          <div>
            <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", marginBottom:16, border:`1px solid ${BORDER}` }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                {parsed.commanderName && (
                  <div style={{ gridColumn:"1 / -1" }}>
                    <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>COMMANDER</div>
                    <div style={{ color:TEAL, fontSize:15, fontWeight:700 }}>{parsed.commanderName}</div>
                  </div>
                )}
                <div>
                  <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>CARDS</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:"#fff" }}>{totalCards}</div>
                </div>
                <div>
                  <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>FORMAT</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:"#a855f7" }}>Commander</div>
                </div>
              </div>
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>CATEGORIES</div>
              {Object.entries(catCounts).sort((a,b) => b[1]-a[1]).map(([cat, count]) => (
                <div key={cat} style={{ display:"flex", justifyContent:"space-between",
                  padding:"6px 0", borderBottom:`1px solid #1a1a1a` }}>
                  <span style={{ color:"#888", fontSize:12 }}>{cat}</span>
                  <span style={{ color:"#555", fontSize:12 }}>{count}</span>
                </div>
              ))}
            </div>

            <div style={{ marginBottom:16 }}>
              <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:6 }}>DECK NAME</div>
              <input value={deckName} onChange={e => setDeckName(e.target.value)}
                style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
                  padding:"12px 14px", color:"#fff", fontSize:14, fontFamily:"inherit",
                  outline:"none", boxSizing:"border-box" }}/>
            </div>

            <button onClick={runLookup} style={{
              width:"100%", padding:"14px 0", background:TEAL, border:"none", borderRadius:12,
              color:"#000", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
            }}>
              Look Up {totalEntries} Cards on Scryfall
            </button>
          </div>
        )}

        {/* Step: loading */}
        {step === "loading" && (
          <div style={{ textAlign:"center", padding:"30px 0" }}>
            <div style={{ color:TEAL, fontFamily:"'Bebas Neue',sans-serif", fontSize:24, letterSpacing:1, marginBottom:10 }}>
              FETCHING CARD DATA
            </div>
            <div style={{ color:"#555", fontSize:13, marginBottom:20 }}>
              {progress[0] <= 55 ? "Looking up by set & number…" : progress[0] <= 80 ? "Resolving remaining cards by name…" : "Fuzzy search for remaining cards…"}
            </div>
            <div style={{ height:6, background:"#1a1a1a", borderRadius:3, overflow:"hidden" }}>
              <div style={{
                height:"100%", background:TEAL, borderRadius:3, transition:"width 0.3s",
                width: `${progress[0]}%`,
              }}/>
            </div>
          </div>
        )}

        {/* Step: confirm */}
        {step === "confirm" && (
          <div>
            <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", marginBottom:16, border:`1px solid ${BORDER}` }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>FOUND</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24,
                    color: foundCount === totalEntries ? TEAL : "#f59e0b" }}>
                    {foundCount}/{totalEntries}
                  </div>
                </div>
                <div>
                  <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>EST COST</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:TEAL }}>
                    ${totalEstCost.toFixed(2)}
                  </div>
                </div>
                {parsed?.commanderName && (
                  <div style={{ gridColumn:"1 / -1" }}>
                    <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>COMMANDER</div>
                    <div style={{ color:"#fff", fontSize:13 }}>{parsed.commanderName}</div>
                  </div>
                )}
              </div>
            </div>

            {foundCount < totalEntries && (
              <div style={{ background:"#1a0a00", border:"1px solid #f59e0b44", borderRadius:10,
                padding:"10px 14px", marginBottom:16, color:"#f59e0b", fontSize:12, lineHeight:1.5 }}>
                <div>{totalEntries - foundCount} card{totalEntries - foundCount !== 1 ? "s" : ""} could not be found on Scryfall and will be skipped:</div>
                <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:2 }}>
                  {results.filter(r => !r.card).map(r => (
                    <div key={r.entry.name} style={{ color:"#f59e0b88", fontSize:11 }}>{r.entry.name}</div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom:16 }}>
              <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:6 }}>DECK NAME</div>
              <input value={deckName} onChange={e => setDeckName(e.target.value)}
                style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
                  padding:"12px 14px", color:"#fff", fontSize:14, fontFamily:"inherit",
                  outline:"none", boxSizing:"border-box" }}/>
            </div>

            <button onClick={createDeck} disabled={!deckName.trim()} style={{
              width:"100%", padding:"14px 0", background: deckName.trim() ? TEAL : "#1a1a1a",
              border:"none", borderRadius:12, color: deckName.trim() ? "#000" : "#444",
              fontSize:15, fontWeight:700, cursor: deckName.trim() ? "pointer" : "default",
              fontFamily:"inherit",
            }}>
              Create Deck ({foundCount} cards)
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Portfolio Tab ─────────────────────────────────────────────────────────────
const ROLE_TAG_LIST = ["draw","removal","ramp","lifegain","token","graveyard","board-wipe","counter","burn","protection","evasion","recursion"];
const TYPE_TAG_LIST = ["creature","instant","sorcery","artifact","enchantment","land"];

function PortfolioTab({ collection, decks, onAddToDeck, onCardPress }) {
  const [q, setQ]                   = useState("");
  const [colorFilter, setColorFilter] = useState(new Set());
  const [tagFilter, setTagFilter]   = useState(new Set());
  const [addingCard, setAddingCard] = useState(null);

  // Merge collection + deck cards into a unified portfolio, deduped by card.id
  const activeCards = useMemo(() => {
    const seen = new Set();
    const items = [];
    // 1. Main collection (exclude sold)
    for (const item of (collection || [])) {
      if (item.sold) continue;
      if (!item.card?.id) continue;
      seen.add(item.card.id);
      items.push(item);
    }
    // 2. Cards in decks that aren't already in the collection
    for (const deck of (decks || [])) {
      const deckCards = deck.cards || [];
      for (const dc of deckCards) {
        const card = dc.card;
        if (!card?.id || seen.has(card.id)) continue;
        seen.add(card.id);
        items.push({
          id: `deck-${deck.id}-${card.id}`,
          card,
          condition: "near_mint",
          foil: dc.foil || false,
          autoTags: computeAutoTags(card),
          _deckSource: deck.name || "Deck",
        });
      }
    }
    return items;
  }, [collection, decks]);

  const toggleColor = (c) => setColorFilter(prev => {
    const next = new Set(prev); next.has(c) ? next.delete(c) : next.add(c); return next;
  });
  const toggleTag = (t) => setTagFilter(prev => {
    const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next;
  });

  const filtered = activeCards.filter(item => {
    const card = item.card;
    if (!card) return false;
    if (q && !card.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (colorFilter.size > 0) {
      const ci = card.color_identity || [];
      if (!ci.some(c => colorFilter.has(c))) return false;
    }
    if (tagFilter.size > 0) {
      const tags = computeAutoTags(card);
      if (![...tagFilter].every(t => tags.includes(t))) return false;
    }
    return true;
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      {/* Search bar */}
      <div style={{ padding:"10px 16px 0", flexShrink:0 }}>
        <div style={{ position:"relative" }}>
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search your collection…"
            style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`,
              borderRadius:10, padding:"10px 14px 10px 38px", color:"#fff", fontSize:14,
              fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
          <svg style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}
            width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="#555" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="#555" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          {q && (
            <button onClick={() => setQ("")}
              style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                background:"none", border:"none", cursor:"pointer", color:"#555", fontSize:16 }}>✕</button>
          )}
        </div>
      </div>

      {/* Color filters */}
      <div style={{ padding:"8px 16px 0", display:"flex", gap:6, flexShrink:0 }}>
        {["W","U","B","R","G"].map(c => (
          <button key={c} onClick={() => toggleColor(c)} style={{
            width:32, height:32, borderRadius:"50%", cursor:"pointer", flexShrink:0,
            background: colorFilter.has(c) ? MANA_COLORS[c] : "#1a1a1a",
            border: `2px solid ${colorFilter.has(c) ? MANA_COLORS[c] : BORDER}`,
            color: colorFilter.has(c) ? (c === "W" ? "#000" : "#fff") : "#555",
            fontSize:11, fontWeight:800,
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>{c}</button>
        ))}
        {colorFilter.size > 0 && (
          <button onClick={() => setColorFilter(new Set())} style={{
            background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:11, padding:"0 6px",
          }}>clear</button>
        )}
      </div>

      {/* Tag filter pills */}
      <div style={{ padding:"6px 16px 0", display:"flex", gap:5, overflowX:"auto",
        flexShrink:0, scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
        {[...ROLE_TAG_LIST, ...TYPE_TAG_LIST].map(tag => {
          const meta = getTagMeta(tag);
          const active = tagFilter.has(tag);
          const color = meta?.color || "#555";
          return (
            <button key={tag} onClick={() => toggleTag(tag)} style={{
              flexShrink:0, padding:"4px 10px", borderRadius:20, cursor:"pointer",
              background: active ? color + "33" : "#1a1a1a",
              border: `1.5px solid ${active ? color : BORDER}`,
              color: active ? color : "#555",
              fontSize:10, fontFamily:"inherit", fontWeight: active ? 700 : 400, whiteSpace:"nowrap",
            }}>{meta?.label || tag}</button>
          );
        })}
        {tagFilter.size > 0 && (
          <button onClick={() => setTagFilter(new Set())} style={{
            flexShrink:0, background:"none", border:"none", color:"#555",
            cursor:"pointer", fontSize:10, padding:"0 4px",
          }}>clear</button>
        )}
      </div>

      {/* Card grid */}
      <div style={{ flex:1, overflowY:"auto", padding:"4px 12px 40px" }}>
        {activeCards.length === 0 ? (
          <div style={{ textAlign:"center", padding:"50px 20px", color:"#333" }}>
            <div style={{ fontSize:13 }}>No cards yet — add cards to your collection or import a deck.</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"40px 20px", color:"#333" }}>
            <div style={{ fontSize:13 }}>No cards match your filters.</div>
          </div>
        ) : (
          <>
            <div style={{ color:"#444", fontSize:11, marginBottom:8, paddingTop:4 }}>
              {filtered.length.toLocaleString()} card{filtered.length !== 1 ? "s" : ""}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
              {filtered.map((item, idx) => {
                const card = item.card;
                const price = parseFloat((item.foil ? card?.prices?.usd_foil : card?.prices?.usd) || card?.prices?.usd || 0);
                const tags  = (item.autoTags || computeAutoTags(card)).filter(t => {
                  const m = getTagMeta(t);
                  return m?.cat === "role" || m?.cat === "keyword";
                }).slice(0, 2);
                const condColor = item.condition ? (COND_COLORS[item.condition] || TEAL) : null;
                const condAbbr  = item.condition ? (COND_ABBR[item.condition] || "NM") : null;
                return (
                  <div key={item.id || idx}
                    onClick={() => onCardPress ? onCardPress(item) : setAddingCard(item)}
                    style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16,
                      overflow:"hidden", cursor:"pointer", transition:"border-color 0.15s" }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = TEAL+"44"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; }}>

                    {/* Card image */}
                    <div style={{ position:"relative" }}>
                      {card?.images?.small ? (
                        <img src={card.images.small} alt={card.name} loading="lazy"
                          style={{ width:"100%", aspectRatio:"63/88", objectFit:"cover",
                            display:"block", background:"#1a1a1a" }}
                          onError={e => { e.target.style.display="none"; }}/>
                      ) : (
                        <div style={{ width:"100%", aspectRatio:"63/88", background:"#1a1a1a",
                          display:"flex", alignItems:"center", justifyContent:"center", padding:6 }}>
                          <span style={{ color:"#333", fontSize:9, textAlign:"center" }}>{card?.name}</span>
                        </div>
                      )}
                      {/* Condition badge */}
                      {condAbbr && (
                        <div style={{ position:"absolute", top:5, right:5,
                          background: condColor + "cc", color:"#000",
                          fontSize:8, fontWeight:800, padding:"2px 5px", borderRadius:5 }}>
                          {condAbbr}
                        </div>
                      )}
                      {/* Foil badge */}
                      {item.foil && !item.condition && (
                        <div style={{ position:"absolute", top:5, right:5,
                          background:"rgba(0,0,0,0.8)", color:"#f59e0b",
                          fontSize:8, fontWeight:800, padding:"2px 5px", borderRadius:5,
                          border:"1px solid #f59e0b55" }}>
                          FOIL
                        </div>
                      )}
                      {/* Deck source badge */}
                      {item._deckSource && (
                        <div style={{ position:"absolute", top:5, left:5,
                          background:"rgba(0,0,0,0.8)", color:TEAL,
                          fontSize:7, fontWeight:700, padding:"2px 5px", borderRadius:5,
                          border:`1px solid ${TEAL}44`, maxWidth:52,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {item._deckSource}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ padding:"7px 8px 9px" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13,
                        color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {card?.name}
                      </div>
                      <div style={{ color:"#555", fontSize:9, marginTop:1,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {card?.set?.name}
                      </div>
                      {tags.length > 0 && (
                        <div style={{ display:"flex", gap:3, marginTop:4, overflow:"hidden" }}>
                          {tags.map(t => {
                            const meta = getTagMeta(t);
                            const tc = meta?.color || "#555";
                            return (
                              <span key={t} style={{ fontSize:8, padding:"2px 5px", borderRadius:5,
                                background: tc + "22", border:`1px solid ${tc}44`, color: tc,
                                whiteSpace:"nowrap", fontWeight:600 }}>
                                {meta?.label || t}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:5 }}>
                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                          color: price > 0 ? TEAL : "#333", letterSpacing:0.5 }}>
                          {price > 0 ? fmt(price) : (
                            <span style={{ fontSize:9, color:"#444", fontFamily:"inherit",
                              fontWeight:400, letterSpacing:0 }}>Unavailable</span>
                          )}
                        </div>
                        <button onClick={e => { e.stopPropagation(); setAddingCard(item); }}
                          style={{ background:"#1a1a1a", border:`1px solid ${BORDER}`,
                            borderRadius:6, color:"#555", fontSize:8, cursor:"pointer",
                            padding:"3px 6px", fontFamily:"inherit" }}>+ Deck</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Add-to-deck bottom sheet */}
      {addingCard && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:1000,
          display:"flex", alignItems:"flex-end" }} onClick={() => setAddingCard(null)}>
          <div style={{ background:"#141414", borderRadius:"20px 20px 0 0", width:"100%",
            padding:"20px", paddingBottom:"calc(24px + env(safe-area-inset-bottom,0px))",
            maxHeight:"70vh", overflowY:"auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", letterSpacing:1, marginBottom:4 }}>
              ADD TO DECK
            </div>
            <div style={{ color:"#555", fontSize:12, marginBottom:16 }}>{addingCard.card?.name}</div>
            {decks.length === 0 ? (
              <div style={{ color:"#444", fontSize:13, textAlign:"center", padding:"20px 0" }}>
                No decks yet — create one first.
              </div>
            ) : (
              decks.map(deck => {
                const fmtObj = FORMATS.find(f => f.id === deck.format) || FORMATS[0];
                const col = FORMAT_COLORS[deck.format] || "#6b7280";
                const alreadyIn = deck.cards.some(c => c.card.id === addingCard.card?.id);
                return (
                  <button key={deck.id}
                    onClick={() => { onAddToDeck(addingCard.card, deck.id); setAddingCard(null); }}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:12,
                      padding:"12px 14px", background: alreadyIn ? TEAL+"11" : "#1a1a1a",
                      border:`1px solid ${alreadyIn ? TEAL+"44" : BORDER}`, borderRadius:10,
                      cursor:"pointer", marginBottom:6, textAlign:"left" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ color:"#fff", fontSize:13 }}>{deck.name}</div>
                      <div style={{ color: col, fontSize:11 }}>{fmtObj.label}</div>
                    </div>
                    <div style={{ color: alreadyIn ? TEAL : "#555", fontSize:11, fontWeight:700 }}>
                      {alreadyIn ? "✓ In deck" : "Add"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Deck Detail / Editor ──────────────────────────────────────────────────────
function DeckEditor({ deck, onUpdate, onBack, onPlay, collection }) {
  const [search, setSearch]             = useState("");
  const [results, setResults]           = useState([]);
  const [searching, setSearching]       = useState(false);
  const [selectedCard, setSelectedCard] = useState(null); // cardId
  const [catPickerFor, setCatPickerFor] = useState(null); // cardId when cat picker open
  const [subTab, setSubTab]             = useState("cards");
  const [groupBy, setGroupBy]           = useState("category"); // "type" | "category"
  const timerRef = useRef(null);

  const fmt_obj = FORMATS.find(f => f.id === deck.format) || FORMATS[0];
  const col     = FORMAT_COLORS[deck.format] || "#6b7280";
  const hasCats = deck.hasCategories && deck.cards.some(c => c.primaryCat);
  const legal   = isDeckLegal(deck);

  const doSearch = async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const legalityQ = deck.format && !["casual","draft"].includes(deck.format)
        ? ` legal:${deck.format}` : "";
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q + legalityQ)}&unique=cards&order=released`,
        { headers:{ "User-Agent":"MTGTracker/1.0" } }
      );
      if (res.ok) {
        const d = await res.json();
        setResults((d.data || []).slice(0, 20));
      }
    } catch {}
    setSearching(false);
  };

  const addCard = (card, qty = 1) => {
    const existing = deck.cards.findIndex(c => c.card.id === card.id);
    let newCards;
    if (existing >= 0) {
      if (fmt_obj.singleton) return;
      newCards = deck.cards.map((c, i) => i === existing ? { ...c, qty: (c.qty||1)+1 } : c);
    } else {
      const ownedInCollection = collection.some(i => i.card.id === card.id);
      newCards = [...deck.cards, { card, qty:1, owned:ownedInCollection, foil:false, addedAt:Date.now() }];
    }
    onUpdate({ ...deck, cards: newCards });
  };

  const removeCard = (cardId) => {
    onUpdate({ ...deck, cards: deck.cards.filter(c => c.card.id !== cardId) });
  };

  const toggleOwned = (cardId) => {
    onUpdate({ ...deck, cards: deck.cards.map(c => c.card.id === cardId ? { ...c, owned: !c.owned } : c) });
  };

  const toggleFoil = (cardId) => {
    onUpdate({ ...deck, cards: deck.cards.map(c => c.card.id === cardId ? { ...c, foil: !c.foil } : c) });
  };

  const setQty = (cardId, qty) => {
    if (qty < 1) { removeCard(cardId); return; }
    const max = fmt_obj.singleton ? 1 : 4;
    onUpdate({ ...deck, cards: deck.cards.map(c =>
      c.card.id === cardId ? { ...c, qty: Math.min(qty, max) } : c
    )});
  };

  const setCat = (cardId, cat) => {
    onUpdate({ ...deck, cards: deck.cards.map(c => c.card.id === cardId ? { ...c, primaryCat: cat } : c) });
    setCatPickerFor(null);
  };

  const deckCats = useMemo(() => {
    const existing = [...new Set(deck.cards.map(c => c.primaryCat).filter(Boolean))].sort();
    const defaults = ["Commander","Land","Ramp","Draw","Removal","Lifegain","Tokens","Protection","Recursion","Pump","Evasion","Counters","Creature","Other"];
    return [...new Set([...existing, ...defaults])];
  }, [deck.cards]);

  // Type grouping
  const grouped = {};
  TYPE_ORDER.forEach(t => { grouped[t] = []; });
  deck.cards.forEach(c => {
    const t = getCardType(c.card);
    (grouped[t] || (grouped["Other"] = grouped["Other"] || [])) && grouped[t] ? grouped[t].push(c) : grouped["Other"].push(c);
  });
  // Color distribution (for stats)
  const colorDist = {};
  deck.cards.forEach(c => {
    const colors = c.card.colors || [];
    if (!colors.length) { colorDist["C"] = (colorDist["C"] || 0) + (c.qty || 1); }
    else colors.forEach(cl => { colorDist[cl] = (colorDist[cl] || 0) + (c.qty || 1); });
  });

  // Rarity distribution (for stats)
  const rarityDist = {};
  deck.cards.forEach(c => {
    const r = c.card.rarity || "common";
    rarityDist[r] = (rarityDist[r] || 0) + (c.qty || 1);
  });

  // Mana curves split by creature vs spell (for stats)
  const creatureCurve = Array(8).fill(0);
  const spellCurve    = Array(8).fill(0);
  deck.cards.forEach(c => {
    const type = getCardType(c.card);
    if (type === "Land") return;
    const cmc = Math.min(Math.floor(c.card?.cmc || 0), 7);
    if (type === "Creature") creatureCurve[cmc] += (c.qty || 1);
    else spellCurve[cmc] += (c.qty || 1);
  });

  // Land / mana source count
  const landCount = (grouped["Land"] || []).reduce((s, c) => s + (c.qty || 1), 0);

  // Category grouping
  const catGroups = {};
  if (hasCats) {
    deck.cards.forEach(c => {
      const cat = c.primaryCat || "Other";
      if (!catGroups[cat]) catGroups[cat] = [];
      catGroups[cat].push(c);
    });
  }
  const catOrder = hasCats
    ? ["Commander", ...Object.keys(catGroups).filter(c => c !== "Commander").sort()]
    : [];

  const totalCards   = deckCardCount(deck);
  const totalOwned   = deckOwnedCount(deck);
  const totalValue   = deckValue(deck);
  const missingCards = deck.cards.filter(c => !c.owned);
  const missingValue = missingCards.reduce((s, c) => {
    return s + parseFloat(c.card?.prices?.usd || 0) * (c.qty || 1);
  }, 0);
  const pips = colorIdentityPips(deck);

  // Stack layout constants
  const SC_W = 76, SC_H = 106, SC_OFF = 30;

  const renderTypeStack = (typeLabel, cards) => {
    const totalQty  = cards.reduce((s, c) => s + (c.qty || 1), 0);
    const groupVal  = cards.reduce((s, c) => {
      const p = parseFloat((c.foil ? c.card?.prices?.usd_foil : c.card?.prices?.usd) || c.card?.prices?.usd || 0);
      return s + p * (c.qty || 1);
    }, 0);
    const activeC   = selectedCard ? cards.find(c => c.card.id === selectedCard) : null;
    const stackW    = SC_W + Math.max(0, cards.length - 1) * SC_OFF;

    return (
      <div key={typeLabel} style={{ marginBottom:18 }}>
        {/* Group header */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 16px", marginBottom:8 }}>
          <span style={{ color:"#888", fontSize:10, letterSpacing:1, fontWeight:700 }}>
            {typeLabel.toUpperCase()}
          </span>
          <span style={{ color:"#555", fontSize:10, background:"#1a1a1a", borderRadius:8,
            padding:"1px 6px", border:`1px solid ${BORDER}` }}>{totalQty}</span>
          {groupVal > 0 && (
            <span style={{ color:TEAL, fontSize:10, marginLeft:"auto" }}>{fmt(groupVal)}</span>
          )}
        </div>

        {/* Horizontal fan of card art */}
        <div style={{ overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch",
          paddingLeft:16, paddingRight:16, paddingBottom:4 }}>
          <div style={{ position:"relative", height:SC_H + 12, width:Math.max(stackW, SC_W), flexShrink:0 }}>
            {cards.map((c, idx) => {
              const isSel  = selectedCard === c.card.id;
              const imgSrc = c.card.images?.small || c.card.image_uris?.small || c.card.card_faces?.[0]?.image_uris?.small;
              return (
                <button key={c.card.id}
                  onClick={() => setSelectedCard(isSel ? null : c.card.id)}
                  style={{
                    position:"absolute", left: idx * SC_OFF, bottom:0,
                    width:SC_W, height:SC_H,
                    zIndex: isSel ? cards.length + 10 : idx + 1,
                    cursor:"pointer",
                    transform: isSel ? "translateY(-10px)" : "none",
                    transition:"transform 0.15s ease, box-shadow 0.15s ease",
                    borderRadius:6, overflow:"hidden", padding:0,
                    border: isSel ? `2px solid ${TEAL}` : "2px solid #111",
                    boxShadow: isSel ? `0 6px 18px ${TEAL}55` : "0 2px 6px #00000077",
                    background:"#111",
                  }}>
                  {imgSrc ? (
                    <img src={imgSrc} alt={c.card.name}
                      style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"top", display:"block" }}/>
                  ) : (
                    <div style={{ width:"100%", height:"100%", display:"flex", alignItems:"center",
                      justifyContent:"center", padding:4 }}>
                      <span style={{ color:"#333", fontSize:7, textAlign:"center" }}>{c.card.name}</span>
                    </div>
                  )}
                  {c.qty > 1 && (
                    <div style={{ position:"absolute", top:3, right:3, background:"rgba(0,0,0,0.85)",
                      borderRadius:4, padding:"1px 4px", fontSize:10, color:TEAL, fontWeight:700 }}>
                      {c.qty}×
                    </div>
                  )}
                  {!c.owned && (
                    <div style={{ position:"absolute", bottom:0, left:0, right:0, height:3,
                      background:"#ef4444", borderRadius:"0 0 4px 4px" }}/>
                  )}
                  {c.foil && (
                    <div style={{ position:"absolute", top:3, left:3, background:"rgba(0,0,0,0.75)",
                      borderRadius:4, padding:"1px 4px", fontSize:7, color:"#f59e0b", fontWeight:700 }}>
                      ✦
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected card detail tray */}
        {activeC && (
          <div style={{ margin:"6px 16px 0", background:"#0f0f0f", border:`1px solid ${BORDER}`,
            borderRadius:10, padding:"10px 12px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:"#fff", fontSize:13, fontWeight:600,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {activeC.card.name}
                </div>
                <div style={{ color:"#555", fontSize:10, marginTop:1,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {activeC.card.type_line}
                  {activeC.card.power != null && ` · ${activeC.card.power}/${activeC.card.toughness}`}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:5, flexWrap:"wrap" }}>
                  {(() => {
                    const price = parseFloat((activeC.foil ? activeC.card?.prices?.usd_foil : activeC.card?.prices?.usd) || activeC.card?.prices?.usd || 0);
                    return price > 0 && (
                      <span style={{ color:TEAL, fontSize:12, fontWeight:700 }}>
                        {fmt(price * (activeC.qty || 1))}
                      </span>
                    );
                  })()}
                  <button onClick={() => toggleOwned(activeC.card.id)} style={{
                    background:"none", border:`1px solid ${activeC.owned ? TEAL : "#333"}`,
                    borderRadius:6, color: activeC.owned ? TEAL : "#555", fontSize:9,
                    padding:"2px 8px", cursor:"pointer", fontFamily:"inherit", fontWeight: activeC.owned ? 700 : 400,
                  }}>{activeC.owned ? "OWNED" : "NEED"}</button>
                  <button onClick={() => toggleFoil(activeC.card.id)} style={{
                    background:"none", border:`1px solid ${activeC.foil ? "#f59e0b" : "#333"}`,
                    borderRadius:6, color: activeC.foil ? "#f59e0b" : "#555", fontSize:9,
                    padding:"2px 8px", cursor:"pointer", fontFamily:"inherit",
                  }}>FOIL</button>
                  {hasCats && (
                    <button onClick={() => setCatPickerFor(catPickerFor === activeC.card.id ? null : activeC.card.id)} style={{
                      background:"none", border:`1px solid ${catPickerFor === activeC.card.id ? TEAL : "#333"}`,
                      borderRadius:6, color: catPickerFor === activeC.card.id ? TEAL : "#888", fontSize:9,
                      padding:"2px 8px", cursor:"pointer", fontFamily:"inherit",
                      maxWidth:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>{(activeC.primaryCat || "OTHER").toUpperCase()}</button>
                  )}
                </div>
              </div>
              {!fmt_obj.singleton && (
                <div style={{ display:"flex", alignItems:"center", flexShrink:0 }}>
                  <button onClick={() => setQty(activeC.card.id, (activeC.qty||1)-1)} style={{
                    width:30, height:30, borderRadius:"8px 0 0 8px", background:"#1a1a1a",
                    border:`1px solid ${BORDER}`, color:"#888", cursor:"pointer", fontSize:18, lineHeight:1,
                  }}>−</button>
                  <div style={{ width:30, height:30, background:"#111", border:`1px solid ${BORDER}`,
                    borderLeft:"none", borderRight:"none", display:"flex", alignItems:"center",
                    justifyContent:"center", color:"#fff", fontSize:13, fontWeight:700 }}>
                    {activeC.qty||1}
                  </div>
                  <button onClick={() => setQty(activeC.card.id, (activeC.qty||1)+1)} style={{
                    width:30, height:30, borderRadius:"0 8px 8px 0", background:"#1a1a1a",
                    border:`1px solid ${BORDER}`, color:"#888", cursor:"pointer", fontSize:18, lineHeight:1,
                  }}>+</button>
                </div>
              )}
              <button onClick={() => { removeCard(activeC.card.id); setSelectedCard(null); }} style={{
                background:"none", border:"none", cursor:"pointer", color:"#ef4444", padding:4, fontSize:18,
              }}>✕</button>
            </div>
            {catPickerFor === activeC.card.id && (
              <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:5, paddingTop:8, borderTop:`1px solid ${BORDER}` }}>
                {deckCats.map(cat => (
                  <button key={cat} onClick={() => setCat(activeC.card.id, cat)} style={{
                    background: activeC.primaryCat === cat ? TEAL+"22" : "#1a1a1a",
                    border: `1px solid ${activeC.primaryCat === cat ? TEAL : "#2a2a2a"}`,
                    borderRadius:6, color: activeC.primaryCat === cat ? TEAL : "#666",
                    fontSize:9, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit", textTransform:"uppercase",
                  }}>{cat}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ background:"#0d0d0d", borderBottom:`1px solid ${BORDER}`, padding:"12px 16px",
        display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:4, color:TEAL }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4l-6 6 6 6" stroke={TEAL} strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff",
            letterSpacing:0.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {deck.name}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <span style={{ color:col, fontSize:10, fontWeight:700 }}>{fmt_obj.label.toUpperCase()}</span>
            {pips.map(p => <ManaSymbol key={p} color={p} size={12}/>)}
            {deck.commander && <span style={{ color:"#555", fontSize:10 }}>· {deck.commander}</span>}
            {legal === true && (
              <span style={{ color:TEAL, fontSize:9, fontWeight:700 }}>✓ Legal</span>
            )}
            {legal === false && (
              <span style={{ color:"#ef4444", fontSize:9, fontWeight:700 }}>✗ Illegal</span>
            )}
            <span style={{ color:"#444", fontSize:10 }}>{totalCards} cards · {fmt(totalValue)}</span>
          </div>
        </div>
        <button onClick={() => onPlay(deck)} style={{
          background:TEAL, border:"none", borderRadius:10, color:"#000",
          fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
          padding:"8px 14px", display:"flex", alignItems:"center", gap:5,
        }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <polygon points="2,1 10,5.5 2,10" fill="#000"/>
          </svg>
          Play
        </button>
      </div>

      {/* Sub-tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        {[["cards","Cards"], ["stats","Stats"]].map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)} style={{
            flex:1, padding:"11px 0", background:"none", border:"none",
            borderBottom: subTab===id ? `2px solid ${TEAL}` : "2px solid transparent",
            color: subTab===id ? TEAL : "#555", fontSize:12, fontWeight: subTab===id ? 700 : 400,
            cursor:"pointer", fontFamily:"inherit", letterSpacing:0.3,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>

        {/* ── Cards tab ── */}
        {subTab === "cards" && (
          <>
            {/* Search */}
            <div style={{ padding:"12px 16px 0" }}>
              <div style={{ position:"relative" }}>
                <input value={search} onChange={e => {
                  setSearch(e.target.value);
                  clearTimeout(timerRef.current);
                  timerRef.current = setTimeout(() => doSearch(e.target.value), 350);
                }}
                  placeholder={`Add cards${fmt_obj.singleton ? " (singleton)" : ""}…`}
                  style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`,
                    borderRadius:10, padding:"10px 14px 10px 38px", color:"#fff", fontSize:14,
                    fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
                <svg style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}
                  width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="5" stroke="#555" strokeWidth="1.5"/>
                  <path d="M10.5 10.5L14 14" stroke="#555" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {search && (
                  <button onClick={() => { setSearch(""); setResults([]); }}
                    style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                      background:"none", border:"none", cursor:"pointer", color:"#555" }}>✕</button>
                )}
              </div>
            </div>

            {/* Search results */}
            {results.length > 0 && (
              <div style={{ margin:"8px 16px 0", background:"#0d0d0d", border:`1px solid ${BORDER}`,
                borderRadius:10, overflow:"hidden" }}>
                {results.map(card => {
                  const price = parseFloat(card.prices?.usd || 0);
                  const inDeck = deck.cards.some(c => c.card.id === card.id);
                  return (
                    <button key={card.id} onClick={() => { addCard(card); setSearch(""); setResults([]); }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                        width:"100%", background: inDeck ? TEAL+"11" : "none",
                        border:"none", borderBottom:`1px solid ${BORDER}`, cursor:"pointer", textAlign:"left" }}>
                      {(card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small) && (
                        <img src={card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small} style={{ height:40, borderRadius:3, flexShrink:0 }}/>
                      )}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color: inDeck ? TEAL : "#fff", fontSize:13, fontWeight: inDeck?700:400 }}>
                          {card.name} {inDeck && "✓"}
                        </div>
                        <div style={{ color:"#555", fontSize:10 }}>{card.type_line} · {card.set_name}</div>
                      </div>
                      {price > 0 && <span style={{ color:TEAL, fontSize:12, flexShrink:0 }}>{fmt(price)}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {searching && (
              <div style={{ padding:"8px 16px", color:"#444", fontSize:12 }}>Searching Scryfall…</div>
            )}

            {/* Group-by toggle (only when deck has categories) */}
            {hasCats && deck.cards.length > 0 && (
              <div style={{ padding:"10px 16px 4px", display:"flex", gap:6, alignItems:"center" }}>
                <span style={{ color:"#444", fontSize:10, letterSpacing:0.5 }}>GROUP:</span>
                {["category","type"].map(g => (
                  <button key={g} onClick={() => setGroupBy(g)} style={{
                    padding:"4px 12px", borderRadius:20, cursor:"pointer",
                    background: groupBy===g ? TEAL+"22" : "#1a1a1a",
                    border: `1.5px solid ${groupBy===g ? TEAL : BORDER}`,
                    color: groupBy===g ? TEAL : "#555",
                    fontSize:11, fontFamily:"inherit", fontWeight: groupBy===g ? 700 : 400,
                  }}>{g === "category" ? "Category" : "Type"}</button>
                ))}
              </div>
            )}

            {/* Stacked card groups */}
            <div style={{ paddingTop:10, paddingBottom:80 }}>
              {deck.cards.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"#333" }}>
                  <div style={{ marginBottom:8, display:"flex", justifyContent:"center" }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                      <rect x="1" y="5" width="13" height="17" rx="2" stroke="#444" strokeWidth="1.6" opacity="0.28"/>
                      <rect x="4.5" y="3" width="13" height="17" rx="2" stroke="#444" strokeWidth="1.6" opacity="0.58"/>
                      <rect x="8" y="1" width="13" height="17" rx="2" stroke="#444" strokeWidth="1.8"/>
                    </svg>
                  </div>
                  <div style={{ fontSize:13 }}>Search above to add cards</div>
                </div>
              ) : hasCats && groupBy === "category" ? (
                catOrder.filter(cat => catGroups[cat]?.length > 0).map(cat =>
                  renderTypeStack(cat, catGroups[cat])
                )
              ) : (
                TYPE_ORDER.filter(t => grouped[t]?.length > 0).map(t =>
                  renderTypeStack(t, grouped[t])
                )
              )}
            </div>
          </>
        )}

        {/* ── Stats tab ── */}
        {subTab === "stats" && (
          <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:14, paddingBottom:80 }}>

            {/* Overview grid */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                ["Total Cards", `${totalCards} / ${fmt_obj.maxCards}`, "#fff"],
                ["Owned", `${totalOwned} / ${totalCards}`, totalOwned === totalCards ? TEAL : "#fff"],
                ["Deck Value", fmt(totalValue), TEAL],
                ["Still Need", fmt(missingValue), missingValue > 0 ? "#ef4444" : TEAL],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background:CARD, borderRadius:12, padding:"12px 14px",
                  border:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>{label.toUpperCase()}</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Mana Sources vs Avg CMC */}
            {deck.cards.length > 0 && (() => {
              const nonLandSpells = deck.cards.filter(c => getCardType(c.card) !== "Land");
              const totalSpells   = nonLandSpells.reduce((s,c) => s + (c.qty||1), 0);
              const totalCmc      = nonLandSpells.reduce((s,c) => s + (c.card?.cmc||0)*(c.qty||1), 0);
              const avgCmc        = totalSpells > 0 ? (totalCmc/totalSpells).toFixed(2) : "0.00";
              const manaRatio     = landCount > 0 && totalSpells > 0
                ? (landCount / totalCards * 100).toFixed(0) : 0;
              return (
                <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:12 }}>MANA ANALYSIS</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                    {[
                      ["Mana Sources", landCount, TEAL],
                      ["Avg CMC", avgCmc, "#a78bfa"],
                      ["Land %", `${manaRatio}%`, "#f59e0b"],
                    ].map(([lbl, v, c]) => (
                      <div key={lbl} style={{ textAlign:"center" }}>
                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:c }}>{v}</div>
                        <div style={{ color:"#444", fontSize:9, letterSpacing:0.3 }}>{lbl.toUpperCase()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Record */}
            <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
              <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>RECORD</div>
              <div style={{ display:"flex", gap:20 }}>
                {[["W", deck.record?.wins||0, TEAL], ["L", deck.record?.losses||0, "#ef4444"], ["D", deck.record?.draws||0, "#555"]].map(([label, val, color]) => (
                  <div key={label}>
                    <div style={{ color:"#444", fontSize:10 }}>{label}</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color }}>{val}</div>
                  </div>
                ))}
                {(() => {
                  const w = deck.record?.wins||0, l = deck.record?.losses||0, d = deck.record?.draws||0;
                  const g = w+l+d;
                  if (!g) return null;
                  return (
                    <div style={{ marginLeft:"auto", textAlign:"right" }}>
                      <div style={{ color:"#444", fontSize:10 }}>WIN RATE</div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:TEAL }}>
                        {Math.round(w/g*100)}%
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Overall mana curve */}
            <ManaCurve cards={deck.cards}/>

            {/* Mana curve: Creatures vs Spells */}
            {deck.cards.length > 0 && (() => {
              const maxVal = Math.max(...creatureCurve, ...spellCurve, 1);
              const labels = ["0","1","2","3","4","5","6","7+"];
              return (
                <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>CURVE BY TYPE</div>
                  <div style={{ display:"flex", gap:12, marginBottom:10 }}>
                    <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:"#888" }}>
                      <span style={{ width:10, height:10, borderRadius:2, background:TEAL+"99", display:"inline-block" }}/>
                      Creatures
                    </span>
                    <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:"#888" }}>
                      <span style={{ width:10, height:10, borderRadius:2, background:"#a78bfa99", display:"inline-block" }}/>
                      Instants/Sorceries
                    </span>
                  </div>
                  <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:60 }}>
                    {labels.map((lbl, i) => (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:1, alignItems:"center" }}>
                          <div style={{ width:"100%", background:TEAL+"99", borderRadius:"2px 2px 0 0",
                            height: creatureCurve[i] > 0 ? `${(creatureCurve[i]/maxVal)*46}px` : 2 }}/>
                          <div style={{ width:"100%", background:"#a78bfa99", borderRadius:"2px 2px 0 0",
                            height: spellCurve[i] > 0 ? `${(spellCurve[i]/maxVal)*46}px` : 2 }}/>
                        </div>
                        <span style={{ fontSize:8, color:"#444" }}>{lbl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Type breakdown */}
            <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
              <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>TYPE BREAKDOWN</div>
              {TYPE_ORDER.filter(t => grouped[t]?.length > 0).map(t => {
                const count = grouped[t].reduce((s,c)=>s+(c.qty||1),0);
                const pct   = totalCards > 0 ? (count/totalCards)*100 : 0;
                return (
                  <div key={t} style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ color:"#888", fontSize:12 }}>{t}</span>
                      <span style={{ color:"#555", fontSize:12 }}>{count}</span>
                    </div>
                    <div style={{ height:4, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:TEAL+"88", borderRadius:2, transition:"width 0.3s" }}/>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Color distribution */}
            {Object.keys(colorDist).length > 0 && (() => {
              const COLOR_META = {
                W:{ label:"White", hex:"#f8f3dc" }, U:{ label:"Blue", hex:"#1e6eb5" },
                B:{ label:"Black", hex:"#8b5cf6" }, R:{ label:"Red", hex:"#ef4444" },
                G:{ label:"Green", hex:"#22c55e" }, C:{ label:"Colorless", hex:"#888" },
              };
              const total = Object.values(colorDist).reduce((a,b)=>a+b,0);
              return (
                <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>COLOR DISTRIBUTION</div>
                  {/* Stacked bar */}
                  <div style={{ display:"flex", height:10, borderRadius:6, overflow:"hidden", marginBottom:10 }}>
                    {["W","U","B","R","G","C"].filter(c => colorDist[c]).map(c => (
                      <div key={c} style={{ flex:colorDist[c], background:COLOR_META[c].hex, transition:"flex 0.3s" }}/>
                    ))}
                  </div>
                  {["W","U","B","R","G","C"].filter(c => colorDist[c]).map(c => {
                    const pct = ((colorDist[c]/total)*100).toFixed(0);
                    return (
                      <div key={c} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:COLOR_META[c].hex, flexShrink:0 }}/>
                        <span style={{ color:"#888", fontSize:12, flex:1 }}>{COLOR_META[c].label}</span>
                        <span style={{ color:"#555", fontSize:12 }}>{colorDist[c]} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Rarity distribution */}
            {Object.keys(rarityDist).length > 0 && (() => {
              const RARITY = {
                common:   { label:"Common",   color:"#888" },
                uncommon: { label:"Uncommon", color:"#c0c0c0" },
                rare:     { label:"Rare",     color:"#f59e0b" },
                mythic:   { label:"Mythic",   color:"#f97316" },
              };
              const total = Object.values(rarityDist).reduce((a,b)=>a+b,0);
              return (
                <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>RARITY BREAKDOWN</div>
                  <div style={{ display:"flex", gap:0, height:10, borderRadius:6, overflow:"hidden", marginBottom:10 }}>
                    {["common","uncommon","rare","mythic"].filter(r => rarityDist[r]).map(r => (
                      <div key={r} style={{ flex:rarityDist[r], background:RARITY[r].color }}/>
                    ))}
                  </div>
                  {["mythic","rare","uncommon","common"].filter(r => rarityDist[r]).map(r => {
                    const pct = ((rarityDist[r]/total)*100).toFixed(0);
                    return (
                      <div key={r} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:RARITY[r].color, flexShrink:0 }}/>
                        <span style={{ color:"#888", fontSize:12, flex:1 }}>{RARITY[r].label}</span>
                        <span style={{ color:"#555", fontSize:12 }}>{rarityDist[r]} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Missing cards */}
            {missingCards.length > 0 && (
              <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:10 }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5 }}>MISSING CARDS</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#ef4444" }}>
                    {fmt(missingValue)} to complete
                  </div>
                </div>
                {[...missingCards].sort((a,b) => parseFloat(b.card?.prices?.usd||0)-parseFloat(a.card?.prices?.usd||0)).map(c => {
                  const price = parseFloat(c.card?.prices?.usd || 0);
                  return (
                    <div key={c.card.id} style={{ display:"flex", alignItems:"center", gap:10,
                      padding:"8px 0", borderBottom:`1px solid ${BORDER}` }}>
                      <img src={c.card.images?.small || c.card.image_uris?.small}
                        style={{ height:40, borderRadius:4, flexShrink:0 }}
                        onError={e => { e.target.style.display="none"; }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color:"#fff", fontSize:12 }}>{c.card.name}</div>
                        <div style={{ color:"#555", fontSize:10 }}>{c.card.set?.name || c.card.set_name}</div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ color:"#ef4444", fontSize:13, fontWeight:700 }}>
                          {c.qty > 1 ? `${c.qty}× ` : ""}{fmt(price*(c.qty||1))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent games */}
            {(deck.record?.games || []).length > 0 && (
              <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
                <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>RECENT GAMES</div>
                {[...(deck.record?.games||[])].reverse().slice(0,10).map((g, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                    borderBottom:`1px solid ${BORDER}` }}>
                    <span style={{ width:28, height:28, borderRadius:"50%", flexShrink:0,
                      background: g.result==="win" ? TEAL+"22" : g.result==="loss" ? "#ef444422" : "#33333322",
                      border: `2px solid ${g.result==="win" ? TEAL : g.result==="loss" ? "#ef4444" : "#555"}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color: g.result==="win" ? TEAL : g.result==="loss" ? "#ef4444" : "#555",
                      fontSize:10, fontWeight:800 }}>
                      {g.result==="win" ? "W" : g.result==="loss" ? "L" : "D"}
                    </span>
                    <div style={{ flex:1 }}>
                      {g.opponent && <div style={{ color:"#888", fontSize:12 }}>vs {g.opponent}</div>}
                      {g.note && <div style={{ color:"#555", fontSize:11 }}>{g.note}</div>}
                    </div>
                    <div style={{ color:"#444", fontSize:10 }}>
                      {new Date(g.date).toLocaleDateString("en-US", {month:"short", day:"numeric"})}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Life Counter ──────────────────────────────────────────────────────────────
const PLAYER_COLORS = ["#a855f7","#3b82f6","#ef4444","#22c55e","#f59e0b","#ec4899"];

function LifeCounter({ deck, onClose, onRecordResult, allDecks }) {
  const fmt_obj   = FORMATS.find(f => f.id === deck?.format) || FORMATS[10];
  const startLife = fmt_obj.life;
  const isCommander = deck?.format === "commander" || deck?.format === "brawl";

  const [playerCount, setPlayerCount] = useState(
    isCommander ? Math.min(Math.max(deck?.playerCount || 4, 2), 6) : 2
  );
  const [players, setPlayers]   = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const [showSetup, setShowSetup] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [resultNote, setResultNote] = useState("");
  const [opponent, setOpponent] = useState("");
  const [cmdDmg, setCmdDmg]     = useState({});
  const [cmdDmgPanel, setCmdDmgPanel] = useState(null);

  const initPlayers = useCallback((count) => {
    const names = deck ? [`${deck.name}`, "Player 2","Player 3","Player 4","Player 5","Player 6"] : ["Player 1","Player 2","Player 3","Player 4","Player 5","Player 6"];
    const newPlayers = Array.from({ length: count }, (_, i) => ({
      name: names[i] || `Player ${i+1}`, life: startLife, poison: 0, color: PLAYER_COLORS[i],
    }));
    setPlayers(newPlayers);
    const dmg = {};
    for (let i = 0; i < count; i++) { dmg[i] = {}; for (let j = 0; j < count; j++) if (j!==i) dmg[i][j]=0; }
    setCmdDmg(dmg);
  }, [deck, startLife]);

  useEffect(() => { initPlayers(playerCount); }, [playerCount]);

  const adjustLife    = (idx, delta) => setPlayers(prev => prev.map((p, i) => i===idx ? {...p, life: p.life+delta} : p));
  const adjustPoison  = (idx, delta) => setPlayers(prev => prev.map((p, i) => i===idx ? {...p, poison: Math.max(0, p.poison+delta)} : p));
  const adjustCmdDmg  = (victim, attacker, delta) => {
    setCmdDmg(prev => {
      const next = { ...prev, [victim]: { ...prev[victim], [attacker]: Math.max(0, (prev[victim]?.[attacker]||0)+delta) } };
      if ((next[victim]?.[attacker]||0) >= 21) setPlayers(p => p.map((pl, i) => i===victim ? {...pl, life:0} : pl));
      return next;
    });
  };
  const declareWinner = (idx) => { setGameOver({ winner: idx }); setShowResult(true); };
  const resetGame = () => { initPlayers(playerCount); setGameOver(null); setShowResult(false); setResultNote(""); setOpponent(""); };

  if (showSetup) {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:BG }}>
        <div style={{ background:"#0d0d0d", borderBottom:`1px solid ${BORDER}`,
          padding:"12px 16px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:TEAL }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4l-6 6 6 6" stroke={TEAL} strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", letterSpacing:0.5 }}>
            LIFE COUNTER
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"20px 16px" }}>
          {deck && (
            <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12,
              padding:"12px 14px", marginBottom:20, display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1 }}>
                <div style={{ color:TEAL, fontWeight:700, fontSize:14 }}>{deck.name}</div>
                <div style={{ color:"#555", fontSize:11 }}>{fmt_obj.label} · {startLife} life</div>
              </div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:FORMAT_COLORS[deck.format]||"#fff" }}>{startLife}</div>
            </div>
          )}
          <div style={{ marginBottom:20 }}>
            <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>STARTING LIFE</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[20,25,30,40,50,60].map(n => (
                <button key={n} onClick={() => setPlayers(prev => prev.map(p => ({...p,life:n})))}
                  style={{ flex:1, minWidth:44, padding:"10px 0", borderRadius:10, cursor:"pointer",
                    fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:0.5,
                    background: players[0]?.life===n ? TEAL+"33" : "#1a1a1a",
                    border:`2px solid ${players[0]?.life===n ? TEAL : BORDER}`,
                    color: players[0]?.life===n ? TEAL : "#555",
                  }}>{n}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom:24 }}>
            <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>PLAYERS</div>
            <div style={{ display:"flex", gap:6 }}>
              {[2,3,4,5,6].map(n => (
                <button key={n} onClick={() => setPlayerCount(n)}
                  style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer",
                    fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
                    background: playerCount===n ? TEAL+"33" : "#1a1a1a",
                    border:`2px solid ${playerCount===n ? TEAL : BORDER}`,
                    color: playerCount===n ? TEAL : "#555",
                  }}>{n}</button>
              ))}
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
            <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:2 }}>PLAYER NAMES</div>
            {players.map((p, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:p.color, flexShrink:0 }}/>
                <input value={p.name}
                  onChange={e => setPlayers(prev => prev.map((pl,j) => j===i ? {...pl,name:e.target.value} : pl))}
                  style={{ flex:1, background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:8,
                    padding:"8px 12px", color:"#fff", fontSize:13, fontFamily:"inherit", outline:"none" }}/>
              </div>
            ))}
          </div>
          <button onClick={() => setShowSetup(false)} style={{
            width:"100%", padding:"16px 0", background:TEAL, border:"none", borderRadius:14,
            color:"#000", fontFamily:"'Bebas Neue',sans-serif", letterSpacing:1, fontSize:20, cursor:"pointer",
          }}>START MATCH</button>
        </div>
      </div>
    );
  }

  const cols = playerCount <= 2 ? 1 : 2;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#080808", userSelect:"none" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px",
        background:"rgba(0,0,0,0.6)", flexShrink:0, borderBottom:`1px solid #111` }}>
        <button onClick={() => setShowSetup(true)} style={{ background:"none", border:"none", cursor:"pointer", color:"#444", padding:4 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 3L5 9l6 6" stroke="#444" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
        <div style={{ flex:1, fontFamily:"'Bebas Neue',sans-serif", color:"#333", fontSize:14, letterSpacing:1 }}>
          {deck?.name || "QUICK GAME"} · {fmt_obj.label.toUpperCase()}
        </div>
        <button onClick={resetGame} style={{ background:"none", border:`1px solid #222`,
          borderRadius:6, color:"#444", fontSize:11, cursor:"pointer", padding:"3px 8px", fontFamily:"inherit" }}>Reset</button>
      </div>

      <div style={{ flex:1, display:"grid",
        gridTemplateColumns: cols === 1 ? "1fr" : "1fr 1fr",
        gridTemplateRows: playerCount <= 2 ? `repeat(${playerCount}, 1fr)` : `repeat(${Math.ceil(playerCount/2)}, 1fr)`,
        gap:2, padding:2, overflow:"hidden" }}>
        {players.map((p, idx) => {
          const isDead = p.life <= 0 || p.poison >= 10;
          const totalCmdDmgReceived = Object.values(cmdDmg[idx]||{}).reduce((s,v)=>s+v,0);
          const isLastOdd = playerCount % 2 !== 0 && idx === playerCount - 1;
          return (
            <div key={idx} style={{
              gridColumn: isLastOdd ? "1 / -1" : "auto",
              background: isDead ? "#0a0a0a" : `${p.color}08`,
              border: `1px solid ${isDead ? "#1a1a1a" : p.color+"33"}`,
              borderRadius:10, display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", position:"relative", padding:"8px 6px",
              minHeight:0, overflow:"hidden",
            }}>
              <div style={{ color: isDead ? "#333" : p.color+"cc", fontSize:11, fontWeight:700,
                letterSpacing:0.5, marginBottom:4, textTransform:"uppercase" }}>{p.name}</div>
              <div style={{ display:"flex", alignItems:"center", width:"100%", justifyContent:"center" }}>
                <button onPointerDown={e=>{ e.preventDefault(); adjustLife(idx,-1); }}
                  style={{ flex:1, height:80, background:"transparent", border:"none", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color: isDead ? "#222" : "#333", fontSize:32, fontWeight:100 }}>−</button>
                <div style={{ textAlign:"center", lineHeight:1 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif",
                    fontSize: Math.abs(p.life) >= 100 ? 52 : 68,
                    color: isDead ? "#2a2a2a" : p.life <= 5 ? "#ef4444" : "#fff",
                    letterSpacing:-1, transition:"color 0.3s" }}>{p.life}</div>
                </div>
                <button onPointerDown={e=>{ e.preventDefault(); adjustLife(idx,+1); }}
                  style={{ flex:1, height:80, background:"transparent", border:"none", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    color: isDead ? "#222" : "#333", fontSize:32, fontWeight:100 }}>+</button>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <button onPointerDown={e=>{e.preventDefault();adjustPoison(idx,-1)}}
                    style={{ width:22,height:22,borderRadius:4,background:"#1a1a1a",border:`1px solid #333`,
                      color:"#555",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>−</button>
                  <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <circle cx="5" cy="5" r="4" fill={p.poison > 0 ? "#22c55e" : "#222"} stroke="#333"/>
                    </svg>
                    <span style={{ color: p.poison > 0 ? "#22c55e" : "#333", fontSize:12, fontWeight:700, minWidth:12, textAlign:"center" }}>{p.poison}</span>
                  </div>
                  <button onPointerDown={e=>{e.preventDefault();adjustPoison(idx,+1)}}
                    style={{ width:22,height:22,borderRadius:4,background:"#1a1a1a",border:`1px solid #333`,
                      color:"#555",cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center" }}>+</button>
                </div>
                {isCommander && (
                  <button onPointerDown={e=>{e.preventDefault();setCmdDmgPanel(cmdDmgPanel===idx?null:idx)}}
                    style={{ background: totalCmdDmgReceived>0?"#a855f722":"#1a1a1a",
                      border:`1px solid ${totalCmdDmgReceived>0?"#a855f7":"#333"}`,
                      borderRadius:6, color: totalCmdDmgReceived>0?"#a855f7":"#555",
                      fontSize:10, fontWeight:700, cursor:"pointer", padding:"3px 7px", fontFamily:"inherit" }}>
                    ⚔ {totalCmdDmgReceived||0}
                  </button>
                )}
                {!isDead && !gameOver && (
                  <button onPointerDown={e=>{e.preventDefault();declareWinner(idx)}}
                    style={{ background:"#1a1a1a", border:`1px solid #333`, borderRadius:6,
                      color:"#555", fontSize:10, cursor:"pointer", padding:"3px 7px", fontFamily:"inherit" }}>👑</button>
                )}
                {isDead && <div style={{ color:"#333", fontSize:10, fontWeight:700 }}>ELIMINATED</div>}
              </div>
            </div>
          );
        })}
      </div>

      {cmdDmgPanel !== null && isCommander && (
        <div style={{ background:"#0d0d0d", border:`1px solid #1a1a1a`, padding:"12px 16px", flexShrink:0 }}>
          <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>
            CMD DAMAGE ON {players[cmdDmgPanel]?.name.toUpperCase()}
          </div>
          <div style={{ display:"flex", gap:8, overflowX:"auto" }}>
            {players.map((attacker, ai) => {
              if (ai === cmdDmgPanel) return null;
              const dmg = cmdDmg[cmdDmgPanel]?.[ai] || 0;
              return (
                <div key={ai} style={{ flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <div style={{ color:attacker.color, fontSize:10, fontWeight:700 }}>{attacker.name.slice(0,8)}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <button onPointerDown={e=>{e.preventDefault();adjustCmdDmg(cmdDmgPanel,ai,-1)}}
                      style={{ width:26,height:26,borderRadius:6,background:"#1a1a1a",border:`1px solid #333`,color:"#555",cursor:"pointer",fontSize:16 }}>−</button>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22,
                      color: dmg>=21?"#ef4444":dmg>0?attacker.color:"#333", minWidth:28, textAlign:"center" }}>{dmg}</div>
                    <button onPointerDown={e=>{e.preventDefault();adjustCmdDmg(cmdDmgPanel,ai,+1)}}
                      style={{ width:26,height:26,borderRadius:6,background:"#1a1a1a",border:`1px solid #333`,color:"#555",cursor:"pointer",fontSize:16 }}>+</button>
                  </div>
                  {dmg >= 21 && <div style={{ color:"#ef4444", fontSize:9, fontWeight:700 }}>DEAD</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showResult && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:24 }}>
          <div style={{ background:"#141414", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:360 }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:TEAL,
              letterSpacing:1, textAlign:"center", marginBottom:4 }}>
              {gameOver ? `${players[gameOver.winner]?.name} wins!` : "GAME OVER"}
            </div>
            <div style={{ color:"#555", fontSize:12, textAlign:"center", marginBottom:20 }}>{fmt_obj.label}</div>
            {deck && (
              <>
                <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>WHO WON THIS GAME?</div>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  {["win","loss","draw"].map(r => (
                    <button key={r} onClick={() => setGameOver(g => ({...g, myResult:r}))}
                      style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer",
                        fontSize:12, fontWeight:700, fontFamily:"inherit", textTransform:"uppercase",
                        background: gameOver?.myResult===r ? (r==="win"?TEAL:r==="loss"?"#ef4444":"#555")+"33" : "#1a1a1a",
                        border:`2px solid ${gameOver?.myResult===r ? (r==="win"?TEAL:r==="loss"?"#ef4444":"#555") : BORDER}`,
                        color: gameOver?.myResult===r ? (r==="win"?TEAL:r==="loss"?"#ef4444":"#555") : "#555",
                      }}>{r==="win"?"I Won":r==="loss"?"I Lost":"Draw"}</button>
                  ))}
                </div>
                <input value={opponent} onChange={e=>setOpponent(e.target.value)}
                  placeholder="Opponent (optional)"
                  style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`,
                    borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:13,
                    fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:10 }}/>
                <input value={resultNote} onChange={e=>setResultNote(e.target.value)}
                  placeholder="Notes (optional)"
                  style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`,
                    borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:13,
                    fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:14 }}/>
                {gameOver?.myResult && (
                  <button onClick={() => { onRecordResult(deck.id, gameOver.myResult, opponent, resultNote); onClose(); }}
                    style={{ width:"100%", padding:"13px 0", background:TEAL, border:"none",
                      borderRadius:12, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer",
                      fontFamily:"inherit", marginBottom:8 }}>
                    Save & Exit
                  </button>
                )}
              </>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={resetGame} style={{ flex:1, padding:"12px 0", background:"#1a1a1a",
                border:`1px solid ${BORDER}`, borderRadius:12, color:"#888", fontSize:13,
                cursor:"pointer", fontFamily:"inherit" }}>Rematch</button>
              <button onClick={onClose} style={{ flex:1, padding:"12px 0", background:"#1a1a1a",
                border:`1px solid ${BORDER}`, borderRadius:12, color:"#888", fontSize:13,
                cursor:"pointer", fontFamily:"inherit" }}>Exit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main DecksView export ─────────────────────────────────────────────────────
export default function DecksView({ collection, pendingImportText, onClearPendingImport, pendingDeck, onClearPendingDeck, onCardPress, mainTab: mainTabProp, onMainTabChange, onGoToPortfolio }) {
  const [decks, setDecks]             = useState(loadDecks);
  const [editingDeck, setEditingDeck] = useState(null);
  const [playingDeck, setPlayingDeck] = useState(null);
  const [showNew, setShowNew]         = useState(false);
  const [showImport, setShowImport]   = useState(false);
  const [mainTabLocal, setMainTabLocal] = useState(mainTabProp ?? "decks");
  const mainTab = mainTabProp ?? mainTabLocal;
  const setMainTab = (v) => { setMainTabLocal(v); onMainTabChange?.(v); };
  useEffect(() => {
    if (pendingImportText) setShowImport(true);
  }, [pendingImportText]);

  useEffect(() => {
    if (!pendingDeck) return;
    const next = [...decks, pendingDeck];
    setDecks(next); saveDecks(next);
    setEditingDeck(pendingDeck);
    onClearPendingDeck?.();
  }, [pendingDeck]);

  const persistDecks = (next) => { setDecks(next); saveDecks(next); };

  const createDeck = (deck) => { persistDecks([...decks, deck]); setShowNew(false); };

  const importDeck = (deck) => {
    persistDecks([...decks, deck]);
    setShowImport(false);
    onClearPendingImport?.();
    setEditingDeck(deck);
  };

  const updateDeck = (updated) => {
    persistDecks(decks.map(d => d.id === updated.id ? updated : d));
    setEditingDeck(updated);
  };

  const deleteDeck = (id) => {
    if (!window.confirm("Delete this deck?")) return;
    persistDecks(decks.filter(d => d.id !== id));
    if (editingDeck?.id === id) setEditingDeck(null);
  };

  const recordResult = (deckId, result, opponent, note) => {
    persistDecks(decks.map(d => {
      if (d.id !== deckId) return d;
      const rec = { ...d.record };
      if (result === "win")  rec.wins   = (rec.wins  || 0) + 1;
      if (result === "loss") rec.losses = (rec.losses || 0) + 1;
      if (result === "draw") rec.draws  = (rec.draws  || 0) + 1;
      rec.games = [...(rec.games || []), { result, opponent, note, date: Date.now() }];
      return { ...d, record: rec };
    }));
  };

  const addCardToDeck = (card, deckId) => {
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return;
    const existing = deck.cards.findIndex(c => c.card.id === card.id);
    let newCards;
    if (existing >= 0) {
      const fmtObj = FORMATS.find(f => f.id === deck.format) || FORMATS[0];
      if (fmtObj.singleton) return;
      newCards = deck.cards.map((c, i) => i === existing ? { ...c, qty: (c.qty||1)+1 } : c);
    } else {
      const owned = (collection||[]).some(i => i.card.id === card.id);
      newCards = [...deck.cards, { card, qty:1, owned, foil:false, addedAt:Date.now() }];
    }
    persistDecks(decks.map(d => d.id === deckId ? { ...d, cards: newCards } : d));
  };

  // ── Life counter overlay ───────────────────────────────────────────────────
  if (playingDeck !== null) {
    return (
      <LifeCounter
        deck={playingDeck}
        allDecks={decks}
        onClose={() => setPlayingDeck(null)}
        onRecordResult={recordResult}
      />
    );
  }

  // ── Deck editor ────────────────────────────────────────────────────────────
  if (editingDeck) {
    return (
      <DeckEditor
        deck={editingDeck}
        onUpdate={updateDeck}
        onBack={() => setEditingDeck(null)}
        onPlay={(d) => { setEditingDeck(null); setPlayingDeck(d); }}
        collection={collection || []}
      />
    );
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalWins   = decks.reduce((s,d) => s + (d.record?.wins||0), 0);
  const totalLosses = decks.reduce((s,d) => s + (d.record?.losses||0), 0);
  const totalGames  = totalWins + totalLosses + decks.reduce((s,d) => s + (d.record?.draws||0), 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ background:"#0d0d0d", borderBottom:`1px solid ${BORDER}`, padding:"14px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:"#fff", letterSpacing:1 }}>DECKS</div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => setPlayingDeck({ format:"casual", name:"Quick Game" })} style={{
              background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
              color:"#888", fontSize:12, cursor:"pointer", padding:"7px 12px", fontFamily:"inherit",
            }}>Quick Play</button>
            <button onClick={() => setShowNew(true)} style={{
              background:TEAL, border:"none", borderRadius:10,
              color:"#000", fontSize:12, fontWeight:700, cursor:"pointer", padding:"7px 14px", fontFamily:"inherit",
            }}>+ New</button>
          </div>
        </div>

        {/* MY DECKS / PORTFOLIO sub-tabs */}
        <div style={{ display:"flex", marginTop:12, borderBottom:`1px solid ${BORDER}`, marginLeft:-0, marginRight:-0 }}>
          <button onClick={() => setMainTab("decks")} style={{
            flex:1, padding:"9px 0", background:"none", border:"none",
            borderBottom: mainTab==="decks" ? `2px solid ${TEAL}` : "2px solid transparent",
            color: mainTab==="decks" ? TEAL : "#555",
            fontSize:11, fontWeight: mainTab==="decks" ? 700 : 400,
            cursor:"pointer", fontFamily:"inherit", letterSpacing:0.8, marginBottom:-1,
          }}>MY DECKS</button>
          <button onClick={() => onGoToPortfolio?.()} style={{
            flex:1, padding:"9px 0", background:"none", border:"none",
            borderBottom: "2px solid transparent",
            color: "#555",
            fontSize:11, fontWeight:400,
            cursor:"pointer", fontFamily:"inherit", letterSpacing:0.8, marginBottom:-1,
          }}>PORTFOLIO</button>
        </div>

        {mainTab === "decks" && totalGames > 0 && (
          <div style={{ display:"flex", gap:14, marginTop:10 }}>
            <div style={{ color:"#444", fontSize:11 }}>
              <span style={{ color:TEAL, fontWeight:700 }}>{totalWins}</span>W{" "}
              <span style={{ color:"#ef4444", fontWeight:700 }}>{totalLosses}</span>L
              {" "}— {Math.round((totalWins/totalGames)*100)}% win rate
            </div>
            <div style={{ color:"#444", fontSize:11 }}>{decks.length} deck{decks.length!==1?"s":""}</div>
          </div>
        )}
      </div>

      {/* Deck list */}
      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", display:"flex",
          flexDirection:"column", gap:12 }}>
          {decks.length === 0 ? (
            <div style={{ textAlign:"center", padding:"60px 20px" }}>
              <div style={{ marginBottom:12, display:"flex", justifyContent:"center" }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                  <rect x="1" y="5" width="13" height="17" rx="2" stroke="#444" strokeWidth="1.6" opacity="0.28"/>
                  <rect x="4.5" y="3" width="13" height="17" rx="2" stroke="#444" strokeWidth="1.6" opacity="0.58"/>
                  <rect x="8" y="1" width="13" height="17" rx="2" stroke="#444" strokeWidth="1.8"/>
                </svg>
              </div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#333",
                letterSpacing:1, marginBottom:8 }}>NO DECKS YET</div>
              <div style={{ color:"#444", fontSize:13, marginBottom:24, lineHeight:1.6 }}>
                Build your first deck or import one from Settings.
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                <button onClick={() => setShowNew(true)} style={{
                  background:TEAL, border:"none", borderRadius:12, color:"#000",
                  fontSize:14, fontWeight:700, cursor:"pointer", padding:"12px 24px", fontFamily:"inherit",
                }}>Build a Deck</button>
              </div>
            </div>
          ) : (
            decks.map(deck => (
              <DeckCard
                key={deck.id}
                deck={deck}
                onOpen={d => setEditingDeck(d)}
                onPlay={d => setPlayingDeck(d)}
                onDelete={deleteDeck}
              />
            ))
          )}

          {decks.length > 0 && (
            <button onClick={() => setPlayingDeck({ format:"casual", name:"Quick Game" })}
              style={{ width:"100%", padding:"14px 0", background:"#1a1a1a",
                border:`1px dashed #2a2a2a`, borderRadius:14, color:"#444", fontSize:13,
                cursor:"pointer", fontFamily:"inherit", marginTop:4 }}>
              + Quick Play (no deck selected)
            </button>
          )}
        </div>

      {showNew && <NewDeckModal onSave={createDeck} onClose={() => setShowNew(false)}/>}

      {showImport && (
        <ImportModal
          initialText={pendingImportText}
          onClose={() => {
            setShowImport(false);
            onClearPendingImport?.();
          }}
          onImported={importDeck}
        />
      )}
    </div>
  );
}
