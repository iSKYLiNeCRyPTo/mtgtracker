import DesktopSidebar from "./Sidebar.jsx";
import DecksView from "./DecksView.jsx";
import { computeAutoTags, getTagMeta, TagChip, TAG_FILTER_GROUPS, HIDDEN_BY_DEFAULT_CATS } from "./cardTags.jsx";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  cacheCard, getCachedCard, cacheCards, cacheSetCards, getCachedSetCards,
  cacheSearchResult, getCachedSearchResult,
  cacheGroups, getCachedGroups,
} from "./cache.js";
import {
  isFirebaseConfigured, signInWithGoogle, signOutUser, onAuthChange, getCurrentUser, handleRedirectResult,
  saveCollectionToFirestore, loadCollectionFromFirestore,
  saveBoxesToFirestore, loadBoxesFromFirestore,
  saveEmbeddingsToFirestore, loadEmbeddingsFromFirestore,
  listenToUserData,
  mergeSharedPriceHistory, pushPriceSnapshotToShared,
  pushFingerprintToShared, loadSharedFingerprints,
  getEmbeddingIndexMeta, downloadEmbeddingIndex, downloadCardsMeta,
  loadGlobalFingerprints, pushGlobalFingerprint,
} from "./firebase.js";
const TEAL   = "#00D4AA";
const BG     = "#0a0a0a";
const CARD   = "#111111";
const BORDER = "#1e1e1e";

// PIN lock — set VITE_PIN as a Text env var in Cloudflare Pages to enable
const UNLOCK_KEY = "mtgtracker_unlocked_v1";

// MTG condition system — standard played grades, foil is a separate toggle on the card
const condColors  = { near_mint:"#00D4AA", lightly_played:"#3b82f6", moderately_played:"#f97316", heavily_played:"#ef4444", damaged:"#7f1d1d" };
const condLabels  = { near_mint:"Near Mint", lightly_played:"Lightly Played", moderately_played:"Moderately Played", heavily_played:"Heavily Played", damaged:"Damaged" };
const CONDITIONS  = ["near_mint","lightly_played","moderately_played","heavily_played","damaged"];
// Condition multipliers vs NM price
const COND_MULT   = { near_mint:1.0, lightly_played:0.75, moderately_played:0.50, heavily_played:0.30, damaged:0.10 };

const fmt = (n) => {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", minimumFractionDigits:2 }).format(n);
};
const fmtCompact = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1000) return "$" + (n/1000).toFixed(1) + "k";
  return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", minimumFractionDigits:2 }).format(n);
};


// ── Pack / Box storage ────────────────────────────────────────────────────────
const BOXES_KEY = "mtg-boxes-v1";

function loadBoxes() {
  try { const r = localStorage.getItem(BOXES_KEY); return r ? JSON.parse(r) : []; } catch(_e) { return []; }
}
function saveBoxes(boxes) {
  try { localStorage.setItem(BOXES_KEY, JSON.stringify(boxes)); } catch(_e) {}
}

const PRODUCT_TYPES = [
  { id:"draft_booster_box",     label:"Draft Booster Box",      defaultPacks:36, cardsPerPack:15 },
  { id:"set_booster_box",       label:"Set Booster Box",        defaultPacks:30, cardsPerPack:12 },
  { id:"collector_booster_box", label:"Collector Booster Box",  defaultPacks:12, cardsPerPack:15 },
  { id:"bundle",                label:"Bundle",                 defaultPacks:9,  cardsPerPack:12 },
  { id:"commander_deck",        label:"Commander Deck",         defaultPacks:1,  cardsPerPack:100 },
  { id:"prerelease_kit",        label:"Prerelease Kit",         defaultPacks:6,  cardsPerPack:15 },
  { id:"jumpstart_pack",        label:"Jumpstart Pack",         defaultPacks:1,  cardsPerPack:20 },
  { id:"single_pack",           label:"Single Pack",            defaultPacks:1,  cardsPerPack:15 },
  { id:"collector_booster",     label:"Collector Booster",      defaultPacks:1,  cardsPerPack:15 },
  { id:"draft_booster",         label:"Draft Booster",          defaultPacks:1,  cardsPerPack:15 },
];


// Maps product type id → allowed Scryfall set_type values (null = show all)
const PRODUCT_SET_TYPES = {
  draft_booster_box:     ["core","expansion","masters","draft_innovation","funny"],
  set_booster_box:       ["core","expansion","masters"],
  collector_booster_box: ["core","expansion","masters"],
  bundle:                ["core","expansion"],
  commander_deck:        ["commander","commander_deck"],
  prerelease_kit:        ["core","expansion"],
  jumpstart_pack:        ["draft_innovation","core","expansion"],
  single_pack:           null,
  collector_booster:     ["core","expansion","masters"],
  draft_booster:         ["core","expansion","masters","draft_innovation"],
};

// ── MTG Sealed Product UPC Map ────────────────────────────────────────────────
// Format: UPC → { name, setName, setCode, productType, totalPacks, cardsPerPack }
// productType must match PRODUCT_TYPES ids
// setCode = Scryfall 3-letter set code (e.g. "otj", "mkm", "lci")
const MTG_UPC_MAP = {
  // ── Outlaws of Thunder Junction ───────────────────────────────────────────
  "195166237442": { name:"Outlaws of Thunder Junction Draft Booster Box",     setName:"Outlaws of Thunder Junction", setCode:"otj", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166237459": { name:"Outlaws of Thunder Junction Set Booster Box",       setName:"Outlaws of Thunder Junction", setCode:"otj", productType:"set_booster_box",       totalPacks:30, cardsPerPack:12 },
  "195166237466": { name:"Outlaws of Thunder Junction Collector Booster Box", setName:"Outlaws of Thunder Junction", setCode:"otj", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  "195166237473": { name:"Outlaws of Thunder Junction Bundle",                setName:"Outlaws of Thunder Junction", setCode:"otj", productType:"bundle",                totalPacks:9,  cardsPerPack:12 },
  // ── Bloomburrow ───────────────────────────────────────────────────────────
  "195166254951": { name:"Bloomburrow Draft Booster Box",                     setName:"Bloomburrow",                 setCode:"blb", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166254968": { name:"Bloomburrow Set Booster Box",                       setName:"Bloomburrow",                 setCode:"blb", productType:"set_booster_box",       totalPacks:30, cardsPerPack:12 },
  "195166254975": { name:"Bloomburrow Collector Booster Box",                 setName:"Bloomburrow",                 setCode:"blb", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  "195166254982": { name:"Bloomburrow Bundle",                                setName:"Bloomburrow",                 setCode:"blb", productType:"bundle",                totalPacks:9,  cardsPerPack:12 },
  // ── Duskmourn ─────────────────────────────────────────────────────────────
  "195166272726": { name:"Duskmourn Draft Booster Box",                       setName:"Duskmourn: House of Horror",  setCode:"dsk", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166272733": { name:"Duskmourn Set Booster Box",                         setName:"Duskmourn: House of Horror",  setCode:"dsk", productType:"set_booster_box",       totalPacks:30, cardsPerPack:12 },
  "195166272740": { name:"Duskmourn Collector Booster Box",                   setName:"Duskmourn: House of Horror",  setCode:"dsk", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  "195166272757": { name:"Duskmourn Bundle",                                  setName:"Duskmourn: House of Horror",  setCode:"dsk", productType:"bundle",                totalPacks:9,  cardsPerPack:12 },
  // ── Foundations ───────────────────────────────────────────────────────────
  "195166290126": { name:"Foundations Draft Booster Box",                     setName:"Magic: The Gathering Foundations", setCode:"fdn", productType:"draft_booster_box", totalPacks:36, cardsPerPack:15 },
  "195166290133": { name:"Foundations Set Booster Box",                       setName:"Magic: The Gathering Foundations", setCode:"fdn", productType:"set_booster_box",   totalPacks:30, cardsPerPack:12 },
  "195166290140": { name:"Foundations Collector Booster Box",                 setName:"Magic: The Gathering Foundations", setCode:"fdn", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  "195166290157": { name:"Foundations Bundle",                                setName:"Magic: The Gathering Foundations", setCode:"fdn", productType:"bundle",             totalPacks:9,  cardsPerPack:12 },
  // ── Innistrad Remastered ──────────────────────────────────────────────────
  "195166306520": { name:"Innistrad Remastered Draft Booster Box",            setName:"Innistrad Remastered",        setCode:"inr", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166306537": { name:"Innistrad Remastered Collector Booster Box",        setName:"Innistrad Remastered",        setCode:"inr", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  // ── Aetherdrift ───────────────────────────────────────────────────────────
  "195166315164": { name:"Aetherdrift Draft Booster Box",                     setName:"Aetherdrift",                 setCode:"dft", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166315171": { name:"Aetherdrift Set Booster Box",                       setName:"Aetherdrift",                 setCode:"dft", productType:"set_booster_box",       totalPacks:30, cardsPerPack:12 },
  "195166315188": { name:"Aetherdrift Collector Booster Box",                 setName:"Aetherdrift",                 setCode:"dft", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  "195166315195": { name:"Aetherdrift Bundle",                                setName:"Aetherdrift",                 setCode:"dft", productType:"bundle",                totalPacks:9,  cardsPerPack:12 },
  // ── Tarkir: Dragonstorm ───────────────────────────────────────────────────
  "195166323299": { name:"Tarkir: Dragonstorm Draft Booster Box",             setName:"Tarkir: Dragonstorm",         setCode:"tdm", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166323305": { name:"Tarkir: Dragonstorm Set Booster Box",               setName:"Tarkir: Dragonstorm",         setCode:"tdm", productType:"set_booster_box",       totalPacks:30, cardsPerPack:12 },
  "195166323312": { name:"Tarkir: Dragonstorm Collector Booster Box",         setName:"Tarkir: Dragonstorm",         setCode:"tdm", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  "195166323329": { name:"Tarkir: Dragonstorm Bundle",                        setName:"Tarkir: Dragonstorm",         setCode:"tdm", productType:"bundle",                totalPacks:9,  cardsPerPack:12 },
  // ── Modern Horizons 3 ─────────────────────────────────────────────────────
  "195166228532": { name:"Modern Horizons 3 Draft Booster Box",               setName:"Modern Horizons 3",           setCode:"mh3", productType:"draft_booster_box",     totalPacks:36, cardsPerPack:15 },
  "195166228549": { name:"Modern Horizons 3 Set Booster Box",                 setName:"Modern Horizons 3",           setCode:"mh3", productType:"set_booster_box",       totalPacks:30, cardsPerPack:12 },
  "195166228556": { name:"Modern Horizons 3 Collector Booster Box",           setName:"Modern Horizons 3",           setCode:"mh3", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
  // ── The Lord of the Rings ─────────────────────────────────────────────────
  "195166195742": { name:"The Lord of the Rings Draft Booster Box",           setName:"The Lord of the Rings: Tales of Middle-earth", setCode:"ltr", productType:"draft_booster_box", totalPacks:36, cardsPerPack:15 },
  "195166195759": { name:"The Lord of the Rings Set Booster Box",             setName:"The Lord of the Rings: Tales of Middle-earth", setCode:"ltr", productType:"set_booster_box",   totalPacks:30, cardsPerPack:12 },
  "195166195766": { name:"The Lord of the Rings Collector Booster Box",       setName:"The Lord of the Rings: Tales of Middle-earth", setCode:"ltr", productType:"collector_booster_box", totalPacks:12, cardsPerPack:15 },
};

// ── Fetch all MTG sets from Scryfall ─────────────────────────────────────────
// Set types we want to show as "main" sets in the pack tracker
const MTG_MAIN_SET_TYPES = ["core","expansion","masters","draft_innovation","funny"];
// Set types shown under "Other" or filtered out
const MTG_EXCLUDED_SET_TERMS = [
  "alchemy", "masterpiece", "from_the_vault", "spellbook", "premium_deck",
  "duel_deck", "planechase", "archenemy", "vanguard",
  "treasure_chest", "memorabilia", "token", "minigame",
];

const _scryfallCache = {};
const SCRYFALL_TTL   = 15 * 60 * 1000; // 15 min

async function scryfallFetch(path) {
  const key = path;
  const mem = _scryfallCache[key];
  if (mem && Date.now() - mem.at < SCRYFALL_TTL) return mem.data;
  const idbKey = "scryfall:" + path;
  const idbHit = await getCachedGroups(idbKey);
  if (idbHit) { _scryfallCache[key] = { data: idbHit, at: Date.now() }; return idbHit; }
  try {
    const res = await fetch("https://api.scryfall.com" + path, {
      headers: { "User-Agent": "MTGTracker/1.0" }
    });
    if (res.ok) {
      const data = await res.json();
      _scryfallCache[key] = { data, at: Date.now() };
      cacheGroups(idbKey, data).catch(() => {});
      return data;
    }
  } catch(_e) {}
  return null;
}

async function fetchAllSetsCached() {
  const cached = await getCachedSetCards("__all_sets_mtg_v2__");
  if (cached?.length) return cached;
  const sets = await fetchAllSets();
  if (sets?.length) cacheSetCards("__all_sets_mtg_v2__", sets).catch(() => {});
  return sets;
}

async function fetchAllSets() {
  try {
    const data = await scryfallFetch("/sets?order=released&direction=desc");
    if (!data?.data) return [];

    return data.data
      .filter(s => {
        if (!s.name || !s.released_at) return false;
        if (MTG_EXCLUDED_SET_TERMS.includes(s.set_type)) return false;
        if (s.digital) return false; // exclude Arena-only sets
        if (s.card_count < 10) return false; // exclude tiny promo sets
        return true;
      })
      .map(s => ({
        id:          s.code,
        name:        s.name,
        series:      s.set_type,
        total:       s.card_count || 0,
        releaseDate: s.released_at || "",
        images: {
          logo:   s.icon_svg_uri || "",
          symbol: s.icon_svg_uri || "",
        },
        _scryfallCode: s.code,
        _setType:      s.set_type,
      }));
  } catch(_e) { return []; }
}

// Fetch cards in a set from Scryfall (paginated)
async function fetchSetCards(setCode) {
  const cacheKey = "__set_cards__" + setCode;
  const cached = await getCachedSetCards(cacheKey);
  if (cached?.length) return cached;

  const all = [];
  let url = `/cards/search?q=e:${setCode}+lang:en&unique=prints&order=collector_number&dir=asc`;
  while (url) {
    const data = await scryfallFetch(url);
    if (!data?.data) break;
    all.push(...data.data);
    url = data.has_more ? data.next_page.replace("https://api.scryfall.com", "") : null;
  }

  const cards = all.map(normalizeScryfallCard);
  if (cards.length) cacheSetCards(cacheKey, cards).catch(() => {});
  return cards;
}

// Normalize a Scryfall card object to a flat shape the app uses throughout
function normalizeScryfallCard(c) {
  // Handle double-faced cards — use front face image
  const faces = c.card_faces;
  const imgUris = c.image_uris || faces?.[0]?.image_uris || {};
  const name    = c.name || (faces?.[0]?.name ?? "");
  const typeLine = c.type_line || faces?.[0]?.type_line || "";

  return {
    id:       c.id,
    name,
    number:   c.collector_number || "",
    rarity:   c.rarity || "common",
    supertype: typeLine.split("—")[0]?.trim() || "",
    type_line: typeLine,
    set: {
      id:   c.set,
      name: c.set_name,
    },
    images: {
      small:  imgUris.small  || imgUris.normal || "",
      large:  imgUris.large  || imgUris.normal || "",
      normal: imgUris.normal || "",
      art_crop: imgUris.art_crop || "",
    },
    prices: c.prices || {},            // { usd, usd_foil, eur, eur_foil, tix }
    tcgplayer_id: c.tcgplayer_id || null,
    scryfall_uri: c.scryfall_uri || "",
    oracle_text:  c.oracle_text || faces?.[0]?.oracle_text || "",
    mana_cost:    c.mana_cost   || faces?.[0]?.mana_cost   || "",
    cmc:          c.cmc || 0,
    colors:       c.colors || faces?.[0]?.colors || [],
    color_identity: c.color_identity || [],
    keywords:     c.keywords || [],
    legalities:   c.legalities || {},
  };
}

// ── Scryfall card search ──────────────────────────────────────────────────────
const _searchTTL   = 5 * 60 * 1000;
const _searchCache = {};

async function searchCards(query, pageSize) {
  pageSize = pageSize || 20;
  if (!query?.trim()) return [];
  const key = query.trim().toLowerCase() + "_" + pageSize;
  const cached = _searchCache[key];
  if (cached && Date.now() - cached.at < _searchTTL) return cached.results;

  try {
    // Scryfall full-text search: try name match first, then fuzzy
    const q = encodeURIComponent(`name:/${query}/`);
    const url = `/cards/search?q=${q}&unique=cards&order=released&dir=desc&page=1`;
    const data = await scryfallFetch(url);
    if (data?.data?.length) {
      const results = data.data.slice(0, pageSize).map(normalizeScryfallCard);
      _searchCache[key] = { results, at: Date.now() };
      return results;
    }
  } catch(_e) {}

  // Fuzzy fallback
  try {
    const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=released&dir=desc`, {
      headers: { "User-Agent": "MTGTracker/1.0" }
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.data?.length) {
        const results = data.data.slice(0, pageSize).map(normalizeScryfallCard);
        _searchCache[key] = { results, at: Date.now() };
        return results;
      }
    }
  } catch(_e) {}

  return [];
}

// ── Scryfall price fetching ───────────────────────────────────────────────────
// Prices come directly from the card object. This fetches a fresh copy by ID.
async function fetchScryfallPrice(card) {
  if (!card?.id) return null;
  try {
    const data = await scryfallFetch(`/cards/${card.id}`);
    if (data?.prices) return data.prices;
  } catch(_e) {}
  return null;
}

// ── Pack Opening Views ────────────────────────────────────────────────────────

// Single pack opening — camera scan loop
function PackOpeningSession({ box, packNumber, onDone, onCancel }) {
  const [cards, setCards]       = useState([]);
  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQ, setSearchQ]   = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [mode, setMode]         = useState("choice"); // choice | scan | search | confirm
  const [setCardList, setSetCardList] = useState(null);
  const [loadingSetCards, setLoadingSetCards] = useState(false);
  const [pendingCard, setPendingCard] = useState(null); // { card, detectedFinish } waiting for confirm
  const [pendingSearch, setPendingSearch] = useState(""); // search query inside the pendingCard alternates picker
  const [showPackTray, setShowPackTray] = useState(false);
  const searchDebounceRef = React.useRef(null);

  // Preload all cards for this set for fast local OCR matching
  // Strip product-type prefixes like "MEO4: " before name lookup
  const cleanSetName = (box.setName || "").replace(/^[A-Z0-9]+\d*:\s*/,"").trim();

  React.useEffect(() => {
    const sid = box.setId || box.cards?.[0]?.card?.set?.id;
    if (!sid && !cleanSetName) return;
    setLoadingSetCards(true);
    loadSetCards(sid, cleanSetName).then(cards => {
      setSetCardList(cards);
      setLoadingSetCards(false);
      console.log(`[MTGTracker] Preloaded ${cards.length} cards for ${sid}`);
    });
  }, [box.setId, cleanSetName]);

  const costPerPack = box.pricePaid / box.totalPacks;

  const addCard = (card, condition = "near_mint", foil = false) => {
    setCards(prev => [...prev, {
      card,
      condition,
      foil: !!foil,
      id: `${card.id}-${Date.now()}`,
    }]);
    setMode("choice");
    setSearchQ(""); setSearchResults([]);
  };

  const removeCard = (id) => setCards(prev => prev.filter(c => c.id !== id));

  // Cycle through conditions on tap — for quick adjustment after adding
  const COND_CYCLE = CONDITIONS;
  const cycleCondition = (id) => setCards(prev => prev.map(c => {
    if (c.id !== id) return c;
    const idx  = COND_CYCLE.indexOf(c.condition);
    const next = COND_CYCLE[(idx + 1) % COND_CYCLE.length];
    return { ...c, condition: next };
  }));
  const toggleFoil = (id) => setCards(prev => prev.map(c =>
    c.id !== id ? c : { ...c, foil: !c.foil }
  ));

  const handleSearch = async (q) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const qLower = q.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

      // 1. Search preloaded local set cards first (instant, no network needed)
      if (setCardList && setCardList.length > 0) {
        const local = setCardList
          .filter(c => c.nameLower.includes(qLower))
          .slice(0, 20)
          .map(c => c._full);
        if (local.length > 0) {
          setSearchResults(local);
          setSearching(false);
          return;
        }
      }

      // 2. Fall back to network search — run set-specific and broad queries in parallel
      const setQuery = box.setId ? `${q} set.id:${box.setId}` : q;
      const [setResults, broadResults] = await Promise.all([
        searchCards(setQuery, 20),
        box.setId ? searchCards(q, 12) : Promise.resolve([]),
      ]);
      let results = setResults.length ? setResults : broadResults;
      if (box.setId && results.length) {
        const filtered = results.filter(c => c.set?.id === box.setId || c.set?.name === box.setName);
        if (filtered.length) results = filtered;
      }
      setSearchResults(results);
    } catch(_e) { setSearchResults([]); }
    setSearching(false);
  };

  const totalValue = cards.reduce((s, c) => {
    const p = genPrices(c.card);
    return s + (p.raw[c.condition] || p.raw.near_mint || 0);
  }, 0);
  const pnl = totalValue - costPerPack;

  return (
    <div style={{ position:"fixed", inset:0, background:BG, zIndex:10000, display:"flex", flexDirection:"column" }}>
      {/* Header — respects Dynamic Island / notch */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"14px 20px", paddingTop:"calc(14px + env(safe-area-inset-top, 0px))",
        borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <button onClick={onCancel} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
          <Icon.Close size={20} color="#fff"/>
        </button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", letterSpacing:1 }}>
            PACK {packNumber}
          </div>
          <div style={{ color:"#555", fontSize:11 }}>{box.setName}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ color:"#555", fontSize:10 }}>COST</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#fff" }}>{fmt(costPerPack)}</div>
        </div>
      </div>

      {/* Cards pulled so far — scrollable, with bottom padding so Done button doesn't overlap */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 20px", paddingBottom:"calc(90px + env(safe-area-inset-bottom, 0px))" }}>
        {cards.length > 0 && (
          <>
            <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:8 }}>CARDS PULLED ({cards.length})</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
              {cards.map(c => {
                const p = genPrices(c.card);
                const val = p.raw[c.condition] || p.raw.near_mint || 0;
                return (
                  <div key={c.id} style={{ position:"relative", width:72 }}>
                    <img src={c.card.images?.small} alt={c.card.name}
                      style={{ width:72, borderRadius:6, display:"block" }}
                      onError={e=>{ e.target.style.opacity="0.3"; }}/>
                    {/* Foil badge — tap to toggle foil */}
                    <button onClick={()=>toggleFoil(c.id)}
                      style={{ position:"absolute", bottom:0, left:0, right:0,
                        background:"rgba(0,0,0,0.82)", borderRadius:"0 0 6px 6px",
                        border:"none", cursor:"pointer", padding:"3px 2px",
                        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span style={{ color:val>5?TEAL:"#888", fontSize:9, fontWeight:700, flex:1, textAlign:"left", paddingLeft:3 }}>{fmt(val)}</span>
                      <span style={{ color:c.foil?"#f59e0b":"#6b7280", fontSize:8, fontWeight:800,
                        background:(c.foil?"#f59e0b":"#6b7280")+"22", borderRadius:3,
                        padding:"1px 4px", flexShrink:0 }}>
                        {c.foil?"FOIL":"NF"}
                      </span>
                    </button>
                    <button onClick={()=>removeCard(c.id)} style={{
                      position:"absolute", top:-6, right:-6, width:18, height:18,
                      borderRadius:"50%", background:"#ef4444", border:"none", cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <Icon.Close size={10} color="#fff"/>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Running P&L */}
            <div style={{ background: pnl>=0?"#0a1f10":"#1a0a0a", border:`1px solid ${pnl>=0?"#1a3d20":"#3d1a1a"}`,
              borderRadius:12, padding:"12px 16px", marginBottom:16, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              <div>
                <div style={{ color:"#555", fontSize:10 }}>Pack Cost</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#ccc" }}>{fmt(costPerPack)}</div>
              </div>
              <div>
                <div style={{ color:"#555", fontSize:10 }}>Value</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff" }}>{fmt(totalValue)}</div>
              </div>
              <div>
                <div style={{ color:"#555", fontSize:10 }}>P&L</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:pnl>=0?TEAL:"#ef4444" }}>
                  {pnl>=0?"+":"-"}{fmt(Math.abs(pnl))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Add card — search bar always visible, scan is secondary */}
        {(mode === "choice" || mode === "search") && (
          <div style={{ marginTop:8 }}>
            {(loadingSetCards || setCardList) && (
              <div style={{ textAlign:"center", padding:"2px 0 6px" }}>
                {loadingSetCards
                  ? <span style={{ color:TEAL, fontSize:11 }}>Loading {box.setName} cards...</span>
                  : <span style={{ color:TEAL, fontSize:11 }}>{setCardList.length} cards ready — matches locally</span>
                }
              </div>
            )}
            {/* Search bar */}
            <div style={{ position:"relative", marginBottom:8 }}>
              <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}>
                <Icon.Search size={16} color="#555"/>
              </div>
              <input
                value={searchQ}
                onChange={e => {
                  const q = e.target.value;
                  setSearchQ(q);
                  if (!q.trim()) { setSearchResults([]); return; }
                  const qLow = q.toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
                  if (setCardList?.length) {
                    setSearchResults(setCardList.filter(c => c.nameLower.includes(qLow)).slice(0,60).map(c=>c._full));
                  } else {
                    clearTimeout(searchDebounceRef.current);
                    searchDebounceRef.current = setTimeout(() => handleSearch(q), 350);
                  }
                }}
                placeholder={setCardList ? `Filter ${setCardList.length} ${box.setName} cards…` : "Search card name…"} autoCorrect="off" autoComplete="off" autoCapitalize="none" spellCheck={false}
                autoFocus={mode === "search"}
                style={{ width:"100%", padding:"11px 12px 11px 36px", background:CARD,
                  border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                  fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
              />
            </div>
            {/* Scan button — secondary */}
            <button onClick={()=>setMode("scan")} style={{
              width:"100%", padding:"10px", background:"none",
              border:`1px solid ${BORDER}`, borderRadius:12, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              color:"#666", fontFamily:"inherit", fontSize:13, marginBottom:8,
            }}>
              <Icon.Camera size={16} color="#666"/> Use camera instead
            </button>
            {/* Results grid */}
            {searching && <div style={{ textAlign:"center", padding:12 }}>
              <div style={{ width:18, height:18, border:`2px solid ${TEAL}`, borderTopColor:"transparent",
                borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto" }}/>
            </div>}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, maxHeight:480, overflowY:"auto" }}>
              {(searchResults.length > 0 ? searchResults : (!searchQ.trim() ? (setCardList||[]).slice(0,60).map(c=>c._full) : []))
                .map(card => (
                <div key={card.id} onClick={()=>{ addCard(card,"near_mint"); setSearchQ(""); setSearchResults([]); }} style={{
                  background:CARD, border:`1px solid ${BORDER}`, borderRadius:10, overflow:"hidden", cursor:"pointer",
                }}>
                  <div style={{ background:"#0d0d0d", display:"flex", justifyContent:"center", padding:4 }}>
                    <img src={card.images?.small} alt={card.name} style={{ height:64, objectFit:"contain" }}/>
                  </div>
                  <div style={{ padding:"4px 6px 6px" }}>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:11, color:"#fff", lineHeight:1.1 }}>{card.name}</div>
                    <div style={{ color:"#555", fontSize:9 }}>#{card.number}</div>
                  </div>
                </div>
              ))}
              {searchQ.trim() && searchResults.length === 0 && !searching && (
                <div style={{ gridColumn:"1/-1", textAlign:"center", color:"#555", fontSize:13, padding:16 }}>
                  No cards found
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Done button — fixed at bottom, always visible */}
      {mode === "choice" && (
        <div style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:250,
          padding:"12px 20px",
          paddingBottom:"calc(20px + env(safe-area-inset-bottom, 0px))",
          background:"linear-gradient(to bottom, transparent, #0a0a0a 30%)",
          borderTop:`1px solid ${BORDER}`,
          backdropFilter:"blur(8px)",
          WebkitBackdropFilter:"blur(8px)",
        }}>
          <button onClick={()=>onDone(cards)} disabled={cards.length===0} style={{
            width:"100%", padding:16, background:cards.length>0?TEAL:"#1a1a1a", border:"none",
            borderRadius:16, fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1,
            color:cards.length>0?"#000":"#444", cursor:cards.length>0?"pointer":"default",
          }}>
            DONE — {cards.length} CARD{cards.length!==1?"S":""}
          </button>
        </div>
      )}

      {/* Camera — only mounted during scan mode, matching GlobalScanFlow's working pattern */}
      {mode === "scan" && (
        <ScanView
          setFilter={box.setName}
          setCards={setCardList}
          setId={box.setId}
          onSearchFallback={() => setMode("choice")}
          onResult={async (parsed) => {
            if (mode === "confirm") return;
            try {
              let card = null;
              if (parsed._card) {
                card = parsed._card;
              } else {
                let results = await searchCards(parsed.name, 20);
                if (box.setId) {
                  const filtered = results.filter(c => c.set?.id === box.setId || c.set?.name === box.setName);
                  if (filtered.length) results = filtered;
                }
                if (parsed.number && results.length > 1) {
                  const numClean = String(parseInt(parsed.number, 10));
                  const exact = results.filter(c => String(parseInt(c.number||"0",10)) === numClean);
                  if (exact.length > 0) results = exact;
                }
                card = results[0] || null;
              }
              if (card) {
                setPendingCard({ card, alternates: parsed._alternates || [] });
                setMode("confirm");
              } else {
                setMode("search");
              }
            } catch(_e) { setMode("search"); }
          }}
          onClose={()=>setMode("choice")}
        />
      )}

      {/* Scanned-cards tray — overlays the live camera AND the confirm sheet, shows running tally */}
      {(mode === "scan" || mode === "confirm") && cards.length > 0 && (
        <div style={{ position:"fixed", left:0, right:0, bottom:0, zIndex:10002,
          paddingBottom:"env(safe-area-inset-bottom, 0px)" }}>
          <button onClick={()=>setShowPackTray(s=>!s)} style={{
            width:"100%", background:"rgba(13,13,13,0.92)", backdropFilter:"blur(8px)",
            border:"none", borderTop:`1px solid ${BORDER}`, padding:"10px 16px",
            display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
            <div style={{ display:"flex" }}>
              {[...cards].reverse().slice(0,3).map((c,i) => (
                <img key={c.id} src={c.card.images?.small} alt=""
                  style={{ height:30, borderRadius:3, marginLeft: i>0 ? -10 : 0,
                    border:"2px solid #0d0d0d", boxShadow:"0 1px 4px rgba(0,0,0,0.6)" }}/>
              ))}
            </div>
            <span style={{ color:"#fff", fontSize:13, fontWeight:600 }}>
              {cards.length} card{cards.length!==1?"s":""} scanned
            </span>
            <span style={{ marginLeft:"auto", color:TEAL, fontSize:12, display:"flex", alignItems:"center", gap:4 }}>
              {showPackTray ? "Hide" : "Show"}
              <span style={{ display:"flex", transform: showPackTray ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>
                <Icon.ChevronDown size={12} color={TEAL}/>
              </span>
            </span>
          </button>
          {showPackTray && (
            <div style={{ background:"#0d0d0d", maxHeight:200, overflowY:"auto", borderTop:`1px solid ${BORDER}` }}>
              {[...cards].reverse().map(c => {
                const condLabel = c.foil ? "FOIL" : condLabels[c.condition]?.slice(0,2) || "NM";
                const condColor = c.foil ? "#f59e0b" : condColors[c.condition] || "#6b7280";
                return (
                  <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10,
                    padding:"8px 16px", borderBottom:"1px solid #1a1a1a" }}>
                    {c.card.images?.small && (
                      <img src={c.card.images.small} style={{ height:36, borderRadius:3 }}/>
                    )}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"#fff", fontSize:12, fontWeight:600 }}>{c.card.name}</div>
                      <div style={{ color:"#555", fontSize:10 }}>{c.card.set?.name}</div>
                    </div>
                    <span style={{ color:condColor, fontSize:11, fontWeight:700 }}>{condLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Confirm overlay — bottom sheet shown after card identified, camera unmounted underneath.
          Shows match alternatives (like the low-confidence picker) so it's consistent regardless
          of whether the match was auto-accepted or came from the picker. */}
      {mode === "confirm" && pendingCard && (() => {
        const { alternates = [] } = pendingCard;
        const selectedCard = pendingCard.selected || pendingCard.card;
        const card = selectedCard;
        // MTG: foil is a user choice, not auto-detected. Default based on rarity.
        const rarity = (card.rarity || "").toLowerCase();
        const isFoilRarity = rarity === "mythic" || rarity === "rare";
        const [pendingFoil, setPendingFoil] = React.useState(isFoilRarity);
        const autoCondition = "near_mint";
        const hasAlternates = alternates.length > 1;
        return (
          <div style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(0,0,0,0.92)", display:"flex", flexDirection:"column",
            justifyContent:"flex-end" }}>
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}
              onClick={()=>{ setPendingCard(null); setPendingSearch(""); setMode("scan"); }}>
              <span style={{ color:"#333", fontSize:13 }}>Tap to cancel and rescan</span>
            </div>
            <div style={{ background:"#111", borderRadius:"20px 20px 0 0", padding:"18px 18px 36px",
              marginBottom: cards.length > 0 ? 54 : 0,
              boxShadow:"0 -4px 32px rgba(0,0,0,0.8)", maxHeight:"75vh", display:"flex", flexDirection:"column" }}>

              {hasAlternates && (
                <>
                  <div style={{ color:TEAL, fontSize:12, fontWeight:700, letterSpacing:0.5, marginBottom:2 }}>
                    WHICH CARD IS THIS?
                  </div>
                  <div style={{ color:"#555", fontSize:11, marginBottom:10 }}>
                    Tap the correct card if the top match is wrong
                  </div>
                  {/* Search bar */}
                  <div style={{ position:"relative", marginBottom:10 }}>
                    <input
                      type="text"
                      placeholder="Search by name or number…"
                      value={pendingSearch}
                      onChange={e => setPendingSearch(e.target.value)}
                      style={{ width:"100%", padding:"9px 36px 9px 12px", background:"#0d0d0d",
                        border:`1px solid ${pendingSearch ? TEAL+"66" : "#2a2a2a"}`, borderRadius:10,
                        color:"#fff", fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
                    />
                    {pendingSearch ? (
                      <button onClick={() => setPendingSearch("")}
                        style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                          background:"none", border:"none", color:"#666", fontSize:16, cursor:"pointer", lineHeight:1 }}>
                        ×
                      </button>
                    ) : (
                      <svg style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)" }}
                        width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <circle cx="11" cy="11" r="7" stroke="#444" strokeWidth="2"/>
                        <path d="M16.5 16.5L21 21" stroke="#444" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    )}
                  </div>
                  <div style={{ overflowY:"auto", marginBottom:14 }}>
                    {alternates
                      .filter(m => {
                        const q = pendingSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (m.name||"").toLowerCase().includes(q) || String(m.number||"").includes(q);
                      })
                      .map((m, i) => {
                        const isSelected = (pendingCard.selected || pendingCard.card)?.id === m._card?.id;
                        const pct = Math.round(m.score * 100);
                        return (
                          <button key={i} onClick={()=>setPendingCard(p=>({ ...p, selected: m._card }))}
                            style={{ width:"100%", display:"flex", alignItems:"center", gap:12,
                              padding:"8px 10px", marginBottom:6, borderRadius:10, cursor:"pointer",
                              background: isSelected ? "#0d1f19" : "#0d0d0d",
                              border:`1px solid ${isSelected ? TEAL+"66" : "#1e1e1e"}`,
                              textAlign:"left", fontFamily:"inherit" }}>
                            {m.imageUrl
                              ? <img src={m.imageUrl} alt={m.name} loading="lazy"
                                  style={{ width:36, height:50, objectFit:"contain", borderRadius:3, flexShrink:0 }}/>
                              : <div style={{ width:36, height:50, background:"#222", borderRadius:3, flexShrink:0 }}/>}
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ color: isSelected ? "#fff" : "#aaa", fontSize:13, fontWeight:isSelected?700:400 }}>{m.name}</div>
                              <div style={{ color:"#555", fontSize:10 }}>#{m.number}</div>
                            </div>
                            <span style={{ color: isSelected ? TEAL : "#555", fontSize:13, fontWeight:700, flexShrink:0 }}>{pct}%</span>
                          </button>
                        );
                      })}
                  </div>
                </>
              )}

              {!hasAlternates && (
                <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:16 }}>
                  {card.images?.small && (
                    <img src={card.images.small} alt={card.name}
                      style={{ height:80, borderRadius:8, flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,0.5)" }}/>
                  )}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:"#fff", fontWeight:700, fontSize:15, marginBottom:2 }}>{card.name}</div>
                    <div style={{ color:"#555", fontSize:12, marginBottom:2 }}>#{card.number} · {card.set?.name}</div>
                    <div style={{ color:"#555", fontSize:11 }}>{card.rarity}</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom:12 }}>
                <div style={{ color:"#555", fontSize:11, marginBottom:6 }}>FINISH</div>
                <div style={{ display:"flex", gap:8 }}>
                  {[{val:false,label:"Non-Foil",color:"#6b7280"},{val:true,label:"Foil",color:"#f59e0b"}].map(f => (
                    <button key={String(f.val)} onClick={()=>setPendingFoil(f.val)}
                      style={{ flex:1, padding:"10px 4px", borderRadius:10, cursor:"pointer",
                        background: pendingFoil===f.val ? f.color+"33" : "#1a1a1a",
                        border:`2px solid ${pendingFoil===f.val ? f.color : BORDER}`,
                        color: pendingFoil===f.val ? f.color : "#555",
                        fontWeight: pendingFoil===f.val ? 700 : 400, fontSize:13 }}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {["near_mint","lightly_played"].map(v => (
                  <button key={v} onClick={()=>{ addCard(card, v, pendingFoil); setPendingCard(null); setPendingSearch(""); setMode("scan"); }}
                    style={{ flex:1, padding:"14px 4px", borderRadius:12, cursor:"pointer",
                      background: v==="near_mint" ? condColors[v]+"33" : "#1a1a1a",
                      border:`2px solid ${v==="near_mint" ? condColors[v] : BORDER}`,
                      color: v==="near_mint" ? condColors[v] : "#555",
                      fontWeight: v==="near_mint" ? 700 : 400, fontSize:13,
                      display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                    <span>{condLabels[v]}</span>
                    {v==="near_mint" && <span style={{ fontSize:9, letterSpacing:0.5, opacity:0.8 }}>DEFAULT</span>}
                  </button>
                ))}
              </div>
              <button onClick={()=>{ setPendingCard(null); setPendingSearch(""); setSearchQ(""); setSearchResults([]); setMode("search"); }}
                style={{ width:"100%", marginTop:12, background:"none", border:"none",
                  color:"#555", fontSize:12, cursor:"pointer", fontFamily:"inherit", textAlign:"center" }}>
                None of these? Search instead
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Box detail view — shows all packs, P&L, best pulls


// ── SetTopCards — reusable "top valuable cards in this set" section ──────────
function SetTopCards({ setId, setName }) {
  const [topCards, setTopCards] = React.useState([]);
  const [loading,  setLoading]  = React.useState(false);

  React.useEffect(() => {
    if (!setId && !setName) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // Fetch cards in the set from Scryfall, sorted by USD price desc
        const code = setId || "";
        const cards = await fetchSetCards(code);
        const ranked = cards
          .map(c => ({
            id:     c.id,
            name:   c.name,
            number: c.number,
            rarity: c.rarity,
            img:    c.images?.small,
            price:  parseFloat(c.prices?.usd || c.prices?.usd_foil || 0),
          }))
          .filter(c => c.price > 0)
          .sort((a, b) => b.price - a.price)
          .slice(0, 10);
        if (!cancelled) { setTopCards(ranked); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [setId, setName]);

  if (!loading && topCards.length === 0) return null;

  return (
    <div style={{ padding:"20px 20px 0" }}>
      <div style={{ color:"#888", fontSize:12, letterSpacing:0.5, marginBottom:10 }}>
        TOP CARDS IN THIS SET
      </div>
      {loading ? (
        <div style={{ display:"flex", justifyContent:"center", padding:12 }}>
          <div style={{ width:18, height:18, border:`2px solid ${TEAL}`, borderTopColor:"transparent",
            borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
        </div>
      ) : (
        <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
          {topCards.map((c, i) => (
            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 16px",
              borderBottom: i < topCards.length-1 ? `1px solid ${BORDER}` : "none" }}>
              <div style={{ color:"#444", fontSize:11, width:16, textAlign:"right", flexShrink:0 }}>{i+1}</div>
              <img src={c.img} alt={c.name}
                style={{ height:40, width:28, objectFit:"contain", borderRadius:3, flexShrink:0 }}
                onError={e => e.target.style.opacity="0.3"}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:"#fff", fontSize:12, fontWeight:600,
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                <div style={{ color:"#555", fontSize:10 }}>#{c.number} · {c.rarity}</div>
              </div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14, color:TEAL, flexShrink:0 }}>
                {fmt(c.price)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SellPackButton({ box, onUpdateBox, costPerPack }) {
  const [open,  setOpen]  = React.useState(false);
  const [price, setPrice] = React.useState("");
  const pnl = price && !isNaN(parseFloat(price)) ? parseFloat(price) - costPerPack : null;

  const confirm = () => {
    const sp = parseFloat(price);
    if (!sp || sp <= 0) return;
    if (box.totalPacks <= 1) return; // shouldn't happen but guard
    onUpdateBox?.({
      ...box,
      totalPacks: box.totalPacks - 1,
      pricePaid:  box.pricePaid - costPerPack,
      sales: [...(box.sales||[]), { soldAt:Date.now(), salePrice:sp, costBasis:costPerPack }],
    });
    setOpen(false); setPrice("");
  };

  return (
    <>
      <button onClick={()=>{ setOpen(true); setPrice(""); }}
        style={{ flex:1, padding:16, background:"#0d1f19", border:`1px solid ${TEAL}44`,
          borderRadius:16, fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:1,
          color:TEAL, cursor:"pointer" }}>
        SELL
      </button>

      {open && (
        <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.88)",
          display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
          onClick={()=>setOpen(false)}>
          <div style={{ background:"#111", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:360,
            border:`1px solid ${TEAL}44` }} onClick={e=>e.stopPropagation()}>
            <div style={{ color:"#fff", fontSize:17, fontWeight:700, marginBottom:4 }}>Sell a Pack</div>
            <div style={{ color:"#555", fontSize:12, marginBottom:18 }}>
              Cost basis {fmt(costPerPack)}/pack
            </div>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>SALE PRICE</div>
            <input type="number" inputMode="decimal" value={price} autoFocus
              onChange={e=>setPrice(e.target.value)} placeholder="0.00"
              style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
                border:`1px solid ${TEAL}55`, borderRadius:12, color:"#fff",
                fontSize:18, fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:8 }}/>
            {pnl !== null && (
              <div style={{ padding:"8px 12px", marginBottom:16, borderRadius:10,
                background:pnl>=0?"#0d1f19":"#1a0808",
                border:`1px solid ${pnl>=0?TEAL+"33":"#3d1a1a"}` }}>
                <span style={{ color:pnl>=0?TEAL:"#ef4444", fontSize:14, fontWeight:700 }}>
                  {pnl>=0?"+":""}{fmt(pnl)} P&L
                </span>
              </div>
            )}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setOpen(false)}
                style={{ flex:1, padding:"12px 0", background:"none", border:`1px solid #333`,
                  borderRadius:12, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                Cancel
              </button>
              <button onClick={confirm}
                disabled={!price||isNaN(parseFloat(price))||parseFloat(price)<=0}
                style={{ flex:1, padding:"12px 0", border:"none", borderRadius:12, fontSize:14,
                  fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                  background: price&&!isNaN(parseFloat(price))&&parseFloat(price)>0?TEAL:"#1a1a1a",
                  color: price&&!isNaN(parseFloat(price))&&parseFloat(price)>0?"#000":"#444" }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BoxDetailView({ box, onBack, onOpenPack, onDelete, onUpdateBox, onSyncPack, onRefreshPackCards, onUpdateCardCondition }) {
  const [refreshingPack, setRefreshingPack] = useState(null);
  const [syncingPack, setSyncingPack]       = useState(null);
  const [syncResult, setSyncResult]         = useState({});
  const [selectedCard, setSelectedCard]     = useState(null);
  const [fetchingCard, setFetchingCard]     = useState(false);
  const [tierModal, setTierModal]           = useState(null); // { title, cards: [{card,condition,packName}] }

  const openCardDetail = async (c) => {
    setSelectedCard(c);
    setFetchingCard(true);
    try {
      // Fetch fresh card data from Scryfall by ID
      const fresh = await scryfallFetch(`/cards/${c.card.id}`).then(d => d ? normalizeScryfallCard(d) : null).catch(() => null);
      const merged = fresh || c.card;

      recordPriceSnapshot(merged);
      setSelectedCard({ ...c, card: merged });

      if (onUpdateBox) {
        const updatedBox = {
          ...box,
          packs: box.packs.map(p => ({
            ...p,
            cards: p.cards.map(pc => pc.card.id === c.card.id ? { ...pc, card: merged } : pc),
          })),
        };
        onUpdateBox(updatedBox);
      }
    } catch(_e) {}
    setFetchingCard(false);
  };

  const refreshPack = async (pack) => {
    setRefreshingPack(pack.id);
    try {
      const updatedCards = await Promise.all(pack.cards.map(async (c) => {
        try {
          const fresh = await scryfallFetch(`/cards/${c.card.id}`).then(d => d ? normalizeScryfallCard(d) : null);
          if (fresh?.prices) {
            recordPriceSnapshot(fresh);
            const price = parseFloat(fresh.prices.usd || fresh.prices.usd_foil || 0);
            if (price > 0) setWebPriceCache(c.card.id, price);
            return { ...c, card: fresh };
          }
        } catch(_e) {}
        return c;
      }));
      const updatedPack = { ...pack, cards: updatedCards };
      const updatedPacks = box.packs.map(p => p.id === pack.id ? updatedPack : p);
      onUpdateBox({ ...box, packs: updatedPacks });
      if (onRefreshPackCards) onRefreshPackCards(updatedCards, box.id, pack.packNumber);
    } catch(_e) {}
    setRefreshingPack(null);
  };

  const openedPacks    = box.packs.filter(p => p.opened);
  const unopenedPacks  = box.totalPacks - openedPacks.length;
  const costPerPack    = box.pricePaid / box.totalPacks;
  const totalSpent     = openedPacks.length * costPerPack;
  const totalValue     = openedPacks.reduce((s, p) =>
    s + p.cards.reduce((cs, c) => cs + (genPrices(c.card).raw[c.condition] || 0), 0), 0);
  const pnl            = totalValue - totalSpent;
  const pnlUp          = pnl >= 0;
  const allCards       = openedPacks.flatMap(p => p.cards);
  const sortedCards    = [...allCards].sort((a, b) =>
    (genPrices(b.card).raw[b.condition]||0) - (genPrices(a.card).raw[a.condition]||0));
  const productLabel   = PRODUCT_TYPES.find(t => t.id === box.productType)?.label || box.productType;

  return (
    <React.Fragment>
    <div style={{ height:"100%", overflowY:"auto", background:BG }}>
      {/* Nav */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px",
        position:"sticky", top:0, background:BG, zIndex:10, borderBottom:`1px solid ${BORDER}` }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
          <Icon.Back size={24} color="#fff"/>
        </button>
        <button onClick={()=>{ if(window.__delBox){ onDelete(box.id); } else { window.__delBox=true; setTimeout(()=>window.__delBox=false,3000); } }}
          style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
          <Icon.Trash size={20} color="#ef4444"/>
        </button>
      </div>

      {/* Box header */}
      <div style={{ padding:"16px 20px 0" }}>
        <div style={{ color:"#555", fontSize:12 }}>{productLabel}</div>
        {box.setLogo ? (
          <img src={box.setLogo} alt={box.setName}
            style={{ height:32, objectFit:"contain", maxWidth:200, display:"block", margin:"6px 0 4px" }}/>
        ) : (
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:"#fff", letterSpacing:1, lineHeight:1.1 }}>
            {box.setName}
          </div>
        )}
        <div style={{ color:"#555", fontSize:12, marginTop:2 }}>
          Purchased {new Date(box.purchasedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
        </div>
      </div>

      {/* P&L summary */}
      <div style={{ margin:"16px 20px 0", background: pnlUp?"#0a1f10":"#1a0a0a",
        border:`1px solid ${pnlUp?"#1a3d20":"#3d1a1a"}`, borderRadius:18, padding:"16px 18px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
          <div>
            <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>PAID</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#ccc", letterSpacing:1 }}>{fmt(box.pricePaid)}</div>
          </div>
          <div>
            <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>VALUE</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1 }}>{fmtCompact(totalValue)}</div>
          </div>
          <div>
            <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>P&L</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:pnlUp?TEAL:"#ef4444", letterSpacing:1 }}>
              {pnlUp?"+":"-"}{fmtCompact(Math.abs(pnl))}
            </div>
          </div>
        </div>
        {/* Pack progress bar */}
        <div style={{ marginBottom:8 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ color:"#555", fontSize:11 }}>{openedPacks.length} of {box.totalPacks} packs opened</span>
            <span style={{ color:"#555", fontSize:11 }}>{unopenedPacks} remaining</span>
          </div>
          <div style={{ height:6, background:"#1a1a1a", borderRadius:3 }}>
            <div style={{ height:"100%", width:`${(openedPacks.length/box.totalPacks)*100}%`,
              background:`linear-gradient(90deg, ${TEAL}, ${TEAL}aa)`, borderRadius:3, transition:"width 0.5s ease" }}/>
          </div>
        </div>
        {unopenedPacks > 0 && (
          <div style={{ color:"#555", fontSize:11 }}>
            Remaining sunk cost: {fmt(unopenedPacks * costPerPack)} ({unopenedPacks} packs × {fmt(costPerPack)})
          </div>
        )}
      </div>

      {/* Open + Sell pack buttons */}
      {unopenedPacks > 0 && (
        <div style={{ padding:"16px 20px 0", display:"flex", gap:10 }}>
          <button onClick={()=>onOpenPack(box)} style={{
            flex:2, padding:16, background:TEAL, border:"none", borderRadius:16,
            fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1,
            color:"#000", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10,
          }}>
            <Icon.Pack size={20} color="#000"/>
            OPEN PACK{box.totalPacks > 1 ? ` ${openedPacks.length + 1}` : ""}
          </button>
          {(box.productType === "single_pack" || box.totalPacks === 1) && (
            <SellPackButton box={box} onUpdateBox={onUpdateBox} costPerPack={costPerPack}/>
          )}
        </div>
      )}

      {/* Pull Rate Tracker */}
      {openedPacks.length > 0 && (() => {
        const allPulledCards = openedPacks.flatMap(p =>
          p.cards.map(c => ({ ...c, packNumber: p.packNumber, openedAt: p.openedAt })));
        const packsOpened = openedPacks.length;

        // Rarity classifiers — focused on what actually matters for investment
        const r = c => (c.card?.rarity || "").toLowerCase();
        const isSIR  = c => r(c).includes("special illustration");
        const isIR   = c => r(c).includes("illustration rare") && !r(c).includes("special");
        const isHyper = c => r(c).includes("hyper rare") || r(c).includes("rainbow");
        const isDoubleRare = c => r(c).includes("double rare");
        const isUltraRare  = c => r(c).includes("ultra rare") || r(c).includes("full art");
        const isRareHolo   = c => r(c).includes("rare holo") && !r(c).includes("ex") && !r(c).includes("v");

        // Card lists per tier
        const sirCards    = allPulledCards.filter(isSIR);
        const irCards     = allPulledCards.filter(isIR);
        const hyperCards  = allPulledCards.filter(isHyper);
        const doubleCards = allPulledCards.filter(isDoubleRare);
        const ultraCards  = allPulledCards.filter(isUltraRare);
        const holoCards   = allPulledCards.filter(isRareHolo);

        const sirCount    = sirCards.length;
        const irCount     = irCards.length;
        const hyperCount  = hyperCards.length;
        const doubleCount = doubleCards.length;
        const ultraCount  = ultraCards.length;
        const holoCount   = holoCards.length;

        // Chase = SIR + IR + Hyper (the ones worth real money)
        const chaseCards  = [...sirCards, ...irCards, ...hyperCards];
        const chaseCount  = chaseCards.length;
        const chaseRate   = packsOpened > 0 ? ((chaseCount / packsOpened) * 100).toFixed(0) : "0";
        // Hit = chase + Double Rare + Ultra Rare (anything above base)
        const hitCards    = [...chaseCards, ...doubleCards, ...ultraCards];
        const hitCount    = hitCards.length;
        const hitPerPack  = packsOpened > 0 ? (hitCount / packsOpened).toFixed(2) : "0";
        // SIR rate per pack
        const sirPerBox   = packsOpened > 0 ? (sirCount / packsOpened * 100).toFixed(0) : "0";

        const openTierModal = (title, cards) => {
          if (!cards.length) return;
          setTierModal({
            title,
            cards: cards.map(c => ({ card:c.card, condition:c.condition,
              packName: `${box.setName} Pack #${c.packNumber}` })),
          });
        };

        // Best pack by total pulled value
        const packValues = openedPacks.map(p => ({
          pack: p,
          val: p.cards.reduce((s,c) => s + (genPrices(c.card).raw[c.condition]||0), 0),
        }));
        const bestPack = packValues.length >= 2 ? packValues.reduce((a,b) => a.val > b.val ? a : b) : null;

        const tierRows = [
          { label:"SIR",         count:sirCount,    color:"#f59e0b", cards:sirCards },
          { label:"IR",          count:irCount,     color:TEAL,      cards:irCards },
          { label:"Hyper Rare",  count:hyperCount,  color:"#a855f7", cards:hyperCards },
          { label:"Double Rare", count:doubleCount, color:"#3b82f6", cards:doubleCards },
          { label:"Ultra Rare",  count:ultraCount,  color:"#6366f1", cards:ultraCards },
          { label:"Rare Holo",   count:holoCount,   color:"#888",    cards:holoCards },
        ].filter(t => t.count > 0);

        return (
          <div style={{ padding:"20px 20px 0" }}>
            {/* Pull Rates */}
            <div style={{ color:"#888", fontSize:12, letterSpacing:0.5, marginBottom:10 }}>PULL RATES</div>
            {/* Top 3 stats */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:12 }}>
              {[
                { label:"Chase Rate",  value:`${chaseRate}%`,  sub:`SIR+IR+Hyper / ${packsOpened} packs`, color:"#f59e0b", cards:chaseCards },
                { label:"Hits/Pack",   value:hitPerPack,       sub:`Double Rare+`, color:TEAL, cards:hitCards },
                { label:"SIR Rate",    value:`${sirPerBox}%`,  sub:`${sirCount} total pulled`, color:"#a855f7", cards:sirCards },
              ].map(({ label, value, sub, color, cards }) => (
                <div key={label} onClick={()=>openTierModal(label, cards)}
                  style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:"10px 12px",
                    cursor: cards.length ? "pointer" : "default" }}>
                  <div style={{ color:"#555", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>{label.toUpperCase()}</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color, letterSpacing:1 }}>{value}</div>
                  <div style={{ color:"#444", fontSize:10, marginTop:2 }}>{sub}</div>
                </div>
              ))}
            </div>
            {/* Per-tier breakdown */}
            {tierRows.length > 0 && (
              <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12,
                padding:"10px 14px", marginBottom:16 }}>
                {tierRows.map(({ label, count, color, cards }, i) => (
                  <div key={label} onClick={()=>openTierModal(label, cards)}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    paddingBottom: i < tierRows.length-1 ? 8 : 0,
                    marginBottom: i < tierRows.length-1 ? 8 : 0,
                    borderBottom: i < tierRows.length-1 ? `1px solid ${BORDER}` : "none",
                    cursor: count ? "pointer" : "default" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }}/>
                      <span style={{ color:"#aaa", fontSize:12 }}>{label}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ color:"#555", fontSize:11 }}>
                        {packsOpened > 0 ? `1 in ${(packsOpened/count).toFixed(1)}` : "—"}
                      </span>
                      <span style={{ color, fontWeight:700, fontSize:13, minWidth:16, textAlign:"right" }}>{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Best Pack */}
            {bestPack && (
              <>
                <div style={{ color:"#888", fontSize:12, letterSpacing:0.5, marginBottom:10 }}>BEST PACK</div>
                <div style={{ background:"#0d1f19", border:`1px solid ${TEAL}44`, borderRadius:14, padding:"12px 16px", marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div>
                      <div style={{ color:TEAL, fontSize:13, fontWeight:700 }}>
                        Pack {bestPack.pack.packNumber}
                      </div>
                      <div style={{ color:"#555", fontSize:11 }}>
                        {new Date(bestPack.pack.openedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})} · {bestPack.pack.cards.length} cards
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:TEAL, letterSpacing:1 }}>
                        {fmt(bestPack.val)}
                      </div>
                      <div style={{ color: bestPack.val - costPerPack >= 0 ? TEAL : "#ef4444", fontSize:11 }}>
                        {bestPack.val - costPerPack >= 0 ? "+" : ""}{fmt(bestPack.val - costPerPack)} P&L
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:4, overflowX:"auto" }}>
                    {bestPack.pack.cards.slice(0,10).map((c,i) => {
                      const img = c.card?.images?.small;
                      return img
                        ? <img key={i} src={img} alt="" style={{ height:52, width:37, objectFit:"contain", borderRadius:4, flexShrink:0 }}/>
                        : <div key={i} style={{ height:52, width:37, background:"#1a1a1a", borderRadius:4, flexShrink:0 }}/>;
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* Pack history */}
      {openedPacks.length > 0 && (
        <div style={{ padding:"20px 20px 0" }}>
          <div style={{ color:"#888", fontSize:12, letterSpacing:0.5, marginBottom:10 }}>PACK HISTORY</div>
          {openedPacks.map((pack, i) => {
            const packVal = pack.cards.reduce((s,c)=>s+(genPrices(c.card).raw[c.condition]||0),0);
            const packPnl = packVal - costPerPack;
            return (
              <div key={pack.id} style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
                padding:"12px 16px", marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <div>
                    <div style={{ color:"#fff", fontSize:13, fontWeight:600 }}>Pack {pack.packNumber}</div>
                    <div style={{ color:"#555", fontSize:11 }}>
                      {new Date(pack.openedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})} · {pack.cards.length} cards
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <button onClick={()=>refreshPack(pack)} disabled={!!refreshingPack||!!syncingPack} title="Refresh prices" style={{
                      background:"none", border:`1px solid ${BORDER}`, borderRadius:8,
                      padding:"4px 8px", cursor:(refreshingPack||syncingPack)?"default":"pointer",
                      display:"flex", alignItems:"center", gap:4, color:"#555",
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                        style={{ animation: refreshingPack===pack.id?"spin 0.8s linear infinite":"none" }}>
                        <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M20 9a8 8 0 00-14.93-2M4 15a8 8 0 0014.93 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      <span style={{ fontSize:10 }}>{refreshingPack===pack.id?"…":"Prices"}</span>
                    </button>
                    {onSyncPack && (
                      <button onClick={async ()=>{
                        setSyncingPack(pack.id);
                        const added = await onSyncPack(pack, box);
                        setSyncResult(r=>({...r,[pack.id]:added}));
                        setSyncingPack(null);
                      }} disabled={!!refreshingPack||!!syncingPack} title="Add missing cards to collection" style={{
                        background: syncResult[pack.id]!=null ? "#0d1f19" : "none",
                        border:`1px solid ${syncResult[pack.id]!=null ? TEAL+"44" : BORDER}`,
                        borderRadius:8, padding:"4px 8px",
                        cursor:(refreshingPack||syncingPack)?"default":"pointer",
                        display:"flex", alignItems:"center", gap:4,
                        color: syncResult[pack.id]!=null ? TEAL : "#555",
                      }}>
                        {syncingPack===pack.id ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            style={{ animation:"spin 0.8s linear infinite" }}>
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8"/>
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                        )}
                        <span style={{ fontSize:10 }}>
                          {syncResult[pack.id] != null
                            ? syncResult[pack.id] === 0 ? "✓ Synced" : `+${syncResult[pack.id]} added`
                            : syncingPack===pack.id ? "…" : "Sync"
                          }
                        </span>
                      </button>
                    )}
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff" }}>{fmt(packVal)}</div>
                      <div style={{ color:packPnl>=0?TEAL:"#ef4444", fontSize:11 }}>
                        {packPnl>=0?"+":"-"}{fmt(Math.abs(packPnl))}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, overflowX:"auto" }}>
                  {pack.cards.map(c => (
                    <div key={c.id} onClick={()=>openCardDetail({ card:c.card, condition:c.condition, packName:`${box.setName} Pack #${pack.packNumber}` })}
                      style={{ flexShrink:0, cursor:"pointer", position:"relative" }}>
                      <img src={c.card.images?.small} alt={c.card.name}
                        style={{ height:52, borderRadius:4, display:"block" }}
                        onError={e=>{e.target.style.opacity="0.3";}}/>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Best pulls */}
      {sortedCards.length > 0 && (
        <div style={{ padding:"20px 20px 0" }}>
          <div style={{ color:"#888", fontSize:12, letterSpacing:0.5, marginBottom:10 }}>BEST PULLS</div>
          <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
            {sortedCards.slice(0,5).map((c,i,arr) => {
              const val = genPrices(c.card).raw[c.condition] || 0;
              return (
                <div key={c.id} onClick={()=>openCardDetail({ card:c.card, condition:c.condition, packName:c.packName||box.setName })}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px",
                    borderBottom:i<arr.length-1?`1px solid ${BORDER}`:"none",
                    cursor:"pointer", transition:"background 0.1s" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <img src={c.card.images?.small} alt={c.card.name}
                    style={{ height:44, borderRadius:4 }}
                    onError={e=>{e.target.style.opacity="0.3";}}/>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#fff", fontSize:13, fontWeight:600 }}>{c.card.name}</div>
                    <div style={{ color:"#555", fontSize:11 }}>{c.card.set?.name} · {condLabels[c.condition]}</div>
                  </div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:TEAL, letterSpacing:1 }}>{fmt(val)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Top cards in this set — only show while packs remain to open */}
      {unopenedPacks > 0 && <SetTopCards setId={box.setId || box.setName} setName={box.setName}/>}

      <div style={{ height:32 }}/>
    </div>

    {/* Card detail overlay */}
    {selectedCard && (() => {
      const prices = getPrices(selectedCard.card);
      const val = prices.raw[selectedCard.condition] || prices.raw.near_mint || prices.raw.near_mint || 0;
      const imgSrc = selectedCard.card.images?.small || selectedCard.card.images?.large || "";
      const snapshots = loadPriceHistory(selectedCard.card.id);
      // Build chart data from real snapshots
      const chartData = snapshots.length > 1 ? snapshots.slice(-30) : prices.history;
      const chartMax = Math.max(...chartData.map(d => d.price || 0), 0.01);
      const chartMin = Math.min(...chartData.map(d => d.price || 0).filter(p => p > 0), chartMax);
      return (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:300,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={()=>setSelectedCard(null)}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:"#111", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:500,
            padding:"24px 24px 40px", maxHeight:"85vh", overflowY:"auto",
          }}>
            <div style={{ width:40, height:4, background:"#333", borderRadius:2, margin:"0 auto 20px" }}/>

            <div style={{ display:"flex", gap:16, marginBottom:20 }}>
              {imgSrc ? (
                <img src={imgSrc} alt={selectedCard.card.name}
                  style={{ height:110, borderRadius:10, flexShrink:0 }}
                  onError={e=>{e.target.style.display="none";}}/>
              ) : (
                <div style={{ width:78, height:110, borderRadius:10, background:"#1a1a1a",
                  flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Icon.Cards size={32} color="#333"/>
                </div>
              )}
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:0.5, lineHeight:1.1 }}>
                  {selectedCard.card.name || "Unknown Card"}
                </div>
                {selectedCard.card.set?.name && (
                  <div style={{ color:TEAL, fontSize:12, marginTop:4 }}>{selectedCard.card.set.name}</div>
                )}
                {(selectedCard.card.number || selectedCard.card.rarity) && (
                  <div style={{ color:"#555", fontSize:11, marginTop:2 }}>
                    {selectedCard.card.number ? `#${selectedCard.card.number}` : ""}
                    {selectedCard.card.number && selectedCard.card.rarity ? " · " : ""}
                    {selectedCard.card.rarity || ""}
                  </div>
                )}
                {selectedCard.packName && (
                  <div style={{ color:"#444", fontSize:11, marginTop:2 }}>{selectedCard.packName}</div>
                )}
                <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{
                    background:`${condColors[selectedCard.condition] || TEAL}22`,
                    border:`1px solid ${condColors[selectedCard.condition] || TEAL}44`,
                    color:condColors[selectedCard.condition] || TEAL,
                    fontSize:11, padding:"3px 10px", borderRadius:10
                  }}>
                    {condLabels[selectedCard.condition] || selectedCard.condition}
                  </span>
                  {fetchingCard && (
                    <div style={{ width:14, height:14, border:`2px solid ${TEAL}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
                  )}
                </div>
              </div>
            </div>

            {/* Value */}
            <div style={{ background: val>0?"#0a1f10":"#1a1a1a",
              border:`1px solid ${val>0?"#1a3d20":BORDER}`, borderRadius:16, padding:"16px 18px", marginBottom:16 }}>
              {fetchingCard && val === 0 ? (
                <div style={{ color:"#555", fontSize:13 }}>Fetching price...</div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div>
                    <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>MARKET VALUE</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:val>0?TEAL:"#444", letterSpacing:1 }}>
                      {val > 0 ? fmt(val) : "No price"}
                    </div>
                  </div>
                  {prices.graded["PSA 10"] > 0 && (
                    <div>
                      <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>PSA 10 EST.</div>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:"#fff", letterSpacing:1 }}>
                        {fmt(prices.graded["PSA 10"])}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Price history chart — real snapshots if available */}
            {chartData.length > 1 && (
              <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <div style={{ color:"#888", fontSize:11, letterSpacing:0.5 }}>PRICE HISTORY</div>
                  <div style={{ color:"#555", fontSize:10 }}>
                    {snapshots.length > 1 ? `${snapshots.length} data points` : "Estimated"}
                  </div>
                </div>
                <svg width="100%" height="60" viewBox={`0 0 300 60`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TEAL} stopOpacity="0.3"/>
                      <stop offset="100%" stopColor={TEAL} stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  {chartData.length > 1 && (() => {
                    const pts = chartData.map((d, i) => {
                      const x = chartData.length > 1 ? (i / (chartData.length - 1)) * 300 : 150;
                      const y = chartMax > chartMin
                        ? 55 - ((( d.price || 0) - chartMin) / (chartMax - chartMin)) * 50
                        : 30;
                      return `${isNaN(x)?0:x},${isNaN(y)?30:y}`;
                    });
                    const pathD = `M ${pts.join(" L ")}`;
                    const areaD = `M 0,60 L ${pts.join(" L ")} L 300,60 Z`;
                    return (
                      <>
                        <path d={areaD} fill="url(#pcg)"/>
                        <path d={pathD} fill="none" stroke={TEAL} strokeWidth="1.5" strokeLinecap="round"/>
                      </>
                    );
                  })()}
                </svg>
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                  <span style={{ color:"#555", fontSize:9 }}>{chartData[0]?.label || chartData[0]?.date?.slice(5) || ""}</span>
                  <span style={{ color:"#555", fontSize:9 }}>{chartData[chartData.length-1]?.label || chartData[chartData.length-1]?.date?.slice(5) || "Today"}</span>
                </div>
              </div>
            )}

            {/* MTG Card stats */}
            {selectedCard.card && (selectedCard.card.mana_cost || selectedCard.card.type_line || selectedCard.card.oracle_text) && (
              <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, padding:"14px 16px", marginBottom:16 }}>
                <div style={{ display:"flex", gap:16, marginBottom:8, flexWrap:"wrap" }}>
                  {selectedCard.card.mana_cost && (
                    <div><div style={{ color:"#555", fontSize:9, letterSpacing:0.5 }}>MANA COST</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:TEAL, letterSpacing:1 }}>{selectedCard.card.mana_cost}</div></div>
                  )}
                  {selectedCard.card.cmc > 0 && (
                    <div><div style={{ color:"#555", fontSize:9, letterSpacing:0.5 }}>CMC</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1 }}>{selectedCard.card.cmc}</div></div>
                  )}
                  {selectedCard.card.rarity && (
                    <div><div style={{ color:"#555", fontSize:9, letterSpacing:0.5 }}>RARITY</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:
                      selectedCard.card.rarity === "mythic" ? "#f97316" :
                      selectedCard.card.rarity === "rare"   ? "#f59e0b" :
                      selectedCard.card.rarity === "uncommon" ? "#888" : "#666",
                      letterSpacing:1, textTransform:"capitalize" }}>{selectedCard.card.rarity}</div></div>
                  )}
                </div>
                {selectedCard.card.type_line && (
                  <div style={{ color:"#888", fontSize:11, marginBottom:8, fontStyle:"italic" }}>{selectedCard.card.type_line}</div>
                )}
                {selectedCard.card.oracle_text && (
                  <div style={{ color:"#aaa", fontSize:11, lineHeight:1.6,
                    borderTop:`1px solid ${BORDER}`, paddingTop:10,
                    whiteSpace:"pre-wrap" }}>{selectedCard.card.oracle_text}</div>
                )}
                {selectedCard.card.scryfall_uri && (
                  <a href={selectedCard.card.scryfall_uri} target="_blank" rel="noopener noreferrer"
                    style={{ display:"inline-flex", alignItems:"center", gap:6, marginTop:10,
                      color:TEAL, fontSize:11, textDecoration:"none" }}>
                    View on Scryfall
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{marginLeft:2}}>
                      <path d="M4 1H1v8h8V6M6 1h3v3M9 1L5 5" stroke={TEAL} strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </a>
                )}
              </div>
            )}

            {/* Condition prices */}
            <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, overflow:"hidden", marginBottom:16 }}>
              {CONDITIONS.map((cond,i,arr) => {
                const cv = prices.raw[cond] || 0;
                const isSelected = cond === selectedCard.condition;
                return (
                  <button key={cond} onClick={()=>{
                    // Update condition in selectedCard and save back to pack/collection
                    const updated = { ...selectedCard, condition: cond };
                    setSelectedCard(updated);
                    if (onUpdateCardCondition) onUpdateCardCondition(selectedCard, cond);
                  }} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    width:"100%", padding:"12px 16px", borderBottom:i<arr.length-1?`1px solid ${BORDER}`:"none",
                    background:isSelected?`${condColors[cond]}15`:"transparent",
                    border:"none", cursor:"pointer", fontFamily:"inherit",
                    transition:"background 0.15s" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                          <circle cx="6" cy="6" r="5" fill={condColors[cond]} opacity="0.2"/>
                          <path d="M3 6l2 2 4-4" stroke={condColors[cond]} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                        </svg>
                      )}
                      <span style={{ color:isSelected?condColors[cond]:"#666", fontSize:13, fontWeight:isSelected?600:400 }}>
                        {condLabels[cond]}
                      </span>
                    </div>
                    <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                      color:cv>0?(isSelected?condColors[cond]:TEAL):"#333", letterSpacing:0.5 }}>
                      {cv > 0 ? fmt(cv) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>

            <button onClick={()=>setSelectedCard(null)} style={{
              width:"100%", padding:14, background:"#1a1a1a", border:`1px solid ${BORDER}`,
              borderRadius:14, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit",
            }}>Close</button>
          </div>
        </div>
      );
    })()}

    {/* Tier breakdown modal — shows which cards registered for a stat */}
    {tierModal && (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:300,
        display:"flex", alignItems:"flex-end", justifyContent:"center" }}
        onClick={()=>setTierModal(null)}>
        <div onClick={e=>e.stopPropagation()} style={{
          background:"#111", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:500,
          padding:"24px 24px 40px", maxHeight:"85vh", overflowY:"auto",
        }}>
          <div style={{ width:40, height:4, background:"#333", borderRadius:2, margin:"0 auto 20px" }}/>
          <div style={{ color:"#fff", fontSize:17, fontWeight:700, marginBottom:4 }}>{tierModal.title}</div>
          <div style={{ color:"#555", fontSize:12, marginBottom:16 }}>
            {tierModal.cards.length} card{tierModal.cards.length!==1?"s":""}
          </div>
          <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden", marginBottom:20 }}>
            {tierModal.cards.map((c,i,arr) => {
              const val = genPrices(c.card).raw[c.condition] || 0;
              return (
                <div key={i}
                  onClick={()=>{ setTierModal(null); openCardDetail({ card:c.card, condition:c.condition, packName:c.packName }); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px",
                    borderBottom:i<arr.length-1?`1px solid ${BORDER}`:"none",
                    cursor:"pointer" }}>
                  <img src={c.card.images?.small} alt={c.card.name}
                    style={{ height:44, borderRadius:4 }}
                    onError={e=>{e.target.style.opacity="0.3";}}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:"#fff", fontSize:13, fontWeight:600 }}>{c.card.name}</div>
                    <div style={{ color:"#555", fontSize:11 }}>{c.card.rarity} · {c.packName}</div>
                  </div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:TEAL, letterSpacing:1 }}>{fmt(val)}</div>
                </div>
              );
            })}
          </div>
          <button onClick={()=>setTierModal(null)} style={{
            width:"100%", padding:14, background:"#1a1a1a", border:`1px solid ${BORDER}`,
            borderRadius:14, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit",
          }}>Close</button>
        </div>
      </div>
    )}
    </React.Fragment>
  );
}

// New box form — fetches real sets from TCG API
function NewBoxForm({ onSave, onCancel }) {
  const [step, setStep]           = useState("product"); // product | set | details
  const [productType, setProductType] = useState(null);
  const [sets, setSets]           = useState([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setSearch, setSetSearch] = useState("");
  const [selectedSet, setSelectedSet] = useState(null);
  const [pricePaid, setPricePaid] = useState("");
  const [totalPacks, setTotalPacks] = useState(1);
  const [scanning,   setScanning]   = useState(false);
  const [scanErr,    setScanErr]    = useState("");
  const [scannedProduct, setScannedProduct] = useState(null); // matched UPC result
  const barcodeVideoRef = useRef(null);
  const barcodeStreamRef = useRef(null);
  const barcodeLoopRef  = useRef(null);

  // Stop barcode camera
  const stopBarcodeCamera = () => {
    if (barcodeLoopRef.current) clearInterval(barcodeLoopRef.current);
    if (barcodeStreamRef.current) barcodeStreamRef.current.getTracks().forEach(t => t.stop());
    barcodeStreamRef.current = null;
    setScanning(false);
  };

  // Start barcode scanning — uses ZXing which works on iOS Safari
  const startBarcodeScanner = async () => {
    setScanErr(""); setScannedProduct(null); setScanning(true);
    try {
      // Request high-res with continuous autofocus — critical for small barcodes
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode:  "environment",
          width:       { ideal: 1920 },
          height:      { ideal: 1080 },
          focusMode:   { ideal: "continuous" },   // keep re-focusing
          zoom:        { ideal: 1 },
        }
      });

      // After getting the stream, try to apply advanced constraints for macro focus
      try {
        const track = stream.getVideoTracks()[0];
        const caps  = track.getCapabilities?.() || {};
        const adv   = {};
        if (caps.focusMode?.includes("continuous")) adv.focusMode = "continuous";
        if (caps.zoom) adv.zoom = 1.5; // slight zoom helps ZXing read small barcodes
        if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] });
      } catch (_) {}

      barcodeStreamRef.current = stream;
      await new Promise(r => setTimeout(r, 300)); // give autofocus time to settle
      if (barcodeVideoRef.current) {
        barcodeVideoRef.current.srcObject = stream;
        await barcodeVideoRef.current.play();
      }

      // Tap-to-focus: let user tap the video to repoint the camera focus
      const handleTapFocus = (e) => {
        const track = stream.getVideoTracks()[0];
        if (!track?.applyConstraints) return;
        const rect = barcodeVideoRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top)  / rect.height;
        try {
          track.applyConstraints({
            advanced: [{ pointOfInterest: { x, y }, focusMode: "single-shot" }]
          });
          // Show a brief focus indicator
          setScanErr(""); // clear any error so UI feels responsive
        } catch (_) {}
      };
      barcodeVideoRef.current?.addEventListener("click", handleTapFocus);

      const { BrowserMultiFormatReader } = await import("@zxing/library");
      const reader = new BrowserMultiFormatReader();
      const canvas = document.createElement("canvas");
      const TICK   = 200; // faster polling

      barcodeLoopRef.current = setInterval(async () => {
        const v = barcodeVideoRef.current;
        if (!v || v.readyState < 2 || v.videoWidth === 0) return;

        // Strategy 1: decode full frame
        canvas.width  = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(v, 0, 0);

        // Strategy 2: also try a 2× zoomed center crop — helps with small barcodes
        // Sample the center 60% of the frame and upscale it
        const cropX = Math.round(v.videoWidth  * 0.20);
        const cropY = Math.round(v.videoHeight * 0.30);
        const cropW = Math.round(v.videoWidth  * 0.60);
        const cropH = Math.round(v.videoHeight * 0.40);
        const zoomCanvas  = document.createElement("canvas");
        zoomCanvas.width  = v.videoWidth;
        zoomCanvas.height = v.videoHeight;
        zoomCanvas.getContext("2d").drawImage(v,
          cropX, cropY, cropW, cropH,
          0, 0, v.videoWidth, v.videoHeight
        );

        for (const c of [canvas, zoomCanvas]) {
          try {
            const result = await reader.decodeFromCanvas(c);
            if (!result) continue;
            const raw = result.getText().replace(/[^0-9]/g, "");
            const candidates = [
              raw,
              raw.replace(/^0+/, ""),
              raw.padStart(12, "0").slice(-12),
              raw.length === 13 ? raw.slice(1) : raw,
            ];
            // Reject 12-digit reads that fail the UPC-12 check digit — catches camera misreads
            const validUPC12 = s => {
              if (s.length !== 12) return true; // non-12 digit: skip check
              const sum = [...s].reduce((acc, d, i) => acc + (i % 2 === 0 ? 3 : 1) * +d, 0);
              return sum % 10 === 0;
            };
            const upc     = candidates[1] || raw;
            if (!validUPC12(raw)) continue; // misread barcode — skip this canvas
            const product = candidates.reduce((found, c) => found || MTG_UPC_MAP[c], null);
            stopBarcodeCamera();
            if (product) {
              setScannedProduct({ ...product, upc });
            } else {
              setScanErr(`Barcode ${upc} not in database — choose manually.`);
            }
            return; // found — stop trying
          } catch(_) {}
        }
      }, TICK);
    } catch(e) {
      setScanErr("Camera denied — choose manually.");
      setScanning(false);
    }
  };

  // Apply a scanned product — jump straight to details step
  const applyScannedProduct = async (product) => {
    const pt = PRODUCT_TYPES.find(p => p.id === product.productType) || PRODUCT_TYPES[0];
    setProductType(pt);
    setTotalPacks(product.totalPacks);
    // Try to find the matching set object
    setSetsLoading(true);
    const fetched = await fetchAllSetsCached();
    setSets(fetched);
    setSetsLoading(false);
    const matched = fetched.find(s =>
      s.id === product.setId ||
      s.name.toLowerCase() === product.setName.toLowerCase()
    );
    setSelectedSet(matched || { name: product.setName, id: product.setId });
    setStep("details");
  };

  // Fetch sets when moving to set picker
  const goToSetPicker = async (pt) => {
    setProductType(pt);
    setTotalPacks(pt.defaultPacks);
    setStep("set");
    setSetsLoading(true);
    const fetched = await fetchAllSetsCached();
    setSets(fetched);
    setSetsLoading(false);
  };

  const selectSet = (s) => {
    setSelectedSet(s);
    setStep("details");
  };

  const save = () => {
    const price = parseFloat(pricePaid);
    if (!selectedSet || !pricePaid || isNaN(price) || price <= 0) return;
    onSave({
      id:          `box-${Date.now()}`,
      productType: productType.id,
      setName:     selectedSet.name,
      setId:       selectedSet.id || selectedSet._groupId?.toString(),
      setLogo:     selectedSet.images?.logo ||
                   selectedSet.imageUrl ||
                   (selectedSet._groupId ? `https://tcgplayer-cdn.tcgplayer.com/product/${selectedSet._groupId}_200w.jpg` : null),
      setSymbol:   selectedSet.images?.symbol || null,
      pricePaid:   price,  // total paid, split by totalPacks when needed
      totalPacks,
      cardsPerPack: productType.cardsPerPack,
      purchasedAt: Date.now(),
      packs:       [],
    });
  };

  const allowedSetTypes = productType ? PRODUCT_SET_TYPES[productType.id] : null;
  const filteredSets = sets.filter(s => {
    if (allowedSetTypes && !allowedSetTypes.includes(s._setType)) return false;
    if (!setSearch) return true;
    const q = setSearch.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.series?.toLowerCase().includes(q);
  });

  // Group sets by series
  const grouped = filteredSets.reduce((acc, s) => {
    const series = s.series || "Other";
    if (!acc[series]) acc[series] = [];
    acc[series].push(s);
    return acc;
  }, {});

  const inputStyle = {
    width:"100%", padding:"12px 14px", background:"#0d0d0d",
    border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff", fontSize:15,
    fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginTop:6,
  };

  return (
    <div style={{ position:"fixed", inset:0, background:BG, zIndex:10000, display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div className="fixed-overlay-header" style={{ display:"flex", alignItems:"center", padding:"14px 20px", paddingTop:"calc(14px + env(safe-area-inset-top, 0px))", gap:14, borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <button onClick={step==="product" ? onCancel : ()=>setStep(step==="set"?"product":"set")}
          style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
          {step==="product" ? <Icon.Close size={20} color="#fff"/> : <Icon.Back size={22} color="#fff"/>}
        </button>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1 }}>
            {step==="product" ? "CHOOSE PRODUCT" : step==="set" ? "SELECT SET" : "CONFIRM DETAILS"}
          </div>
          {step !== "product" && (
            <div style={{ color:"#555", fontSize:11, marginTop:1 }}>
              {productType?.label}{selectedSet ? ` · ${selectedSet.name}` : ""}
            </div>
          )}
        </div>
        {/* Step indicator */}
        <div style={{ marginLeft:"auto", display:"flex", gap:4 }}>
          {["product","set","details"].map((s,i) => (
            <div key={s} style={{ width:6, height:6, borderRadius:"50%",
              background: step===s?TEAL:["product","set","details"].indexOf(step)>i?"#444":"#222" }}/>
          ))}
        </div>
      </div>

      {/* Step 1: Product type */}
      {step === "product" && (
        <div style={{ flex:1, overflowY:"auto", padding:"16px 20px" }}>

          {/* ── Barcode scanner ── */}
          {scanning ? (
            <div style={{ marginBottom:16 }}>
              <div style={{ position:"relative", borderRadius:16, overflow:"hidden", background:"#000", aspectRatio:"4/3",
                marginTop:"calc(env(safe-area-inset-top, 0px) + 8px)" }}>
                <video ref={barcodeVideoRef} playsInline muted
                  style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
                {/* Scan line guide */}
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                  <div style={{ width:"70%", height:2, background:TEAL, boxShadow:`0 0 8px ${TEAL}`, borderRadius:1 }}/>
                </div>
                <div style={{ position:"absolute", bottom:12, left:0, right:0, textAlign:"center" }}>
                  <span style={{ background:"rgba(0,0,0,0.7)", color:TEAL, fontSize:12,
                    padding:"5px 14px", borderRadius:20, fontFamily:"'Bebas Neue',sans-serif", letterSpacing:1 }}>
                    POINT AT BARCODE · TAP TO FOCUS
                  </span>
                </div>
              </div>
              <button onClick={stopBarcodeCamera}
                style={{ width:"100%", marginTop:10, padding:"11px 0", background:"none",
                  border:`1px solid ${BORDER}`, borderRadius:12, color:"#666",
                  fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Cancel
              </button>
            </div>
          ) : scannedProduct ? (
            /* ── Scanned product confirmation ── */
            <div style={{ marginBottom:16, padding:"16px", background:CARD,
              border:`1px solid ${TEAL}44`, borderRadius:16 }}>
              <div style={{ color:TEAL, fontSize:10, fontWeight:700, letterSpacing:0.5, marginBottom:8 }}>
                PRODUCT IDENTIFIED
              </div>
              <div style={{ color:"#fff", fontSize:16, fontWeight:700, marginBottom:4 }}>
                {scannedProduct.name}
              </div>
              <div style={{ color:"#555", fontSize:12, marginBottom:14 }}>
                {scannedProduct.totalPacks} packs · {scannedProduct.cardsPerPack} cards/pack · UPC {scannedProduct.upc}
              </div>
              <button onClick={() => applyScannedProduct(scannedProduct)}
                style={{ width:"100%", padding:"12px 0", background:TEAL,
                  border:"none", borderRadius:12, color:"#000",
                  fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                Use This Product →
              </button>
              <button onClick={() => setScannedProduct(null)}
                style={{ width:"100%", marginTop:8, padding:"10px 0", background:"none",
                  border:`1px solid ${BORDER}`, borderRadius:12, color:"#555",
                  fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Scan Again
              </button>
            </div>
          ) : (
            /* ── Scan button ── */
            <button onClick={startBarcodeScanner}
              style={{ width:"100%", marginBottom:16, padding:"16px", background:TEAL+"18",
                border:`1.5px solid ${TEAL}55`, borderRadius:16, cursor:"pointer",
                display:"flex", alignItems:"center", gap:14, textAlign:"left",
                fontFamily:"inherit" }}>
              <div style={{ width:44, height:44, background:TEAL+"22", borderRadius:12,
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round">
                  <path d="M3 5h2M7 5h1M11 5h2M15 5h2M19 5h2M3 19h2M7 19h1M11 19h2M15 19h2M19 19h2M3 5v14M5 5v14M7 5v14M8 5v14M11 5v14M13 5v14M15 5v14M17 5v14M19 5v14M21 5v14"/>
                </svg>
              </div>
              <div>
                <div style={{ color:TEAL, fontSize:15, fontWeight:700 }}>Scan Product Barcode</div>
                <div style={{ color:"#555", fontSize:12, marginTop:2 }}>
                  Point at the barcode on the box or pack
                </div>
              </div>
              <div style={{ marginLeft:"auto", color:TEAL, fontSize:20 }}>›</div>
            </button>
          )}

          {scanErr && (
            <div style={{ marginBottom:14, padding:"10px 14px", background:"#1a0808",
              border:"1px solid #3d1a1a", borderRadius:10, color:"#ef4444", fontSize:12 }}>
              {scanErr}
            </div>
          )}

          {/* Manual product type list */}
          {!scanning && (
            <>
              <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>
                OR CHOOSE MANUALLY
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {PRODUCT_TYPES.map(pt => (
                  <button key={pt.id} onClick={()=>goToSetPicker(pt)} style={{
                    background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
                    padding:"14px 18px", textAlign:"left", cursor:"pointer",
                    display:"flex", justifyContent:"space-between", alignItems:"center",
                  }}>
                    <div>
                      <div style={{ color:"#fff", fontSize:14, fontWeight:600 }}>{pt.label}</div>
                      <div style={{ color:"#555", fontSize:12, marginTop:2 }}>
                        {pt.defaultPacks} pack{pt.defaultPacks!==1?"s":""} · {pt.cardsPerPack} cards/pack
                      </div>
                    </div>
                    <div style={{ color:"#444", fontSize:18 }}>›</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 2: Set picker */}
      {step === "set" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"12px 20px", flexShrink:0 }}>
            <div style={{ position:"relative" }}>
              <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}>
                <Icon.Search size={16} color="#555"/>
              </div>
              <input value={setSearch} onChange={e=>setSetSearch(e.target.value)}
                placeholder="Search sets or series..."
                autoFocus
                style={{ width:"100%", padding:"11px 12px 11px 36px", background:CARD,
                  border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                  fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
            </div>
          </div>

          <div style={{ flex:1, overflowY:"auto", padding:"0 20px 20px", minHeight:0, WebkitOverflowScrolling:"touch", overscrollBehavior:"contain" }}>
            {setsLoading ? (
              <div style={{ display:"flex", justifyContent:"center", padding:48 }}>
                <div style={{ width:32, height:32, border:`2.5px solid ${TEAL}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
              </div>
            ) : (
              Object.entries(grouped).map(([series, seriesSets]) => (
                <div key={series} style={{ marginBottom:16 }}>
                  <div style={{ color:"#555", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>{series.replace(/_/g," ").toUpperCase()}</div>
                  {seriesSets.map(s => (
                    <button key={s.id} onClick={()=>selectSet(s)} style={{
                      width:"100%", background:CARD, border:`1px solid ${BORDER}`,
                      borderRadius:12, padding:"11px 14px", marginBottom:6,
                      textAlign:"left", cursor:"pointer", display:"flex",
                      alignItems:"center", gap:12, transition:"border-color 0.15s",
                    }}
                      onMouseEnter={e=>e.currentTarget.style.borderColor=TEAL+"44"}
                      onMouseLeave={e=>e.currentTarget.style.borderColor=BORDER}
                    >
                      {/* Set symbol */}
                      <div style={{ width:52, height:36, flexShrink:0, display:"flex", alignItems:"center",
                        justifyContent:"center", background:"#0d0d0d", borderRadius:8, overflow:"hidden" }}>
                        {s.images?.logo
                          ? <img src={s.images.logo} alt={s.name}
                              style={{ maxHeight:28, maxWidth:44, objectFit:"contain", filter:"brightness(0) invert(0.7)" }}
                              onError={e=>{ e.target.style.display="none"; }}
                            />
                          : <span style={{ color:"#444", fontSize:9, fontWeight:700, letterSpacing:0.5 }}>
                              {(s.id || "").slice(0,4).toUpperCase()}
                            </span>
                        }
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color:"#fff", fontSize:13, fontWeight:600 }}>{s.name}</div>
                        <div style={{ color:"#555", fontSize:11, marginTop:1 }}>
                          {s.releaseDate}{s.total > 0 ? ` · ${s.total} cards` : ""}
                        </div>
                      </div>
                      <div style={{ color:"#333", fontSize:16, flexShrink:0 }}>›</div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Step 3: Details */}
      {step === "details" && (
        <div style={{ flex:1, overflowY:"auto", padding:"20px 20px 0" }}>
          {/* Set card */}
          <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14, padding:"16px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:52, height:36, flexShrink:0, display:"flex", alignItems:"center",
              justifyContent:"center", background:"#0d0d0d", borderRadius:8, overflow:"hidden" }}>
              {selectedSet?.images?.logo
                ? <img src={selectedSet.images.logo} alt={selectedSet?.name}
                    style={{ maxHeight:28, maxWidth:44, objectFit:"contain", filter:"brightness(0) invert(0.7)" }}
                    onError={e=>{ e.target.style.display="none"; }}
                  />
                : <span style={{ color:"#444", fontSize:9, fontWeight:700, letterSpacing:0.5 }}>
                    {(selectedSet?.id || "").slice(0,4).toUpperCase()}
                  </span>
              }
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:"#fff", fontSize:15, fontWeight:600 }}>{selectedSet?.name}</div>
              <div style={{ color:"#555", fontSize:12, marginTop:2 }}>{selectedSet?.releaseDate}{selectedSet?.total > 0 ? ` · ${selectedSet.total} cards` : ""}</div>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
            <div>
              <div style={{ color:"#888", fontSize:11, letterSpacing:0.5 }}>TOTAL PRICE PAID</div>
              <input type="number" inputMode="decimal" value={pricePaid} autoFocus
                onChange={e=>setPricePaid(e.target.value)} placeholder="0.00" style={inputStyle}/>
              <div style={{ color:"#444", fontSize:10, marginTop:4 }}>What you paid in total</div>
            </div>
            <div>
              <div style={{ color:"#888", fontSize:11, letterSpacing:0.5 }}>QUANTITY</div>
              <input type="number" inputMode="numeric" value={totalPacks}
                onChange={e=>setTotalPacks(Math.max(1,parseInt(e.target.value)||1))} style={inputStyle}/>
              <div style={{ color:"#444", fontSize:10, marginTop:4 }}>How many packs</div>
            </div>
          </div>

          {pricePaid && !isNaN(parseFloat(pricePaid)) && parseFloat(pricePaid) > 0 && (
            <div style={{ background:"#0d1f19", border:`1px solid ${TEAL}33`, borderRadius:12, padding:"12px 16px", marginBottom:20 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div>
                  <div style={{ color:"#555", fontSize:10 }}>COST PER PACK</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:TEAL, letterSpacing:1 }}>
                    {fmt(parseFloat(pricePaid) / totalPacks)}
                  </div>
                </div>
                <div>
                  <div style={{ color:"#555", fontSize:10 }}>COST PER CARD</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#888", letterSpacing:1 }}>
                    {fmt(parseFloat(pricePaid) / totalPacks / (productType?.cardsPerPack||10))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <button onClick={save}
            disabled={!pricePaid || isNaN(parseFloat(pricePaid)) || parseFloat(pricePaid)<=0}
            style={{
              width:"100%", padding:16,
              background: pricePaid && !isNaN(parseFloat(pricePaid)) && parseFloat(pricePaid)>0 ? TEAL : "#1a1a1a",
              border:"none", borderRadius:16, fontFamily:"'Bebas Neue',sans-serif",
              fontSize:18, letterSpacing:1,
              color: pricePaid && !isNaN(parseFloat(pricePaid)) && parseFloat(pricePaid)>0 ? "#000" : "#444",
              cursor:"pointer", marginBottom:32,
            }}>
            START TRACKING
          </button>
        </div>
      )}
    </div>
  );
}

// ── GroupedBoxCard ─────────────────────────────────────────────────────────────
// Shows merged unopened singles of the same set+product with sealed price + top 20 cards
function GroupedBoxCard({ boxes, onBoxPress, onSealedPrice, onDelete, onUpdateBox }) {
  const box0           = boxes[0];
  const totalPackCount = boxes.reduce((s,b)=>s+b.totalPacks,0); // total individual packs
  const totalInvested  = boxes.reduce((s,b)=>s+b.pricePaid,0);
  const avgCostPerPack = totalInvested / totalPackCount;
  const productLabel   = PRODUCT_TYPES.find(t=>t.id===box0.productType)?.label || box0.productType;

  const [expanded,      setExpanded]      = React.useState(false);
  const [sealedPrice,   setSealedPrice]   = React.useState(null);
  const [sealedLoad,    setSealedLoad]    = React.useState(false);
  const [topCards,      setTopCards]      = React.useState([]);
  const [topLoad,       setTopLoad]       = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState(null); // box.id to confirm
  const [sellModal,    setSellModal]    = React.useState(null);  // {box} when selling
  const [sellPrice,    setSellPrice]    = React.useState("");

  // Fetch sealed market price — looks up against MTG_UPC_MAP or falls back to nothing.
  // A dedicated sealed TCGPlayer price API can be wired in later.
  const fetchSealedPrice = React.useCallback(async () => {
    if (sealedPrice !== null || sealedLoad) return;
    setSealedLoad(true);
    try {
      const match = Object.values(MTG_UPC_MAP).find(p =>
        p.setCode === box0.setId && p.productType === box0.productType
      );
      setSealedPrice(match ? 0 : 0); // no live sealed price yet
    } catch {}
    const isSinglePack = box0.productType === "single_pack" || box0.totalPacks === 1;
    const sealedUnitCount = isSinglePack ? totalPackCount : boxes.length;
    onSealedPrice && onSealedPrice(box0.setName + productLabel, 0, sealedUnitCount);
    setSealedLoad(false);
  }, [box0.setId, box0.setName, box0.productType, box0.totalPacks, productLabel, sealedPrice, sealedLoad, totalPackCount, onSealedPrice]);

  React.useEffect(() => { fetchSealedPrice(); }, []);
  React.useEffect(() => {
    if (expanded) fetchTopCards();
  }, [expanded]);

  const isSinglePack = box0.productType === "single_pack" || box0.totalPacks === 1;
  const sealedUnitCount = isSinglePack ? totalPackCount : boxes.length;
  const sealedPnl = sealedPrice > 0 ? (sealedPrice * sealedUnitCount) - totalInvested : null;

  const [previewCard, setPreviewCard]   = React.useState(null);

  return (
    <>
    <div style={{ marginBottom:10 }}>
      <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16 }}>

      {/* Main row — tap to expand */}
      <div onClick={()=>{ setExpanded(e=>!e); }}
        style={{ padding:"16px", cursor:"pointer" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"#555", fontSize:11 }}>{productLabel} · {totalPackCount} pack{totalPackCount!==1?"s":""}</div>
            {box0.setLogo
              ? <img src={box0.setLogo} alt={box0.setName} style={{ height:24, objectFit:"contain", maxWidth:160, display:"block", marginTop:4 }}/>
              : <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:0.5 }}>{box0.setName}</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", letterSpacing:1 }}>
              {fmt(totalInvested)}
            </div>
            <div style={{ color:"#555", fontSize:11 }}>invested</div>
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ color:"#555", fontSize:11 }}>
            {totalPackCount} pack{totalPackCount!==1?"s":""} · avg {fmt(avgCostPerPack)}/pack · all unopened
          </span>
          <span style={{ color:TEAL, fontSize:11, display:"flex", alignItems:"center", gap:4 }}>
            {expanded ? "Less" : "More"}
            <span style={{ display:"flex", transform: expanded ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>
              <Icon.ChevronDown size={11} color={TEAL}/>
            </span>
          </span>
        </div>
        <ChaseStrip setId={box0.setId || box0.setName} setName={box0.setName}/>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ borderTop:`1px solid ${BORDER}`, padding:"14px 16px" }}>
          {/* Sealed price row */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div>
              <div style={{ color:"#888", fontSize:10, letterSpacing:0.5 }}>SEALED MARKET PRICE</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", marginTop:2 }}>
                {sealedLoad ? "…" : sealedPrice > 0 ? fmt(sealedPrice) : "N/A"}
              </div>
            </div>
            {sealedPnl !== null && (
              <div style={{ textAlign:"right" }}>
                <div style={{ color:"#888", fontSize:10, letterSpacing:0.5 }}>SELL P&L</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
                  color:sealedPnl>=0?TEAL:"#ef4444", marginTop:2 }}>
                  {sealedPnl>=0?"+":""}{fmt(sealedPnl)}
                </div>
              </div>
            )}
          </div>

          {/* Actions: open first pack, sell remaining packs, delete entries */}
          <div style={{ marginBottom:14 }}>
            {/* Open pack 1 — always the first box */}
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <button onClick={e=>{ e.stopPropagation(); onBoxPress(boxes[0]); }}
                style={{ flex:1, padding:"11px 0", background:TEAL, border:"none", borderRadius:10,
                  fontFamily:"'Bebas Neue',sans-serif", fontSize:13, letterSpacing:1,
                  color:"#000", cursor:"pointer" }}>
                {isSinglePack ? "OPEN PACK" : "OPEN PACK 1"}
              </button>
              <button onClick={e=>{ e.stopPropagation(); setDeleteConfirm(boxes[0].id); }}
                style={{ padding:"11px 12px", background:"#1a0808", border:"1px solid #3d1a1a",
                  borderRadius:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>

            {/* Sell a pack — shown for each additional sealed box entry */}
            {boxes.slice(1).map((b, bi) => (
              <div key={b.id} style={{ display:"flex", gap:8, marginBottom:8 }}>
                <button onClick={e=>{ e.stopPropagation(); setSellModal(b); setSellPrice(""); }}
                  style={{ flex:1, padding:"11px 0", background:"#0d1f19",
                    border:`1px solid ${TEAL}44`, borderRadius:10,
                    fontFamily:"'Bebas Neue',sans-serif", fontSize:13, letterSpacing:1,
                    color:TEAL, cursor:"pointer" }}>
                  SELL A PACK · {fmt(b.pricePaid / b.totalPacks)} cost
                </button>
                <button onClick={e=>{ e.stopPropagation(); setDeleteConfirm(b.id); }}
                  style={{ padding:"11px 12px", background:"#1a0808", border:"1px solid #3d1a1a",
                    borderRadius:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Top 20 most valuable cards */}
          <div style={{ color:"#888", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>
            TOP 20 MOST VALUABLE CARDS IN THIS SET
          </div>
          {topLoad && (
            <div style={{ textAlign:"center", padding:16 }}>
              <div style={{ width:18, height:18, border:`2px solid ${TEAL}`, borderTopColor:"transparent",
                borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto" }}/>
            </div>
          )}
          {!topLoad && topCards.length === 0 && (
            <div style={{ color:"#444", fontSize:12, textAlign:"center", padding:"8px 0" }}>No price data available</div>
          )}
          {!topLoad && topCards.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {topCards.map((card, i) => {
                const price = card._price || getBestCardPrice(card);
                const rawName = card.name || card.cleanName || "Unknown";
                // Some card names include set number suffixes — strip them
                const name  = rawName.replace(/\s*[-–]\s*\d+\/\d+$/, "").trim();
                const num   = card._num || card.number || "";
                const img   = card.images?.small || card.imageUrl || card.images?.large || "";
                return (
                  <div key={card.id || card.productId || i}
                    onClick={()=>setPreviewCard({ name, img, num, price, setName:box0.setName })}
                    style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer",
                      padding:"4px 6px", borderRadius:8, margin:"0 -6px",
                      transition:"background 0.15s" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#1a1a1a"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ color:"#444", fontSize:11, width:18, textAlign:"right", flexShrink:0 }}>{i+1}</div>
                    {img
                      ? <img src={img} alt={name} style={{ height:36, width:26, objectFit:"contain", borderRadius:3, flexShrink:0 }}/>
                      : <div style={{ height:36, width:26, background:"#1a1a1a", borderRadius:3, flexShrink:0 }}/>}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ color:"#fff", fontSize:12, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</div>
                      {num ? <div style={{ color:"#555", fontSize:10 }}>#{num}</div> : null}
                    </div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14, color:TEAL, flexShrink:0 }}>{fmt(price)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </div>
    </div>

    {/* Card preview — position:fixed outside transform so it covers the full viewport */}
    {previewCard && (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:99999,
        display:"flex", alignItems:"flex-end", justifyContent:"center" }}
        onClick={()=>setPreviewCard(null)}>
        <div onClick={e=>e.stopPropagation()} style={{
          background:"#111", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:500,
          padding:"24px 24px 48px" }}>
          <div style={{ width:40, height:4, background:"#333", borderRadius:2, margin:"0 auto 20px" }}/>
          <div style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
            {previewCard.img
              ? <img src={previewCard.img} alt={previewCard.name}
                  style={{ height:130, borderRadius:10, flexShrink:0, objectFit:"contain" }}
                  onError={e=>{e.target.style.display="none";}}/>
              : <div style={{ width:90, height:130, background:"#1a1a1a", borderRadius:10, flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Icon.Cards size={32} color="#333"/>
                </div>}
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff",
                letterSpacing:0.5, lineHeight:1.1 }}>{previewCard.name}</div>
              {previewCard.setName && (
                <div style={{ color:TEAL, fontSize:12, marginTop:4 }}>{previewCard.setName}</div>
              )}
              {previewCard.num && (
                <div style={{ color:"#555", fontSize:11, marginTop:2 }}>#{previewCard.num}</div>
              )}
              <div style={{ marginTop:16, background:"#0a1f10", border:`1px solid #1a3d20`,
                borderRadius:12, padding:"12px 16px" }}>
                <div style={{ color:"#555", fontSize:10, letterSpacing:0.5 }}>MARKET VALUE</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32,
                  color:TEAL, letterSpacing:1, marginTop:2 }}>{fmt(previewCard.price)}</div>
              </div>
            </div>
          </div>
          <button onClick={()=>setPreviewCard(null)} style={{
            width:"100%", marginTop:20, padding:14, background:"#1a1a1a",
            border:`1px solid ${BORDER}`, borderRadius:14, color:"#888",
            fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Close</button>
        </div>
      </div>
    )}

    {/* Sell modal — outside transform so position:fixed is viewport-relative */}
    {sellModal && (
      <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.88)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
        onClick={()=>setSellModal(null)}>
        <div style={{ background:"#111", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:360,
          border:`1px solid ${TEAL}44` }} onClick={e=>e.stopPropagation()}>
          <div style={{ color:"#fff", fontSize:17, fontWeight:700, marginBottom:4 }}>Sell a Pack</div>
          <div style={{ color:"#555", fontSize:12, marginBottom:18 }}>
            {box0.setName} · cost {fmt(sellModal.pricePaid / sellModal.totalPacks)}/pack
          </div>
          <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>SALE PRICE</div>
          <input type="number" inputMode="decimal" value={sellPrice} autoFocus
            onChange={e=>setSellPrice(e.target.value)} placeholder="0.00"
            style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
              border:`1px solid ${TEAL}55`, borderRadius:12, color:"#fff",
              fontSize:18, fontFamily:"inherit", outline:"none",
              boxSizing:"border-box", marginBottom:8 }}/>
          {sellPrice && !isNaN(parseFloat(sellPrice)) && parseFloat(sellPrice) > 0 && (() => {
            const costPer = sellModal.pricePaid / sellModal.totalPacks;
            const pnl = parseFloat(sellPrice) - costPer;
            return (
              <div style={{ padding:"8px 12px", background:pnl>=0?"#0d1f19":"#1a0808",
                border:`1px solid ${pnl>=0?TEAL+"33":"#3d1a1a"}`, borderRadius:10, marginBottom:16 }}>
                <span style={{ color:pnl>=0?TEAL:"#ef4444", fontSize:14, fontWeight:700 }}>
                  {pnl>=0?"+":""}{fmt(pnl)} P&L on this pack
                </span>
              </div>
            );
          })()}
          <div style={{ display:"flex", gap:10, marginTop:4 }}>
            <button onClick={()=>setSellModal(null)}
              style={{ flex:1, padding:"12px 0", background:"none", border:`1px solid ${BORDER}`,
                borderRadius:12, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
            <button
              disabled={!sellPrice || isNaN(parseFloat(sellPrice)) || parseFloat(sellPrice)<=0}
              onClick={()=>{
                const salePrice = parseFloat(sellPrice);
                if (!salePrice || salePrice<=0) return;
                const b = sellModal;
                if (b.totalPacks<=1) { onDelete?.(b.id); }
                else {
                  const costPer = b.pricePaid / b.totalPacks;
                  onUpdateBox?.({ ...b, totalPacks:b.totalPacks-1, pricePaid:b.pricePaid-costPer,
                    sales:[...(b.sales||[]),{soldAt:Date.now(),salePrice,costBasis:costPer}] });
                }
                setSellModal(null); setSellPrice("");
              }}
              style={{ flex:1, padding:"12px 0",
                background:sellPrice&&!isNaN(parseFloat(sellPrice))&&parseFloat(sellPrice)>0?TEAL:"#1a1a1a",
                border:"none", borderRadius:12,
                color:sellPrice&&!isNaN(parseFloat(sellPrice))&&parseFloat(sellPrice)>0?"#000":"#444",
                fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              Confirm Sale
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Delete confirm — outside transform so position:fixed is viewport-relative */}
    {deleteConfirm && (
      <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.85)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
        onClick={()=>setDeleteConfirm(null)}>
        <div style={{ background:"#111", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:360,
          border:"1px solid #3d1a1a" }} onClick={e=>e.stopPropagation()}>
          <div style={{ color:"#fff", fontSize:17, fontWeight:700, marginBottom:6 }}>Remove this entry?</div>
          <div style={{ color:"#666", fontSize:13, marginBottom:20 }}>
            {box0.setName} · {productLabel} · {fmt(boxes.find(b=>b.id===deleteConfirm)?.pricePaid||0)} paid
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setDeleteConfirm(null)}
              style={{ flex:1, padding:"12px 0", background:"none", border:`1px solid ${BORDER}`,
                borderRadius:12, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
            <button onClick={()=>{ onDelete?.(deleteConfirm); setDeleteConfirm(null); }}
              style={{ flex:1, padding:"12px 0", background:"#ef4444", border:"none",
                borderRadius:12, color:"#fff", fontSize:14, fontWeight:700,
                cursor:"pointer", fontFamily:"inherit" }}>
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// Packs tab — list of all boxes


// Module-level price getter for use outside components
function getBestCardPrice(card) {
  if (!card) return 0;
  const p = card.prices || {};
  return parseFloat(p.usd || p.usd_foil || p.eur || 0);
}

// Fetches top chase cards for a set — cached in memory per setCode
const _chaseCardCache = {};
function useChaseCards(setId, setName) {
  const [cards, setCards] = React.useState(_chaseCardCache[setId || setName] || []);
  React.useEffect(() => {
    const key = setId || setName;
    if (!key) return;
    if (_chaseCardCache[key]?.length) { setCards(_chaseCardCache[key]); return; }

    fetchSetCards(setId || "").then(all => {
      const chase = all
        .map(c => ({
          id:     c.id,
          name:   c.name,
          number: c.number,
          rarity: c.rarity || "",
          img:    c.images?.small,
          price:  getBestCardPrice(c),
        }))
        .filter(c => c.price >= 5)
        .sort((a, b) => b.price - a.price)
        .slice(0, 20);
      if (chase.length) {
        _chaseCardCache[key] = chase;
        setCards(chase);
      }
    }).catch(() => {});
  }, [setId, setName]);
  return cards;
}

// Horizontal "top pulls" strip — shows the user's actual best pulls from a box,
// once fully opened. Same visual style as ChaseStrip but sourced from real pulls.
function TopPullsStrip({ box }) {
  const [selected, setSelected] = React.useState(null);
  const pulls = React.useMemo(() => {
    return box.packs
      .filter(p => p.opened)
      .flatMap(p => p.cards.map(c => ({ ...c, packNumber: p.packNumber })))
      .map(c => ({
        id: c.id,
        name: c.card.name,
        number: c.card.number,
        rarity: c.card.rarity,
        img: c.card.images?.small,
        price: genPrices(c.card).raw[c.condition] || 0,
        condition: c.condition,
        packNumber: c.packNumber,
        _card: c.card,
      }))
      .filter(c => c.price > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, 20);
  }, [box]);

  if (!pulls.length) return null;
  return (
    <>
    <div style={{ marginTop:10, marginLeft:-16, marginRight:-16, paddingLeft:16 }}
      onClick={e => e.stopPropagation()}>
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingRight:16, paddingBottom:4,
        scrollbarWidth:"none", msOverflowStyle:"none" }}>
        {pulls.map(c => (
          <div key={c.id} onClick={()=>setSelected(c)}
            style={{ flexShrink:0, width:56, display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer" }}>
            <div style={{ position:"relative", width:56 }}>
              <img src={c.img} alt={c.name}
                style={{ width:56, height:78, objectFit:"contain", borderRadius:5, display:"block" }}
                onError={e => e.target.style.opacity="0.3"}/>
            </div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:12, color:TEAL,
              letterSpacing:0.5, textAlign:"center", lineHeight:1 }}>{fmt(c.price)}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Card detail modal — portalled to body to escape SwipeableBoxCard's transform context */}
    {selected && createPortal(
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:9000,
        display:"flex", alignItems:"flex-end", justifyContent:"center" }}
        onClick={() => setSelected(null)}>
        <div onClick={e=>e.stopPropagation()} style={{
          background:"#111", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:500,
          padding:"24px 24px 40px", maxHeight:"85vh", overflowY:"auto",
        }}>
          <div style={{ width:40, height:4, background:"#333", borderRadius:2, margin:"0 auto 20px" }}/>
          <div style={{ display:"flex", gap:16, marginBottom:20 }}>
            {selected.img ? (
              <img src={selected.img} alt={selected.name}
                style={{ height:140, borderRadius:10, flexShrink:0 }}
                onError={e=>{e.target.style.display="none";}}/>
            ) : (
              <div style={{ width:100, height:140, borderRadius:10, background:"#1a1a1a",
                flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Icon.Cards size={32} color="#333"/>
              </div>
            )}
            <div style={{ flex:1 }}>
              <div style={{ color:"#fff", fontSize:18, fontWeight:700, marginBottom:4 }}>{selected.name}</div>
              <div style={{ color:"#555", fontSize:12, marginBottom:8 }}>
                {selected.number ? `#${selected.number}` : ""}{selected.rarity ? ` · ${selected.rarity}` : ""}
              </div>
              <div style={{ color:"#555", fontSize:12, marginBottom:2 }}>{box.setName} · Pack #{selected.packNumber}</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:TEAL, letterSpacing:1, marginTop:8 }}>
                {fmt(selected.price)}
              </div>
              <div style={{ color:"#444", fontSize:11, marginTop:2 }}>{condLabels[selected.condition] || "Market"} price</div>
            </div>
          </div>
          <button onClick={()=>setSelected(null)} style={{
            width:"100%", padding:14, background:"#1a1a1a", border:`1px solid ${BORDER}`,
            borderRadius:14, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit",
          }}>Close</button>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

// Horizontal chase card strip — rendered inside pack list cards
function ChaseStrip({ setId, setName }) {
  const cards = useChaseCards(setId, setName);
  const [selected, setSelected] = React.useState(null);
  if (!cards.length) return null;
  return (
    <>
    <div style={{ marginTop:10, marginLeft:-16, marginRight:-16, paddingLeft:16 }}
      onClick={e => e.stopPropagation()}>
      <div style={{ display:"flex", gap:8, overflowX:"auto", paddingRight:16, paddingBottom:4,
        scrollbarWidth:"none", msOverflowStyle:"none" }}>
        {cards.map(c => (
          <div key={c.id} onClick={()=>setSelected(c)}
            style={{ flexShrink:0, width:56, display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer" }}>
            <div style={{ position:"relative", width:56 }}>
              <img src={c.img} alt={c.name}
                style={{ width:56, height:78, objectFit:"contain", borderRadius:5, display:"block" }}
                onError={e => e.target.style.opacity="0.3"}/>
            </div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:12, color:TEAL,
              letterSpacing:0.5, textAlign:"center", lineHeight:1 }}>{fmt(c.price)}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Card detail modal — portalled to body to escape SwipeableBoxCard's transform context */}
    {selected && createPortal(
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:9000,
        display:"flex", alignItems:"flex-end", justifyContent:"center" }}
        onClick={() => setSelected(null)}>
        <div onClick={e=>e.stopPropagation()} style={{
          background:"#111", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:500,
          padding:"24px 24px 40px", maxHeight:"85vh", overflowY:"auto",
        }}>
          <div style={{ width:40, height:4, background:"#333", borderRadius:2, margin:"0 auto 20px" }}/>
          <div style={{ display:"flex", gap:16, marginBottom:20 }}>
            {selected.img ? (
              <img src={selected.img} alt={selected.name}
                style={{ height:140, borderRadius:10, flexShrink:0 }}
                onError={e=>{e.target.style.display="none";}}/>
            ) : (
              <div style={{ width:100, height:140, borderRadius:10, background:"#1a1a1a",
                flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Icon.Cards size={32} color="#333"/>
              </div>
            )}
            <div style={{ flex:1 }}>
              <div style={{ color:"#fff", fontSize:18, fontWeight:700, marginBottom:4 }}>{selected.name}</div>
              <div style={{ color:"#555", fontSize:12, marginBottom:8 }}>
                {selected.number ? `#${selected.number}` : ""}{selected.rarity ? ` · ${selected.rarity}` : ""}
              </div>
              <div style={{ color:"#555", fontSize:12, marginBottom:2 }}>{setName}</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, color:TEAL, letterSpacing:1, marginTop:8 }}>
                {fmt(selected.price)}
              </div>
              <div style={{ color:"#444", fontSize:11, marginTop:2 }}>Market price</div>
            </div>
          </div>
          <button onClick={()=>setSelected(null)} style={{
            width:"100%", padding:14, background:"#1a1a1a", border:`1px solid ${BORDER}`,
            borderRadius:14, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit",
          }}>Close</button>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}

function SwipeableBoxCard({ box, pnl, val, costPerPack, opened, productLabel, onPress, onDelete }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div
        onClick={onPress}
        style={{
          background:CARD, border:`1px solid ${BORDER}`, borderRadius:16,
          padding:"16px", cursor:"pointer",
        }}>
        {(() => {
          const isSingle = box.productType === "single_pack" || box.totalPacks === 1;
          const remaining = box.totalPacks - opened;
          const isFullyOpened = remaining === 0;

          return (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:"#555", fontSize:11 }}>
                    {productLabel}
                    {isSingle && !isFullyOpened && remaining < box.totalPacks && (
                      <span style={{ color:TEAL, marginLeft:6 }}>· {remaining} remaining</span>
                    )}
                    {isSingle && isFullyOpened && (
                      <span style={{ color:"#444", marginLeft:6 }}>· Opened</span>
                    )}
                  </div>
                  {box.setLogo
                    ? <img src={box.setLogo} alt={box.setName} style={{ height:24, objectFit:"contain", maxWidth:160, display:"block", marginTop:4 }}/>
                    : <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:0.5 }}>{box.setName}</div>}
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20,
                    color: isFullyOpened ? (pnl>=0?TEAL:"#ef4444") : "#fff", letterSpacing:1 }}>
                    {isFullyOpened
                      ? `${pnl>=0?"+":"-"}${fmtCompact(Math.abs(pnl))}`
                      : fmt(box.pricePaid)}
                  </div>
                  <div style={{ color:"#555", fontSize:11 }}>
                    {isFullyOpened ? `${fmt(val)} pulled` : "invested"}
                  </div>
                </div>
              </div>

              {/* Only show progress bar for multi-pack boxes, not single packs */}
              {!isSingle && (
                <>
                  <div style={{ height:4, background:"#1a1a1a", borderRadius:2, marginBottom:6 }}>
                    <div style={{ height:"100%", width:`${(opened/box.totalPacks)*100}%`, background:TEAL, borderRadius:2 }}/>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ color:"#555", fontSize:11 }}>{opened}/{box.totalPacks} packs opened</span>
                    <span style={{ color:"#444", fontSize:11 }}>{fmt(costPerPack)}/pack</span>
                  </div>
                  {isFullyOpened
                    ? <TopPullsStrip box={box}/>
                    : <ChaseStrip setId={box.setId || box.setName} setName={box.setName}/>}
                </>
              )}

              {/* Single pack — show cost per pack */}
              {isSingle && (
                <>
                  <div style={{ color:"#444", fontSize:11 }}>
                    {fmt(costPerPack)}/pack
                  </div>
                  {isFullyOpened
                    ? <TopPullsStrip box={box}/>
                    : <ChaseStrip setId={box.setId || box.setName} setName={box.setName}/>}
                </>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}



// ── SingleSetCard ─────────────────────────────────────────────────────────────
// One card per set — groups all single packs of the same set together.
// Shows remaining sealed count, avg cost, open/sell buttons, and pack history.
function SingleSetCard({ boxes, onBoxPress, onGroupPress, onDelete, onUpdateBox }) {
  const box0 = boxes[0];
  const setName = box0.setName || "Unknown";
  const setLogo = box0.setLogo;

  // Separate boxes with remaining sealed packs vs fully opened
  const allPacks      = boxes.flatMap(b => b.packs);
  const openedPacks   = allPacks.filter(p => p.opened);

  // Count truly remaining (unsealed slots across all boxes)
  const totalSlots    = boxes.reduce((s,b) => s + b.totalPacks, 0);
  const totalOpened   = boxes.reduce((s,b) => s + b.packs.filter(p=>p.opened).length, 0);
  const remaining     = totalSlots - totalOpened;

  const totalInvested = boxes.reduce((s,b) => s + b.pricePaid, 0);
  const avgCost       = totalInvested / totalSlots;

  // Next box to open = first box that still has sealed packs
  const nextBox = boxes.find(b => b.packs.filter(p=>p.opened).length < b.totalPacks);
  const nextPackNum = nextBox ? nextBox.packs.filter(p=>p.opened).length + 1 : null;

  const [sellModal,  setSellModal]  = React.useState(false);
  const [sellPrice,  setSellPrice]  = React.useState("");
  const [delConfirm, setDelConfirm] = React.useState(null);

  // Value of all opened cards
  const openedVal = boxes.reduce((s,b) =>
    s + b.packs.filter(p=>p.opened).reduce((ps,p) =>
      ps + p.cards.reduce((cs,c) => cs + (genPrices(c.card).raw[c.condition]||0), 0), 0), 0);

  const openedCost = totalOpened * avgCost;
  const pnl = openedVal - openedCost;

  const handleSellConfirm = () => {
    const sp = parseFloat(sellPrice);
    if (!sp || sp <= 0 || !nextBox) return;
    const costPer = nextBox.pricePaid / nextBox.totalPacks;
    if (nextBox.totalPacks <= 1) {
      onDelete?.(nextBox.id);
    } else {
      onUpdateBox?.({
        ...nextBox,
        totalPacks: nextBox.totalPacks - 1,
        pricePaid:  nextBox.pricePaid - costPer,
        sales: [...(nextBox.sales||[]), { soldAt:Date.now(), salePrice:sp, costBasis:costPer }],
      });
    }
    setSellModal(false); setSellPrice("");
  };

  return (
    <>
    <div style={{ marginBottom:10 }}>
      <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16 }}>

      {/* Header — tap to open detail view (use any box if no remaining packs) */}
      <div onClick={()=>{ if(onGroupPress) { onGroupPress(setName); } else { const b = nextBox || boxes[0]; if(b) onBoxPress(b); } }}
        style={{ padding:"14px 16px 10px", cursor:"pointer" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"#555", fontSize:11 }}>
              Single Pack ·{" "}
              <span style={{ color: remaining > 0 ? TEAL : "#555" }}>
                {remaining} remaining
              </span>
              {totalOpened > 0 && (
                <span style={{ color:"#444" }}> · {totalOpened} opened</span>
              )}
            </div>
            {setLogo
              ? <img src={setLogo} alt={setName} style={{ height:24, objectFit:"contain", maxWidth:160, display:"block", marginTop:4 }}/>
              : <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:0.5 }}>{setName}</div>}
          </div>
          <div style={{ textAlign:"right" }}>
            {totalOpened > 0 ? (
              <>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:pnl>=0?TEAL:"#ef4444", letterSpacing:1 }}>
                  {pnl>=0?"+":""}{fmt(pnl)}
                </div>
                <div style={{ color:"#555", fontSize:11 }}>{fmt(openedVal)} pulled</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", letterSpacing:1 }}>
                  {fmt(totalInvested)}
                </div>
                <div style={{ color:"#555", fontSize:11 }}>invested</div>
              </>
            )}
          </div>
        </div>
        <div style={{ color:"#444", fontSize:11, paddingBottom:4 }}>{fmt(avgCost)}/pack avg</div>
        {remaining === 0 && totalOpened > 0
          ? <TopPullsStrip box={{ packs: allPacks, setName }}/>
          : <ChaseStrip setId={boxes[0]?.setId} setName={setName}/>}
      </div>
      </div>
    </div>

    {/* Sell modal */}
    {sellModal && (
      <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.88)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
        onClick={()=>setSellModal(false)}>
        <div style={{ background:"#111", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:360,
          border:`1px solid ${TEAL}44` }} onClick={e=>e.stopPropagation()}>
          <div style={{ color:"#fff", fontSize:17, fontWeight:700, marginBottom:4 }}>Sell a Pack</div>
          <div style={{ color:"#555", fontSize:12, marginBottom:18 }}>
            {setName} · avg cost {fmt(avgCost)}/pack
          </div>
          <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>SALE PRICE</div>
          <input type="number" inputMode="decimal" value={sellPrice} autoFocus
            onChange={e=>setSellPrice(e.target.value)} placeholder="0.00"
            style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
              border:`1px solid ${TEAL}55`, borderRadius:12, color:"#fff",
              fontSize:18, fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:8 }}/>
          {sellPrice && !isNaN(parseFloat(sellPrice)) && parseFloat(sellPrice) > 0 && (
            <div style={{ padding:"8px 12px", marginBottom:16, borderRadius:10,
              background:parseFloat(sellPrice)-avgCost>=0?"#0d1f19":"#1a0808",
              border:`1px solid ${parseFloat(sellPrice)-avgCost>=0?TEAL+"33":"#3d1a1a"}` }}>
              <span style={{ color:parseFloat(sellPrice)-avgCost>=0?TEAL:"#ef4444", fontSize:14, fontWeight:700 }}>
                {parseFloat(sellPrice)-avgCost>=0?"+":""}{fmt(parseFloat(sellPrice)-avgCost)} P&L
              </span>
            </div>
          )}
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setSellModal(false)}
              style={{ flex:1, padding:"12px 0", background:"none", border:`1px solid ${BORDER}`,
                borderRadius:12, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
            <button onClick={handleSellConfirm}
              disabled={!sellPrice || isNaN(parseFloat(sellPrice)) || parseFloat(sellPrice)<=0}
              style={{ flex:1, padding:"12px 0", border:"none", borderRadius:12, fontSize:14,
                fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                background:sellPrice&&!isNaN(parseFloat(sellPrice))&&parseFloat(sellPrice)>0?TEAL:"#1a1a1a",
                color:sellPrice&&!isNaN(parseFloat(sellPrice))&&parseFloat(sellPrice)>0?"#000":"#444" }}>
              Confirm Sale
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Delete confirm — outside transform */}
    {delConfirm && (
      <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.85)",
        display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
        onClick={()=>setDelConfirm(null)}>
        <div style={{ background:"#111", borderRadius:20, padding:"24px 20px", width:"100%", maxWidth:360,
          border:"1px solid #3d1a1a" }} onClick={e=>e.stopPropagation()}>
          <div style={{ color:"#fff", fontSize:17, fontWeight:700, marginBottom:6 }}>Remove one pack entry?</div>
          <div style={{ color:"#666", fontSize:13, marginBottom:20 }}>{setName} · Single Pack</div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setDelConfirm(null)}
              style={{ flex:1, padding:"12px 0", background:"none", border:`1px solid ${BORDER}`,
                borderRadius:12, color:"#888", fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
            <button onClick={()=>{ onDelete?.(delConfirm); setDelConfirm(null); }}
              style={{ flex:1, padding:"12px 0", background:"#ef4444", border:"none",
                borderRadius:12, color:"#fff", fontSize:14, fontWeight:700,
                cursor:"pointer", fontFamily:"inherit" }}>
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function PacksView({ boxes, onNewBox, onBoxPress, onGroupPress, onDelete, onUpdateBox }) {
  const sortedBoxes = [...boxes].sort((a,b) => {
    const status = box => {
      const opened = box.packs.filter(p=>p.opened).length;
      if (opened === 0) return 1;            // unopened
      if (opened < box.totalPacks) return 0; // in progress
      return 2;                              // completed
    };
    const diff = status(a) - status(b);
    if (diff !== 0) return diff;
    return (b.purchasedAt||0) - (a.purchasedAt||0); // newest first within same status
  });

  // Sealed prices keyed by box group key — populated as GroupedBoxCards load their prices
  const [sealedPrices, setSealedPrices] = React.useState({}); // key -> pricePerUnit

  const onSealedPrice = React.useCallback((key, pricePerUnit, unitCount) => {
    setSealedPrices(prev => ({ ...prev, [key]: { pricePerUnit, unitCount } }));
  }, []);

  const totalInvested = boxes.reduce((s,b)=>s+b.pricePaid,0);

  // Value = opened card values + sealed market values for fully-unopened groups
  const openedValue = boxes.reduce((s,b)=>
    s+b.packs.filter(p=>p.opened).reduce((ps,p)=>
      ps+p.cards.reduce((cs,c)=>cs+(genPrices(c.card).raw[c.condition]||0),0),0),0);
  const sealedValue = Object.values(sealedPrices).reduce((s,{pricePerUnit,unitCount})=>
    s + (pricePerUnit * unitCount), 0);
  const totalValue = openedValue + sealedValue;

  // P&L = value - cost of opened packs - cost of still-sealed packs (at invested price)
  const openedCost = boxes.reduce((s,b)=>
    s+(b.packs.filter(p=>p.opened).length*(b.pricePaid/b.totalPacks)),0);
  const sealedCost = boxes.reduce((s,b)=>
    s+((b.totalPacks - b.packs.filter(p=>p.opened).length)*(b.pricePaid/b.totalPacks)),0);
  const pnl = totalValue - openedCost - sealedCost;

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"16px 20px 12px", flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:"#fff", letterSpacing:1 }}>PACK TRACKER</div>
          <button onClick={onNewBox} style={{
            background:TEAL, border:"none", borderRadius:20, padding:"8px 16px",
            fontFamily:"'Bebas Neue',sans-serif", fontSize:13, letterSpacing:0.5,
            color:"#000", cursor:"pointer", display:"flex", alignItems:"center", gap:6,
          }}>
            <Icon.Pack size={16} color="#000"/> NEW BOX
          </button>
        </div>

        {boxes.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:14 }}>
            {[
              { label:"INVESTED", value:fmtCompact(totalInvested), color:"#ccc" },
              { label:"VALUE",    value:fmtCompact(totalValue),    color:"#fff" },
              { label:"P&L",      value:(pnl>=0?"+":"-")+fmtCompact(Math.abs(pnl)), color:pnl>=0?TEAL:"#ef4444" },
            ].map(s=>(
              <div key={s.label} style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:"10px 12px" }}>
                <div style={{ color:"#555", fontSize:9, letterSpacing:0.5 }}>{s.label}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:s.color, letterSpacing:1, marginTop:2 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"0 20px 20px" }}>
        {boxes.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 0" }}>
            <Icon.Pack size={44} color="#222"/>
            <div style={{ color:"#444", fontSize:15, marginTop:14 }}>No boxes tracked yet</div>
            <div style={{ color:"#333", fontSize:12, marginTop:6 }}>Tap NEW BOX to start tracking a booster box</div>
          </div>
        ) : (
          (() => {
            const isSingle = b => b.productType === "single_pack" || b.totalPacks === 1;

            // Build a flat list of render items, each with a sort key
            // status: 0=in-progress, 1=unopened, 2=completed
            const items = [];
            const usedIds = new Set();

            // ── Non-singles ────────────────────────────────────────────────
            sortedBoxes.filter(b => !isSingle(b)).forEach(box => {
              if (usedIds.has(box.id)) return;
              const key = (box.setName||"") + "|" + (box.productType||"");
              const opened = box.packs.filter(p=>p.opened).length;
              if (opened === 0) {
                const siblings = sortedBoxes.filter(b =>
                  !usedIds.has(b.id) && b.id !== box.id && !isSingle(b) &&
                  b.packs.filter(p=>p.opened).length === 0 &&
                  (b.setName||"")+"|"+(b.productType||"") === key
                );
                siblings.forEach(s => usedIds.add(s.id));
                usedIds.add(box.id);
                const allBoxes = [box, ...siblings];
                items.push({ type:"grouped", boxes:allBoxes, key, status:1, ts: box.purchasedAt||0 });
              } else {
                usedIds.add(box.id);
                const status = opened >= box.totalPacks ? 2 : 0;
                items.push({ type:"single", box, status, ts: box.purchasedAt||0 });
              }
            });

            // ── Singles grouped by set ─────────────────────────────────────
            const singlesBySet = {};
            sortedBoxes.filter(b => isSingle(b)).forEach(box => {
              const key = box.setName || "Unknown";
              if (!singlesBySet[key]) singlesBySet[key] = [];
              singlesBySet[key].push(box);
            });

            Object.entries(singlesBySet).forEach(([setName, boxes]) => {
              const totalSlots  = boxes.reduce((s,b)=>s+b.totalPacks,0);
              const totalOpened = boxes.reduce((s,b)=>s+b.packs.filter(p=>p.opened).length,0);
              const status = totalOpened === 0 ? 1 : totalOpened >= totalSlots ? 2 : 0;
              const ts = Math.max(...boxes.map(b=>b.purchasedAt||0));
              items.push({ type:"singleSet", boxes, setName, status, ts });
            });

            // ── Sort: active singles first, then in-progress, unopened, completed ──
            items.sort((a,b) => {
              const aS = a.type === "singleSet" && a.status !== 2 ? -1 : a.status;
              const bS = b.type === "singleSet" && b.status !== 2 ? -1 : b.status;
              if (aS !== bS) return aS - bS;
              return b.ts - a.ts;
            });

            // ── Render ─────────────────────────────────────────────────────
            return items.map((item, i) => {
              if (item.type === "grouped") {
                return <GroupedBoxCard key={item.key+i} boxes={item.boxes} onBoxPress={onBoxPress} onSealedPrice={onSealedPrice} onDelete={onDelete} onUpdateBox={onUpdateBox}/>;
              }
              if (item.type === "singleSet") {
                return <SingleSetCard key={item.setName} boxes={item.boxes} onBoxPress={onBoxPress} onGroupPress={onGroupPress} onDelete={onDelete} onUpdateBox={onUpdateBox}/>;
              }
              const box = item.box;
              const opened = box.packs.filter(p=>p.opened).length;
              const costPerPack = box.pricePaid / box.totalPacks;
              const val = box.packs.filter(p=>p.opened).reduce((s,p)=>s+p.cards.reduce((cs,c)=>cs+(genPrices(c.card).raw[c.condition]||0),0),0);
              const pnl2 = val - opened*costPerPack;
              const productLabel = PRODUCT_TYPES.find(t=>t.id===box.productType)?.label || box.productType;
              return <SwipeableBoxCard key={box.id} box={box} pnl={pnl2} val={val}
                costPerPack={costPerPack} opened={opened} productLabel={productLabel}
                onPress={()=>onBoxPress(box)} onDelete={onDelete}/>;
            });
          })()
        )}
      </div>
    </div>
  );
}


// ── PIN Lock ──────────────────────────────────────────────────────────────────
// Global crash logger
if (typeof window !== "undefined") {
  window.addEventListener("error", e => {
    try { localStorage.setItem("pktk_last_crash", JSON.stringify({ type:"error", msg:e.message, stack:e.error?.stack, ts:new Date().toISOString(), line:e.lineno })); } catch(_) {}
  });
  window.addEventListener("unhandledrejection", e => {
    try { localStorage.setItem("pktk_last_crash", JSON.stringify({ type:"promise", msg:String(e.reason), stack:e.reason?.stack, ts:new Date().toISOString() })); } catch(_) {}
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError:false, error:null }; }
  static getDerivedStateFromError(e) { return { hasError:true, error:e }; }
  componentDidCatch(e, info) {
    console.error("App error:", e, info);
    try { localStorage.setItem("pktk_last_crash", JSON.stringify({ type:"react", msg:e.message, stack:e.stack, componentStack:info.componentStack, ts:new Date().toISOString() })); } catch(_) {}
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ height:"100svh", background:"#0a0a0a", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, gap:20 }}>
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <circle cx="28" cy="28" r="26" stroke="#ef4444" strokeWidth="2"/>
          <path d="M28 18v14M28 36v2" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div style={{ color:"#fff", fontSize:18, fontWeight:700, textAlign:"center" }}>Something went wrong</div>
        <div style={{ color:"#555", fontSize:13, textAlign:"center" }}>{this.state.error?.message || "An unexpected error occurred"}</div>
        <button onClick={()=>{ this.setState({hasError:false,error:null}); window.location.reload(); }}
          style={{ background:"#00D4AA", border:"none", borderRadius:24, padding:"12px 28px", color:"#000", fontWeight:700, fontSize:14, cursor:"pointer" }}>
          Reload App
        </button>
        <button onClick={()=>{
          const log = localStorage.getItem("pktk_last_crash");
          navigator.clipboard?.writeText(log||"").then(()=>alert("Crash log copied!")).catch(()=>alert(log));
        }} style={{ background:"none", border:"1px solid #333", borderRadius:12, padding:"8px 16px", color:"#555", cursor:"pointer", fontSize:12 }}>
          Copy Crash Log
        </button>
      </div>
    );
  }
}


// ── Persistent storage ───────────────────────────────────────────────────────
const STORAGE_KEY = "mtg-collection-v1";
const TRADE_LIST_KEY = "mtg-trade-list-v1";
const MASTER_SET_CHECKS_KEY = "mtg-mastersets-v1";
function loadTradeList() { try { return JSON.parse(localStorage.getItem(TRADE_LIST_KEY)||"[]"); } catch { return []; } }
function saveTradeList(list) { try { localStorage.setItem(TRADE_LIST_KEY, JSON.stringify(list)); } catch {} }

// ── Price-check wishlist — persists locally so a crash mid-shopping-trip ──────
// doesn't lose the list. Entries older than 24h are dropped on load since this
// is meant for a single shopping session, not a permanent list.
const WISHLIST_KEY = "mtg-pricecheck-wishlist-v1";
const WISHLIST_TTL_MS = 24 * 60 * 60 * 1000;
function loadWishlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(WISHLIST_KEY) || "[]");
    const cutoff = Date.now() - WISHLIST_TTL_MS;
    const fresh = raw.filter(w => (w.addedAt || 0) > cutoff);
    if (fresh.length !== raw.length) saveWishlist(fresh); // prune stale entries immediately
    return fresh;
  } catch { return []; }
}
function saveWishlist(list) { try { localStorage.setItem(WISHLIST_KEY, JSON.stringify(list)); } catch {} }

// ── On-device card matching (no API) ─────────────────────────────────────────
const SET_CARD_CACHE = {}; // setId -> [{name, number, nameLower}]

function levenshteinMTG(a, b) {
  const m=a.length, n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function matchMTGCard(ocrName, ocrNumber, setCards) {
  if (!ocrName || !setCards?.length) return null;
  const q = ocrName.toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
  const numClean = ocrNumber ? String(parseInt(ocrNumber,10)) : null;

  // 1. Number match (most reliable for Pokémon - number is always in corner)
  if (numClean) {
    const byNum = setCards.filter(c => String(parseInt(c.number,10)) === numClean);
    if (byNum.length === 1) return { card: byNum[0], score: 0.99 };
    if (byNum.length > 1) {
      // Multiple cards with same number (shouldn't happen but handle it)
      // Refine by name
      const nameMatch = byNum.find(c => c.nameLower.includes(q.slice(0,5)));
      if (nameMatch) return { card: nameMatch, score: 0.95 };
      return { card: byNum[0], score: 0.9 };
    }
  }

  // 2. Exact name
  const exact = setCards.find(c => c.nameLower === q);
  if (exact) return { card: exact, score: 1.0 };

  // 3. Starts-with
  if (q.length >= 4) {
    const sw = setCards.filter(c => c.nameLower.startsWith(q.slice(0,5)));
    if (sw.length === 1) return { card: sw[0], score: 0.88 };
  }

  // 4. Levenshtein fuzzy
  const scored = setCards.map(c => ({
    card: c,
    score: 1 - levenshteinMTG(q, c.nameLower) / Math.max(q.length, c.nameLower.length)
  })).sort((a,b) => b.score-a.score);
  if (scored[0]?.score >= 0.6) return scored[0];
  return null;
}

async function loadSetCards(setId, setName) {
  const cacheKey = setId || setName;
  if (SET_CARD_CACHE[cacheKey]) return SET_CARD_CACHE[cacheKey];

  const toCards = (data) => (data?.data || []).map(c => ({
    id: c.id, name: c.name, number: c.number,
    nameLower: c.name.toLowerCase().replace(/[^a-z0-9 ]/g,""),
    _full: c,
  }));

  const tryUrl = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return toCards(data);
    } catch { return null; }
  };

  const queries = [];

  // pokemontcg.io set ID (e.g. "sv8") — try directly
  if (setId && !/^\d+$/.test(setId)) {
    const q = encodeURIComponent(`set.id:${setId}`);
    queries.push(`/cards?q=${q}&orderBy=number&pageSize=250`);
  }

  // Name-based fallback (handles numeric TCGPlayer group IDs and MEO sets)
  if (setName) {
    const clean = setName.replace(/[^a-z0-9 ]/gi,"").trim();
    queries.push(`/cards?q=${encodeURIComponent(`set.name:"${clean}"`)}&orderBy=number&pageSize=250`);
    // Try first word wildcard too (e.g. "Chaos*" for "Chaos Rising")
    const first = clean.split(" ")[0];
    if (first.length > 3) {
      queries.push(`/cards?q=${encodeURIComponent(`set.name:${first}*`)}&orderBy=number&pageSize=250`);
    }
  }

  // Fetch from Scryfall
  const cards = await fetchSetCards(setId || "");
  if (cards.length > 0) {
    SET_CARD_CACHE[cacheKey] = cards;
    return cards;
  }

  console.warn(`[loadSetCards] 0 cards found for setId="${setId}" setName="${setName}"`);
  return [];
}
async function loadCollection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(_e) { return []; }
}
async function saveCollection(col) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(col)); } catch(_e) {}
  // Also sync to Firestore if signed in
  if (_firestoreSaveCollection) _firestoreSaveCollection(col).catch(() => {});
}

// Component-level Firestore sync — set by the App component
let _firestoreSaveCollection = null;
function registerFirestoreSave(fn) { _firestoreSaveCollection = fn; }

// ── Price extraction from Scryfall card object ───────────────────────────────
// Scryfall prices shape: { usd, usd_foil, eur, eur_foil, tix } — all string or null
function getScryfallPrice(card, foil = false) {
  const p = card?.prices || {};
  if (foil) {
    const val = parseFloat(p.usd_foil || p.eur_foil || 0);
    return val > 0 ? +val.toFixed(2) : null;
  }
  const val = parseFloat(p.usd || p.eur || 0);
  return val > 0 ? +val.toFixed(2) : null;
}

// getPrices — returns the price object shape the rest of the app expects.
// foil flag drives which Scryfall price field to use.
function getPrices(card, foil = false) {
  const nmPrice = getScryfallPrice(card, foil) || getScryfallPrice(card, false) || 0;
  const base = nmPrice;

  const raw = base > 0 ? {
    near_mint:        base,
    lightly_played:   +(base * COND_MULT.lightly_played).toFixed(2),
    moderately_played:+(base * COND_MULT.moderately_played).toFixed(2),
    heavily_played:   +(base * COND_MULT.heavily_played).toFixed(2),
    damaged:          +(base * COND_MULT.damaged).toFixed(2),
  } : { near_mint:0, lightly_played:0, moderately_played:0, heavily_played:0, damaged:0 };

  const graded = {
    "PSA 10": +(base * 4.2).toFixed(2),
    "PSA 9":  +(base * 2.1).toFixed(2),
    "PSA 8":  +(base * 1.4).toFixed(2),
    "BGS 9.5":+(base * 3.8).toFixed(2),
    "BGS 9":  +(base * 1.8).toFixed(2),
    "CGC 10": +(base * 3.5).toFixed(2),
    "CGC 9":  +(base * 1.7).toFixed(2),
  };

  const seed = (card?.id || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const storedSnaps = (() => {
    try { const raw = localStorage.getItem("price-history:" + card?.id); return raw ? JSON.parse(raw) : []; } catch(_e) { return []; }
  })();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const history = storedSnaps.length > 0
    ? storedSnaps.slice(-30).map(s => ({ label: (s.date||"").slice(5), price: s.price || 0 }))
    : months.map((label, i) => {
        const trend = 0.7 + (i / 11) * 0.35;
        const wave  = Math.sin((seed * 0.1) + i * 0.8) * 0.08;
        return { label, price: base > 0 ? +(base * (trend + wave)).toFixed(2) : 0 };
      });

  return {
    raw, graded,
    pop: {
      psa10: Math.floor((seed % 40) + 5),
      psa9:  Math.floor((seed % 120) + 30),
      total: Math.floor((seed % 300) + 80),
    },
    history,
    change30d: base > 0 ? +((Math.sin(seed) * 3) + 1).toFixed(2) : 0,
    changePct: base > 0 ? +((Math.sin(seed) * 4) + 1.5).toFixed(1) : 0,
    hasRealPrices: base > 0,
    scryfallUri: card?.scryfall_uri || null,
    priceSource: "Scryfall",
    usdFoil: getScryfallPrice(card, true),
    usdNonFoil: getScryfallPrice(card, false),
  };
}

function genPrices(cardOrId) {
  if (typeof cardOrId === "object" && cardOrId !== null) return getPrices(cardOrId);
  const s = String(cardOrId).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = (s % 80) + 5;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return {
    raw: { near_mint:base, lightly_played:+(base*.75).toFixed(2), moderately_played:+(base*.50).toFixed(2), heavily_played:+(base*.30).toFixed(2), damaged:+(base*.10).toFixed(2) },
    graded: { "PSA 10":+(base*4.2).toFixed(2),"PSA 9":+(base*2.1).toFixed(2),"PSA 8":+(base*1.4).toFixed(2),"BGS 9.5":+(base*3.8).toFixed(2),"BGS 9":+(base*1.8).toFixed(2),"CGC 10":+(base*3.5).toFixed(2),"CGC 9":+(base*1.7).toFixed(2) },
    pop: { psa10:Math.floor((s%40)+5), psa9:Math.floor((s%120)+30), total:Math.floor((s%300)+80) },
    history: months.map((label,i)=>({ label, price:+(base*(0.7+(i/11)*0.35+Math.sin((s*.1)+i*.8)*.08)).toFixed(2) })),
    change30d:+((Math.sin(s)*3)+1).toFixed(2), changePct:+((Math.sin(s)*4)+1.5).toFixed(1),
    hasRealPrices:false, scryfallUri:null,
  };
}

// ── Web price cache (persistent, so repeat scans don't re-fetch) ─────────────
const WEB_PRICE_CACHE_KEY    = "mtg_price_cache_v1";
const PRICES_REFRESHED_KEY   = "prices-last-refreshed";
const WEB_PRICE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getWebPriceCache() {
  try { return JSON.parse(localStorage.getItem(WEB_PRICE_CACHE_KEY) || "{}"); } catch(_e) { return {}; }
}
function setWebPriceCache(cardId, price) {
  if (!price || price <= 0) return;
  try {
    const cache = getWebPriceCache();
    cache[cardId] = { price, fetchedAt: Date.now() };
    localStorage.setItem(WEB_PRICE_CACHE_KEY, JSON.stringify(cache));
  } catch(_e) {}
}
function getCachedWebPrice(cardId) {
  const cache = getWebPriceCache();
  const entry = cache[cardId];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > WEB_PRICE_CACHE_TTL) return null;
  return entry.price;
}
function purgeBadPriceCache() {
  try {
    const cache = getWebPriceCache();
    const now = Date.now();
    let pruned = 0;
    for (const [k, v] of Object.entries(cache)) {
      if (!v.price || v.price <= 0 || (now - v.fetchedAt > WEB_PRICE_CACHE_TTL)) {
        delete cache[k]; pruned++;
      }
    }
    if (pruned) localStorage.setItem(WEB_PRICE_CACHE_KEY, JSON.stringify(cache));
  } catch(_e) {}
}

// Fetch fresh price for a card (Scryfall), uses cache
async function fetchTCGPlayerPrice(card, foil = false) {
  if (!card?.id) return null;
  const cacheKey = card.id + (foil ? "_foil" : "");
  const cached = getCachedWebPrice(cacheKey);
  if (cached !== null) return cached;

  const freshPrices = await fetchScryfallPrice(card);
  if (freshPrices) {
    const price = foil
      ? parseFloat(freshPrices.usd_foil || freshPrices.eur_foil || 0)
      : parseFloat(freshPrices.usd || freshPrices.eur || 0);
    if (price > 0) {
      setWebPriceCache(cacheKey, +price.toFixed(2));
      return +price.toFixed(2);
    }
  }
  return null;
}

// ── Price history storage (localStorage) ─────────────────────────────────────
const HISTORY_PREFIX = "price-history:";

// ── PriceCharting historical data ─────────────────────────────────────────────
// Sign up free at https://www.pricecharting.com/api
// Set VITE_PRICECHARTING_KEY in Cloudflare Pages environment variables
async function fetchPriceChartingHistory(cardName, setName) {
  if (!PRICECHARTING_KEY) return null;
  try {
    const q = encodeURIComponent([cardName, setName, "mtg", "magic the gathering"].filter(Boolean).join(" "));
    const res = await fetch(
      `https://www.pricecharting.com/api/products?q=${q}&key=${PRICECHARTING_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const products = data.products || [];
    if (!products.length) return null;

    // Find best match
    const best = products.find(p =>
      p.product_name?.toLowerCase().includes(cardName.toLowerCase())
    ) || products[0];

    // Fetch price history for this product
    const histRes = await fetch(
      `https://www.pricecharting.com/api/product?id=${best.id}&key=${PRICECHARTING_KEY}`
    );
    if (!histRes.ok) return null;
    const histData = await histRes.json();

    // PriceCharting returns loose-price, cib-price, new-price
    // Map their historical chart data if available
    const priceHistory = histData["price-data"] || histData.history || null;
    if (!priceHistory) {
      // No history — at least return current price as a single point
      const currentPrice = parseFloat(histData["loose-price"] || histData["new-price"] || 0) / 100;
      if (!currentPrice) return null;
      const today = new Date().toISOString().slice(0, 10);
      return [{ date: today, price: currentPrice }];
    }

    // Map to our snapshot format
    return priceHistory
      .filter(([, price]) => price > 0)
      .map(([dateStr, price]) => ({
        date: new Date(dateStr).toISOString().slice(0, 10),
        price: +(price / 100).toFixed(2), // PriceCharting stores cents
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

  } catch(_e) { return null; }
}

// ── Merge PriceCharting history with local snapshots ─────────────────────────
// PriceCharting fills the past, local snapshots fill today and going forward
function mergeHistory(pcHistory, localSnapshots) {
  if (!pcHistory?.length && !localSnapshots?.length) return null;
  const merged = {};
  (pcHistory || []).forEach(s => { merged[s.date] = s.price; });
  // Local snapshots win (more accurate, real-time)
  (localSnapshots || []).forEach(s => { merged[s.date] = s.price; });
  return Object.entries(merged)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }));
}



// ── Chart range filter (works with both daily snapshots and monthly estimates) ─
function getChartData(history, range) {
  if (!history || !history.length) return [];
  // If history has 'date' keys it's daily snapshots — convert via snapshotsToChartData
  if (history[0].date) {
    return snapshotsToChartData(history, range) || [];
  }
  // Legacy monthly format (label + price) — simple slice
  const counts = { "1D":1, "7D":7, "1M":30, "3M":90, "6M":180, "MAX":9999 };
  const days = counts[range] || 30;
  if (days >= 365 || range === "MAX") return history;
  const monthsNeeded = Math.ceil(days / 30);
  return history.slice(-Math.min(monthsNeeded, history.length));
}










// ── Custom SVG Icons ─────────────────────────────────────────────────────────
const Icon = {
  Tag: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M20.59 13.41L11 3.82A2 2 0 009.59 3.24L4 3a1 1 0 00-1 1l.24 5.59a2 2 0 00.58 1.41l9.59 9.59a2 2 0 002.83 0l4.35-4.35a2 2 0 000-2.83z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="7.5" cy="7.5" r="1.3" fill={color}/>
    </svg>
  ),
  Home: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M9 22V12h6v10" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  Search: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth="1.8"/>
      <path d="M15.5 15.5L21 21" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Camera: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="6" width="20" height="15" rx="2.5" stroke={color} strokeWidth="1.8"/>
      <circle cx="12" cy="13.5" r="4" stroke={color} strokeWidth="1.8"/>
      <path d="M8.5 6l1.5-3h4l1.5 3" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <circle cx="18.5" cy="9.5" r="1" fill={color}/>
    </svg>
  ),
  Portfolio: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="7" width="20" height="15" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
      <path d="M2 13h20" stroke={color} strokeWidth="1.8"/>
      <path d="M9 13v2m6-2v2" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Deck: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="1"   y="5" width="13" height="17" rx="2" stroke={color} strokeWidth="1.6" opacity="0.28"/>
      <rect x="4.5" y="3" width="13" height="17" rx="2" stroke={color} strokeWidth="1.6" opacity="0.58"/>
      <rect x="8"   y="1" width="13" height="17" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M10.5 5.5h8" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  Back: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 19l-7-7 7-7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Eye: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="10" ry="6" stroke={color} strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.8"/>
    </svg>
  ),
  EyeOff: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 3l18 18M10.5 10.5A3 3 0 0013.5 13.5" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M6.5 6.5C4.5 8 3 10 3 12c0 3.3 4 7 9 7a12 12 0 005.5-1.5M9 5.1A12 12 0 0112 5c5 0 9 3.7 9 7a7.4 7.4 0 01-2.5 4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  TrendUp: ({ size=16, color=TEAL }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 12l4-4 3 3 5-6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 5h4v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  TrendDown: ({ size=16, color="#ef4444" }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 5l4 4 3-3 5 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 11h4V7" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Trash: ({ size=20, color="#ef4444" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 11v5M14 11v5" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Star: ({ size=20, color="#fff", filled=false }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : "none"}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke={color} strokeWidth="1.8" strokeLinejoin="round"/>
    </svg>
  ),
  Bolt: ({ size=18, color=TEAL }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill={color+"33"}/>
    </svg>
  ),
  Cards: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="6" width="13" height="16" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M7 4a2 2 0 012-2h9a2 2 0 012 2v13" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Filter: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 6h18M7 12h10M11 18h2" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Close: ({ size=20, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M18 6L6 18M6 6l12 12" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  ChevronDown: ({ size=14, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Edit: ({ size=14, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Sparkle: ({ size=12, color="#f59e0b" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2z" fill={color}/>
    </svg>
  ),
  Warning: ({ size=14, color="#f97316" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Check: ({ size=16, color=TEAL }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 8l3.5 3.5L13 5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Upload: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M17 8l-5-5-5 5M12 3v12" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Capture: ({ size=64, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="30" stroke={TEAL} strokeWidth="2.5"/>
      <circle cx="32" cy="32" r="22" fill={color} opacity="0.9"/>
      <circle cx="32" cy="32" r="14" fill={color}/>
    </svg>
  ),

  Pack: ({ size=24, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="8" width="18" height="13" rx="2" stroke={color} strokeWidth="1.8"/>
      <path d="M3 11h18" stroke={color} strokeWidth="1.8"/>
      <path d="M8 8V6a4 4 0 018 0v2" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M10 15l1.5 1.5L14 13" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  Import: ({ size=22, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3v13M8 12l4 4 4-4" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  TCG: ({ size=22, color="#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="1.8"/>
      <path d="M7 8h10M7 12h7M7 16h5" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  ),
  Info: ({ size=16, color="#555" }) => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.4"/>
      <path d="M8 7v5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="8" cy="5" r="0.8" fill={color}/>
    </svg>
  ),
};

// ── Charts ───────────────────────────────────────────────────────────────────
function PortfolioChart({ data, color = TEAL }) {
  if (!data?.length) return null;
  const W = 360, H = 140, PX = 8, PY = 12;
  const vals = data.map(d => d.price || 0);
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => [
    PX + (n > 1 ? i / (n - 1) : 0.5) * (W - PX * 2),
    PY + ((max - v) / rng) * (H - PY * 2)
  ]).map(([x,y]) => [isNaN(x)?PX:x, isNaN(y)?H/2:y]);
  const poly = pts.map(p => p.join(",")).join(" ");
  const area = `${pts[0][0]},${H} ${poly} ${pts[pts.length-1][0]},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:H, display:"block" }}>
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#pg)"/>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function CardChart({ data, color = TEAL }) {
  if (!data?.length) return null;
  // Show single-point as a horizontal line with a dot
  if (data.length < 2) {
    const price = data[0]?.price || 0;
    return (
      <div style={{ textAlign:"center", padding:"8px 0" }}>
        <svg width="100%" height="40" viewBox="0 0 300 40">
          <line x1="20" y1="20" x2="280" y2="20" stroke={color} strokeWidth="1.5" strokeDasharray="4,4" opacity="0.3"/>
          <circle cx="150" cy="20" r="4" fill={color}/>
        </svg>
        <div style={{ color:"#444", fontSize:10 }}>Tap Refresh to load price history</div>
      </div>
    );
  }
  const W = 320, H = 110, PX = 6, PY = 8;
  const vals = data.map(d => d.price || 0);
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => [
    PX + (n > 1 ? i / (n - 1) : 0.5) * (W - PX * 2),
    PY + ((max - v) / rng) * (H - PY * 2)
  ]).map(([x,y]) => [isNaN(x)?PX:x, isNaN(y)?H/2:y]);
  const poly = pts.map(p => p.join(",")).join(" ");
  const area = `${pts[0][0]},${H} ${poly} ${pts[pts.length-1][0]},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:H, display:"block" }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#cg)"/>
      <polyline points={poly} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function Spark({ data, color = TEAL }) {
  if (!data?.length) return null;
  const W = 72, H = 24;
  const vals = data.map(d => d.price || 0);
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const n = vals.length;
  const pts = vals.map((v, i) => {
    const x = n > 1 ? (i / (n-1)) * W : W/2;
    const y = H - ((v-min)/rng)*(H-4)-2;
    return `${isNaN(x)?0:x},${isNaN(y)?H/2:y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display:"block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function RangeBar({ active, onChange }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-around", padding:"0 12px 12px" }}>
      {["1D","7D","1M","3M","6M","MAX"].map(r => (
        <button key={r} onClick={() => onChange(r)} style={{
          background: active===r ? "#fff" : "none", color: active===r ? "#000" : "#555",
          border:"none", borderRadius:20, padding:"7px 11px", fontFamily:"inherit",
          fontSize:12, fontWeight: active===r ? 700 : 400, cursor:"pointer", transition:"all 0.15s",
        }}>{r}</button>
      ))}
    </div>
  );
}

// ── Home View ─────────────────────────────────────────────────────────────────
function HomeView({ collection, boxes, onScanPress, onPriceCheckPress, onCardPress, setTabFromHome, onBrowseSet, onExportCSV, onExportBackup, fbUser, fbSyncing, onSignIn, onSignOut }) {
  const [showVal,      setShowVal]      = useState(true);
  const [newSets,      setNewSets]      = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeDecks,    setHomeDecks]    = useState([]);

  const activeCollection = collection.filter(i => !i.sold);
  const total    = activeCollection.reduce((s,i) => s + (genPrices(i.card).raw[i.condition] || 0), 0);
  const change30 = activeCollection.reduce((s,i) => s + genPrices(i.card).change30d, 0);
  const topCards = [...collection]
    .filter(i => !i.sold)
    .sort((a,b) => genPrices(b.card).raw[b.condition] - genPrices(a.card).raw[a.condition])
    .slice(0, 20);
  const up = change30 >= 0;

  // Hardcoded ME sets not yet in the pokemontcg API
  // MTG sets come entirely from Scryfall — no seed needed

  // Fetch recent sets from Scryfall, then fetch one card art per set
  useEffect(() => {
    const cached = sessionStorage.getItem("home_sets_mtg_v7");
    if (cached) { try { setNewSets(JSON.parse(cached)); return; } catch(_e) {} }
    scryfallFetch("/sets?order=released&direction=desc").then(async data => {
      const HOME_TYPES = [...MTG_MAIN_SET_TYPES, "commander", "commander_deck"];
      const seenNames = new Set();
      const raw = (data?.data || [])
        .filter(s => {
          if (s.digital || s.card_count < 10 || !s.released_at) return false;
          // Skip variant/promo sets — Scryfall marks these with a parent_set_code
          if (s.parent_set_code) return false;
          if (!HOME_TYPES.includes(s.set_type)) return false;
          if (seenNames.has(s.name)) return false;
          seenNames.add(s.name);
          return true;
        })
        .slice(0, 6)
        .map(s => ({ id:s.code, name:s.name, symbol:s.icon_svg_uri,
          releaseDate:s.released_at, total:s.card_count, series:s.set_type }));
      setNewSets(raw);
      sessionStorage.setItem("home_sets_mtg_v7", JSON.stringify(raw));
    }).catch(() => {});
  }, []);

  // Load decks from localStorage for the Best Decks widget
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("mtg-decks-v1") || "[]");
      const sorted = [...raw].sort((a, b) => {
        const val = d => (d.cards||[]).reduce((s,c)=>s+((c.foil?c.card?.prices?.usd_foil:c.card?.prices?.usd)||c.card?.prices?.usd||0)*(c.qty||1),0);
        return val(b) - val(a);
      });
      setHomeDecks(sorted.slice(0, 4));
    } catch { setHomeDecks([]); }
  }, []);

  return (
    <div style={{ height:"100%", overflowY:"auto", display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ color:"#555", fontSize:12, letterSpacing:0.3 }}>Portfolio · Main</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:4 }}>
            <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:38, color:"#fff", letterSpacing:1 }}>
              {showVal ? fmtCompact(total) : "••••••"}
            </span>
            <button onClick={() => setShowVal(v => !v)} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
              {showVal ? <Icon.Eye size={18} color="#555"/> : <Icon.EyeOff size={18} color="#555"/>}
            </button>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
            {up ? <Icon.TrendUp size={14}/> : <Icon.TrendDown size={14}/>}
            <span style={{ color: up ? TEAL : "#ef4444", fontSize:13 }}>
              {up ? "+" : ""}{change30.toFixed(2)} in the last 30 days
            </span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {/* Firebase sign-in status — always visible */}
          {isFirebaseConfigured() && (
            fbUser ? (
              <button onClick={() => setSettingsOpen(true)}
                style={{ background:"#0d1f19", border:`1px solid ${TEAL}44`,
                  borderRadius:20, padding:"6px 12px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:6 }}>
                {fbSyncing
                  ? <div style={{ width:8, height:8, border:`2px solid ${TEAL}`, borderTopColor:"transparent",
                      borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
                  : <div style={{ width:8, height:8, borderRadius:"50%", background:TEAL }}/>
                }
                <span style={{ color:TEAL, fontSize:11, fontWeight:700 }}>
                  {fbUser.displayName?.split(" ")[0] || "Synced"}
                </span>
              </button>
            ) : (
              <button onClick={onSignIn}
                style={{ background:"#111", border:`1px solid #333`,
                  borderRadius:20, padding:"6px 12px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                </svg>
                <span style={{ color:"#666", fontSize:11 }}>Sign in</span>
              </button>
            )
          )}
          {/* Settings gear */}
          <button onClick={() => setSettingsOpen(true)}
            style={{ background:"#111", border:`1px solid ${BORDER}`, borderRadius:20,
              padding:"10px 12px", cursor:"pointer", display:"flex", alignItems:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <button onClick={onPriceCheckPress} style={{ background:"#1a1a1a", border:`1px solid ${TEAL}66`, borderRadius:20,
            padding:"10px 16px", fontFamily:"'Bebas Neue',sans-serif", fontSize:13,
            letterSpacing:0.5, color:TEAL, cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
            <Icon.Tag size={15} color={TEAL}/> PRICE CHECK
          </button>
        </div>

        {/* Settings drawer */}
        {settingsOpen && (
          <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.7)" }}
            onClick={() => setSettingsOpen(false)}>
            <div style={{ position:"absolute", top:0, right:0, width:260,
              height:"100%", background:"#111", borderLeft:`1px solid ${BORDER}`,
              display:"flex", flexDirection:"column", paddingTop:"calc(env(safe-area-inset-top,0px) + 16px)" }}
              onClick={e => e.stopPropagation()}>
              <div style={{ padding:"0 20px 16px", borderBottom:`1px solid ${BORDER}` }}>
                <div style={{ color:"#fff", fontSize:16, fontWeight:700 }}>Settings</div>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"8px 0" }}>

                {/* Account section */}
                {isFirebaseConfigured() && (
                  <div style={{ padding:"12px 20px", borderBottom:`1px solid ${BORDER}` }}>
                    <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:10 }}>ACCOUNT</div>
                    {fbUser ? (
                      <>
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                          {fbUser.photoURL
                            ? <img src={fbUser.photoURL} style={{ width:32, height:32, borderRadius:"50%" }}/>
                            : <div style={{ width:32, height:32, borderRadius:"50%", background:TEAL,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                color:"#000", fontSize:14, fontWeight:700 }}>
                                {fbUser.displayName?.[0] || "?"}
                              </div>
                          }
                          <div>
                            <div style={{ color:"#fff", fontSize:13, fontWeight:600 }}>{fbUser.displayName}</div>
                            <div style={{ color:"#555", fontSize:11 }}>{fbUser.email}</div>
                          </div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                          <div style={{ width:6, height:6, borderRadius:"50%", background:TEAL }}/>
                          <span style={{ color:TEAL, fontSize:11 }}>Synced to Firebase</span>
                        </div>
                        <button onClick={() => { onSignOut(); setSettingsOpen(false); }}
                          style={{ marginTop:10, width:"100%", padding:"8px 0", background:"none",
                            border:`1px solid ${BORDER}`, borderRadius:10, color:"#666",
                            fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                          Sign Out
                        </button>
                      </>
                    ) : (
                      <button onClick={() => { onSignIn(); setSettingsOpen(false); }}
                        style={{ width:"100%", padding:"10px 0", background:TEAL, border:"none",
                          borderRadius:10, color:"#000", fontSize:13, fontWeight:700,
                          cursor:"pointer", fontFamily:"inherit" }}>
                        Sign in with Google
                      </button>
                    )}
                  </div>
                )}

                {/* Data section */}
                <div style={{ padding:"12px 20px", borderBottom:`1px solid ${BORDER}` }}>
                  <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:10 }}>DATA</div>
                  {[
                    { label:"Export CSV", sub:"Spreadsheet of your collection", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>, action: () => { onExportCSV(); setSettingsOpen(false); } },
                    { label:"Full Backup", sub:"JSON export of everything", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, action: () => { onExportBackup(); setSettingsOpen(false); } },
                  ].map(({ label, sub, icon, action }) => (
                    <button key={label} onClick={action}
                      style={{ width:"100%", display:"flex", alignItems:"center", gap:12,
                        padding:"10px 0", background:"none", border:"none", cursor:"pointer",
                        borderBottom:`1px solid ${BORDER}`, textAlign:"left", fontFamily:"inherit" }}>
                      <div style={{ width:32, height:32, background:"#1a1a1a", borderRadius:8,
                        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        {icon}
                      </div>
                      <div>
                        <div style={{ color:"#fff", fontSize:13 }}>{label}</div>
                        <div style={{ color:"#555", fontSize:11 }}>{sub}</div>
                      </div>
                    </button>
                  ))}
                </div>

              </div>
              <div style={{ padding:"16px 20px", paddingBottom:"calc(16px + env(safe-area-inset-bottom,0px))" }}>
                <button onClick={() => setSettingsOpen(false)}
                  style={{ width:"100%", padding:"12px 0", background:"#1a1a1a",
                    border:`1px solid ${BORDER}`, borderRadius:12, color:"#888",
                    fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Sets */}
      <div style={{ margin:"16px 0 0" }}>
        <div style={{ padding:"0 20px 10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontWeight:700, fontSize:15, color:"#fff" }}>New Sets</div>
          <span style={{ color:"#555", fontSize:11 }}>Latest releases</span>
        </div>
        <div style={{ display:"flex", gap:10, overflowX:"auto", padding:"0 20px 4px",
          scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
          {newSets.length === 0 && [1,2,3,4].map(i => (
            <div key={i} style={{ flexShrink:0, width:130, height:100, background:CARD,
              borderRadius:12, border:`1px solid ${BORDER}` }}/>
          ))}
          {newSets.map(set => {
            const today = new Date().toISOString().slice(0,10);
            const relDate = (set.releaseDate||"").replace(/\//g,"-");
            const isUpcoming = relDate > today;
            const thirtyAgo = new Date(Date.now()-30*864e5).toISOString().slice(0,10);
            const isNew = !isUpcoming && relDate >= thirtyAgo;
            return (
              <div key={set.id} onClick={() => onBrowseSet && onBrowseSet(set)}
                style={{ flexShrink:0, width:130, background:CARD, border:`1px solid ${isNew?TEAL+"44":BORDER}`,
                  borderRadius:12, overflow:"hidden", cursor:"pointer", position:"relative" }}>
                {/* Card art banner */}
                <div style={{ width:"100%", height:72, background:"#1a1a1a", overflow:"hidden", position:"relative" }}>
                  {set.symbol && (
                    <img src={set.symbol} alt={set.name} style={{
                      width:44, height:44, objectFit:"contain",
                      position:"absolute", top:"50%", left:"50%",
                      transform:"translate(-50%,-50%)",
                      filter:"brightness(0) invert(0.55)",
                    }}/>
                  )}
                </div>
                {/* Name + date */}
                <div style={{ padding:"6px 8px 8px" }}>
                  <div style={{ color:"#fff", fontSize:10, fontWeight:600, lineHeight:1.2,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{set.name}</div>
                  <div style={{ color:"#555", fontSize:9, marginTop:2 }}>{set.releaseDate}</div>
                </div>
                {(isNew || isUpcoming) && (
                  <div style={{ position:"absolute", top:6, right:6, background: isUpcoming?"#7c3aed":TEAL,
                    borderRadius:4, padding:"1px 5px", fontSize:8, color: isUpcoming?"#fff":"#000", fontWeight:700 }}>
                    {isUpcoming ? "SOON" : "NEW"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Best Decks */}
      <div style={{ margin:"16px 20px 0" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div style={{ fontWeight:700, fontSize:15, color:"#fff" }}>Best Decks</div>
          <span onClick={() => setTabFromHome("decks")}
            style={{ color:TEAL, fontSize:11, cursor:"pointer" }}>See all →</span>
        </div>
        {homeDecks.length === 0
          ? <div onClick={() => setTabFromHome("decks")}
              style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12,
                padding:"18px 16px", textAlign:"center", cursor:"pointer" }}>
              <div style={{ color:"#555", fontSize:13 }}>No decks yet</div>
              <div style={{ color:TEAL, fontSize:12, marginTop:4 }}>Build your first deck →</div>
            </div>
          : <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {homeDecks.map(deck => {
                const value = (deck.cards||[]).reduce((s,c)=>s+((+(c.foil?c.card?.prices?.usd_foil:null)||+c.card?.prices?.usd||0)*(c.qty||1)),0);
                const wins   = deck.record?.wins   || 0;
                const losses = deck.record?.losses || 0;
                const games  = wins + losses + (deck.record?.draws||0);
                const winPct = games > 0 ? Math.round((wins/games)*100) : null;
                const col = { commander:"#a855f7", modern:"#f59e0b", standard:"#3b82f6",
                  pioneer:"#06b6d4", legacy:"#ef4444", vintage:"#f97316",
                  pauper:"#6b7280", brawl:"#8b5cf6", draft:"#10b981", casual:"#6b7280",
                  oathbreaker:"#ec4899" }[deck.format] || "#6b7280";
                return (
                  <button key={deck.id} onClick={() => setTabFromHome("decks")}
                    style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12,
                      padding:"10px 12px", textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
                    <div style={{ color:"#fff", fontSize:12, fontWeight:700,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{deck.name}</div>
                    <div style={{ color:col, fontSize:9, marginTop:2, textTransform:"uppercase",
                      letterSpacing:0.5 }}>{deck.format}</div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
                      <div style={{ color:TEAL, fontSize:12, fontWeight:700 }}>
                        {value > 0 ? `$${value >= 1000 ? (value/1000).toFixed(1)+"k" : value.toFixed(0)}` : "—"}
                      </div>
                      {winPct !== null
                        ? <div style={{ color:"#888", fontSize:9 }}>{wins}–{losses} ({winPct}%)</div>
                        : <div style={{ color:"#444", fontSize:9 }}>{(deck.cards||[]).reduce((s,c)=>s+(c.qty||1),0)} cards</div>}
                    </div>
                  </button>
                );
              })}
            </div>
        }
      </div>

      {/* Most Valuable */}
      {topCards.length > 0 && (
        <div style={{ margin:"16px 20px 20px", background:CARD, border:`1px solid ${BORDER}`, borderRadius:20, overflow:"hidden" }}>
          <div style={{ padding:"16px 18px 12px", fontWeight:700, fontSize:15, color:"#fff" }}>Most Valuable</div>
          <div style={{ overflowY:"auto", maxHeight:340 }}>
          {topCards.filter(item => (genPrices(item.card).raw[item.condition] || 0) > 0).map((item, idx) => {
            const p = genPrices(item.card);
            const val = p.raw[item.condition] || 0;
            const pct = p.changePct || 0;
            const isUp = pct >= 0;
            return (
              <div key={item.id} onClick={() => onCardPress(item)}
                style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 18px",
                  borderTop:`1px solid ${BORDER}`, cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = "#1a1a1a"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <img src={item.card.images?.small} alt={item.card.name} loading="lazy"
                  style={{ width:34, height:48, objectFit:"contain", borderRadius:3 }}/>
                <div style={{ flex:1 }}>
                  <div style={{ color:"#fff", fontSize:14, fontWeight:600 }}>{item.card.name}</div>
                  <div style={{ color:"#555", fontSize:11 }}>{condLabels[item.condition]}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ color:"#fff", fontSize:15, fontWeight:600 }}>${val.toFixed(2)}</div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4 }}>
                    {isUp ? <Icon.TrendUp size={12}/> : <Icon.TrendDown size={12}/>}
                    <span style={{ color: isUp ? TEAL : "#ef4444", fontSize:11 }}>{pct}%</span>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          {collection.length > 20 && (
            <div onClick={() => setTabFromHome && setTabFromHome("collection")}
              style={{ padding:"14px", textAlign:"center", borderTop:`1px solid ${BORDER}`, cursor:"pointer" }}>
              <span style={{ color:TEAL, fontSize:13 }}>View All ({collection.length})</span>
            </div>
          )}
        </div>
      )}

      {collection.length === 0 && (
        <div style={{ textAlign:"center", padding:"48px 20px", color:"#333" }}>
          <Icon.Cards size={44} color="#222"/>
          <div style={{ marginTop:14, fontSize:15, color:"#444" }}>No cards yet</div>
          <div style={{ marginTop:6, fontSize:12, color:"#333" }}>Tap SCAN to add your first card</div>
        </div>
      )}
      <div style={{ height:24 }}/>
    </div>
  );
}

// ── Card Detail View ──────────────────────────────────────────────────────────
// ── Add User Tag Button ───────────────────────────────────────────────────────
function AddUserTagButton({ existingTags, onAdd }) {
  const [open, setOpen]       = React.useState(false);
  const [input, setInput]     = React.useState("");
  const inputRef              = React.useRef(null);

  React.useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const submit = (val) => {
    const tag = val.trim().toLowerCase().replace(/\s+/g,"-");
    if (!tag || existingTags.includes(tag)) return;
    onAdd(tag);
    setInput(""); setOpen(false);
  };

  if (!open) return (
    <button onClick={()=>setOpen(true)} style={{
      background:"#1a1a1a", border:"1px dashed #333", borderRadius:10,
      color:"#555", padding:"3px 9px", fontSize:11, cursor:"pointer", flexShrink:0,
    }}>+ tag</button>
  );

  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter") submit(input); if(e.key==="Escape"){setOpen(false);setInput("");} }}
        placeholder="tag name…"
        style={{ background:"#1a1a1a", border:`1px solid ${TEAL}44`, borderRadius:8,
          color:"#fff", padding:"3px 8px", fontSize:11, outline:"none",
          fontFamily:"inherit", width:90 }}/>
      <button onClick={()=>submit(input)} style={{
        background:TEAL+"22", border:`1px solid ${TEAL}44`, borderRadius:8,
        color:TEAL, fontSize:11, padding:"3px 7px", cursor:"pointer", flexShrink:0 }}>✓</button>
      <button onClick={()=>{setOpen(false);setInput("");}} style={{
        background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:13 }}>✕</button>
    </div>
  );
}

function CardDetailView({ item, onBack, onRemove, onMarkSold, onUpdateCard, tradeList=[], onToggleTrade, boxes=[], collection=[] }) {
  const [tab, setTab]               = useState("raw");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [chartRange, setChartRange] = useState("1M");
  const [showSellModal, setShowSellModal]     = useState(false);
  const [showCondModal, setShowCondModal]     = useState(false);
  const [ebayHistory, setEbayHistory]         = useState(null);
  const [freshCard, setFreshCard]             = useState(null);
  const [priceLoading, setPriceLoading]       = useState(true);
  const [sellPrice, setSellPrice]             = useState("");

  const { condition } = item;
  const card = freshCard || item.card;
  // Show the image immediately if we already have one (instant load) — only show
  // a spinner placeholder when there's truly no image at all yet. Previously this
  // waited for the verified API refetch before showing ANY image, even when we
  // already had a perfectly good cached one, causing a multi-second blank screen
  // on every single card open.
  const imageReady = !!(card.images?.large || card.images?.small);

  const saveFreshCard = (fresh) => {
    setFreshCard(fresh);
    if (onUpdateCard) onUpdateCard({ ...item, card: fresh });
  };

  useEffect(() => {
    // Check if we already have a valid non-zero price
    const existingPrices = item.card?.tcgplayer?.prices;
    const hasValidPrice = existingPrices && Object.keys(existingPrices).length > 0 &&
      Object.values(existingPrices).some(v => (v?.market || v?.mid || 0) > 0);
    // Also check if we have a valid image (meta cards may have wrong/missing images)
    const hasValidImage = !!(item.card?.images?.large || item.card?.images?.small);
    // Cards from the global scan index meta are unverified — they may have
    // mismatched name/image/price data due to index corruption. Only trust
    // cards that have been explicitly validated via a real API fetch
    // (marked by _verified) or that came from a normal search/pack-scan flow
    // (which always uses real pokemontcg.io data, never raw meta).
    const isVerified = item.card?._verified === true || !!item.card?.tcgplayer?._priceSource;

    // Skip fetch only if data is both present AND verified
    if (hasValidPrice && hasValidImage && isVerified) {
      recordPriceSnapshot(item.card);
      setPriceLoading(false);
      // Load and merge with shared Firestore price history
      loadAndMergePriceHistory(item.card.id).then(snaps => {
        if (snaps.length) setEbayHistory(snaps);
      });
      return;
    }

    // Fetch fresh from Scryfall
    scryfallFetch(`/cards/${item.card.id}`)
      .then(async (fresh) => {
        const merged = fresh ? normalizeScryfallCard(fresh) : item.card;
        merged._verified = true;

        const price = parseFloat(merged.prices?.usd || merged.prices?.usd_foil || 0);
        if (price > 0) {
          saveFreshCard(merged);
          recordPriceSnapshot(merged);
          const snaps = loadPriceHistory(merged.id);
          if (snaps.length) setEbayHistory(snaps);
        } else {
          recordPriceSnapshot(merged);
          const snaps = loadPriceHistory(merged.id);
          if (snaps.length) setEbayHistory(snaps);
        }
        setPriceLoading(false);
      }).catch(() => { recordPriceSnapshot(item.card); setPriceLoading(false); });

    const localSnaps = loadPriceHistory(item.card.id);
    if (localSnaps.length) setEbayHistory(localSnaps);
  }, [item.card.id]);

  const prices = getPrices(card);
  const val = prices.raw[condition] || 0;
  const isSold = item.sold;
  const paid = item.costPaid;
  const currentVal = isSold ? item.soldPrice : val;
  const pnl = paid != null ? +(currentVal - paid).toFixed(2) : null;
  const pnlPct = paid != null && paid > 0 ? +((pnl / paid) * 100).toFixed(1) : null;
  const isGain = pnl >= 0;

  const chartSnaps = ebayHistory || [];
  const chartData = getChartData(chartSnaps, chartRange);

  return (
    <div style={{ height:"100%", overflowY:"auto", background:BG }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"14px 20px", position:"sticky", top:0, background:BG, zIndex:10,
        borderBottom:`1px solid ${BORDER}` }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
          <Icon.Back size={24} color="#fff"/>
        </button>
        {!item.preview && (
          <button onClick={() => setShowDeleteConfirm(true)}
            style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
            <Icon.Trash size={20} color="#ef4444"/>
          </button>
        )}
      </div>

      {/* Sold banner */}
      {isSold && (
        <div style={{ margin:"0 20px", background:"#1a1000", border:"1px solid #3d2d00",
          borderRadius:14, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ color:"#f59e0b", fontSize:12, fontWeight:700, letterSpacing:0.5 }}>SOLD</div>
            <div style={{ color:"#888", fontSize:11, marginTop:2 }}>
              {new Date(item.soldAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#f59e0b", letterSpacing:1 }}>
              ${item.soldPrice?.toFixed(2)}
            </div>
            <div style={{ color:"#555", fontSize:11 }}>sale price</div>
          </div>
        </div>
      )}

      {/* Card image */}
      <div style={{ display:"flex", justifyContent:"center", padding:"20px 0 10px",
        background:`radial-gradient(ellipse at center, ${isSold?"#1a1000":"#0a1f18"} 0%, ${BG} 70%)` }}>
        <div style={{ position:"relative" }}>
          <div style={{ position:"absolute", inset:-10,
            background:`radial-gradient(circle, ${isSold?"#f59e0b28":TEAL+"28"}, transparent 70%)`,
            borderRadius:24 }}/>
          {imageReady ? (
            <img src={card.images?.large || card.images?.small} alt={card.name}
              style={{ height:280, borderRadius:14, position:"relative",
                boxShadow:"0 14px 40px rgba(0,0,0,0.7)",
                filter: isSold ? "grayscale(0.4)" : "none" }}/>
          ) : (
            <div style={{ height:280, width:200, borderRadius:14, position:"relative",
              background:"#1a1a1a", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ width:32, height:32, borderRadius:"50%", border:`3px solid ${TEAL}`,
                borderTopColor:"transparent", animation:"spin 0.8s linear infinite" }}/>
            </div>
          )}
        </div>
      </div>

      {/* Card info */}
      <div style={{ padding:"20px 20px 0" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:30, color:"#fff", letterSpacing:1 }}>
              {card.name}
            </div>
            <div style={{ color: isSold ? "#f59e0b" : TEAL, fontSize:13, marginTop:2 }}>
              MTG · {card.set?.name}
            </div>
            <div style={{ color:"#555", fontSize:12 }}>{card.rarity} · {card.number}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:30,
              color: isSold ? "#555" : "#fff", letterSpacing:1 }}>
              {priceLoading ? <span style={{ fontSize:14, color:"#555" }}>Loading...</span> : fmt(val)}
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4, marginTop:2 }}>
              {prices.changePct >= 0 ? <Icon.TrendUp size={14}/> : <Icon.TrendDown size={14}/>}
              <span style={{ color: prices.changePct >= 0 ? TEAL : "#ef4444", fontSize:12 }}>
                ${prices.change30d} ({prices.changePct}%)
              </span>
            </div>
          </div>
        </div>

        {/* Tags — auto + user */}
        <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          {/* Condition button */}
          <button onClick={() => setShowCondModal(true)} style={{
            background: condColors[condition] + "22", color: condColors[condition],
            border:`1px solid ${condColors[condition]}44`, borderRadius:10,
            padding:"3px 10px", fontSize:11, fontWeight:700, cursor:"pointer",
            display:"flex", alignItems:"center", gap:4 }}>
            {condLabels[condition]} <Icon.Edit size={10} color={condColors[condition]}/>
          </button>
          {item.acqType && (
            <span style={{ background:"#1a1a1a", color:"#666", borderRadius:10, padding:"3px 10px", fontSize:11 }}>
              {{bought:"Purchased", pack:"Pack Pull", scan:"Scanned"}[item.acqType] || item.acqType}
              {item.packName ? ` · ${item.packName}` : ""}
            </span>
          )}

          {/* Auto tags — show non-verbose cats */}
          {(item.autoTags || computeAutoTags(card)).filter(t => {
            const meta = getTagMeta(t);
            return !HIDDEN_BY_DEFAULT_CATS.has(meta.cat);
          }).map(t => <TagChip key={t} tag={t} size="sm"/>)}

          {/* User tags */}
          {(item.userTags || []).map(t => (
            <TagChip key={t} tag={t} size="sm"
              onRemove={tag => {
                const updated = { ...item, userTags:(item.userTags||[]).filter(u=>u!==tag) };
                onUpdateCard(updated);
              }}/>
          ))}

          {/* Add tag button */}
          <AddUserTagButton
            existingTags={item.userTags || []}
            onAdd={tag => {
              const updated = { ...item, userTags:[...(item.userTags||[]), tag] };
              onUpdateCard(updated);
            }}
          />
        </div>

        {/* Change condition modal */}
        {showCondModal && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:400,
            display:"flex", alignItems:"flex-end", justifyContent:"center" }}
            onClick={() => setShowCondModal(false)}>
            <div onClick={e => e.stopPropagation()} style={{ background:"#111", borderRadius:"24px 24px 0 0",
              width:"100%", maxWidth:500, padding:"24px 24px 40px" }}>
              <div style={{ width:40, height:4, background:"#333", borderRadius:2, margin:"0 auto 20px" }}/>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff",
                letterSpacing:1, marginBottom:16 }}>CHANGE CONDITION</div>
              {["near_mint","lightly_played","moderately_played","heavily_played","damaged"].map(key => { const label = condLabels[key]; return (
                <button key={key} onClick={() => { onUpdateCard && onUpdateCard({...item, condition:key}); setShowCondModal(false); }}
                  style={{ width:"100%", padding:"14px 18px", marginBottom:8,
                    background: key===condition ? condColors[key]+"22" : "#1a1a1a",
                    border:`1px solid ${key===condition ? condColors[key]+"66" : BORDER}`,
                    borderRadius:14, cursor:"pointer", fontFamily:"inherit",
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color: key===condition ? condColors[key] : "#ccc", fontSize:14 }}>{label}</span>
                  {key === condition && <span style={{ color:condColors[key], fontSize:16 }}>✓</span>}
                </button>
              ); })}
            </div>
          </div>
        )}
      </div>

      {/* P&L */}
      {paid != null && (
        <div style={{ margin:"16px 20px 0", background: isGain ? "#0a1f10" : "#1a0a0a",
          border:`1px solid ${isGain ? "#1a3d20" : "#3d1a1a"}`, borderRadius:16, padding:"14px 18px" }}>
          <div style={{ color:"#666", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>
            {isSold ? "TRADE SUMMARY" : "COST BASIS & RETURN"}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
            <div>
              <div style={{ color:"#555", fontSize:10 }}>{item.acqType === "pack" ? "Pack Cost" : "Paid"}</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#ccc", letterSpacing:1 }}>
                ${paid.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ color:"#555", fontSize:10 }}>{isSold ? "Sold For" : "Current"}</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#ccc", letterSpacing:1 }}>
                ${currentVal.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ color:"#555", fontSize:10 }}>P&L</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20,
                color: isGain ? TEAL : "#ef4444", letterSpacing:1 }}>
                {isGain ? "+" : ""}{pnl}
              </div>
              {pnlPct != null && (
                <div style={{ color: isGain ? TEAL : "#ef4444", fontSize:10 }}>
                  {isGain ? "+" : ""}{pnlPct}%
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Trade & sell values */}
      {currentVal > 0 && !isSold && (
        <div style={{ margin:"12px 20px 0", background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:"14px 18px" }}>
          <div style={{ color:"#666", fontSize:11, letterSpacing:0.5, marginBottom:12 }}>TRADE-IN VALUES</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {[
              { label:"Store Credit (70%)", pct:0.70 },
              { label:"Cash (60%)",          pct:0.60 },
            ].map(({ label, pct }) => {
              const tradeVal = +(currentVal * pct).toFixed(2);
              const tradePnl = paid != null ? +(tradeVal - paid).toFixed(2) : null;
              const isUp = tradePnl != null && tradePnl >= 0;
              return (
                <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div>
                    <div style={{ color:"#888", fontSize:12 }}>{label}</div>
                    {tradePnl != null && (
                      <div style={{ color: isUp ? TEAL : "#ef4444", fontSize:11, marginTop:2 }}>
                        {isUp ? "+" : ""}{fmt(tradePnl)} vs cost
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22,
                    color: isUp ? TEAL : "#ef4444", letterSpacing:0.5 }}>
                    {fmt(tradeVal)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isSold && !item.preview && (
        <div style={{ padding:"16px 20px 0", display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={() => setShowSellModal(true)} style={{ display:"flex", alignItems:"center", gap:8,
            background:"none", border:"1px solid #3d2d00", borderRadius:24,
            padding:"10px 18px", color:"#f59e0b", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
            <Icon.TrendDown size={16} color="#f59e0b"/> Mark as Sold
          </button>
          <button onClick={() => onToggleTrade && onToggleTrade(item.id)} style={{
            display:"flex", alignItems:"center", gap:8, background:"none",
            border:`1px solid ${tradeList.includes(item.id) ? TEAL : BORDER}`,
            borderRadius:24, padding:"10px 18px",
            color: tradeList.includes(item.id) ? TEAL : "#888",
            fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={tradeList.includes(item.id) ? TEAL : "#888"} strokeWidth="2.5">
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
            </svg>
            {tradeList.includes(item.id) ? "In Trade List" : "Add to Trade"}
          </button>
        </div>
      )}
      <div style={{ padding:"12px 20px 0" }}>
        <button onClick={() => {
          const q = encodeURIComponent(card.name + " " + (card.set?.name || "") + " " + (card.number || "") + " mtg card");
          window.open(`https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`, "_blank");
        }} style={{ display:"flex", alignItems:"center", gap:8, background:"none",
          border:`1px solid ${BORDER}`, borderRadius:24, padding:"10px 18px",
          color:"#ccc", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          <Icon.Search size={16} color="#888"/> eBay Sold Listings
        </button>
      </div>

      {/* Sell Calculator — only for cards from pack openings */}
      {!isSold && !item.preview && item.boxId && (() => {
        // Find the box this card came from
        const sourceBox = boxes.find(b => b.id === item.boxId);
        if (!sourceBox) return null;

        // Box-level P&L
        const allPackedCards = collection.filter(c => c.boxId === item.boxId);
        const boxTotalVal = allPackedCards.reduce((s, c) =>
          s + (genPrices(c.card).raw[c.condition] || 0), 0);
        const boxPnl = boxTotalVal - sourceBox.pricePaid;

        // What happens if we sell this card at current value
        const cardVal = val;
        const boxPnlAfterSale = (boxTotalVal - cardVal) - sourceBox.pricePaid;

        const boxPnlColor = boxPnl >= 0 ? TEAL : "#ef4444";
        const afterColor  = boxPnlAfterSale >= 0 ? TEAL : "#ef4444";

        return (
          <div style={{ margin:"14px 20px 0", background:CARD, border:`1px solid ${BORDER}`,
            borderRadius:16, padding:"14px 16px" }}>
            <div style={{ color:"#888", fontSize:11, fontWeight:700, letterSpacing:0.5, marginBottom:12 }}>
              SELL IMPACT CALCULATOR
            </div>
            <div style={{ color:"#555", fontSize:11, marginBottom:10 }}>
              From: {sourceBox.setName} · {PRODUCT_TYPES.find(t=>t.id===sourceBox.productType)?.label || sourceBox.productType}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
              <div style={{ background:BG, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ color:"#555", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>BOX P&L NOW</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:boxPnlColor, letterSpacing:1 }}>
                  {boxPnl>=0?"+":""}{fmt(boxPnl)}
                </div>
                <div style={{ color:"#444", fontSize:10 }}>{fmt(boxTotalVal)} pulled</div>
              </div>
              <div style={{ background:BG, borderRadius:10, padding:"10px 12px" }}>
                <div style={{ color:"#555", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>IF YOU SELL THIS</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:afterColor, letterSpacing:1 }}>
                  {boxPnlAfterSale>=0?"+":""}{fmt(boxPnlAfterSale)}
                </div>
                <div style={{ color:"#444", fontSize:10 }}>box P&L after sale</div>
              </div>
            </div>
            {/* Net gain from selling */}
            {cardVal > 0 && (
              <div style={{ padding:"10px 12px", borderRadius:10,
                background: cardVal + boxPnl - boxPnlAfterSale >= 0 ? "#0d1f19" : "#1a0808",
                border:`1px solid ${cardVal >= 0 ? TEAL+"44" : "#3d1a1a"}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color:"#888", fontSize:12 }}>You pocket</span>
                  <span style={{ color:TEAL, fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1 }}>
                    {fmt(cardVal)}
                  </span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:4 }}>
                  <span style={{ color:"#555", fontSize:11 }}>Remaining cards stay in portfolio</span>
                  <span style={{ color:"#555", fontSize:11 }}>{allPackedCards.length - 1} cards · {fmt(boxTotalVal - cardVal)}</span>
                </div>
              </div>
            )}
          </div>
        );
      })()}


      

      {/* Tabs */}
      <div style={{ display:"flex", margin:"18px 20px 0", background:"#1a1a1a", borderRadius:14, padding:4, gap:3 }}>
        {["raw","graded","pop"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex:1, padding:"10px 0",
            background: tab===t ? "#fff" : "transparent", color: tab===t ? "#000" : "#555",
            border:"none", borderRadius:10, fontFamily:"'Bebas Neue',sans-serif",
            fontSize:14, letterSpacing:1, cursor:"pointer", transition:"all 0.2s" }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ padding:"16px 20px 0" }}>
        {tab === "raw" && (
          <>
            {/* Price chart */}
            <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:"14px", marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ color:"#555", fontSize:11, letterSpacing:0.4 }}>PRICE HISTORY</span>
                <span style={{ color:TEAL, fontSize:11 }}>
                  ${Math.max(...(chartData || prices.history).map(p => p.price)).toFixed(2)} high
                </span>
              </div>
              {chartData && chartData.length > 0 ? (
                <>
                  <CardChart data={chartData} color={TEAL}/>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, alignItems:"center" }}>
                    <div style={{ display:"flex", gap:12 }}>
                      {chartData.filter((e,i,a) => i===0||i===Math.floor(a.length/2)||i===a.length-1)
                        .map((e,i) => <span key={i} style={{ color:"#444", fontSize:10 }}>{e.label}</span>)}
                    </div>
                    <span style={{ color:"#333", fontSize:9 }}>TCGPlayer snapshots</span>
                  </div>
                </>
              ) : (
                <div style={{ padding:"20px 0", textAlign:"center" }}>
                  <div style={{ color:"#555", fontSize:12 }}>Price history builds over time</div>
                  <div style={{ color:"#333", fontSize:11, marginTop:4 }}>Open this card daily to build price history</div>
                </div>
              )}
            </div>
            <RangeBar active={chartRange} onChange={setChartRange}/>
            {/* Condition prices */}
            <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden", marginBottom:16 }}>
              {Object.entries(prices.raw).map(([key, price], idx, arr) => (
                <div key={key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"14px 18px", borderBottom: idx < arr.length-1 ? `1px solid ${BORDER}` : "none",
                  background: condition === key ? "#0d1f19" : "transparent" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:condColors[key] }}/>
                    <span style={{ color: condition===key ? "#fff" : "#666", fontSize:14 }}>
                      {condLabels[key]}
                    </span>
                    {condition === key && (
                      <span style={{ background:"#00D4AA22", color:TEAL, fontSize:9,
                        padding:"2px 6px", borderRadius:6, fontWeight:700 }}>YOURS</span>
                    )}
                  </div>
                  <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20,
                    color: condition===key ? TEAL : "#555", letterSpacing:1 }}>
                    ${price}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "graded" && (
          <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden", marginBottom:16 }}>
            {[["PSA", ["PSA 10","PSA 9","PSA 8"]], ["BGS", ["BGS 9.5","BGS 9"]], ["CGC", ["CGC 10","CGC 9"]]].map(([grader, grades]) => (
              <div key={grader}>
                <div style={{ padding:"10px 18px 8px", background:"#0d0d0d", borderBottom:`1px solid ${BORDER}` }}>
                  <span style={{ color:TEAL, fontSize:11, fontWeight:700, letterSpacing:1 }}>{grader}</span>
                </div>
                {grades.map(g => (
                  <div key={g} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"13px 18px", borderBottom:`1px solid ${BORDER}` }}>
                    <span style={{ color:"#ccc", fontSize:14, fontWeight:600 }}>{g}</span>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1 }}>
                        ${prices.graded[g]}
                      </div>
                      <div style={{ color:"#444", fontSize:10 }}>
                        {(prices.graded[g] / prices.raw.near_mint).toFixed(1)}× raw NM
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === "pop" && (
          <div style={{ marginBottom:16 }}>
            <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, overflow:"hidden" }}>
              {[
                { label:"PSA 10 Population", value:prices.pop.psa10, color:TEAL },
                { label:"PSA 9 Population",  value:prices.pop.psa9,  color:"#3b82f6" },
                { label:"Total Graded",       value:prices.pop.total, color:"#888" },
              ].map((row, i, arr) => (
                <div key={row.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"16px 18px", borderBottom: i<arr.length-1 ? `1px solid ${BORDER}` : "none" }}>
                  <span style={{ color:"#888", fontSize:13 }}>{row.label}</span>
                  <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:row.color, letterSpacing:1 }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop:12, background:"#140f00", border:"1px solid #2d2000",
              borderRadius:12, padding:"12px 16px", display:"flex", gap:10, alignItems:"flex-start" }}>
              <Icon.Info size={16} color="#f59e0b"/>
              <div>
                <div style={{ color:"#f59e0b", fontSize:12, fontWeight:600 }}>Low PSA 10 Pop = Higher Value Potential</div>
                <div style={{ color:"#666", fontSize:11, marginTop:4 }}>
                  Only {prices.pop.psa10} PSA 10s exist. This is a {prices.pop.psa10 < 20 ? "scarce" : "common"} card to grade.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ height:32 }}/>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:300,
          display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
          <div style={{ background:"#111", border:`1px solid ${BORDER}`, borderRadius:24,
            padding:"28px 24px", width:"100%", maxWidth:360, textAlign:"center" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff",
              letterSpacing:1, marginBottom:8 }}>REMOVE CARD?</div>
            <div style={{ color:"#666", fontSize:13, marginBottom:24 }}>
              Remove {card.name} from your collection? This cannot be undone.
            </div>
            <button onClick={() => { setShowDeleteConfirm(false); onRemove(item.id); }}
              style={{ width:"100%", padding:14, background:"#ef4444", border:"none",
                borderRadius:14, fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                letterSpacing:1, color:"#fff", cursor:"pointer", marginBottom:10 }}>
              REMOVE
            </button>
            <button onClick={() => setShowDeleteConfirm(false)}
              style={{ width:"100%", padding:12, background:"none", border:"none",
                color:"#555", fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sell modal */}
      {showSellModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:100,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div style={{ background:"#111", borderRadius:"24px 24px 0 0", width:"100%", maxWidth:430, padding:"24px 24px 44px" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1, marginBottom:4 }}>
              MARK AS SOLD
            </div>
            <div style={{ color:"#555", fontSize:13, marginBottom:20 }}>
              {card.name} · {condLabels[condition]}
            </div>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>SALE PRICE</div>
            <input type="number" inputMode="decimal" placeholder="0.00" autoFocus
              value={sellPrice} onChange={e => setSellPrice(e.target.value)}
              style={{ width:"100%", padding:"14px", background:"#0d0d0d", border:`1px solid ${BORDER}`,
                borderRadius:12, color:"#fff", fontSize:18, fontFamily:"inherit",
                outline:"none", boxSizing:"border-box" }}/>
            {sellPrice && paid != null && (
              <div style={{ marginTop:12, padding:"10px 14px",
                background: parseFloat(sellPrice) >= paid ? "#0a1f10" : "#1a0a0a", borderRadius:10 }}>
                <span style={{ color: parseFloat(sellPrice) >= paid ? TEAL : "#ef4444", fontSize:13 }}>
                  {parseFloat(sellPrice) >= paid ? "+" : ""}{(parseFloat(sellPrice) - paid).toFixed(2)} vs what you paid (${paid.toFixed(2)})
                </span>
              </div>
            )}
            <button onClick={() => {
              const p = parseFloat(sellPrice);
              if (!sellPrice || isNaN(p) || p <= 0) return;
              onMarkSold(item.id, p);
              setShowSellModal(false);
            }} style={{ width:"100%", marginTop:16, padding:16, background:"#f59e0b", border:"none",
              borderRadius:16, fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1,
              color:"#000", cursor:"pointer" }}>
              CONFIRM SALE
            </button>
            <button onClick={() => setShowSellModal(false)} style={{ width:"100%", marginTop:8, padding:12,
              background:"none", border:"none", color:"#444", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Search View ───────────────────────────────────────────────────────────────
function SearchView({ onCardPress, onAdd }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [addingCard, setAddingCard] = useState(null);
  const [condition, setCondition] = useState("near_mint");
  const [acqType, setAcqType] = useState("bought");
  const [costPaid, setCostPaid] = useState("");
  const [cardsMeta, setCardsMeta] = useState(null);
  const [workerReady, setWorkerReady] = useState(false);
  const workerRef = useRef(null);
  const reqIdRef  = useRef(0);

  // Spin up search worker once
  useEffect(() => {
    const w = new Worker(new URL('./searchWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        setWorkerReady(true);
      } else if (data.type === 'results') {
        // Ignore stale responses from earlier keystrokes
        if (data.reqId !== reqIdRef.current) return;
        setResults(data.ids.map(id => cardsMeta?.[id]).filter(Boolean));
        setLoading(false);
      }
    };
    return () => w.terminate();
  }, []);

  // Load cards meta from IDB, then send lightweight index to worker
  useEffect(() => {
    const open = indexedDB.open("mtgtracker-global-index", 1);
    open.onupgradeneeded = e => e.target.result.createObjectStore("index");
    open.onsuccess = e => {
      const tx = e.target.result.transaction("index", "readonly");
      const req = tx.objectStore("index").get("index-cards");
      req.onsuccess = () => {
        const meta = req.result || {};
        setCardsMeta(meta);
        // Build lightweight pre-lowercased index for the worker
        const items = Object.values(meta).map(c => ({
          id:  c.id,
          n:   (c.name       || "").toLowerCase(),
          num: (c.number     || "").toLowerCase(),
          s:   (c.set?.name  || "").toLowerCase(),
          sid: (c.set?.id    || "").toLowerCase(),
          r:   (c.rarity     || "").toLowerCase(),
        }));
        // Only send index if we have cards — an empty index makes the worker
        // "ready" with 0 results, which bypasses the API search fallback.
        if (items.length > 0) {
          workerRef.current?.postMessage({ type: 'index', items });
        }
      };
      req.onerror = () => setCardsMeta({});
    };
    open.onerror = () => setCardsMeta({});
  }, []);

  // Keep worker's onmessage closure fresh when cardsMeta updates
  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        setWorkerReady(true);
      } else if (data.type === 'results') {
        if (data.reqId !== reqIdRef.current) return;
        setResults(data.ids.map(id => cardsMeta?.[id]).filter(Boolean));
        setLoading(false);
      }
    };
  }, [cardsMeta]);

  const doSearch = useCallback((query) => {
    if (!query.trim()) { setResults([]); setSearched(false); return; }
    setSearched(true);

    if (workerReady) {
      // Off-thread search — never blocks the UI
      const reqId = ++reqIdRef.current;
      setLoading(true);
      workerRef.current.postMessage({ type: 'search', query, reqId });
      return;
    }

    // Fallback to API if worker/index not ready yet
    setLoading(true);
    searchCards(query, 24).then(cards => {
      setResults(cards);
      setLoading(false);
    }).catch(() => { setResults([]); setLoading(false); });
  }, [workerReady]);

  // Debounce: 150ms even for local (batches rapid keystrokes, prevents flooding worker)
  useEffect(() => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    const delay = workerReady ? 150 : 400;
    const t = setTimeout(() => doSearch(q), delay);
    return () => clearTimeout(t);
  }, [q, workerReady]);

  const handleAdd = () => {
    if (!addingCard) return;
    // Use onAdd to save directly to collection
    if (onAdd) {
      onAdd(addingCard, condition, {
        acqType,
        costPaid: costPaid ? parseFloat(costPaid) : null,
      });
    }
    setAddingCard(null); setCostPaid(""); setCondition("near_mint");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"14px 20px 12px", borderBottom:`1px solid ${BORDER}` }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:"#fff",
          letterSpacing:1, marginBottom:12 }}>SEARCH CARDS</div>
        <div style={{ position:"relative" }}>
          <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}>
            <Icon.Search size={16} color="#555"/>
          </div>
          <input value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch(q)}
            placeholder={workerReady
              ? `Search ${Object.keys(cardsMeta||{}).length.toLocaleString()} cards...`
              : "Search Magic cards..."}
            style={{ width:"100%", padding:"11px 12px 11px 36px", background:CARD,
              border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
              fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
        </div>
      </div>
      <div style={{ padding:"12px 16px" }}>
        {loading && (
          <div style={{ display:"flex", justifyContent:"center", padding:40 }}>
            <div style={{ width:32, height:32, border:`3px solid ${TEAL}`, borderTopColor:"transparent",
              borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
          </div>
        )}
        {!loading && searched && results.length === 0 && (
          <div style={{ textAlign:"center", color:"#888", padding:40, fontSize:14 }}>No results found</div>
        )}
        {!loading && results.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:12 }}>
            {results.map(card => (
              <div key={card.id} onClick={() => setAddingCard(card)}
                style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
                  overflow:"hidden", cursor:"pointer", transition:"border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = TEAL+"44"}
                onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                <div style={{ background:"#0d0d0d", display:"flex", justifyContent:"center", padding:8 }}>
                  <img src={card.images?.small} alt={card.name}
                    style={{ height:100, objectFit:"contain" }}/>
                </div>
                <div style={{ padding:"8px 10px 10px" }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14, color:"#fff" }}>{card.name}</div>
                  <div style={{ color:"#555", fontSize:10, marginTop:2 }}>{card.set?.name}</div>
                  <div style={{ color:TEAL, fontSize:11, marginTop:4, fontFamily:"'Bebas Neue',sans-serif" }}>
                    + ADD
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add card modal */}
      {addingCard && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:300,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={e => { if (e.target === e.currentTarget) setAddingCard(null); }}>
          <div style={{ background:"#111", borderRadius:"20px 20px 0 0", padding:"20px 20px 100px",
            borderTop:`1px solid ${BORDER}`, maxHeight:"85vh", overflowY:"auto", width:"100%" }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:20 }}>
              <img src={addingCard.images?.small} alt={addingCard.name}
                style={{ height:80, borderRadius:8, flexShrink:0 }}/>
              <div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff" }}>{addingCard.name}</div>
                <div style={{ color:"#555", fontSize:12 }}>{addingCard.set?.name} · #{addingCard.number}</div>
              </div>
            </div>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:8 }}>CONDITION</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              {Object.entries(condLabels).map(([key, label]) => {
                const p = getPrices(addingCard);
                const price = p?.raw[key] || 0;
                return (
                  <button key={key} onClick={() => setCondition(key)} style={{
                    background: condition===key ? condColors[key]+"18" : "#0d0d0d",
                    border: `2px solid ${condition===key ? condColors[key] : BORDER}`,
                    borderRadius:10, padding:"9px 12px", textAlign:"left", cursor:"pointer" }}>
                    <div style={{ color:condColors[key], fontSize:10, fontWeight:700 }}>{label}</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                      color: condition===key ? "#fff" : "#555", letterSpacing:1 }}>
                      {price > 0 ? fmt(price) : "—"}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>PRICE PAID (optional)</div>
            <input type="number" inputMode="decimal" placeholder="0.00"
              value={costPaid} onChange={e => setCostPaid(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
                border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                fontSize:15, fontFamily:"inherit", outline:"none",
                boxSizing:"border-box", marginBottom:16 }}/>
            <button onClick={handleAdd} style={{ width:"100%", padding:15, background:TEAL,
              border:"none", borderRadius:14, fontFamily:"'Bebas Neue',sans-serif",
              fontSize:18, letterSpacing:1, color:"#000", cursor:"pointer", marginBottom:8 }}>
              ADD TO COLLECTION
            </button>
            <button onClick={() => setAddingCard(null)} style={{ width:"100%", padding:10,
              background:"none", border:"none", color:"#555", fontSize:13,
              cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Set Browse View ───────────────────────────────────────────────────────────
function SetBrowseView({ setInfo, onBack, onCardPress }) {
  const [cards, setCards]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchSetCards(setInfo.id).then(c => {
      if (!cancelled) { setCards(c); setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [setInfo.id]);

  const q = filter.toLowerCase();
  const visible = q
    ? cards.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.number === q ||
        (c.type_line || "").toLowerCase().includes(q)
      )
    : cards;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"14px 16px 10px", borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
            padding:4, display:"flex", alignItems:"center" }}>
            <Icon.Back size={22} color="#888"/>
          </button>
          {setInfo.symbol && (
            <img src={setInfo.symbol} alt={setInfo.name}
              style={{ width:22, height:22, objectFit:"contain", filter:"brightness(0) invert(0.6)" }}/>
          )}
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1, lineHeight:1 }}>
              {setInfo.name}
            </div>
            <div style={{ color:"#555", fontSize:11, marginTop:1 }}>
              {cards.length > 0 ? cards.length : (setInfo.total || "?")} cards · {setInfo.releaseDate}
            </div>
          </div>
        </div>
        <div style={{ position:"relative" }}>
          <div style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)" }}>
            <Icon.Search size={14} color="#555"/>
          </div>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter by name, number or type..."
            style={{ width:"100%", padding:"9px 12px 9px 30px", background:CARD,
              border:`1px solid ${BORDER}`, borderRadius:10, color:"#fff",
              fontSize:14, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", WebkitOverflowScrolling:"touch" }}>
        {loading ? (
          <div style={{ display:"flex", justifyContent:"center", padding:60 }}>
            <div style={{ width:32, height:32, border:`3px solid ${TEAL}`, borderTopColor:"transparent",
              borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
          </div>
        ) : (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))", gap:10 }}>
              {visible.map(card => (
                <div key={card.id} onClick={() => onCardPress(card)}
                  style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:10,
                    overflow:"hidden", cursor:"pointer" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = TEAL+"44"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                  <div style={{ background:"#0d0d0d", display:"flex", justifyContent:"center", padding:6 }}>
                    <img src={card.images?.small} alt={card.name} loading="lazy"
                      style={{ height:90, objectFit:"contain" }}/>
                  </div>
                  <div style={{ padding:"5px 7px 7px" }}>
                    <div style={{ color:"#fff", fontSize:10, fontWeight:600, lineHeight:1.2,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{card.name}</div>
                    <div style={{ color:"#555", fontSize:9, marginTop:1 }}>#{card.number}</div>
                    {card.prices?.usd && (
                      <div style={{ color:TEAL, fontSize:10, marginTop:2, fontFamily:"'Bebas Neue',sans-serif" }}>
                        ${card.prices.usd}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {visible.length === 0 && (
              <div style={{ textAlign:"center", color:"#888", padding:40, fontSize:14 }}>No cards found</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Card Browse Detail View ───────────────────────────────────────────────────
const BROWSE_LEGALITY_FORMATS = [
  ["Standard","standard"], ["Pioneer","pioneer"], ["Modern","modern"],
  ["Legacy","legacy"],     ["Commander","commander"], ["Vintage","vintage"],
  ["Pauper","pauper"],     ["Historic","historic"],
];

function browsRarityColor(r) {
  if (!r) return "#888";
  const l = r.toLowerCase();
  if (l === "mythic")   return "#f97316";
  if (l === "rare")     return "#f59e0b";
  if (l === "uncommon") return "#94a3b8";
  return "#888";
}

function CardBrowseDetailView({ card, onBack, onAdd }) {
  const [addingCard, setAddingCard] = useState(null);
  const [condition, setCondition]   = useState("near_mint");
  const [acqType, setAcqType]       = useState("bought");
  const [costPaid, setCostPaid]     = useState("");

  const handleAdd = () => {
    if (!addingCard) return;
    onAdd(addingCard, condition, { acqType, costPaid: costPaid ? parseFloat(costPaid) : null });
    setAddingCard(null); setCostPaid(""); setCondition("near_mint");
  };

  const p = card.prices || {};

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflowY:"auto",
      WebkitOverflowScrolling:"touch" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"14px 16px 12px",
        borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer",
          padding:4, display:"flex", alignItems:"center" }}>
          <Icon.Back size={22} color="#888"/>
        </button>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff",
          letterSpacing:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {card.name}
        </div>
      </div>

      <div style={{ padding:"16px 16px 120px" }}>
        {/* Card image */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
          <img
            src={card.images?.large || card.images?.normal || card.images?.small}
            alt={card.name}
            style={{ width:"min(100%, 260px)", borderRadius:12,
              boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}/>
        </div>

        {/* Oracle text card */}
        <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
          padding:"14px 16px", marginBottom:12 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff",
            letterSpacing:0.5, marginBottom:2 }}>{card.name}</div>
          {card.mana_cost && (
            <div style={{ color:"#888", fontSize:12, marginBottom:6 }}>{card.mana_cost}</div>
          )}
          {card.type_line && (
            <div style={{ color:"#aaa", fontSize:13, fontStyle:"italic", marginBottom:8,
              paddingBottom:8, borderBottom:`1px solid ${BORDER}` }}>
              {card.type_line}
            </div>
          )}
          {card.oracle_text && (
            <div style={{ color:"#ccc", fontSize:13, lineHeight:1.6, whiteSpace:"pre-wrap" }}>
              {card.oracle_text}
            </div>
          )}
        </div>

        {/* Print info */}
        <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
          padding:"12px 16px", marginBottom:12 }}>
          <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>PRINT</div>
          <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
            <div>
              <div style={{ color:"#555", fontSize:10 }}>Set</div>
              <div style={{ color:"#fff", fontSize:13 }}>{card.set?.name}</div>
            </div>
            <div>
              <div style={{ color:"#555", fontSize:10 }}>Number</div>
              <div style={{ color:"#fff", fontSize:13 }}>#{card.number}</div>
            </div>
            <div>
              <div style={{ color:"#555", fontSize:10 }}>Rarity</div>
              <div style={{ color:browsRarityColor(card.rarity), fontSize:13, textTransform:"capitalize" }}>
                {card.rarity}
              </div>
            </div>
          </div>
        </div>

        {/* Prices */}
        {(p.usd || p.usd_foil || p.eur || p.tix) && (
          <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
            padding:"12px 16px", marginBottom:12 }}>
            <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>PRICES</div>
            <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
              {p.usd && (
                <div>
                  <div style={{ color:"#555", fontSize:10 }}>USD</div>
                  <div style={{ color:TEAL, fontSize:18, fontFamily:"'Bebas Neue',sans-serif" }}>${p.usd}</div>
                </div>
              )}
              {p.usd_foil && (
                <div>
                  <div style={{ color:"#555", fontSize:10 }}>USD Foil</div>
                  <div style={{ color:"#f59e0b", fontSize:18, fontFamily:"'Bebas Neue',sans-serif" }}>${p.usd_foil}</div>
                </div>
              )}
              {p.eur && (
                <div>
                  <div style={{ color:"#555", fontSize:10 }}>EUR</div>
                  <div style={{ color:"#aaa", fontSize:18, fontFamily:"'Bebas Neue',sans-serif" }}>€{p.eur}</div>
                </div>
              )}
              {p.tix && (
                <div>
                  <div style={{ color:"#555", fontSize:10 }}>TIX</div>
                  <div style={{ color:"#aaa", fontSize:18, fontFamily:"'Bebas Neue',sans-serif" }}>{p.tix}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legalities */}
        {card.legalities && Object.keys(card.legalities).length > 0 && (
          <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
            padding:"12px 16px", marginBottom:12 }}>
            <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:8 }}>LEGALITY</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 12px" }}>
              {BROWSE_LEGALITY_FORMATS.map(([label, key]) => {
                const status = card.legalities[key] || "not_legal";
                const isLegal = status === "legal";
                return (
                  <div key={key} style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:44, padding:"2px 0", textAlign:"center", borderRadius:4, flexShrink:0,
                      background: isLegal ? "#16a34a22" : "#1a1a1a",
                      border:`1px solid ${isLegal ? "#16a34a" : "#2a2a2a"}`,
                      color: isLegal ? "#4ade80" : "#3a3a3a", fontSize:9, fontWeight:700 }}>
                      {isLegal ? "LEGAL" : "NOT"}
                    </div>
                    <span style={{ color: isLegal ? "#ccc" : "#444", fontSize:12 }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sticky add button */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, padding:"12px 16px 36px",
        background:"linear-gradient(transparent, #0a0a0a 40%)", pointerEvents:"none" }}>
        <button onClick={() => setAddingCard(card)}
          style={{ width:"100%", padding:15, background:TEAL, border:"none", borderRadius:14,
            fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1,
            color:"#000", cursor:"pointer", pointerEvents:"auto" }}>
          + ADD TO COLLECTION
        </button>
      </div>

      {/* Add card modal — reuses SearchView's pattern */}
      {addingCard && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:300,
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}
          onClick={e => { if (e.target === e.currentTarget) setAddingCard(null); }}>
          <div style={{ background:"#111", borderRadius:"20px 20px 0 0", padding:"20px 20px 100px",
            borderTop:`1px solid ${BORDER}`, maxHeight:"85vh", overflowY:"auto", width:"100%" }}>
            <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:20 }}>
              <img src={addingCard.images?.small} alt={addingCard.name}
                style={{ height:80, borderRadius:8, flexShrink:0 }}/>
              <div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff" }}>{addingCard.name}</div>
                <div style={{ color:"#555", fontSize:12 }}>{addingCard.set?.name} · #{addingCard.number}</div>
              </div>
            </div>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:8 }}>CONDITION</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
              {Object.entries(condLabels).map(([key, label]) => {
                const price = getPrices(addingCard).raw[key] || 0;
                return (
                  <button key={key} onClick={() => setCondition(key)} style={{
                    background: condition===key ? condColors[key]+"18" : "#0d0d0d",
                    border:`2px solid ${condition===key ? condColors[key] : BORDER}`,
                    borderRadius:10, padding:"9px 12px", textAlign:"left", cursor:"pointer" }}>
                    <div style={{ color:condColors[key], fontSize:10, fontWeight:700 }}>{label}</div>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                      color: condition===key ? "#fff" : "#555", letterSpacing:1 }}>
                      {price > 0 ? fmt(price) : "—"}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>PRICE PAID (optional)</div>
            <input type="number" inputMode="decimal" placeholder="0.00"
              value={costPaid} onChange={e => setCostPaid(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
                border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                fontSize:15, fontFamily:"inherit", outline:"none",
                boxSizing:"border-box", marginBottom:16 }}/>
            <button onClick={handleAdd} style={{ width:"100%", padding:15, background:TEAL,
              border:"none", borderRadius:14, fontFamily:"'Bebas Neue',sans-serif",
              fontSize:18, letterSpacing:1, color:"#000", cursor:"pointer", marginBottom:8 }}>
              ADD TO COLLECTION
            </button>
            <button onClick={() => setAddingCard(null)} style={{ width:"100%", padding:10,
              background:"none", border:"none", color:"#555", fontSize:13,
              cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Master Set View ───────────────────────────────────────────────────────────
function MasterSetView({ collection, onCardPress, onBack, selectedSetId, setSelectedSetId, onAddCard }) {
  const [setCards, setSetCards] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState("");
  const [checks, setChecks]     = useState(() => {
    try { return JSON.parse(localStorage.getItem(MASTER_SET_CHECKS_KEY) || "{}"); }
    catch { return {}; }
  });

  const toggleCheck = (setId, cardNumber, variant) => {
    setChecks(prev => {
      const setMap = { ...(prev[setId] || {}) };
      const cardMap = { ...(setMap[cardNumber] || {}) };
      if (cardMap[variant]) delete cardMap[variant];
      else cardMap[variant] = true;
      if (Object.keys(cardMap).length === 0) delete setMap[cardNumber];
      else setMap[cardNumber] = cardMap;
      const next = { ...prev, [setId]: setMap };
      try { localStorage.setItem(MASTER_SET_CHECKS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const ownedBySet = useMemo(() => {
    const map = {};
    collection.forEach(item => {
      const sid = item.card.set?.id || item.card.id?.split("-")[0];
      if (!sid) return;
      if (!map[sid]) map[sid] = { nums: new Set(), items: [] };
      map[sid].nums.add(String(parseInt(item.card.number || "0", 10)));
      map[sid].items.push(item);
    });
    return map;
  }, [collection]);

  const ownedSets = useMemo(() => {
    const setMap = {};
    collection.forEach(item => {
      const sid   = item.card.set?.id || item.card.id?.split("-")[0];
      const name  = item.card.set?.name || sid;
      const logo  = item.card.set?.images?.logo || null;
      const total = item.card.set?.total || item.card.set?.printedTotal || 0;
      if (!sid) return;
      if (!setMap[sid]) setMap[sid] = { id: sid, name, nums: new Set(), logo, total };
      setMap[sid].nums.add(String(parseInt(item.card.number || "0", 10))); // unique only
      if (!setMap[sid].logo && logo) setMap[sid].logo = logo;
      if (!setMap[sid].total && total) setMap[sid].total = total;
    });
    return Object.values(setMap)
      .map(s => ({ ...s, owned: s.nums.size }))
      .sort((a, b) => b.owned - a.owned);
  }, [collection]);

  useEffect(() => {
    if (!selectedSetId) { setSetCards([]); return; }
    setLoading(true);
    (async () => {
      // IDB cache first
      const cached = await getCachedSetCards(selectedSetId);
      if (cached?.length) {
        setSetCards(cached); setLoading(false); return;
      }
      // Fetch from Scryfall
      const cards = await fetchSetCards(selectedSetId);

      if (cards.length) {
        cacheSetCards(selectedSetId, cards).catch(() => {});
        // Pre-cache small card images for this set in the background
        if (navigator.serviceWorker?.controller) {
          const urls = cards.flatMap(c => [c.images?.small].filter(Boolean));
          navigator.serviceWorker.controller.postMessage({ type:"PRECACHE_IMAGES", urls });
        }
      }
      setSetCards(cards); setLoading(false);
    })().catch(() => setLoading(false));
  }, [selectedSetId]);

  // ── Set detail view ──────────────────────────────────────────────────────
  if (selectedSetId) {
    const ownedData = ownedBySet[selectedSetId] || { nums: new Set(), items: [] };
    const owned     = ownedData.nums;
    const setInfo   = ownedSets.find(s => s.id === selectedSetId) || {};
    const setName   = setInfo.name || selectedSetId;

    const filtered = (search
      ? setCards.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.number.includes(search))
      : setCards
    ).slice().sort((a, b) => {
      const an = parseInt(a.number || "0", 10), bn = parseInt(b.number || "0", 10);
      return an !== bn ? an - bn : (a.number || "").localeCompare(b.number || "");
    });

    const haveCount = setCards.filter(c => owned.has(String(parseInt(c.number || "0", 10)))).length;
    const total     = setCards.length;
    const pct       = total > 0 ? Math.round((haveCount / total) * 100) : 0;

    const getCardVariants = (card) => {
      // MTG: every card can be nonfoil; foil available for rare/mythic and many others
      const rarity = (card.rarity || "").toLowerCase();
      const hasFoilPrice = parseFloat(card.prices?.usd_foil || 0) > 0;
      const variants = ["nonfoil"];
      if (hasFoilPrice || rarity === "rare" || rarity === "mythic") variants.push("foil");
      return variants;
    };

    const setChecks = checks[selectedSetId] || {};

    const getOwnedVariants = (n) => {
      const items = ownedData.items.filter(i => String(parseInt(i.card.number || "0", 10)) === n);
      const ov = new Set();
      items.forEach(i => { ov.add(i.foil ? "foil" : "nonfoil"); });
      Object.keys(setChecks[n] || {}).forEach(v => ov.add(v));
      return ov;
    };

    const getVariantPrice = (card, variant) => {
      if (variant === "foil") return parseFloat(card.prices?.usd_foil || card.prices?.eur_foil || 0);
      return parseFloat(card.prices?.usd || card.prices?.eur || 0);
    };

    const VARIANT_CONFIG = {
      foil:    { color: "#f59e0b", title: "Foil" },
      nonfoil: { color: "#6b7280", title: "Non-Foil" },
    };


    // Total value of every checked card+variant in this master set
    let masterSetValue = 0;
    setCards.forEach(card => {
      const n = String(parseInt(card.number || "0", 10));
      const ov = getOwnedVariants(n);
      ov.forEach(v => { masterSetValue += getVariantPrice(card, v); });
    });

    let checkedCount = 0;
    setCards.forEach(card => {
      const n = String(parseInt(card.number || "0", 10));
      checkedCount += getOwnedVariants(n).size;
    });

    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column", background:BG }}>
        <div style={{ padding:"14px 20px", background:BG, borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
            <button onClick={() => { setSelectedSetId(null); setSearch(""); }}
              style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
              <Icon.Back size={22} color="#fff"/>
            </button>
            {setInfo.logo && (
              <img src={setInfo.logo} alt={setName}
                style={{ height:28, maxWidth:80, objectFit:"contain" }}
                onError={e => e.target.style.display = "none"}/>
            )}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#fff",
                letterSpacing:0.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {setName}
              </div>
              <div style={{ color:"#555", fontSize:11 }}>
                {haveCount} / {total} cards · {pct}% complete
              </div>
              <div style={{ color:TEAL, fontSize:12, fontWeight:700, marginTop:2 }}>
                {fmt(masterSetValue)} <span style={{ color:"#555", fontWeight:400 }}>· {checkedCount} variants checked</span>
              </div>
            </div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26,
              color: pct === 100 ? "#22c55e" : TEAL, letterSpacing:1 }}>{pct}%</div>
          </div>
          <div style={{ height:5, background:"#1a1a1a", borderRadius:3, overflow:"hidden", marginBottom:10 }}>
            <div style={{ height:"100%", width:`${pct}%`,
              background: pct === 100 ? "#22c55e" : TEAL, borderRadius:3, transition:"width 0.5s ease" }}/>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or number..." autoCorrect="off" autoComplete="off" autoCapitalize="none" spellCheck={false}
            style={{ width:"100%", padding:"9px 14px", background:"#0d0d0d",
              border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
              fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
        </div>

        <div style={{ flex:1, overflowY:"auto", padding:"12px 12px 40px" }}>
          {loading ? (
            <div style={{ display:"flex", justifyContent:"center", padding:40 }}>
              <div style={{ width:32, height:32, border:`3px solid ${TEAL}`,
                borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))", gap:10 }}>
              {filtered.map(card => {
                const n        = String(parseInt(card.number || "0", 10));
                const have     = owned.has(n);
                const variants = getCardVariants(card);
                const ownedVars = getOwnedVariants(n);
                const item     = ownedData.items.find(i => String(parseInt(i.card.number || "0", 10)) === n);

                return (
                  <div key={card.id} style={{ background:CARD,
                    border:`1px solid ${have ? TEAL+"44" : BORDER}`,
                    borderRadius:10, overflow:"hidden" }}>
                    <button onClick={() => { if (item) onCardPress(item); else if (onAddCard) onAddCard(card); }}
                      style={{ background:"none", border:"none", padding:0, width:"100%", cursor:"pointer", display:"block" }}>
                      <div style={{ position:"relative", opacity: have ? 1 : 0.4 }}>
                        <img src={card.images?.small} alt={card.name}
                          style={{ width:"100%", display:"block" }}
                          onError={e => e.target.style.display = "none"}/>
                        {!have && (
                          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.45)",
                            display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <div style={{ width:28, height:28, borderRadius:"50%",
                              background:"rgba(0,212,170,0.15)", border:`1.5px solid ${TEAL}88`,
                              display:"flex", alignItems:"center", justifyContent:"center" }}>
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M6 2v8M2 6h8" stroke={TEAL} strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>

                    <div style={{ padding:"4px 6px 6px" }}>
                      <div style={{ fontSize:9, color: have ? TEAL : "#444", fontWeight:700 }}>#{card.number}</div>
                      <div style={{ fontSize:8, color: have ? "#888" : "#333", overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:4 }}>{card.name}</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                        {variants.map(v => {
                          const cfg  = VARIANT_CONFIG[v];
                          const hasV = ownedVars.has(v);
                          const fromCollection = (() => {
                            const items = ownedData.items.filter(i => String(parseInt(i.card.number || "0", 10)) === n);
                            return items.some(i => v === "foil" ? !!i.foil : !i.foil);
                          })();
                          return (
                            <div key={v}
                              onClick={(e) => {
                                if (fromCollection) return; // owned via real pull — can't untoggle here
                                e.stopPropagation();
                                toggleCheck(selectedSetId, n, v);
                              }}
                              style={{ display:"flex", alignItems:"center", gap:4,
                                cursor: fromCollection ? "default" : "pointer" }}>
                              <div style={{ width:12, height:12, borderRadius:3, flexShrink:0,
                                border:`1.5px solid ${hasV ? cfg.color : "#333"}`,
                                background: hasV ? cfg.color + "22" : "transparent",
                                display:"flex", alignItems:"center", justifyContent:"center" }}>
                                {hasV && (
                                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                    <path d="M1 4l2 2 4-4" stroke={cfg.color} strokeWidth="1.5" strokeLinecap="round"/>
                                  </svg>
                                )}
                              </div>
                              <span style={{ fontSize:8, color: hasV ? cfg.color : "#444",
                                fontWeight: hasV ? 700 : 400 }}>{cfg.title}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Set list ──────────────────────────────────────────────────────────────
  const filteredSets = ownedSets.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", background:BG }}>
      <div style={{ padding:"16px 20px 12px", background:BG, borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
          <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
            <Icon.Back size={22} color="#fff"/>
          </button>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1 }}>
            MASTER SETS
          </div>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search sets..."
          style={{ width:"100%", padding:"9px 14px", background:"#0d0d0d",
            border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
            fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px 40px" }}>
        {filteredSets.length === 0 && (
          <div style={{ textAlign:"center", color:"#444", padding:40, fontSize:14 }}>
            Add cards to your collection to see sets here.
          </div>
        )}
        {filteredSets.map(s => {
          const pct = s.total > 0 ? Math.round((s.owned / s.total) * 100) : 0;
          return (
            <button key={s.id} onClick={() => { setSelectedSetId(s.id); setSearch(""); }}
              style={{ width:"100%", background:CARD, border:`1px solid ${BORDER}`,
                borderRadius:14, padding:"14px 16px", marginBottom:10,
                cursor:"pointer", fontFamily:"inherit", textAlign:"left", transition:"border-color 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = TEAL+"66"}
              onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
                <div style={{ width:56, height:36, flexShrink:0, display:"flex", alignItems:"center",
                  justifyContent:"center", background:"#0d0d0d", borderRadius:8, overflow:"hidden", padding:4 }}>
                  {s.logo
                    ? <img src={s.logo} alt={s.name}
                        style={{ maxHeight:26, maxWidth:50, objectFit:"contain" }}
                        onError={e => e.target.style.display = "none"}/>
                    : <span style={{ color:"#444", fontSize:9, fontWeight:700,
                        fontFamily:"'Bebas Neue',sans-serif", letterSpacing:0.5 }}>
                        {s.name.slice(0, 4).toUpperCase()}
                      </span>
                  }
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:"#fff", fontSize:14, fontWeight:600,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
                  <div style={{ color:"#555", fontSize:11, marginTop:1 }}>
                    {s.owned}{s.total > 0 ? ` / ${s.total}` : ""} cards{pct > 0 ? ` · ${pct}%` : ""}
                  </div>
                </div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22,
                  color: pct === 100 ? "#22c55e" : TEAL, letterSpacing:1, flexShrink:0 }}>
                  {pct > 0 ? `${pct}%` : s.owned}
                </div>
              </div>
              <div style={{ height:4, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
                <div style={{ height:"100%",
                  width:`${s.total > 0 ? pct : Math.min((s.owned / 50) * 100, 100)}%`,
                  background: pct === 100 ? "#22c55e" : TEAL, borderRadius:2 }}/>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ── Collection View ───────────────────────────────────────────────────────────
function CollectionView({ collection, onCardPress, onImport, onRefreshPrices, refreshing,
  collSubTab="collection", setCollSubTab, masterSetId, setMasterSetId, onAddMissingCard,
  sort="date_desc", setSort, tradeList=[], onToggleTrade,
  onBulkDelete, onBulkCondition }) {
  const [search, setSearch] = useState("");
  const [minValue, setMinValue] = useState(0);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkCondPicker, setBulkCondPicker] = useState(false);
  const [tradeSelection, setTradeSelection] = useState([]);
  const [tradePricingMode, setTradePricingMode] = useState("market");
  const [activeTagFilters, setActiveTagFilters] = useState([]); // tag filter pills
  const [showTagFilter, setShowTagFilter] = useState(false);
  const MIN_VALUE_OPTIONS = [0, 1, 5, 10, 25];

  // Pre-compute prices once per collection change instead of recalculating
  // genPrices() repeatedly during filter/sort (which was happening ~5000+ times
  // per render on a 300-card collection due to sort comparator calling it twice
  // per comparison plus filter and total calculations).
  // IMPORTANT: these hooks must run on every render regardless of collSubTab —
  // placing them after the early returns below caused React error #300
  // (inconsistent hook count) when switching to/from Master Sets or Sold tabs.
  const valueById = useMemo(() => {
    const map = new Map();
    for (const item of collection) {
      map.set(item.id, genPrices(item.card).raw[item.condition] || 0);
    }
    return map;
  }, [collection]);
  const getVal = item => valueById.get(item.id) ?? 0;
  const getPnl = item => item.costPaid == null ? -Infinity : getVal(item) - item.costPaid;

  const sorted = useMemo(() => [...collection]
    .filter(item => {
      if (item.sold) return false;
      if (!item.card.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (getVal(item) < minValue) return false;
      if (activeTagFilters.length > 0) {
        const allTags = [...(item.autoTags || computeAutoTags(item.card)), ...(item.userTags || [])];
        if (!activeTagFilters.every(t => allTags.includes(t))) return false;
      }
      return true;
    })
    .sort((a,b) => {
      switch(sort) {
        case "value_desc": return getVal(b) - getVal(a);
        case "value_asc":  return getVal(a) - getVal(b);
        case "pnl_desc":   return getPnl(b) - getPnl(a);
        case "pnl_asc":    return getPnl(a) - getPnl(b);
        case "name_asc":   return a.card.name.localeCompare(b.card.name);
        default:           return (b.addedAt||0) - (a.addedAt||0);
      }
    }), [collection, search, minValue, sort, valueById]);

  const totalVal = useMemo(() =>
    collection.filter(i=>!i.sold).reduce((s, i) => s + getVal(i), 0),
    [collection, valueById]);
  const totalCount = collection.filter(i=>!i.sold).length;

  if (collSubTab === "mastersets") {
    return <MasterSetView collection={collection} onCardPress={onCardPress}
      onBack={() => setCollSubTab("collection")}
      selectedSetId={masterSetId} setSelectedSetId={setMasterSetId}
      onAddCard={onAddMissingCard}/>;
  }

  // Sold / Traded sub-tab
  if (collSubTab === "sold") {
    const soldItems = [...collection]
      .filter(i => i.sold)
      .sort((a, b) => (b.soldAt||0) - (a.soldAt||0));

    const totalRealised = soldItems.reduce((s, i) => s + (i.soldPrice || 0), 0);
    const totalCost     = soldItems.reduce((s, i) => s + (i.costPaid || 0), 0);
    const totalPnl      = totalRealised - totalCost;

    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"14px 20px 10px", borderBottom:`1px solid ${BORDER}`, flexShrink:0,
          display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={()=>setCollSubTab("collection")} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
            <Icon.Close size={18} color="#888"/>
          </button>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1 }}>
            SOLD & TRADED
          </div>
          <div style={{ marginLeft:"auto", color:"#555", fontSize:12 }}>{soldItems.length} card{soldItems.length!==1?"s":""}</div>
        </div>

        {/* Summary */}
        {soldItems.length > 0 && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, padding:"12px 16px", flexShrink:0 }}>
            {[
              { label:"TOTAL SOLD",   value:fmt(totalRealised), color:"#fff" },
              { label:"TOTAL COST",   value:fmt(totalCost),     color:"#555" },
              { label:"REALISED P&L", value:(totalPnl>=0?"+":"")+fmt(totalPnl), color:totalPnl>=0?TEAL:"#ef4444" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:"10px 12px" }}>
                <div style={{ color:"#555", fontSize:9, letterSpacing:0.5, marginBottom:4 }}>{label}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color, letterSpacing:1 }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {soldItems.length === 0 ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, color:"#444" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <div style={{ fontSize:14 }}>No sold cards yet</div>
            <div style={{ fontSize:12, color:"#333" }}>Mark a card as sold from its detail page</div>
          </div>
        ) : (
          <div style={{ flex:1, overflowY:"auto", padding:"4px 16px 40px" }}>
            {soldItems.map(item => {
              const soldPrice = item.soldPrice || 0;
              const cost      = item.costPaid || 0;
              const pnl       = soldPrice - cost;
              const pnlPct    = cost > 0 ? ((pnl / cost) * 100).toFixed(1) : null;
              return (
                <div key={item.id} onClick={() => onCardPress(item)}
                  style={{ display:"flex", gap:12, padding:"12px 0",
                    borderBottom:`1px solid ${BORDER}`, cursor:"pointer", alignItems:"center" }}>
                  <div style={{ position:"relative", flexShrink:0 }}>
                    <img src={item.card.images?.small} alt={item.card.name} loading="lazy"
                      style={{ width:52, height:72, objectFit:"contain", borderRadius:6,
                        filter:"grayscale(0.2) brightness(0.85)" }}/>
                    <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.3)",
                      borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                        <polyline points="20 12 20 22 4 22 4 12"/>
                        <path d="M22 7H2v5h20V7z"/>
                        <path d="M12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
                      </svg>
                    </div>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:"#fff", fontSize:13, fontWeight:600,
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      {item.card.name}
                    </div>
                    <div style={{ color:"#555", fontSize:11, marginTop:1 }}>
                      {item.card.set?.name}
                    </div>
                    {item.soldAt && (
                      <div style={{ color:"#444", fontSize:10, marginTop:2 }}>
                        Sold {new Date(item.soldAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#fff" }}>
                      {fmt(soldPrice)}
                    </div>
                    <div style={{ color: pnl>=0 ? TEAL : "#ef4444", fontSize:12, fontWeight:700 }}>
                      {pnl>=0?"+":""}{fmt(pnl)}
                      {pnlPct && <span style={{ color:"#555", fontSize:10, fontWeight:400 }}> ({pnlPct}%)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Trade list sub-tab
  if (collSubTab === "trade") {
    const tradeItems = collection.filter(i => tradeList.includes(i.id));
    const selected = tradeSelection || [];
    const selectedItems = tradeItems.filter(i => selected.includes(i.id));
    const marketTotal = selectedItems.reduce((s,i) => s + (genPrices(i.card).raw[i.condition]||0), 0);

    const PRICING_MODES = [
      { id:"market",  label:"Market Value",  calc: v => v },
      { id:"credit",  label:"Store Credit",  calc: v => v * 0.70 },
      { id:"cash",    label:"Cash Trade",    calc: v => v * 0.60 },
      { id:"private", label:"Private Sell",  calc: v => v * 0.88 },
    ];
    const mode = PRICING_MODES.find(m => m.id === (tradePricingMode||"market")) || PRICING_MODES[0];
    const payoutTotal = mode.calc(marketTotal);

    const toggleSelect = (id) => {
      setTradeSelection(prev => {
        const cur = prev || [];
        return cur.includes(id) ? cur.filter(x=>x!==id) : [...cur, id];
      });
    };
    const selectAll = () => setTradeSelection(tradeItems.map(i=>i.id));
    const clearSelection = () => setTradeSelection([]);

    return (
      <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"14px 20px 10px", borderBottom:`1px solid ${BORDER}`, flexShrink:0,
          display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={()=>setCollSubTab("collection")} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
            <Icon.Close size={18} color="#888"/>
          </button>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff", letterSpacing:1 }}>
            TRADE LIST
          </div>
          <div style={{ marginLeft:"auto", color:"#555", fontSize:12 }}>
            {selected.length} of {tradeItems.length} selected
          </div>
        </div>

        {tradeItems.length === 0 ? (
          <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, color:"#444" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
            </svg>
            <div style={{ fontSize:14 }}>No cards in your trade list</div>
            <div style={{ fontSize:12, color:"#333" }}>Tap the trade icon on any card to add it</div>
          </div>
        ) : (
          <>
            {/* Pricing mode pills */}
            <div style={{ display:"flex", gap:6, padding:"10px 16px", overflowX:"auto", flexShrink:0,
              borderBottom:`1px solid ${BORDER}` }}>
              {PRICING_MODES.map(m => (
                <button key={m.id} onClick={()=>setTradePricingMode(m.id)} style={{
                  padding:"6px 12px", borderRadius:20, flexShrink:0, whiteSpace:"nowrap",
                  background: mode.id===m.id ? TEAL+"22" : "#1a1a1a",
                  border: `1px solid ${mode.id===m.id ? TEAL : BORDER}`,
                  color: mode.id===m.id ? TEAL : "#666",
                  fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
                }}>{m.label}{m.id!=="market" ? ` (${Math.round(m.calc(1)*100)}%)` : ""}</button>
              ))}
            </div>

            {/* Select all / clear */}
            <div style={{ display:"flex", gap:12, padding:"8px 16px", flexShrink:0 }}>
              <button onClick={selectAll} style={{ background:"none", border:"none", color:TEAL,
                fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Select All</button>
              <button onClick={clearSelection} style={{ background:"none", border:"none", color:"#555",
                fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Clear</button>
            </div>

            <div style={{ flex:1, overflowY:"auto" }}>
              {tradeItems.map(item => {
                const p = genPrices(item.card);
                const val = p.raw[item.condition] || 0;
                const isSelected = selected.includes(item.id);
                return (
                  <div key={item.id} style={{ display:"flex", alignItems:"center", gap:12,
                    padding:"12px 20px", borderBottom:`1px solid ${BORDER}`, cursor:"pointer",
                    background: isSelected ? TEAL+"0a" : "transparent" }}
                    onClick={() => toggleSelect(item.id)}>
                    <div style={{ width:22, height:22, borderRadius:6, flexShrink:0,
                      border:`2px solid ${isSelected ? TEAL : "#333"}`,
                      background: isSelected ? TEAL : "transparent",
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {isSelected && <Icon.Check size={14} color="#000"/>}
                    </div>
                    <img src={item.card.images?.small} alt={item.card.name} loading="lazy"
                      style={{ width:44, height:62, objectFit:"contain", borderRadius:4 }}/>
                    <div style={{ flex:1, minWidth:0 }} onClick={e=>{ e.stopPropagation(); onCardPress(item); }}>
                      <div style={{ color:"#fff", fontSize:13, fontWeight:600,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.card.name}</div>
                      <div style={{ color:"#555", fontSize:11 }}>{item.card.set?.name} · #{item.card.number}</div>
                      <div style={{ color:TEAL, fontSize:12, marginTop:2 }}>{fmt(val)}</div>
                    </div>
                    <button onClick={e=>{ e.stopPropagation(); onToggleTrade(item.id); }}
                      style={{ background:"#2a1a1a", border:"1px solid #ef4444", borderRadius:8,
                        padding:"6px 10px", color:"#ef4444", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Sticky total bar — offset by 60px (tab bar height) so it sticks
                just above the fixed bottom nav instead of behind/below it. The
                outer scroll container adds 60px+safe-area padding to make room
                for the nav, which pushed bottom:0 stickiness past the visible
                screen edge. */}
            {selected.length > 0 && (
              <div style={{ position:"sticky", bottom:0, zIndex:5, padding:"16px 20px",
                paddingBottom:16,
                borderTop:`1px solid ${BORDER}`, borderBottom:`1px solid ${BORDER}`,
                background:"#0d0d0d", boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
                  <span style={{ color:"#666", fontSize:12 }}>{mode.label} · {selected.length} cards</span>
                  <span style={{ color:"#555", fontSize:11 }}>Market: {fmt(marketTotal)}</span>
                </div>
                <div style={{ color:TEAL, fontSize:28, fontFamily:"'Bebas Neue',sans-serif", letterSpacing:0.5 }}>
                  {fmt(payoutTotal)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"14px 20px 0", background:BG, borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:"#fff", letterSpacing:1 }}>
            PORTFOLIO
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
              <button onClick={onRefreshPrices} disabled={refreshing} title="Refresh all prices"
                style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"none",
                  color: refreshing ? "#444" : "#666", fontSize:11,
                  cursor: refreshing ? "default" : "pointer", fontFamily:"inherit", padding:"4px 6px" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}>
                  <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M20 9a8 8 0 00-14.93-2M4 15a8 8 0 0014.93 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
              {(() => {
                const ts = parseInt(localStorage.getItem(PRICES_REFRESHED_KEY) || "0", 10);
                if (!ts) return null;
                const mins = Math.floor((Date.now() - ts) / 60000);
                const label = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
                return <span style={{ color:"#333", fontSize:9, paddingRight:6 }}>Updated {label}</span>;
              })()}
            </div>
            <button onClick={onImport} style={{ display:"flex", alignItems:"center", gap:6,
              background:TEAL, border:"none", borderRadius:20, padding:"8px 14px",
              fontFamily:"'Bebas Neue',sans-serif", fontSize:13, letterSpacing:0.5,
              color:"#000", cursor:"pointer" }}>
              <Icon.Import size={16} color="#000"/> TCG IMPORT
            </button>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16, color:"#fff",
              letterSpacing:0.5, textAlign:"right" }}>
              <div style={{ color:"#555", fontSize:10 }}>{sorted.length}/{totalCount} CARDS</div>
              {fmtCompact(totalVal)}
            </div>
          </div>
        </div>

        {/* Min value filter pills */}
        <div style={{ display:"flex", gap:6, padding:"8px 0 4px", overflowX:"auto" }}>
          <span style={{ color:"#555", fontSize:11, alignSelf:"center", flexShrink:0 }}>Hide under:</span>
          {MIN_VALUE_OPTIONS.map(v => (
            <button key={v} onClick={()=>setMinValue(v)} style={{
              padding:"4px 10px", borderRadius:20, flexShrink:0,
              background: minValue===v ? TEAL+"22" : "#1a1a1a",
              border: `1px solid ${minValue===v ? TEAL : BORDER}`,
              color: minValue===v ? TEAL : "#555",
              fontSize:11, cursor:"pointer", fontFamily:"inherit",
            }}>{v===0 ? "Off" : `$${v}`}</button>
          ))}
          <button onClick={()=>setShowTagFilter(v=>!v)} style={{
            padding:"4px 12px", borderRadius:20, flexShrink:0, marginLeft:"auto",
            background: (showTagFilter || activeTagFilters.length > 0) ? TEAL+"22" : "#1a1a1a",
            border:`1px solid ${(showTagFilter || activeTagFilters.length > 0) ? TEAL : BORDER}`,
            color:(showTagFilter || activeTagFilters.length > 0) ? TEAL : "#555",
            fontSize:11, cursor:"pointer", fontFamily:"inherit",
            display:"flex", alignItems:"center", gap:5,
          }}>
            🏷 Tags {activeTagFilters.length > 0 && <span style={{ background:TEAL, color:"#000",
              borderRadius:"50%", width:16, height:16, fontSize:9, fontWeight:800,
              display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
              {activeTagFilters.length}</span>}
          </button>
        </div>

        {/* Active tag filter chips */}
        {activeTagFilters.length > 0 && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", padding:"4px 0 8px" }}>
            {activeTagFilters.map(t => (
              <TagChip key={t} tag={t} size="sm" isActive
                onRemove={tag=>setActiveTagFilters(f=>f.filter(x=>x!==tag))}/>
            ))}
            <button onClick={()=>setActiveTagFilters([])} style={{
              background:"none", border:"none", color:"#555", fontSize:11,
              cursor:"pointer", padding:"2px 4px", fontFamily:"inherit" }}>Clear all</button>
          </div>
        )}

        {/* Tag filter panel */}
        {showTagFilter && (
          <div style={{ background:"#0d0d0d", border:`1px solid ${BORDER}`, borderRadius:12,
            padding:"12px 14px", marginBottom:8, maxHeight:280, overflowY:"auto" }}>
            {TAG_FILTER_GROUPS.map(group => (
              <div key={group.label} style={{ marginBottom:10 }}>
                <div style={{ color:"#444", fontSize:9, letterSpacing:0.5, marginBottom:6 }}>
                  {group.label.toUpperCase()}
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {group.tags.map(tag => {
                    const isActive = activeTagFilters.includes(tag);
                    return (
                      <TagChip key={tag} tag={tag} size="sm" isActive={isActive}
                        onClick={()=>setActiveTagFilters(f =>
                          isActive ? f.filter(x=>x!==tag) : [...f, tag]
                        )}/>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:"flex", gap:0, marginBottom:-1 }}>
          {[["collection","Collection"], ["mastersets","Master Sets"], ["trade","Trade List"], ["sold","Sold"]].map(([id, label]) => (
            <button key={id} onClick={() => setCollSubTab(id)} style={{
              background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
              fontSize:13, fontWeight:600, padding:"8px 12px 10px",
              color: collSubTab===id ? TEAL : "#555",
              borderBottom: `2px solid ${collSubTab===id ? TEAL : "transparent"}`,
              transition:"all 0.15s",
              position:"relative" }}>
              {label}
              {id==="trade" && tradeList.length > 0 && (
                <span style={{ position:"absolute", top:4, right:4, background:TEAL, color:"#000",
                  borderRadius:"50%", width:14, height:14, fontSize:8, fontWeight:700,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {tradeList.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Search + sort */}
      <div style={{ padding:"12px 16px 8px", flexShrink:0 }}>
        <div style={{ display:"flex", gap:8, marginBottom:10 }}>
          <div style={{ position:"relative", flex:1 }}>
            <div style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}>
              <Icon.Search size={16} color="#555"/>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search your collection..." autoCorrect="off" autoComplete="off" autoCapitalize="none" spellCheck={false}
              style={{ width:"100%", padding:"10px 12px 10px 36px", background:CARD,
                border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
          </div>
          <button onClick={() => { setBulkMode(m => !m); setBulkSelected(new Set()); }}
            style={{ flexShrink:0, padding:"10px 14px", borderRadius:12, fontSize:12, fontWeight:600,
              background: bulkMode ? TEAL+"22" : CARD,
              border: `1px solid ${bulkMode ? TEAL : BORDER}`,
              color: bulkMode ? TEAL : "#666", cursor:"pointer", fontFamily:"inherit" }}>
            {bulkMode ? "Done" : "Select"}
          </button>
        </div>
        <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4 }}>
          {[["date_desc","Recently Added"],["value_desc","Highest Value"],["value_asc","Lowest Value"],
            ["pnl_desc","Most Profit"],["pnl_asc","Least Profit"],["name_asc","A → Z"]].map(([id, label]) => (
            <button key={id} onClick={() => setSort(id)} style={{
              background: sort===id ? TEAL : "none",
              color: sort===id ? "#000" : "#555",
              border:`1px solid ${sort===id ? TEAL : BORDER}`,
              borderRadius:20, padding:"5px 12px", fontSize:11,
              whiteSpace:"nowrap", cursor:"pointer", fontFamily:"inherit",
              fontWeight: sort===id ? 700 : 400 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Card grid — group duplicates (same card id + condition) */}
      <div style={{ flex:1, overflowY:"auto", padding:"4px 12px 40px" }}>
        {sorted.length === 0 ? (
          <div style={{ textAlign:"center", color:"#444", padding:40, fontSize:14 }}>
            {search ? "No cards match your search" : "No cards in collection"}
          </div>
        ) : (() => {
          // Group by card.id + condition
          const groupMap = new Map();
          sorted.forEach(item => {
            const key = `${item.card.id}__${item.condition}`;
            if (!groupMap.has(key)) groupMap.set(key, { item, count:0 });
            groupMap.get(key).count++;
          });
          const groups = Array.from(groupMap.values());
          return (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10 }}>
              {groups.map(({ item, count }) => {
                const p = genPrices(item.card);
                const val = p.raw[item.condition] || 0;
                const isBulkSelected = bulkSelected.has(item.id);
                const handleClick = () => {
                  if (bulkMode) {
                    setBulkSelected(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                      return next;
                    });
                  } else {
                    onCardPress(item);
                  }
                };
                return (
                  <div key={item.id} onClick={handleClick}
                    style={{ background:CARD,
                      border:`1px solid ${isBulkSelected ? TEAL : BORDER}`, borderRadius:16,
                      overflow:"hidden", cursor:"pointer", transition:"border-color 0.15s",
                      opacity: bulkMode && !isBulkSelected ? 0.65 : 1 }}
                    onMouseEnter={e => { if (!bulkMode) e.currentTarget.style.borderColor = TEAL+"44"; }}
                    onMouseLeave={e => { if (!bulkMode) e.currentTarget.style.borderColor = BORDER; }}>
                    <div style={{ position:"relative" }}>
                      {item.card.images?.small ? (
                        <img src={item.card.images.small} alt={item.card.name} loading="lazy"
                          style={{ width:"100%", aspectRatio:"63/88", objectFit:"cover", display:"block", background:"#1a1a1a" }}
                          onError={e => { e.target.style.display="none"; e.target.nextSibling.style.display="flex"; }}/>
                      ) : null}
                      <div style={{ display: item.card.images?.small ? "none" : "flex",
                        width:"100%", aspectRatio:"63/88", background:"#1a1a1a",
                        alignItems:"center", justifyContent:"center", flexDirection:"column", gap:6 }}>
                        <div style={{ color:"#333", fontSize:9, textAlign:"center", padding:"0 8px" }}>
                          {item.card.name}
                        </div>
                      </div>
                      {/* Condition badge */}
                      <div style={{ position:"absolute", top:6, right:6,
                        background: condColors[item.condition]+"cc", color:"#000",
                        fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:6 }}>
                        {condLabels[item.condition]?.split(" ").map(w=>w[0]).join("") || "NM"}
                      </div>
                      {/* Bulk select checkbox */}
                      {bulkMode && (
                        <div style={{ position:"absolute", top:6, left:6,
                          width:20, height:20, borderRadius:6,
                          border:`2px solid ${isBulkSelected ? TEAL : "#555"}`,
                          background: isBulkSelected ? TEAL : "rgba(0,0,0,0.6)",
                          display:"flex", alignItems:"center", justifyContent:"center" }}>
                          {isBulkSelected && <Icon.Check size={12} color="#000"/>}
                        </div>
                      )}
                      {/* Count badge — bottom left, only when >1 and not in bulk mode */}
                      {count > 1 && !bulkMode && (
                        <div style={{ position:"absolute", bottom:6, left:6,
                          background:"rgba(0,0,0,0.85)", border:`1.5px solid ${TEAL}`,
                          color:TEAL, fontSize:11, fontWeight:700,
                          width:22, height:22, borderRadius:"50%",
                          display:"flex", alignItems:"center", justifyContent:"center" }}>
                          {count}
                        </div>
                      )}
                    </div>
                    <div style={{ padding:"8px 10px 10px" }}>
                      <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:14,
                        color:"#fff", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {item.card.name}
                      </div>
                      <div style={{ color:"#555", fontSize:10, marginTop:1 }}>{item.card.set?.name}</div>
                      {/* Role tags — show up to 2 gameplay-role tags */}
                      {(() => {
                        const roleTags = (item.autoTags || []).filter(t => {
                          const m = getTagMeta(t);
                          return m.cat === "role" || m.cat === "keyword";
                        }).slice(0,2);
                        const userT = (item.userTags || []).slice(0,1);
                        const show = [...roleTags, ...userT].slice(0,2);
                        return show.length > 0 ? (
                          <div style={{ display:"flex", gap:3, marginTop:4, flexWrap:"nowrap", overflow:"hidden" }}>
                            {show.map(t => <TagChip key={t} tag={t} size="sm"/>)}
                          </div>
                        ) : null;
                      })()}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
                        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
                          color: val > 0 ? TEAL : "#333", letterSpacing:0.5 }}>
                          {val > 0 ? fmt(val) : (
                            <span style={{ fontSize:10, color:"#444", fontFamily:"inherit", fontWeight:400, letterSpacing:0 }}>
                              {"Price unavailable"}
                            </span>
                          )}
                        </div>
                        <Spark data={p.history} color={TEAL}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Bulk action bar */}
      {bulkMode && bulkSelected.size > 0 && (
        <div style={{ position:"sticky", bottom:0, zIndex:10,
          padding:"14px 20px", borderTop:`1px solid ${BORDER}`, background:"#0d0d0d",
          boxShadow:"0 -4px 20px rgba(0,0,0,0.6)", display:"flex", gap:10, alignItems:"center" }}>
          <span style={{ color:"#888", fontSize:12, flex:1 }}>{bulkSelected.size} selected</span>
          <button onClick={() => setBulkCondPicker(true)}
            style={{ padding:"10px 16px", background:TEAL+"22", border:`1px solid ${TEAL}`,
              borderRadius:10, color:TEAL, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            Edit Condition
          </button>
          <button onClick={() => {
            if (!confirm(`Delete ${bulkSelected.size} card${bulkSelected.size!==1?"s":""}?`)) return;
            onBulkDelete?.([...bulkSelected]);
            setBulkMode(false); setBulkSelected(new Set());
          }} style={{ padding:"10px 16px", background:"rgba(239,68,68,0.1)", border:"1px solid #ef4444",
            borderRadius:10, color:"#ef4444", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            Delete
          </button>
        </div>
      )}

      {/* Bulk condition picker */}
      {bulkCondPicker && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:10100,
          display:"flex", alignItems:"flex-end" }} onClick={() => setBulkCondPicker(false)}>
          <div style={{ width:"100%", background:"#111", borderRadius:"20px 20px 0 0",
            padding:"20px 20px calc(20px + env(safe-area-inset-bottom, 0px))" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff",
              letterSpacing:1, marginBottom:16 }}>
              SET CONDITION — {bulkSelected.size} CARDS
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {Object.entries(condLabels).map(([key, label]) => (
                <button key={key} onClick={() => {
                  onBulkCondition?.([...bulkSelected], key);
                  setBulkCondPicker(false); setBulkMode(false); setBulkSelected(new Set());
                }} style={{ padding:"12px 10px", background:CARD,
                  border:`1px solid ${condColors[key]||BORDER}`,
                  borderRadius:10, color: condColors[key] || "#fff",
                  fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setBulkCondPicker(false)}
              style={{ width:"100%", marginTop:12, padding:12, background:"none",
                border:`1px solid ${BORDER}`, borderRadius:10, color:"#666",
                fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Camera / Scan View ───────────────────────────────────────────────────────
function ScanView({ onResult, onClose, setFilter = null, setCards = null, setId = null, onSearchFallback = null, globalWorker = null, visible = true }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const overlayCanvasRef = useRef(null); // transparent canvas for drawing detected card outline
  const fileRef     = useRef(null);
  const streamRef   = useRef(null);
  const loopRef     = useRef(null);
  const prevFrame   = useRef(null);
  const stillCount  = useRef(0);
  const lastB64     = useRef(null);  // last captured frame for OCR fallback
  const workerRef        = useRef(null);   // embedding web worker
  const embedReadyRef    = useRef(false);  // ref mirror of embedReady for RAF loop
  const embedProgressRef = useRef(null);   // ref mirror of embedProgress for RAF loop
  const [streaming,    setStreaming]    = useState(false);
  const [analyzing,    setAnalyzing]    = useState(false);
  const [motionHint,   setMotionHint]   = useState("Preparing scanner...");
  const [err,          setErr]          = useState("");
  const [debugMode,    setDebugMode]    = useState(false);
  const [debugLog,     setDebugLog]     = useState([]);
  const [debugMatches, setDebugMatches] = useState([]); // [{name,number,score,imageUrl}]
  const [embedProgress, setEmbedProgress] = useState(null); // {done,total} or null
  const [embedReady,   setEmbedReady]   = useState(false); // set true only after globalIndexLoaded
  const [pickerMatches, setPickerMatches] = useState(null); // [{name,number,score,imageUrl,_card}] when shown
  const [pickerSearch,  setPickerSearch]  = useState("");
  const [pickerSearchResults, setPickerSearchResults] = useState([]);
  const [pickerSearching, setPickerSearching] = useState(false);
  const [pickerVariant, setPickerVariant] = useState(null); // "nonfoil"|"foil" — null = user decides at confirm
  const lastVecRef = useRef(null); // Float32Array of the last query embedding, for saving
  const analyzeTimeoutRef = useRef(null); // safety timeout for analyze()
  const dbg = (msg) => setDebugLog(prev => [`${new Date().toLocaleTimeString()}: ${msg}`, ...prev].slice(0, 20));

  // ── Wire global worker when provided (bypasses per-set embedding) ─────────────
  useEffect(() => {
    if (!globalWorker) return;
    workerRef.current = globalWorker;
    // globalWorker only passed after globalIndexLoaded+model loaded
    embedReadyRef.current = true;
    setEmbedReady(true);
    setMotionHint("Fill the frame with your card");
  }, [globalWorker]);


  // ── IndexedDB helpers ─────────────────────────────────────────────────────
  const IDB_NAME  = "mtgtracker-embeddings-v1"; // v2 = DINOv2 (was CLIP)
  const IDB_STORE = "sets";
  const GLOBAL_IDB_NAME  = "mtgtracker-global-index";
  const GLOBAL_IDB_STORE = "index";

  const idbGet = (key, dbName=IDB_NAME, storeName=IDB_STORE) => new Promise((resolve) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(storeName);
    req.onsuccess = e => {
      const tx = e.target.result.transaction(storeName, "readonly");
      const r = tx.objectStore(storeName).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror   = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });

  const idbSet = (key, value, dbName=IDB_NAME, storeName=IDB_STORE) => new Promise((resolve) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(storeName);
    req.onsuccess = e => {
      const tx = e.target.result.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => resolve(false);
    };
    req.onerror = () => resolve(false);
  });

  // ── Boot: try global index first, fall back to per-set CLIP embedding ────────
  useEffect(() => {
    if (!setCards?.length) return;

    const cacheKey = setId || setCards[0]?._full?.set?.id || "unknown";
    let cancelled = false;
    let worker = null;

    const spawnWorker = () => {
      worker = new Worker(new URL("./embedWorker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;

      worker.onerror = (e) => {
        if (cancelled) return;
        setDebugLog(prev => [`[worker crash] ${e.message || "unknown"}`, ...prev].slice(0,20));
        setEmbedReady(false); embedReadyRef.current = false;
        setMotionHint("Scanner unavailable — use Search");
      };

      worker.onmessage = (e) => {
        if (cancelled) return;
        const { type } = e.data;

        if (type === "ready") {
          // Will be handled by caller after spawn
        }
        if (type === "progress") {
          const prog = { done: e.data.done, total: e.data.total };
          setEmbedProgress(prog); embedProgressRef.current = prog;
          setMotionHint(`Fingerprinting ${e.data.done}/${e.data.total}...`);
        }
        if (type === "setEmbeddings") {
          if (e.data.embeddings) {
            const key = e.data.cacheKey || cacheKey;
            idbSet(key, e.data.embeddings).then(ok =>
              setDebugLog(prev => [`Saved ${e.data.embeddings.length} fingerprints (${ok?"ok":"failed"})`, ...prev].slice(0,20))
            );
            const user = getCurrentUser();
            if (user && isFirebaseConfigured() && key) {
              saveEmbeddingsToFirestore(key, e.data.embeddings).catch(() => {});
            }
          }
          if (!e.data.cacheKey) {
            setEmbedProgress(null); embedProgressRef.current = null;
            setEmbedReady(true); embedReadyRef.current = true;
            setMotionHint("Fill the frame with your card");
          }
        }
        if (type === "loadedEmbeddings" || type === "globalIndexLoaded") {
          setEmbedProgress(null); embedProgressRef.current = null;
          setEmbedReady(true); embedReadyRef.current = true;
          setMotionHint("Fill the frame with your card");
          setDebugLog(prev => [`Ready: ${e.data.count} fingerprints`, ...prev].slice(0,20));
        }
        if (type === "log") {
          setDebugLog(prev => [`[worker] ${e.data.msg}`, ...prev].slice(0,20));
        }
        if (type === "queryResult") {
          if (e.data.queryVec) lastVecRef.current = new Float32Array(e.data.queryVec);
          handleEmbedResult(e.data.matches, e.data.wasGlobal);
        }
        if (type === "error") {
          setDebugLog(prev => [`[worker ERR] ${e.data.msg}`, ...prev].slice(0,20));
          setEmbedReady(false); embedReadyRef.current = false;
          setMotionHint("Fill the frame with your card");
          setAnalyzing(false); startLoop();
        }
      };

      return worker;
    };

    (async () => {
      if (cancelled) return;

      // ── Path 1: Global index in IDB — filter to this set ────────────────────
      // Check if global index is available and newer than per-set cache
      const globalBuffer = await idbGet("index-buffer", GLOBAL_IDB_NAME, GLOBAL_IDB_STORE);
      const cardsMeta    = await idbGet("index-cards",  GLOBAL_IDB_NAME, GLOBAL_IDB_STORE);

      if (globalBuffer && cardsMeta) {
        dbg(`Global index found — filtering to set "${cacheKey}"`);
        setMotionHint(`Loading set from global index...`);

        // Parse binary index and filter to cards belonging to this set
        // Binary format: 4 magic + 4 version + 4 count + 4 dims, then [ID_LEN + dims*4] per card
        const view   = new DataView(globalBuffer);
        const count  = view.getUint32(8, true);
        const dims   = view.getUint32(12, true);
        const ID_LEN = 20;
        const dec    = new TextDecoder("ascii");

        // Build set-filtered embeddings list
        const filtered = [];
        let offset = 16;
        for (let i = 0; i < count; i++) {
          const idBytes = new Uint8Array(globalBuffer, offset, ID_LEN);
          let end = idBytes.indexOf(0); if (end === -1) end = ID_LEN;
          const cardId = dec.decode(idBytes.slice(0, end));
          offset += ID_LEN;
          const vec = new Float32Array(globalBuffer, offset, dims);
          offset += dims * 4;

          // Match by set prefix: "sv3-201" starts with "sv3-"
          // Also handle numeric setIds stored as group IDs
          const cardSetId = cardId.split("-").slice(0,-1).join("-");
          const matchSet  = cardSetId === cacheKey ||
                            cardId.startsWith(cacheKey + "-") ||
                            (cardsMeta[cardId]?.set?.id === cacheKey);
          if (matchSet) {
            // Use card number as ID to match existing handleEmbedResult lookup
            const meta = cardsMeta[cardId];
            const num  = meta?.number || cardId.split("-").pop();
            filtered.push({ id: num, vec: Array.from(vec), _cardId: cardId });
          }
        }

        dbg(`Filtered ${filtered.length} cards for set ${cacheKey}`);

        if (filtered.length > 0) {
          // Also merge crowdsourced fingerprints
          const sharedFps = await loadSharedFingerprints(cacheKey).catch(() => null);
          const extras = sharedFps
            ? Object.entries(sharedFps).flatMap(([id, fps]) =>
                fps.map(fp => ({ id, vec: fp.vec, extra: true })))
            : [];

          const w = spawnWorker();
          await new Promise(res => {
            const orig = w.onmessage;
            w.onmessage = (e) => {
              if (e.data.type === "ready") {
                w.onmessage = orig;
                res();
              } else { orig?.(e); }
            };
            w.postMessage({ type: "init" });
          });
          if (cancelled) return;
          w.postMessage({ type: "loadEmbeddings", embeddings: [...filtered, ...extras] });
          return;
        }
        dbg(`No cards found for set ${cacheKey} in global index — falling back to CLIP`);
      }

      // ── Path 2: Per-set IDB cache (existing CLIP embeddings) ────────────────
      const localCached = await idbGet(cacheKey);
      if (localCached?.length) {
        dbg(`Found ${localCached.length} CLIP fingerprints in local cache`);
        setMotionHint("Loading AI model...");
        const w = spawnWorker();
        await new Promise(res => {
          const orig = w.onmessage;
          w.onmessage = (e) => {
            if (e.data.type === "ready") { w.onmessage = orig; res(); }
            else orig?.(e);
          };
          w.postMessage({ type: "init" });
        });
        if (cancelled) return;
        w.postMessage({ type: "loadEmbeddings", embeddings: localCached });
        return;
      }

      // ── Path 3: Firestore shared CLIP embeddings ─────────────────────────────
      if (isFirebaseConfigured()) {
        const fbCached = await loadEmbeddingsFromFirestore(cacheKey);
        if (fbCached?.length) {
          dbg(`Loaded ${fbCached.length} CLIP fingerprints from Firestore`);
          idbSet(cacheKey, fbCached).catch(() => {});
          const sharedFps = await loadSharedFingerprints(cacheKey).catch(() => null);
          const extras = sharedFps
            ? Object.entries(sharedFps).flatMap(([id, fps]) =>
                fps.map(fp => ({ id, vec: fp.vec, extra: true })))
            : [];
          const w = spawnWorker();
          await new Promise(res => {
            const orig = w.onmessage;
            w.onmessage = (e) => {
              if (e.data.type === "ready") { w.onmessage = orig; res(); }
              else orig?.(e);
            };
            w.postMessage({ type: "init" });
          });
          if (cancelled) return;
          w.postMessage({ type: "loadEmbeddings", embeddings: [...fbCached, ...extras] });
          return;
        }
      }

      // ── Path 4: Compute fresh CLIP embeddings (slowest, first-time only) ────
      const toEmbed = setCards
        .map(c => ({
          id:       c.number,
          name:     c.name,
          imageUrl: c._full?.images?.small || c._full?.images?.large || "",
        }))
        .filter(c => c.imageUrl);

      if (!toEmbed.length) return;
      dbg(`Computing fresh CLIP embeddings for ${toEmbed.length} cards`);
      setMotionHint(`Building fingerprints (${toEmbed.length} cards)...`);
      const w = spawnWorker();
      await new Promise(res => {
        const orig = w.onmessage;
        w.onmessage = (e) => {
          if (e.data.type === "ready") { w.onmessage = orig; res(); }
          else orig?.(e);
        };
        w.postMessage({ type: "init" });
      });
      if (cancelled) return;
      w.postMessage({ type: "embedSet", cards: toEmbed });
    })();

    return () => {
      cancelled = true;
      if (worker) worker.terminate();
      workerRef.current = null;
    };
  }, [setCards]);

  // Called when worker returns top matches
  const handleEmbedResult = (matches, wasGlobal) => {
    if (analyzeTimeoutRef.current) { clearTimeout(analyzeTimeoutRef.current); analyzeTimeoutRef.current = null; }
    // Global mode: pass matches back to GlobalScanFlow via onResult with raw match data
    if (wasGlobal || (globalWorker && !setCards?.length)) {
      setAnalyzing(false);
      if (lastVecRef.current) {
        stop();
        onResult({ _globalMatches: matches, _queryVec: Array.from(lastVecRef.current), finish: capturedFinishRef.current?.finish || "normal" });
      } else {
        startLoop();
      }
      return;
    }

    if (!matches?.length || !setCards?.length) {
      setAnalyzing(false);
      showPicker(matches || []);
      return;
    }

    const top = matches[0];
    dbg(`Top: #${top.id} ${top.score.toFixed(3)} | 2nd: #${matches[1]?.id} ${matches[1]?.score.toFixed(3)}`);

    // Build enriched match list
    const enriched = matches.slice(0, 5).map(m => {
      const card = setCards.find(c => String(parseInt(c.number||"0",10)) === String(parseInt(m.id||"0",10)));
      return { name: card?.name || `#${m.id}`, number: m.id, score: m.score,
               imageUrl: card?._full?.images?.small || "", _card: card?._full || null };
    });
    setDebugMatches(enriched);

    // High confidence — auto-accept
    const gap = top.score - (matches[1]?.score ?? 0);
    const confident = top.score > 0.82 || (top.score > 0.72 && gap > 0.07);

    if (confident) {
      const card = setCards.find(c => String(parseInt(c.number||"0",10)) === String(parseInt(top.id||"0",10)));
      if (card) {
        // Save this frame as an extra fingerprint — strengthens future recognition
        if (lastVecRef.current && workerRef.current && top.score < 0.92) {
          const ck = setId || setCards[0]?._full?.set?.id || "unknown";
          workerRef.current.postMessage({
            type: "addFingerprint",
            id:   card.number,
            vec:  Array.from(lastVecRef.current),
            cacheKey: ck,
          });
          // Also push to shared Firestore fingerprints
          if (isFirebaseConfigured()) {
            pushFingerprintToShared(ck, card.number, lastVecRef.current).catch(() => {});
          }
          dbg(`Auto-saved fingerprint for ${card.name} (score ${top.score.toFixed(3)})`);
        }
        stop();
        onResult({ name: card.name, number: card.number, finish: capturedFinishRef.current?.finish || "normal", detected: true, _card: card._full, _alternates: enriched });
        return;
      }
    }

    // Low confidence — show picker instead of retrying forever
    dbg(`Low confidence (${top.score.toFixed(3)}, gap ${gap.toFixed(3)}) — showing picker`);
    setAnalyzing(false);
    showPicker(enriched);
  };

  // Show the match picker popup
  const showPicker = (enriched) => {
    cancelAnimationFrame(loopRef.current);
    setPickerMatches(enriched);
  };

  // User picked a card from the picker
  const onPickerSelect = (picked) => {
    // Save this frame's embedding as an extra fingerprint for this card
    if (lastVecRef.current && workerRef.current && picked._card) {
      const ck = setId || setCards[0]?._full?.set?.id || "unknown";
      workerRef.current.postMessage({
        type: "addFingerprint",
        id:   picked.number,
        vec:  Array.from(lastVecRef.current),
        cacheKey: ck,
      });
      // Push to shared Firestore fingerprints
      if (isFirebaseConfigured()) {
        pushFingerprintToShared(ck, picked.number, lastVecRef.current).catch(() => {});
      }
      dbg(`Saved extra fingerprint for ${picked.name} #${picked.number}`);
    }
    setPickerMatches(null);
    setPickerVariant(null);
    stop();
    onResult({ name: picked.name, number: picked.number, finish: pickerVariant || capturedFinishRef.current?.finish || "normal", detected: true, _card: picked._card });
  };

  // Search within picker — filter setCards locally, or call API for global mode
  useEffect(() => {
    if (!pickerSearch.trim()) { setPickerSearchResults([]); return; }
    const q = pickerSearch.trim().toLowerCase();
    let cancelled = false;
    setPickerSearching(true);
    if (setCards && setCards.length > 0) {
      const hits = setCards
        .filter(c => (c.name||"").toLowerCase().includes(q) || String(c.number).includes(q))
        .slice(0, 12)
        .map(c => ({ name: c.name, number: c.number, score: 1, imageUrl: c._full?.images?.small || "", _card: c._full || c }));
      if (!cancelled) { setPickerSearchResults(hits); setPickerSearching(false); }
    } else {
      const t = setTimeout(async () => {
        try {
          const results = await searchCards(q, 12);
          if (!cancelled) setPickerSearchResults(
            (results||[]).map(c => ({ name:c.name, number:c.number, score:1, imageUrl:c.images?.small||"", _card:c }))
          );
        } catch(_) {}
        if (!cancelled) setPickerSearching(false);
      }, 350);
      return () => clearTimeout(t);
    }
    return () => { cancelled = true; };
  }, [pickerSearch, setCards]);

  const stop = () => {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setStreaming(false);
  };

  const frameDiff = (a, b) => {
    if (!a || !b || a.length !== b.length) return 999;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length / 4);
  };

  // Card frame box dimensions — must match what's rendered in the UI
  // We capture only the region inside the frame corners so OCR sees just the card
  const FRAME_W = 240; // px on screen (card width in frame)
  const FRAME_H = 336; // px on screen (card height in frame, ~1.4 ratio)

  // ── Card edge detection + perspective warp ──────────────────────────────────
  // Finds the actual card corners in the frame and does a perspective transform
  // so the embedding sees a clean, axis-aligned card — not a tilted rectangle
  // with background noise. Falls back to simple crop if detection fails.

  const detectCardCorners = (imageData, w, h) => {
    const data = imageData.data;

    // 1. Grayscale + Sobel edges
    const gray  = new Float32Array(w * h);
    const edges = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++)
      gray[i] = 0.299*data[i*4] + 0.587*data[i*4+1] + 0.114*data[i*4+2];
    for (let y = 1; y < h-1; y++) {
      for (let x = 1; x < w-1; x++) {
        const gx = -gray[(y-1)*w+(x-1)] + gray[(y-1)*w+(x+1)]
                   -2*gray[y*w+(x-1)]   + 2*gray[y*w+(x+1)]
                   -gray[(y+1)*w+(x-1)] + gray[(y+1)*w+(x+1)];
        const gy = -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
                   +gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)];
        edges[y*w+x] = Math.sqrt(gx*gx + gy*gy);
      }
    }

    // 2. Inward scan with 35th/65th percentile (original working version)
    const THRESH = 50;
    const findEdgeLine = (scanAlong, scanInto, maxAlong, maxInto, reverse) => {
      const hits = [];
      const step = Math.max(1, Math.round(maxAlong / 40));
      for (let a = 2; a < maxAlong - 2; a += step) {
        const range = Math.round(maxInto * 0.45); // tighter — stops before reaching far hand edge
        for (let di = 0; di < range; di++) {
          const i = reverse ? maxInto - 1 - di : di;
          const idx = scanAlong ? (i * w + a) : (a * w + i);
          if (edges[idx] > THRESH) { hits.push(i); break; }
        }
      }
      if (hits.length < 8) return null;
      hits.sort((a, b) => a - b);
      const pct = reverse ? 0.60 : 0.40;
      return hits[Math.floor(hits.length * pct)];
    };

    const topLine    = findEdgeLine(true,  false, w, h, false);
    const bottomLine = findEdgeLine(true,  false, w, h, true);
    const leftLine   = findEdgeLine(false, true,  h, w, false);
    const rightLine  = findEdgeLine(false, true,  h, w, true);

    if (topLine == null || bottomLine == null || leftLine == null || rightLine == null) return null;

    const cardW = rightLine - leftLine;
    const cardH = bottomLine - topLine;
    if (cardW < w * 0.25 || cardH < h * 0.25) return null;
    if (cardW > w * 0.90 || cardH > h * 0.90) return null; // hand+card fills whole frame
    const aspect = cardH / cardW;
    if (Math.abs(aspect - 88/63) > 0.25) return null; // tighter — hand distorts aspect ratio

    return {
      tl: [leftLine, topLine],
      tr: [rightLine, topLine],
      bl: [leftLine, bottomLine],
      br: [rightLine, bottomLine],
    };
  };

  // Perspective transform — maps 4 source points to a destination rectangle
  // Uses bilinear interpolation for smooth output
  const perspectiveWarp = (srcCanvas, corners, outW, outH) => {
    const dst = document.createElement("canvas");
    dst.width = outW; dst.height = outH;
    const dctx = dst.getContext("2d");

    // Get source image data
    const sctx = srcCanvas.getContext("2d");
    const src  = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const sw = srcCanvas.width, sh = srcCanvas.height;
    const out  = dctx.createImageData(outW, outH);

    const { tl, tr, bl, br } = corners;

    // For each output pixel, compute the corresponding source pixel
    // using inverse bilinear interpolation
    for (let oy = 0; oy < outH; oy++) {
      const ty = oy / outH; // 0..1
      for (let ox = 0; ox < outW; ox++) {
        const tx = ox / outW; // 0..1

        // Bilinear interpolation of source coordinates
        const sx = (1-ty)*((1-tx)*tl[0] + tx*tr[0]) + ty*((1-tx)*bl[0] + tx*br[0]);
        const sy = (1-ty)*((1-tx)*tl[1] + tx*tr[1]) + ty*((1-tx)*bl[1] + tx*br[1]);

        const six = Math.min(sw-1, Math.max(0, Math.round(sx)));
        const siy = Math.min(sh-1, Math.max(0, Math.round(sy)));
        const sIdx = (siy * sw + six) * 4;
        const dIdx = (oy * outW + ox) * 4;

        out.data[dIdx]   = src.data[sIdx];
        out.data[dIdx+1] = src.data[sIdx+1];
        out.data[dIdx+2] = src.data[sIdx+2];
        out.data[dIdx+3] = 255;
      }
    }
    dctx.putImageData(out, 0, 0);
    return dst;
  };

  const captureBase64 = () => {
    const c = canvasRef.current, v = videoRef.current;
    if (!v || !c || v.videoWidth === 0) return null;

    const vw = v.videoWidth, vh = v.videoHeight;
    const dw = v.offsetWidth  || window.innerWidth;
    const dh = v.offsetHeight || (window.innerHeight - 120);
    const coverScale = Math.max(dw / vw, dh / vh);
    const dispW = vw * coverScale;
    const dispH = vh * coverScale;
    const offsetX = (dispW - dw) / 2;
    const offsetY = (dispH - dh) / 2;
    const frameCenterX = dw / 2;
    const frameCenterY = dh / 2;
    const frameLeft = frameCenterX - FRAME_W / 2;
    const frameTop  = frameCenterY - FRAME_H / 2;
    const vFrameLeft   = (frameLeft   + offsetX) / coverScale;
    const vFrameTop    = (frameTop    + offsetY) / coverScale;
    const vFrameWidth  = FRAME_W / coverScale;
    const vFrameHeight = FRAME_H / coverScale;

    // Capture exactly the artwork guide box region — user aligned artwork here
    const ART_W_FRAC = 0.78;
    const ART_RATIO  = 63/44;
    const bw = Math.round(dw * ART_W_FRAC);
    const bh = Math.round(bw / ART_RATIO);
    const bx = Math.round((dw - bw) / 2);
    const by = Math.round(dh * 0.12);

    // Also capture from artwork top down to ~80% of card height for more context
    const extH = Math.round(bh * 1.6); // extends below artwork into attacks zone

    const vBx  = (bx + offsetX) / coverScale;
    const vBy  = (by + offsetY) / coverScale;
    const vBw  = bw / coverScale;
    const vBh2 = extH / coverScale;

    // Capture at 224×224 (DINOv2 native size)
    c.width = 224; c.height = 224;
    c.getContext("2d").drawImage(v, vBx, vBy, vBw, vBh2, 0, 0, 224, 224);
    return c.toDataURL("image/jpeg", 0.90).split(",")[1];
  };

  // ── Fast local card recognition ───────────────────────────────────────────
  // Strategy 1: Native BarcodeDetector (iOS 16+) — reads card number from bottom strip
  // Strategy 2: Tesseract crop of just the name row (top 18% of card)
  // Both match against preloaded setCardList locally — no network calls needed

  // ── Crop a zone from a base64 JPEG and return a new base64 JPEG ─────────────
  // yStart/yEnd are fractions of image height (0..1), same for x
  const cropZone = (b64, yStart, yEnd, xStart = 0, xEnd = 1) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const x = Math.round(img.width * xStart);
        const y = Math.round(img.height * yStart);
        const w = Math.round(img.width * (xEnd - xStart));
        const h = Math.round(img.height * (yEnd - yStart));
        c.width = w; c.height = h;
        // Upscale small crops so Tesseract has more pixels to work with
        const scale = Math.max(1, Math.min(3, 300 / h));
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.92).split(",")[1]);
      };
      img.onerror = () => resolve(b64);
      img.src = "data:image/jpeg;base64," + b64;
    });
  };

  // ── OCR a single zone and return cleaned text lines ───────────────────────
  const ocrZone = async (worker, b64zone) => {
    const byteArr = Uint8Array.from(atob(b64zone), c => c.charCodeAt(0));
    const blob = new Blob([byteArr], { type:"image/jpeg" });
    const { data: { text } } = await worker.recognize(blob);
    return text.split("\n").map(l => l.trim()).filter(l => l.length > 1);
  };

  // ── Extract card number from OCR lines (e.g. "050/086" → "50") ─────────────
  const extractCardNumber = (lines) => {
    for (const line of lines) {
      // Match patterns like "050/086", "50/88", "050 / 086", "SV50/086"
      const m = line.match(/\b([A-Z]{0,3}\d{1,4})\s*\/\s*\d{2,4}\b/);
      if (m) {
        const raw = m[1].replace(/^[A-Z]+/, ""); // strip letter prefix like SV
        const n = parseInt(raw, 10);
        if (!isNaN(n)) return String(n);
      }
    }
    return null;
  };

  // ── Extract Pokémon name from OCR lines (top strip) ──────────────────────
  const extractName = (lines) => {
    // The name is the first meaningful text line, before HP/type info
    // Strip known noise: HP numbers, type symbols, stage labels
    const noise = /^(HP|Stage|Basic|GX|EX|VMAX|VSTAR|VSTAR|ex|V|LV\.?\d*|\d+|[♦●■▲○◆]+)$/i;
    for (const line of lines) {
      const clean = line
        .replace(/\b\d{1,3}\s*HP\b/gi, "")    // "80 HP" or "HP 80"
        .replace(/\bHP\s*\d{1,3}\b/gi, "")
        .replace(/[♦●■▲○◆★☆]/g, "")           // energy/type symbols
        .replace(/[^a-zA-Z0-9'\-é ]/g, " ")    // non-latin chars
        .replace(/\s+/g, " ")
        .trim();
      // Must be at least 3 chars and mostly letters
      if (clean.length >= 3 && /[a-zA-Z]{3}/.test(clean) && !noise.test(clean)) {
        // Strip trailing HP/number if OCR merged them: "Golbat 80" → "Golbat"
        return clean.replace(/\s+\d+\s*$/, "").trim();
      }
    }
    return null;
  };

  // ── Primary: artwork embedding match ─────────────────────────────────────
  const onRetryRef = useRef(null); // callback set by startLoop for retry logic
  const capturedFinishRef = useRef({ finish: "normal", confidence: 0 }); // finish snapshotted at capture moment

  const analyze = (b64, onRetry) => {
    setAnalyzing(true); setErr(""); setDebugMatches([]);
    lastB64.current = b64;
    onRetryRef.current = onRetry || null;
    // capturedFinishRef is set by caller (majority vote) before calling analyze — don't overwrite here

    if (embedReadyRef.current && workerRef.current) {
      const dataURL = "data:image/jpeg;base64," + b64;
      workerRef.current.postMessage({ type: "embedQuery", dataURL });
      // Safety timeout — if worker doesn't respond in 8s, reset and retry
      const timeout = setTimeout(() => {
        setAnalyzing(false);
        if (onRetry) onRetry();
      }, 8000);
      // Store timeout so it can be cleared on success
      analyzeTimeoutRef.current = timeout;
    } else {
      dbg("Embeddings not ready");
      setAnalyzing(false);
      if (onRetry) onRetry();
    }
  };

  // ── Low confidence fallback — retry or show search ───────────────────────
  const analyzeOCR = () => {
    dbg("Low confidence — retrying or showing fallback");
    setAnalyzing(false);
    if (onRetryRef.current) {
      onRetryRef.current();
      onRetryRef.current = null;
    }
  };

  const startLoop = () => {
    const MOTION_THRESHOLD = 20;
    const INTERVAL         = 80;   // ~12.5fps — was 40ms/25fps, halved to cut CPU/battery/GC load
    const LOCK_FRAMES      = 6;    // ~480ms of stable card content at the new slower interval

    // Cache 2D contexts once instead of calling getContext() every frame
    const ctx2d = canvasRef.current?.getContext("2d", { willReadFrequently: true });
    // Pre-allocate a reusable buffer for frame diffing instead of allocating
    // a new Uint8ClampedArray every single frame (was creating ~140KB/frame
    // of garbage between the getImageData copy and the prevFrame clone,
    // forcing constant GC and contributing to both battery drain and the
    // white-screen crashes from iOS killing the tab under memory pressure)
    let reusableFrameBuf = null;

    // Artwork box dimensions — wider than tall, artwork is roughly 63×44mm on a 63×88mm card
    // That's about 50% of card height. Box is ~75% of screen width.
    const ART_W_FRAC = 0.78; // fraction of display width
    const ART_RATIO  = 63/44; // width/height of artwork zone (~1.43)

    let last = Date.now();
    let pendingAnalysis = false;
    let stillCount      = 0;
    let frameCount      = 0; // count frames since start — camera needs ~15 frames to focus

    const drawGuide = (progress, locked) => {
      const oc = overlayCanvasRef.current;
      const v  = videoRef.current;
      if (!oc || !v) return;
      const dw = v.offsetWidth  || window.innerWidth;
      const dh = v.offsetHeight || (window.innerHeight - 120);
      oc.width = dw; oc.height = dh;
      const ctx = oc.getContext("2d");
      ctx.clearRect(0, 0, dw, dh);

      const bw = Math.round(dw * ART_W_FRAC);
      const bh = Math.round(bw / ART_RATIO);
      const bx = Math.round((dw - bw) / 2);
      const by = Math.round(dh * 0.12); // sits near top of frame

      const color = locked ? "#00D4AA"
                  : progress > 0 ? `rgba(0,${Math.round(180+75*progress)},${Math.round(120+90*progress)},${0.7+0.3*progress})`
                  : "rgba(0,212,170,0.85)";
      ctx.strokeStyle = color;
      ctx.lineWidth   = locked ? 4 : 3;
      ctx.lineJoin    = "round";

      // Dim everything outside the guide box
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, dw, dh);
      ctx.clearRect(bx, by, bw, bh);

      // Corner brackets
      const CL = 36;
      [[bx,by],[bx+bw,by],[bx+bw,by+bh],[bx,by+bh]].forEach(([cx,cy], i) => {
        const dx = i===0||i===3 ? 1 : -1;
        const dy = i===0||i===1 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx+dx*CL, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy+dy*CL);
        ctx.stroke();
      });

      // Label
      ctx.fillStyle = color;
      ctx.font = "600 11px -apple-system,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("ALIGN ARTWORK HERE", bx + bw/2, by - 8);

      // Progress arc
      if (progress > 0 && !locked) {
        ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(bx+bw/2, by+bh/2, 16, -Math.PI/2, -Math.PI/2 + Math.PI*2*progress);
        ctx.stroke();
      }
    };

    const loop = () => {
      loopRef.current = requestAnimationFrame(loop);
      const now = Date.now();
      if (now - last < INTERVAL || pendingAnalysis) return;
      last = now;
      const v = videoRef.current, c = canvasRef.current;
      if (!v || !c || v.videoWidth === 0) return;
      if (v.paused) { v.play().catch(()=>{}); return; } // safety: resume if WebKit paused rendering

      const vw = v.videoWidth, vh = v.videoHeight;
      const dw = v.offsetWidth  || window.innerWidth;
      const dh = v.offsetHeight || (window.innerHeight - 120);
      const coverScale = Math.max(dw/vw, dh/vh);
      const offsetX = (vw * coverScale - dw) / 2;
      const offsetY = (vh * coverScale - dh) / 2;

      // Sample from the artwork guide box region for motion + brightness
      const bw = Math.round(dw * ART_W_FRAC);
      const bh = Math.round(bw / ART_RATIO);
      const bx = Math.round((dw - bw) / 2);
      const by = Math.round(dh * 0.20);

      // Map guide box to video coordinates
      const vBx   = (bx + offsetX) / coverScale;
      const vBy   = (by + offsetY) / coverScale;
      const vBw   = bw / coverScale;
      const vBh   = bh / coverScale;

      const sw = 160, sh = Math.round(160 / ART_RATIO);
      if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
      ctx2d.drawImage(v, vBx, vBy, vBw, vBh, 0, 0, sw, sh);
      const frame = ctx2d.getImageData(0,0,sw,sh).data;
      const diff  = frameDiff(prevFrame.current, frame);
      // Reuse a single persistent buffer instead of allocating a fresh
      // Uint8ClampedArray every frame — only allocate once, then copy in place
      if (!reusableFrameBuf || reusableFrameBuf.length !== frame.length) {
        reusableFrameBuf = new Uint8ClampedArray(frame.length);
      }
      reusableFrameBuf.set(frame);
      prevFrame.current = reusableFrameBuf;

      // Brightness check — card artwork is much brighter than dark carpet
      let brightness = 0;
      for (let i = 0; i < frame.length; i += 16)
        brightness += frame[i]*0.299 + frame[i+1]*0.587 + frame[i+2]*0.114;
      brightness /= (frame.length / 16);

      // Color variance check — card artwork has many colors, carpet is uniform
      // Calculate mean and variance of R, G, B channels
      let rSum=0, gSum=0, bSum=0, rSq=0, gSq=0, bSq=0, px=0;
      for (let i = 0; i < frame.length; i += 8) {
        const r=frame[i], g=frame[i+1], b=frame[i+2];
        rSum+=r; gSum+=g; bSum+=b;
        rSq+=r*r; gSq+=g*g; bSq+=b*b;
        px++;
      }
      const rMean=rSum/px, gMean=gSum/px, bMean=bSum/px;
      const rVar=rSq/px - rMean*rMean;
      const gVar=gSq/px - gMean*gMean;
      const bVar=bSq/px - bMean*bMean;
      const colorVariance = (rVar + gVar + bVar) / 3;
      // Also check color diversity — difference between R/G/B means (carpet is near-equal)
      const channelSpread = Math.max(rMean,gMean,bMean) - Math.min(rMean,gMean,bMean);

      // Card: bright + colorful (high variance) + some channel diversity
      const hasContent = brightness > 55 && colorVariance > 400 && channelSpread > 8;

      if (!embedReadyRef.current) {
        setMotionHint(embedProgressRef.current
          ? `Fingerprinting ${embedProgressRef.current.done}/${embedProgressRef.current.total}...`
          : "Loading scanner...");
        drawGuide(0, false);
        return;
      }

      const isStill  = diff < MOTION_THRESHOLD;
      const progress = Math.min(stillCount / LOCK_FRAMES, 1);
      const locked   = stillCount >= LOCK_FRAMES;

      drawGuide(progress, locked);

      frameCount++;

      if (isStill && hasContent) {
        stillCount = Math.min(stillCount + 1, LOCK_FRAMES + 1);

        if (locked && frameCount > 25) { // wait ~1s for camera to focus and settle
          setMotionHint("Scanning...");
          pendingAnalysis = true;
          const b64 = captureBase64();
          if (b64) {
            analyze(b64, () => {
              pendingAnalysis = false;
              stillCount = 0;
              frameCount = 0; // reset so next card also waits for camera to refocus
            });
          }
        } else {
          setMotionHint(stillCount > 1 ? "Almost..." : "Hold still...");
        }
      } else {
        stillCount = Math.max(0, stillCount - 1);
        setMotionHint(brightness <= 55 ? "Align artwork to the box" : colorVariance <= 400 ? "Move closer to card" : "Hold still...");
      }
    };
    loopRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video:{ facingMode:"environment", width:{ ideal:1280 }, height:{ ideal:720 } }
        });
        streamRef.current = s;
        videoRef.current.srcObject = s;
        await videoRef.current.play();
        // Request continuous autofocus if supported
        try {
          const track = s.getVideoTracks()[0];
          const caps = track.getCapabilities?.() || {};
          if (caps.focusMode?.includes("continuous")) {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
          }
        } catch(_) {}
        setStreaming(true);
      } catch(_e) { setErr("Camera access denied. Use upload below."); }
    })();
    return stop;
  }, []);

  // Re-play video when becoming visible again — Safari/WebKit can pause rendering
  // when the element is inside a display:none ancestor, even if the stream stays alive
  useEffect(() => {
    if (visible && videoRef.current && streamRef.current) {
      videoRef.current.play().catch(()=>{});
    }
  }, [visible]);

  // Restart the motion loop whenever streaming starts OR embeddings become ready
  // This ensures the loop always has the current embedReady value (not a stale closure)
  useEffect(() => {
    if (streaming && !analyzing) {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      stillCount.current = 0;
      startLoop();
    }
    return () => { if (loopRef.current) cancelAnimationFrame(loopRef.current); };
  }, [streaming, embedReady]);

  const handleFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    stop();
    const r = new FileReader();
    r.onload = ev => {
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        const scale = Math.min(1, 800 / img.width);
        c.width  = Math.round(img.width  * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        analyze(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.src = ev.target.result;
    };
    r.readAsDataURL(f);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:10000, display:"flex", flexDirection:"column" }}>
      {/* Header — paddingTop accounts for iOS status bar via safe-area-inset */}
      <div className="fixed-overlay-header" style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", background:"#000", flexShrink:0,
        paddingTop:"calc(env(safe-area-inset-top, 16px) + 10px)",
        paddingBottom:12, paddingLeft:20, paddingRight:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={()=>{ stop(); onClose(); }} style={{ background:"none", border:"none", cursor:"pointer", padding:8 }}>
            <Icon.Close size={22} color="#fff"/>
          </button>
          <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1 }}>
            {setFilter ? `SCAN · ${setFilter.toUpperCase()}` : "SCAN CARD"}
          </span>
        </div>
      </div>

      {/* ── Debug popup ── */}
      {debugMode && (debugLog.length > 0 || debugMatches.length > 0) && (
        <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.88)",
          display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div style={{ background:"#111", borderRadius:"20px 20px 0 0", width:"100%",
            maxHeight:"80vh", display:"flex", flexDirection:"column", borderTop:`2px solid ${TEAL}` }}>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"14px 16px", borderBottom:"1px solid #1e1e1e", flexShrink:0 }}>
              <span style={{ color:TEAL, fontSize:13, fontWeight:700, letterSpacing:0.5 }}>
                {debugMatches.length ? "TOP MATCHES" : "DEBUG LOG"}
              </span>
              <button onClick={()=>{ setDebugLog([]); setDebugMatches([]); }}
                style={{ background:"none", border:"1px solid #333", borderRadius:8,
                  padding:"5px 12px", color:"#888", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                Dismiss
              </button>
            </div>

            <div style={{ overflowY:"auto", flex:1, padding:"12px 16px 32px" }}>

              {/* Match results — card images with confidence bars */}
              {debugMatches.length > 0 && (
                <div style={{ marginBottom:14 }}>
                  {debugMatches.map((m, i) => {
                    const pct = Math.round(m.score * 100);
                    const isTop = i === 0;
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8,
                        padding:"8px 10px", borderRadius:10,
                        background: isTop ? "#0d1f19" : "#0d0d0d",
                        border:`1px solid ${isTop ? TEAL+"55" : "#1a1a1a"}` }}>
                        {m.imageUrl
                          ? <img src={m.imageUrl} alt={m.name}
                              style={{ width:36, height:50, objectFit:"contain", borderRadius:4, flexShrink:0 }}/>
                          : <div style={{ width:36, height:50, background:"#222", borderRadius:4, flexShrink:0 }}/>
                        }
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color: isTop ? "#fff" : "#888", fontSize:13, fontWeight: isTop ? 700 : 400,
                            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                            {m.name}
                          </div>
                          <div style={{ color:"#555", fontSize:11 }}>#{m.number}</div>
                          <div style={{ marginTop:4, height:4, background:"#222", borderRadius:2, overflow:"hidden" }}>
                            <div style={{ width:`${pct}%`, height:"100%",
                              background: pct > 82 ? TEAL : pct > 72 ? "#f59e0b" : "#555",
                              transition:"width 0.3s" }}/>
                          </div>
                        </div>
                        <div style={{ color: isTop ? TEAL : "#555", fontSize:14, fontWeight:700, flexShrink:0 }}>
                          {pct}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Log lines */}
              {debugLog.map((line, i) => (
                <div key={i} style={{ padding:"6px 10px", marginBottom:3, borderRadius:8,
                  background:"#0d0d0d", border:"1px solid #1a1a1a" }}>
                  <span style={{ color: i===0 ? "#bbb" : "#555", fontSize:11,
                    fontFamily:"monospace", wordBreak:"break-all", lineHeight:1.5 }}>
                    {line}
                  </span>
                </div>
              ))}

              {err && (
                <div style={{ marginTop:12, padding:"12px 14px", background:"#1a0808",
                  border:"1px solid #3d1a1a", borderRadius:12 }}>
                  <div style={{ color:"#ef4444", fontSize:13, marginBottom:10 }}>{err}</div>
                  <button onClick={()=>{ stop(); onClose(); onSearchFallback && onSearchFallback(); }}
                    style={{ width:"100%", padding:"10px 0", background:TEAL, border:"none",
                      borderRadius:10, color:"#000", fontSize:14, fontWeight:700,
                      cursor:"pointer", fontFamily:"inherit" }}>
                    Search Card Manually
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Camera — always full width, flex:1 */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <video ref={videoRef} style={{ width:"100%", height:"100%", objectFit:"cover" }} playsInline muted/>
        <canvas ref={canvasRef} style={{ display:"none" }}/>
        {/* Overlay canvas for dynamic card outline — drawn by detectCardCorners in loop */}
        <canvas ref={overlayCanvasRef} style={{
          position:"absolute", inset:0, width:"100%", height:"100%",
          pointerEvents:"none",
        }}/>

        {/* Hint pill */}
        {/* Embed progress bar — shown while fingerprinting set */}
        {embedProgress && !analyzing && (
          <div style={{ position:"absolute", bottom:60, left:20, right:20 }}>
            <div style={{ background:"rgba(0,0,0,0.8)", backdropFilter:"blur(8px)",
              borderRadius:12, padding:"10px 14px", border:`1px solid ${TEAL}33` }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ color:TEAL, fontSize:11, fontWeight:700, letterSpacing:0.5 }}>
                  BUILDING CARD FINGERPRINTS
                </span>
                <span style={{ color:"#666", fontSize:11 }}>
                  {embedProgress.done}/{embedProgress.total}
                </span>
              </div>
              <div style={{ height:3, background:"#222", borderRadius:2, overflow:"hidden" }}>
                <div style={{ width:`${(embedProgress.done/embedProgress.total)*100}%`,
                  height:"100%", background:TEAL, transition:"width 0.2s", borderRadius:2 }}/>
              </div>
            </div>
          </div>
        )}

        {!analyzing && streaming && (
          <div style={{ position:"absolute", bottom:16, left:0, right:0, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
            <span style={{ background:"rgba(0,0,0,0.7)", backdropFilter:"blur(6px)",
              color: embedReady && (motionHint==="Hold still..."|motionHint==="Scanning...") ? TEAL
                   : embedReady ? "rgba(255,255,255,0.6)"
                   : "#f59e0b",
              fontSize:13, padding:"8px 20px", borderRadius:20,
              fontFamily:"'Bebas Neue',sans-serif", letterSpacing:1 }}>{motionHint}</span>
          </div>
        )}

        {/* Scanning spinner */}
        {analyzing && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.65)",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
            <div style={{ width:44, height:44, border:`3px solid ${TEAL}`,
              borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
            <span style={{ color:"#fff", fontSize:14, letterSpacing:0.5,
              fontFamily:"'Bebas Neue',sans-serif" }}>MATCHING ARTWORK...</span>
          </div>
        )}

        {/* Error — shown ABOVE the debug drawer via zIndex */}
        {err && !debugMode && (
          <div style={{ position:"absolute", bottom:24, left:20, right:20, zIndex:10,
            background:"rgba(20,20,20,0.96)", border:"1px solid #3d1a1a", borderRadius:16, padding:"14px 16px",
            display:"flex", flexDirection:"column", gap:10, alignItems:"center" }}>
            <span style={{ color:"#ef4444", fontSize:13, textAlign:"center" }}>{err}</span>
            <button onClick={()=>{ stop(); onClose(); onSearchFallback && onSearchFallback(); }}
              style={{ background:TEAL, border:"none", borderRadius:20, padding:"8px 22px",
                color:"#000", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              Search Card Manually
            </button>
          </div>
        )}
      </div>



      {/* Upload bar */}
      <div style={{ padding:"10px 20px", paddingBottom:"calc(10px + env(safe-area-inset-bottom,0px))",
        display:"flex", alignItems:"center", gap:12, background:"#000", borderTop:"1px solid #111", flexShrink:0 }}>
        <div style={{ flex:1, height:1, background:"#222" }}/>
        <button onClick={()=>fileRef.current?.click()} style={{
          display:"flex", alignItems:"center", gap:8, background:"#111",
          border:`1px solid ${BORDER}`, color:"#bbb", padding:"9px 20px",
          borderRadius:20, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
          <Icon.Upload size={14} color="#bbb"/> Upload photo
        </button>
        <div style={{ flex:1, height:1, background:"#222" }}/>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display:"none" }}/>
      </div>

      {/* ── Match Picker — shown when confidence is low ── */}
      {pickerMatches && (
        <div style={{ position:"fixed", inset:0, zIndex:99999,
          background:"rgba(0,0,0,0.92)", display:"flex", alignItems:"flex-end" }}>
          <div style={{ width:"100%", background:"#111", borderRadius:"20px 20px 0 0",
            borderTop:`2px solid ${TEAL}`, maxHeight:"85vh", display:"flex", flexDirection:"column" }}>

            {/* Header */}
            <div style={{ padding:"16px 18px 8px", flexShrink:0 }}>
              <div style={{ color:TEAL, fontSize:13, fontWeight:700, letterSpacing:0.5, marginBottom:2 }}>
                WHICH CARD IS THIS?
              </div>
              <div style={{ color:"#555", fontSize:11, marginBottom:10 }}>
                Tap the correct card — we'll remember it for next time
              </div>
              {/* Search input */}
              <div style={{ position:"relative" }}>
                <input
                  type="text"
                  placeholder="Search by name or number…"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  style={{ width:"100%", padding:"9px 36px 9px 12px", background:"#0d0d0d",
                    border:`1px solid ${pickerSearch ? TEAL+"66" : "#2a2a2a"}`, borderRadius:10,
                    color:"#fff", fontSize:13, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}
                />
                {pickerSearch ? (
                  <button onClick={() => setPickerSearch("")}
                    style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                      background:"none", border:"none", color:"#666", fontSize:16, cursor:"pointer", lineHeight:1 }}>
                    ×
                  </button>
                ) : (
                  <svg style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)" }}
                    width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="#444" strokeWidth="2"/>
                    <path d="M16.5 16.5L21 21" stroke="#444" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
            </div>

            {/* Card list */}
            <div style={{ overflowY:"auto", flex:1, minHeight:0, padding:"0 14px 8px" }}>
              {(() => {
                const isSearching = pickerSearch.trim().length > 0;
                const displayList = isSearching ? pickerSearchResults : pickerMatches;
                if (pickerSearching) return (
                  <div style={{ display:"flex", justifyContent:"center", padding:"20px 0" }}>
                    <div style={{ width:18, height:18, border:`2px solid ${TEAL}`, borderTopColor:"transparent",
                      borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
                  </div>
                );
                if (isSearching && displayList.length === 0) return (
                  <div style={{ color:"#444", fontSize:13, textAlign:"center", padding:"20px 0" }}>
                    No cards found for "{pickerSearch}"
                  </div>
                );
                if (!isSearching && displayList.length === 0) return (
                  <div style={{ color:"#444", fontSize:13, textAlign:"center", padding:"20px 0" }}>
                    No close matches found — try searching above
                  </div>
                );
                return displayList.map((m, i) => {
                  const pct = Math.round(m.score * 100);
                  const isTop = !isSearching && i === 0;
                  return (
                    <button key={m._card?.id || i} onClick={() => { onPickerSelect(m); setPickerSearch(""); setPickerSearchResults([]); }}
                      style={{ width:"100%", display:"flex", alignItems:"center", gap:12,
                        padding:"10px 12px", marginBottom:8, borderRadius:12, cursor:"pointer",
                        background: isTop ? "#0d1f19" : "#0d0d0d",
                        border:`1px solid ${isTop ? TEAL+"66" : "#1e1e1e"}`,
                        textAlign:"left", fontFamily:"inherit" }}>
                      {m.imageUrl
                        ? <img src={m.imageUrl} alt={m.name}
                            style={{ width:44, height:62, objectFit:"contain", borderRadius:4, flexShrink:0 }}/>
                        : <div style={{ width:44, height:62, background:"#222", borderRadius:4, flexShrink:0,
                            display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <span style={{ color:"#444", fontSize:18 }}>?</span>
                          </div>
                      }
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color: isTop ? "#fff" : "#aaa", fontSize:14,
                          fontWeight: isTop ? 700 : 400, marginBottom:2,
                          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {m.name}
                        </div>
                        <div style={{ color:"#555", fontSize:11, marginBottom: isSearching ? 0 : 6 }}>
                          #{m.number}{m._card?.set?.name ? ` · ${m._card.set.name}` : ""}
                        </div>
                        {!isSearching && (
                          <div style={{ height:3, background:"#222", borderRadius:2, overflow:"hidden" }}>
                            <div style={{ width:`${pct}%`, height:"100%", borderRadius:2,
                              background: pct > 80 ? TEAL : pct > 65 ? "#f59e0b" : "#555" }}/>
                          </div>
                        )}
                      </div>
                      {!isSearching && (
                        <div style={{ color: isTop ? TEAL : "#555", fontSize:16,
                          fontWeight:700, flexShrink:0, minWidth:44, textAlign:"right" }}>
                          {pct}%
                        </div>
                      )}
                    </button>
                  );
                });
              })()}
            </div>

            {/* Variant buttons */}
            {(() => {
              const activeVariant = pickerVariant || "nonfoil";
              const PICKER_VARIANTS = [
                { key:"nonfoil", label:"Non-Foil", color:"#6b7280" },
                { key:"foil",    label:"Foil",     color:"#f59e0b" },
              ];
              return (
                <div style={{ padding:"10px 14px 0", display:"flex", gap:8, flexShrink:0 }}>
                  {PICKER_VARIANTS.map(({ key, label, color }) => {
                    const isActive = activeVariant === key;
                    const isAuto   = autoFinish === key && !pickerVariant;
                    return (
                      <button key={key} onClick={() => setPickerVariant(pickerVariant === key ? null : key)}
                        style={{ flex:1, padding:"11px 4px", borderRadius:12, cursor:"pointer",
                          background: isActive ? color+"33" : "#1a1a1a",
                          border:`2px solid ${isActive ? color : BORDER}`,
                          color: isActive ? color : "#555",
                          fontWeight: isActive ? 700 : 400, fontSize:12,
                          display:"flex", flexDirection:"column", alignItems:"center", gap:2,
                          fontFamily:"inherit" }}>
                        <span>{label}</span>
                        {isAuto && <span style={{ fontSize:9, letterSpacing:0.5, opacity:0.8 }}>DETECTED</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Footer actions */}
            <div style={{ padding:"10px 14px", paddingBottom:"calc(10px + env(safe-area-inset-bottom,0px))",
              borderTop:"1px solid #1a1a1a", display:"flex", gap:10, flexShrink:0 }}>
              <button onClick={() => { setPickerMatches(null); setPickerSearch(""); setPickerSearchResults([]); setPickerVariant(null); startLoop(); }}
                style={{ flex:1, padding:"11px 0", background:"none",
                  border:"1px solid #333", borderRadius:12, color:"#666",
                  fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Try Again
              </button>
              <button onClick={() => { setPickerMatches(null); setPickerSearch(""); setPickerSearchResults([]); setPickerVariant(null); stop(); onClose(); onSearchFallback?.(); }}
                style={{ flex:1, padding:"11px 0", background:TEAL,
                  border:"none", borderRadius:12, color:"#000",
                  fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                Search Instead
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scan Confirm ─────────────────────────────────────────────────────────────
function ScanConfirm({ scanned, searchResults, onConfirm, onRetry, defaultCondition = "near_mint" }) {
  const [selected, setSelected]   = useState(null);
  const [condition, setCondition] = useState(defaultCondition);
  const [acqType, setAcqType]     = useState("scan");
  const [costPaid, setCostPaid]   = useState("");

  useEffect(() => { setCondition(defaultCondition); }, [defaultCondition]);
  useEffect(() => { if (searchResults?.length > 0) setSelected(searchResults[0]); }, [searchResults]);

  const card = selected || searchResults?.[0];
  const prices = card ? getPrices(card) : null;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"16px 20px 40px" }}>
      <div style={{ marginBottom:16 }}>
        <div style={{ color:"#555", fontSize:10, letterSpacing:0.5, marginBottom:4 }}>AI DETECTED</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#fff" }}>
            {scanned?.name || "Unknown Card"}
          </div>
        </div>
        {searchResults?.length > 1 && (
          <div style={{ color:"#555", fontSize:11, marginTop:2 }}>
            {searchResults.length} matches — tap to select the right version
          </div>
        )}
      </div>

      {searchResults?.length > 0 ? (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:10, marginBottom:20 }}>
          {searchResults.map(c => {
            const sel = selected?.id === c.id;
            return (
              <button key={c.id} onClick={()=>setSelected(c)} style={{
                background:sel?"#0d1f19":CARD, border:`2px solid ${sel?TEAL:BORDER}`,
                borderRadius:14, padding:10, cursor:"pointer", textAlign:"left",
              }}>
                <img src={c.images?.small} alt={c.name}
                  style={{ width:"100%", borderRadius:8, display:"block", marginBottom:6 }}/>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:13, color:"#fff" }}>{c.name}</div>
                <div style={{ color:"#555", fontSize:10 }}>{c.set?.name} · #{c.number}</div>
                {sel && <div style={{ color:TEAL, fontSize:10, marginTop:4 }}>✓ Selected</div>}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:14,
          padding:16, marginBottom:20, textAlign:"center" }}>
          <div style={{ color:"#555", fontSize:13 }}>No matches found</div>
          <button onClick={onRetry} style={{ color:TEAL, background:"none", border:"none",
            fontSize:13, cursor:"pointer", marginTop:8, fontFamily:"inherit" }}>Try again</button>
        </div>
      )}

      {card && (
        <>
          <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>SELECT CONDITION</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
            {Object.entries(condLabels).map(([key, label]) => {
              const price = prices?.raw[key] || 0;
              const sel = condition === key;
              return (
                <button key={key} onClick={()=>setCondition(key)} style={{
                  background:sel?condColors[key]+"18":"#0d0d0d",
                  border:`2px solid ${sel?condColors[key]:BORDER}`,
                  borderRadius:12, padding:"10px 12px", textAlign:"left", cursor:"pointer",
                }}>
                  <div style={{ color:condColors[key], fontSize:10, fontWeight:700 }}>{label}</div>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18,
                    color:sel?"#fff":"#555", letterSpacing:1, marginTop:2 }}>
                    {price > 0 ? fmt(price) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>HOW DID YOU GET IT?</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
            {[{id:"bought",label:"Bought",sub:"Store / Online"},{id:"scan",label:"Scan / Found",sub:"Just scanned"}].map(a=>(
              <button key={a.id} onClick={()=>setAcqType(a.id)} style={{
                background:acqType===a.id?"#0d1f19":"#0d0d0d",
                border:`2px solid ${acqType===a.id?TEAL:BORDER}`,
                borderRadius:12, padding:12, textAlign:"left", cursor:"pointer",
              }}>
                <div style={{ color:acqType===a.id?TEAL:"#888", fontSize:13, fontWeight:600 }}>{a.label}</div>
                <div style={{ color:"#555", fontSize:11, marginTop:2 }}>{a.sub}</div>
              </button>
            ))}
          </div>
          {acqType === "bought" && (
            <>
              <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>PRICE PAID</div>
              <input type="number" inputMode="decimal" placeholder="0.00"
                value={costPaid} onChange={e=>setCostPaid(e.target.value)}
                style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
                  border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                  fontSize:15, fontFamily:"inherit", outline:"none",
                  boxSizing:"border-box", marginBottom:16 }}/>
            </>
          )}
          <button onClick={()=>onConfirm(card, condition, { acqType, costPaid: costPaid ? parseFloat(costPaid) : null })}
            style={{ width:"100%", padding:16, background:TEAL, border:"none", borderRadius:16,
              fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:1,
              color:"#000", cursor:"pointer", marginBottom:8 }}>
            ADD TO COLLECTION
          </button>
          <button onClick={onRetry} style={{ width:"100%", padding:12, background:"none",
            border:"none", color:"#444", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
            Scan Again
          </button>
        </>
      )}
    </div>
  );
}

// ── Scan Flow ────────────────────────────────────────────────────────────────
// ── SwipeToDelete — swipe left to reveal delete button ───────────────────────
function SwipeToDelete({ children, onDelete }) {
  const [offsetX, setOffsetX] = React.useState(0);
  const startX = React.useRef(null);
  const THRESHOLD = 60;
  const onTouchStart = e => { startX.current = e.touches[0].clientX; };
  const onTouchMove  = e => {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    if (dx < 0) setOffsetX(Math.max(dx, -THRESHOLD - 20));
  };
  const onTouchEnd = () => {
    if (offsetX < -THRESHOLD) setOffsetX(-THRESHOLD);
    else { setOffsetX(0); startX.current = null; }
  };
  return (
    <div style={{ position:"relative", overflow:"hidden" }}>
      {/* Delete button revealed underneath */}
      <div style={{ position:"absolute", right:0, top:0, bottom:0, width:THRESHOLD,
        background:"#ef4444", display:"flex", alignItems:"center", justifyContent:"center",
        cursor:"pointer" }} onClick={onDelete}>
        <Icon.Trash size={18} color="#fff"/>
      </div>
      {/* Content slides left */}
      <div style={{ transform:`translateX(${offsetX}px)`, transition: startX.current ? "none" : "transform 0.2s ease",
        touchAction:"pan-y" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {children}
      </div>
    </div>
  );
}

// ── GlobalScanFlow ─────────────────────────────────────────────────────────────
// ── PriceCheckPanel — shows market value + suggested offer for a scanned card ──
function PriceCheckPanel({ card, topVariants, autoFinish, VARIANT_CONFIG, onAddToList, isInList }) {
  const [selectedVariant, setSelectedVariant] = useState(autoFinish);
  const [freshCard, setFreshCard] = useState(card?._verified ? card : null);
  const [loading, setLoading] = useState(!card?._verified);

  useEffect(() => {
    setFreshCard(card?._verified ? card : null);
    setLoading(!card?._verified);
    if (card?._verified || !card?.id) return;

    let cancelled = false;
    (async () => {
      try {
        const fresh = await scryfallFetch(`/cards/${card.id}`).then(d => d ? normalizeScryfallCard(d) : null).catch(() => null);
        const merged = { ...(fresh || card), _verified: true };
        if (!cancelled) { setFreshCard(merged); setLoading(false); }
      } catch (_e) {
        if (!cancelled) { setFreshCard(card); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [card?.id]);

  const resolvedCard = freshCard || card;
  const isFoil = selectedVariant === "foil";
  const prices = getPrices(resolvedCard, isFoil);
  const marketPrice = prices.raw.near_mint || 0;
  const suggestedOffer = marketPrice * 0.75;
  const maxFairPrice = marketPrice * 0.90;

  return (
    <div style={{ marginBottom:20 }}>
      {topVariants.length > 1 && (
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          {topVariants.map(v => {
            const vc = VARIANT_CONFIG[v] || VARIANT_CONFIG.normal;
            const isSel = v === selectedVariant;
            return (
              <button key={v} onClick={()=>setSelectedVariant(v)}
                style={{ flex:1, padding:"10px 4px", borderRadius:10, cursor:"pointer",
                  background: isSel ? vc.color+"33" : "#1a1a1a",
                  border: `2px solid ${isSel ? vc.color : BORDER}`,
                  color: isSel ? vc.color : "#555",
                  fontWeight: isSel ? 700 : 400, fontSize:12 }}>
                {vc.label}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:14,
          padding:"24px 18px", textAlign:"center", display:"flex", flexDirection:"column",
          alignItems:"center", gap:10 }}>
          <div style={{ width:24, height:24, borderRadius:"50%", border:`3px solid ${TEAL}`,
            borderTopColor:"transparent", animation:"spin 0.8s linear infinite" }}/>
          <div style={{ color:"#666", fontSize:12 }}>Looking up current price...</div>
        </div>
      ) : marketPrice > 0 ? (
        <>
          <div style={{ background:"#0d1f19", border:`1px solid ${TEAL}33`, borderRadius:14,
            padding:"16px 18px", marginBottom:10 }}>
            <div style={{ color:"#666", fontSize:11, letterSpacing:0.5, marginBottom:4 }}>MARKET PRICE</div>
            <div style={{ color:"#fff", fontFamily:"'Bebas Neue',sans-serif", fontSize:34, letterSpacing:0.5 }}>
              {fmt(marketPrice)}
            </div>
            {prices.changePct != null && prices.hasRealPrices && (
              <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:2 }}>
                {prices.changePct >= 0
                  ? <Icon.TrendUp size={12} color={TEAL}/>
                  : <Icon.TrendDown size={12} color="#ef4444"/>}
                <span style={{ color: prices.changePct >= 0 ? TEAL : "#ef4444", fontSize:12 }}>
                  {prices.changePct >= 0 ? "+" : ""}{prices.changePct}% (30d)
                </span>
              </div>
            )}
          </div>

          <div style={{ background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:14, padding:"16px 18px" }}>
            <div style={{ color:"#666", fontSize:11, letterSpacing:0.5, marginBottom:10 }}>
              SUGGESTED OFFER
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
              <span style={{ color:"#888", fontSize:13 }}>Good buy target</span>
              <span style={{ color:TEAL, fontWeight:700, fontSize:18 }}>{fmt(suggestedOffer)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ color:"#888", fontSize:13 }}>Don't pay more than</span>
              <span style={{ color:"#ccc", fontSize:14 }}>{fmt(maxFairPrice)}</span>
            </div>
            <div style={{ color:"#444", fontSize:10, marginTop:10, lineHeight:1.4 }}>
              Offer ≈75% of market leaves room for condition risk and resale margin.
              Above {fmt(maxFairPrice)} you're paying close to full retail.
            </div>
          </div>

          {onAddToList && (
            <button onClick={()=>onAddToList(resolvedCard, selectedVariant, marketPrice)}
              disabled={isInList}
              style={{ width:"100%", marginTop:10, padding:14,
                background: isInList ? "#1a2620" : TEAL,
                border: isInList ? `1px solid ${TEAL}44` : "none",
                borderRadius:12, color: isInList ? TEAL : "#000",
                fontWeight:700, fontSize:14, cursor: isInList ? "default" : "pointer",
                fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              {isInList ? (
                <>
                  <Icon.Check size={16} color={TEAL}/> Added to List
                </>
              ) : (
                "+ Add to Interested List"
              )}
            </button>
          )}
        </>
      ) : (
        <div style={{ background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:14,
          padding:"20px 18px", textAlign:"center" }}>
          <div style={{ color:"#666", fontSize:13 }}>No market price available for this card</div>
        </div>
      )}
    </div>
  );
}

// ── GlobalScanFlow ─────────────────────────────────────────────────────────────
function GlobalScanFlow({ onDone, onClose, collection = [], setFilter = null, setId = null, priceCheckMode = false }) {
  const [phase,         setPhase]         = useState("camera"); // camera|confirm|search
  const [indexStatus,   setIndexStatus]   = useState("Loading card database...");
  const [indexReady,    setIndexReady]    = useState(false);
  const [cardsMeta,     setCardsMeta]     = useState({});
  const [topMatches,    setTopMatches]    = useState([]);
  const [queryVec,      setQueryVec]      = useState(null);
  const [search,        setSearch]        = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [dupCard,       setDupCard]       = useState(null);
  const [pendingAdd,    setPendingAdd]    = useState(null);
  const [sessionCards,  setSessionCards]  = useState([]); // running list of cards added this session
  const [wishlist,      setWishlist]      = useState(() => loadWishlist()); // price-check mode: cards you're interested in buying — persisted locally
  const [pcView,         setPcView]       = useState("camera"); // "camera" | "list" — price-check mode only

  // Persist wishlist on every change — protects against crashes mid-shopping-trip
  useEffect(() => { saveWishlist(wishlist); }, [wishlist]);
  const [showSession,   setShowSession]   = useState(false); // show session tray
  const [selectedMatch, setSelectedMatch] = useState(null); // override top match when user taps secondary

  const workerRef   = useRef(null);
  const globalReady = useRef(false);
  const scanGenRef  = useRef(0);
  const metaRef     = useRef({});
  const searchInputRef = useRef(null);

  // Focus search input when entering search phase
  useEffect(() => {
    if (phase === "search" && searchInputRef.current) {
      const t = setTimeout(() => { try { searchInputRef.current?.focus(); } catch(_){} }, 400);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // ── IDB helpers (same db as ScanView uses for global index) ──────────────────
  const IDB_NAME  = "mtgtracker-global-index";
  const IDB_STORE = "index";
  const idbGet = (key) => new Promise(res => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    r.onsuccess = e => {
      const tx = e.target.result.transaction(IDB_STORE, "readonly");
      const g  = tx.objectStore(IDB_STORE).get(key);
      g.onsuccess = () => res(g.result ?? null);
      g.onerror   = () => res(null);
    };
    r.onerror = () => res(null);
  });
  const idbSet = (key, value) => new Promise(res => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE);
    r.onsuccess = e => {
      const tx = e.target.result.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => res(true);
      tx.onerror    = () => res(false);
    };
    r.onerror = () => res(false);
  });

  // ── Boot: load global index in background while camera is already open ────────
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        // Check version
        const meta = await getEmbeddingIndexMeta();
        if (!meta?.version) {
          setIndexStatus("Card database unavailable — use search");
          return;
        }

        const cached = await idbGet("index-meta");
        const needsUpdate = !cached || cached.version !== meta.version;

        let buffer, metaData;
        if (needsUpdate) {
          setIndexStatus(`Downloading ${meta.count?.toLocaleString()} card database...`);
          [buffer, metaData] = await Promise.all([
            downloadEmbeddingIndex(meta.storagePath),
            downloadCardsMeta(meta.metaPath),
          ]);
          await idbSet("index-buffer", buffer);
          await idbSet("index-cards",  metaData);
          await idbSet("index-meta",   { version: meta.version });
        } else {
          setIndexStatus("Restoring card database...");
          [buffer, metaData] = await Promise.all([
            idbGet("index-buffer"),
            idbGet("index-cards"),
          ]);
        }

        if (cancelled || !buffer) return;
        metaRef.current = metaData || {};
        setCardsMeta(metaData || {});

        const fingerprints = await loadGlobalFingerprints().catch(() => ({}));

        setIndexStatus("Initialising scanner...");
        const worker = new Worker(new URL("./embedWorker.js", import.meta.url), { type: "module" });
        workerRef.current = worker;
        worker.postMessage({ type: "preload" }); // start model download in parallel with index fetch

        worker.onmessage = (e) => {
          if (cancelled) return;
          const { type } = e.data;
          if (type === "log") {
            console.log("[GlobalScan]", e.data.msg);
            // Show model download progress in the status banner
            if (e.data.msg.includes("Downloading") || e.data.msg.includes("DINOv2") || e.data.msg.includes("Loading")) {
              setIndexStatus(e.data.msg);
            }
            return;
          }
          if (type === "globalIndexLoaded") {
            globalReady.current = true;
            worker.postMessage({ type: "setMode", global: true });
            setIndexStatus(`${e.data.count.toLocaleString()} cards ready`);
            setIndexReady(true);
          }
          if (type === "queryResult") {
            const meta = metaRef.current;
            let matches = (e.data.matches || [])
              .map(m => ({ ...m, card: meta[m.id] || null }))
              .filter(m => m.card);
            // Filter to set if we're in pack scanning mode
            if (setFilter) {
              const setNameLower = setFilter.toLowerCase();
              const inSet = matches.filter(m =>
                (m.card.set?.name || "").toLowerCase().includes(setNameLower) ||
                (setId && m.card.set?.id === setId)
              );
              // Only apply filter if we got enough results — don't leave user with nothing
              if (inSet.length >= 2) matches = inSet;
            }
            setTopMatches(matches.slice(0, 6));
            if (e.data.queryVec) setQueryVec(new Float32Array(e.data.queryVec));
            setPhase("confirm");
          }
        };

        worker.postMessage({ type: "loadGlobalIndex", buffer, fingerprints }, [buffer]);

      } catch (err) {
        if (!cancelled) {
          console.error("[GlobalScan]", err);
          setIndexStatus("Error — use search");
        }
      }
    };

    boot();
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
    };
  }, []);

  // ── Scan result handler ───────────────────────────────────────────────────────
  const handleScanResult = (parsed) => {
    // Handle global match results passed back from ScanView
    if (parsed._globalMatches) {
      const meta = metaRef.current;
      let matches = (parsed._globalMatches || [])
        .map(m => ({ ...m, card: meta[m.id] || null }))
        .filter(m => m.card);
      // Filter to set if in pack scanning mode
      if (setFilter) {
        const setNameLower = setFilter.toLowerCase();
        const inSet = matches.filter(m =>
          (m.card.set?.name || "").toLowerCase().includes(setNameLower) ||
          (setId && m.card.set?.id === setId)
        );
        if (inSet.length >= 2) matches = inSet;
      }
      setTopMatches(matches.slice(0, 6));
      if (parsed._queryVec) setQueryVec(new Float32Array(parsed._queryVec));
      setPhase("confirm");
      return;
    }

    // Direct query if worker is ready (fallback path)
    if (workerRef.current && globalReady.current) {
      workerRef.current.postMessage({ type: "embedQuery", dataURL: parsed.dataURL });
    }
  };

  // ── Confirm a match ───────────────────────────────────────────────────────────
  const handleConfirm = async (card, variant) => {
    const foil = variant === "foil";
    const condition = "near_mint";
    const topScore = topMatches[0]?.score || 0;
    if (queryVec && (topScore < 0.95 || card.id !== topMatches[0]?.id)) {
      pushGlobalFingerprint(card.id, queryVec);
      workerRef.current?.postMessage({ type: "addFingerprint", id: card.id, vec: Array.from(queryVec) });
    }
    const existing = collection.find(i => i.card.id === card.id);
    if (existing) { setDupCard(existing); setPendingAdd({ card, condition, foil }); return; }
    setSessionCards(prev => [...prev, { card, condition, foil, id: `${card.id}-${Date.now()}` }]);
    await onDone(card, condition, { foil });
    setPhase("camera");
    setTopMatches([]);
    setQueryVec(null);
    setSelectedMatch(null);
    setSearch("");
    setSearchResults([]);
  };

  // ── Local search from cardsMeta (no API call) ─────────────────────────────────
  useEffect(() => {
    if (!search.trim() || search.length < 2) { setSearchResults([]); return; }
    const q = search.toLowerCase().trim();
    const meta = metaRef.current;
    const setNameLower = setFilter ? setFilter.toLowerCase() : null;

    // Parse "name number" e.g. "pikachu 58" or "mr. mime 58"
    const numMatch = q.match(/^(.*?)\s+(\d+)\s*$/);
    const qName = numMatch ? numMatch[1].trim() : q;
    const qNum  = numMatch ? numMatch[2] : null;

    const results = Object.values(meta)
      .filter(c => {
        const name = (c.name   || "").toLowerCase();
        const num  = (c.number || "").toLowerCase();
        const setN = (c.set?.name || "").toLowerCase();
        if (setNameLower && !setN.includes(setNameLower)) return false;
        if (qNum) {
          // Must match name AND number
          return name.includes(qName) && (num === qNum || num.startsWith(qNum));
        }
        return name.includes(q) || num === q || setN.includes(q);
      })
      .sort((a, b) => {
        const aExact = a.name.toLowerCase().startsWith(qName) ? 0 : 1;
        const bExact = b.name.toLowerCase().startsWith(qName) ? 0 : 1;
        if (qNum) {
          const aNum = (a.number||"").toLowerCase() === qNum ? 0 : 1;
          const bNum = (b.number||"").toLowerCase() === qNum ? 0 : 1;
          if (aNum !== bNum) return aNum - bNum;
        }
        return aExact - bExact || a.name.localeCompare(b.name);
      })
      .slice(0, 30);
    setSearchResults(results);
  }, [search, cardsMeta]);

  // ── Camera phase — opens immediately ─────────────────────────────────────────
  if (phase === "camera") {
    // Price-check mode: dedicated full-screen list view when toggled
    if (priceCheckMode && pcView === "list") {
      const wishlistTotal = wishlist.reduce((s,w)=>s+w.price,0);
      return (
        <div style={{ position:"fixed", inset:0, zIndex:10000, background:BG, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 20px",
            paddingTop:"calc(14px + env(safe-area-inset-top, 0px))", borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
            <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
              <Icon.Close size={20} color="#888"/>
            </button>
            <span style={{ color:"#fff", fontWeight:700, fontSize:16 }}>My List</span>
          </div>

          {/* Camera / List pill toggle */}
          <div style={{ display:"flex", gap:8, padding:"12px 20px", flexShrink:0 }}>
            <button onClick={()=>setPcView("camera")} style={{ flex:1, padding:"9px 0", borderRadius:20,
              background:"#1a1a1a", border:`1px solid ${BORDER}`, color:"#888", fontSize:13, fontWeight:600,
              cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              <Icon.Camera size={14} color="#888"/> Camera
            </button>
            <button onClick={()=>setPcView("list")} style={{ flex:1, padding:"9px 0", borderRadius:20,
              background:TEAL+"22", border:`1px solid ${TEAL}`, color:TEAL, fontSize:13, fontWeight:700,
              cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
              My List {wishlist.length > 0 && `(${wishlist.length})`}
            </button>
          </div>

          {wishlist.length === 0 ? (
            <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, color:"#444" }}>
              <Icon.Tag size={32} color="#333"/>
              <div style={{ fontSize:14, color:"#555" }}>No cards in your list yet</div>
              <div style={{ fontSize:12, color:"#333" }}>Check a card's price, then tap "Add to Interested List"</div>
              <button onClick={()=>setPcView("camera")} style={{ marginTop:8, padding:"10px 20px",
                background:TEAL, border:"none", borderRadius:20, color:"#000", fontWeight:700,
                fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Start Scanning
              </button>
            </div>
          ) : (
            <>
              <div style={{ flex:1, overflowY:"auto", padding:"0 20px" }}>
                {[...wishlist].reverse().map(w => {
                  const vc = w.variant === "foil" ? { label:"Foil", color:"#f59e0b" }
                           : w.variant === "near_mint" ? { label:"Reverse Holo", color:"#a78bfa" }
                           : { label:"Normal", color:"#6b7280" };
                  return (
                    <SwipeToDelete key={w.id} onDelete={()=>setWishlist(prev => prev.filter(x => x.id !== w.id))}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0",
                        borderBottom:`1px solid ${BORDER}`, background:BG }}>
                        {w.card?.images?.small && (
                          <img src={w.card.images.small} alt="" loading="lazy"
                            style={{ height:56, borderRadius:5, flexShrink:0 }}
                            onError={e=>e.target.style.display="none"}/>
                        )}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:"#fff", fontSize:14, fontWeight:600 }}>{w.card?.name}</div>
                          <div style={{ color:"#555", fontSize:11 }}>
                            {w.card?.set?.name} · <span style={{ color:vc.color }}>{vc.label}</span>
                          </div>
                        </div>
                        <span style={{ color:TEAL, fontSize:15, fontWeight:700, flexShrink:0 }}>{fmt(w.price)}</span>
                      </div>
                    </SwipeToDelete>
                  );
                })}
              </div>

              {/* Totals footer */}
              <div style={{ flexShrink:0, padding:"16px 20px", paddingBottom:"calc(16px + env(safe-area-inset-bottom, 0px))",
                borderTop:`1px solid ${BORDER}`, background:"#0d1f19" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
                  <span style={{ color:"#888", fontSize:12 }}>Total market value · {wishlist.length} cards</span>
                  <span style={{ color:"#fff", fontSize:22, fontFamily:"'Bebas Neue',sans-serif" }}>{fmt(wishlistTotal)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color:"#666", fontSize:11 }}>Suggested bundle offer (75%)</span>
                  <span style={{ color:TEAL, fontSize:16, fontWeight:700 }}>{fmt(wishlistTotal * 0.75)}</span>
                </div>
                <button onClick={()=>{ if (confirm("Clear the entire list?")) setWishlist([]); }}
                  style={{ width:"100%", marginTop:14, padding:10, background:"none",
                    border:`1px solid ${BORDER}`, borderRadius:10, color:"#666", fontSize:12,
                    cursor:"pointer", fontFamily:"inherit" }}>
                  Clear list
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div style={{ position:"fixed", inset:0, zIndex:10000 }}>
        <ScanView
          onResult={handleScanResult}
          onClose={onClose}
          setFilter={setFilter}
          globalWorker={indexReady ? workerRef.current : null}
          hint={indexReady ? `${Object.keys(cardsMeta).length.toLocaleString()} cards ready` : indexStatus}
        />

        {/* These overlays must be above ScanView's zIndex:10000 */}
        <div style={{ position:"fixed", inset:0, zIndex:10001, pointerEvents:"none" }}>

          {/* Camera / List pill toggle — price-check mode only */}
          {priceCheckMode && (
            <div style={{ position:"absolute", top:"calc(env(safe-area-inset-top, 16px) + 54px)",
              left:16, right:16, display:"flex", gap:8, pointerEvents:"all" }}>
              <button onClick={()=>setPcView("camera")} style={{ flex:1, padding:"8px 0", borderRadius:20,
                background:TEAL+"22", border:`1px solid ${TEAL}`, color:TEAL, fontSize:12, fontWeight:700,
                cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                <Icon.Camera size={13} color={TEAL}/> Camera
              </button>
              <button onClick={()=>setPcView("list")} style={{ flex:1, padding:"8px 0", borderRadius:20,
                background:"rgba(20,20,20,0.85)", border:`1px solid ${BORDER}`, color:"#aaa", fontSize:12, fontWeight:600,
                cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                My List {wishlist.length > 0 && `(${wishlist.length})`}
              </button>
            </div>
          )}

          {/* Manual search — always available, top right (left of Done if present) */}
          <button onClick={()=>{ setSearch(""); setSearchResults([]); setPhase("search"); }} style={{
            position:"absolute", top:"calc(env(safe-area-inset-top, 16px) + 10px)",
            right: sessionCards.length > 0 ? 110 : 16,
            background:"rgba(20,20,20,0.85)", border:`1px solid ${BORDER}`, borderRadius:10,
            color:"#ccc", fontSize:12, fontWeight:600, padding:"7px 12px",
            cursor:"pointer", pointerEvents:"all", display:"flex", alignItems:"center", gap:6,
          }}><Icon.Search size={14} color="#ccc"/> Search</button>

          {/* Done button — top right, only when session has cards */}
          {sessionCards.length > 0 && (
            <button onClick={onClose} style={{
              position:"absolute", top:"calc(env(safe-area-inset-top, 16px) + 10px)", right:16,
              background:TEAL, border:"none", borderRadius:10,
              color:"#000", fontSize:13, fontWeight:700, padding:"6px 14px",
              cursor:"pointer", pointerEvents:"all",
            }}>Done ({sessionCards.length})</button>
          )}

          {/* Session tray — bottom, above tab bar */}
          {sessionCards.length > 0 && (
            <div style={{ position:"absolute", bottom:0, left:0, right:0, pointerEvents:"all" }}>
              <button onClick={()=>setShowSession(s=>!s)} style={{
                width:"100%", background:"rgba(13,13,13,0.95)", border:"none",
                borderTop:`1px solid ${BORDER}`, padding:"10px 20px",
                display:"flex", alignItems:"center", justifyContent:"space-between",
                cursor:"pointer",
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ color:"#fff", fontSize:13, fontWeight:600 }}>
                    {sessionCards.length} card{sessionCards.length !== 1 ? "s" : ""} scanned
                  </span>
                  {/* Mini preview of last 3 cards */}
                  <div style={{ display:"flex", gap:3 }}>
                    {[...sessionCards].reverse().slice(0,3).map(sc => (
                      sc.card?.images?.small && (
                        <img key={sc.id} src={sc.card.images.small}
                          style={{ height:24, borderRadius:2, opacity:0.8 }}
                          onError={e=>e.target.style.display="none"}/>
                      )
                    ))}
                  </div>
                </div>
                <span style={{ color:TEAL, fontSize:11, display:"flex", alignItems:"center", gap:4 }}>
                  {showSession ? "Hide" : "Show"}
                  <span style={{ display:"flex", transform: showSession ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}>
                    <Icon.ChevronDown size={11} color={TEAL}/>
                  </span>
                </span>
              </button>
              {showSession && (
                <div style={{ background:"#0d0d0d", maxHeight:200, overflowY:"auto",
                  borderTop:`1px solid ${BORDER}` }}>
                  {[...sessionCards].reverse().map(sc => {
                    const condLabel = sc.condition === "near_mint" ? "Holo"
                                    : sc.condition === "near_mint" ? "Rev" : "NM";
                    const condColor = sc.condition === "near_mint" ? "#f59e0b"
                                    : sc.condition === "near_mint" ? "#a78bfa" : "#6b7280";
                    return (
                      <SwipeToDelete key={sc.id} onDelete={()=>
                        setSessionCards(prev => prev.filter(c => c.id !== sc.id))
                      }>
                        <div style={{ display:"flex", alignItems:"center", gap:10,
                          padding:"8px 16px", borderBottom:`1px solid #1a1a1a`, background:"#0d0d0d" }}>
                          {sc.card?.images?.small && (
                            <img src={sc.card.images.small} style={{ height:36, borderRadius:3 }}
                              onError={e=>e.target.style.display="none"}/>
                          )}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ color:"#fff", fontSize:12, fontWeight:600 }}>{sc.card?.name}</div>
                            <div style={{ color:"#555", fontSize:10 }}>{sc.card?.set?.name}</div>
                          </div>
                          <span style={{ color:condColor, fontSize:11, fontWeight:700 }}>{condLabel}</span>
                        </div>
                      </SwipeToDelete>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    );
  }

  // ── Confirm phase ─────────────────────────────────────────────────────────────
  if (phase === "confirm") {
    const top = selectedMatch || topMatches[0];

    const getVariants = (card) => {
      if (!card) return ["nonfoil","foil"];
      const rarity = (card.rarity || "").toLowerCase();
      const hasFoilPrice = parseFloat(card.prices?.usd_foil || 0) > 0;
      if (hasFoilPrice || rarity === "rare" || rarity === "mythic") return ["nonfoil","foil"];
      return ["nonfoil"];
    };

    const VARIANT_CONFIG = {
      nonfoil: { label:"Non-Foil", color:"#6b7280" },
      foil:    { label:"Foil",     color:"#f59e0b" },
    };

    const topVariants = getVariants(top?.card);
    const autoFinish = topVariants[0]; // default to nonfoil

    return (
      <div style={{ position:"fixed", inset:0, background:BG, zIndex:10002, display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"0 20px 12px", paddingTop:"calc(env(safe-area-inset-top, 16px) + 12px)",
          display:"flex", alignItems:"center", gap:12, borderBottom:`1px solid ${BORDER}`, background:BG, flexShrink:0 }}>
          <button onClick={()=>{ setPhase("camera"); setTopMatches([]); setQueryVec(null); setSelectedMatch(null); setSearch(""); setSearchResults([]); }} style={{ background:"none", border:"none",
            color:TEAL, fontSize:28, cursor:"pointer", padding:"4px 8px 4px 0", lineHeight:1 }}>‹</button>
          <div style={{ flex:1 }}>
            <div style={{ color:"#fff", fontWeight:700 }}>{priceCheckMode ? "Price Check" : "Scan Result"}</div>
            <div style={{ color:"#555", fontSize:11 }}>
              {top ? `${Math.round((top.score||0)*100)}% · ${top.card?.set?.name || ""}` : "No match"}
            </div>
          </div>
          <button onClick={()=>setPhase("search")} style={{ color:TEAL, background:"none",
            border:`1px solid ${TEAL}`, borderRadius:8, padding:"4px 10px", fontSize:12, cursor:"pointer" }}>
            Search
          </button>
        </div>

        <div style={{ flex:1, overflowY:"auto" }}>
          {top?.card ? (
            <div style={{ padding:"20px 20px 0" }}>
              <div style={{ display:"flex", gap:16, alignItems:"flex-start", marginBottom:16 }}>
                {top.card.images?.small && (
                  <img src={top.card.images.small} alt={top.card.name}
                    style={{ height:120, borderRadius:8, flexShrink:0, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}
                    onError={e=>e.target.style.display="none"}/>
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:"#fff", fontWeight:700, fontSize:16, marginBottom:2 }}>{top.card.name}</div>
                  <div style={{ color:"#555", fontSize:12, marginBottom:4 }}>#{top.card.number} · {top.card.set?.name}</div>
                  <div style={{ color:"#555", fontSize:11, marginBottom:8 }}>{top.card.rarity}</div>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:4,
                    background:`${TEAL}22`, border:`1px solid ${TEAL}44`, borderRadius:20, padding:"2px 10px" }}>
                    <span style={{ color:TEAL, fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:1 }}>{Math.round((top.score||0)*100)}%</span>
                    <span style={{ color:TEAL, fontSize:9 }}>MATCH</span>
                  </div>
                </div>
              </div>
              {priceCheckMode ? (
                <PriceCheckPanel card={top.card} topVariants={topVariants} autoFinish={autoFinish} VARIANT_CONFIG={VARIANT_CONFIG}
                  isInList={wishlist.some(w => w.card.id === top.card.id)}
                  onAddToList={(card, variant, price) => {
                    setWishlist(prev => [...prev, {
                      id: `${card.id}-${Date.now()}`, card, variant, price, addedAt: Date.now(),
                    }]);
                  }}/>
              ) : (
                <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                  {topVariants.map(v => {
                    const vc = VARIANT_CONFIG[v] || VARIANT_CONFIG.normal;
                    const isAuto = v === autoFinish;
                    return (
                      <button key={v} onClick={()=>handleConfirm(top.card, v)}
                        style={{ flex:1, padding:"12px 4px", borderRadius:12, cursor:"pointer",
                          background: isAuto ? vc.color+"33" : "#1a1a1a",
                          border: `2px solid ${isAuto ? vc.color : BORDER}`,
                          color: isAuto ? vc.color : "#555",
                          fontWeight: isAuto ? 700 : 400, fontSize:12,
                          display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                        <span>{vc.label}</span>
                        {isAuto && <span style={{ fontSize:9, letterSpacing:0.5, opacity:0.8 }}>DETECTED</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {priceCheckMode && (
                <button onClick={()=>{ setPhase("camera"); setPcView("camera"); setTopMatches([]); setQueryVec(null); setSelectedMatch(null); }}
                  style={{ width:"100%", padding:14, background:TEAL, border:"none", borderRadius:12,
                    color:"#000", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit",
                    marginBottom:14 }}>
                  Check Another Card
                </button>
              )}
              {topMatches.length > 1 && (
                <div style={{ color:"#444", fontSize:10, letterSpacing:1, marginBottom:8 }}>OTHER MATCHES</div>
              )}
            </div>
          ) : (
            <div style={{ padding:32, textAlign:"center", color:"#555" }}>
              No matches found.<br/>
              <button onClick={()=>setPhase("search")} style={{ color:TEAL, background:"none",
                border:"none", cursor:"pointer", marginTop:8, fontSize:14 }}>Search manually</button>
            </div>
          )}
          {topMatches.filter(m => m.id !== top?.id).map((m) => (
              <button key={m.id} onClick={()=>setSelectedMatch(m)}
                style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 20px",
                  borderBottom:`1px solid ${BORDER}`, cursor:"pointer", width:"100%",
                  background:"transparent", border:"none", borderBottom:`1px solid ${BORDER}`, textAlign:"left" }}>
                {m.card?.images?.small && (
                  <img src={m.card.images.small} alt={m.card.name}
                    style={{ height:48, borderRadius:4, flexShrink:0 }}
                    onError={e=>e.target.style.display="none"}/>
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ color:"#aaa", fontWeight:600, fontSize:13 }}>{m.card?.name}</div>
                  <div style={{ color:"#444", fontSize:11 }}>#{m.card?.number} · {m.card?.set?.name}</div>
                </div>
                <div style={{ color:"#555", fontFamily:"'Bebas Neue',sans-serif", fontSize:16 }}>
                  {Math.round(m.score*100)}%
                </div>
              </button>
            ))}
        </div>

        {dupCard && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", zIndex:300,
            display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"#111", borderRadius:20, padding:24, width:"100%", maxWidth:340 }}>
              <div style={{ color:"#fff", fontWeight:700, marginBottom:8 }}>Already in collection</div>
              <div style={{ color:"#555", fontSize:13, marginBottom:20 }}>Add another copy?</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setDupCard(null)} style={{ flex:1, padding:12,
                  background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:12,
                  color:"#888", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                <button onClick={async ()=>{ if(pendingAdd) {
                  setSessionCards(prev => [...prev, { card: pendingAdd.card, condition: pendingAdd.condition, id: `${pendingAdd.card.id}-${Date.now()}` }]);
                  await onDone(pendingAdd.card, pendingAdd.condition, null);
                  setDupCard(null); setPendingAdd(null);
                  setPhase("camera"); setTopMatches([]); setQueryVec(null);
                } }}
                  style={{ flex:1, padding:12, background:TEAL, border:"none", borderRadius:12,
                  color:"#000", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Add Copy</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Search phase ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"fixed", inset:0, background:BG, zIndex:10002, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"0 20px 16px", paddingTop:"calc(env(safe-area-inset-top, 16px) + 16px)",
        display:"flex", alignItems:"center", gap:12, borderBottom:`1px solid ${BORDER}`, background:BG }}>
        <button onClick={topMatches.length > 0 ? ()=>setPhase("confirm") : ()=>setPhase("camera")}
          style={{ background:"none", border:"none", color:TEAL, fontSize:28, cursor:"pointer", padding:"4px 8px 4px 0", lineHeight:1 }}>‹</button>
        <input ref={searchInputRef} value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search by name, number, or set..." autoCorrect="off" autoComplete="off" autoCapitalize="none" spellCheck={false}
          style={{ flex:1, background:"#1a1a1a", border:`1px solid ${BORDER}`, borderRadius:10,
            padding:"10px 14px", color:"#fff", fontSize:16, fontFamily:"inherit", outline:"none" }}/>
      </div>

      {/* Foil selector in search */}
      <div style={{ padding:"10px 20px", display:"flex", gap:8, borderBottom:`1px solid ${BORDER}` }}>
        {[["nonfoil","Non-Foil","#6b7280"],["foil","Foil","#f59e0b"]].map(([val,label,color])=>(
          <button key={val} onClick={()=>{ /* foil is chosen at confirm step */ }} style={{
            flex:1, padding:"5px 4px", borderRadius:8, fontSize:11, cursor:"default",
            background: "#1a1a1a", border: `1.5px solid ${BORDER}`, color:"#555",
          }}>{label}</button>
        ))}
        <span style={{ color:"#444", fontSize:10, alignSelf:"center", flexShrink:0 }}>choose at confirm</span>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {searchResults.map(card => (
          <button key={card.id} onClick={()=>{
            if (priceCheckMode) {
              const m = { id: card.id, score: 1, card };
              setTopMatches([m]);
              setSelectedMatch(m);
              setPhase("confirm");
              return;
            }
            handleConfirm(card, "nonfoil");
          }}
            style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 20px",
              borderBottom:`1px solid ${BORDER}`, cursor:"pointer", width:"100%",
              background:"transparent", border:"none", borderBottom:`1px solid ${BORDER}`, textAlign:"left" }}>
            {card.images?.small && (
              <img src={card.images.small} alt={card.name}
                style={{ height:50, borderRadius:4, flexShrink:0 }}
                onError={e=>e.target.style.display="none"}/>
            )}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ color:"#fff", fontWeight:600 }}>{card.name}</div>
              <div style={{ color:"#555", fontSize:11 }}>#{card.number} · {card.set?.name} · {card.rarity}</div>
            </div>
          </button>
        ))}
        {search.length > 1 && searchResults.length === 0 && (
          <div style={{ padding:32, textAlign:"center", color:"#555" }}>
            {Object.keys(metaRef.current).length === 0 ? "Card database loading..." : "No cards found"}
          </div>
        )}
        {search.length === 0 && (
          <div style={{ padding:32, textAlign:"center", color:"#555" }}>
            Type a card name, number, or set name
          </div>
        )}
      </div>
    </div>
  );
}

function ScanFlow({ onDone, onClose, collection = [], setFilter = null, setCards: setCardList = null, setId = null }) {
  const [phase, setPhase]           = useState("camera");
  const [scanned, setScanned]       = useState(null);
  const [results, setResults]       = useState([]);
  const [dupCard, setDupCard]       = useState(null);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [detectedCondition, setDetectedCondition] = useState("near_mint");

  const finishToCondition = (finish) => "near_mint"; // MTG: condition always NM at scan time

  const handleResult = async (parsed) => {
    setScanned(parsed);
    if (parsed.finish) setDetectedCondition(finishToCondition(parsed.finish));
    try {
      // If OCR already matched a card directly, use it
      if (parsed._card) {
        setResults([parsed._card]);
        setPhase("confirm"); return;
      }

      // Fast local match against the preloaded set's card list (same as pack scanning)
      if (setCardList?.length) {
        const m = matchMTGCard(parsed.name, parsed.number, setCardList);
        if (m?.card?._full) {
          setResults([m.card._full]);
          setPhase("confirm"); return;
        }
      }

      // Run name search and set-number fallback in parallel
      const hasName   = parsed.name && parsed.name.length > 2;
      const hasNumSet = parsed.number && setFilter;
      const [nameCards, numSetCards] = await Promise.all([
        hasName   ? searchCards(parsed.name, 20) : Promise.resolve([]),
        hasNumSet ? searchCards(`number:${parsed.number}`, 10) : Promise.resolve([]),
      ]);

      let cards = nameCards;

      // Filter by number when name search succeeded
      if (parsed.number && cards.length > 0) {
        const numClean = String(parseInt(parsed.number, 10));
        const exact = cards.filter(c => String(parseInt(c.number||"0",10)) === numClean);
        if (exact.length > 0) cards = exact;
      }

      // Fall back to number-based results if name search came up empty
      if (cards.length === 0 && numSetCards.length > 0) {
        const inSet = numSetCards.filter(c =>
          (c.set?.name||"").toLowerCase().includes((setFilter||"").toLowerCase().slice(0,8))
        );
        cards = inSet.length > 0 ? inSet : numSetCards;
      }

      // Set filter
      if (setFilter && cards.length > 1) {
        const inSet = cards.filter(c =>
          (c.set?.name||"").toLowerCase().includes(setFilter.toLowerCase().slice(0,10)) ||
          setFilter.toLowerCase().includes((c.set?.name||"").toLowerCase().slice(0,8))
        );
        if (inSet.length > 0) cards = inSet;
      }

      setResults(cards.slice(0, 8));
    } catch(_e) { setResults([]); }
    setPhase("confirm");
  };

  const handleConfirm = async (card, condition, acqData) => {
    const existing = collection.find(i => i.card.id === card.id);
    if (existing) { setDupCard(existing); setPendingAdd({ card, condition, acqData }); return; }
    onDone(card, condition, acqData);
    onClose();
  };

  const confirmDuplicate = () => {
    if (pendingAdd) onDone(pendingAdd.card, pendingAdd.condition, pendingAdd.acqData);
    setDupCard(null); setPendingAdd(null); onClose();
  };

  const skipDuplicate = () => { setDupCard(null); setPendingAdd(null); onClose(); };

  if (phase === "camera") return <ScanView onResult={handleResult} onClose={onClose} setFilter={setFilter}
    onSearchFallback={() => { setPhase("confirm"); setScanned({ name:"", number:"", detected:false }); setResults([]); }}/>;

  return (
    <div style={{ position:"fixed", inset:0, background:BG, zIndex:10000, display:"flex", flexDirection:"column" }}>
      <div className="fixed-overlay-header" style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", padding:"14px 20px", paddingTop:"calc(14px + env(safe-area-inset-top, 0px))", gap:14, borderBottom:`1px solid ${BORDER}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
            <Icon.Close size={20} color="#fff"/>
          </button>
          <span style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1 }}>
            ADD TO COLLECTION
          </span>
        </div>

      </div>

      {/* Duplicate warning banner */}
      {dupCard && (
        <div style={{ background:"#1a0f00", border:`1px solid #f97316`, borderRadius:0,
          padding:"14px 20px", flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 20h20L12 2z" stroke="#f97316" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M12 9v5M12 16.5v.5" stroke="#f97316" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ color:"#f97316", fontFamily:"'Bebas Neue',sans-serif", fontSize:14, letterSpacing:0.5 }}>
              ALREADY IN YOUR COLLECTION
            </span>
          </div>
          <div style={{ color:"#888", fontSize:12, marginBottom:12 }}>
            You already own <span style={{ color:"#fff" }}>{dupCard.card.name}</span> ({dupCard.card.set?.name} #{dupCard.card.number}).
            Add a second copy?
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={confirmDuplicate} style={{
              flex:1, padding:"9px 0", background:"#f97316", border:"none",
              borderRadius:10, color:"#000", fontWeight:700, fontSize:13,
              cursor:"pointer", fontFamily:"inherit" }}>Add Anyway</button>
            <button onClick={skipDuplicate} style={{
              flex:1, padding:"9px 0", background:"#111", border:`1px solid ${BORDER}`,
              borderRadius:10, color:"#888", fontSize:13,
              cursor:"pointer", fontFamily:"inherit" }}>Skip</button>
          </div>
        </div>
      )}

      <ScanConfirm scanned={scanned} searchResults={results} onConfirm={handleConfirm} onRetry={()=>setPhase("camera")} defaultCondition={detectedCondition}/>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
// ── Add Missing Card Modal (from Master Sets) ─────────────────────────────────
function AddMissingCardModal({ card, collection, onAdd, onClose }) {
  const [condition, setCondition] = useState(card._forceCondition || "near_mint");
  const [acqType, setAcqType]     = useState("bought");
  const [costPaid, setCostPaid]   = useState("");
  const [dupWarning, setDupWarning] = useState(false);
  const prices = getPrices(card);

  useEffect(() => {
    const dup = collection.some(i => i.card.id === card.id);
    setDupWarning(dup);
  }, [card]);

  const handleAdd = () => {
    onAdd(card, condition, { acqType, costPaid: costPaid ? parseFloat(costPaid) : null });
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:300,
      display:"flex", flexDirection:"column", justifyContent:"flex-end" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:"#111", borderRadius:"20px 20px 0 0", padding:"20px 20px 40px",
        borderTop:`1px solid ${BORDER}`, maxHeight:"85vh", overflowY:"auto" }}>
        {/* Card preview */}
        <div style={{ display:"flex", gap:14, alignItems:"center", marginBottom:20 }}>
          <img src={card.images?.small} alt={card.name}
            style={{ height:80, borderRadius:8, flexShrink:0 }}/>
          <div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:0.5 }}>
              {card.name}
            </div>
            <div style={{ color:"#555", fontSize:12 }}>{card.set?.name} · #{card.number}</div>
            <div style={{ color:"#555", fontSize:11 }}>{card.rarity}</div>
          </div>
        </div>

        {dupWarning && (
          <div style={{ background:"#1a0f00", border:`1px solid #f97316`, borderRadius:10,
            padding:"10px 14px", marginBottom:16, color:"#f97316", fontSize:12,
            display:"flex", alignItems:"center", gap:8 }}>
            <Icon.Warning size={14} color="#f97316"/> You already own a copy of this card
          </div>
        )}

        {/* Condition */}
        <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:8 }}>CONDITION</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
          {Object.entries(condLabels).map(([key,label]) => {
            const price = prices?.raw[key] || 0;
            const sel = condition === key;
            return (
              <button key={key} onClick={()=>setCondition(key)} style={{
                background:sel?condColors[key]+"18":"#0d0d0d",
                border:`2px solid ${sel?condColors[key]:BORDER}`,
                borderRadius:10, padding:"9px 12px", textAlign:"left", cursor:"pointer",
              }}>
                <div style={{ color:condColors[key], fontSize:10, fontWeight:700 }}>{label}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:16,
                  color:sel?"#fff":"#555", letterSpacing:1 }}>
                  {price > 0 ? fmt(price) : "—"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Acquisition */}
        <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:8 }}>HOW DID YOU GET IT?</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
          {[{id:"bought",label:"Bought"},{id:"pack",label:"Pack Pull"},{id:"gift",label:"Gift"},{id:"scan",label:"Found/Scan"}].map(a=>(
            <button key={a.id} onClick={()=>setAcqType(a.id)} style={{
              background:acqType===a.id?"#0d1f19":"#0d0d0d",
              border:`2px solid ${acqType===a.id?TEAL:BORDER}`,
              borderRadius:10, padding:"10px 12px", cursor:"pointer",
              color:acqType===a.id?TEAL:"#666", fontSize:12, fontWeight:600,
            }}>{a.label}</button>
          ))}
        </div>

        {acqType === "bought" && (
          <>
            <div style={{ color:"#888", fontSize:11, letterSpacing:0.5, marginBottom:6 }}>PRICE PAID</div>
            <input type="number" inputMode="decimal" placeholder="0.00"
              value={costPaid} onChange={e=>setCostPaid(e.target.value)}
              style={{ width:"100%", padding:"12px 14px", background:"#0d0d0d",
                border:`1px solid ${BORDER}`, borderRadius:12, color:"#fff",
                fontSize:15, fontFamily:"inherit", outline:"none",
                boxSizing:"border-box", marginBottom:16 }}/>
          </>
        )}

        <button onClick={handleAdd} style={{ width:"100%", padding:15, background:TEAL,
          border:"none", borderRadius:14, fontFamily:"'Bebas Neue',sans-serif",
          fontSize:18, letterSpacing:1, color:"#000", cursor:"pointer", marginBottom:8 }}>
          ADD TO COLLECTION
        </button>
        <button onClick={onClose} style={{ width:"100%", padding:10, background:"none",
          border:"none", color:"#555", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}


function App() {
  // Measure real screen insets once on mount — no CSS env() guessing
  const [insets, setInsets] = useState({ top: 0, bottom: 0 });
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
  useEffect(() => {
    const measure = () => {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
        'padding-top:env(safe-area-inset-top,0px)',
        'padding-bottom:env(safe-area-inset-bottom,0px)',
        'visibility:hidden', 'pointer-events:none'
      ].join(';');
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const top = parseInt(cs.paddingTop) || 0;
      const bottom = parseInt(cs.paddingBottom) || 0;
      el.remove();
      setInsets({ top, bottom });
      setIsDesktop(window.innerWidth >= 768);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const NAV_H = 60;
  const [tab, setTab]           = useState("home");
  const [collection, setCol]    = useState([]);
  const [boxes, setBoxes]       = useState([]);
  const [loaded, setLoaded]     = useState(false);
  const [crashLog]              = useState(() => { try { return JSON.parse(localStorage.getItem("pktk_last_crash") || "null"); } catch(_) { return null; } });
  const [scanning, setScanning] = useState(false);
  const [priceChecking, setPriceChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dupeCard, setDupeCard]     = useState(null);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [detail, setDetail]         = useState(null);
  const [browseSet, setBrowseSet]   = useState(null);
  const [browseCard, setBrowseCard] = useState(null);
  const [collSubTab, setCollSubTab]   = useState("collection");
  const [masterSetId, setMasterSetId] = useState(null);
  const [collSort, setCollSort]       = useState("date_desc");
  const [tradeList, setTradeList]     = useState(() => loadTradeList());
  const toggleTrade = (itemId) => {
    setTradeList(prev => {
      const next = prev.includes(itemId) ? prev.filter(id=>id!==itemId) : [...prev, itemId];
      saveTradeList(next);
      return next;
    });
  };
  const [missingCard, setMissingCard] = useState(null);
  const [newBoxOpen, setNewBoxOpen]               = useState(false);
  const [activeBox, setActiveBox]                 = useState(null);
  const [activeSetName, setActiveSetName]         = useState(null);
  const [openingPackForBox, setOpeningPackForBox] = useState(null);
  const [refreshing, setRefreshing]               = useState(false);
  const [fbUser,    setFbUser]    = useState(null);   // Firebase auth user
  const [fbSyncing, setFbSyncing] = useState(false);  // syncing indicator
  const fbListenerRef = useRef(null);

  // Register Firestore sync so module-level saveCollection can call it
  useEffect(() => {
    registerFirestoreSave(async (col) => {
      const user = getCurrentUser();
      if (user && isFirebaseConfigured()) {
        saveCollectionToFirestore(user.uid, col).catch(e =>
          console.warn("[Firebase] collection sync failed:", e)
        );
      }
    });
  }, []);

  // Pre-cache all card images + set logos via service worker
  // Runs in background — zero UI impact
  useEffect(() => {
    if (!navigator.serviceWorker?.controller) return;
    if (!collection?.length) return;

    // Gather all image URLs from collection
    const imageUrls = [];
    collection.forEach(item => {
      const small = item.card?.images?.small;
      const large = item.card?.images?.large;
      if (small) imageUrls.push(small);
      if (large) imageUrls.push(large);
    });

    // Also pre-cache set logos from boxes
    boxes?.forEach(box => {
      if (box.setLogo) imageUrls.push(box.setLogo);
    });

    // Deduplicate
    const unique = [...new Set(imageUrls)];
    if (!unique.length) return;

    // Tell SW to cache in background — batched so it doesn't hammer network
    navigator.serviceWorker.controller.postMessage({
      type: "PRECACHE_IMAGES",
      urls: unique,
    });
  }, [collection?.length, boxes?.length]);

  // ── Firebase auth + real-time sync ─────────────────────────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    // Complete any pending redirect sign-in (mobile flow)
    handleRedirectResult().catch(() => {});
    const unsub = onAuthChange(async (user) => {
      setFbUser(user);
      if (user) {
        // Load from Firestore on sign-in — merge with local if local is newer
        setFbSyncing(true);
        const [fbCollection, fbBoxes] = await Promise.all([
          loadCollectionFromFirestore(user.uid),
          loadBoxesFromFirestore(user.uid),
        ]);
        if (fbCollection?.length > collection.length) {
          setCol(fbCollection);
          await saveCollection(fbCollection);
        }
        if (fbBoxes?.length > boxes.length) {
          setBoxes(fbBoxes);
          saveBoxes(fbBoxes);
        }
        setFbSyncing(false);

        // Start real-time listener for changes from other devices
        if (fbListenerRef.current) fbListenerRef.current();
        fbListenerRef.current = listenToUserData(user.uid, (type, data) => {
          if (type === "collection" && data?.length) {
            setCol(prev => data.length > prev.length ? data : prev);
          }
          if (type === "boxes" && data?.length) {
            setBoxes(prev => data.length > prev.length ? data : prev);
          }
        });
      } else {
        if (fbListenerRef.current) { fbListenerRef.current(); fbListenerRef.current = null; }
      }
    });
    return () => { unsub(); if (fbListenerRef.current) fbListenerRef.current(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backfill auto-tags for existing collection items that predate the tag system
  const hasBackfilledTags = React.useRef(false);
  useEffect(() => {
    if (hasBackfilledTags.current || collection.length === 0) return;
    const needsTags = collection.some(i => !i.autoTags);
    if (!needsTags) { hasBackfilledTags.current = true; return; }
    const updated = collection.map(i => ({
      ...i,
      autoTags: i.autoTags || computeAutoTags(i.card),
      userTags: i.userTags || [],
    }));
    hasBackfilledTags.current = true;
    setCol(updated);
    saveCollection(updated).catch(()=>{});
  }, [collection.length]);

  // Auto-refresh prices AND fix cards with missing images when portfolio is opened
  const hasAutoRefreshed = React.useRef(false);
  useEffect(() => {
    if ((tab !== "collection" && tab !== "decks") || refreshing || hasAutoRefreshed.current) return;
    const noPriceCards = collection.filter(i => !i.sold && genPrices(i.card).raw.near_mint === 0);
    const noImageCards = collection.filter(i => !i.sold && !i.card?.images?.small && !i.card?.images?.large);
    const lastRefresh = parseInt(localStorage.getItem(PRICES_REFRESHED_KEY) || "0", 10);
    const pricesStale = Date.now() - lastRefresh > 6 * 3600_000;
    if (noPriceCards.length > 0 || noImageCards.length > 0 || (pricesStale && collection.length > 0)) {
      hasAutoRefreshed.current = true;
      setTimeout(() => refreshAllPrices(), 800);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, collection.length]);

  useEffect(()=>{
    purgeBadPriceCache();
    // Strip any stale injected prices so they re-fetch fresh from Scryfall
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const col = JSON.parse(raw);
        let changed = false;
        const cleaned = col.map(item => {
          const prices = item.card?.tcgplayer?.prices || {};
          const priceVals = Object.values(prices).map(p => p?.market || p?.mid || 0);
          const maxPrice = Math.max(...priceVals, 0);
          // Strip if: has _priceSource flag, OR if injected near_mint price seems unreasonably high (>$50 for a common/uncommon)
          const rarity = (item.card?.rarity || "").toLowerCase();
          const isCommon = rarity.includes("common") || rarity.includes("uncommon") || rarity === "";
          const suspiciousPrice = isCommon && maxPrice > 20;
          if (item.card?.tcgplayer?._priceSource || suspiciousPrice) {
            changed = true;
            const { _priceSource, prices: _p, ...tcgRest } = item.card.tcgplayer || {};
            // Also restore original pokemontcg.io image if we have it cached
            // Strip any stale image data so card detail re-fetches fresh
            const cleanCard = { ...item.card, tcgplayer: tcgRest };
            // Card will re-fetch from Scryfall when opened
                        return { ...item, card: cleanCard };
          }
          return item;
        });
        if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      }
    } catch(_e) {}
    loadCollection().then(async c=>{
      setCol(c);
      if (!c?.length) return;
      // Silently refresh prices for $0 cards in background
      setTimeout(async () => {
        let changed = false;
        const updated = [...c];
        for (let i = 0; i < updated.length; i++) {
          const item = updated[i];
          const prices = getPrices(item.card);
          const hasPrice = prices.raw.near_mint || prices.raw.near_mint || 0;
          if (hasPrice > 0) continue; // skip cards that already have prices
          try {
            const fresh = await scryfallFetch(`/cards/${item.card.id}`).then(d => d ? normalizeScryfallCard(d) : null);
            if (fresh?.prices) {
              recordPriceSnapshot(fresh);
              const price = parseFloat(fresh.prices.usd || fresh.prices.usd_foil || 0);
              if (price > 0) setWebPriceCache(item.card.id, price);
              updated[i] = { ...item, card: { ...item.card, prices: fresh.prices } };
              changed = true;
              setCol([...updated]);
            }
          } catch(_e) {}
        }
        if (changed) saveCollection(updated);
      }, 1500);
    });
    setBoxes(loadBoxes());
    setLoaded(true);
  },[]);

  const addCard = async (card, condition, acqData={}) => {
    if (collection.some(i => i.card.id === card.id)) {
      if (!window.__dupeConfirmed) {
        setDupeCard(card);
        setPendingAdd({ card, condition, acqData });
        return;
      }
      window.__dupeConfirmed = false;
    }
    const item = {
      id: `${card.id}-${Date.now()}`,
      card, condition,
      foil: acqData?.foil || false,
      addedAt: Date.now(),
      acqType:  acqData.acqType  || "bought",
      costPaid: acqData.costPaid || null,
      packName: acqData.packName || null,
      sold: false,
      soldAt: null,
      soldPrice: null,
      autoTags: computeAutoTags(card),
      userTags: [],
    };
    const next = [...collection, item];
    setCol(next); await saveCollection(next);
    setScanning(false); setDetail(null); setTab("home");
  };

  const removeCard = async (id) => {
    let saved;
    setCol(prev => {
      saved = prev.filter(i => i.id !== id);
      return saved;
    });
    await new Promise(r => setTimeout(r, 0));
    if (saved) await saveCollection(saved);
    setDetail(null);
  };

  const bulkDeleteCards = async (ids) => {
    const idSet = new Set(ids);
    let saved;
    setCol(prev => { saved = prev.filter(i => !idSet.has(i.id)); return saved; });
    await new Promise(r => setTimeout(r, 0));
    if (saved) await saveCollection(saved);
  };

  const bulkUpdateCondition = async (ids, newCondition) => {
    const idSet = new Set(ids);
    let saved;
    setCol(prev => { saved = prev.map(i => idSet.has(i.id) ? { ...i, condition: newCondition } : i); return saved; });
    await new Promise(r => setTimeout(r, 0));
    if (saved) await saveCollection(saved);
  };

  const markSold = async (id, soldPrice) => {
    let saved;
    setCol(prev => {
      saved = prev.map(i => i.id===id ? { ...i, sold:true, soldAt:Date.now(), soldPrice } : i);
      return saved;
    });
    await new Promise(r => setTimeout(r, 0));
    if (saved) {
      await saveCollection(saved);
      setDetail(saved.find(i=>i.id===id) || null);
    }
  };

  const handleImport = async (items) => {
    let saved;
    setCol(prev => { saved = [...prev, ...items]; return saved; });
    await new Promise(r => setTimeout(r, 0));
    if (saved) await saveCollection(saved);
    setImporting(false); setTab("collection");
  };
  const handleSearchCardPress = (card) => {
    const existing = collection.find(i=>i.card.id===card.id);
    setDetail(existing || { id:"__preview__", card, condition:"near_mint", preview:true });
  };

  if (!loaded) return (
    <div style={{ height:"100svh", background:BG, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
      <div style={{ width:40, height:40, border:`3px solid ${TEAL}`, borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.8s linear infinite" }}/>
    </div>
  );

  // ── Refresh all prices ───────────────────────────────────────────────────────
  const refreshAllPrices = async () => {
    if (refreshing || !collection.length) return;
    setRefreshing(true);
    // (legacy cache clear — no-op)
    try { localStorage.removeItem(TCGCSV_PRICE_KEY); } catch(_e) {}
    try { localStorage.removeItem(WEB_PRICE_CACHE_KEY); } catch(_e) {}

    const updated = [...collection];
    let lastUiUpdate = Date.now();
    const UPDATE_INTERVAL = 400; // ms — throttle re-renders during bulk refresh

    // Fetch all prices in parallel from Scryfall
    await Promise.all(updated.map(async (item, i) => {
      try {
        const fresh = await scryfallFetch(`/cards/${item.card.id}`).then(d => d ? normalizeScryfallCard(d) : null);
        if (fresh?.prices) {
          const price = parseFloat(fresh.prices.usd || fresh.prices.usd_foil || 0);
          recordPriceSnapshot(fresh);
          if (price > 0) setWebPriceCache(item.card.id, price);
          updated[i] = { ...item, card: { ...item.card, prices: fresh.prices } };
          const now = Date.now();
          if (now - lastUiUpdate > UPDATE_INTERVAL) {
            lastUiUpdate = now;
            setCol([...updated]);
          }
        }
      } catch(_e) {}
    }));

    setCol([...updated]);
    await saveCollection(updated);
    try { localStorage.removeItem(PRICES_REFRESHED_KEY); } catch(_e) {}
    setRefreshing(false);
  };

  // ── Box / Pack handlers ───────────────────────────────────────────────────
  const saveBox = async (box) => {
    const next = [...boxes, box];
    setBoxes(next); saveBoxes(next);
    setNewBoxOpen(false);
    setActiveBox(box);
    setTab("packs");
  };

  const fbSaveBoxes = (next) => {
    saveBoxes(next);
    const user = getCurrentUser();
    if (user && isFirebaseConfigured()) {
      saveBoxesToFirestore(user.uid, next).catch(e =>
        console.warn("[Firebase] boxes save failed:", e)
      );
    }
  };

  const deleteBox = (id) => {
    const next = boxes.filter(b=>b.id!==id);
    setBoxes(next); fbSaveBoxes(next);
    setActiveBox(null);
    if (activeSetName) {
      const remaining = next.filter(b => (b.productType==='single_pack'||b.totalPacks===1) && b.setName===activeSetName);
      if (remaining.length === 0) setActiveSetName(null);
    }
  };

  // ── CSV Export ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ["Name","Set","Number","Rarity","Condition","Market Value","Paid","P&L","Acquired","Source"],
    ];
    collection.forEach(item => {
      const card   = item.card;
      const prices = genPrices(card);
      const val    = prices.raw[item.condition] || 0;
      const paid   = item.pricePaid || 0;
      const pnl    = paid > 0 ? val - paid : "";
      rows.push([
        card.name || "",
        card.set?.name || "",
        card.number || "",
        card.rarity || "",
        condLabels[item.condition] || item.condition || "",
        val.toFixed(2),
        paid > 0 ? paid.toFixed(2) : "",
        pnl !== "" ? pnl.toFixed(2) : "",
        item.acquiredAt ? new Date(item.acquiredAt).toLocaleDateString() : "",
        item.source || "",
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `mtgtracker-collection-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Full JSON Backup ────────────────────────────────────────────────────────
  const exportBackup = () => {
    const backup = {
      version:    2,
      exportedAt: new Date().toISOString(),
      collection,
      boxes,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type:"application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `mtgtracker-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateBox = (updatedBox) => {
    const next = boxes.map(b => b.id===updatedBox.id ? updatedBox : b);
    setBoxes(next); fbSaveBoxes(next);
  };

  const handlePackDone = async (box, cards) => {
    const packNumber = box.packs.filter(p=>p.opened).length + 1;

    // Fetch current prices for all pulled cards in parallel from Scryfall
    const cardsWithPrices = await Promise.all(cards.map(async (c) => {
      try {
        const fresh = await scryfallFetch(`/cards/${c.card.id}`).then(d => d ? normalizeScryfallCard(d) : null);
        if (fresh?.prices) {
          recordPriceSnapshot(fresh);
          return { ...c, card: fresh };
        }
      } catch(_e) {}
      return c;
    }));

    const newPack = {
      id: `pack-${Date.now()}`, packNumber,
      opened: true, openedAt: Date.now(),
      cards: cardsWithPrices,
    };
    const updatedBox = { ...box, packs:[...box.packs, newPack] };
    const updatedBoxes = boxes.map(b => b.id===box.id ? updatedBox : b);
    setBoxes(updatedBoxes); fbSaveBoxes(updatedBoxes);
    if (!activeSetName) setActiveBox(updatedBox);
    setOpeningPackForBox(null);

    // Add all cards to collection with pack cost basis
    const costPerPack = box.pricePaid / box.totalPacks;
    let current = [...collection];
    for (let i = 0; i < cardsWithPrices.length; i++) {
      const c = cardsWithPrices[i];
      const item = {
        id:        `${c.card.id}-${Date.now()}-${i}`,
        card:      c.card,
        condition: c.condition,
        foil:      c.foil || false,
        addedAt:   Date.now() + i,
        acqType:   "pack",
        costPaid:  +(costPerPack / cardsWithPrices.length).toFixed(2),
        packName:  `${box.setName} Pack #${packNumber}`,
        boxId:     box.id,
        sold:false, soldAt:null, soldPrice:null,
        autoTags:  computeAutoTags(c.card),
        userTags:  [],
      };
      current = [...current, item]; // pack pulls skip dupe check — intentional duplicates
    }
    setCol(current);
    await saveCollection(current);
  };

  // Nav sizing — computed after all hooks
  const screenRatio = window.screen.height / window.screen.width;
  const hasHomeIndicator = /iPhone/.test(navigator.userAgent) && screenRatio > 1.9;
  const bottomInset = insets.bottom > 0 ? insets.bottom : (hasHomeIndicator ? 34 : 0);
  const totalNavH = NAV_H + bottomInset;

  const tabs = [
    { id:"home",       Icon:Icon.Home,      label:"Home" },
    { id:"search",     Icon:Icon.Search,    label:"Search" },
    { id:"scan",       Icon:Icon.Camera,    label:"Scan", action:()=>setScanning(true), isScan:true },
    { id:"packs",      Icon:Icon.Pack,      label:"Packs" },
    { id:"decks",      Icon:Icon.Deck,      label:"Decks" },
  ];

  return (
    <div style={{ flex:1, display:'flex', overflow:'hidden', background:'#0a0a0a' }}>

        {/* Desktop sidebar — only on wide screens */}
        {isDesktop && <DesktopSidebar tabs={tabs} tab={tab} setTab={setTab} setScanning={setScanning} collection={collection}
          onNavigate={(id) => { setTab(id); setDetail(null); setBrowseSet(null); setBrowseCard(null); setActiveBox(null); setActiveSetName(null); }}/>}

        {/* Main content area */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0,
          paddingTop: insets.top, overflow:'hidden' }}>
          <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', minHeight:0,
            WebkitOverflowScrolling:'touch', overscrollBehavior:'contain',
            animation:'fadeUp 0.25s ease' }}>
            {detail ? (
              <CardDetailView
                item={detail}
                onBack={()=>setDetail(null)}
                onRemove={removeCard}
                onMarkSold={markSold}
                tradeList={tradeList}
                onToggleTrade={toggleTrade}
                boxes={boxes}
                collection={collection}
                onUpdateCard={async (updatedItem) => {
                  const next = collection.map(i => i.id === updatedItem.id ? updatedItem : i);
                  setCol(next);
                  await saveCollection(next);
                  setDetail(updatedItem);
                }}
              />
            ) : browseCard ? (
              <CardBrowseDetailView
                card={browseCard}
                onBack={() => setBrowseCard(null)}
                onAdd={addCard}
              />
            ) : browseSet ? (
              <SetBrowseView
                setInfo={browseSet}
                onBack={() => setBrowseSet(null)}
                onCardPress={card => setBrowseCard(card)}
              />
            ) : tab==="home" ? (
              <div style={{ height:"100%", display:"flex", flexDirection:"column" }}>
                {crashLog && (
                  <div style={{ background:"#1a0a0a", borderBottom:"1px solid #ef444433",
                    padding:"10px 16px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                    <Icon.Warning size={14} color="#ef4444"/>
                    <span style={{ color:"#ef4444", fontSize:12, flex:1 }}>
                      Last crash: {crashLog.msg?.slice(0,60)}{crashLog.msg?.length > 60 ? "..." : ""} · {crashLog.ts?.slice(11,19)}
                    </span>
                    <button onClick={()=>{
                      const log = localStorage.getItem("pktk_last_crash");
                      navigator.clipboard?.writeText(log||"").then(()=>alert("Copied!")).catch(()=>alert(log));
                    }} style={{ background:"none", border:"1px solid #ef4444", borderRadius:6,
                      color:"#ef4444", fontSize:10, padding:"3px 8px", cursor:"pointer" }}>Copy</button>
                    <button onClick={()=>{ localStorage.removeItem("pktk_last_crash"); window.location.reload(); }}
                      style={{ background:"none", border:"none", cursor:"pointer", padding:2,
                        display:"flex", alignItems:"center" }}><Icon.Close size={14} color="#555"/></button>
                  </div>
                )}
                <div style={{ flex:1, overflow:"hidden" }}>
                  <HomeView collection={collection} boxes={boxes} onScanPress={()=>setScanning(true)} onPriceCheckPress={()=>setPriceChecking(true)} onCardPress={item=>setDetail(item)} setTabFromHome={setTab} onBrowseSet={set=>{ setBrowseSet(set); setBrowseCard(null); }} onExportCSV={exportCSV} onExportBackup={exportBackup} fbUser={fbUser} fbSyncing={fbSyncing} onSignIn={signInWithGoogle} onSignOut={signOutUser}/>
                </div>
              </div>
            ) : tab==="search" ? (
              <SearchView collection={collection} onCardPress={handleSearchCardPress} onAdd={addCard}/>
            ) : tab==="decks" ? (
              <DecksView collection={collection}/>
            ) : tab==="collection" ? (
              <CollectionView collection={collection} onCardPress={item=>setDetail(item)} onImport={()=>setImporting(true)} onRefreshPrices={refreshAllPrices} refreshing={refreshing}
                collSubTab={collSubTab} setCollSubTab={setCollSubTab}
                masterSetId={masterSetId} setMasterSetId={setMasterSetId}
                sort={collSort} setSort={setCollSort}
                tradeList={tradeList} onToggleTrade={toggleTrade}
                onBulkDelete={bulkDeleteCards} onBulkCondition={bulkUpdateCondition}
                onAddMissingCard={(card, forceCondition)=>{ setMissingCard(forceCondition ? { ...card, _forceCondition: forceCondition } : card); setScanning(false); }}/>
            ) : tab==="packs" ? (
              activeBox ? (
                <BoxDetailView
                  box={activeBox}
                  onBack={()=>setActiveBox(null)}
                  onOpenPack={(box)=>setOpeningPackForBox(box)}
                  onDelete={deleteBox}
                  onUpdateBox={(updatedBox) => {
                    const next = boxes.map(b => b.id===updatedBox.id ? updatedBox : b);
                    setBoxes(next); saveBoxes(next);
                    setActiveBox(updatedBox);
                  }}
                  onRefreshPackCards={async (updatedCards, boxId, packNumber) => {
                    // Update cards in main collection that came from this pack
                    let current = [...collection];
                    let changed = false;
                    updatedCards.forEach(c => {
                      const idx = current.findIndex(i =>
                        i.card.id === c.card.id &&
                        (i.boxId === boxId || i.packName?.includes(`Pack #${packNumber}`))
                      );
                      if (idx >= 0 && c.card.tcgplayer?.prices) {
                        current[idx] = { ...current[idx], card: c.card };
                        changed = true;
                      }
                    });
                    if (changed) {
                      setCol(current);
                      await saveCollection(current);
                    }
                  }}
                  onSyncPack={async (pack, box) => {
                    // Find which cards from this pack are missing from collection
                    const costPerPack = box.pricePaid / box.totalPacks;
                    const missing = pack.cards.filter(c =>
                      !collection.some(i => i.id === `${c.card.id}-pack-${pack.id}` || 
                        (i.boxId === box.id && i.packName === `${box.setName} Pack #${pack.packNumber}` && i.card.id === c.card.id))
                    );
                    if (missing.length === 0) return 0;
                    let current = [...collection];
                    for (let i = 0; i < missing.length; i++) {
                      const c = missing[i];
                      current = [...current, {
                        id: `${c.card.id}-pack-${pack.id}-${i}`,
                        card: c.card,
                        condition: c.condition || "near_mint",
                        addedAt: pack.openedAt + i,
                        acqType: "pack",
                        costPaid: +(costPerPack / pack.cards.length).toFixed(2),
                        packName: `${box.setName} Pack #${pack.packNumber}`,
                        boxId: box.id,
                        sold: false, soldAt: null, soldPrice: null,
                      }];
                    }
                    setCol(current);
                    await saveCollection(current);
                    return missing.length;
                  }}
                  onUpdateCardCondition={(cardRef, newCond) => {
                    // Update condition in pack data and collection
                    const updatedBoxes = boxes.map(b => {
                      if (b.id !== activeBox.id) return b;
                      return { ...b, packs: b.packs.map(pk => ({
                        ...pk, cards: pk.cards.map(c =>
                          c.card.id === cardRef.card.id ? { ...c, condition: newCond } : c
                        )
                      }))};
                    });
                    setBoxes(updatedBoxes); fbSaveBoxes(updatedBoxes);
                    setActiveBox(updatedBoxes.find(b => b.id === activeBox.id));
                    // Also update in collection
                    const updatedCol = collection.map(i =>
                      i.card.id === cardRef.card.id && i.boxId === activeBox.id
                        ? { ...i, condition: newCond } : i
                    );
                    setCol(updatedCol); saveCollection(updatedCol);
                  }}
                />
              ) : activeSetName ? (() => {
                const _isSingle = b => b.productType==='single_pack' || b.totalPacks===1;
                const singleSetBoxes = boxes.filter(b => _isSingle(b) && b.setName===activeSetName);
                if (!singleSetBoxes.length) { setActiveSetName(null); return null; }
                const _totalSlots    = singleSetBoxes.reduce((s,b) => s + b.totalPacks, 0);
                const _totalInvested = singleSetBoxes.reduce((s,b) => s + b.pricePaid, 0);
                const _allOpenedPacks = singleSetBoxes
                  .flatMap(b => b.packs.filter(p => p.opened).map(p => ({ ...p, _boxId: b.id })))
                  .sort((a,b) => a.openedAt - b.openedAt)
                  .map((p, i) => ({ ...p, packNumber: i + 1 }));
                const _box0 = singleSetBoxes[0];
                const virtualBox = {
                  id: `group-${activeSetName}`,
                  productType: 'single_pack',
                  setName: _box0.setName,
                  setId: _box0.setId,
                  setLogo: _box0.setLogo,
                  pricePaid: _totalInvested,
                  totalPacks: _totalSlots,
                  purchasedAt: Math.min(...singleSetBoxes.map(b => b.purchasedAt || Date.now())),
                  packs: _allOpenedPacks,
                };
                return (
                  <BoxDetailView
                    box={virtualBox}
                    onBack={() => setActiveSetName(null)}
                    onOpenPack={() => {
                      const nextBox = singleSetBoxes.find(b => b.packs.length < b.totalPacks);
                      if (nextBox) setOpeningPackForBox(nextBox);
                    }}
                    onDelete={() => {
                      const toDelete = singleSetBoxes.find(b => b.packs.length < b.totalPacks) || singleSetBoxes[singleSetBoxes.length - 1];
                      deleteBox(toDelete.id);
                    }}
                    onUpdateBox={(updatedVBox) => {
                      const packsByBoxId = {};
                      updatedVBox.packs.forEach(p => {
                        if (p._boxId) {
                          if (!packsByBoxId[p._boxId]) packsByBoxId[p._boxId] = [];
                          packsByBoxId[p._boxId].push(p);
                        }
                      });
                      const next = boxes.map(b => {
                        const newPacks = packsByBoxId[b.id];
                        if (!newPacks) return b;
                        return { ...b, packs: newPacks.map(({ _boxId, ...p }) => p) };
                      });
                      setBoxes(next); fbSaveBoxes(next);
                    }}
                    onRefreshPackCards={async (updatedCards) => {
                      let current = [...collection];
                      let changed = false;
                      updatedCards.forEach(c => {
                        const idx = current.findIndex(i =>
                          i.card.id === c.card.id && singleSetBoxes.some(b => b.id === i.boxId)
                        );
                        if (idx >= 0 && c.card.tcgplayer?.prices) {
                          current[idx] = { ...current[idx], card: c.card };
                          changed = true;
                        }
                      });
                      if (changed) { setCol(current); await saveCollection(current); }
                    }}
                    onSyncPack={async (pack) => {
                      const realBox = singleSetBoxes.find(b => b.id === pack._boxId) || singleSetBoxes[0];
                      const costPerPack = realBox.pricePaid / realBox.totalPacks;
                      const missing = pack.cards.filter(c =>
                        !collection.some(i => i.id === `${c.card.id}-pack-${pack.id}` ||
                          (i.boxId === realBox.id && i.packName === `${realBox.setName} Pack #${pack.packNumber}` && i.card.id === c.card.id))
                      );
                      if (missing.length === 0) return 0;
                      let current = [...collection];
                      for (let idx = 0; idx < missing.length; idx++) {
                        const c = missing[idx];
                        current = [...current, {
                          id: `${c.card.id}-pack-${pack.id}-${idx}`,
                          card: c.card,
                          condition: c.condition || "near_mint",
                          addedAt: pack.openedAt + idx,
                          acqType: "pack",
                          costPaid: +(costPerPack / pack.cards.length).toFixed(2),
                          packName: `${realBox.setName} Pack #${pack.packNumber}`,
                          boxId: realBox.id,
                          sold: false, soldAt: null, soldPrice: null,
                        }];
                      }
                      setCol(current);
                      await saveCollection(current);
                      return missing.length;
                    }}
                    onUpdateCardCondition={(cardRef, newCond) => {
                      const updatedBoxes = boxes.map(b => {
                        if (!_isSingle(b) || b.setName !== activeSetName) return b;
                        const hasPack = b.packs.some(p => p.cards.some(c => c.card.id === cardRef.card.id));
                        if (!hasPack) return b;
                        return { ...b, packs: b.packs.map(pk => ({
                          ...pk, cards: pk.cards.map(c =>
                            c.card.id === cardRef.card.id ? { ...c, condition: newCond } : c
                          )
                        }))};
                      });
                      setBoxes(updatedBoxes); fbSaveBoxes(updatedBoxes);
                      const updatedCol = collection.map(i =>
                        i.card.id === cardRef.card.id && singleSetBoxes.some(b => b.id === i.boxId)
                          ? { ...i, condition: newCond } : i
                      );
                      setCol(updatedCol); saveCollection(updatedCol);
                    }}
                  />
                );
              })() : (
                <PacksView
                  boxes={boxes}
                  onNewBox={()=>setNewBoxOpen(true)}
                  onBoxPress={(box)=>setActiveBox(box)}
                  onGroupPress={(setName)=>setActiveSetName(setName)}
                  onDelete={deleteBox}
                  onUpdateBox={updateBox}
                />
              )
            ) : null}
          </div>

          {/* Bottom nav — flex child pinned to the bottom of the column */}
          {!isDesktop && (
            <div style={{
              flexShrink:0,
              background:'#0d0d0d',
              borderTop:'1px solid #1e1e1e',
            }}>
              <div style={{ display:'flex', height:60 }}>
              {tabs.map(t => {
                const active = tab===t.id && !t.isScan;
                const TabIcon = t.Icon;
                if (t.isScan) return (
                  <button key={t.id} onClick={t.action} style={{
                    flex:1, display:'flex', flexDirection:'column', alignItems:'center',
                    background:'none', border:'none', cursor:'pointer', padding:'0 0 4px', gap:4,
                  }}>
                    <div style={{
                      width:56, height:56, borderRadius:'50%', background:TEAL,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      position:'relative', top:-14, boxShadow:`0 0 0 5px #0d0d0d`,
                      marginBottom:-14,
                    }}>
                      <TabIcon size={24} color="#000"/>
                    </div>
                    <span style={{ fontSize:10, color:TEAL, letterSpacing:0.3 }}>Scan</span>
                  </button>
                );
                return (
                  <button key={t.id}
                    onClick={t.action||(() => { setTab(t.id); setDetail(null); setBrowseSet(null); setBrowseCard(null); setActiveBox(null); setActiveSetName(null); if(t.id!=="collection"&&t.id!=="decks"){setCollSubTab("collection");setMasterSetId(null);} })}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                      background:'none', border:'none', cursor:'pointer', padding:'8px 0 4px' }}>
                    <TabIcon size={22} color={active?TEAL:"#444"}/>
                    <span style={{ fontSize:10, color:active?TEAL:"#444", fontWeight:active?700:400, letterSpacing:0.3 }}>{t.label}</span>
                  </button>
                );
              })}
              </div>
              {/* Safe-area spacer — fills the iOS home indicator zone */}
              <div className="h-safe" style={{ background:'#0d0d0d' }}/>
            </div>
          )}
        </div>


      {/* Global overlays — position:fixed, render above everything */}
      {missingCard && (
        <AddMissingCardModal
          card={missingCard}
          collection={collection}
          onAdd={(card,condition,acqData)=>{ addCard(card,condition,acqData); setMissingCard(null); }}
          onClose={()=>setMissingCard(null)}
        />
      )}
      {scanning && <GlobalScanFlow collection={collection} onDone={async (card,condition,acqData)=>{
          const itemId = `${card.id}-${Date.now()}`;
          const item = {
            id: itemId, card, condition,
            foil: acqData?.foil || false,
            addedAt: Date.now(),
            acqType:  acqData?.acqType  || "scan",
            costPaid: acqData?.costPaid || null,
            packName: acqData?.packName || null,
            sold: false, soldAt: null, soldPrice: null,
            autoTags: computeAutoTags(card),
            userTags: [],
          };
          // Functional updater — always reads current collection, avoids stale closure crash
          let savedNext;
          setCol(prev => { savedNext = [...prev, item]; return savedNext; });
          await new Promise(r => setTimeout(r, 0));
          if (savedNext) await saveCollection(savedNext);
          // Background fetch for full card data — fire and forget
          scryfallFetch(`/cards/${card.id}`)
            .then(async d => {
              const enriched = d ? normalizeScryfallCard(d) : card;
              const price = parseFloat(enriched.prices?.usd || enriched.prices?.usd_foil || 0);
              if (price > 0) {
                recordPriceSnapshot(enriched);
                setWebPriceCache(card.id, price);
              }
              setCol(prev => {
                if (!prev.find(i => i.id === itemId)) return prev; // already gone
                const updated = prev.map(i => i.id === itemId ? { ...i, card: enriched } : i);
                saveCollection(updated).catch(()=>{});
                return updated;
              });
            })
            .catch(()=>{});
        }} onClose={()=>{ setScanning(false); setTab("home"); }}/>}

      {priceChecking && <GlobalScanFlow collection={collection} priceCheckMode={true}
        onDone={()=>{}} onClose={()=>setPriceChecking(false)}/>}

      {openingPackForBox && (
          <PackOpeningSession
            box={openingPackForBox}
            packNumber={openingPackForBox.packs.filter(p=>p.opened).length + 1}
            onDone={(cards)=>handlePackDone(openingPackForBox, cards)}
            onCancel={()=>setOpeningPackForBox(null)}
          />
        )}

      {/* New box form */}
      {newBoxOpen && <NewBoxForm onSave={saveBox} onCancel={()=>setNewBoxOpen(false)}/>}

      {/* TCGPlayer import overlay */}
      {importing && (
          <div style={{ position:"fixed", inset:0, background:BG, zIndex:10000, display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", alignItems:"center", padding:"14px 20px", gap:14, borderBottom:`1px solid ${BORDER}`, flexShrink:0 }}>
              <button onClick={()=>setImporting(false)} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
                <Icon.Close size={20} color="#fff"/>
              </button>
              <div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#fff", letterSpacing:1 }}>TCGPLAYER IMPORT</div>
              </div>
              <div style={{ marginLeft:"auto", background:"#1a2a1a", border:`1px solid ${TEAL}44`, borderRadius:8, padding:"3px 8px" }}>
                <span style={{ color:TEAL, fontSize:10, fontWeight:700 }}>AI POWERED</span>
              </div>
            </div>
            <TCGImportView
              onImport={handleImport}
              onClose={()=>setImporting(false)}
              existingIds={collection.map(i=>i.card.id)}
            />
          </div>
        )}

      {/* Duplicate card warning modal */}
      {dupeCard && (() => {
        const existing = collection.filter(i => i.card.id === dupeCard.id);
        const prices = getPrices(dupeCard);
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:300,
            display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
            <div style={{ background:"#111", border:`1px solid ${BORDER}`, borderRadius:24,
              padding:"24px", width:"100%", maxWidth:380 }}>

              {/* Header */}
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:"#f59e0b",
                letterSpacing:1, marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                    stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                ALREADY IN COLLECTION
              </div>

              {/* Card + existing copies side by side */}
              <div style={{ display:"flex", gap:14, marginBottom:16 }}>
                <img src={dupeCard.images?.small} alt={dupeCard.name}
                  style={{ height:90, borderRadius:8, flexShrink:0 }}
                  onError={e=>{e.target.style.opacity="0.3";}}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:"#fff", letterSpacing:0.5 }}>
                    {dupeCard.name}
                  </div>
                  <div style={{ color:"#555", fontSize:12, marginBottom:8 }}>
                    {dupeCard.set?.name} · #{dupeCard.number}
                  </div>
                  <div style={{ color:"#f59e0b", fontSize:12, fontWeight:600 }}>
                    You own {existing.length} cop{existing.length===1?"y":"ies"}:
                  </div>
                  {existing.map((e,i) => {
                    const val = getPrices(e.card).raw[e.condition] || 0;
                    return (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between",
                        color:"#888", fontSize:11, marginTop:3 }}>
                        <span>{condLabels[e.condition]}</span>
                        <span style={{ color:val>0?TEAL:"#555" }}>{val>0?fmt(val):"No price"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* New copy being added */}
              {pendingAdd && (
                <div style={{ background:"#0d0d0d", border:`1px solid ${BORDER}`, borderRadius:12,
                  padding:"10px 14px", marginBottom:16, fontSize:12 }}>
                  <div style={{ color:"#555", marginBottom:2 }}>Adding:</div>
                  <div style={{ color:"#fff" }}>
                    {condLabels[pendingAdd.condition]}
                    {pendingAdd.acqData?.costPaid ? ` · Paid ${fmt(pendingAdd.acqData.costPaid)}` : ""}
                  </div>
                </div>
              )}

              <button onClick={()=>{
                window.__dupeConfirmed = true;
                setDupeCard(null);
                if (pendingAdd) addCard(pendingAdd.card, pendingAdd.condition, pendingAdd.acqData);
                setPendingAdd(null);
              }} style={{ width:"100%", padding:14, background:TEAL, border:"none", borderRadius:14,
                fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:1,
                color:"#000", cursor:"pointer", marginBottom:8 }}>
                YES, ADD {existing.length + 1}{existing.length===0?"":`${existing.length+1===2?"ND":existing.length+1===3?"RD":"TH"}`} COPY
              </button>
              <button onClick={()=>{ setDupeCard(null); setPendingAdd(null); }}
                style={{ width:"100%", padding:12, background:"none", border:`1px solid ${BORDER}`,
                  borderRadius:12, color:"#888", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Cancel — Don't Add
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

// ── Root with PIN protection ──────────────────────────────────────────────────
const AppWithBoundary = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
export default AppWithBoundary;

