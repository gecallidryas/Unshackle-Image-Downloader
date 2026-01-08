# Chrome Extension — Canonical “Pixel Hash” Deduplication (Decode → Normalize → Hash)

**Goal:** Deduplicate images that are *visually identical at the same resolution* even when their **file bytes differ** (different encoders, metadata, container format), by hashing a **canonicalized pixel buffer**.

This method is *near-perfect* for “same pixels” duplicates:
- ✅ **Detects**: same picture saved as PNG vs JPG (but decoded to the same pixels), metadata changes, different chunk ordering, different encoders.
- ✅ **Still safe**: you only dedupe when canonical pixels match exactly.
- ❌ **Does not detect**: resized images (different resolution), crops, heavy edits, or recompressions that change pixels.

> Important: “canonical pixel hash” is perfect **for exact pixel equality** after normalization.  
> If you want to dedupe resized/cropped/etc., that’s a different layer (thumbnail hashing / perceptual / feature matching) and should be done with a “candidate → confirm” approach.

---

## 0) Definition of “duplicate” (for this file)

Two images are duplicates if:

1) You decode both into pixels,  
2) You apply the same canonicalization steps, and  
3) The resulting canonical pixel byte arrays are **identical** (hash match).

---

## 1) Architecture overview (MV3-compatible)

### Components

1) **Content Script**
- Discovers candidate URLs (same as your exact-byte pipeline).
- Sends URLs to the service worker.

2) **Service Worker**
- Fetches image bytes.
- Decodes to pixels (using `createImageBitmap` + `OffscreenCanvas`).
- Canonicalizes the pixels (orientation, colorspace assumptions, alpha treatment, output format).
- Hashes the canonical pixel buffer with SHA-256.
- Stores/looks up hashes in IndexedDB.

3) **IndexedDB**
- Stores canonical pixel hashes and occurrences.
- Optionally stores image metadata (width/height, etc.).

---

## 2) End-to-end workflow

### A) Candidate collection (Content Script)
Same as your byte-hash workflow:
- Collect `img[src]`, `srcset`, CSS backgrounds.
- Normalize and batch-send to SW.

### B) Pixel-hash pipeline (Service Worker)

For each candidate URL:

1) Fetch bytes (`ArrayBuffer`)
2) Decode image into pixels (RGBA)
3) Canonicalize:
   - apply orientation (EXIF) where possible
   - output to a fixed pixel format (RGBA8)
   - define consistent alpha handling
4) Hash canonical pixel buffer (SHA-256)
5) Dedupe by canonical pixel hash:
   - exists → DUP
   - else → NEW

---

## 3) Canonicalization spec (the “contract”)

To make pixel hashing stable, you must ensure these properties are consistent:

### 3.1 Output pixel format
- **RGBA, 8-bit per channel**, in row-major order.
- Use a fixed canvas size equal to the decoded image’s width and height.
- No scaling for this method.

### 3.2 Orientation
If the input contains orientation metadata and your decode path honors it inconsistently, you risk mismatches.

**Rule:** canonical buffer must represent the *visually correct orientation*.

Practical approaches:
- Prefer a decode path that respects EXIF orientation (for `createImageBitmap`, pass `{ imageOrientation: "from-image" }`).
- If not reliable, parse EXIF orientation yourself and rotate/flip on canvas before reading pixels.

### 3.3 Colorspace / gamma
Different decoders or platforms can differ in subtle colorspace handling.

**Rule:** define a single assumption:
- Treat decoded pixels as **sRGB** output.
- Use the browser’s decode pipeline consistently (same engine) to reduce variability.

> In practice, if both images are decoded in the same browser using the same pipeline, pixel buffers tend to match when the visual output matches. For maximum portability across environments, you’d need deeper color management, which is usually overkill for an extension.

### 3.4 Alpha handling (critical!)
Two encoders may store alpha differently (straight vs premultiplied). Canvas APIs may give you premultiplied results in some contexts.

**Rule:** pick one canonical alpha policy and enforce it.

Safe options:
- **Option A (recommended):** canonicalize to **unpremultiplied** alpha
- **Option B:** canonicalize to premultiplied alpha

Implementation depends on what your pixel readout returns. `getImageData()` returns unpremultiplied RGBA per spec, so do **not** unpremultiply again unless you know your pipeline produced premultiplied pixels.

**Robust approach:** explicitly unpremultiply (when A>0) to a standard formula, clamped to 0..255, only if you can confirm premultiplied input.

### 3.5 Metadata stripping
All file metadata becomes irrelevant because you’re hashing pixels, not the container.

---

## 4) Implementation details (Service Worker)

### 4.1 Fetch bytes
```js
async function fetchBytes(url, { cacheMode = "force-cache", timeoutMs = 15000, referrer } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: cacheMode,
      credentials: "include",
      referrer,
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const buf = await res.arrayBuffer();
    return { buf, contentType: res.headers.get("content-type") || "" };
  } finally {
    clearTimeout(t);
  }
}
```

> Hotlink-protected sites may require cookies and a page referrer. Pass the page URL as `referrer` (from the content script), and if you still see 403s, fall back to fetching in the page context and forwarding the bytes to the SW.

