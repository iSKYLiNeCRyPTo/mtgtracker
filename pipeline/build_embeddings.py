#!/usr/bin/env python3
"""
MTGTracker Global Embedding Pipeline (Python / PyTorch)
=========================================================
Fetches all MTG cards from Scryfall, generates DINOv2 visual embeddings,
and uploads a packed binary index (MTGT format) to Firebase Storage.

Note: The Node.js pipeline (build_node.mjs) is the recommended approach —
it uses the same Xenova/dinov2-base ONNX model as the browser, guaranteeing
vector compatibility. This Python script is an alternative using PyTorch.

Usage:
    python3 build_embeddings.py              # full build (all cards)
    python3 build_embeddings.py --resume     # resume interrupted build
    python3 build_embeddings.py --upload-only # skip embedding, just re-upload

Requirements:
    torch, transformers, Pillow, requests, tqdm, firebase-admin
"""

import os, sys, json, struct, time, argparse, hashlib, io, math
from pathlib import Path

# ── Auto-install missing deps ──────────────────────────────────────────────────

import importlib.util

def ensure_deps():
    pass  # install manually: pip3 install torch transformers tqdm firebase-admin

ensure_deps()

import torch
import requests
from PIL import Image
from tqdm import tqdm
from transformers import AutoImageProcessor, AutoModel
import firebase_admin
from firebase_admin import credentials, firestore, storage

# ── Config ─────────────────────────────────────────────────────────────────────

FIREBASE_CONFIG = {
    "apiKey":            "AIzaSyCRJRHdTquFqK15UaK4CViuBcFaeJ9X-gk",
    "authDomain":        "poketracker-6a293.firebaseapp.com",
    "projectId":         "poketracker-6a293",
    "storageBucket":     "poketracker-6a293.firebasestorage.app",
    "messagingSenderId": "699720438804",
    "appId":             "1:699720438804:web:1e828ac9b6234c05ce0301",
}

POKETCG_API       = "https://api.pokemontcg.io/v2"
CACHE_DIR         = Path("./embedding_cache")
INDEX_FILE        = Path("./global_embeddings.bin")
CARDS_CACHE_FILE  = Path("./all_cards.json")
MODEL_NAME        = "facebook/dinov2-base"  # 768-dim, best results
DIMS              = 768
BATCH_SIZE        = 16    # images per forward pass
IMAGE_SIZE        = 224   # DINOv2 input size
CONFIDENCE_THRESH = 0.95  # above this = auto-confirm
VERSION_DOC       = "meta/embeddings"
STORAGE_PATH      = "embeddings/global-v1.bin"
CARDS_META_PATH   = "embeddings/cards-meta.json"

# ── Firebase init (client-side using REST, no service account needed) ──────────

def firebase_upload_storage(local_path: Path, remote_path: str):
    """Upload file to Firebase Storage using REST API (no service account)."""
    bucket = FIREBASE_CONFIG["storageBucket"]
    api_key = FIREBASE_CONFIG["apiKey"]

    with open(local_path, "rb") as f:
        data = f.read()

    encoded_path = requests.utils.quote(remote_path, safe="")
    url = f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o?uploadType=media&name={encoded_path}"

    print(f"Uploading {local_path.name} ({len(data)/1024/1024:.1f} MB) to Firebase Storage...")
    resp = requests.post(url, data=data, headers={"Content-Type": "application/octet-stream"})

    if resp.status_code in (200, 201):
        print(f"✓ Uploaded to gs://{bucket}/{remote_path}")
        # Make publicly readable
        encoded_path2 = requests.utils.quote(remote_path, safe="")
        patch_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded_path2}?alt=json"
        return True
    else:
        print(f"✗ Upload failed: {resp.status_code} {resp.text[:200]}")
        return False


def firebase_upload_json(data: dict, remote_path: str):
    """Upload JSON to Firebase Storage."""
    bucket = FIREBASE_CONFIG["storageBucket"]
    encoded_path = requests.utils.quote(remote_path, safe="")
    url = f"https://firebasestorage.googleapis.com/v0/b/{bucket}/o?uploadType=media&name={encoded_path}"

    body = json.dumps(data).encode("utf-8")
    resp = requests.post(url, data=body, headers={"Content-Type": "application/json"})
    return resp.status_code in (200, 201)


