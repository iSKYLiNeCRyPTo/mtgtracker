/**
 * cardTags.js — Auto-tagging system for MTGTracker
 *
 * Auto-tags are derived entirely from Scryfall card metadata (no extra API calls).
 * User tags are free-form strings stored on each collection item.
 *
 * Tag sources:
 *   - card.keywords     → MTG keyword abilities (Flying, Haste, etc.)
 *   - card.oracle_text  → gameplay pattern scanning (draw, tutor, removal, etc.)
 *   - card.type_line    → card type tags
 *   - card.colors       → color identity tags
 *   - card.cmc          → converted mana cost brackets
 *   - card.rarity       → rarity tag
 */

// ── Oracle text pattern → tag mappings ──────────────────────────────────────
// Each entry: [tag, regex or string array to match in oracle_text]
const ORACLE_PATTERNS = [
  // Card advantage
  ["draw",          [/draw[s]? (?:a|X|\d+) card/i, /draw (?:a|X|\d+) card/i]],
  ["loot",          [/draw[s]? .* then discard/i, /discard .* draw/i]],
  ["tutor",         [/search your library/i]],
  ["scry",          [/\bscry\b/i]],
  ["surveil",       [/\bsurveil\b/i]],
  ["impulse",       [/exile the top/i, /look at the top/i]],

  // Removal
  ["removal",       [/destroy target/i, /exile target/i, /return target .* to its owner/i]],
  ["bounce",        [/return target .* to (?:its|their) owner/i, /return .* to hand/i]],
  ["board-wipe",    [/destroy all/i, /exile all/i, /deals .* damage to each/i, /each creature gets/i]],
  ["counter",       [/counter target/i]],

  // Combat
  ["burn",          [/deals? .* damage to any target/i, /deals? .* damage to target player/i, /deals? .* damage to each/i]],
  ["lifegain",      [/you gain .* life/i, /gain .* life/i]],

  // Resource
  ["ramp",          [/add \{/i, /search your library for .* land/i, /put .* land .* onto the battlefield/i]],
  ["land-ramp",     [/search your library for .* land/i, /put .* land .* onto the battlefield/i]],
  ["ritual",        [/add \{[WUBRG]\}\{[WUBRG]\}\{[WUBRG]\}/i]],

  // Graveyard
  ["graveyard",     [/graveyard/i]],
  ["reanimator",    [/return .* from .* graveyard .* battlefield/i]],
  ["flashback",     [/\bflashback\b/i]],
  ["delve",         [/\bdelve\b/i]],

  // Tokens / go-wide
  ["token",         [/create[s]? .* token/i]],
  ["populate",      [/\bpopulate\b/i]],

  // Interaction
  ["copy",          [/\bcopy\b.*spell/i, /copy target/i]],
  ["stax",          [/each (?:player|opponent) (?:can|can't|must)/i, /costs? \{1\} more/i, /can't cast/i]],
  ["tax",           [/costs? \{1\} more to cast/i, /costs? more to cast/i]],
  ["protection",    [/can't be targeted/i, /hexproof/i, /shroud/i, /protection from/i]],
  ["etb",           [/when .* enters the battlefield/i, /whenever .* enters the battlefield/i]],
  ["dies",          [/when .* dies/i, /whenever .* dies/i]],
  ["sacrifice",     [/sacrifice/i]],
  ["proliferate",   [/\bproliferate\b/i]],
  ["blink",         [/exile .* then return/i, /exile target .* you control .* return/i]],
  ["wheel",         [/each player discards .* hand/i, /discard your hand/i]],
  ["extra-turn",    [/take an extra turn/i, /takes an extra turn/i]],
  ["combo-piece",   [/if you control/i, /whenever you cast/i]],

  // Format staples heuristics
  ["cantrip",       [/draw a card\./i]],   // just draws 1
];

// ── Keyword abilities → tags ─────────────────────────────────────────────────
// Scryfall's card.keywords array already lists these
const KEYWORD_PASSTHROUGH = new Set([
  "Flying","Trample","Haste","Deathtouch","Lifelink","Vigilance",
  "First Strike","Double Strike","Flash","Hexproof","Indestructible",
  "Menace","Reach","Ward","Defender","Protection","Shroud",
  "Prowess","Convoke","Delve","Improvise","Cascade","Storm",
  "Suspend","Cycling","Kicker","Morph","Megamorph","Bestow",
  "Evolve","Exploit","Persist","Undying","Modular","Affinity",
  "Phyrexian","Annihilator","Infect","Wither","Bloodthirst",
  "Scry","Surveil","Entwine","Overload","Replicate","Cipher",
  "Splice","Transmute","Dredge","Retrace","Jump-start","Flashback",
  "Escape","Foretell","Learn","Venture","Connive","Investigate",
  "Clue","Treasure","Food","Blood","Map","Role","Incubator",
]);

// ── Type line → tags ─────────────────────────────────────────────────────────
const TYPE_TAGS = {
  "Creature":     "creature",
  "Instant":      "instant",
  "Sorcery":      "sorcery",
  "Artifact":     "artifact",
  "Enchantment":  "enchantment",
  "Planeswalker": "planeswalker",
  "Land":         "land",
  "Battle":       "battle",
};

// ── Color → tag ──────────────────────────────────────────────────────────────
const COLOR_TAGS = { W:"white", U:"blue", B:"black", R:"red", G:"green" };

// ── CMC brackets ─────────────────────────────────────────────────────────────
function cmcTag(cmc) {
  const n = Math.floor(cmc || 0);
  if (n === 0) return "cmc-0";
  if (n === 1) return "cmc-1";
  if (n === 2) return "cmc-2";
  if (n === 3) return "cmc-3";
  if (n >= 4 && n <= 6) return "cmc-4-6";
  return "cmc-7+";
}

// ── Main export: compute auto-tags from a Scryfall card object ───────────────
export function computeAutoTags(card) {
  if (!card) return [];
  const tags = new Set();

  // Rarity
  if (card.rarity) tags.add(card.rarity.toLowerCase()); // common/uncommon/rare/mythic/special

  // Type line
  const typeLine = card.type_line || "";
  for (const [type, tag] of Object.entries(TYPE_TAGS)) {
    if (typeLine.includes(type)) tags.add(tag);
  }

  // Sub-types — commander staple creature types
  const NOTABLE_SUBTYPES = ["Dragon","Wizard","Elf","Goblin","Vampire","Zombie","Angel","Human","Merfolk","Soldier","Beast","Elemental","Cleric","Rogue","Warrior","Shaman"];
  NOTABLE_SUBTYPES.forEach(st => { if (typeLine.includes(st)) tags.add(st.toLowerCase()); });

  // Colors
  const colors = card.colors || card.color_identity || [];
  if (colors.length === 0) tags.add("colorless");
  if (colors.length >= 2) tags.add("multicolor");
  colors.forEach(c => { if (COLOR_TAGS[c]) tags.add(COLOR_TAGS[c]); });

  // CMC
  tags.add(cmcTag(card.cmc));

  // Scryfall keywords
  (card.keywords || []).forEach(kw => {
    if (KEYWORD_PASSTHROUGH.has(kw)) tags.add(kw.toLowerCase().replace(/\s+/g, "-"));
  });

  // Oracle text patterns
  const oracle = (card.oracle_text || "").toLowerCase();
  for (const [tag, patterns] of ORACLE_PATTERNS) {
    for (const pat of patterns) {
      if (pat instanceof RegExp ? pat.test(oracle) : oracle.includes(pat)) {
        tags.add(tag);
        break;
      }
    }
  }

  // Legality tags — format staples
  const legalities = card.legalities || {};
  if (legalities.standard === "legal")  tags.add("standard-legal");
  if (legalities.pioneer === "legal")   tags.add("pioneer-legal");
  if (legalities.modern === "legal")    tags.add("modern-legal");
  if (legalities.legacy === "legal")    tags.add("legacy-legal");
  if (legalities.commander === "legal") tags.add("edh-legal");
  if (legalities.pauper === "legal")    tags.add("pauper-legal");

  // Legendary — commander-eligible
  if (typeLine.includes("Legendary") && typeLine.includes("Creature")) {
    tags.add("commander-eligible");
  }
  if (typeLine.includes("Legendary")) tags.add("legendary");

  return [...tags].sort();
}

// ── Tag metadata: display label, color, category ────────────────────────────
// For unknown tags we just show them as-is in a neutral grey.
const TAG_META = {
  // Types
  creature:      { label:"Creature",     color:"#6b7280", cat:"type" },
  instant:       { label:"Instant",      color:"#3b82f6", cat:"type" },
  sorcery:       { label:"Sorcery",      color:"#8b5cf6", cat:"type" },
  artifact:      { label:"Artifact",     color:"#94a3b8", cat:"type" },
  enchantment:   { label:"Enchantment",  color:"#a855f7", cat:"type" },
  planeswalker:  { label:"Planeswalker", color:"#ec4899", cat:"type" },
  land:          { label:"Land",         color:"#84cc16", cat:"type" },
  battle:        { label:"Battle",       color:"#f59e0b", cat:"type" },

  // Colors
  white:         { label:"White",        color:"#f9fafb", cat:"color" },
  blue:          { label:"Blue",         color:"#3b82f6", cat:"color" },
  black:         { label:"Black",        color:"#a855f7", cat:"color" },
  red:           { label:"Red",          color:"#ef4444", cat:"color" },
  green:         { label:"Green",        color:"#22c55e", cat:"color" },
  colorless:     { label:"Colorless",    color:"#6b7280", cat:"color" },
  multicolor:    { label:"Multicolor",   color:"#f59e0b", cat:"color" },

  // Rarity
  common:        { label:"Common",       color:"#6b7280", cat:"rarity" },
  uncommon:      { label:"Uncommon",     color:"#94a3b8", cat:"rarity" },
  rare:          { label:"Rare",         color:"#f59e0b", cat:"rarity" },
  mythic:        { label:"Mythic",       color:"#f97316", cat:"rarity" },
  special:       { label:"Special",      color:"#ec4899", cat:"rarity" },

  // Gameplay roles
  draw:          { label:"Draw",         color:"#06b6d4", cat:"role" },
  loot:          { label:"Loot",         color:"#06b6d4", cat:"role" },
  tutor:         { label:"Tutor",        color:"#8b5cf6", cat:"role" },
  removal:       { label:"Removal",      color:"#ef4444", cat:"role" },
  "board-wipe":  { label:"Board Wipe",   color:"#ef4444", cat:"role" },
  bounce:        { label:"Bounce",       color:"#3b82f6", cat:"role" },
  counter:       { label:"Counter",      color:"#3b82f6", cat:"role" },
  burn:          { label:"Burn",         color:"#f97316", cat:"role" },
  lifegain:      { label:"Lifegain",     color:"#22c55e", cat:"role" },
  ramp:          { label:"Ramp",         color:"#22c55e", cat:"role" },
  "land-ramp":   { label:"Land Ramp",    color:"#22c55e", cat:"role" },
  ritual:        { label:"Ritual",       color:"#a855f7", cat:"role" },
  token:         { label:"Token",        color:"#f59e0b", cat:"role" },
  graveyard:     { label:"Graveyard",    color:"#6b7280", cat:"role" },
  reanimator:    { label:"Reanimator",   color:"#6b7280", cat:"role" },
  copy:          { label:"Copy",         color:"#06b6d4", cat:"role" },
  stax:          { label:"Stax",         color:"#94a3b8", cat:"role" },
  tax:           { label:"Tax",          color:"#94a3b8", cat:"role" },
  protection:    { label:"Protection",   color:"#f9fafb", cat:"role" },
  etb:           { label:"ETB",          color:"#a78bfa", cat:"role" },
  dies:          { label:"Dies Trigger", color:"#6b7280", cat:"role" },
  sacrifice:     { label:"Sacrifice",    color:"#6b7280", cat:"role" },
  proliferate:   { label:"Proliferate",  color:"#ec4899", cat:"role" },
  blink:         { label:"Blink",        color:"#06b6d4", cat:"role" },
  wheel:         { label:"Wheel",        color:"#3b82f6", cat:"role" },
  "extra-turn":  { label:"Extra Turn",   color:"#f97316", cat:"role" },
  "combo-piece": { label:"Combo Piece",  color:"#ec4899", cat:"role" },
  cantrip:       { label:"Cantrip",      color:"#06b6d4", cat:"role" },
  scry:          { label:"Scry",         color:"#06b6d4", cat:"role" },
  surveil:       { label:"Surveil",      color:"#06b6d4", cat:"role" },
  impulse:       { label:"Impulse",      color:"#06b6d4", cat:"role" },
  populate:      { label:"Populate",     color:"#22c55e", cat:"role" },
  flashback:     { label:"Flashback",    color:"#6b7280", cat:"role" },

  // Keywords (Scryfall)
  flying:        { label:"Flying",       color:"#06b6d4", cat:"keyword" },
  trample:       { label:"Trample",      color:"#22c55e", cat:"keyword" },
  haste:         { label:"Haste",        color:"#ef4444", cat:"keyword" },
  deathtouch:    { label:"Deathtouch",   color:"#6b7280", cat:"keyword" },
  lifelink:      { label:"Lifelink",     color:"#22c55e", cat:"keyword" },
  vigilance:     { label:"Vigilance",    color:"#f9fafb", cat:"keyword" },
  "first-strike":{ label:"First Strike", color:"#f59e0b", cat:"keyword" },
  "double-strike":{ label:"Dbl Strike",  color:"#f59e0b", cat:"keyword" },
  flash:         { label:"Flash",        color:"#06b6d4", cat:"keyword" },
  hexproof:      { label:"Hexproof",     color:"#22c55e", cat:"keyword" },
  indestructible:{ label:"Indestructible",color:"#f59e0b",cat:"keyword" },
  menace:        { label:"Menace",       color:"#ef4444", cat:"keyword" },
  reach:         { label:"Reach",        color:"#22c55e", cat:"keyword" },
  ward:          { label:"Ward",         color:"#3b82f6", cat:"keyword" },
  infect:        { label:"Infect",       color:"#22c55e", cat:"keyword" },
  cascade:       { label:"Cascade",      color:"#f97316", cat:"keyword" },
  storm:         { label:"Storm",        color:"#8b5cf6", cat:"keyword" },
  cycling:       { label:"Cycling",      color:"#6b7280", cat:"keyword" },
  delve:         { label:"Delve",        color:"#6b7280", cat:"keyword" },

  // Legendary / format
  legendary:               { label:"Legendary",       color:"#f59e0b", cat:"meta" },
  "commander-eligible":    { label:"Commander Legal",  color:"#a855f7", cat:"meta" },
  "standard-legal":        { label:"Standard",         color:"#3b82f6", cat:"format" },
  "pioneer-legal":         { label:"Pioneer",          color:"#06b6d4", cat:"format" },
  "modern-legal":          { label:"Modern",           color:"#f59e0b", cat:"format" },
  "legacy-legal":          { label:"Legacy",           color:"#ef4444", cat:"format" },
  "edh-legal":             { label:"EDH",              color:"#a855f7", cat:"format" },
  "pauper-legal":          { label:"Pauper",           color:"#6b7280", cat:"format" },

  // CMC
  "cmc-0":  { label:"0 Mana",  color:"#94a3b8", cat:"cmc" },
  "cmc-1":  { label:"1 Mana",  color:"#94a3b8", cat:"cmc" },
  "cmc-2":  { label:"2 Mana",  color:"#94a3b8", cat:"cmc" },
  "cmc-3":  { label:"3 Mana",  color:"#94a3b8", cat:"cmc" },
  "cmc-4-6":{ label:"4–6 Mana",color:"#94a3b8", cat:"cmc" },
  "cmc-7+": { label:"7+ Mana", color:"#6b7280", cat:"cmc" },

  // Creature sub-types
  dragon:     { label:"Dragon",    color:"#ef4444", cat:"subtype" },
  wizard:     { label:"Wizard",    color:"#3b82f6", cat:"subtype" },
  elf:        { label:"Elf",       color:"#22c55e", cat:"subtype" },
  goblin:     { label:"Goblin",    color:"#f97316", cat:"subtype" },
  vampire:    { label:"Vampire",   color:"#a855f7", cat:"subtype" },
  zombie:     { label:"Zombie",    color:"#6b7280", cat:"subtype" },
  angel:      { label:"Angel",     color:"#f9fafb", cat:"subtype" },
  human:      { label:"Human",     color:"#f59e0b", cat:"subtype" },
  merfolk:    { label:"Merfolk",   color:"#3b82f6", cat:"subtype" },
  soldier:    { label:"Soldier",   color:"#f9fafb", cat:"subtype" },
  beast:      { label:"Beast",     color:"#22c55e", cat:"subtype" },
  elemental:  { label:"Elemental", color:"#f59e0b", cat:"subtype" },
  cleric:     { label:"Cleric",    color:"#f9fafb", cat:"subtype" },
  rogue:      { label:"Rogue",     color:"#6b7280", cat:"subtype" },
  warrior:    { label:"Warrior",   color:"#ef4444", cat:"subtype" },
  shaman:     { label:"Shaman",    color:"#22c55e", cat:"subtype" },
};

export function getTagMeta(tag) {
  return TAG_META[tag] || { label: tag, color:"#6b7280", cat:"custom" };
}

// Which categories to hide by default in the card detail view (too verbose)
export const HIDDEN_BY_DEFAULT_CATS = new Set(["format","cmc","subtype"]);

// ── Tag chip component ────────────────────────────────────────────────────────
// Used in CardDetailView + CollectionView filter bar
export function TagChip({ tag, onRemove, size = "md", onClick, isActive }) {
  const meta = getTagMeta(tag);
  const pad  = size === "sm" ? "2px 7px" : "3px 10px";
  const fs   = size === "sm" ? 10 : 11;
  return (
    <span
      onClick={onClick}
      style={{
        display:"inline-flex", alignItems:"center", gap:4,
        background: isActive ? meta.color+"33" : "#1a1a1a",
        border:`1px solid ${isActive ? meta.color : meta.color+"44"}`,
        color: meta.color,
        borderRadius:10, padding:pad, fontSize:fs, fontWeight:600,
        cursor: onClick || onRemove ? "pointer" : "default",
        flexShrink:0, lineHeight:1.3,
        transition:"background 0.15s, border-color 0.15s",
      }}
    >
      {meta.label}
      {onRemove && (
        <button onClick={e=>{ e.stopPropagation(); onRemove(tag); }}
          style={{ background:"none", border:"none", cursor:"pointer", padding:0,
            color:meta.color, fontSize:10, lineHeight:1, opacity:0.7, display:"flex" }}>✕</button>
      )}
    </span>
  );
}

// ── Tag categories for the filter UI ─────────────────────────────────────────
export const TAG_FILTER_GROUPS = [
  {
    label: "Role",
    tags: ["draw","tutor","removal","board-wipe","counter","burn","ramp","lifegain",
           "token","graveyard","reanimator","stax","etb","dies","sacrifice","blink",
           "wheel","extra-turn","combo-piece","copy","cantrip","loot","bounce","protection"],
  },
  {
    label: "Type",
    tags: ["creature","instant","sorcery","artifact","enchantment","planeswalker","land","legendary"],
  },
  {
    label: "Color",
    tags: ["white","blue","black","red","green","colorless","multicolor"],
  },
  {
    label: "Rarity",
    tags: ["common","uncommon","rare","mythic"],
  },
  {
    label: "Keyword",
    tags: ["flying","trample","haste","deathtouch","lifelink","vigilance","first-strike",
           "double-strike","flash","hexproof","indestructible","menace","ward","infect",
           "cascade","storm","cycling","flashback","delve"],
  },
  {
    label: "CMC",
    tags: ["cmc-0","cmc-1","cmc-2","cmc-3","cmc-4-6","cmc-7+"],
  },
  {
    label: "Format",
    tags: ["standard-legal","pioneer-legal","modern-legal","legacy-legal","edh-legal","pauper-legal"],
  },
];
