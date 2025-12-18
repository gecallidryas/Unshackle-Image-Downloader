# Unshackle Image Downloader

Scan, filter, clean, and download images or full manga chapters directly from the page you are viewing. The Unshackle extension ships as a Chrome Manifest V3 side-panel experience with an optional popup launcher, a manga workflow powered by the HakuNeko engine, and offline bookmarks/help surfaces for quick follow-up actions.

## Table of contents
- [Overview](#overview)
- [Feature tour](#feature-tour)
  - [Control surfaces](#control-surfaces)
  - [Image mode](#image-mode)
  - [Manga mode](#manga-mode)
  - [Bookmarks](#bookmarks)
  - [Help and docs](#help-and-docs)
  - [Themes, privacy, and permissions](#themes-privacy-and-permissions)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Development workflow & debugging](#development-workflow--debugging)
- [Testing & quality checks](#testing--quality-checks)
- [Adding connectors & viewer modules](#adding-connectors--viewer-modules)
- [Troubleshooting](#troubleshooting)
- [Reference docs & support](#reference-docs--support)

## Overview
Unshackle is built for two complementary tasks:
1. **Image discovery/cleanup** – capture `<img>` tags, backgrounds, canvases, data URIs, and viewer-specific tiles, then clean overlays and export everything as standalone files or compressed ZIPs.
2. **Manga workflows** – detect and talk to the same connectors used by HakuNeko, fetch catalog data, add bookmarks, and batch-download chapters complete with metadata (ComicInfo, EPUB) without leaving your browser.

Everything runs locally inside the extension:
- Active-tab permissions are requested only when a scan or chapter fetch is triggered.
- Cookies and credentials never leave the device; the manga proxy injects the correct headers before any connector call.
- Telemetry is opt-in and, when enabled, stays in local storage for diagnostics only.

## Feature tour

### Control surfaces
- **Panel** (`panel.html`, invoked from the action icon or the Chrome side panel) hosts both *Image* and *Manga* modes plus advanced tools, download progress, and theme/telemetry controls.
- **Bookmarks** (`bookmarks.html`) is a chrome-tab surface that lists saved series, fetches recent chapters on demand, and mirrors your selected theme.
- **Help** (`help.html`) is a theme-aware, offline-first guide embedded in the extension so onboarding steps are always available.

### Image mode
- **Scanning & capture**
  - `Scan` walks the DOM for `<img>` tags, background images, blob/object URLs (captured via `page_blob_patch.js`), SVGs, and inline data URIs.
  - `Canvas` captures same-origin `canvas` buffers and dispatches the pixels back to the panel.
  - Viewer-specific helpers (GigaViewer, SpeedBinB, BellaCiao, Lezhin) are exposed through the “Module scan” dashboard and backed by the modules in `sites/`.
  - The content script (`content.js`) also injects `page_fetch_bridge.js` when needed so protected viewers can be fetched with page credentials.
- **Filtering & conversion**
  - Toolbar filters support min width/height, MIME format filters, conversion targets (`Original`, `WEBP`, `JPG`, `PNG`), search by filename/URL, and advanced “kind” filters (Images, Backgrounds, Blob, Canvas, site modules, etc).
  - Discovery filters distinguish new results vs. items seen during the session, and sort toggles cover detection order, name, pixel area, and file size.
- **Bulk actions**
  - Selection helpers (`Select all`, `Invert`) and the grid keyboard shortcuts make it trivial to curate hundreds of assets.
  - `Download` writes files directly via the service worker, while `ZIP` builds an archive on the fly using the manual ZIP builder in `background.js`.
  - `Rename serially` reorders filenames based on detection order for better offline sorting.
- **Overlay cleanup**
  - The Advanced overlay block previews/removes overlays via Soften/Remove modes, coverage thresholds, minimum z-index sliders, and keyword-based nukes with suggested tags loaded from `overlay_keywords.md`.
  - “Enable right-click” temporarily removes intercept handlers so you can use the native context menu on locked viewers.
  - Undo support keeps a short action history for the current tab.
- **Viewer tools**
  - Copy the active viewer login cookie, run diagnostics (`Run viewer diagnostics` dumps module telemetry), and save SpeedBinB/GigaViewer tiles as a ZIP directly from the panel.
  - The `page_blob` bridge keeps blob URLs alive long enough for the service worker to fetch the payload even if the page revokes them immediately.
- **Progress & hints**
  - Footer diagnostics mirror messages from the background worker, display toast notifications, and expose cancel controls for long-running downloads or ZIP assemblies.

### Manga mode
- **Connector detection**
  - Paste a chapter or series URL and use `Detect` to auto-map it to the right connector using `src/hk-connectors.js`, HakuNeko’s `vendor/hakuneko/index.json`, and on-page heuristics from `content.js`.
  - Manual connector overrides are supported through the picker when multiple matches share a hostname.
  - Loader selection (Auto / Runner / Manager) is configurable per profile; auto mode switches based on health data tracked in `background.js`.
- **Chapter listing & downloads**
  - `List chapters` triggers the HakuNeko runtime (`integrations/hakuneko/*` + `vendor/hakuneko/*`) through `hk-proxy.js`, applies the configured family filters, and renders chapters in the panel.
  - Options exist to emit `ComicInfo.xml` and EPUB files alongside the downloaded chapter ZIP.
  - The “Send to panel” button renders the fetched pages back in Image mode, reusing all image filters and overlay tooling.
  - Manual chapter modal lets you add missing/locked chapters by entering a path, title, and optional encoded URLs.
- **Bookmarks & cookies**
  - `Bookmark` stores connector id/url/title/family inside `chrome.storage.local` (`HK_BOOKMARK_STORAGE_PATH`), which the bookmarks surface later renders and refreshes.
  - Copy login cookie exposes the cookie host/value/updated timestamp to help with premium/paywalled sources. Cookies always stay on-device.
- **Status & diagnostics**
  - Inline status area shows spinner states, messages, and “Retry with runner” guidance when auto-loader fallback kicks in.
  - The manga proxy logs loader choice, retries, and connector metadata when `dev.hkDebug` or `?unshackleDebug=1` is enabled.

### Bookmarks
- Lives in `bookmarks.html`/`bookmarks.js` with the same theme palette as the panel.
- Lists saved series chronologically with badges for connector/family and the original save timestamp.
- Actions include “Open series”, “See recent updates” (fetches via `hkProxy.fetchManga`), and “Remove”.
- The updates drawer shows the two most recent chapters per series, indicates whether they are accessible or locked, and links directly to the chapter URL.

### Help and docs
- `help.html` mirrors the current theme, is fully offline, and documents quick-start steps, loader selection, cookie capture, overlay tools, and shortcuts.
- Buttons in the hero banner deep-link to the Getting Started or Manga sections inside the page.
- This README plus the `YANMAGA_*.md` files supplement the built-in help with deeper investigation notes for specific viewers/sites.

### Themes, privacy, and permissions
- **Themes:** Switch between High Contrast, Dark, Light-in-the-Dark, Noir Gold, Purple Fanatic, and Sakura from Settings → Quick settings. The choice syncs across the panel, bookmarks, and help surfaces.
- **Panel location:** Toggle between popup and Chrome Side Panel mode; the side panel is recommended for multi-tab workflows.
- **Manga enablement:** Manga mode is gated behind a settings toggle so minimalists can hide the entire HK stack.
- **Permissions & telemetry:** “Ask every scan” forces the active-tab permission prompt before each scan; telemetry counters stay local and can be toggled off entirely. Context-menu integration (`Enable right-click`) only appears when the overlay module is active.

## Architecture
- **Manifest & permissions** – `manifest.json` declares MV3, sidePanel support, and a minimal always-on content script (`content.js`). Optional host permissions (`<all_urls>`) are requested at runtime via the active-tab flow.
- **UI surfaces** – `panel.html`, `panel.css`, and the 8k-line `panel.js` drive the main experience; bookmarks/help each have their own HTML/CSS/JS bundles. Shared UI logic (settings sync, HK loader state) lives in `src/`.
- **Background service worker (`background.js`)**
  - Imports `src/settings.js`, HK debug helpers, ComicInfo/Epub generators, and manages the lifecycle of download jobs, ZIP assembly, notifications, and HK loader auto-switching.
  - Creates an `offscreen.html` document when connector normalization or tile unscrambling is required (`offscreen.js` handles Baku-style tile recomposition via `createImageBitmap`).
  - Injects the `page_blob_patch.js` and `page_fetch_bridge.js` scripts when a tab opts into blob capture or credentialed fetches.
  - Hosts the hkProxy endpoints (`HK_RUN`, `HK_RUN_EXEC`, `HK_DELEGATE_CALL`, `HK:DOWNLOAD`, etc.) that the panel and bookmarks rely on.
- **Content scripts & bridges**
  - `content.js` performs DOM scans, deduplicates discovery via persistent sets, feeds overlay removal commands, and relays viewer module results back through `chrome.runtime.sendMessage`.
  - `content_manga.js` injects all HakuNeko delegate scripts into the page context when Manga mode is enabled so connectors that expect page-world access can run.
  - `content-scripts/yanmaga-current-page.js` and other files under `sites/` provide site-specific instrumentation (e.g., for speedbinb, gigaviewer, madara).
- **HakuNeko integration**
  - The bridged runtime under `integrations/hakuneko/` adapts the upstream engine to MV3 restrictions: RequestAdapter proxies through the service worker, StorageAdapter maps to `chrome.storage`, DownloadAdapter streams through the background fetch queue, and InterProcessCommunicationAdapter provides message-based RPC.
  - `vendor/hakuneko/` and `hakuneko-runtime/` mirror the upstream connector definitions, runner scripts, and crypto utilities (e.g., `crypto-js.min.js`).
  - `scripts/hk-smoke.js` runs a Node-based sanity check to ensure connectors have domains/families and required GigaViewer mappings are present.
- **Data & storage**
  - Settings/defaults are defined in `src/settings.js` and persisted under `chrome.storage.local`.
  - Bookmarks and manga family preferences live inside the same settings blob.
  - Telemetry counters (if enabled) and loader history are cached with TTLs so loader auto-selection can learn from recent failures.
  - Localization strings live under `_locales`.

## Repository layout

| Path | Purpose |
| --- | --- |
| `panel.html`, `panel.js`, `panel.css` | Main side-panel UI for Image & Manga modes. |
| `content.js`, `page_blob_patch.js`, `page_fetch_bridge.js` | DOM scanning, blob capture, and credentialed fetch bridges injected into each tab. |
| `offscreen.html`, `offscreen.js` | Hidden document for tile descrambling and heavy canvas work. |
| `src/settings.js`, `src/hk-connectors.js`, `src/hk-debug.js` | Shared settings/defaults, connector aliasing, and debug toggles. |
| `integrations/hakuneko/`, `vendor/hakuneko/`, `hakuneko-runtime/` | Embedded HakuNeko engine, adapters, connector index, and cryptography dependencies. |
| `sites/`, `adapters/hakuneko/`, `modes/manager.js` | Viewer-specific modules, delegate registries, and HK loader orchestration. |
| `bookmarks.*`, `help.*` | Standalone bookmarks and help surfaces. |
| `_locales/` | Runtime i18n strings for panel/help/bookmarks. |
| `scripts/hk-smoke.js` | CLI smoke test for connectors, run via `node scripts/hk-smoke.js`. |
| `YANMAGA_*.md`, `PHASE_TRACKER.md` | Deep-dive docs for site-specific workstreams and HK hardening phases. |

## Getting started
1. **Requirements**
   - Chrome/Chromium 120+ (side panel + offscreen docs), or any MV3-compatible browser with the same APIs.
   - Node.js ≥ 18 if you want to run the optional smoke script.
2. **Load the unpacked extension**
   - Go to `chrome://extensions`, enable *Developer mode*, click **Load unpacked**, and choose the repository root.
   - Pin the Unshackle action icon so the popup launcher is always available, or open Chrome’s side panel and choose Unshackle from the dropdown.
3. **First run**
   - Click `Scan` on any page; Chrome will prompt for site access the first time. Grant access for the active tab or domain.
   - Use the ⚙ button to switch the UI between popup vs. side panel, choose a theme, and toggle Manga mode.
   - Visit the help page (question-mark button) if you need a guided tour of overlay controls or manga loader concepts.
4. **Manga setup (optional)**
   - Enable Manga mode from settings, choose your loader (Auto is recommended), and decide if unfinished families (Madara, Mangastream, Foolslide) should be active.
   - Bookmark your favorite series once detected so you can revisit them from `bookmarks.html`.

## Development workflow & debugging
- **Reloading & logs**
  - Use `chrome://extensions` → *Reload* to pick up code changes.
  - Service worker logs appear under *Inspect views > service worker*; panel/bookmark/help logs live in their respective DevTools.
- **Diagnostics**
  - `panel.js` exposes a *Run viewer diagnostics* button for module-specific logging (SpeedBinB/GigaViewer).
  - `hk-proxy.js` copies cookies automatically when possible; use the “Copy login cookie” action plus `console` logs to verify.
  - Enable HK debug logging either by setting `dev.hkDebug` in `chrome.storage.local` or by adding `?unshackleDebug=1` to `panel.html`.
- **Connector smoke test**
  - Run `node scripts/hk-smoke.js` before committing connector updates to ensure every entry has domains, families, and required CoreView mappings.
- **Offscreen debugging**
  - `offscreen.js` only runs when `background.js` spins up the offscreen document. Inspect it via `chrome://inspect/#service-workers` if you need to verify tile normalization.
- **Localization/themes**
  - Themes are stored under `chrome.storage.sync` when possible; bookmarks/help fall back to `chrome.storage.local`. Update `_locales` when adding user-facing strings.

## Testing & quality checks
- **Manual scenarios**
  - Image mode: run `Scan`, `Canvas`, module triggers, overlay cleanup (preview → apply → undo), filters, conversions, download vs. ZIP, rename serial.
  - Manga mode: run connector detection, list chapters for each loader (runner vs. manager), download chapters with ComicInfo/XML toggles, test manual chapter add, and bookmark flows.
  - Bookmarks surface: refresh, open series, fetch recent updates (verify accessible vs. locked chapters), remove entries.
  - Help page: ensure the theme switch reflects instantly and all anchor links work.
- **Automated/Scripted**
  - `node scripts/hk-smoke.js` – ensures connector metadata is complete.
  - Optional CI hooks can re-use the smoke script plus linting (if you add ESLint) before packaging the extension.
- **Site-specific regression guides**
  - Use the `YANMAGA_*.md` files and `PHASE_TRACKER.md` for checklists when touching speedbinb/CoreView/GigaViewer behavior.

## Adding connectors & viewer modules
1. **Define the connector**
   - Update `vendor/hakuneko/index.json` with the new connector id, domains, family, runner path, and, if applicable, delegate metadata.
   - For page-injected delegates (speedbinb/gigaviewer/madara/etc.), add or update modules under `sites/` and their registry entry in `adapters/hakuneko/registry.js`.
2. **Expose in the UI**
   - If the site warrants its own trigger, add a button under the “Module scan” block in `panel.html` and wire it up in `panel.js`.
   - Extend `src/hk-connectors.js` if you need alias mapping between delegate/native IDs.
3. **Whitelist & security**
   - Update `integrations/hakuneko/allowlist.json` if the connector needs explicit approval for manager-side execution.
4. **Verify**
   - Reload the extension, run `node scripts/hk-smoke.js`, and test both loader modes. Use the diagnostics actions plus service-worker logs to confirm downloads succeed.

## Troubleshooting
- **Chrome keeps asking for permissions** – Disable “Ask every scan” if you prefer to grant per-site access once. Otherwise expect a prompt before each scan to respect privacy defaults.
- **Overlay cleanup did nothing** – Verify preview counts, lower the `Surface coverage threshold`, or add custom keywords (comma-separated). Use “Undo” to revert aggressive removals.
- **Manga fetch stuck on “Detecting…”** – Check the loader selector. If Auto picks the wrong mode repeatedly, force Runner or Manager from settings and retry with the inline “Retry with runner” link.
- **Chapters fail behind paywalls** – Use “Copy login cookie” in viewer tools and ensure the bookmark drawer shows a recent `updatedAt` timestamp; cookies must be captured on HTTPS origins.
- **Blob downloads are empty** – Make sure `page_blob_patch.js` ran by re-triggering the scan; some sites revoke `blob:` URLs immediately, so scanning again forces the capture bridge to reinstall.
- **Offscreen errors** – Inspect the service worker logs for `OFFSCREEN` messages; if the offscreen document fails, click “Retry” or reload the extension to reinitialize the canvas environment.

## Reference docs & support
- Built-in help page (`help.html`) → open from the `?` button in the panel header.
- Repository docs:
  - `PHASE_TRACKER.md` – HK runner/manager hardening roadmap and current status.
  - `YANMAGA_*.md` – investigation logs, diagnosis plans, and regression notes for the Yanmaga/SpeedBinB family.
- Contact/tip links: use the `Contact us` and `Tip` anchors in the panel header to reach the maintainers or support the project.

Happy downloading! Contributions, bug reports, and connector ideas are always welcome.