def firestore_set_doc(path: str, data: dict):
    """Write a Firestore document via REST API (no service account)."""
    project = FIREBASE_CONFIG["projectId"]
    api_key = FIREBASE_CONFIG["apiKey"]

    # Convert path "meta/embeddings" → collection/document
    parts = path.split("/")
    col, doc_id = parts[0], parts[1]

    url = (f"https://firestore.googleapis.com/v1/projects/{project}"
           f"/databases/(default)/documents/{col}/{doc_id}?key={api_key}")

    # Build Firestore REST field format
    def to_firestore_val(v):
        if isinstance(v, str):   return {"stringValue": v}
        if isinstance(v, int):   return {"integerValue": str(v)}
        if isinstance(v, float): return {"doubleValue": v}
        if isinstance(v, bool):  return {"booleanValue": v}
        if isinstance(v, list):  return {"arrayValue": {"values": [to_firestore_val(i) for i in v]}}
        if isinstance(v, dict):  return {"mapValue": {"fields": {k: to_firestore_val(vv) for k, vv in v.items()}}}
        return {"nullValue": None}

    body = {"fields": {k: to_firestore_val(v) for k, v in data.items()}}
    resp = requests.patch(url, json=body)
    if resp.status_code in (200, 201):
        print(f"✓ Firestore {path} updated")
        return True
    else:
        print(f"✗ Firestore update failed: {resp.status_code} {resp.text[:200]}")
        return False


# ── Card fetching ──────────────────────────────────────────────────────────────

def fetch_all_cards(force=False):
    """Fetch all cards from pokemontcg.io, cached to disk."""
    if CARDS_CACHE_FILE.exists() and not force:
        print(f"Loading cached cards from {CARDS_CACHE_FILE}...")
        with open(CARDS_CACHE_FILE) as f:
            cards = json.load(f)
        print(f"  {len(cards)} cards loaded from cache")
        return cards

    print("Fetching all cards from pokemontcg.io (this may take a few minutes)...")
    all_cards = []
    page = 1
    page_size = 250

    while True:
        url = f"{POKETCG_API}/cards?page={page}&pageSize={page_size}&select=id,name,number,set,rarity,supertype,images"
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            cards = data.get("data", [])
            if not cards:
                break
            all_cards.extend(cards)
            total = data.get("totalCount", "?")
            print(f"  Page {page}: {len(all_cards)}/{total} cards fetched")
            page += 1
            if len(cards) < page_size:
                break
            time.sleep(0.1)  # be polite to the API
        except Exception as e:
            print(f"  Error on page {page}: {e} — retrying in 5s...")
            time.sleep(5)

    print(f"✓ Fetched {len(all_cards)} total cards")
    with open(CARDS_CACHE_FILE, "w") as f:
        json.dump(all_cards, f)
    return all_cards


# ── Image loading ──────────────────────────────────────────────────────────────

