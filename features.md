# Features

This document maps Unshackle features from top-level product capabilities down to implementation-level behavior.

## 1. Product surfaces

### 1.1 Main panel (`panel.html` + `panel.js`)
- Two-mode shell: `Image` mode and `Manga` mode.
- Side-panel/popup compatible UI behavior with persistent preference.
- Main action controls:
- `Scan`, `Canvas`, `Download`, `ZIP`, `Rename Serially`, `Remove duplicates`, `Delete`, `Select All`, `Invert`, filter toggle.
- Advanced controls:
- Overlay preview/remove/undo, keyword cleanup, right-click unlock, network capture toggles.
- Settings modal:
- Theme, locale, mode behavior, manga enablement/loader, permission prompts, download-path prompts, dedupe auto-remove, usage stats.
- Onboarding modal:
- Language selection, theme selection, feature walkthrough.
- Footer diagnostics:
- Runtime notices, progress bar, cancellable long-running operations.

### 1.2 Bookmarks surface (`bookmarks.html` + `bookmarks.js`)
- Saved-series list using `settings.manga.bookmarks` in `chrome.storage.local`.
- Bookmark normalization and deduplication by `connectorId::url`.
- Actions:
- Open series, fetch recent updates, remove bookmark.
- Recent updates drawer:
- Pulls chapter updates via `hkProxy.fetchManga`, supports quick chapter open.
- Theme sync with panel preferences.

### 1.3 Help surface (`help.html` + `help.js`)
- Offline help page packaged inside extension.
- Theme-aware content.
- Guided sections for image/manga workflows, permissions, overlays, and download behavior.

### 1.4 Background service worker (`background.js`)
- Central orchestrator for:
- Downloads, ZIP construction, network capture, CDP debugger wiring, dedupe pipeline, offscreen processing, HK routing.
- Message-router for panel/content/bookmarks.

---

## 2. Image discovery and scanning

### 2.1 DOM image extraction (`content.js`)
- Scans standard image sources:
- `<img src>`, `<img srcset>`, `<picture>`, `<source srcset>`.
- `srcset` parsing and quality-aware ordering (higher width/density first).
- Instagram embed hardening:
- Dedicated extraction for Instagram CDN images (`fbcdn.net`/`cdninstagram.com`) from wrapper-heavy markup (including `._aagu`/`._aagv` containers), plus `data-src`/`data-srcset` fallbacks, HTML-escaped URL normalization, and strict exact/subdomain host matching for CDN allowlisting.
- Multi-kind discovery model:
- `img`, `background`, `canvas`, `svg`, `dataUri`, `blob`.
- Session-aware discovery metadata:
- New vs previously-seen tracking.
- Duplicate URL suppression for network-like resources, while preserving distinct canvas captures.

### 2.2 CSS and computed-style extraction
- Scans CSS image-bearing properties including image-set variants:
- `background*`, `mask*`, `border-image*`, `list-style-image`, `content`, and `image-set()`/`-webkit-image-set()` parsing.
- Background scan profiles with node caps:
- Uses heuristics and limits (`MAX_BG_SCAN_NODES`) for performance safety.

### 2.3 Canvas capture pipeline
- Manual canvas scan via `Canvas` button.
- Canvas snapshots converted to PNG blobs, then represented as object URLs for panel transport.
- Canonical canvas naming cache for stable filenames (`Canvas_XX`).
- Handles fallback path when direct blob conversion is unavailable.

### 2.4 SVG capture pipeline
- Inline SVG serialization to data/object URL representations.
- Stores SVG payload references in blob registry for later hydration/export.

### 2.5 Blob/data URL handling
- Recognizes and preserves both `blob:` and `data:` resources.
- Collects payload bytes where possible for hydrated display/download in extension context.
- Blob listing and serialization endpoints:
- `listBlobs`, `serializeBlobUrls`, `releaseObjectUrls`.

### 2.6 Video exclusion hardening
- Explicit skip paths for obvious non-image media in scan flows:
- `video/audio` sources and common video URL patterns (`.mp4`, `.webm`, `.m3u8`, etc.).

### 2.7 Incremental and dynamic scan behavior
- Concurrent scan path with incremental flushes for large pages.
- Dynamic rescan triggers via MutationObserver for image-relevant DOM mutations.
- Scan progress messages emitted to panel (`SCAN_PROGRESS`).

