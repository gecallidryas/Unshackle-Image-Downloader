# Chrome Extension (MV3) — “Perfect” Exact-Byte Image Deduplication

**Goal:** Deduplicate images **without ever removing unique images** by treating two images as duplicates **only when their fetched bytes are identical** (cryptographic hash match).  
This is the only strictly “perfect” dedupe definition (zero false positives under normal cryptographic assumptions).

---

## 0) High-level principles

- **Exact-byte dedupe = zero false positives:** only mark duplicates when the raw bytes match.
- MV3 service workers are **event-driven / non-persistent**, so store durable state in persistent storage (IndexedDB).
- For cross-origin image URLs, **do networking (fetch bytes) in the extension context** (service worker), not in the page context.
- Keep the definition strict: **hash equality is the only dedupe decision**.

---

## 1) Architecture overview

### Components

1) **Content Script (per tab)**
- Discovers candidate image resources on the page (URLs from DOM/CSS).
- Sends candidates to the service worker for fetching + hashing.
- Receives dedupe decisions and (optionally) renders UI overlays.

2) **Service Worker (Background)**
- Owns networking (`fetch` bytes), hashing, and dedupe index.
- Coordinates concurrency, caching, retries.
- Persists results in IndexedDB.

3) **Storage Layer (IndexedDB)**
- Stores canonical hash records and per-page occurrences.

4) **UI (Popup / Side Panel / Options Page)**
- Starts scans, shows dedupe groups, allows export.
- Queries results from the service worker.

---

## 2) Manifest requirements (MV3)

### Suggested permissions
- `permissions`: `storage` (and optionally `tabs`, `scripting`, `activeTab` depending on UX)
- `host_permissions`: scopes where you will scan/fetch images  
  - Prefer a tight allowlist instead of `"<all_urls>"` for production.

### Example `manifest.json` (skeleton)

```json
{
  "manifest_version": 3,
  "name": "Image Scanner + Perfect Byte Dedupe",
  "version": "1.0.0",
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": { "default_popup": "popup.html" }
}
```

---

## 3) End-to-end workflow

### A) Scan initiation (UI → Content Script)

**Popup/UI** triggers:

- `chrome.tabs.sendMessage(tabId, { type: "SCAN_START", scanId, options })`

Example `options`:
- `maxCandidates`
- `includeImgSrcset`
- `includeCssBackgrounds`
- `concurrencyFetch` (e.g., 6)
- `timeoutMs`
- `cacheMode` (`"force-cache"` or `"no-store"`)

### B) Candidate discovery (Content Script)

Steps:

1. Collect image candidates from:
   - `img[src]`
   - `img[srcset]` (choose one URL per your heuristic, or emit all)
   - CSS `background-image: url(...)` (computed styles)
2. Normalize URL strings:
   - Resolve relative URLs with `new URL(raw, location.href)`
   - Skip invalid schemes (`javascript:`)
   - Optionally keep `data:` and `blob:` (special handling below)
3. Deduplicate *candidate list* by URL string (cheap pre-pass, not final dedupe)
4. Send candidates in batches to SW:

```json
{
  "type": "CANDIDATES",
  "scanId": "uuid",
  "tabId": 123,
  "pageUrl": "https://example.com",
  "candidates": [
    { "url": "https://.../a.jpg", "context": { "domType": "img", "selectorHint": "img.hero" } }
  ]
}
```

### C) Exact-byte dedupe pipeline (Service Worker)

For each candidate URL:

1. Fetch bytes in SW (`fetch`)  
2. Convert to `ArrayBuffer`  
3. Compute `SHA-256` hash of bytes  
4. Look up hash in IndexedDB:
   - If exists → mark as DUP and store occurrence
   - If not → create canonical record + store occurrence
5. Send streaming results back to content/UI:

```json
{
  "type": "HASH_RESULT",
  "scanId": "uuid",
  "url": "https://.../a.jpg",
  "sha256": "hex...",
  "status": "NEW",
  "canonicalId": "hex..."
}
```

---

## 4) Service Worker hashing spec

### Fetch rules (recommended)

- `fetch(url, { cache: cacheMode, credentials: "include", referrer: pageUrl })`
- Validate response:
  - `res.ok`
  - optionally check `Content-Type` begins with `image/`
- Convert to bytes:
  - `const buf = await res.arrayBuffer();`

> Some sites require cookies and a page referrer (hotlink protection). If you still get 403s, fall back to fetching in the page context and send bytes to the SW for hashing.

### Hashing (SHA-256 via WebCrypto)

