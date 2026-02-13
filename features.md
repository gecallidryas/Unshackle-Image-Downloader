# Features

## Image extraction
- Extracts `<img>` sources, including `srcset` and `<source>` candidates.
- Scans CSS image properties (background, mask, border-image, list-style, content) including `image-set()` variants.
- Supports `data:` and `blob:` URLs alongside normal network images.
- Captures canvas snapshots and inline SVGs.
- Hard-skips obvious video assets (`.mp4`, `.webm`, `.m3u8`, etc.) and `<source>` entries under `video/audio` from image scan paths to prevent non-image panel entries.

## Blob capture & hydration
- Captures blob bytes from `URL.createObjectURL`, canvas `toBlob`/`toDataURL`, and image fetch responses.
- Hydrates blob URLs to extension-owned blobs with a 25 MB cap.
- Cross-frame blob listing and hydration support.

## Network capture
- Optional network capture mode with CDP/webRequest fallbacks.
- Batch retrieval of captured image bytes and dedupe by hash.

## Image deduplication
- Three-layer pipeline: L1 byte SHA-256, L2 canonical pixel hash, L3 perceptual + SSIM confirmation.
- L0 metadata prefilter for L3 candidate pruning using intrinsic resolution, optional rendered-size tolerance (1px), and optional byte-length checks.
- Atomic canonical and stats/bucket writes in IndexedDB to prevent concurrency race losses.
- Tab-scoped scan stop behavior and scan-aware UI message routing to avoid cross-scan/cross-tab duplicate removals.
- Non-image payload rejection at L1 with explicit dedupe error reporting to the panel.
- Blob-byte L1 validation falls back to decode probing so valid image formats outside the signature table are still deduped.
- Active dedupe scan routing is retained until explicit stop/replacement (not a fixed short timeout), preventing dropped late pipeline results.
- Source-link + filename metadata dedupe now prefers the highest-resolution candidate when multiple variants exist.
- Source-link keys are now prioritized before content-hash keys when auto dedupe is enabled, so same-source filename variants consistently resolve to one winner.
- `srcset` candidates are ranked high-to-low (width/density) so higher-quality variants are kept first.
- Auto dedupe is gated by settings + mode: dedupe runs only when auto dedupe is enabled and the panel is in Image mode (never in the Manga tab).
- Duplicate removal uses URL aliases (`url` + `rawUrl` + `normalizedUrl`) so blob hydration URL rewrites do not bypass dedupe removal.
- Auto-scan dedupe options can be updated live (`updateAutoScanOptions`) so turning dedupe off (or switching to Manga tab) immediately stops new dedupe candidate dispatch.

## Chrome Web Store build constraints
- Manga mode stays hard-disabled in the webstore-safe build and opening attempts show an in-extension blocked modal with a GitHub full-version link.
- Webstore-safe viewer UI omits the `Copy login cookie` control.
- Webstore-safe panel JS excludes the cookie-copy interaction path tied to that removed control.
- The blocked modal full-version CTA links to `https://github.com/gecallidryas/Unshackle-Image-Downloader`.
- Webstore-safe ZIP export now ships `zip.worker.js` in-bundle and keeps fallback JSZip data intact if worker startup fails.

## Links
- `Tip`, `Contact us`, and `Help` now resolve from remote `.txt` link files first (with strict http/https validation), then fall back to packaged/local defaults.