---

## 3. Blob bridge and page-world bridges

### 3.1 Blob capture bridge (`bridge_inject.js` + `page_blob_patch.js`)
- Injected at `document_start`.
- Hooks page-world APIs:
- `URL.createObjectURL`, `URL.revokeObjectURL`, `canvas.toBlob`, `canvas.toDataURL`, `fetch` image responses.
- Captures bytes into shared registry (`__UNSHACKLE_BLOB_REG`) with pruning controls:
- Entry count, total byte limits, age-based cleanup, revoked URL TTL.

### 3.2 Credentialed page fetch bridge (`page_fetch_bridge.js`)
- Provides page-context fetch proxy using page cookies/session context.
- Request/response message tokenization with timeout and body transfer support.
- Used for protected resources and site-specific anti-hotlink flows.

### 3.3 Content-side hydration helpers
- Blob->ArrayBuffer/DataURL conversion utilities.
- `collectAllVisualAssets` for broad capture sweeps:
- Blob registry entries, DOM blob references, SVG, canvas snapshots, and aggressive background assets.

---

## 4. Filtering, sorting, and curation

### 4.1 Filter dimensions
- Minimum width/height.
- Format filter (`png/jpg/webp/gif/svg/...`).
- Conversion target (`Original/WEBP/JPG/PNG`).
- Search by filename or URL.
- Kind filter (`img/background/blob/dataUri/canvas/svg/module kinds`).
- Discovery filter (`all/new/seen`).

### 4.2 Sorting
- Detection order.
- Name.
- Pixel area.
- File size.

### 4.3 Bulk controls
- Select all / invert.
- Delete selected.
- Serial rename by detection order.

---

## 5. Network image capture

### 5.1 Capture modes
- User-armed `Network capture` toggle.
- `Network Only Mode` for scan button behavior that only surfaces captured network assets.

### 5.2 Capture backends (`background.js`)
- Dual-path capture:
- CDP (`chrome.debugger`, `Network.getResponseBody`) when attached.
- `webRequest.onCompleted` fallback when CDP is not active.
- Includes tab lifecycle handling:
- attach/detach logic, navigation re-enable, stale pending-request cleanup.

### 5.3 Capture safety and dedupe
- URL normalization strips common cache-busting params.
- Hash-based dedupe (first-N-bytes hash) and per-tab caches.
- Size and TTL limits:
- Max per-image bytes, minimum-content guard, cache expiry.
- MIME validation with byte sniffing fallback.

### 5.4 CDN compatibility helpers
- DeclarativeNetRequest dynamic rules for stripping restrictive CORP/COEP headers on specific CDN patterns.

### 5.5 Panel-side network ingestion
- Batch byte retrieval (`getCapturedImagesBytesBatch`).
- Blob URL hydration and cleanup tracking.
- Merge with blob/DOM visual asset collection to catch page-owned resources.

---

## 6. Overlay cleanup and interaction unblocking

### 6.1 Heuristic overlay detection (`content.js`)
- Candidate discovery by:
- Positioning, viewport coverage, z-index, pointer-blocking behavior.
- Safety allowlists for essential/interactive elements.
- Scan and action caps:
- `MAX_OVERLAY_SCAN_NODES`, `MAX_OVERLAY_ACTIONS`.

### 6.2 Keyword-based nuking
- Default keyword set plus external `overlay_keywords.md` support.
- Matching across class/id/aria/text patterns, including prefix/suffix heuristics.
- Modes:
- `soft` (depower/hide) and `hard` (remove).

### 6.3 Preview, undo, and recents
- Preview highlight mode with count feedback.
- Cleanup history stack with undo restoration.
- Recent/suggested tag rendering in panel.

### 6.4 Right-click unlock
- Dedicated action to neutralize common click/selection blockers.

---

## 7. Deduplication system (L1/L2/L3)

### 7.1 Pipeline overview (`src/dedupe/*`)
- L1: byte-level SHA-256 exact dedupe.
- L2: canonical pixel hash dedupe (EXIF-aware orientation normalization).
- L3: perceptual dHash candidate search + SSIM confirmation.

