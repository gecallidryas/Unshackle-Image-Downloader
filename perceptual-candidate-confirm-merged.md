# Chrome Extension — Perceptual Hash (pHash/dHash/aHash) Candidate Grouping + Confirm Pipeline (Merged Method 4 + 5)

**Goal:** Deduplicate *visually duplicate* images while **avoiding false positives** by using:
1) **Perceptual hashing with conservative thresholds** to quickly *find candidate duplicates*  
2) A **strong confirmation step** (pixel-level / SSIM + small transforms) before merging into a duplicate group

> Key rule: **Never treat perceptual hash alone as “delete-safe.”**  
> Use it only for **candidate discovery**, then confirm.

---

## 0) Definitions

### What counts as a “duplicate” in this pipeline?
Two images are considered duplicates if they are *visually the same* under common non-destructive changes such as:
- different compression level (JPG quality)
- format changes (PNG/JPG/WebP) that preserve the same look
- small color/contrast shifts (optional, depends on confirm thresholds)
- minor noise

This pipeline is NOT intended to dedupe:
- distinct images that just look similar (e.g., two photos of the same subject)
- different crops / partial overlaps (use feature-matching / document fingerprinting for that)
- strong edits (filters, overlays, added text)

---

## 1) High-level architecture (MV3)

### Components
- **Content Script**
  - Collects candidate image URLs on page (img/src/srcset/CSS backgrounds).
  - Sends URL batches to the Service Worker.
- **Service Worker**
  - Fetches bytes, decodes images, computes perceptual hashes.
  - Maintains candidate buckets (LSH-ish) and schedules confirmations.
  - Writes results to IndexedDB.
- **IndexedDB**
  - Stores:
    - per-image records (url, bytes hash optional, pHash, etc.)
    - duplicate groups (union-find or groupId mapping)
    - pairwise confirm outcomes (optional caching)
- **UI**
  - Shows “duplicate groups” and confidence.
  - Recommended: **group, don’t delete** (or keep an undo cache).

---

## 2) The merged pipeline: Candidate → Confirm

### Stage A — Candidate grouping (Perceptual hash, conservative)
1. Fetch & decode image (or decode from cached bytes)
2. Normalize for hashing:
   - apply EXIF orientation (or decode with `imageOrientation: "from-image"`)
   - convert to grayscale
   - resize to a small canonical size
3. Compute perceptual hash (choose one or compute multiple):
   - **dHash** (fast, good baseline)
   - **pHash** (more robust, a bit heavier)
   - **aHash** (fastest, least robust)

4. Find candidates by comparing Hamming distance **with conservative thresholds**:
   - If Hamming distance <= threshold → candidate pair
   - Else → not a candidate

> Conservative means: “Prefer false negatives over false positives.”
> You can always catch more duplicates later with additional layers.

> If you want better recall for rotated images, compute hashes for a small set of rotations (0/90/180/270) and treat any match as a candidate, still requiring confirmation.

#### Recommended threshold starting points (tune per dataset)
- **dHash (64-bit)**: distance <= **4** (very conservative)  
- **pHash (64-bit)**: distance <= **6** (conservative)  
- **aHash (64-bit)**: distance <= **3** (very conservative)

---

### Stage B — Strong confirmation (pixel-level)
For each candidate pair, run a confirmation check that is expensive but reliable.

**Recommended confirm sequence (stop early if confirmed):**
1) Create canonical thumbnails for both images (same size, e.g., 256×256 max side)
2) Try small transforms (to handle orientation issues):
   - rotations: 0°, 90°, 180°, 270°
   - optional: horizontal mirror
3) For each transform, compute a similarity score:
   - **SSIM** on grayscale thumbnails (preferred)
   - OR “normalized mean absolute error” (NMAE) on pixels
4) Accept as duplicates only if similarity passes a strict threshold.

#### Confirm thresholds (starting points)
- **SSIM >= 0.995** for “almost identical” images (very safe)
- **SSIM >= 0.990** if you want to catch more but accept a slightly higher risk
- If using NMAE: require extremely low pixel error (e.g., < 0.3% average difference)

> Tip: Use **two signals** for confirmation if you want extra safety:
> - SSIM threshold AND
> - max per-pixel difference percentile threshold (e.g., 99th percentile delta < small number)

---

## 3) End-to-end workflow

### A) Scan start
UI triggers scan; content script discovers URLs; sends:
- `{ type:"CANDIDATES", scanId, tabId, pageUrl, candidates:[{url, context}] }`

### B) SW handles each URL
For each URL:
1. Fetch bytes (or read from cache)
2. Decode to pixels (ImageBitmap + OffscreenCanvas)
3. Compute pHash/dHash/aHash
4. Store image record in IndexedDB
5. Add to a “bucket” for fast candidate search

### C) Candidate search strategy (fast lookup)
Instead of comparing every new image to all previous images (O(n²)), use a simple bucket approach:

**Option 1 (simple, effective): prefix buckets**
- Use the first `k` bits of the hash as a bucket key
- Example: `bucket = phash >> (64 - 16)` → 16-bit prefix gives 65k buckets
- Compare only within the same bucket (and optionally adjacent buckets if you want)

