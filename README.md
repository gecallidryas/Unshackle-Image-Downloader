# Unshackle Image Downloader

A Manifest V3 browser extension for collecting, cleaning, and exporting images from the active tab, with optional manga workflows powered by complex reader modules and embedded HakuNeko runtime integrations.

This README documents the current architecture in this repository, including detection internals, loader behavior, extension install flow, and known placeholders.

## Table of Contents
- [What It Does](#what-it-does)
- [Core Concepts](#core-concepts)
- [Architecture](#architecture)
- [Detection Pipeline](#detection-pipeline)
- [Manga Mode Architecture](#manga-mode-architecture)
- [Viewer Modules and Site Adapters](#viewer-modules-and-site-adapters)
- [Placeholders and Future Scaffolding](#placeholders-and-future-scaffolding)
- [Feature Overview](#feature-overview)
- [Install (Unpacked Extension)](#install-unpacked-extension)
- [Usage](#usage)
- [Site-Specific Guide](#site-specific-guide)
- [Configuration and Data Storage](#configuration-and-data-storage)
- [Development and Debugging](#development-and-debugging)
- [Repository Map](#repository-map)
- [Privacy and Security Notes](#privacy-and-security-notes)
- [Troubleshooting](#troubleshooting)

## What It Does
Unshackle has two primary workflows:

1. Image workflow
- Scan visible and referenced assets from a page (`img`, CSS backgrounds, SVG, canvas, blob/data URLs, selected module outputs).
- Filter, sort, deduplicate, rename, and export as individual files or ZIP.
- Remove or soften anti-user overlays.
- Optionally capture image bytes from network responses (CDP + fallback path).

2. Manga workflow
- Detect connector/family context for supported hosts.
- Fetch chapters/pages through HakuNeko-compatible runner or in-page delegate modules.
- Download chapters with optional `ComicInfo.xml` and EPUB artifacts(beta)
- Save and manage bookmarks in extension storage.

## Core Concepts
There are two different "mode" systems in this project.

1. UI mode (`image` / `manga`)
- Stored in `chrome.storage.local` under `hk.mode`.
- Managed by `modes/manager.js`.
- Controls which panel workflow is currently visible and active.

2. Manga loader mode (`auto` / `runner` / `manager`)
- Stored under `settings.manga.loader`.
- Evaluated in `background.js` per request.
- Controls *how* manga data is fetched:
  - `runner`: offscreen HakuNeko runtime path.
  - `manager`: injected in-page delegate module path.
  - `auto`: chooses best path and falls back when needed.

## Architecture
### Runtime Topology

```text
panel.html/panel.js
        |
        | chrome.runtime.sendMessage
        v
background.js (service worker)
        |
        | tab messaging / script injection
        v
content.js + bridge_inject.js + page bridges
```

### Main Components
1. `manifest.json`
- MV3 manifest with side panel support.
- Background service worker: `background.js`.
- Content scripts:
  - `bridge_inject.js` at `document_start`.
  - `content.js` at `document_idle`.
- Web-accessible resources include bridges, site modules, HK integration files, and docs pages.

2. `panel.html` + `panel.js`
- Main UX surface for image and manga workflows.
- Hosts scan controls, filtering, overlay cleanup, dedupe actions, module probing, manga chapter operations, and settings.

3. `background.js`
- Central message router and orchestrator.
- Handles:
  - downloads and ZIP assembly,
  - network capture and CDP attach/detach lifecycle,
  - HK request routing (`HK_RUN`, `HK_RUN_EXEC`, delegate calls),
  - offscreen lifecycle,
  - dedupe pipeline module loading and message handling.

4. `content.js`
- Image detection and extraction engine.
- Overlay candidate detection + cleanup operations.
- Auto-scan, mutation-driven rescans, and page-side fallbacks.
- Blob/SVG/canvas hydration helpers and transfer endpoints.

5. Bridge scripts
- `bridge_inject.js` + `page_blob_patch.js`: page-world blob/canvas/fetch hooks.
- `page_fetch_bridge.js`: page-context credentialed fetch relay.

6. HK integration stack
- `integrations/hakuneko/*.mjs`: request, storage, download, IPC adapters.
- `vendor/hakuneko/*` and `hakuneko-runtime/*`: embedded engine/runtime code.
- `hk-proxy.js`: panel/bookmarks-facing proxy client.

7. Site module system
- `sites/site-registry.js`: module registry.
- `adapters/hakuneko/delegates.js`: generic delegate call surface.
- `adapters/hakuneko/registry.js`: connector -> module mapping bridge.

## Detection Pipeline
### 1) DOM and Attribute Extraction
From `content.js` scan paths:
- `<img src>`
- `srcset` and `picture/source` entries
- `data-src` / `data-srcset` fallbacks where applicable
- `srcset` entries are quality-sorted (larger width/density first)
- known video assets are skipped by extension/mime heuristics

### 2) CSS Image Extraction
Parses CSS image-bearing properties including:
- `background*`, `mask*`, `border-image*`, `list-style-image`, `content`
- `image-set()` and `-webkit-image-set()`

Performance protections:
- hard scan caps (`MAX_BG_SCAN_NODES`, result caps)
- cooperative yielding in long traversals

### 3) Instagram-Specific Hardened Detection
Special collectors target embedded Instagram patterns:
- host allowlist matching (`fbcdn.net`, `cdninstagram.com` with strict domain logic)
- wrapper selectors such as `._aagu` / `._aagv`
- `src` + `data-src` + `srcset` + `data-srcset`
- HTML-escaped URL normalization before parsing

### 4) Canvas, SVG, Blob, Data URL Handling
- Canvas snapshots are captured into PNG blobs and represented with stable names (`Canvas_XX`).
- Inline SVG can be serialized and tracked via object URL lifecycle control.
- Blob URLs are hydrated through in-memory registry + serialization endpoints.
- `collectAllVisualAssets` aggregates broad page visual assets for deep capture scenarios.

### 5) Incremental and Dynamic Rescans
- Concurrent scan mode emits progress (`SCAN_PROGRESS`) back to panel.
- MutationObserver-based dynamic rescans track image-relevant DOM changes.
- Auto-scan can run by scroll distance or debounce interval.

### 6) Optional Network Capture Layer
Background capture path supports:
- CDP (`chrome.debugger` + response body retrieval)
- fallback webRequest capture path

Additional protections:
- cache-buster normalization
- hash dedupe and size guards
- mime validation/sniffing
- tab lifecycle cleanup and stale request pruning

### 7) Dedupe Pipeline (L1/L2/L3)
From `src/dedupe/*`:
- L1: byte-level exact hash (`SHA-256`)
- L2: canonical pixel hash with orientation normalization
- L3: perceptual hash candidate search + SSIM confirmation

Storage:
- IndexedDB-backed canonical and group data (`src/dedupe/db.js`)

Execution:
- multi-queue async pipeline with retry/timeout/cancel semantics (`src/dedupe/queue.js`, `src/dedupe/pipeline.js`)

## Manga Mode Architecture
### High-Level Flow
1. Panel requests detection/list/pages through `hk-proxy.js`.
2. Background (`background.js`) canonicalizes connector and checks allowlist entry.
3. Loader decision is made:
- user preference (`runner`/`manager`/`auto`)
- manager capability for selected connector
- host-level remembered loader history (TTL cache)
4. Request runs via selected path; fallback path is attempted when allowed.
5. Result metadata includes loader/fallback context.

### Loader Paths
1. Runner path
- Goes through offscreen runtime and HK adapters.
- Uses `integrations/hakuneko/Bootstrap.mjs` + adapters.
- `RequestAdapter` can use page bridge when same-origin tab context is required.

2. Manager path
- Injects delegate files into active tab main world.
- Calls module methods (`listChapters`, `listPages`, etc.) via `HKDelegates`.
- Used only for manager-capable module families in `HK_MANAGER_MODULES`.

### Family and Connector Resolution
Sources used in routing:
- `integrations/hakuneko/allowlist.json`
- `src/hk-connectors.js` canonical alias metadata
- panel host overrides and family heuristics
- runtime host history memory (runner vs manager outcome)

### Why Auto Exists
`auto` is designed to reduce manual loader switching:
- prefers manager on manager-capable tabs when conditions match
- falls back to runner on delegate failure
- may retry manager when runner fails and manager is possible

## Viewer Modules and Site Adapters
### Active injection set (current wiring)
Loaded by panel/background delegate injection lists:
- `sites/gigaviewer/module.js`
- `sites/speedbinb/module.js`
- `sites/bellaciao/module.js`
- `sites/madara/module.js`
- `sites/mangastream/module.js`
- `sites/foolslide/module.js`

### Roles
1. `gigaviewer`
- CoreView/GigaViewer JSON extraction and tile/descramble handling.

2. `speedbinb`
- BINB viewer handling and page reconstruction flow.

3. `bellaciao`
- Ciao/Pocket style API extraction and tile descrambling.

4. `madara` / `mangastream` / `foolslide`
- Generic family extractors for chapter and page lists.

## Placeholders and Future Scaffolding
This repository intentionally keeps some non-active scaffolding for future work.

1. Placeholder/unused code blocks
- Some code paths and UI scaffolding are retained for upcoming connector or workflow expansion.
- These are intentionally kept in-tree to reduce churn during future integration phases.

2. Lezhin module status (important)
- `sites/lezhin/module.js` exists and contains substantial logic.
- But it is **not currently wired into the active delegate injection/resource lists** used by the main runtime paths.
- In practical terms for this build branch, treat Lezhin integration as **placeholder/in-progress** until wiring is completed end-to-end.

## Feature Overview
### UI Surfaces
- `panel.html` + `panel.js`: primary image+manga workflows
- `bookmarks.html` + `bookmarks.js`: manga bookmark management
- `help.html` + `help.js`: packaged help surface

### Image Tooling
- DOM/CSS/canvas/blob/SVG extraction
- network capture mode
- overlay preview/remove/undo and keyword nuking
- filtering, sorting, selection helpers
- download and ZIP export
- auto dedupe and manual dedupe actions

### Manga Tooling
- connector detection
- chapter listing
- chapter download with optional metadata artifacts
- bookmark save/update/remove
- loader selection and fallback diagnostics

### Localization and Themes
- `_locales/*` runtime strings
- panel/help/bookmarks theme synchronization

## Install (Unpacked Extension)
### Requirements
- Chromium/Chrome with MV3 support.
- Recommended: Chrome 120+ for side panel and offscreen-document behavior parity.

### Steps
1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository root (`unshackle-final`).
5. Pin the extension icon.
6. Open the panel from the extension action (popup or side panel, depending on settings).

### Optional
- Run smoke validation script for connector metadata:

```bash
node scripts/hk-smoke.js
```

## Usage
### Image workflow
1. Open target page.
2. Click `Scan` in Image mode.
3. Optional: run `Canvas` or module scan tools.
4. Filter/sort/select results.
5. Use `Download` or `ZIP`.
6. Optional: remove overlays and rerun scan.

### Manga workflow
1. Enable manga mode in settings.
2. Choose loader mode (`auto` recommended initially).
3. Detect connector from URL.
4. List chapters.
5. Select/download chapters.
6. Save series bookmark if needed.

## Site-Specific Guide
### Global tips
- Load pages first before scanning.
- If there are more than ~30 canvas pages, turn on canvas scan and scroll from the top.

### Gigaviewer family sites
All sites below are Gigaviewer/CoreView-like:
- Use their site-specific module first.
- For multi-chapter failures, run detection again and choose `coreview` from dropdown.
- For single chapter pages, module download is usually the most stable route.

Sites:
- `comic-action.com`
- `comic-days.com`
- `comic-earthstar.com`
- `comic-gardo.com`
- `comic-ogyaaa.com`
- `comic-seasons.com`
- `comic-trail.com`
- `comic-zenon.com`
- `comicborder.com`
- `feelweb.jp`
- `ichicomi.com`
- `kuragebunch.com`
- `magcomi.com`
- `ourfeel.jp`
- `shonenjumpplus.com`
- `tonarinoyj.jp`
- `viewer.heros-web.com`
- `www.sunday-webry.com`

### SpeedBinb family sites
Use SpeedBinb workflows from manga mode (module and connector-aware flows by site).

- `gaugau.futabanet.jp`: extremely tricky. Use connector flow on title page only. Do not expand chapter list. Do not use `delegate.speedbinb`.
- `kirapo.jp`: per-chapter SpeedBinb module download only; multi-chapter is not available.
- `michikusacomics.jp`: per-chapter SpeedBinb module download only; multi-chapter is not available.
- `123hon.com`: SpeedBinb module download or connector multi-chapter flow from title page.
- `yanmanga.com`: extremely tricky. Connector flow works on title page, but hidden chapters may need manual add:
  search page source for `mod-episode-link`, copy chapter link, and add manually.

### CiaoPlus viewer sites
Viewer code is nearly the same. Use Bellaciao module.

- `ciao.shogakukan.co.jp`
- `pocket.shonenmagazine.com`

### Works with load/scroll methods (module still needs improvement)
- `comic-walker.com`: load and click canvas (safe up to ~50 pages), or auto-canvas + scroll.
- `youngchampion.jp`: auto-canvas + scroll/load and click canvas (not recommended, unstable).
- `kimicomi` / `comic-valkyrie` / `comic-brise.com`: load and click canvas (safe up to ~50 pages), or auto-canvas + scroll.
- `kansai.mag-garden.co.jp`: virtualized canvases. Start from top and use auto-canvas + scroll.
- `flowercomics.jp`: normal scan.
- `comic-growl.com`: load and click canvas (safe for many pages), or auto-canvas + scroll.
- `zerosumonline.com`: auto-scan and slide.
- `www.comicride.jp`: virtualized canvases. Start from top and use auto-canvas + scroll.
- `firecross.jp`: load and click canvas (safe up to ~50 pages), or auto-canvas + scroll.
- `comic.pixiv.net`: auto-scan and slide.
- `takecomic.jp`: load and click canvas (safe for many pages), or auto-canvas + scroll.
- `ganganonline.com`: auto-scan. Uses virtualized images (not canvases), persistent image capture still needs improvement.
- `comics.manga-bang.com`: load and click canvas (safe for many pages), or auto-canvas + scroll.
- `ganma.jp`: normal scan; may double-scan.
- `comic-fuz.com`: normal scan. Uses basic blobs. Safe for load + scan/auto-scroll.
- `younganimal.com`: auto-canvas/canvas after loading.

## Configuration and Data Storage
### Settings defaults
Defined in `src/settings.js`:
- mode: `image`
- manga enabled: `false`
- manga loader: `auto`
- family defaults:
  - `speedbinb`: `true`
  - `coreview`: `true`
  - `madara`: `false`
  - `mangastream`: `false`
  - `foolslide`: `false`

### Storage
- `chrome.storage.local`: settings, bookmarks, runtime state
- `chrome.storage.sync`: selected UX prefs when available
- IndexedDB: dedupe canonical/group/scan data

## Development and Debugging
### Reload loop
1. Edit files.
2. Reload extension from `chrome://extensions`.
3. Re-test in target tab.

### Useful inspect targets
- service worker logs: extension details page -> service worker inspect
- panel logs: open panel DevTools
- page detection logs: tab DevTools where content scripts run

### HK debug toggle
- `settings.dev.hkDebug` via storage + runtime sync
- query-param/diagnostic paths in panel are also available

## Repository Map
- `manifest.json`: extension manifest
- `background.js`: service worker orchestration
- `content.js`: scan/overlay/dynamic detection engine
- `bridge_inject.js`, `page_blob_patch.js`, `page_fetch_bridge.js`: page bridges
- `panel.*`: main UI
- `bookmarks.*`, `help.*`: auxiliary UI surfaces
- `modes/manager.js`: UI mode state manager
- `src/settings.js`, `src/hk-connectors.js`, `src/hk-debug.js`: shared config/runtime helpers
- `src/dedupe/*`: dedupe DB + pipeline
- `sites/*`: viewer/site modules
- `adapters/hakuneko/*`: delegate/module bridges
- `integrations/hakuneko/*`: runner adapters
- `vendor/hakuneko/*`, `hakuneko-runtime/*`: embedded upstream runtime assets
- `chrome-webstore-build/`: web-store-oriented packaged variant

## Privacy and Security Notes
- Runtime host access is permission-based (`optional_host_permissions`).
- Cookie handling is local and request-scoped for connector/runtime needs.
- No mandatory remote telemetry transport in core extension flow.
- Network and page-bridge features intentionally use stricter route checks and guardrails to reduce misuse.

## Troubleshooting
1. Scan returns too few images
- Enable canvas/module scans.
- Try network capture mode.
- Rerun after overlay cleanup.

2. Manga request fails in `auto`
- Retry with explicit `runner`, then explicit `manager` to isolate path issues.

3. Blob-backed images fail to download
- Rescan to refresh blob registry and bridge capture state.

4. Module scan says unsupported
- Confirm host permissions were granted.
- Confirm active module is part of currently injected set.

5. Lezhin expectations
- This branch keeps Lezhin as placeholder/integration-in-progress despite module file presence.

---
If you are contributing, keep `features.md` and `updates.md` synchronized with behavior and documentation changes.