### 7.2 L1 behavior (`byte-hash.js`)
- Handles `data:` directly, `blob:` via content-script byte handoff.
- MIME/content validation with signature sniffing.
- Decode-probe fallback to avoid false non-image negatives on obscure formats.
- Rejects non-image payloads with explicit dedupe error messages.

### 7.3 L2 behavior (`pixel-hash.js`)
- Decodes to bitmap with `imageOrientation: "none"`.
- Parses EXIF orientation and applies explicit canonical transforms.
- Hashes canonical buffer format `[width][height][RGBA]`.
- High-pixel-count safety skip path.

### 7.4 L3 behavior (`perceptual.js` + `ssim.js`)
- Multi-rotation dHash generation.
- Hamming-threshold candidate filtering.
- L0 metadata prefilter:
- Intrinsic dimensions, optional rendered-size tolerance, optional byte-length agreement.
- Strict confirmation with SSIM threshold (`>= 0.995`) across transform candidates.

### 7.5 Storage model (`db.js`)
- IndexedDB stores:
- `byte_canonicals`, `pixel_canonicals`, `images`, `groups`, `occurrences`, `hash_buckets`, `pair_confirms`, `thumbnails`, `scan_runs`.
- Atomic ensure operations for canonical inserts to reduce race-condition false-new states.
- Transactional scan stat updates and group/bucket writes.

### 7.6 Queue/execution control (`queue.js`, `pipeline.js`)
- Multi-queue async orchestration with concurrency, retries, timeout aborts.
- Scan-to-tab routing maps.
- Tab-scoped stop semantics and scan lifecycle events.
- Active scan tracking retained until explicit stop/replacement.

### 7.7 Panel integration (`panel.js`)
- Manual remove-duplicates action.
- Auto-remove option with mode-aware gating:
- Enabled only in image mode; stopped when switching to manga mode.
- URL alias-aware duplicate removal (`url/rawUrl/normalizedUrl`).
- Live options sync for active autoscan dedupe sessions.

### 7.8 Additional dedupe policies currently implemented
- Source-link + filename metadata dedupe with resolution-aware winner preference.
- Source-link keys prioritized before content-hash keys during auto dedupe.

---

## 8. Download and ZIP pipeline

### 8.1 Direct downloads
- Single and batch URL download actions via `chrome.downloads.download`.
- Blob download support with filename fallback and object URL lifecycle tracking.

### 8.2 ZIP creation
- Panel ZIP flow with:
- staging, progress reporting, cancel support, status updates.
- Worker path (`zip.worker.js`) plus fallback to JSZip if worker path fails.
- Background also supports `zipStore` raw-store ZIP builder (`ZipStreamBuilder`) for module workflows.

### 8.3 Filename safety
- Safe filename normalization and extension handling.
- Conflict handling via download API (`uniquify`).

### 8.4 Optional manga metadata artifacts
- ComicInfo.xml injection.
- EPUB (beta) generation path.

---

## 9. Manga mode and HakuNeko integration

### 9.1 Mode and settings model
- Manga mode is feature-gated from settings (`settings.manga.enabled`).
- Loader modes:
- `auto`, `runner`, `manager`.
- Family toggles:
- `speedbinb`, `coreview`, `madara`, `mangastream`, `foolslide`.

### 9.2 Connector routing
- Connector alias/canonicalization helpers (`src/hk-connectors.js`).
- Host/family heuristics and overrides in panel runtime.
- Manager-capable module allowlist flow in background.

### 9.3 Loader fallback intelligence
- Auto path tries preferred loader and falls back on failure.
- Host loader history with TTL-based memory to improve future choices.
- Warning propagation when fallback is used.

### 9.4 Chapter workflows
- Detect connector.
- List chapters.
- Manual chapter add modal.
- Download selected chapters via HK job system.
- Send-to-panel preview to reuse image-mode tooling.

### 9.5 Bookmarking
- Bookmark action stores connector/url/title/family/timestamp.
- Bookmarks UI supports open, refresh updates, delete.

### 9.6 Proxy and auth
- `hk-proxy.js` attaches local cookies to HK requests where needed.
- Cookies remain local to browser context.

### 9.7 Offscreen processing and bridge usage
- Offscreen doc path used for normalization and tile operations.
- Page bridge fetch used for protected hosts and cookie-bound resources.

