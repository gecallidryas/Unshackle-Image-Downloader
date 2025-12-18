# Network Capture & Image Blob Loading Analysis

This document provides a detailed technical analysis of how the Network Agent extension captures network traffic and loads/displays image blob bodies.

---

## Architecture Overview

The extension uses a **multi-layer architecture** for network capture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Browser                            │
├─────────────────────────────────────────────────────────────────┤
│  Chrome Debugger API  ──────►  background.js                    │
│  WebRequest API       ──────►       │                           │
│                                      ▼                           │
│                              capturedData Store                  │
│                                      │                           │
│                                      ▼                           │
│                               panel.js (UI)                      │
│                                      │                           │
│                                      ▼                           │
│                          User Display & Interaction              │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| Network Capture Engine | `background.js` | Chrome Debugger attachment, request/response interception |
| Domain Authorization | `src/network/domain-manager.js` | Domain allowlist management |
| Request Tracking | `src/network/network-tracker.js` | Alternative webRequest-based tracking |
| UI & Body Loading | `panel.js` | Table rendering, body fetching, image preview |
| Content Script | `contentScript.js` | Page interaction (non-network related) |

---

## 1. Network Capture Mechanism

### 1.1 Data Store Structure

The extension maintains an in-memory store for all captured network data:

```javascript
// background.js - Core data structure
const capturedData = {};

/**
 * capturedData structure:
 * {
 *   [tabId]: {
 *     capturing: boolean,
 *     entries: CapturedEntry[],
 *     requestMap: Map<requestId, CapturedEntry>,
 *     logs: []
 *   }
 * }
 */
```

The `ensureTab` function initializes this structure lazily:

```javascript
function ensureTab(tabId) {
  if (!capturedData[tabId]) {
    capturedData[tabId] = {
      capturing: false,
      entries: [],
      requestMap: new Map(),
      logs: []
    };
  }
  return capturedData[tabId];
}
```

> **NOTE:** The `requestMap` is a `Map` object used for O(1) lookups by `requestId`, while `entries` is an array for ordered iteration and display.

---

### 1.2 Starting Capture via Chrome Debugger API

Network capture is initiated by attaching the Chrome Debugger to a specific tab:

```javascript
// background.js - Starting capture
async function startCapture(tabId) {
  const tabData = ensureTab(tabId);
  if (tabData.capturing) return;

  try {
    // Attach debugger with CDP version 1.3
    await chrome.debugger.attach({ tabId }, "1.3");
    
    // Enable required CDP domains
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    
    tabData.capturing = true;
    console.log(`[Background] Attached debugger to tab ${tabId}`);
  } catch (err) {
    console.error(`[Background] Failed to attach to tab ${tabId}:`, err);
    throw err;
  }
}
```

> **IMPORTANT:** The debugger approach enables access to response bodies via `Network.getResponseBody`, which is **not possible** with the standard `webRequest` API alone.

---

### 1.3 Request Tracking via Debugger Events

The extension listens to Chrome Debugger Protocol (CDP) events to track request lifecycle:

```javascript
// background.js - Debugger event listener
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  const tabData = capturedData[tabId];
  if (!tabData || !tabData.capturing) return;

  if (method === "Network.requestWillBeSent") {
    // Request is about to be sent - capture initial data
    const domain = DomainManager.extractDomain(params.request.url);
    const postData = params.request.hasPostData ? params.request.postData : null;
    
    upsertRequest(tabId, params.requestId, {
      url: params.request.url,
      domain,
      method: params.request.method,
      resourceType: params.type,
      requestHeaders: params.request.headers,
      postData,
      startTime: params.timestamp * 1000  // Convert to milliseconds
    });
  } 
  else if (method === "Network.responseReceived") {
    // Response headers received - capture status and headers
    const entry = tabData.requestMap.get(params.requestId);
    if (entry) {
      entry.status = params.response.status;
      entry.statusText = params.response.statusText;
      entry.mimeType = params.response.mimeType;
      entry.responseHeaders = toHeaderObject(params.response.headers);
      tabData.requestMap.set(params.requestId, entry);
    }
  } 
  else if (method === "Network.loadingFinished") {
    // Request fully loaded - capture timing and size
    const entry = tabData.requestMap.get(params.requestId);
    if (entry) {
      entry.endTime = params.timestamp * 1000;
      entry.size = params.encodedDataLength;
      if (entry.startTime) {
        entry.totalTime = entry.endTime - entry.startTime;
      }
      tabData.requestMap.set(params.requestId, entry);
    }
  }
  // ... Log.entryAdded and Runtime.consoleAPICalled for console logs
});
```

#### Request Upsert Logic

The `upsertRequest` function merges updates into existing entries:

```javascript
function upsertRequest(tabId, requestId, updates) {
  const tab = ensureTab(tabId);
  const existing = tab.requestMap.get(requestId) || { requestId, tabId };
  const merged = { ...existing, ...updates };
  tab.requestMap.set(requestId, merged);

  // Sync to entries array
  const idx = tab.entries.findIndex(e => e.requestId === requestId);
  if (idx === -1) {
    tab.entries.push(merged);
  } else {
    tab.entries[idx] = merged;
  }
  return merged;
}
```

---

### 1.4 Supplementary WebRequest Tracking

The extension also uses the standard `webRequest` API for timing data:

```javascript
// background.js - WebRequest listeners for timing precision
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;  // Skip non-tab requests (e.g., service workers)
    
    const tab = ensureTab(tabId);
    if (!tab.capturing) return;
    
    const domain = DomainManager.extractDomain(details.url);
    upsertRequest(tabId, details.requestId, {
      url: details.url,
      domain,
      method: details.method,
      resourceType: details.type,
      startTime: details.timeStamp
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    // ... capture headerReceivedTime for TTFB calculation
    upsertRequest(tabId, details.requestId, {
      headerReceivedTime: details.timeStamp,
      responseHeaders: toHeaderObject(details.responseHeaders),
      status: details.statusCode || entry.status
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // Calculate performance metrics
    const updates = {
      endTime: details.timeStamp,
      status: details.statusCode || entry.status,
      responseSize: details.responseSize,
      fromCache: details.fromCache
    };
    
    // Time to First Byte (TTFB) calculation
    if (entry.headerReceivedTime && entry.startTime) {
      updates.ttfb = entry.headerReceivedTime - entry.startTime;
      updates.contentDownloadTime = updates.totalTime - updates.ttfb;
    }
    
    upsertRequest(tabId, details.requestId, updates);
  },
  { urls: ['<all_urls>'] }
);
```

> **TIP:** The combination of Debugger API and WebRequest API provides both **body access** (Debugger) and **precise timing metrics** (WebRequest).

---

## 2. Domain Authorization System

### 2.1 Domain Extraction

```javascript
// src/network/domain-manager.js
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    console.error('Error extracting domain:', e);
    return null;
  }
}
```

### 2.2 Authorization Check

The extension supports an allowlist model stored in Chrome sync storage:

```javascript
function isDomainAuthorized(domain) {
  return new Promise(resolve => {
    chrome.storage.sync.get(['authorizedDomains', 'headerDomainsList'], result => {
      const authorizedDomains = result.authorizedDomains || [];
      const headerDomains = result.headerDomainsList || [];
      const allDomains = [...new Set([...authorizedDomains, ...headerDomains])];
      
      // If no allowlist is configured, allow all domains
      if (allDomains.length === 0) return resolve(true);
      
      resolve(allDomains.includes(domain));
    });
  });
}
```

---

## 3. Image Blob Body Loading

This is the **core functionality** for loading and displaying captured image bodies.

### 3.1 Body Request Flow

```
┌──────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│ panel.js │───►│  api.get()  │───►│ background.js│───►│ Chrome Debugger │
│   (UI)   │    │             │    │              │    │      (CDP)      │
└──────────┘    └─────────────┘    └──────────────┘    └─────────────────┘
     ▲                                                          │
     │                                                          │
     │              { body, base64Encoded }                     │
     └──────────────────────────────────────────────────────────┘
```

**Sequence:**
1. UI requests body via `GET /v1/tabs/{tabId}/network-entries/{requestId}/body`
2. Background script sends `chrome.runtime.sendMessage`
3. Background calls CDP `Network.getResponseBody`
4. CDP returns `{ body, base64Encoded }`
5. Response flows back to UI
6. UI calls `renderBodyPreview()`

### 3.2 API Request Routing

The panel sends a REST-style message to the background script:

```javascript
// panel.js - Loading body for an entry
async function loadBody(entry) {
  const pre = document.getElementById('detail-preview');
  if (pre) pre.textContent = 'Loading...';
  
  // Send request via REST-style API
  const resp = await api.get(
    `/v1/tabs/${currentTabId}/network-entries/${entry.requestId}/body`
  );
  
  if (resp.error) {
    if (pre) pre.textContent = `Error: ${resp.error}`;
  } else {
    // Store body data on the entry object
    entry.bodyContent = resp.body;
    entry.base64Encoded = resp.base64Encoded;
    renderBodyPreview(entry);
  }
}
```

### 3.3 Background Script Body Retrieval

The background script uses CDP's `Network.getResponseBody` command:

```javascript
// background.js - Handling body request
async function handleRequest(req, sender) {
  const { method, path, body } = req;
  const tabId = body?.tabId || extractTabId(path);

  // Match: GET /v1/tabs/:tabId/network-entries/:requestId/body
  if (method === 'GET' && path.match(/^\/v1\/tabs\/\d+\/network-entries\/[^\/]+\/body$/)) {
    const parts = path.split('/');
    const reqId = parts[5];  // Extract requestId from path
    
    return new Promise((resolve) => {
      chrome.debugger.sendCommand(
        { tabId }, 
        "Network.getResponseBody", 
        { requestId: reqId }, 
        (result) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(result);  // { body: string, base64Encoded: boolean }
          }
        }
      );
    });
  }
  // ... other routes
}
```

> **WARNING:** `Network.getResponseBody` will fail if the request has been garbage collected or if the debugger was detached. Bodies are only available while the debugger remains attached.

---

### 3.4 MIME Type Detection from Bytes

For base64-encoded bodies, the extension detects the actual MIME type from magic bytes:

```javascript
// panel.js - MIME detection from file signature
function detectMimeFromBytes(base64) {
  if (!base64) return null;
  try {
    // Decode first 30 characters of base64
    const bin = atob(base64.substring(0, 30)); 
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    
    // Convert to hex for magic byte comparison
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    // Magic byte patterns for common image formats
    if (hex.startsWith('FFD8FF')) return 'image/jpeg';
    if (hex.startsWith('89504E470D0A1A0A')) return 'image/png';
    if (hex.startsWith('47494638')) return 'image/gif';
    if (hex.startsWith('424D')) return 'image/bmp'; 
    if (hex.startsWith('00000100')) return 'image/x-icon';
    if (hex.startsWith('25504446')) return 'application/pdf';
    if (hex.startsWith('52494646') && hex.substring(16, 24) === '57454250') return 'image/webp';
    
    return null;
  } catch (e) { return null; }
}
```

#### Magic Bytes Reference

| Format | Magic Bytes (Hex) | Description |
|--------|-------------------|-------------|
| JPEG | `FF D8 FF` | JPEG File Interchange Format |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | PNG signature |
| GIF | `47 49 46 38` | "GIF8" |
| BMP | `42 4D` | "BM" |
| ICO | `00 00 01 00` | Windows icon |
| PDF | `25 50 44 46` | "%PDF" |
| WebP | `52 49 46 46 ... 57 45 42 50` | RIFF container with "WEBP" |

---

### 3.5 Rendering Image Blobs

The preview container dynamically renders content based on MIME type:

```javascript
// panel.js - Body preview rendering
function renderBodyPreview(entry) {
  detailPreviewContainer.innerHTML = '';
  const pre = document.createElement('pre');
  pre.id = 'detail-preview';
  detailPreviewContainer.appendChild(pre);

  if (!entry.bodyContent) { 
    pre.textContent = '(Body not loaded)'; 
    return; 
  }
  
  // Detect real MIME if base64 encoded
  let realMime = entry.mimeType || '';
  if (entry.base64Encoded) {
    const detected = detectMimeFromBytes(entry.bodyContent);
    if (detected) realMime = detected;
  }
  
  // Handle image content specially
  if (realMime.startsWith('image/') && entry.base64Encoded) {
    const img = document.createElement('img');
    // Create data URI from base64 content
    img.src = `data:${realMime};base64,${entry.bodyContent}`;
    detailPreviewContainer.innerHTML = '';
    detailPreviewContainer.appendChild(img);
  } else {
    // Text content - decode if base64
    let content = entry.bodyContent;
    if (entry.base64Encoded) { 
      try { 
        content = atob(entry.bodyContent); 
      } catch(e) { 
        content = "(Binary)"; 
      } 
    }
    // Truncate large content
    pre.textContent = content.length > 50000 
      ? content.substring(0, 50000) + "..." 
      : content;
  }
}
```

---

### 3.6 Downloading Image Bodies

The download function handles both text and binary content:

```javascript
// panel.js - Body download with extension inference
async function downloadBody(entry) {
  // Load body if not already loaded
  if (!entry.bodyContent) await loadBody(entry);
  if (!entry.bodyContent) { 
    alert("Failed to load body for download"); 
    return; 
  }
  
  let mime = entry.mimeType || 'application/octet-stream';
  
  // Detect real MIME if base64
  if (entry.base64Encoded) {
    const detected = detectMimeFromBytes(entry.bodyContent);
    if (detected) mime = detected;
  }

  let blob;
  if (entry.base64Encoded) {
    try {
      // Decode base64 to binary
      const bin = atob(entry.bodyContent);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: mime });
    } catch(e) {
      console.error("Base64 decode error", e);
      alert("Error decoding file");
      return;
    }
  } else {
    blob = new Blob([entry.bodyContent], { type: mime });
  }
  
  // Generate filename from URL
  const url = URL.createObjectURL(blob);
  let filename = 'download';
  try { 
    const u = new URL(entry.url);
    let name = u.pathname.split('/').pop();
    if (!name) name = 'index';
    filename = name;
  } catch(e) {}

  // Add correct extension based on MIME
  const ext = getExtensionFromMime(mime);
  if (ext && !filename.toLowerCase().endsWith('.' + ext)) {
    filename += '.' + ext;
  }

  // Trigger download via Chrome Downloads API
  chrome.downloads.download({ url, filename, saveAs: false });
}
```