### 4.2 Decode bytes to ImageBitmap
You’ll typically:
- Create a `Blob` from bytes
- Use `createImageBitmap(blob)` to decode

```js
async function decodeToBitmap(buf, contentType = "") {
  const blob = new Blob([buf], { type: contentType || "application/octet-stream" });
  const bmp = await createImageBitmap(blob, {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "default"
  });
  return bmp; // has width/height
}
```

> Note: `createImageBitmap` is available in workers, including extension service workers, on modern Chrome; if you hit compatibility issues, fall back to decoding in an extension page (offscreen document) and send back pixel data.

### 4.3 Render to OffscreenCanvas and read pixels
```js
async function bitmapToRgba(bmp) {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);

  const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { rgba: imgData.data, width: bmp.width, height: bmp.height };
}
```

### 4.4 Optional: Unpremultiply alpha (canonical alpha)
```js
function unpremultiplyRgbaInPlace(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0 || a === 255) continue;

    // Convert premultiplied RGB back to straight alpha RGB.
    // r' = round(r * 255 / a)
    rgba[i]     = Math.min(255, Math.round((rgba[i]     * 255) / a));
    rgba[i + 1] = Math.min(255, Math.round((rgba[i + 1] * 255) / a));
    rgba[i + 2] = Math.min(255, Math.round((rgba[i + 2] * 255) / a));
  }
}
```

### 4.5 Hash the canonical pixel buffer
Hash input should include:
- width, height (otherwise two different shapes might collide if bytes coincidentally match)
- pixel bytes

A simple scheme:
- 4 bytes little-endian width
- 4 bytes little-endian height
- raw RGBA bytes

```js
function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

async function sha256Hex(arrayBuffer) {
  const hashBuf = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const bytes = new Uint8Array(hashBuf);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function pixelHash({ rgba, width, height }) {
  const header = new Uint8Array(8);
  header.set(u32le(width), 0);
  header.set(u32le(height), 4);

  const combined = new Uint8Array(header.length + rgba.length);
  combined.set(header, 0);
  combined.set(rgba, header.length);

  return await sha256Hex(combined.buffer);
}
```

### 4.6 Full pipeline function
```js
async function canonicalPixelHashFromUrl(url, opts) {
  const { buf, contentType } = await fetchBytes(url, opts);
  const bmp = await decodeToBitmap(buf, contentType);
  const { rgba, width, height } = await bitmapToRgba(bmp);

  // Canonicalization hooks:
  // - If you implement EXIF orientation manually, apply rotations before getImageData
  // - Choose your alpha policy:
  // unpremultiplyRgbaInPlace(rgba);

  const hash = await pixelHash({ rgba, width, height });
  return { hash, width, height, byteLength: buf.byteLength, contentType };
}
```

---

## 5) IndexedDB schema additions

Reuse your existing DB and add a store for pixel-hash canonicals.

### Object store: `pixel_canonicals`
- **Key:** `pixelHash` (hex)
- **Value:**
```js
{
  pixelHash,
  width,
  height,
  firstSeenAt,
  representative: { url, tabId, pageUrl }
}
```

### Object store: `pixel_occurrences`
- Same structure as occurrences, but keyed/indexed by `pixelHash`.

> Optional: store mapping from URL to last known pixelHash with TTL:
- Store: `url_cache`
- Key: `url`
- Value: `{ url, pixelHash, seenAt }`

---

## 6) Messaging contract (additions)

### SW → UI
`PIXEL_HASH_RESULT`
```json
{
  "type": "PIXEL_HASH_RESULT",
  "scanId": "uuid",
  "url": "https://.../a.png",
  "pixelHash": "hex...",
  "width": 1024,
  "height": 768,
  "status": "NEW|DUP",
  "canonicalId": "hex..."
}
```

### SW errors
`PIXEL_HASH_ERROR`
```json
{
  "type": "PIXEL_HASH_ERROR",
  "scanId": "uuid",
  "url": "https://.../a.png",
  "errorCode": "DECODE_FAILED|CANVAS_FAILED|FETCH_FAILED",
  "details": "string"
}
```

---

## 7) Performance and safety notes

### Performance costs
Pixel hashing is heavier than byte hashing:
- decode cost
- canvas draw
- reading full pixel buffer
- hashing more data (width*height*4 bytes)

### Concurrency guidance
Use smaller concurrency than byte hashing:
- e.g., `concurrencyDecode = 2..4`

### Memory guidance
Don’t hold many decoded pixel buffers at once. Process and discard per-image.

### Safety guarantee
- Still **no false positives** under this definition:
  - you dedupe only when canonical pixel bytes match.
- However, your canonicalization must be consistent (orientation/alpha/color assumptions) for stable results.

---

## 8) “Definition of done” checklist

- [ ] Service worker can fetch image bytes for scanned URLs.
- [ ] Decode uses a consistent pipeline (`createImageBitmap` + `OffscreenCanvas`).
- [ ] Canonical pixel buffer is defined and documented (RGBA8 + width/height header).
- [ ] Hash uses SHA-256 over the canonical pixel representation.
- [ ] IndexedDB stores `pixel_canonicals` + occurrences.
- [ ] UI groups duplicates by `pixelHash` without deleting originals.
- [ ] Concurrency limited to avoid jank/memory spikes.

---