```js
async function sha256Hex(arrayBuffer) {
  const hashBuf = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const bytes = new Uint8Array(hashBuf);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
```

### Concurrency control

Implement an async queue to cap parallel work:
- Default `concurrencyFetch = 6` (tune based on device)
- Backoff/retry on transient errors (429/5xx)
- Hard timeout per fetch (AbortController)

### Safety rule (the “perfect” part)

**Only treat as duplicate if the SHA-256 hex string matches an existing record.**  
No perceptual similarity, no thumbnails, no OCR-based guesses.

---

## 5) IndexedDB schema (storage contract)

**Database:** `img_dedupe_db` (versioned)

### Object stores

1) `canonicals`
- **Key:** `canonicalId` (use `sha256` as the ID for simplicity)
- **Value:**
```js
{
  canonicalId: sha256,
  sha256,
  byteLength,
  contentType,
  firstSeenAt,
  representative: { url, tabId, pageUrl }
}
```

2) `occurrences`
- **Key:** auto-increment OR `${sha256}|${occurrenceId}`
- **Indexes:**
  - `bySha256` (sha256)
  - `byScanId` (scanId)
  - `byPageUrl` (pageUrl)
- **Value:**
```js
{
  scanId,
  sha256,
  url,
  pageUrl,
  tabId,
  foundAt,
  context: { domType: "img"|"css"|"srcset", selectorHint }
}
```

3) `scan_runs`
- **Key:** `scanId`
- **Value:**
```js
{
  scanId,
  startedAt,
  finishedAt,
  tabId,
  pageUrl,
  options,
  stats
}
```

> Note: You typically **do not** need to store raw image bytes to dedupe—hashes + metadata are enough.

---

## 6) Messaging / RPC contract

### Messages (Content → SW)

- `CANDIDATES`
```json
{
  "type": "CANDIDATES",
  "scanId": "uuid",
  "tabId": 123,
  "pageUrl": "https://example.com",
  "candidates": [
    { "url": "https://.../a.jpg", "context": { "domType": "img", "selectorHint": "img.hero" } }
  ]
}
```

- `SCAN_FINISH`
```json
{ "type": "SCAN_FINISH", "scanId": "uuid", "tabId": 123 }
```

- `QUERY_RESULTS`
```json
{ "type": "QUERY_RESULTS", "scanId": "uuid" }
```

### Messages (SW → Content/UI)

- `HASH_RESULT`
```json
{
  "type": "HASH_RESULT",
  "scanId": "uuid",
  "url": "https://.../a.jpg",
  "sha256": "hex...",
  "status": "NEW",
  "canonicalId": "hex..."
}
```

- `HASH_ERROR`
```json
{
  "type": "HASH_ERROR",
  "scanId": "uuid",
  "url": "https://.../a.jpg",
  "errorCode": "HTTP_403|TIMEOUT|NOT_IMAGE|FETCH_FAILED",
  "details": "string"
}
```

- `SCAN_STATS`
```json
{
  "type": "SCAN_STATS",
  "scanId": "uuid",
  "stats": {
    "candidates": 100,
    "fetched": 80,
    "hashed": 80,
    "new": 50,
    "dup": 30,
    "errors": 20
  }
}
```

---

## 7) Hard edges & special cases

### `data:` URLs
- Handle both `data:*;base64,` and URL-encoded `data:,` forms, then hash the decoded bytes.
- Hash the decoded bytes.

### `blob:` URLs
- Often only resolvable within the page context that created them.
- Two safe approaches:
  1) Content script fetches `blob:` → sends raw bytes to SW for hashing
  2) If your UI is an extension page that created the blob, hash there and store result

### Dynamic URLs
- Some URLs change content over time. If you cache `url -> sha256`, use a TTL and allow “rehash” mode.

---

## 8) Optional performance optimizations (still safe)

1) **Size pre-filter**
- If you have `Content-Length`, group candidates by size first.
- Only hash on potential size collisions.
- Final decision still requires hash equality.

2) **URL memoization**
- Cache `url -> sha256` per scan to avoid re-fetching repeated URLs.

3) **Rate limiting**
- Backoff for 429 responses; cap retries.

---

## 9) Definition of done checklist

- [ ] All network fetching is executed from the extension context (SW).
- [ ] Hashing uses WebCrypto `crypto.subtle.digest("SHA-256", bytes)`.
- [ ] Dedupe decision is **ONLY** hash equality.
- [ ] IndexedDB stores canonicals + occurrences so results survive SW restarts.
- [ ] Concurrency-limited pipeline.
- [ ] UI groups duplicates by `canonicalId` and never silently deletes images.