---

## 4. Legacy Message Mapping

The extension uses a REST-style internal API with backwards compatibility:

```javascript
// background.js - Legacy to REST mapping
function mapLegacyToRest(msg) {
  const tabId = msg.tabId;
  switch (msg.type) {
    case 'START_CAPTURE': 
      return { method: 'POST', path: '/v1/captures', body: { tabId } };
    case 'STOP_CAPTURE': 
      return { method: 'DELETE', path: `/v1/captures/${tabId}` };
    case 'GET_STATUS': 
      return { method: 'GET', path: `/v1/captures/${tabId}` };
    case 'GET_ENTRIES': 
      return { method: 'GET', path: `/v1/tabs/${tabId}/network-entries` };
    case 'GET_BODY': 
      return { 
        method: 'GET', 
        path: `/v1/tabs/${tabId}/network-entries/${msg.requestId}/body` 
      };
    // ... other mappings
  }
}
```

---

## 5. Complete Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CAPTURE PHASE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  User clicks "Start Capture"                                                │
│         │                                                                   │
│         ▼                                                                   │
│  chrome.debugger.attach() ──► Network.enable                                │
│         │                                                                   │
│         ▼                                                                   │
│  Events: requestWillBeSent ──► responseReceived ──► loadingFinished         │
│         │                                                                   │
│         ▼                                                                   │
│  Store in capturedData                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DISPLAY PHASE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  panel.js refreshData() (every 1 second)                                    │
│         │                                                                   │
│         ▼                                                                   │
│  GET /v1/tabs/:id/network-entries                                           │
│         │                                                                   │
│         ▼                                                                   │
│  renderTable() - shows all requests in table                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BODY LOADING PHASE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  User clicks table row ──► openDetails()                                    │
│         │                                                                   │
│         ▼                                                                   │
│  User clicks "Load Body"                                                    │
│         │                                                                   │
│         ▼                                                                   │
│  Network.getResponseBody via CDP                                            │
│         │                                                                   │
│         ▼                                                                   │
│  base64Encoded? ──► Yes ──► detectMimeFromBytes()                           │
│         │                         │                                         │
│         │                         ▼                                         │
│         │                   Is image? ──► Yes ──► Create data: URI img      │
│         │                         │                                         │
│         │                         ▼                                         │
│         │                        No ──► Decode and display text             │
│         │                                                                   │
│         ▼                                                                   │
│        No ──► Display as text                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DOWNLOAD PHASE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  User clicks "Download Body"                                                │
│         │                                                                   │
│         ▼                                                                   │
│  loadBody() if needed                                                       │
│         │                                                                   │
│         ▼                                                                   │
│  Create Blob from base64/text                                               │
│         │                                                                   │
│         ▼                                                                   │
│  chrome.downloads.download()                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Chrome Debugger API over webRequest | Only CDP provides access to response bodies |
| In-memory storage | Performance; bodies can be large |
| Base64 encoding detection | CDP returns binary as base64; need to decode for display |
| Magic byte MIME detection | Server-provided MIME types can be inaccurate |
| REST-style internal API | Clean separation of concerns, extensibility |

---

## 7. Potential Improvements

1. **Blob URL Support**: Current implementation fetches via CDP; could add fallback for `blob:` URLs using content script injection
2. **Streaming Large Bodies**: Bodies > 50KB are truncated; could implement chunked loading
3. **Cache Bodies**: Currently bodies are fetched on-demand; could cache for faster re-display
4. **IndexedDB Persistence**: In-memory store is lost on extension reload

---

## 8. File Reference

| File | Lines | Key Functions |
|------|-------|---------------|
| `background.js` | 572 | `startCapture()`, `upsertRequest()`, `handleRequest()` |
| `panel.js` | 1467 | `loadBody()`, `renderBodyPreview()`, `detectMimeFromBytes()`, `downloadBody()` |
| `src/network/domain-manager.js` | 145 | `extractDomain()`, `isDomainAuthorized()` |
| `src/network/network-tracker.js` | 188 | `initNetworkTracker()`, WebRequest listeners |
| `contentScript.js` | 85 | Page interaction helpers (non-network) |

---

*Document generated: December 2025*