**Option 2 (better): multi-bucket LSH**
- Split hash into chunks (e.g., 4 chunks of 16 bits)
- Add image id into 4 buckets
- For a new image, retrieve candidates from those buckets

> Then run exact Hamming distance filtering on retrieved candidates.

### D) Confirmation scheduling
For each candidate pair:
- Put a confirm job in a queue (limit concurrency, e.g., 2–4)
- If confirmed:
  - merge into the same `groupId` (union-find)
  - store confirm metadata: `{method:"ssim", score, transformUsed}`
- If rejected:
  - store a “do not match” cache to avoid repeating work

---

## 4) Data model (IndexedDB)

### `images` store
Key: `imageId` (or derived from url+scanId)
```js
{
  imageId,
  url,
  pageUrl,
  tabId,
  foundAt,
  width,
  height,
  dhash64,
  phash64,
  ahash64,
  groupId: null | "gid_..."
}
```

### `hash_buckets` store (optional)
Key: `bucketKey`
```js
{
  bucketKey, // e.g., "phash:ABCD" or "dhash:0011"
  imageIds: ["img1", "img2", ...]
}
```
> You can also keep buckets in-memory per scan and only persist final group results.

### `groups` store
Key: `groupId`
```js
{
  groupId,
  representativeImageId,
  memberImageIds,
  createdAt,
  updatedAt
}
```

### `pair_confirms` store (optional cache)
Key: `${imageIdA}|${imageIdB}` (sorted)
```js
{
  a,
  b,
  status: "CONFIRMED" | "REJECTED",
  score,
  transform: { rot: 0|90|180|270, mirror: true|false },
  confirmedAt
}
```

---

## 5) Implementation spec (Service Worker)

### 5.1 Perceptual hash functions (conceptual)
You can implement any of these; dHash is the simplest and often good enough as a first layer.

**dHash (64-bit) outline**
1. grayscale
2. resize to 9×8
3. compare adjacent pixels horizontally → 8×8 bits

**aHash (64-bit) outline**
1. grayscale
2. resize to 8×8
3. compute average pixel
4. bit = pixel > avg

**pHash (64-bit) outline**
1. grayscale
2. resize to e.g., 32×32
3. DCT
4. take top-left 8×8 (excluding DC)
5. compare to median → bits

> If you want speed in JS: start with **dHash** for candidates and reserve **pHash** as an additional check for tougher cases.

### 5.2 Hamming distance
```js
function popcnt32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

// For 64-bit stored as two 32-bit ints: hi, lo
function hamming64(aHi, aLo, bHi, bLo) {
  return popcnt32(aHi ^ bHi) + popcnt32(aLo ^ bLo);
}
```

### 5.3 Confirmation (thumbnail + SSIM)
**Confirm contract:**
- Create canonical thumbnails (same size, e.g., max side 256)
- Convert to grayscale
- Try transforms (rotations/mirror) on one thumbnail
- Compute SSIM (or alternative)
- Accept only when score >= threshold

> SSIM implementation: either implement in JS (ok for 256×256) or use a small library.
> If you don’t want SSIM, use a strict pixel-difference metric, but SSIM is more robust to minor compression noise.

**Transform loop:**
- rot: [0, 90, 180, 270]
- mirror: [false, true] (optional)

Stop as soon as a transform passes threshold.

---

## 6) Decision policy (safe defaults)

### Candidate stage (very conservative)
- Only generate candidates when:
  - `Hamming(dHash) <= 4` **OR**
  - `Hamming(pHash) <= 6`

### Confirm stage (strict)
- Confirm duplicates only if:
  - `SSIM >= 0.995` (recommended safe default)
  - (Optional) plus a strict pixel error cap

### Grouping policy (recommended UX)
- Do not “delete”; instead:
  - assign `groupId`
  - pick a representative
  - show collapsed groups in UI

---

## 7) Operational notes

### Concurrency
- Hashing stage: 4–8 concurrent fetch/decode jobs (depending on device)
- Confirm stage: 2–4 concurrent jobs (SSIM is heavier)

### Caching
- Cache decoded thumbnails temporarily in-memory for a scan to avoid repeated decodes during confirms.
- Cache confirm decisions (`pair_confirms`) to avoid re-confirming the same pair.

### Failure modes
- Decode failure: record error and skip
- Very large images: downscale early for hashing/confirm thumbnails
- Animated images (GIF/WebP): choose a policy:
  - hash first frame only
  - or treat animated as unique unless you implement multi-frame hashing

---

## 8) Definition of done checklist

- [ ] Compute at least one perceptual hash (dHash recommended) for each decoded image.
- [ ] Candidate selection uses conservative Hamming thresholds.
- [ ] Confirmation step exists and is required before grouping as duplicates.
- [ ] Confirmation tries small transforms (rotations, optional mirror).
- [ ] Confirm uses strict SSIM (or equivalent) thresholds.
- [ ] Results are stored as duplicate groups; originals are not silently removed.

---
