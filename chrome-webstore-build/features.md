# Chrome Web Store Safe Build Features

This file documents the feature set packaged under `chrome-webstore-build/`.

## 1. What this build is for

- Chrome Web Store-safe distribution focused on image extraction/downloading workflows.
- Keeps core image tooling, dedupe, overlays, network capture, and ZIP export.
- Applies policy-safe restrictions to manga-facing UX.

---

## 2. Included primary features

### 2.1 Image scanning and extraction
- DOM image scanning (`img`, `srcset`, `picture/source`).
- CSS/background image extraction including `image-set()` parsing.
- `data:` and `blob:` URL support.
- Canvas snapshots and SVG capture.
- Video-source exclusion in image scan paths.

### 2.2 Blob/page bridges
- `bridge_inject.js`, `page_blob_patch.js`, and `page_fetch_bridge.js` are packaged.
- Blob registry capture and hydration support remain available.
- Page-context fetch bridge remains available for protected resources.

### 2.3 Overlay cleanup
- Overlay preview, cleanup, keyword nuke, and undo.
- Keyword suggestions from packaged `overlay_keywords.md`.
- Right-click unlock action remains available.

### 2.4 Network capture
- Network capture toggle and network-only mode are included.
- Background uses webRequest + CDP debugger flow for capture.
- Per-tab captured-image cache, dedupe, batch byte fetch endpoints, TTL cleanup.

### 2.5 Deduplication
- Full L1/L2/L3 dedupe modules are bundled in `chrome-webstore-build/src/dedupe/`.
- IndexedDB-backed canonical/group/occurrence storage.
- Panel dedupe controls and scan lifecycle messaging remain active in image mode.

### 2.6 Download and ZIP
- Direct downloads and blob downloads remain available.
- ZIP export remains available.
- `zip.worker.js` is bundled in this build.
- Worker fallback to JSZip path remains in panel runtime.

### 2.7 Core UX
- Settings modal, onboarding modal, locale switching, theme switching, stats, footer diagnostics.
- Help page and bookmarks page files are packaged.

---

## 3. Chrome Web Store safety restrictions

### 3.1 Manga mode hard-disabled in UI behavior
- Manga enable toggle is forcibly prevented from enabling.
- Attempting to enable manga shows blocked modal:
- “Manga Mode Not Available”.
- Modal links users to the full GitHub version:
- `https://github.com/gecallidryas/Unshackle-Image-Downloader`
- Effective runtime state forces manga disabled (`hkMangaEnabled = false`) and mode fallback to image.

### 3.2 Viewer cookie-copy control removed
- “Copy login cookie” control is removed from safe panel UI.
- Safe panel shows viewer report block instead.

### 3.3 Packaged resource constraints
- `manifest.json` in safe build trims permissions versus full build.
- `web_accessible_resources` are reduced to core bridge/help/offscreen resources.
- HakuNeko runtime/vendor/delegate resource files are not packaged in `chrome-webstore-build/`.
- Result: image workflows are first-class; manga-facing runtime paths are intentionally not exposed as usable features in this distribution.

---

## 4. Manifest-level differences (safe build)

### 4.1 Permissions profile
- Safe build keeps:
- `debugger`, `sidePanel`, `scripting`, `tabs`, `webNavigation`, `storage`, `downloads`, `declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `webRequest`, `unlimitedStorage`, `contextMenus`, `windows`.
- Safe build omits full-build permissions such as:
- `offscreen`, `activeTab`, `cookies`, `alarms`, `notifications`, `downloads.open`.

### 4.2 Optional host permissions
- Safe build still uses optional host permissions including:
- `<all_urls>` and selected CDN patterns used by capture features.

---

## 5. Operational summary

- If you need image extraction + cleanup + network capture + dedupe + ZIP in a store-safe package, this build is intended for that.
- If you need active manga workflows/connectors/download stack, use the full version documented in the root project.
