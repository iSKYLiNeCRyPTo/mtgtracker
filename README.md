# MTGTracker

A Magic: The Gathering card investment PWA — track your collection, scan cards with DINOv2 AI, monitor prices via Scryfall, and analyse your sealed product P&L.

Converted from PokéTracker. Same architecture, fully re-skinned for MTG.

## Features

- **Camera card scanner** — DINOv2 visual embeddings, same model in browser + pipeline
- **Foil / Non-Foil toggle** — choose at scan/add time, no auto-detection
- **Collection tracking** — condition grades (NM / LP / MP / HP / Damaged), price history
- **Sealed product tracker** — Draft Box, Set Box, Collector Box, Bundle, Commander Deck, Prerelease Kit
- **Master Set view** — foil + nonfoil variants per card
- **Price Check scanner** — point camera at a card at an LGS, see market price + suggested offer
- **Sync across devices** — Firebase Firestore + QR code export

## Stack

- React 19 + Vite PWA
- Firebase (Auth, Firestore, Storage)
- Cloudflare Pages deployment
- `@xenova/transformers` — DINOv2-base ONNX in-browser
- Scryfall API (free, no key needed)

## Setup

### 1. Firebase project

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication → Google sign-in**
3. Enable **Firestore** (start in production mode, deploy `firestore.rules`)
4. Enable **Storage** (needed for the global embedding index)

### 2. Environment variables

```bash
cp .env.example .env
# Fill in your Firebase config values
```

### 3. Install & run

```bash
npm install
npm run dev
```

### 4. Build the embedding index

The global DINOv2 index covers all MTG cards from Scryfall. Build it once (takes a few hours on CPU) and upload to Firebase Storage:

```bash
cd pipeline
npm install @xenova/transformers sharp
node build_node.mjs
```

This downloads ~100MB of Scryfall oracle card data, fetches images, and produces `global_embeddings_v1.bin` (~250MB) + `cards_meta.json`. It then uploads both to Firebase Storage and writes metadata to Firestore so the app knows which version to fetch.

**Resume interrupted builds:** `node build_node.mjs --resume`

**Re-upload without re-embedding:** `node build_node.mjs --upload-only`

Before running, update the three Firebase constants at the top of `build_node.mjs`:
```js
const BUCKET  = "your-project.firebasestorage.app";
const PROJECT = "your-project-id";
const API_KEY = "your_firebase_api_key";
```

### 5. Deploy

Deploy to Cloudflare Pages — connect your GitHub repo, set build command `npm run build`, output directory `dist`, and add the `VITE_FIREBASE_*` environment variables.

## Scryfall API

No API key required. Please include a descriptive `User-Agent` header (already done) and respect Scryfall's rate limits (10ms between requests in the pipeline). See [scryfall.com/docs/api](https://scryfall.com/docs/api).
