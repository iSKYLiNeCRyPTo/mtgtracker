/**
 * DecksView.jsx — Deck builder + life counter for MTGTracker
 *
 * Tabs inside the Decks screen:
 *   My Decks  — list of saved decks with W/L, value, play button
 *   [Deck detail] — card list, mana curve, missing cards
 *   Life Counter — opened via "Play" on any deck (or Quick Play)
 *
 * Data stored in localStorage under "mtg-decks-v1".
 * Card lookups use Scryfall (same helpers already in App.jsx, injected as props).
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

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

const MANA_COLORS = { W:"#f9fafb", U:"#3b82f6", B:"#a855f7", R:"#ef4444", G:"#22c55e" };
const MANA_LABELS = { W:"White", U:"Blue", B:"Black", R:"Red", G:"Green" };

function ManaSymbol({ color, size = 14 }) {
  const bg = MANA_COLORS[color] || "#6b7280";
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:bg, border:"1.5px solid rgba(0,0,0,0.4)",
      display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <span style={{ fontSize:size*0.55, fontWeight:800, color: color === "W" ? "#000" : color === "B" ? "#fff" : "#fff", lineHeight:1 }}>
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

  return (
    <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:"16px",
      display:"flex", flexDirection:"column", gap:12 }}>
      {/* Header row */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:0.5,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"60vw" }}>
              {deck.name}
            </div>
            <span style={{ background:col+"22", border:`1px solid ${col}44`, color:col,
              fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:20, letterSpacing:0.5,
              flexShrink:0 }}>
              {fmt_obj.label.toUpperCase()}
            </span>
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
  const [name, setName]         = useState("");
  const [format, setFormat]     = useState("commander");
  const [commander, setCommander] = useState("");
  const [cmdSearch, setCmdSearch] = useState([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef(null);

  const isEDH = ["commander","brawl","oathbreaker"].includes(format);

  const searchCommander = async (q) => {
    if (!q.trim() || q.length < 2) { setCmdSearch([]); return; }
    setSearching(true);
    try {
      // Scryfall search — legendary creatures for commander
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

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", zIndex:200,
      display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div style={{ background:"#141414", borderRadius:"20px 20px 0 0", width:"100%",
        padding:"20px 20px 40px", maxHeight:"90vh", overflowY:"auto" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff",
          letterSpacing:1, marginBottom:20 }}>NEW DECK</div>

        {/* Name */}
        <div style={{ marginBottom:14 }}>
          <div style={{ color:"#555", fontSize:11, marginBottom:6, letterSpacing:0.5 }}>DECK NAME</div>
          <input value={name} onChange={e=>setName(e.target.value)}
            placeholder="My Deck..."
            style={{ width:"100%", background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
              padding:"12px 14px", color:"#fff", fontSize:15, fontFamily:"inherit",
              outline:"none", boxSizing:"border-box" }}/>
        </div>

        {/* Format */}
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

        {/* Commander / Oathbreaker */}
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
    </div>
  );
}

// ── Deck Detail / Editor ──────────────────────────────────────────────────────
function DeckEditor({ deck, onUpdate, onBack, onPlay, collection }) {
  const [search, setSearch]         = useState("");
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [activeType, setActiveType] = useState("All");
  const [subTab, setSubTab]         = useState("cards"); // cards | missing | stats
  const timerRef = useRef(null);

  const fmt_obj = FORMATS.find(f => f.id === deck.format) || FORMATS[0];
  const col     = FORMAT_COLORS[deck.format] || "#6b7280";

  const doSearch = async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      // Legality filter
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
      const isSingleton = fmt_obj.singleton;
      if (isSingleton) return; // can't add duplicate in singleton formats
      newCards = deck.cards.map((c, i) => i === existing ? { ...c, qty: (c.qty||1)+1 } : c);
    } else {
      // Check if owned in collection
      const ownedInCollection = collection.some(i => i.card.id === card.id);
      newCards = [...deck.cards, {
        card,
        qty: 1,
        owned: ownedInCollection,
        foil: false,
        addedAt: Date.now(),
      }];
    }
    const updated = { ...deck, cards: newCards };
    onUpdate(updated);
  };

  const removeCard = (cardId) => {
    const updated = { ...deck, cards: deck.cards.filter(c => c.card.id !== cardId) };
    onUpdate(updated);
  };

  const toggleOwned = (cardId) => {
    const updated = { ...deck, cards: deck.cards.map(c =>
      c.card.id === cardId ? { ...c, owned: !c.owned } : c
    )};
    onUpdate(updated);
  };

  const toggleFoil = (cardId) => {
    const updated = { ...deck, cards: deck.cards.map(c =>
      c.card.id === cardId ? { ...c, foil: !c.foil } : c
    )};
    onUpdate(updated);
  };

  const setQty = (cardId, qty) => {
    if (qty < 1) { removeCard(cardId); return; }
    const max = fmt_obj.singleton ? 1 : 4;
    const updated = { ...deck, cards: deck.cards.map(c =>
      c.card.id === cardId ? { ...c, qty: Math.min(qty, max) } : c
    )};
    onUpdate(updated);
  };

  // Group cards by type
  const grouped = {};
  TYPE_ORDER.forEach(t => { grouped[t] = []; });
  deck.cards.forEach(c => {
    const t = getCardType(c.card);
    if (grouped[t]) grouped[t].push(c);
    else grouped["Other"].push(c);
  });

  const types = ["All", ...TYPE_ORDER.filter(t => grouped[t]?.length > 0)];
  const displayCards = activeType === "All" ? deck.cards : (grouped[activeType] || []);

  const totalCards    = deckCardCount(deck);
  const totalOwned    = deckOwnedCount(deck);
  const totalValue    = deckValue(deck);
  const missingCards  = deck.cards.filter(c => !c.owned);
  const missingValue  = missingCards.reduce((s, c) => {
    const price = parseFloat(c.card?.prices?.usd || 0);
    return s + price * (c.qty || 1);
  }, 0);
  const pips = colorIdentityPips(deck);

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
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ color:col, fontSize:10, fontWeight:700 }}>{fmt_obj.label.toUpperCase()}</span>
            {pips.map(p => <ManaSymbol key={p} color={p} size={12}/>)}
            {deck.commander && <span style={{ color:"#555", fontSize:10 }}>· {deck.commander}</span>}
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
        {[["cards","Cards"], ["missing","Missing"], ["stats","Stats"]].map(([id, label]) => (
          <button key={id} onClick={()=>setSubTab(id)} style={{
            flex:1, padding:"11px 0", background:"none", border:"none",
            borderBottom: subTab===id ? `2px solid ${TEAL}` : "2px solid transparent",
            color: subTab===id ? TEAL : "#555", fontSize:12, fontWeight: subTab===id ? 700 : 400,
            cursor:"pointer", fontFamily:"inherit", letterSpacing:0.3,
          }}>{label}
          {id==="missing" && missingCards.length > 0 &&
            <span style={{ marginLeft:4, background:"#ef4444", color:"#fff", fontSize:9,
              borderRadius:10, padding:"1px 5px" }}>{missingCards.reduce((s,c)=>s+(c.qty||1),0)}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>

        {/* ── Cards tab ── */}
        {subTab === "cards" && (
          <>
            {/* Search */}
            <div style={{ padding:"12px 16px 0", flexShrink:0 }}>
              <div style={{ position:"relative" }}>
                <input value={search} onChange={e=>{
                  setSearch(e.target.value);
                  clearTimeout(timerRef.current);
                  timerRef.current = setTimeout(()=>doSearch(e.target.value), 350);
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
                  <button onClick={()=>{ setSearch(""); setResults([]); }}
                    style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                      background:"none", border:"none", cursor:"pointer", color:"#555" }}>✕</button>
                )}
              </div>
            </div>

            {/* Search results */}
            {results.length > 0 && (
              <div style={{ margin:"8px 16px 0", background:"#0d0d0d", border:`1px solid ${BORDER}`,
                borderRadius:10, overflow:"hidden", flexShrink:0 }}>
                {results.map(card => {
                  const price = parseFloat(card.prices?.usd || 0);
                  const inDeck = deck.cards.some(c => c.card.id === card.id);
                  return (
                    <button key={card.id} onClick={()=>{ addCard(card); setSearch(""); setResults([]); }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                        width:"100%", background: inDeck ? TEAL+"11" : "none",
                        border:"none", borderBottom:`1px solid ${BORDER}`, cursor:"pointer",
                        textAlign:"left" }}>
                      {card.image_uris?.small && (
                        <img src={card.image_uris.small} style={{ height:40, borderRadius:3, flexShrink:0 }}/>
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

            {/* Type filter pills */}
            {deck.cards.length > 0 && (
              <div style={{ padding:"10px 16px 0", display:"flex", gap:6, overflowX:"auto",
                flexShrink:0, scrollbarWidth:"none" }}>
                {types.map(t => (
                  <button key={t} onClick={()=>setActiveType(t)} style={{
                    flexShrink:0, padding:"5px 12px", borderRadius:20, cursor:"pointer",
                    background: activeType===t ? TEAL+"22" : "#1a1a1a",
                    border: `1.5px solid ${activeType===t ? TEAL : BORDER}`,
                    color: activeType===t ? TEAL : "#555", fontSize:11, fontFamily:"inherit",
                    fontWeight: activeType===t ? 700 : 400,
                  }}>
                    {t} {t !== "All" && `(${grouped[t]?.length || 0})`}
                  </button>
                ))}
              </div>
            )}

            {/* Card list */}
            <div style={{ padding:"10px 16px 20px" }}>
              {deck.cards.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px 0", color:"#333" }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>🃏</div>
                  <div style={{ fontSize:13 }}>Search above to add cards</div>
                </div>
              ) : displayCards.map(c => {
                const price = parseFloat((c.foil ? c.card?.prices?.usd_foil : c.card?.prices?.usd) || c.card?.prices?.usd || 0);
                return (
                  <div key={c.card.id} style={{ display:"flex", alignItems:"center", gap:10,
                    padding:"10px 0", borderBottom:`1px solid ${BORDER}` }}>
                    <img src={c.card.images?.small || c.card.image_uris?.small}
                      alt={c.card.name}
                      style={{ height:44, borderRadius:4, flexShrink:0 }}
                      onError={e=>e.target.style.display="none"}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"#fff", fontSize:13, fontWeight:500,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {c.card.name}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
                        {price > 0 && <span style={{ color:TEAL, fontSize:11 }}>{fmt(price * (c.qty||1))}</span>}
                        <button onClick={()=>toggleOwned(c.card.id)} style={{
                          background:"none", border:`1px solid ${c.owned ? TEAL : "#333"}`,
                          borderRadius:6, color: c.owned ? TEAL : "#444", fontSize:9,
                          padding:"1px 6px", cursor:"pointer", fontFamily:"inherit",
                          fontWeight: c.owned ? 700 : 400,
                        }}>{c.owned ? "OWNED" : "NEED"}</button>
                        <button onClick={()=>toggleFoil(c.card.id)} style={{
                          background:"none", border:`1px solid ${c.foil ? "#f59e0b" : "#333"}`,
                          borderRadius:6, color: c.foil ? "#f59e0b" : "#444", fontSize:9,
                          padding:"1px 6px", cursor:"pointer", fontFamily:"inherit",
                        }}>FOIL</button>
                      </div>
                    </div>
                    {/* Qty stepper */}
                    {!fmt_obj.singleton && (
                      <div style={{ display:"flex", alignItems:"center", gap:0, flexShrink:0 }}>
                        <button onClick={()=>setQty(c.card.id, (c.qty||1)-1)} style={{
                          width:28, height:28, borderRadius:"6px 0 0 6px",
                          background:"#1a1a1a", border:`1px solid ${BORDER}`,
                          color:"#888", cursor:"pointer", fontSize:16, lineHeight:1,
                        }}>−</button>
                        <div style={{ width:28, height:28, background:"#111", border:`1px solid ${BORDER}`,
                          borderLeft:"none", borderRight:"none",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#fff", fontSize:13, fontWeight:700 }}>{c.qty||1}</div>
                        <button onClick={()=>setQty(c.card.id, (c.qty||1)+1)} style={{
                          width:28, height:28, borderRadius:"0 6px 6px 0",
                          background:"#1a1a1a", border:`1px solid ${BORDER}`,
                          color:"#888", cursor:"pointer", fontSize:16, lineHeight:1,
                        }}>+</button>
                      </div>
                    )}
                    <button onClick={()=>removeCard(c.card.id)} style={{
                      background:"none", border:"none", cursor:"pointer", color:"#333", padding:4,
                    }}>✕</button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Missing tab ── */}
        {subTab === "missing" && (
          <div style={{ padding:"16px" }}>
            {missingCards.length === 0 ? (
              <div style={{ textAlign:"center", padding:"40px 0" }}>
                <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
                <div style={{ color:TEAL, fontWeight:700, marginBottom:4 }}>Deck complete!</div>
                <div style={{ color:"#555", fontSize:13 }}>You own all cards in this deck.</div>
              </div>
            ) : (
              <>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
                  <div style={{ color:"#555", fontSize:13 }}>
                    {missingCards.reduce((s,c)=>s+(c.qty||1),0)} cards needed
                  </div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#ef4444" }}>
                    {fmt(missingValue)} to complete
                  </div>
                </div>
                {missingCards.sort((a,b) => {
                  const pa = parseFloat(a.card?.prices?.usd || 0);
                  const pb = parseFloat(b.card?.prices?.usd || 0);
                  return pb - pa;
                }).map(c => {
                  const price = parseFloat(c.card?.prices?.usd || 0);
                  return (
                    <div key={c.card.id} style={{ display:"flex", alignItems:"center", gap:10,
                      padding:"10px 0", borderBottom:`1px solid ${BORDER}` }}>
                      <img src={c.card.images?.small || c.card.image_uris?.small}
                        style={{ height:44, borderRadius:4, flexShrink:0 }}
                        onError={e=>e.target.style.display="none"}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color:"#fff", fontSize:13 }}>{c.card.name}</div>
                        <div style={{ color:"#555", fontSize:11 }}>{c.card.set?.name || c.card.set_name}</div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ color:"#ef4444", fontSize:14, fontWeight:700 }}>
                          {c.qty > 1 ? `${c.qty}×` : ""}{fmt(price * (c.qty||1))}
                        </div>
                        {c.card.scryfall_uri && (
                          <a href={c.card.scryfall_uri} target="_blank" rel="noopener noreferrer"
                            style={{ color:TEAL, fontSize:10, textDecoration:"none" }}>Scryfall ↗</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── Stats tab ── */}
        {subTab === "stats" && (
          <div style={{ padding:"16px", display:"flex", flexDirection:"column", gap:14 }}>
            {/* Summary */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                ["Total Cards", `${totalCards} / ${fmt_obj.maxCards}`],
                ["Owned", `${totalOwned} / ${totalCards}`],
                ["Deck Value", fmt(totalValue)],
                ["Still Need", fmt(missingValue)],
              ].map(([label, val]) => (
                <div key={label} style={{ background:CARD, borderRadius:12, padding:"12px 14px",
                  border:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>{label.toUpperCase()}</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff" }}>{val}</div>
                </div>
              ))}
            </div>

            {/* W/L record */}
            <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
              <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>RECORD</div>
              <div style={{ display:"flex", gap:20 }}>
                {[["W", deck.record?.wins||0, TEAL], ["L", deck.record?.losses||0, "#ef4444"], ["D", deck.record?.draws||0, "#555"]].map(([label, val, color]) => (
                  <div key={label}>
                    <div style={{ color:"#444", fontSize:10 }}>{label}</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            <ManaCurve cards={deck.cards}/>

            {/* Type breakdown */}
            <div style={{ background:CARD, borderRadius:12, padding:"14px 16px", border:`1px solid ${BORDER}` }}>
              <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:10 }}>TYPE BREAKDOWN</div>
              {TYPE_ORDER.filter(t => grouped[t]?.length > 0).map(t => {
                const count = grouped[t].reduce((s,c)=>s+(c.qty||1),0);
                const pct = totalCards > 0 ? (count/totalCards)*100 : 0;
                return (
                  <div key={t} style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ color:"#888", fontSize:12 }}>{t}</span>
                      <span style={{ color:"#555", fontSize:12 }}>{count}</span>
                    </div>
                    <div style={{ height:4, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:TEAL+"88", borderRadius:2,
                        transition:"width 0.3s" }}/>
                    </div>
                  </div>
                );
              })}
            </div>

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
  const fmt_obj   = FORMATS.find(f => f.id === deck?.format) || FORMATS[10]; // casual default
  const startLife = fmt_obj.life;
  const isCommander = deck?.format === "commander" || deck?.format === "brawl";

  const [playerCount, setPlayerCount] = useState(
    isCommander ? Math.min(Math.max(deck?.playerCount || 4, 2), 6) : 2
  );
  const [players, setPlayers]   = useState([]);
  const [gameOver, setGameOver] = useState(null); // { winner: playerIndex }
  const [showSetup, setShowSetup] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [resultNote, setResultNote] = useState("");
  const [opponent, setOpponent] = useState("");

  // Commander damage tracking: cmdDmg[victim][attacker] = amount
  const [cmdDmg, setCmdDmg] = useState({});
  const [cmdDmgPanel, setCmdDmgPanel] = useState(null); // index of player viewing cmd dmg

  const initPlayers = useCallback((count) => {
    const names = deck ? [`${deck.name}`, "Player 2","Player 3","Player 4","Player 5","Player 6"] : ["Player 1","Player 2","Player 3","Player 4","Player 5","Player 6"];
    const newPlayers = Array.from({ length: count }, (_, i) => ({
      name: names[i] || `Player ${i+1}`,
      life: startLife,
      poison: 0,
      color: PLAYER_COLORS[i],
    }));
    setPlayers(newPlayers);
    const dmg = {};
    for (let i = 0; i < count; i++) { dmg[i] = {}; for (let j = 0; j < count; j++) if (j!==i) dmg[i][j]=0; }
    setCmdDmg(dmg);
  }, [deck, startLife]);

  useEffect(() => { initPlayers(playerCount); }, [playerCount]);

  const adjustLife = (idx, delta) => {
    setPlayers(prev => prev.map((p, i) => i===idx ? {...p, life: p.life+delta} : p));
  };
  const adjustPoison = (idx, delta) => {
    setPlayers(prev => prev.map((p, i) => i===idx ? {...p, poison: Math.max(0, p.poison+delta)} : p));
  };
  const adjustCmdDmg = (victim, attacker, delta) => {
    setCmdDmg(prev => {
      const next = { ...prev, [victim]: { ...prev[victim], [attacker]: Math.max(0, (prev[victim]?.[attacker]||0)+delta) } };
      // If total cmd dmg from one commander >= 21, auto-kill
      if ((next[victim]?.[attacker]||0) >= 21) {
        setPlayers(p => p.map((pl, i) => i===victim ? {...pl, life: 0} : pl));
      }
      return next;
    });
  };

  const declareWinner = (idx) => {
    setGameOver({ winner: idx });
    setShowResult(true);
  };

  const resetGame = () => {
    initPlayers(playerCount);
    setGameOver(null);
    setShowResult(false);
    setResultNote("");
    setOpponent("");
  };

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
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24,
                color:FORMAT_COLORS[deck.format]||"#fff" }}>{startLife}</div>
            </div>
          )}

          <div style={{ marginBottom:20 }}>
            <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>STARTING LIFE</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {[20,25,30,40,50,60].map(n => (
                <button key={n} onClick={()=>{ setPlayers(prev=>prev.map(p=>({...p,life:n}))); }}
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
                <button key={n} onClick={()=>setPlayerCount(n)}
                  style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer",
                    fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
                    background: playerCount===n ? TEAL+"33" : "#1a1a1a",
                    border:`2px solid ${playerCount===n ? TEAL : BORDER}`,
                    color: playerCount===n ? TEAL : "#555",
                  }}>{n}</button>
              ))}
            </div>
          </div>

          {/* Player name customisation */}
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
            <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:2 }}>PLAYER NAMES</div>
            {players.map((p, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:p.color, flexShrink:0 }}/>
                <input value={p.name}
                  onChange={e=>setPlayers(prev=>prev.map((pl,j)=>j===i?{...pl,name:e.target.value}:pl))}
                  style={{ flex:1, background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:8,
                    padding:"8px 12px", color:"#fff", fontSize:13, fontFamily:"inherit", outline:"none" }}/>
              </div>
            ))}
          </div>

          <button onClick={()=>setShowSetup(false)} style={{
            width:"100%", padding:"16px 0", background:TEAL, border:"none", borderRadius:14,
            color:"#000", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
            fontFamily:"'Bebas Neue',sans-serif", letterSpacing:1, fontSize:20,
          }}>START MATCH</button>
        </div>
      </div>
    );
  }

  // ── Active game ─────────────────────────────────────────────────────────────
  const cols = playerCount <= 2 ? 1 : 2;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#080808",
      userSelect:"none" }}>

      {/* Thin top bar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px",
        background:"rgba(0,0,0,0.6)", flexShrink:0, borderBottom:`1px solid #111` }}>
        <button onClick={()=>setShowSetup(true)} style={{ background:"none", border:"none",
          cursor:"pointer", color:"#444", padding:4 }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M11 3L5 9l6 6" stroke="#444" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
        <div style={{ flex:1, fontFamily:"'Bebas Neue',sans-serif", color:"#333",
          fontSize:14, letterSpacing:1 }}>
          {deck?.name || "QUICK GAME"} · {fmt_obj.label.toUpperCase()}
        </div>
        <button onClick={resetGame} style={{ background:"none", border:`1px solid #222`,
          borderRadius:6, color:"#444", fontSize:11, cursor:"pointer", padding:"3px 8px",
          fontFamily:"inherit" }}>Reset</button>
      </div>

      {/* Player panels */}
      <div style={{ flex:1, display:"grid",
        gridTemplateColumns: cols === 1 ? "1fr" : "1fr 1fr",
        gridTemplateRows: playerCount <= 2 ? `repeat(${playerCount}, 1fr)` : `repeat(${Math.ceil(playerCount/2)}, 1fr)`,
        gap:2, padding:2, overflow:"hidden" }}>

        {players.map((p, idx) => {
          const isDead = p.life <= 0 || p.poison >= 10;
          const totalCmdDmgReceived = Object.values(cmdDmg[idx]||{}).reduce((s,v)=>s+v,0);
          // Odd player in odd-count gets full width
          const isLastOdd = playerCount % 2 !== 0 && idx === playerCount - 1;

          return (
            <div key={idx} style={{
              gridColumn: isLastOdd ? "1 / -1" : "auto",
              background: isDead ? "#0a0a0a" : `${p.color}08`,
              border: `1px solid ${isDead ? "#1a1a1a" : p.color+"33"}`,
              borderRadius:10,
              display:"flex", flexDirection:"column", alignItems:"center",
              justifyContent:"center", position:"relative", padding:"8px 6px",
              minHeight:0, overflow:"hidden",
            }}>
              {/* Player name + status */}
              <div style={{ color: isDead ? "#333" : p.color+"cc", fontSize:11, fontWeight:700,
                letterSpacing:0.5, marginBottom:4, textTransform:"uppercase" }}>
                {p.name}
              </div>

              {/* Life total */}
              <div style={{ display:"flex", alignItems:"center", gap:0, width:"100%",
                justifyContent:"center" }}>
                <button
                  onPointerDown={e=>{ e.preventDefault(); adjustLife(idx, -1); }}
                  style={{ flex:1, height:80, background:"transparent", border:"none",
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                    color: isDead ? "#222" : "#333", fontSize:32, fontWeight:100 }}>−</button>

                <div style={{ textAlign:"center", lineHeight:1 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif",
                    fontSize: Math.abs(p.life) >= 100 ? 52 : 68,
                    color: isDead ? "#2a2a2a" : p.life <= 5 ? "#ef4444" : "#fff",
                    letterSpacing:-1, transition:"color 0.3s" }}>
                    {p.life}
                  </div>
                </div>

                <button
                  onPointerDown={e=>{ e.preventDefault(); adjustLife(idx, +1); }}
                  style={{ flex:1, height:80, background:"transparent", border:"none",
                    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
                    color: isDead ? "#222" : "#333", fontSize:32, fontWeight:100 }}>+</button>
              </div>

              {/* Bottom row: poison + cmd dmg + win button */}
              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
                {/* Poison */}
                <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <button onPointerDown={e=>{e.preventDefault();adjustPoison(idx,-1)}}
                    style={{ width:22,height:22,borderRadius:4,background:"#1a1a1a",border:`1px solid #333`,
                      color:"#555",cursor:"pointer",fontSize:14,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center" }}>−</button>
                  <div style={{ display:"flex", alignItems:"center", gap:3 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <circle cx="5" cy="5" r="4" fill={p.poison > 0 ? "#22c55e" : "#222"} stroke="#333"/>
                    </svg>
                    <span style={{ color: p.poison >= 10 ? "#22c55e" : p.poison > 0 ? "#22c55e" : "#333",
                      fontSize:12, fontWeight:700, minWidth:12, textAlign:"center" }}>{p.poison}</span>
                  </div>
                  <button onPointerDown={e=>{e.preventDefault();adjustPoison(idx,+1)}}
                    style={{ width:22,height:22,borderRadius:4,background:"#1a1a1a",border:`1px solid #333`,
                      color:"#555",cursor:"pointer",fontSize:14,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center" }}>+</button>
                </div>

                {/* Commander damage */}
                {isCommander && (
                  <button onPointerDown={e=>{e.preventDefault();setCmdDmgPanel(cmdDmgPanel===idx?null:idx)}}
                    style={{ background: totalCmdDmgReceived>0?"#a855f722":"#1a1a1a",
                      border:`1px solid ${totalCmdDmgReceived>0?"#a855f7":"#333"}`,
                      borderRadius:6, color: totalCmdDmgReceived>0?"#a855f7":"#555",
                      fontSize:10, fontWeight:700, cursor:"pointer", padding:"3px 7px",
                      fontFamily:"inherit" }}>
                    ⚔ {totalCmdDmgReceived||0}
                  </button>
                )}

                {/* Win button */}
                {!isDead && !gameOver && (
                  <button onPointerDown={e=>{e.preventDefault();declareWinner(idx)}}
                    style={{ background:"#1a1a1a", border:`1px solid #333`,
                      borderRadius:6, color:"#555", fontSize:10, cursor:"pointer",
                      padding:"3px 7px", fontFamily:"inherit" }}>👑</button>
                )}
                {isDead && (
                  <div style={{ color:"#333", fontSize:10, fontWeight:700 }}>ELIMINATED</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Commander damage panel */}
      {cmdDmgPanel !== null && isCommander && (
        <div style={{ background:"#0d0d0d", border:`1px solid #1a1a1a`, padding:"12px 16px",
          flexShrink:0 }}>
          <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>
            CMD DAMAGE ON {players[cmdDmgPanel]?.name.toUpperCase()}
          </div>
          <div style={{ display:"flex", gap:8, overflowX:"auto" }}>
            {players.map((attacker, ai) => {
              if (ai === cmdDmgPanel) return null;
              const dmg = cmdDmg[cmdDmgPanel]?.[ai] || 0;
              return (
                <div key={ai} style={{ flexShrink:0, display:"flex", flexDirection:"column",
                  alignItems:"center", gap:4 }}>
                  <div style={{ color:attacker.color, fontSize:10, fontWeight:700 }}>
                    {attacker.name.slice(0,8)}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <button onPointerDown={e=>{e.preventDefault();adjustCmdDmg(cmdDmgPanel,ai,-1)}}
                      style={{ width:26,height:26,borderRadius:6,background:"#1a1a1a",
                        border:`1px solid #333`,color:"#555",cursor:"pointer",fontSize:16 }}>−</button>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22,
                      color: dmg>=21?"#ef4444":dmg>0?attacker.color:"#333", minWidth:28, textAlign:"center" }}>
                      {dmg}
                    </div>
                    <button onPointerDown={e=>{e.preventDefault();adjustCmdDmg(cmdDmgPanel,ai,+1)}}
                      style={{ width:26,height:26,borderRadius:6,background:"#1a1a1a",
                        border:`1px solid #333`,color:"#555",cursor:"pointer",fontSize:16 }}>+</button>
                  </div>
                  {dmg>=21 && <div style={{color:"#ef4444",fontSize:9,fontWeight:700}}>DEAD</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Game over / result modal */}
      {showResult && (
        <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.92)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:24 }}>
          <div style={{ background:"#141414", borderRadius:20, padding:"24px 20px",
            width:"100%", maxWidth:360 }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:TEAL,
              letterSpacing:1, textAlign:"center", marginBottom:4 }}>
              {gameOver ? `${players[gameOver.winner]?.name} wins!` : "GAME OVER"}
            </div>
            <div style={{ color:"#555", fontSize:12, textAlign:"center", marginBottom:20 }}>
              {fmt_obj.label}
            </div>

            {deck && (
              <>
                <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>
                  WHO WON THIS GAME?
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  {["win","loss","draw"].map(r => (
                    <button key={r} onClick={()=>setGameOver(g=>({...g,myResult:r}))}
                      style={{ flex:1, padding:"10px 0", borderRadius:10, cursor:"pointer",
                        fontSize:12, fontWeight:700, fontFamily:"inherit", textTransform:"uppercase",
                        background: gameOver?.myResult===r
                          ? (r==="win"?TEAL:r==="loss"?"#ef4444":"#555")+"33" : "#1a1a1a",
                        border:`2px solid ${gameOver?.myResult===r
                          ? (r==="win"?TEAL:r==="loss"?"#ef4444":"#555") : BORDER}`,
                        color: gameOver?.myResult===r
                          ? (r==="win"?TEAL:r==="loss"?"#ef4444":"#555") : "#555",
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
                  <button onClick={()=>{
                    onRecordResult(deck.id, gameOver.myResult, opponent, resultNote);
                    onClose();
                  }} style={{ width:"100%", padding:"13px 0", background:TEAL, border:"none",
                    borderRadius:12, color:"#000", fontSize:15, fontWeight:700,
                    cursor:"pointer", fontFamily:"inherit", marginBottom:8 }}>
                    Save & Exit
                  </button>
                )}
              </>
            )}

            <div style={{ display:"flex", gap:8 }}>
              <button onClick={resetGame} style={{ flex:1, padding:"12px 0",
                background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:12,
                color:"#888", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Rematch
              </button>
              <button onClick={onClose} style={{ flex:1, padding:"12px 0",
                background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:12,
                color:"#888", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main DecksView export ─────────────────────────────────────────────────────
export default function DecksView({ collection }) {
  const [decks, setDecks]           = useState(loadDecks);
  const [editingDeck, setEditingDeck] = useState(null);
  const [playingDeck, setPlayingDeck] = useState(null);
  const [showNew, setShowNew]       = useState(false);

  const persistDecks = (next) => { setDecks(next); saveDecks(next); };

  const createDeck = (deck) => { persistDecks([...decks, deck]); setShowNew(false); };

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
      if (result === "win")  rec.wins  = (rec.wins  || 0) + 1;
      if (result === "loss") rec.losses = (rec.losses || 0) + 1;
      if (result === "draw") rec.draws = (rec.draws  || 0) + 1;
      rec.games = [...(rec.games || []), { result, opponent, note, date: Date.now() }];
      return { ...d, record: rec };
    }));
  };

  // Life counter (full screen overlay)
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

  // Deck editor
  if (editingDeck) {
    return (
      <DeckEditor
        deck={editingDeck}
        onUpdate={updateDeck}
        onBack={() => setEditingDeck(null)}
        onPlay={(d) => { setEditingDeck(null); setPlayingDeck(d); }}
        collection={collection}
      />
    );
  }

  // ── Deck list ──────────────────────────────────────────────────────────────
  const totalDecks  = decks.length;
  const totalWins   = decks.reduce((s,d) => s + (d.record?.wins||0), 0);
  const totalLosses = decks.reduce((s,d) => s + (d.record?.losses||0), 0);
  const totalGames  = totalWins + totalLosses + decks.reduce((s,d) => s + (d.record?.draws||0), 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

      {/* Header */}
      <div style={{ background:"#0d0d0d", borderBottom:`1px solid ${BORDER}`,
        padding:"14px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24,
            color:"#fff", letterSpacing:1 }}>DECKS</div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>setPlayingDeck({ format:"casual", name:"Quick Game" })} style={{
              background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
              color:"#888", fontSize:12, cursor:"pointer", padding:"7px 12px",
              fontFamily:"inherit",
            }}>Quick Play</button>
            <button onClick={()=>setShowNew(true)} style={{
              background:TEAL, border:"none", borderRadius:10,
              color:"#000", fontSize:12, fontWeight:700, cursor:"pointer", padding:"7px 14px",
              fontFamily:"inherit",
            }}>+ New Deck</button>
          </div>
        </div>

        {totalGames > 0 && (
          <div style={{ display:"flex", gap:14, marginTop:10 }}>
            <div style={{ color:"#444", fontSize:11 }}>
              <span style={{ color:TEAL, fontWeight:700 }}>{totalWins}</span>W
              {" "}
              <span style={{ color:"#ef4444", fontWeight:700 }}>{totalLosses}</span>L
              {" "}&mdash; {Math.round((totalWins/totalGames)*100)}% win rate
            </div>
            <div style={{ color:"#444", fontSize:11 }}>
              {totalDecks} deck{totalDecks!==1?"s":""}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", display:"flex",
        flexDirection:"column", gap:12 }}>

        {decks.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 20px" }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🃏</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#333",
              letterSpacing:1, marginBottom:8 }}>NO DECKS YET</div>
            <div style={{ color:"#444", fontSize:13, marginBottom:24, lineHeight:1.6 }}>
              Build your first deck — add cards, track what you own, and record your wins.
            </div>
            <button onClick={()=>setShowNew(true)} style={{
              background:TEAL, border:"none", borderRadius:12, color:"#000",
              fontSize:15, fontWeight:700, cursor:"pointer", padding:"14px 32px",
              fontFamily:"inherit",
            }}>Build a Deck</button>
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

        {/* Quick Play shortcut at bottom */}
        {decks.length > 0 && (
          <button onClick={()=>setPlayingDeck({ format:"casual", name:"Quick Game" })}
            style={{ width:"100%", padding:"14px 0",
              background:"#1a1a1a", border:`1px dashed #2a2a2a`,
              borderRadius:14, color:"#444", fontSize:13, cursor:"pointer",
              fontFamily:"inherit", marginTop:4 }}>
            + Quick Play (no deck selected)
          </button>
        )}
      </div>

      {showNew && <NewDeckModal onSave={createDeck} onClose={()=>setShowNew(false)}/>}
    </div>
  );
}
