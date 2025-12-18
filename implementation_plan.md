# Improve Network Scan and Image Extraction

The current network scan relies on `fetch()` within the service worker (`background.js`). This fails for:
1.  **Strict Anti-Hotlink Sites**: Servers checking `Referer` or `Origin` headers which are missing or incorrect in service worker fetches.
2.  **Blob URLs**: Service workers cannot fetch `blob:` URLs created in the page context.
3.  **Cookie-Gated Content**: While `credentials: 'include'` is used, some sites require specific context headers.

## User Review Required
> [!NOTE]
> This change introduces a "Page Context" fetch fallback. If the background script fails to download an image (due to anti-hotlink or cookies), it will ask the page itself to download it. This bypasses almost all standard protections.

> [!IMPORTANT]
> A critical bug was found: `blob:` URLs were being patched but ignored because `content.js` wasn't listening for them. This plan fixes that.

## Proposed Changes (IMPLEMENTED ✓)

### [Background Script]
#### [MODIFY] [background.js](file:///d:/unshackle final (7)/unshackle final (3)/unshackle final/background.js)
- ✓ Update `captureNetworkImage` function:
    - ✓ **Proactive Blob Check**: If URL starts with `blob:`, skip `fetch` and immediately delegate to Content Script.
    - ✓ **Aggressive Fallback**: Use `fetch()` with `credentials: 'include'`. If it fails (status != 200, or network error), delegate to Content Script.
    - ✓ **Delegation Handler**: Implemented `fetchImageViaContentScript(tabId, url)` which sends `HK_FETCH_IMAGE_IN_CONTEXT` to the tab.

### [Content Script]
#### [MODIFY] [content.js](file:///d:/unshackle%20final%20%287%29/unshackle%20final%20%283%29/unshackle%20final/content.js)
- ✓ **Fix Blob Capture**: Added `window.addEventListener("message")` to listen for `__blobBridge` messages from `page_blob_patch.js` and populate `BLOB_REG`.
- ✓ **Context Fetch Listener**: Listening for `HK_FETCH_IMAGE_IN_CONTEXT`.
    - Uses page context `fetch()` with `credentials: "include"`.
    - Returns the buffer to the background script.

## Verification Plan

### Automated Tests
- None available for this specific interaction.

### Manual Verification
1.  **Blob Test**: Go to a site generating blob images (e.g., a meme generator or specific manga reader). Verify "Scan" captures them.
2.  **Protected Site Test**: Go to a site known for hotlink protection (e.g., specific image hosts, Instagram). Verify "Scan" captures the images.
3.  **General Regression**: Ensure normal images still capture correctly without duplicate overhead.
