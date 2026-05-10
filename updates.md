# Updates

## 2026-03-26
- Extracted shared option-row controls for the nested SOTA image editor toolbar into `apps/web/src/toolbar/controls/ToolOptionButton.tsx`, `ToolOptionToggle.tsx`, and `ToolOptionField.tsx`.
- Swapped the generic `button`, `dropdown`, `toggle`, and `number-input` item rendering in `apps/web/src/toolbar/ToolOptionsBar.tsx` over to those shared primitives while leaving the specialized tool-family branches intact.
- Added focused control-level coverage in `apps/web/src/toolbar/controls/toolbarControls.test.tsx` and verified the existing `ToolOptionsBar` reference tests still pass.
- Extracted the shared left-toolbar tool registry and `ToolId` type seam for the nested SOTA image editor workspace into `apps/web/src/tools/types.ts` and `apps/web/src/tools/toolRegistry.ts`.
- Kept `LeftToolbar.tsx` on the shared registry while re-exporting `ToolId` for compatibility, and pointed `EditorPage.tsx` at the new shared type module.
- Added a focused registry contract test so later toolbar-adapter work can depend on a stable id/order/metadata surface.

## 2026-02-16
- Rewrote root `README.md` into a comprehensive GitHub reference covering runtime architecture, detailed image detection pipeline internals, manga loader/mode architecture (`image/manga` + `auto/runner/manager`), extension installation, repository map, and troubleshooting.
- Added explicit documentation section for placeholder/future scaffolding and clarified that Lezhin remains integration-in-progress in this branch despite `sites/lezhin/module.js` existing.
- Updated `features.md` to align with actual wiring state by marking Lezhin as placeholder/not yet fully injected or web-accessible in active runtime paths.
- Added a new README site-specific guide section with domain-by-domain workflow notes for Gigaviewer/CoreView, SpeedBinb, Bellaciao, and known load/scroll/canvas fallback cases.

## 2026-02-15
- Hardened image scan detection for Instagram-style embeds by adding a dedicated `instagramEmbed` collector in both scan paths (`scanForImages` and `scanForImagesConcurrent`).
- Added targeted extraction for `fbcdn.net`/`cdninstagram.com` image URLs from wrapper-heavy markup (including `._aagu`/`._aagv`), plus `data-src`/`data-srcset` fallback parsing.
- Added HTML-escaped URL normalization (`&amp;`/`&#38;`) before URL resolution to prevent missed detections from attribute-encoded image links.
- Mirrored the same detector hardening into `chrome-webstore-build/content.js` to keep build behavior aligned.
- Tightened Instagram CDN host allowlisting to exact domains or true subdomains only (e.g. `*.fbcdn.net`, `*.cdninstagram.com`) to prevent false positives from lookalike hostnames.

## 2026-02-14
- Rewrote root `features.md` into a full top-down feature inventory, covering product surfaces, scanning/capture, canvas/blob pipelines, overlay nuking, network capture, dedupe internals, ZIP/export, manga workflows, and downloader module behaviors (GigaViewer, Speedbinb, BellaCiao, Lezhin, Madara, Mangastream, FoolSlide).
- Added `chrome-webstore-build/features.md` as a separate Chrome Web Store safe-build feature document, including packaged capabilities and explicit restrictions (hard-disabled manga mode, blocked modal flow, removed cookie-copy control, and manifest/resource constraints).

## 2026-02-13
- Added source-link + filename metadata dedupe with resolution-aware preference so higher-resolution variants are kept and lower/same-resolution duplicates are dropped.
- Ranked `srcset` candidates by descending width/density before ingestion to avoid retaining lower-resolution entries first.
- Dedupe pipeline start/handling is now gated by settings + UI mode: only active when auto dedupe is enabled and the panel is in Image mode.
- Entering the Manga tab now stops active dedupe scans; Manga-mode availability in settings no longer enables dedupe while the Manga tab is active.
- Mirrored the same dedupe behavior changes into `chrome-webstore-build/content.js` and `chrome-webstore-build/panel.js`.
- Prioritized source-link dedupe keys ahead of content-hash keys during auto dedupe to ensure same-source filename variants always collapse to a single preferred item.
- Fixed panel-side duplicate removal to match URL aliases (`url`, `rawUrl`, `normalizedUrl`), which closes misses caused by blob hydration rewriting display URLs.
- Added content action `updateAutoScanOptions` and wired panel sync so dedupe can be toggled live during active auto-scan sessions.
- Dedupe scan finish now marks the scan stopped and unregisters scan routing in the pipeline, preventing stale scan routing state.
- Mirrored these reliability fixes into both root and `chrome-webstore-build` dedupe/content/panel code paths.
- Added hard skip filtering in image scan paths for obvious video assets (`.mp4`, `.webm`, `.m3u8`, etc.) and `video/audio` `<source>` nodes to avoid broken Tenor-style video entries in the image panel.
- Updated header link resolution so `Tip`, `Contact`, and `Help` are loaded from remote text files (`https://www.scernix.com/*_link.txt`) first, with URL validation and fallback to packaged/default links.
- Fixed ZIP reliability for Chrome Web Store safe build by bundling `chrome-webstore-build/zip.worker.js` and avoiding transferable buffer detachment so JSZip fallback still has valid bytes when worker setup fails.

## 2026-02-11
- Expanded CSS image extraction to include additional CSS image properties and `image-set()` parsing.
- Deep scan includes `data:`/`blob:` CSS image URLs with safer MIME detection.
- Chrome Web Store manifest permissions trimmed for the build output.
- Hardened dedupe L1/L2 canonical writes with atomic ensure semantics to prevent concurrent false-NEW races.
- L1 now rejects non-image responses via MIME/signature validation and emits `DEDUPE_HASH_ERROR` to UI.
- L2 decode now forces `imageOrientation: "none"` before manual EXIF normalization.
- Queue retry logic now uses fresh abort controllers per attempt with timeout cleanup in all paths.
- Dedupe stop now cancels scans per tab (all scans on that tab), not globally.
- Panel dedupe message handling is scoped to active dedupe scan IDs and matching tab context.
- IndexedDB scan stat increments and perceptual bucket membership updates are now transactional.
- Added L0 metadata prefilter in L3 (intrinsic resolution + optional byte-length + rendered-size tolerance), plus hash shortcuts after metadata gate.
- Synced dedupe/content/panel changes to both root and `chrome-webstore-build` trees.
- Fixed blob-byte L1 false negatives by probing decodeability when MIME/signature sniffing is inconclusive.
- Removed fixed 45s panel dedupe scan expiry; scan routing now persists until explicit stop or same-tab scan replacement.
- Restored Chrome Web Store safety gating: manga mode cannot be enabled and now shows the blocked modal with GitHub full-version link.
- Removed `Viewer tools -> Copy login cookie` from the Chrome Web Store panel UI.
- Removed the now-unused Chrome Web Store panel JS cookie-copy status/render/listener code path.
- Updated Chrome Web Store blocked-modal GitHub redirect to the renamed repo: `Unshackle-Image-Downloader`.

## 2026-01-31
- Expanded CSS image extraction to cover `image-set()` and additional properties (mask, border-image, list-style, content).
- Deep scan now includes `data:`/`blob:` background images with safer MIME handling.
- DOM blob discovery checks more CSS properties to catch early-created blob URLs.
- Guarded deep-scan MIME guessing when helper isn't present.