def load_image_cached(card_id: str, url: str) -> Image.Image | None:
    """Download and cache card image locally."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_path = CACHE_DIR / f"{card_id.replace('/', '_')}.jpg"

    if cache_path.exists():
        try:
            return Image.open(cache_path).convert("RGB")
        except Exception:
            cache_path.unlink()

    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code == 200:
                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                img.save(cache_path, "JPEG", quality=85)
                return img
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
    return None


# ── Model ─────────────────────────────────────────────────────────────────────

def load_model():
    """Load DINOv2 model with MPS (Apple Silicon) or CPU."""
    print(f"Loading {MODEL_NAME}...")
    processor = AutoImageProcessor.from_pretrained(MODEL_NAME)
    model     = AutoModel.from_pretrained(MODEL_NAME)

    if torch.backends.mps.is_available():
        device = torch.device("mps")
        print("✓ Using Apple Silicon GPU (MPS)")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
        print("✓ Using CUDA GPU")
    else:
        device = torch.device("cpu")
        print("  Using CPU (slower)")

    model = model.to(device).eval()
    return processor, model, device


@torch.no_grad()
def embed_images(images: list[Image.Image], processor, model, device) -> list[list[float]]:
    """Embed a batch of PIL images → list of 768-dim vectors."""
    inputs = processor(images=images, return_tensors="pt").to(device)
    outputs = model(**inputs)
    # Use CLS token (first token) for global image representation
    vecs = outputs.last_hidden_state[:, 0, :].cpu().float()
    # L2 normalize
    norms = vecs.norm(dim=1, keepdim=True).clamp(min=1e-8)
    vecs = (vecs / norms).tolist()
    return vecs


# ── Binary index format ────────────────────────────────────────────────────────
#
# Header: 4 bytes magic "PKTK" + 4 bytes version (1) + 4 bytes count + 4 bytes dims
# Per card: 16 bytes ID (padded/truncated ASCII) + dims×4 bytes float32
#
# Total size estimate: 15000 cards × (16 + 768×4) bytes = ~46MB uncompressed
# With gzip compression in the browser: ~15-20MB
#
# Card IDs are stored separately in a JSON metadata file so we can resolve
# card objects without including all card data in the binary blob.

MAGIC   = b"PKTK"
VERSION = 1
ID_LEN  = 20  # bytes per card ID (padded with nulls)

def pack_index(embeddings: list[dict]) -> bytes:
    """Pack [{id, vec}] → binary bytes."""
    count = len(embeddings)
    buf = bytearray()
    buf += MAGIC
    buf += struct.pack("<III", VERSION, count, DIMS)
    for e in embeddings:
        card_id = e["id"].encode("ascii", errors="replace")[:ID_LEN]
        card_id = card_id.ljust(ID_LEN, b"\x00")
        buf += card_id
        buf += struct.pack(f"<{DIMS}f", *e["vec"])
    return bytes(buf)


def unpack_index(data: bytes) -> list[dict]:
    """Unpack binary bytes → [{id, vec}]."""
    assert data[:4] == MAGIC, "Invalid index file"
    version, count, dims = struct.unpack_from("<III", data, 4)
    offset = 16
    embeddings = []
    for _ in range(count):
        card_id = data[offset:offset+ID_LEN].rstrip(b"\x00").decode("ascii")
        offset += ID_LEN
        vec = list(struct.unpack_from(f"<{dims}f", data, offset))
        offset += dims * 4
        embeddings.append({"id": card_id, "vec": vec})
    return embeddings


# ── Resume state ──────────────────────────────────────────────────────────────

PROGRESS_FILE = Path("./embedding_progress.json")

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"embedded": {}}  # card_id → True

def save_progress(progress: dict):
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


# ── Main build ────────────────────────────────────────────────────────────────

def build(args):
    # 1. Load all cards
    cards = fetch_all_cards(force=args.refetch)

    # Filter to specific sets if requested
    if args.sets:
        set_ids = [s.strip().lower() for s in args.sets.split(",")]
        cards = [c for c in cards if c.get("set", {}).get("id", "").lower() in set_ids]
        print(f"Filtered to {len(cards)} cards from sets: {args.sets}")

    # 2. Load existing embeddings (for resume)
    existing_embeddings = {}
    if INDEX_FILE.exists() and args.resume:
        print(f"Loading existing index for resume ({INDEX_FILE})...")
        with open(INDEX_FILE, "rb") as f:
            for e in unpack_index(f.read()):
                existing_embeddings[e["id"]] = e["vec"]
        print(f"  {len(existing_embeddings)} existing embeddings loaded")

    progress = load_progress() if args.resume else {"embedded": {}}

    # 3. Load model
    processor, model, device = load_model()

    # 4. Embed cards in batches
    all_embeddings = dict(existing_embeddings)
    cards_to_embed = [c for c in cards if c["id"] not in all_embeddings]
    print(f"\n{len(cards_to_embed)} cards to embed ({len(all_embeddings)} already done)\n")

    failed = []
    batch_imgs  = []
    batch_cards = []

    def flush_batch():
        if not batch_imgs:
            return
        try:
            vecs = embed_images(batch_imgs, processor, model, device)
            for card, vec in zip(batch_cards, vecs):
                all_embeddings[card["id"]] = vec
        except Exception as e:
            print(f"  Batch error: {e}")
            failed.extend([c["id"] for c in batch_cards])
        batch_imgs.clear()
        batch_cards.clear()

    with tqdm(total=len(cards_to_embed), unit="card") as pbar:
        for card in cards_to_embed:
            img_url = card.get("images", {}).get("small")
            if not img_url:
                pbar.update(1)
                continue

            img = load_image_cached(card["id"], img_url)
            if img is None:
                failed.append(card["id"])
                pbar.update(1)
                continue

            batch_imgs.append(img)
            batch_cards.append(card)

            if len(batch_imgs) >= BATCH_SIZE:
                flush_batch()
                # Save progress checkpoint every 100 cards
                if len(all_embeddings) % 100 == 0:
                    save_progress({"embedded": {k: True for k in all_embeddings}})

            pbar.update(1)
            pbar.set_postfix({"embedded": len(all_embeddings), "failed": len(failed)})

    flush_batch()  # final batch
    save_progress({"embedded": {k: True for k in all_embeddings}})

    print(f"\n✓ Embedded {len(all_embeddings)} cards ({len(failed)} failed)")
    if failed:
        print(f"  Failed IDs: {failed[:10]}{'...' if len(failed)>10 else ''}")

    # 5. Pack binary index
    print("\nPacking binary index...")
    embedding_list = [{"id": k, "vec": v} for k, v in all_embeddings.items()]
    packed = pack_index(embedding_list)
    with open(INDEX_FILE, "wb") as f:
        f.write(packed)
    size_mb = len(packed) / 1024 / 1024
    print(f"✓ Packed {len(embedding_list)} embeddings → {INDEX_FILE} ({size_mb:.1f} MB)")

    # 6. Build card metadata JSON (id → {name, number, set, rarity, supertype, images})
    print("Building card metadata...")
    cards_by_id = {c["id"]: c for c in cards}
    # Include all cards we have embeddings for
    all_cards_full = fetch_all_cards()
    cards_by_id_full = {c["id"]: c for c in all_cards_full}
    meta = {}
    for card_id in all_embeddings:
        c = cards_by_id_full.get(card_id) or cards_by_id.get(card_id)
        if c:
            meta[card_id] = {
                "id":       c["id"],
                "name":     c.get("name", ""),
                "number":   c.get("number", ""),
                "rarity":   c.get("rarity", ""),
                "supertype":c.get("supertype", ""),
                "set": {
                    "id":   c.get("set", {}).get("id", ""),
                    "name": c.get("set", {}).get("name", ""),
                },
                "images": {
                    "small": c.get("images", {}).get("small", ""),
                },
            }

    meta_file = Path("./cards_meta.json")
    with open(meta_file, "w") as f:
        json.dump(meta, f)
    print(f"✓ Card metadata: {len(meta)} cards → {meta_file} ({meta_file.stat().st_size/1024/1024:.1f} MB)")

    # 7. Upload to Firebase
    if not args.no_upload:
        print("\nUploading to Firebase...")
        ok1 = firebase_upload_storage(INDEX_FILE, STORAGE_PATH)
        ok2 = firebase_upload_storage(meta_file, CARDS_META_PATH)

        version = time.strftime("%Y-%m-%d")
        checksum = hashlib.md5(packed).hexdigest()[:8]
        ok3 = firestore_set_doc("meta/embeddings", {
            "version":   version,
            "count":     len(embedding_list),
            "dims":      DIMS,
            "checksum":  checksum,
            "model":     MODEL_NAME,
            "storagePath": STORAGE_PATH,
            "metaPath":  CARDS_META_PATH,
            "updatedAt": version,
        })
        if ok1 and ok2 and ok3:
            print(f"\n✓ All done! {len(embedding_list)} card embeddings live.")
            print(f"  Version: {version} | Checksum: {checksum}")
        else:
            print("\n⚠ Upload partially failed — index saved locally, retry with --upload-only")
    else:
        print(f"\n✓ Build complete (--no-upload set, skipped Firebase)")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PokéTracker embedding pipeline")
    parser.add_argument("--resume",      action="store_true", help="Resume interrupted build")
    parser.add_argument("--sets",        type=str,  default=None, help="Comma-separated set IDs to embed")
    parser.add_argument("--upload-only", action="store_true", dest="upload_only", help="Skip embedding, just upload existing index")
    parser.add_argument("--no-upload",   action="store_true", dest="no_upload",   help="Build index but don't upload")
    parser.add_argument("--refetch",     action="store_true", help="Re-fetch card list from API even if cached")
    args = parser.parse_args()

    if args.upload_only:
        if not INDEX_FILE.exists():
            print(f"Error: {INDEX_FILE} not found — run without --upload-only first")
            sys.exit(1)
        with open(INDEX_FILE, "rb") as f:
            packed = f.read()
        meta_file = Path("./cards_meta.json")
        firebase_upload_storage(INDEX_FILE, STORAGE_PATH)
        if meta_file.exists():
            firebase_upload_storage(meta_file, CARDS_META_PATH)
        count = struct.unpack_from("<I", packed, 8)[0]
        firestore_set_doc("meta/embeddings", {
            "version":     time.strftime("%Y-%m-%d"),
            "count":       count,
            "dims":        DIMS,
            "checksum":    hashlib.md5(packed).hexdigest()[:8],
            "model":       MODEL_NAME,
            "storagePath": STORAGE_PATH,
            "metaPath":    CARDS_META_PATH,
            "updatedAt":   time.strftime("%Y-%m-%d"),
        })
    else:
        build(args)