---

## 10. Viewer/downloader modules

### 10.1 Registry and delegate bridge
- Dynamic module registry (`sites/site-registry.js`).
- Delegate call surface (`adapters/hakuneko/delegates.js`) for `listPages`, `listChapters`, and module method calls.
- Connector->module mapping bridge (`adapters/hakuneko/registry.js`).

### 10.2 `gigaviewer` module
- Detects GigaViewer/CoreView-like episode pages.
- Extracts episode JSON from DOM scripts or network fallback (`.json` endpoint patterns).
- Builds page descriptors with tile metadata (`tiles`, `tileDiv`, `scramble`).
- Normalizes/descrambles tiled pages (including transpose modes like `baku`).
- Supports chapter discovery via DOM links, Atom feed, and next-chapter fallback.
- Emits telemetry and includes one-page diagnostic routine.

### 10.3 `speedbinb` module
- Supports both `ptimg` JSON and `ptbinb` flows.
- Hydrates page context/tap-state/query parameters from live viewer context.
- Uses ptbinb scramble table logic and transfer maps for page reconstruction.
- Provides fallback to JSON-based path when ptbinb hydration fails.
- Exposes `pageBridgeFetch` helper for page-context fetch interoperability.

### 10.4 `bellaciao` module
- Supports multiple site configs (Ciao Plus, Pocket Magazine).
- Computes site-required request headers via SHA-256/SHA-512 chain.
- Fetches episode payloads and descrambles pages with deterministic tile mapping.
- Returns structured page buffers + telemetry + diagnostic flow.

### 10.5 `lezhin` module
- Implementation file exists at `sites/lezhin/module.js` with:
- locale-aware handling (`en/ja/ko`), inventory/token requests, purchase checks, and shuffle descramble logic.
- Current integration state in this branch is placeholder/in-progress:
- module is not in the active delegate injection lists (`HK_DELEGATE_FILES`, panel `injectGV`, `content_manga.js` queue) and is not declared in `manifest.json` web-accessible module resources.
- Treat Lezhin support as non-production until end-to-end wiring is completed.

### 10.6 `madara`, `mangastream`, `foolslide` modules
- Site-family detectors.
- Chapter list extraction from known selectors.
- Page URL extraction from chapter pages.
- Filename normalization for exported pages.

---

## 11. Internationalization, themes, and UX polish

### 11.1 Locale system
- Dynamic locale switching via `_locales/*/messages.json`.
- Supported locales:
- `en`, `de`, `es`, `fr`, `ja`, `ko`, `zh_CN`, `zh_TW`.

### 11.2 Themes
- Theme persistence across panel/help/bookmarks.
- Includes contrast + multiple branded theme variants.

### 11.3 Notices and diagnostics
- Toast system.
- Hint messaging.
- Footer diagnostics toggles.
- Donation prompt cadence logic based on usage thresholds.

### 11.4 Stats
- Tracks scans, scanned images, overlays nuked/tweaked, downloaded images.

---

## 12. Permissions and privacy model

### 12.1 Runtime host access behavior
- Optional prompt-per-scan behavior.
- Host remember/remove flow for bridge script match lists.
- `<all_urls>` optional host permission path.

### 12.2 Data locality
- Operational state in `chrome.storage.local`/`sync`.
- Cookie and request handling stays local in extension context.
- No mandatory remote telemetry transport in core flow.

---

## 13. External links and support hooks

- `Tip`, `Contact`, `Help` links support remote `.txt` source resolution with strict URL validation and fallback defaults.

---

## 14. Chrome Web Store safe build

- The Web Store-safe build has its own feature inventory at:
- `chrome-webstore-build/features.md`
- It documents the hard-disabled manga behavior and packaging constraints for that distribution.

---

## 15. Documentation alignment notes

- `README.md` is maintained as the primary architecture + install + detection-flow reference for GitHub.
- `README.md` now also includes a site-specific operational guide with per-domain handling notes (Gigaviewer/CoreView, SpeedBinb, Bellaciao, and load/scroll/canvas fallback workflows).
- Placeholder or future scaffolding blocks are intentionally retained in the codebase; docs should call these out explicitly when they are user-visible or likely to be mistaken as active features.
