if (typeof importScripts === "function") {
  const toURL = (path) => (chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : path);
  try {
    importScripts(
      toURL("src/settings.js"),
      toURL("src/hk-debug.js"),
      toURL("src/hk-connectors.js"),
      toURL("vendor/hakuneko/engine/ComicInfoGenerator.js"),
      toURL("vendor/hakuneko/engine/EbookGenerator.js")
    );
  } catch (error) {
    console.error("[HK] Failed to import background dependencies:", error);
  }
}

if (typeof UnshackleSettings !== "undefined") {
  UnshackleSettings.ensureDefaults()
    .then((settings) => {
      if (typeof UnshackleHKDebug !== "undefined") {
        UnshackleHKDebug.syncFromSettings(settings);
        UnshackleHKDebug.group("Settings initialized", () => {
          UnshackleHKDebug.log("Resolved defaults", settings);
        });
      }
    })
    .catch((error) => {
      const message = error?.message || JSON.stringify(error) || String(error);
      console.error("[HK] Failed to initialize settings defaults:", message, error);
    });
}

// background.js v3.0.0
const BRIDGE_SCRIPT_ID = "unshackle-bridge";
const CORE_CONTENT_SCRIPT_ID = "unshackle-core-content";
const CONTEXT_MENU_ID = "enable-right-click";
const DOWNLOAD_URL_CACHE = new Map(); // downloadId -> objectUrl
const OFFSCREEN_DOC_URL = chrome.runtime.getURL("offscreen.html");
const OFFSCREEN_REASONS = ["DOM_PARSER", "BLOBS", "IFRAME_SCRIPTING"];
const OFFSCREEN_JUSTIFICATION = "Normalize manga canvases and parse connectors in a hidden context.";
const OFFSCREEN_READY_TIMEOUT_MS = 8000;
const OFFSCREEN_READY_RESTART_DELAY_MS = 350;
const HK_PROXY_REQUEST = "HK_RUN";
const HK_RUNNER_COMMAND = "HK_RUN_EXEC";
const HK_DELEGATE_CALL = "HK_DELEGATE_CALL";
const HK_DOWNLOAD_REQUEST = "HK:DOWNLOAD";
const HK_DOWNLOAD_CANCEL = "HK:CANCEL";
const HK_DELEGATE_FILES = [
  "sites/site-registry.js",
  "sites/gigaviewer/module.js",
  "sites/speedbinb/module.js",
  "sites/bellaciao/module.js",
  "sites/madara/module.js",
  "sites/mangastream/module.js",
  "sites/foolslide/module.js",
  "adapters/hakuneko/delegates.js",
  "adapters/hakuneko/registry.js"
];
const HK_DELEGATE_INJECTED = new Map();
const HK_ALLOWLIST_PATH = "integrations/hakuneko/allowlist.json";
const HK_MANAGER_MODULES = new Set(["speedbinb", "gigaviewer", "bellaciao", "madara", "mangastream", "foolslide"]);
const CORE_CONTENT_SCRIPT_DEF = {
  id: CORE_CONTENT_SCRIPT_ID,
  js: ["content.js"],
  matches: ["<all_urls>"],
  runAt: "document_idle",
  allFrames: true,
  persistAcrossSessions: true
};
const HK_LOADER_CACHE_TTL = 60000;
const HK_LOADER_HISTORY_KEY = "__hk_loader_history";
const HK_LOADER_HISTORY_TTL = 12 * 60 * 60 * 1000;
const HK_LOADER_HISTORY_LIMIT = 200;
const HK_DELEGATE_POLL_TIMEOUT_MS = 3500;
const HK_DELEGATE_POLL_INTERVAL_MS = 75;
const RUNTIME_MESSAGE_TIMEOUT_MS = 15000;
const OFFSCREEN_RELEASE_DELAY = 60000;
const DOWNLOAD_MAX_CONCURRENT_FETCHES = 4;
const DOWNLOAD_MAX_FETCH_RETRIES = 3;
const DOWNLOAD_RETRY_BASE_DELAY_MS = 350;
const DOWNLOAD_REQUEST_TIMEOUT_MS = 20000;
const HK_DOWNLOAD_JOBS = new Map();
const canonicalizeConnectorId = typeof globalThis.canonicalHKConnectorId === "function"
  ? (value) => globalThis.canonicalHKConnectorId(value)
  : (value) => (typeof value === "string" ? value : "");
const getConnectorMeta = typeof globalThis.getHKConnectorMeta === "function"
  ? (value) => globalThis.getHKConnectorMeta(value)
  : () => null;

function normalizeHKFamilyKey(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function resolveConnectorFamily(connectorId, allowEntry = null) {
  const entryFamily = allowEntry?.family;
  if (entryFamily) {
    return normalizeHKFamilyKey(entryFamily);
  }
  const meta = getConnectorMeta(canonicalizeConnectorId(connectorId));
  if (meta?.family) {
    return normalizeHKFamilyKey(meta.family);
  }
  return "";
}

function attachHKMetadata(result, connectorId, allowEntry = null) {
  if (!result || !result.data || typeof result.data !== "object") {
    return result;
  }
  if (!result.data.connectorId && connectorId) {
    result.data.connectorId = connectorId;
  }
  const family = normalizeHKFamilyKey(result.data.family)
    || resolveConnectorFamily(connectorId, allowEntry);
  if (family) {
    result.data.family = family;
  }
  return result;
}

const getPreferredConnectorId = typeof globalThis.getPreferredHKConnectorId === "function"
  ? (value, preference) => globalThis.getPreferredHKConnectorId(value, preference)
  : (value) => canonicalizeConnectorId(value);
const HK_STORAGE_OP = "HK_STORAGE_OP";
const HK_SETTINGS_REQUEST = "HK_GET_SETTINGS";
const HK_SETTINGS_UPDATED_EVENT = "HK_SETTINGS_UPDATED";
let offscreenReleaseTimer = null;
let offscreenReady = false;
const offscreenReadyWaiters = [];
let hkAllowListCache = null;
let hkLoaderPreferenceCache = { value: "auto", expires: 0 };
let hkLoaderHistoryCache = { value: {}, expires: 0 };
const INSTAGRAM_APP_ID = "936619743392459";
const INSTAGRAM_PROFILE_TTL_MS = 5 * 60 * 1000;
const INSTAGRAM_PROFILE_CACHE = new Map();
const INSTAGRAM_IMAGE_CACHE = new Map();
const INSTAGRAM_IMAGE_TTL_MS = 5 * 60 * 1000;

// ==================== NETWORK IMAGE CAPTURE ====================
const NETWORK_CAPTURE_KEY = "networkCaptureEnabled";
const NETWORK_CAPTURED_IMAGES = new Map(); // tabId -> Map<hash, imageData>
const NETWORK_CAPTURE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const NETWORK_CAPTURE_MAX_SIZE = 10 * 1024 * 1024; // 10MB max per image
const NETWORK_CAPTURE_ALLOWED_TYPES = ["image", "xmlhttprequest", "media", "other", "font", "stylesheet", "object"];
const CORP_STRIP_RULE_ID_BASE = 9000;
let networkCaptureEnabled = false;

// CDP (Chrome DevTools Protocol) constants - must be defined early for hoisting
const CDP_ATTACHED_TABS = new Map(); // tabId -> { attached: boolean }
const CDP_PENDING_REQUESTS = new Map(); // tabId -> Map<requestId, requestInfo>
const CDP_ATTACH_COOLDOWNS = new Map(); // tabId -> timestamp (throttle retries)
const CDP_IMAGE_MIME_PATTERN = /^image\//i;

// Deduplication lock to prevent race conditions between CDP and webRequest capture
const PENDING_CAPTURES = new Set(); // normalizedUrl -> being processed

// CDN patterns that need CORP header stripping
const CDN_CORP_PATTERNS = [
  { id: CORP_STRIP_RULE_ID_BASE + 1, pattern: "*://*.fbcdn.net/*" },
  { id: CORP_STRIP_RULE_ID_BASE + 2, pattern: "*://*.cdninstagram.com/*" }
];

// Initialize CORP stripping rules
async function initializeCORPStrippingRules() {
  try {
    const rules = CDN_CORP_PATTERNS.map((item) => ({
      id: item.id,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "Cross-Origin-Resource-Policy", operation: "remove" },
          { header: "Cross-Origin-Embedder-Policy", operation: "remove" }
        ]
      },
      condition: {
        urlFilter: item.pattern,
        resourceTypes: ["image", "media"]
      }
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: CDN_CORP_PATTERNS.map((p) => p.id),
      addRules: rules
    });
    console.log("[Network] CORP stripping rules installed for CDN domains");
  } catch (error) {
    console.warn("[Network] Failed to install CORP stripping rules:", error);
  }
}

// Hash first N bytes of buffer for deduplication
async function hashImageBuffer(buffer, maxBytes = 8192) {
  try {
    const slice = buffer.slice(0, Math.min(buffer.byteLength, maxBytes));
    if (crypto?.subtle?.digest) {
      const digest = await crypto.subtle.digest("SHA-1", slice);
      return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
    }
    // Fallback: simple hash
    const view = new Uint8Array(slice);
    let hash = 0;
    for (let i = 0; i < view.length; i++) {
      hash = (hash * 31 + view[i]) >>> 0;
    }
    return hash.toString(16);
  } catch {
    return null;
  }
}

// Normalize URL for deduplication
function normalizeImageUrl(url) {
  try {
    const parsed = new URL(url);
    // Remove common cache-busting params
    const stripParams = ["_nc_ht", "_nc_cat", "_nc_ohc", "_nc_oc", "_nc_gid", "ccb", "oh", "oe", "_nc_sid", "edm", "efg", "stp"];
    for (const param of stripParams) {
      parsed.searchParams.delete(param);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function guessMimeFromUrl(url = "") {
  const lowered = url.toLowerCase();
  if (lowered.endsWith(".svg") || lowered.includes("image/svg")) return "image/svg+xml";
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  if (lowered.endsWith(".avif")) return "image/avif";
  if (lowered.endsWith(".bmp")) return "image/bmp";
  if (lowered.endsWith(".ico") || lowered.endsWith(".cur")) return "image/x-icon";
  return "";
}

function isImageContentType(contentType = "", url = "") {
  if (!contentType && url.startsWith("data:image/")) return true;
  if (/^image\//i.test(contentType)) return true;
  if (/svg\+xml/i.test(contentType)) return true;
  if (!contentType) {
    const guessed = guessMimeFromUrl(url);
    return !!guessed;
  }
  return false;
}

function sniffImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return "";
  const view = bytes;
  const head = view.slice(0, Math.min(view.length, 16));
  const startsWith = (...sig) => sig.every((v, i) => head[i] === v);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  if (startsWith(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (startsWith(0x42, 0x4d)) return "image/bmp";
  if (startsWith(0, 0, 2, 0)) return "image/tiff";
  // SVG sniff: look for "<svg"
  try {
    const text = new TextDecoder("utf-8").decode(head);
    if (/<svg[\s>]/i.test(text)) return "image/svg+xml";
  } catch { }
  return "";
}

function decodeDataUrl(url) {
  try {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
    if (!match) return null;
    const mime = match[1] || "application/octet-stream";
    const isBase64 = !!match[2];
    const dataPart = match[3] || "";
    const raw = isBase64 ? atob(dataPart) : decodeURIComponent(dataPart);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    return { bytes, mime };
  } catch {
    return null;
  }
}

function isAllowedCaptureType(requestType = "") {
  return NETWORK_CAPTURE_ALLOWED_TYPES.includes(requestType);
}

// Get network capture setting
async function getNetworkCaptureEnabled() {
  try {
    const result = await chrome.storage.local.get({ [NETWORK_CAPTURE_KEY]: false });
    return Boolean(result[NETWORK_CAPTURE_KEY]);
  } catch {
    return false;
  }
}

// Set network capture setting (with CDP attach/detach)
async function setNetworkCaptureEnabled(enabled, tabId = null) {
  const wasEnabled = networkCaptureEnabled;
  networkCaptureEnabled = Boolean(enabled);
  await chrome.storage.local.set({ [NETWORK_CAPTURE_KEY]: networkCaptureEnabled });
  console.log("[Network] Capture", networkCaptureEnabled ? "ENABLED" : "DISABLED", "tabId:", tabId);

  // CDP integration: attach/detach debugger based on state change
  if (networkCaptureEnabled && !wasEnabled) {
    // Attaching CDP when enabled
    if (tabId && tabId > 0) {
      console.log(`[CDP] Attaching debugger to tab ${tabId}...`);
      try {
        const attached = await attachDebuggerToTab(tabId);
        console.log(`[CDP] Attach result for tab ${tabId}:`, attached);
      } catch (err) {
        console.warn(`[CDP] Failed to attach on enable:`, err);
      }
    } else {
      console.warn("[CDP] No valid tabId provided for debugger attachment");
    }
  } else if (!networkCaptureEnabled && wasEnabled) {
    // Detach CDP from all tabs when disabled
    console.log("[Network] Detaching CDP debugger from all tabs, count:", CDP_ATTACHED_TABS.size);
    for (const [tid] of CDP_ATTACHED_TABS) {
      await detachDebuggerFromTab(tid).catch(() => { });
    }
  }
}

// Notify panel of new captured image
function notifyPanelNewCapture(tabId, imageData) {
  try {
    chrome.runtime.sendMessage({
      type: "NETWORK_IMAGE_CAPTURED",
      tabId,
      image: {
        hash: imageData.hash,
        url: imageData.url,
        normalizedUrl: imageData.normalizedUrl,
        mime: imageData.mime,
        size: imageData.size,
        width: imageData.width || 0,
        height: imageData.height || 0,
        capturedAt: imageData.capturedAt
      }
    }).catch(() => { });
  } catch { }
}

// Capture image from completed request (fallback when CDP not attached)
async function captureNetworkImage(details) {
  if (!networkCaptureEnabled) return;
  if (!isAllowedCaptureType(details.type)) return;
  if (!details.tabId || details.tabId < 0) return;

  // Skip if CDP is attached to this tab - CDP provides more reliable capture
  if (CDP_ATTACHED_TABS.has(details.tabId)) return;

  const { tabId, url } = details;
  const normalizedUrl = normalizeImageUrl(url);

  // Deduplication lock to prevent race conditions
  if (PENDING_CAPTURES.has(normalizedUrl)) return;
  PENDING_CAPTURES.add(normalizedUrl);

  try {
    // Check if already captured by URL
    const tabCache = NETWORK_CAPTURED_IMAGES.get(tabId) || new Map();
    for (const cached of tabCache.values()) {
      if (cached.normalizedUrl === normalizedUrl) return;
    }

    let bytes = null;
    let contentType = "";

    if (url.startsWith("data:image/")) {
      const decoded = decodeDataUrl(url);
      if (!decoded) return;
      bytes = decoded.bytes;
      contentType = decoded.mime;
    } else if (url.startsWith("blob:")) {
      // Blob URLs: MUST be fetched from content script (same origin context)
      const result = await fetchImageViaContentScript(tabId, url);
      if (!result || !result.ok || !result.data) return;
      bytes = new Uint8Array(result.data);
      contentType = result.mime || "";
    } else {
      // Try background fetch first
      let fetchFailed = false;
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          fetchFailed = true;
        } else {
          contentType = response.headers.get("content-type") || "";
          const buffer = await response.arrayBuffer();
          bytes = new Uint8Array(buffer);
        }
      } catch (err) {
        fetchFailed = true;
      }

      // AGGRESSIVE FALLBACK: If background fetch failed, try via content script
      if (fetchFailed || !bytes || !bytes.length) {
        const result = await fetchImageViaContentScript(tabId, url);
        if (result && result.ok && result.data) {
          bytes = new Uint8Array(result.data);
          contentType = result.mime || "";
        }
      }

      // If the server didn't label as image, sniff the bytes to see if it is one (common for blob responses)
      if (bytes && bytes.length && !isImageContentType(contentType, url)) {
        const sniffed = sniffImageMime(bytes);
        if (!sniffed) return;
        contentType = sniffed;
      }
    }

    if (!bytes || !bytes.length) return;
    if (bytes.byteLength > NETWORK_CAPTURE_MAX_SIZE) return;
    if (bytes.byteLength < 10) return; // allow favicons but still skip empty

    const hash = await hashImageBuffer(bytes);
    if (!hash) return;

    // Check if already captured by hash
    if (tabCache.has(hash)) return;

    const imageData = {
      hash,
      url,
      normalizedUrl,
      bytes,
      mime: (contentType || guessMimeFromUrl(url) || "image/unknown").split(";")[0].trim(),
      size: bytes.byteLength,
      capturedAt: Date.now()
    };

    tabCache.set(hash, imageData);
    NETWORK_CAPTURED_IMAGES.set(tabId, tabCache);

    // Notify panel
    notifyPanelNewCapture(tabId, imageData);

  } catch (error) {
    // Silent fail - image may not be accessible
  } finally {
    PENDING_CAPTURES.delete(normalizedUrl);
  }
}

// Fetch image via content script (page context) - aggressive fallback with retry
async function fetchImageViaContentScript(tabId, url, retries = 2) {
  if (!tabId || tabId < 0 || !url) return null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const results = await chrome.tabs.sendMessage(tabId, {
        action: "HK_FETCH_IMAGE_IN_CONTEXT",
        url: url
      });
      if (results?.ok) return results;
      // If not ok, try again after delay
    } catch (err) {
      // Content script may not be ready yet
    }

    if (attempt < retries) {
      // Wait with exponential backoff (150ms, 300ms)
      await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
      // Re-inject bridge script in case it wasn't loaded
      try {
        await ensurePageBridge(tabId);
      } catch { }
    }
  }

  return null;
}

// Get captured images for a tab
function getCapturedImagesForTab(tabId) {
  const tabCache = NETWORK_CAPTURED_IMAGES.get(tabId);
  if (!tabCache) return [];

  const now = Date.now();
  const result = [];
  for (const [hash, data] of tabCache.entries()) {
    if (now - data.capturedAt > NETWORK_CAPTURE_TTL_MS) {
      tabCache.delete(hash);
      continue;
    }
    result.push({
      hash: data.hash,
      url: data.url,
      normalizedUrl: data.normalizedUrl,
      mime: data.mime,
      size: data.size,
      capturedAt: data.capturedAt
    });
  }
  return result;
}

// Get image bytes by hash (and touch TTL to extend lifetime)
function getCapturedImageBytes(tabId, hash) {
  const tabCache = NETWORK_CAPTURED_IMAGES.get(tabId);
  if (!tabCache) return null;
  const data = tabCache.get(hash);
  if (!data) return null;
  // Touch TTL - extend lifetime when accessed
  data.capturedAt = Date.now();
  return { bytes: data.bytes, mime: data.mime };
}

// Clear captured images for a tab
function clearCapturedImages(tabId) {
  NETWORK_CAPTURED_IMAGES.delete(tabId);
}

// Setup network capture listener
function setupNetworkCaptureListener() {
  if (typeof chrome?.webRequest?.onCompleted?.addListener !== "function") {
    console.warn("[Network] webRequest API not available");
    return;
  }

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      captureNetworkImage(details).catch(() => { });
    },
    { urls: ["<all_urls>"], types: NETWORK_CAPTURE_ALLOWED_TYPES }
  );
  console.log("[Network] Image capture listener installed");
}

// Initialize network capture on startup
(async function initNetworkCapture() {
  networkCaptureEnabled = await getNetworkCaptureEnabled();
  await initializeCORPStrippingRules();
  setupNetworkCaptureListener();
})();

// Clean up captured images when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  clearCapturedImages(tabId);
  detachDebuggerFromTab(tabId).catch(() => { });
});

// ==================== CDP DEBUGGER CAPTURE ====================
// Using Chrome DevTools Protocol for guaranteed response body access
// NOTE: CDP_ATTACHED_TABS, CDP_PENDING_REQUESTS, CDP_IMAGE_MIME_PATTERN are declared at top of network section
const CDP_ALLOWED_MIMES = ["image/", "application/octet-stream"];

// Check if URL is likely an image
function cdpIsImageUrl(url) {
  if (!url) return false;
  const lowered = url.toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|cur)($|\?)/i.test(lowered);
}

// Check if MIME is image-like
function cdpIsImageMime(mimeType) {
  if (!mimeType) return false;
  return CDP_IMAGE_MIME_PATTERN.test(mimeType) || mimeType.includes("svg");
}

// Attach debugger to tab
async function attachDebuggerToTab(tabId) {
  if (!tabId || tabId < 0) return false;

  // Check cooldown to prevent retry spam on restricted tabs (e.g. chrome://)
  if (CDP_ATTACH_COOLDOWNS.has(tabId)) {
    if (Date.now() < CDP_ATTACH_COOLDOWNS.get(tabId)) return false;
    CDP_ATTACH_COOLDOWNS.delete(tabId);
  }

  const existing = CDP_ATTACHED_TABS.get(tabId);
  if (existing?.attached) return true;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
      maxTotalBufferSize: 100 * 1024 * 1024, // 100MB buffer
      maxResourceBufferSize: 10 * 1024 * 1024 // 10MB per resource
    });

    CDP_ATTACHED_TABS.set(tabId, { attached: true });
    CDP_PENDING_REQUESTS.set(tabId, new Map());

    console.log(`[CDP] Attached debugger to tab ${tabId}`);
    return true;
  } catch (err) {
    console.warn(`[CDP] Failed to attach to tab ${tabId}:`, err);
    // Set 10s cooldown on failure
    CDP_ATTACH_COOLDOWNS.set(tabId, Date.now() + 10000);
    return false;
  }
}

// Detach debugger from tab
async function detachDebuggerFromTab(tabId) {
  if (!tabId || tabId < 0) return;

  const state = CDP_ATTACHED_TABS.get(tabId);
  if (!state?.attached) return;

  try {
    await chrome.debugger.detach({ tabId });
    console.log(`[CDP] Detached debugger from tab ${tabId}`);
  } catch (err) {
    // Tab may already be closed
  } finally {
    CDP_ATTACHED_TABS.delete(tabId);
    CDP_PENDING_REQUESTS.delete(tabId);
  }
}

// Get response body via CDP
async function getResponseBodyViaCDP(tabId, requestId) {
  if (!tabId || tabId < 0 || !requestId) return null;

  const state = CDP_ATTACHED_TABS.get(tabId);
  if (!state?.attached) return null;

  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Network.getResponseBody",
      { requestId }
    );

    if (!result) return null;

    let bytes;
    if (result.base64Encoded) {
      const binary = atob(result.body);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
    } else {
      // Text body (e.g., SVG)
      bytes = new TextEncoder().encode(result.body);
    }

    return bytes;
  } catch (err) {
    // Body may not be available (e.g., cached, or still loading)
    return null;
  }
}

// Process CDP response and capture if image
async function processCDPResponse(tabId, requestId, url, mimeType) {
  if (!networkCaptureEnabled) return;
  if (!tabId || tabId < 0) return;

  // Skip non-image responses
  const isImage = cdpIsImageMime(mimeType) || cdpIsImageUrl(url);
  if (!isImage) return;

  const normalizedUrl = normalizeImageUrl(url);

  // Deduplication lock to prevent race conditions
  if (PENDING_CAPTURES.has(normalizedUrl)) return;
  PENDING_CAPTURES.add(normalizedUrl);

  try {
    // Check if already captured
    const tabCache = NETWORK_CAPTURED_IMAGES.get(tabId) || new Map();
    for (const cached of tabCache.values()) {
      if (cached.normalizedUrl === normalizedUrl) return;
    }

    // Get response body via CDP
    const bytes = await getResponseBodyViaCDP(tabId, requestId);
    if (!bytes || !bytes.length) return;
    if (bytes.byteLength > NETWORK_CAPTURE_MAX_SIZE) return;
    if (bytes.byteLength < 10) return;

    // Sniff MIME if needed
    let mime = mimeType;
    if (!cdpIsImageMime(mime)) {
      const sniffed = sniffImageMime(bytes);
      if (!sniffed) return;
      mime = sniffed;
    }

    const hash = await hashImageBuffer(bytes);
    if (!hash) return;

    // Check if already captured by hash
    if (tabCache.has(hash)) return;

    const imageData = {
      hash,
      url,
      normalizedUrl,
      bytes,
      mime: (mime || "image/unknown").split(";")[0].trim(),
      size: bytes.byteLength,
      capturedAt: Date.now(),
      source: "cdp" // Mark as CDP-captured
    };

    tabCache.set(hash, imageData);
    NETWORK_CAPTURED_IMAGES.set(tabId, tabCache);

    // Notify panel
    notifyPanelNewCapture(tabId, imageData);
    console.log(`[CDP] Captured: ${url.substring(0, 80)}...`);

  } catch (err) {
    // Silent fail
  } finally {
    PENDING_CAPTURES.delete(normalizedUrl);
  }
}

// CDP Event Handler
function setupCDPEventListener() {
  if (!chrome.debugger?.onEvent) {
    console.warn("[CDP] Debugger API not available");
    return;
  }

  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (!networkCaptureEnabled) return;

    const tabId = source?.tabId;
    if (!tabId || tabId < 0) return;

    const pendingMap = CDP_PENDING_REQUESTS.get(tabId);
    if (!pendingMap) return;

    if (method === "Network.responseReceived") {
      const { requestId, response } = params;
      if (!requestId || !response) return;

      // Store request info for when loading finishes
      pendingMap.set(requestId, {
        url: response.url,
        mimeType: response.mimeType,
        status: response.status,
        headers: response.headers,
        timestamp: Date.now() // For cleanup of stale entries
      });
    }

    if (method === "Network.loadingFinished") {
      const { requestId } = params;
      if (!requestId) return;

      const info = pendingMap.get(requestId);
      if (info) {
        pendingMap.delete(requestId);

        // Only capture successful responses
        if (info.status >= 200 && info.status < 400) {
          processCDPResponse(tabId, requestId, info.url, info.mimeType).catch(() => { });
        }
      }
    }

    if (method === "Network.loadingFailed") {
      const { requestId } = params;
      if (requestId) pendingMap.delete(requestId);
    }
  });

  // Handle debugger detachment
  chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source?.tabId;
    if (tabId) {
      CDP_ATTACHED_TABS.delete(tabId);
      CDP_PENDING_REQUESTS.delete(tabId);
      console.log(`[CDP] Debugger detached from tab ${tabId}: ${reason}`);
    }
  });

  console.log("[CDP] Event listener installed");
}

// Initialize CDP listener
setupCDPEventListener();

// Re-enable Network domain after navigation (fixes bug where CDP stops working after page nav)
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!networkCaptureEnabled) return;
  if (details.frameId !== 0) return; // Only main frame

  const tabId = details.tabId;
  if (!tabId || tabId < 0) return;

  // Clear any attach cooldown so we try again on new page
  CDP_ATTACH_COOLDOWNS.delete(tabId);

  const state = CDP_ATTACHED_TABS.get(tabId);
  if (state?.attached) {
    try {
      // Re-enable Network domain after navigation
      await chrome.debugger.sendCommand({ tabId }, "Network.enable", {
        maxTotalBufferSize: 100 * 1024 * 1024,
        maxResourceBufferSize: 10 * 1024 * 1024
      });
      // Clear pending requests and stale captures for this tab on navigation
      CDP_PENDING_REQUESTS.set(tabId, new Map());
      clearCapturedImages(tabId); // Clear stale captures from previous page
      console.log(`[CDP] Re-enabled Network domain for tab ${tabId} after navigation`);
    } catch (err) {
      // Debugger was likely forcibly detached (e.g., navigated to chrome:// page)
      console.log(`[CDP] Re-attaching debugger for tab ${tabId} after navigation`);
      CDP_ATTACHED_TABS.delete(tabId);
      CDP_PENDING_REQUESTS.delete(tabId);
      // Try to re-attach
      await attachDebuggerToTab(tabId).catch(() => { });
    }
  } else if (networkCaptureEnabled) {
    // Capture is enabled but debugger not attached - try to attach
    await attachDebuggerToTab(tabId).catch(() => { });
  }
});

// Attach debugger to new tabs when capture is enabled
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!networkCaptureEnabled) return;
  if (!tab.id || tab.id < 0) return;

  // Delay slightly to let tab initialize
  setTimeout(async () => {
    try {
      await attachDebuggerToTab(tab.id);
    } catch { }
  }, 500);
});

// Cleanup CDP pendingMap periodically (fixes memory leak from cancelled requests)
setInterval(() => {
  const now = Date.now();
  for (const [tabId, pendingMap] of CDP_PENDING_REQUESTS) {
    for (const [reqId, info] of pendingMap) {
      // Remove entries older than 60 seconds
      if (info.timestamp && now - info.timestamp > 60000) {
        pendingMap.delete(reqId);
      }
    }
  }
}, 30000); // Run every 30 seconds

// ==================== END CDP DEBUGGER CAPTURE ====================

// ==================== END NETWORK IMAGE CAPTURE ====================

function crc32TableInit() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32TableInit();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) {
    c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const ZIP_TEXT_ENCODER = new TextEncoder();

function le16(n) {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function le32(n) {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function dosDateTime(d = new Date()) {
  const year = d.getFullYear();
  const encodedYear = year < 1980 ? 0 : year - 1980;
  const date = (encodedYear << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function normalizeZipEntry(entry) {
  if (!entry || typeof entry.name !== "string") {
    throw new Error("Invalid ZIP entry");
  }
  const name = entry.name.replace(/\\/g, "/");
  const source = entry.bytes ?? entry.buffer ?? entry.data ?? entry.payload;
  if (!source) {
    throw new Error("Missing ZIP entry payload");
  }
  let bytes;
  if (source instanceof Uint8Array) {
    bytes = source;
  } else if (Array.isArray(source)) {
    bytes = Uint8Array.from(source);
  } else if (source instanceof ArrayBuffer) {
    bytes = new Uint8Array(source);
  } else if (ArrayBuffer.isView(source)) {
    const view = source;
    bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  } else {
    throw new Error("Unsupported ZIP payload");
  }
  return { name, bytes };
}

class DelegatesUnavailableError extends Error {
  constructor(message) {
    super(message || "HK delegates unavailable in page context.");
    this.name = "DelegatesUnavailableError";
    this.code = "HK_DELEGATES_UNAVAILABLE";
  }
}

function createLocalFileHeader(nameBytes, dataBytes, date, time, crc) {
  const size = dataBytes.length;
  const header = new Uint8Array(30 + nameBytes.length);
  let cursor = 0;
  header.set(le32(0x04034b50), cursor); cursor += 4;
  header.set(le16(20), cursor); cursor += 2;
  // General purpose bit flag: set UTF-8 (bit 11) so names are interpreted correctly
  header.set(le16(0x0800), cursor); cursor += 2;
  header.set(le16(0), cursor); cursor += 2; // Compression method (store)
  header.set(le16(time), cursor); cursor += 2;
  header.set(le16(date), cursor); cursor += 2;
  header.set(le32(crc), cursor); cursor += 4;
  header.set(le32(size), cursor); cursor += 4;
  header.set(le32(size), cursor); cursor += 4;
  header.set(le16(nameBytes.length), cursor); cursor += 2;
  header.set(le16(0), cursor); cursor += 2; // Extra field length
  header.set(nameBytes, cursor);
  return header;
}

function createCentralDirectoryHeader(nameBytes, dataBytes, date, time, offset, crc) {
  const size = dataBytes.length;
  const header = new Uint8Array(46 + nameBytes.length);
  let cursor = 0;
  header.set(le32(0x02014b50), cursor); cursor += 4;
  header.set(le16(20), cursor); cursor += 2;
  header.set(le16(20), cursor); cursor += 2;
  header.set(le16(0x0800), cursor); cursor += 2; // Bit 11 = UTF-8 filenames
  header.set(le16(0), cursor); cursor += 2;
  header.set(le16(time), cursor); cursor += 2;
  header.set(le16(date), cursor); cursor += 2;
  header.set(le32(crc), cursor); cursor += 4;
  header.set(le32(size), cursor); cursor += 4;
  header.set(le32(size), cursor); cursor += 4;
  header.set(le16(nameBytes.length), cursor); cursor += 2;
  header.set(le16(0), cursor); cursor += 2;
  header.set(le16(0), cursor); cursor += 2;
  header.set(le16(0), cursor); cursor += 2;
  header.set(le16(0), cursor); cursor += 2;
  header.set(le32(0), cursor); cursor += 4;
  header.set(le32(offset), cursor); cursor += 4;
  header.set(nameBytes, cursor);
  return header;
}

function createEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const eocd = new Uint8Array(22);
  let cursor = 0;
  eocd.set(le32(0x06054b50), cursor); cursor += 4;
  eocd.set(le16(0), cursor); cursor += 2;
  eocd.set(le16(0), cursor); cursor += 2;
  eocd.set(le16(entryCount), cursor); cursor += 2;
  eocd.set(le16(entryCount), cursor); cursor += 2;
  eocd.set(le32(centralSize), cursor); cursor += 4;
  eocd.set(le32(centralOffset), cursor); cursor += 4;
  eocd.set(le16(0), cursor);
  return eocd;
}

class ZipStreamBuilder {
  constructor() {
    const { date, time } = dosDateTime(new Date());
    this.date = date;
    this.time = time;
    this.locals = [];
    this.centrals = [];
    this.offset = 0;
    this.count = 0;
    this.finalized = false;
    this.__zipBuilder = true;
  }

  appendEntry(entry) {
    if (this.finalized) {
      throw new Error("ZIP stream already finalized.");
    }
    const normalized = normalizeZipEntry(entry);
    const nameBytes = ZIP_TEXT_ENCODER.encode(normalized.name);
    const dataBytes = normalized.bytes;
    const crc = crc32(dataBytes);
    const localHeader = createLocalFileHeader(nameBytes, dataBytes, this.date, this.time, crc);
    const centralHeader = createCentralDirectoryHeader(nameBytes, dataBytes, this.date, this.time, this.offset, crc);
    this.locals.push(localHeader, dataBytes);
    this.centrals.push(centralHeader);
    this.offset += localHeader.length + dataBytes.length;
    this.count += 1;
  }

  appendTextEntry(name, text) {
    this.appendEntry({
      name,
      bytes: ZIP_TEXT_ENCODER.encode(String(text ?? ""))
    });
  }

  finalize() {
    if (this.finalized) {
      throw new Error("ZIP stream already finalized.");
    }
    const localSize = this.locals.reduce((sum, part) => sum + part.length, 0);
    const centralSize = this.centrals.reduce((sum, part) => sum + part.length, 0);
    const eocd = createEndOfCentralDirectory(this.count, centralSize, this.offset);
    const totalSize = localSize + centralSize + eocd.length;
    const result = new Uint8Array(totalSize);
    let cursor = 0;
    for (const part of this.locals) {
      result.set(part, cursor);
      cursor += part.length;
    }
    for (const part of this.centrals) {
      result.set(part, cursor);
      cursor += part.length;
    }
    result.set(eocd, cursor);
    this.finalized = true;
    this.locals = [];
    this.centrals = [];
    return result;
  }
}

function isZipStreamBuilder(target) {
  return Boolean(target && target.__zipBuilder && typeof target.appendEntry === "function");
}

function appendZipEntry(target, entry) {
  if (isZipStreamBuilder(target)) {
    target.appendEntry(entry);
  } else if (Array.isArray(target)) {
    target.push(entry);
  }
}

function buildZipStore(entries = []) {
  const builder = new ZipStreamBuilder();
  for (const entry of entries) {
    builder.appendEntry(entry);
  }
  return builder.finalize();
}

function normalizeHKLoaderMode(value) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "runner" || normalized === "manager" || normalized === "auto") {
      return normalized;
    }
  }
  return "auto";
}

async function loadHKAllowListEntries(force = false) {
  if (hkAllowListCache && !force) {
    return hkAllowListCache;
  }
  try {
    const response = await fetch(chrome.runtime.getURL(HK_ALLOWLIST_PATH));
    const data = await response.json();
    hkAllowListCache = Array.isArray(data)
      ? data.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }
        const canonicalId = canonicalizeConnectorId(entry.id);
        return canonicalId && canonicalId !== entry.id
          ? { ...entry, canonicalId }
          : { ...entry, canonicalId };
      })
      : [];
  } catch (error) {
    console.warn("[HK] Unable to load allow-list", error);
    hkAllowListCache = [];
  }
  return hkAllowListCache;
}

async function findHKAllowListEntry(connectorId) {
  const canonicalId = canonicalizeConnectorId(connectorId);
  if (!canonicalId) return null;
  const entries = await loadHKAllowListEntries();
  let entry = entries.find((item) => item?.id === canonicalId || item?.canonicalId === canonicalId) || null;
  if (entry) {
    return entry;
  }
  const meta = getHKConnectorMeta(canonicalId);
  if (meta?.delegateId) {
    entry = entries.find((item) => item?.id === meta.delegateId) || null;
  }
  return entry || null;
}

async function preferDelegateConnectorId(connectorId, host = "") {
  const canonicalId = canonicalizeConnectorId(connectorId);
  if (!canonicalId) return connectorId;
  const entry = await findHKAllowListEntry(canonicalId);
  if (!entry) {
    return connectorId;
  }
  const family = normalizeHKFamilyKey(entry.family || "");
  if (family !== "coreview" && family !== "gigaviewer") {
    return connectorId;
  }
  const entries = await loadHKAllowListEntries();
  const byFamily = entries.filter((item) => normalizeHKFamilyKey(item.family) === family);
  if (!byFamily.length) {
    return entry.id || connectorId;
  }
  if (host) {
    const match = byFamily.find((item) => Array.isArray(item.domains)
      && item.domains.some((domain) => {
        const normalized = String(domain || "").toLowerCase();
        return host === normalized || host.endsWith(`.${normalized}`);
      }));
    if (match?.id) {
      return match.id;
    }
  }
  return entry.id || connectorId;
}

function isManagerCapableEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return HK_MANAGER_MODULES.has(entry.module);
}

async function getStoredHKLoaderMode() {
  const now = Date.now();
  if (hkLoaderPreferenceCache.expires > now && hkLoaderPreferenceCache.value) {
    return hkLoaderPreferenceCache.value;
  }
  try {
    const settings = await readSettingsSnapshot();
    const loader = normalizeHKLoaderMode(settings?.manga?.loader);
    hkLoaderPreferenceCache = { value: loader, expires: now + HK_LOADER_CACHE_TTL };
    return loader;
  } catch (error) {
    console.warn("[HK] Unable to read loader preference", error);
    hkLoaderPreferenceCache = { value: "auto", expires: now + HK_LOADER_CACHE_TTL };
    return "auto";
  }
}

async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) {
    try {
      const exists = await chrome.offscreen.hasDocument();
      if (exists) {
        return true;
      }
    } catch (error) {
      console.warn("[HK] offscreen.hasDocument() failed", error);
    }
  }
  if (chrome.runtime?.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [OFFSCREEN_DOC_URL]
      });
      if (Array.isArray(contexts) && contexts.length > 0) {
        return true;
      }
    } catch (error) {
      console.warn("[HK] getContexts failed when checking offscreen document", error);
    }
  }
  const swClients = globalThis.clients;
  if (swClients?.matchAll) {
    try {
      const matches = await swClients.matchAll({ includeUncontrolled: true, type: "all" });
      if (Array.isArray(matches)) {
        return matches.some((client) => client?.url === OFFSCREEN_DOC_URL);
      }
    } catch (error) {
      console.warn("[HK] clients.matchAll failed when checking offscreen document", error);
    }
  }
  return false;
}

function settleOffscreenWaiters(ok, payload) {
  while (offscreenReadyWaiters.length) {
    const waiter = offscreenReadyWaiters.shift();
    if (!waiter) continue;
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
    try {
      if (ok) {
        waiter.resolve(true);
      } else {
        const err = payload instanceof Error ? payload : new Error(String(payload || "Offscreen runner unavailable."));
        waiter.reject(err);
      }
    } catch { }
  }
}

function markOffscreenReady() {
  offscreenReady = true;
  settleOffscreenWaiters(true);
}

function invalidateOffscreenReady(reason) {
  offscreenReady = false;
  if (reason) {
    settleOffscreenWaiters(false, reason);
  }
}

function waitForOffscreenReady(timeoutMs = OFFSCREEN_READY_TIMEOUT_MS) {
  if (offscreenReady) {
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
      timer: null
    };
    const cleanup = () => {
      if (waiter.timer) {
        clearTimeout(waiter.timer);
        waiter.timer = null;
      }
      const idx = offscreenReadyWaiters.indexOf(waiter);
      if (idx >= 0) {
        offscreenReadyWaiters.splice(idx, 1);
      }
    };
    waiter.timer = setTimeout(() => {
      cleanup();
      reject(new Error("Offscreen runner did not become ready in time."));
    }, Math.max(1000, timeoutMs || OFFSCREEN_READY_TIMEOUT_MS));
    offscreenReadyWaiters.push(waiter);
  });
}

async function createOffscreenDocument() {
  invalidateOffscreenReady();
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOC_URL,
    reasons: OFFSCREEN_REASONS,
    justification: OFFSCREEN_JUSTIFICATION
  });
}

async function recreateOffscreenDocument() {
  await closeOffscreenDocument();
  await wait(OFFSCREEN_READY_RESTART_DELAY_MS);
  await createOffscreenDocument();
}

async function ensureOffscreenDocument(options = {}) {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error("Offscreen unsupported. Ensure the 'offscreen' permission is declared in the manifest.");
  }
  if (!(await hasOffscreenDocument())) {
    await createOffscreenDocument();
  }
  bumpOffscreenKeepAlive();
  try {
    await waitForOffscreenReady();
  } catch (error) {
    if (options.retry === false) {
      throw error;
    }
    console.warn("[HK] Offscreen document was not ready. Restarting...", error);
    await recreateOffscreenDocument();
    await waitForOffscreenReady();
  }
}

async function processImageOffscreen(buffer, mimeType, metadata) {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error("Offscreen unsupported");
  }
  await ensureOffscreenDocument();
  bumpOffscreenKeepAlive();
  let cloned;
  if (buffer instanceof ArrayBuffer) {
    // Clone to avoid sharing detached buffers or extra backing data from callers.
    cloned = buffer.slice(0);
  } else if (ArrayBuffer.isView(buffer)) {
    const view = buffer;
    cloned = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  } else if (buffer) {
    cloned = buffer;
  } else {
    throw new Error("Missing image buffer");
  }
  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: "offscreenNormalize",
      buffer: cloned,
      mimeType,
      metadata
    }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve(resp);
    });
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Offscreen processing failed");
  }
  return response.data;
}

function bumpOffscreenKeepAlive() {
  if (offscreenReleaseTimer) {
    clearTimeout(offscreenReleaseTimer);
  }
  offscreenReleaseTimer = setTimeout(closeOffscreenDocument, OFFSCREEN_RELEASE_DELAY);
}

async function closeOffscreenDocument() {
  if (offscreenReleaseTimer) {
    clearTimeout(offscreenReleaseTimer);
    offscreenReleaseTimer = null;
  }
  if (!chrome.offscreen?.closeDocument) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch (error) {
    console.warn("[HK] Failed to close offscreen document", error);
  } finally {
    invalidateOffscreenReady(new Error("Offscreen document closed."));
  }
}

function getZipEntryCount(target) {
  if (isZipStreamBuilder(target)) {
    return target.count || 0;
  }
  if (Array.isArray(target)) {
    return target.length;
  }
  return 0;
}

function maybeAppendComicInfoEntry(target, meta) {
  if (!meta?.includeComicInfo) return;
  const info = meta.comicInfo || {};
  if (!globalThis.HKComicInfoGenerator || typeof HKComicInfoGenerator.createComicInfoXML !== "function") {
    return;
  }
  const pageCount = Number(info.pageCount) || getZipEntryCount(target) || 0;
  const xml = HKComicInfoGenerator.createComicInfoXML(
    info.seriesTitle || "",
    info.chapterTitle || "",
    pageCount
  );
  if (!xml) return;
  const prefix = info.pathPrefix ? `${String(info.pathPrefix).replace(/\\+/g, "/").replace(/\/$/, "")}/` : "";
  appendZipEntry(target, {
    name: `${prefix}ComicInfo.xml`,
    bytes: ZIP_TEXT_ENCODER.encode(xml)
  });
}

function normalizeManagerChapters(data) {
  const list = Array.isArray(data?.chapters)
    ? data.chapters
    : Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];
  return list.map((chapter, index) => {
    const source = chapter && typeof chapter === "object" ? chapter : {};
    const id = source.id || source.url || source.href || `chapter-${index + 1}`;
    const title = source.title || source.name || `Chapter ${index + 1}`;
    const url = coerceHttpUrl(source.url || source.href || (typeof id === "string" ? id : "")) || null;
    return {
      ...source,
      id,
      title,
      url
    };
  });
}

function coerceHttpUrl(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch { }
  return "";
}

function derivePageFilename(page, index) {
  if (typeof page?.filename === "string" && page.filename.trim()) {
    return page.filename.trim();
  }
  const extension = pickPageExtension(page?.url || page?.src || "", page?.mimeType || page?.type || "");
  return `Page_${String(index + 1).padStart(3, "0")}${extension}`;
}

function normalizeManagerPages(data) {
  const list = Array.isArray(data?.pages) ? data.pages : (Array.isArray(data) ? data : []);
  const normalized = [];
  list.forEach((page, index) => {
    const source = page && typeof page === "object" ? page : { url: page };
    const url = coerceHttpUrl(source.url || source.src || source.href || "");
    if (!url) {
      return;
    }
    const record = {
      index: Number.isFinite(source.index) ? source.index : normalized.length,
      url,
      filename: derivePageFilename({ ...source, url }, normalized.length),
      mimeType: source.mimeType || source.type || null,
      kind: source.kind || null,
      headers: cloneSerializableHeaders(source.headers),
      referer: typeof source.referer === "string" ? source.referer : null,
      timeout: Number(source.timeout) || null
    };
    normalized.push(record);
  });
  return normalized;
}

function buildRunnerFallbackWarning(error) {
  const raw = error?.message || String(error || "");
  if (/offscreen/i.test(raw) || /permission/i.test(raw)) {
    return "Runner offscreen context unavailable — using Manager fallback.";
  }
  if (raw) {
    return `Runner failed (${raw}). Using Manager fallback.`;
  }
  return "Runner failed. Using Manager fallback.";
}

function buildManagerFallbackWarning(error) {
  if (error?.code === "HK_DELEGATES_UNAVAILABLE") {
    return "Delegate harness unavailable — using Runner fallback.";
  }
  const raw = error?.message || String(error || "");
  if (/No chapters/i.test(raw) || /No pages/i.test(raw)) {
    return "Manager returned no results — using Runner fallback.";
  }
  if (raw) {
    return `Manager failed (${raw}). Using Runner fallback.`;
  }
  return "Manager failed. Using Runner fallback.";
}

class HKEpubBuilder {
  constructor({ title }) {
    if (!globalThis.HKEbookGenerator) {
      throw new Error("Ebook generator unavailable.");
    }
    this.generator = globalThis.HKEbookGenerator;
    this.builder = new ZipStreamBuilder();
    this.uid = (globalThis.crypto?.randomUUID?.() || `hk-epub-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    this.title = title || "Manga";
    this.pages = [];
    this.finalized = false;
    this.initializeStaticEntries();
  }

  initializeStaticEntries() {
    this.builder.appendEntry({
      name: "mimetype",
      bytes: ZIP_TEXT_ENCODER.encode(this.generator.createMimetype())
    });
    this.builder.appendEntry({
      name: "META-INF/container.xml",
      bytes: ZIP_TEXT_ENCODER.encode(this.generator.createContainerXML())
    });
    this.builder.appendEntry({
      name: "OEBPS/css/style.css",
      bytes: ZIP_TEXT_ENCODER.encode(this.generator.createStyleCSS())
    });
  }

  addPage({ index, name, bytes, mime }) {
    if (this.finalized) {
      throw new Error("EPUB already finalized.");
    }
    const safeIndex = Number(index) || 0;
    const ordinal = String(safeIndex + 1).padStart(3, "0");
    const extension = pickEpubExtension(name);
    const imgName = `page_${ordinal}${extension}`;
    const xhtmlName = `page_${ordinal}.xhtml`;
    this.builder.appendEntry({
      name: `OEBPS/img/${imgName}`,
      bytes
    });
    this.builder.appendEntry({
      name: `OEBPS/xhtml/${xhtmlName}`,
      bytes: ZIP_TEXT_ENCODER.encode(this.generator.createPageXHTML(imgName))
    });
    this.pages.push({
      img: imgName,
      mime: mime || "image/jpeg",
      xhtml: xhtmlName
    });
  }

  finalize() {
    if (this.finalized) {
      throw new Error("EPUB already finalized.");
    }
    const content = this.generator.createContentOPF(this.uid, this.title, this.pages);
    this.builder.appendEntry({
      name: "OEBPS/content.opf",
      bytes: ZIP_TEXT_ENCODER.encode(content)
    });
    const toc = this.generator.createTocNCX(this.uid, this.title, this.pages);
    this.builder.appendEntry({
      name: "OEBPS/toc.ncx",
      bytes: ZIP_TEXT_ENCODER.encode(toc)
    });
    this.finalized = true;
    return this.builder.finalize();
  }
}

function pickEpubExtension(name) {
  if (typeof name === "string" && name) {
    const match = name.match(/(\.[a-z0-9]{2,5})(?:$|\?)/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return ".jpg";
}

function sanitizeSegment(value, fallback) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_");
}

function pickPageExtension(urlString, mimeType) {
  if (mimeType) {
    const lowered = mimeType.toLowerCase();
    if (lowered.includes("png")) return ".png";
    if (lowered.includes("gif")) return ".gif";
    if (lowered.includes("webp")) return ".webp";
    if (lowered.includes("jpeg") || lowered.includes("jpg")) return ".jpg";
  }
  if (typeof urlString === "string" && urlString) {
    const match = urlString.match(/(\.[a-z0-9]{3,5})(?:$|\?)/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return ".jpg";
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}

function getOriginFromUrl(url) {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function getHostnameFromUrl(url) {
  if (typeof url !== "string" || !url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
}

function shouldRetryStatus(status) {
  const code = Number(status) || 0;
  return code === 429 || code === 502 || code === 503 || code === 504;
}

function getBackoffDelay(attempt) {
  return DOWNLOAD_RETRY_BASE_DELAY_MS * Math.max(1, attempt) + Math.random() * 150;
}

function createDownloadJobState(message) {
  const jobId = typeof message.jobId === "string" && message.jobId ? message.jobId : null;
  if (!jobId) {
    throw new Error("Download job is missing jobId.");
  }
  const title = typeof message.title === "string" && message.title ? message.title : "manga";
  const chapter = message.chapter && typeof message.chapter === "object" ? message.chapter : {};
  const pages = normalizeDownloadPages(message.pages);
  if (!pages.length) {
    throw new Error("Download job requires at least one page.");
  }
  const mangaName = sanitizeSegment(title, "manga");
  const chapterName = sanitizeSegment(chapter.title || chapter.name, "chapter");
  const options = message.options || {};
  const includeComicInfo = Boolean(options.includeComicInfo);
  const includeEpub = Boolean(options.includeEPUB);
  const context = message.context || {};
  const tabId = Number.isInteger(context.tabId) ? context.tabId : null;
  const connectorId = typeof context.connectorId === "string" && context.connectorId
    ? canonicalizeConnectorId(context.connectorId)
    : null;
  const family = normalizeHKFamilyKey(context.family || "");
  const origin = normalizeOrigin(context.origin || context.url || chapter.url || null);
  const referer = typeof context.referer === "string" && context.referer ? context.referer : origin;
  const cookies = context.cookies && typeof context.cookies === "object" ? context.cookies : null;
  const builder = new ZipStreamBuilder();
  let epubBuilder = null;
  if (includeEpub) {
    try {
      epubBuilder = new HKEpubBuilder({
        title: `${title} - ${chapter.title || chapterName || "chapter"}`
      });
    } catch (error) {
      console.warn("[HK] EPUB builder unavailable:", error);
      epubBuilder = null;
    }
  }
  return {
    id: jobId,
    title,
    chapter,
    mangaName,
    chapterName,
    includeComicInfo,
    includeEpub: Boolean(epubBuilder),
    builder,
    epubBuilder,
    pages,
    tabId,
    connectorId,
    family,
    origin,
    referer,
    cookies,
    sourceUrl: context.url || null,
    aborted: false,
    cancelled: false,
    abortReason: null,
    abortControllers: new Set(),
    totalPages: pages.length,
    comicInfoMeta: {
      includeComicInfo,
      comicInfo: {
        seriesTitle: title,
        chapterTitle: chapter.title || chapterName,
        pageCount: pages.length,
        pathPrefix: `${mangaName}/${chapterName}`
      }
    }
  };
}

async function loadHostLoaderHistory(force = false) {
  const now = Date.now();
  if (!force && hkLoaderHistoryCache.expires > now) {
    return hkLoaderHistoryCache.value || {};
  }
  try {
    const stored = await chrome.storage.local.get({ [HK_LOADER_HISTORY_KEY]: {} });
    const history = stored[HK_LOADER_HISTORY_KEY];
    hkLoaderHistoryCache = {
      value: history && typeof history === "object" ? { ...history } : {},
      expires: now + HK_LOADER_CACHE_TTL
    };
  } catch (error) {
    console.warn("[HK] Failed to load loader history", error);
    hkLoaderHistoryCache = { value: {}, expires: now + HK_LOADER_CACHE_TTL };
  }
  return hkLoaderHistoryCache.value;
}

async function persistHostLoaderHistory(history) {
  hkLoaderHistoryCache = { value: history, expires: Date.now() + HK_LOADER_CACHE_TTL };
  try {
    await chrome.storage.local.set({ [HK_LOADER_HISTORY_KEY]: history });
  } catch (error) {
    console.warn("[HK] Failed to persist loader history", error);
  }
}

function pruneHostLoaderHistory(history) {
  const now = Date.now();
  const entries = Object.entries(history || {}).filter(([_, value]) => {
    if (!value || typeof value !== "object") return false;
    const updatedAt = Number(value.updatedAt || value.timestamp || 0);
    if (!updatedAt) return false;
    return now - updatedAt <= HK_LOADER_HISTORY_TTL;
  });
  entries.sort((a, b) => {
    const aTime = Number(a[1]?.updatedAt || a[1]?.timestamp || 0);
    const bTime = Number(b[1]?.updatedAt || b[1]?.timestamp || 0);
    return aTime - bTime;
  });
  while (entries.length > HK_LOADER_HISTORY_LIMIT) {
    entries.shift();
  }
  return entries.reduce((acc, [host, value]) => {
    acc[host] = value;
    return acc;
  }, {});
}

async function getHostLoaderPreference(host) {
  if (!host) return null;
  const history = await loadHostLoaderHistory();
  const record = history[host];
  if (!record || typeof record !== "object") return null;
  const updatedAt = Number(record.updatedAt || record.timestamp || 0);
  if (!updatedAt || Date.now() - updatedAt > HK_LOADER_HISTORY_TTL) {
    delete history[host];
    await persistHostLoaderHistory(pruneHostLoaderHistory(history));
    return null;
  }
  const loader = normalizeHKLoaderMode(record.loader);
  return loader === "auto" ? null : loader;
}

async function rememberHostLoaderResult(host, loader) {
  if (!host) return;
  const normalized = loader === "runner" || loader === "manager" ? loader : null;
  if (!normalized) return;
  const history = await loadHostLoaderHistory();
  history[host] = {
    loader: normalized,
    updatedAt: Date.now()
  };
  await persistHostLoaderHistory(pruneHostLoaderHistory(history));
}

function resolvePayloadUrl(payload = {}) {
  if (typeof payload.url === "string" && payload.url) {
    return payload.url;
  }
  const candidates = [
    payload?.manga?.id,
    payload?.manga?.url,
    payload?.chapter?.id,
    payload?.chapter?.url,
    payload?.chapterId
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("http")) {
      return candidate;
    }
  }
  return "";
}

function normalizeDownloadPages(pages) {
  if (!Array.isArray(pages)) return [];
  const normalized = [];
  pages.forEach((page, index) => {
    if (typeof page === "string") {
      normalized.push({ index, url: page });
      return;
    }
    if (!page || typeof page !== "object") {
      return;
    }
    const url = typeof page.url === "string" ? page.url : (typeof page.href === "string" ? page.href : null);
    if (!url) {
      return;
    }
    normalized.push({
      index,
      url,
      referer: typeof page.referer === "string" ? page.referer : null,
      headers: cloneSerializableHeaders(page.headers),
      timeout: Number(page.timeout) || DOWNLOAD_REQUEST_TIMEOUT_MS,
      filename: typeof page.filename === "string" ? page.filename : null,
      useBridge: page.useBridge === true || page.bridge === true
    });
  });
  return normalized;
}

function cloneSerializableHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return null;
  }
  const entries = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) {
      entries[key] = String(value);
    }
  }
  return Object.keys(entries).length ? entries : null;
}

const PAGE_BRIDGE_ALLOWED_HOSTS = [
  /\.comici\.jp$/i,
  /\.futabanet\.jp$/i,
  /\.booklive\.jp$/i,
  /\.comic-action\.com$/i,
  /\.comic-earthstar\.jp$/i
];

function hostsShareSuffix(hostA, hostB) {
  if (!hostA || !hostB) return false;
  return hostA === hostB || hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`);
}

function shouldUsePageBridge(job, page) {
  if (!job?.tabId) return false;
  if (page && typeof page === "object" && (page.useBridge || page.bridge)) {
    return true;
  }
  const target = typeof page === "string" ? page : page?.url;
  if (!target) return false;
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  const host = (url.hostname || "").toLowerCase();
  if (!host) return false;
  const originHost = (job.origin && getHostnameFromUrl(job.origin))
    || (job.sourceUrl && getHostnameFromUrl(job.sourceUrl))
    || (job.referer && getHostnameFromUrl(job.referer))
    || null;
  if (originHost && hostsShareSuffix(host, originHost)) {
    return true;
  }
  return PAGE_BRIDGE_ALLOWED_HOSTS.some((pattern) => pattern.test(host));
}

function extractMimeFromHeaders(headers) {
  if (!headers) return "";
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!entry) continue;
      const [key, value] = entry;
      if (typeof key === "string" && key.toLowerCase() === "content-type") {
        return value || "";
      }
    }
    return "";
  }
  if (headers instanceof Headers) {
    return headers.get("content-type") || "";
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (key && key.toLowerCase() === "content-type") {
        return value || "";
      }
    }
  }
  return "";
}

function toTransferableBuffer(bytes) {
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  if (ArrayBuffer.isView(bytes)) {
    const view = bytes;
    if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
      return view.buffer;
    }
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return null;
}

function createCancellationError(message = "Download cancelled.") {
  const err = new Error(message);
  err.code = "HK_CANCELLED";
  return err;
}

function abortDownloadJob(job, reason, { cancelled = false } = {}) {
  if (!job) return;
  if (cancelled) {
    job.cancelled = true;
  }
  job.aborted = true;
  if (reason) {
    job.abortReason = reason instanceof Error ? reason : new Error(String(reason));
  } else if (!job.abortReason) {
    job.abortReason = cancelled ? createCancellationError() : new Error("Download aborted.");
  }
  if (cancelled && job.abortReason && !job.abortReason.code) {
    job.abortReason.code = "HK_CANCELLED";
  }
  for (const controller of job.abortControllers) {
    try {
      controller.abort();
    } catch { }
  }
  job.abortControllers.clear();
}

function isConnectorUrl(value) {
  return typeof value === "string" && value.startsWith("connector://");
}

function toUint8Array(value) {
  if (value == null) {
    return new Uint8Array(0);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }
  if (typeof value === "object") {
    if (value.type === "Buffer" && Array.isArray(value.data)) {
      return new Uint8Array(value.data);
    }
    if (Array.isArray(value.data)) {
      return new Uint8Array(value.data);
    }
    if (value.data) {
      return toUint8Array(value.data);
    }
    const numericKeys = Object.keys(value).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length) {
      numericKeys.sort((a, b) => Number(a) - Number(b));
      return new Uint8Array(numericKeys.map((key) => Number(value[key]) & 0xff));
    }
  }
  throw new Error("Unsupported connector payload buffer.");
}

async function fetchViaConnector(job, page) {
  const payload = {
    url: page.url,
    connectorId: page.connectorId || job?.connectorId || null,
    tabId: job?.tabId ?? null
  };
  const response = await handleHKRequest("connectorPayload", payload);
  if (!response?.ok) {
    throw new Error(response?.error || "Connector payload failed.");
  }
  const data = response.data;
  if (!data || !data.data) {
    throw new Error("Connector returned empty payload.");
  }
  const bytes = decodeConnectorPayload(data);
  return {
    bytes,
    mime: data.mimeType || ""
  };
}

function decodeConnectorPayload(payload) {
  if (!payload) {
    return new Uint8Array(0);
  }
  if (payload.encoding === "base64") {
    return base64ToUint8Array(payload.data || "");
  }
  return toUint8Array(payload.data);
}

function base64ToUint8Array(base64) {
  if (!base64) {
    return new Uint8Array(0);
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fetchPagePayload(job, page) {
  if (isConnectorUrl(page?.url)) {
    return fetchViaConnector(job, page);
  }
  if (shouldUsePageBridge(job, page)) {
    return fetchViaBridge(job, page);
  }
  return fetchViaNetwork(job, page);
}

function buildBridgeHeaders(page, job) {
  const headers = {};
  const referer = page.referer || job.referer;
  if (referer) {
    headers.referer = referer;
  }
  if (page.headers) {
    for (const [key, value] of Object.entries(page.headers)) {
      if (value != null) {
        headers[key] = value;
      }
    }
  }
  return headers;
}

async function fetchViaBridge(job, page) {
  const response = await requestPageWorldFetch(job.tabId, {
    url: page.url,
    init: {
      method: "GET",
      credentials: "include",
      headers: buildBridgeHeaders(page, job)
    },
    timeout: page.timeout || DOWNLOAD_REQUEST_TIMEOUT_MS
  });
  if (!response?.ok) {
    const err = new Error(response?.error || "Page bridge fetch failed.");
    err.status = response?.status ?? 0;
    throw err;
  }
  if (Number(response.status) >= 400) {
    const err = new Error(`Failed to fetch page ${page.url} (status ${response.status})`);
    err.status = response.status;
    throw err;
  }
  const buffer = response.body;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Bridge fetch returned invalid payload.");
  }
  return {
    bytes: new Uint8Array(buffer),
    mime: extractMimeFromHeaders(response.headers)
  };
}

async function fetchViaNetwork(job, page) {
  const headers = new Headers();
  const init = {
    method: "GET",
    credentials: "include",
    headers
  };
  const referer = page.referer || job.referer;
  if (referer) {
    init.referrer = referer;
  }
  if (page.headers) {
    const forbidden = new Set(["referer", "referrer", "cookie"]);
    for (const [key, value] of Object.entries(page.headers)) {
      if (value == null) continue;
      const lower = String(key).toLowerCase();
      if (forbidden.has(lower)) {
        if ((lower === "referer" || lower === "referrer") && !init.referrer) {
          init.referrer = String(value);
        }
        continue;
      }
      try {
        headers.set(key, String(value));
      } catch { }
    }
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  if (controller) {
    job.abortControllers.add(controller);
  }
  const timeoutMs = Number(page.timeout) || DOWNLOAD_REQUEST_TIMEOUT_MS;
  const timeoutId = controller ? setTimeout(() => {
    try {
      controller.abort();
    } catch { }
  }, timeoutMs) : null;
  try {
    init.signal = controller?.signal;
    const response = await fetch(page.url, init);
    if (!response.ok) {
      const err = new Error(`Failed to fetch page ${page.url} (status ${response.status})`);
      err.status = response.status;
      throw err;
    }
    const buffer = await response.arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      mime: response.headers.get("content-type") || ""
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (controller) {
      job.abortControllers.delete(controller);
    }
  }
}

function isCoreviewFamily(family) {
  const key = normalizeHKFamilyKey(family);
  return key === "coreview" || key === "gigaviewer";
}

async function descrambleCoreViewImage(bytes) {
  if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") {
    return { bytes, mime: "image/png" };
  }
  try {
    const blob = new Blob([bytes]);
    const bitmap = await createImageBitmap(blob);
    const DIVIDE_NUM = 4;
    const MULTIPLE = 8;
    const width = bitmap.width;
    const height = bitmap.height;
    const cellWidthBase = Math.floor(width / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE;
    const cellHeightBase = Math.floor(height / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE;
    const cellWidth = cellWidthBase > 0 ? cellWidthBase : Math.floor(width / DIVIDE_NUM) || width / DIVIDE_NUM;
    const cellHeight = cellHeightBase > 0 ? cellHeightBase : Math.floor(height / DIVIDE_NUM) || height / DIVIDE_NUM;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height, 0, 0, width, height);
    for (let e = 0; e < DIVIDE_NUM * DIVIDE_NUM; e++) {
      const t = Math.floor(e / DIVIDE_NUM) * cellHeight;
      const n = (e % DIVIDE_NUM) * cellWidth;
      const r = Math.floor(e / DIVIDE_NUM);
      const i = e % DIVIDE_NUM * DIVIDE_NUM + r;
      const o = (i % DIVIDE_NUM) * cellWidth;
      const s = Math.floor(i / DIVIDE_NUM) * cellHeight;
      ctx.drawImage(bitmap, n, t, cellWidth, cellHeight, o, s, cellWidth, cellHeight);
    }
    if (typeof bitmap.close === "function") {
      try { bitmap.close(); } catch { }
    }
    const descrambledBlob = await canvas.convertToBlob({ type: "image/png" });
    const buffer = await descrambledBlob.arrayBuffer();
    return { bytes: new Uint8Array(buffer), mime: "image/png" };
  } catch {
    return { bytes, mime: "image/png" };
  }
}

async function fetchPageWithRetries(job, page, attempt = 0) {
  if (job.cancelled) {
    throw createCancellationError();
  }
  try {
    return await fetchPagePayload(job, page);
  } catch (error) {
    if (job.cancelled) {
      throw createCancellationError();
    }
    const status = error?.status;
    if (shouldRetryStatus(status) && attempt < DOWNLOAD_MAX_FETCH_RETRIES) {
      await wait(getBackoffDelay(attempt + 1));
      return fetchPageWithRetries(job, page, attempt + 1);
    }
    throw error;
  }
}

function sanitizeRelativePath(value) {
  if (typeof value !== "string") return "";
  return value
    .split(/[\\/]+/)
    .map((segment) => sanitizeSegment(segment, "page"))
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function buildPageEntryName(job, pageIndex, page, mime) {
  const provided = typeof page?.filename === "string" ? page.filename.trim() : "";
  if (provided) {
    const sanitized = sanitizeRelativePath(provided);
    if (sanitized) {
      if (sanitized.startsWith(`${job.mangaName}/`)) {
        return sanitized;
      }
      return `${job.mangaName}/${job.chapterName}/${sanitized}`;
    }
  }
  const pageNumber = String(pageIndex + 1).padStart(3, "0");
  const extension = pickPageExtension(page?.url || "", mime);
  return `${job.mangaName}/${job.chapterName}/Page_${pageNumber}${extension}`;
}

async function runDownloadJob(job) {
  const pages = job.pages || [];
  const concurrency = Math.min(DOWNLOAD_MAX_CONCURRENT_FETCHES, pages.length);
  if (!concurrency) {
    throw new Error("Download job has no pages.");
  }
  let fatalError = null;
  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (job.cancelled || job.aborted) {
        return;
      }
      const current = nextIndex++;
      if (current >= pages.length) {
        return;
      }
      const page = pages[current];
      try {
        const payload = await fetchPageWithRetries(job, page, 0);
        const processed = isCoreviewFamily(job.family)
          ? await descrambleCoreViewImage(payload.bytes)
          : { bytes: payload.bytes, mime: payload.mime };
        const finalMime = processed.mime || payload.mime;
        const entryName = buildPageEntryName(job, current, page, finalMime);
        job.builder.appendEntry({ name: entryName, bytes: processed.bytes });
        if (job.epubBuilder) {
          try {
            job.epubBuilder.addPage({ index: current, name: entryName, bytes: processed.bytes, mime: finalMime });
          } catch (error) {
            console.warn("[HK] Failed to append EPUB page:", error);
          }
        }
      } catch (error) {
        fatalError = fatalError || error;
        const cancelled = error?.code === "HK_CANCELLED";
        abortDownloadJob(job, error, { cancelled });
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (job.cancelled) {
    throw job.abortReason || createCancellationError();
  }
  if (fatalError) {
    throw fatalError;
  }
  maybeAppendComicInfoEntry(job.builder, job.comicInfoMeta);
  const archiveBytes = job.builder.finalize();
  let epubBuffer = null;
  if (job.epubBuilder) {
    try {
      const epubBytes = job.epubBuilder.finalize();
      epubBuffer = toTransferableBuffer(epubBytes);
    } catch (error) {
      console.warn("[HK] Failed to finalize EPUB archive:", error);
    }
  }
  return {
    archive: toTransferableBuffer(archiveBytes),
    epub: epubBuffer
  };
}

async function getStoredHostPatterns() {
  const data = await chrome.storage.local.get({ hostAllowList: [] });
  const arr = Array.isArray(data.hostAllowList) ? data.hostAllowList : [];
  return Array.from(new Set(arr.filter((entry) => typeof entry === "string" && entry.includes("://"))));
}

async function setStoredHostPatterns(patterns) {
  await chrome.storage.local.set({ hostAllowList: Array.from(new Set(patterns)) });
}

async function rememberHostPattern(pattern) {
  if (!pattern) return;
  const list = await getStoredHostPatterns();
  if (!list.includes(pattern)) {
    list.push(pattern);
    await setStoredHostPatterns(list);
    await syncBridgeScripts();
  }
}

async function removeHostPatterns(patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return;
  const removal = patterns.filter((item) => typeof item === "string" && item.includes("://"));
  if (!removal.length) return;
  const removeSet = new Set(removal);
  const list = await getStoredHostPatterns();
  if (!list.length) return;
  const next = list.filter((item) => !removeSet.has(item));
  if (next.length === list.length) return;
  await setStoredHostPatterns(next);
  await syncBridgeScripts();
}

function storageLocalGet(defaults) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(defaults, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve(result);
    });
  });
}

function storageLocalSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve();
    });
  });
}

function storageLocalRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve();
    });
  });
}

async function handleStorageRequestMessage(msg) {
  const op = msg?.op;
  if (!op) {
    throw new Error("Missing storage operation.");
  }
  if (op === "get") {
    const key = typeof msg.key === "string" && msg.key ? msg.key : null;
    if (!key) {
      throw new Error("Storage get requires a key.");
    }
    const fallback = Object.prototype.hasOwnProperty.call(msg, "fallback") ? msg.fallback : null;
    const result = await storageLocalGet({ [key]: fallback });
    return result[key] ?? fallback;
  }
  if (op === "set") {
    const key = typeof msg.key === "string" && msg.key ? msg.key : null;
    if (!key) {
      throw new Error("Storage set requires a key.");
    }
    await storageLocalSet({ [key]: msg.value });
    return msg.value;
  }
  if (op === "remove") {
    const key = typeof msg.key === "string" && msg.key ? msg.key : null;
    if (!key) {
      throw new Error("Storage remove requires a key.");
    }
    await storageLocalRemove(key);
    return true;
  }
  if (op === "list") {
    const data = await storageLocalGet(null);
    return data || {};
  }
  throw new Error(`Unsupported storage operation '${op}'.`);
}

async function readSettingsSnapshot() {
  try {
    const result = await storageLocalGet({ settings: null });
    if (result && result.settings) {
      return result.settings;
    }
  } catch (error) {
    console.warn("[HK] Failed to read settings", error);
  }
  if (typeof UnshackleSettings?.cloneDefaults === "function") {
    return UnshackleSettings.cloneDefaults();
  }
  return null;
}

async function isMangaFeatureEnabled() {
  try {
    const settings = await readSettingsSnapshot();
    return Boolean(settings?.manga?.enabled);
  } catch (error) {
    console.warn("[HK] Unable to evaluate manga flag", error);
    return false;
  }
}

function isTransientOffscreenError(error) {
  if (!error) {
    return false;
  }
  const message = String(error?.message || error);
  return /message port closed/i.test(message)
    || /receiving end does not exist/i.test(message)
    || /offscreen/i.test(message)
    || /did not become ready/i.test(message);
}

function sendRunnerMessage(command, payload, timeoutMs = RUNTIME_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finalize = (error, response) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    };
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        finalize(new Error(`HK runner command '${command}' timed out.`));
      }, timeoutMs);
    }
    chrome.runtime.sendMessage(
      {
        type: HK_RUNNER_COMMAND,
        command,
        payload
      },
      (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          finalize(new Error(err.message || String(err)));
          return;
        }
        finalize(null, response);
      }
    );
  });
}

async function sendToHKRunner(command, payload) {
  const attempts = 2;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await ensureOffscreenDocument({ retry: attempt === 0 });
      return await sendRunnerMessage(command, payload);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isTransientOffscreenError(error)) {
        throw error;
      }
      console.warn(`[HK] Runner command '${command}' failed; retrying...`, error);
      await recreateOffscreenDocument();
    }
  }
  throw lastError || new Error("HK runner unavailable.");
}

async function handleHKRunnerMessage(command, payload) {
  const response = await sendToHKRunner(command, payload);
  if (!response) {
    return { ok: false, error: "Runner did not respond." };
  }
  return response;
}
async function handleHKRequest(command, rawPayload = {}) {
  const normalizedPayload = { ...rawPayload };
  if (command === "connectorPayload") {
    if (!(await isMangaFeatureEnabled())) {
      return { ok: false, error: "Manga mode is disabled." };
    }
    const connectorPayload = {
      url: typeof rawPayload?.url === "string" ? rawPayload.url : ""
    };
    return handleHKRunnerMessage(command, connectorPayload);
  }
  if (command === "probe") {
    if (!(await isMangaFeatureEnabled())) {
      return { ok: false, error: "Manga mode is disabled." };
    }
    normalizedPayload.connectorId = canonicalizeConnectorId(normalizedPayload.connectorId || "");
    return handleHKRunnerMessage(command, normalizedPayload);
  }
  if (!(await isMangaFeatureEnabled())) {
    return { ok: false, error: "Manga mode is disabled." };
  }
  const connectorId = canonicalizeConnectorId(normalizedPayload.connectorId || "");
  const payloadUrl = resolvePayloadUrl(normalizedPayload);
  const payloadHost = getHostnameFromUrl(payloadUrl);
  const preferredConnectorId = await preferDelegateConnectorId(connectorId, payloadHost);
  normalizedPayload.connectorId = preferredConnectorId;
  const userLoaderPref = rawPayload?.loader
    ? normalizeHKLoaderMode(rawPayload.loader)
    : await getStoredHKLoaderMode();
  const allowEntry = preferredConnectorId ? await findHKAllowListEntry(preferredConnectorId) : null;
  const tabIdRaw = Number(rawPayload?.tabId);
  const hasTab = Number.isInteger(tabIdRaw) && tabIdRaw >= 0;
  const managerPayload = hasTab ? { ...normalizedPayload, tabId: tabIdRaw } : normalizedPayload;
  const managerCapable = isManagerCapableEntry(allowEntry) && hasTab;
  let loaderPref = userLoaderPref;
  if (userLoaderPref === "auto" && payloadHost) {
    const hostPref = await getHostLoaderPreference(payloadHost);
    if (hostPref) {
      loaderPref = hostPref;
    }
  }
  if (loaderPref === "manager" && !managerCapable) {
    if (userLoaderPref === "manager") {
      return { ok: false, error: "Manager loader requires a native connector on the active tab." };
    }
    loaderPref = "runner";
  }
  const preferManager = loaderPref === "manager" || (loaderPref === "auto" && managerCapable);
  let managerFallbackWarning = null;
  if (preferManager && managerCapable) {
    try {
      const managerResult = await handleHKManagerMessage(command, managerPayload, allowEntry);
      if (payloadHost) {
        await rememberHostLoaderResult(payloadHost, "manager");
      }
      return attachHKMetadata(managerResult, preferredConnectorId, allowEntry);
    } catch (error) {
      if (userLoaderPref === "manager") {
        return { ok: false, error: error?.message || String(error) };
      }
      console.warn("[HK] Manager loader failed, falling back to runner:", error);
      managerFallbackWarning = buildManagerFallbackWarning(error);
    }
  }
  try {
    const runnerResult = await handleHKRunnerMessage(command, managerPayload);
    if (!runnerResult?.ok) {
      throw new Error(runnerResult?.error || "HK runner failed.");
    }
    if (payloadHost) {
      await rememberHostLoaderResult(payloadHost, "runner");
    }
    if (managerFallbackWarning && runnerResult?.data && typeof runnerResult.data === "object") {
      if (!runnerResult.data.warning) {
        runnerResult.data.warning = managerFallbackWarning;
      }
      runnerResult.data.warningCode = runnerResult.data.warningCode || "manager-fallback";
    }
    return attachHKMetadata(runnerResult, preferredConnectorId, allowEntry);
  } catch (runnerError) {
    if (managerCapable && userLoaderPref !== "runner") {
      console.warn("[HK] Runner path failed, retrying via manager:", runnerError);
      const warning = buildRunnerFallbackWarning(runnerError);
      const managerResult = await handleHKManagerMessage(command, managerPayload, allowEntry);
      if (payloadHost) {
        await rememberHostLoaderResult(payloadHost, "manager");
      }
      if (warning && managerResult?.data && typeof managerResult.data === "object") {
        managerResult.data.warning = warning;
        managerResult.data.warningCode = managerResult.data.warningCode || "runner-fallback";
      }
      return attachHKMetadata(managerResult, preferredConnectorId, allowEntry);
    }
    throw runnerError;
  }
}

async function resolveDelegateTabId(preferredTabId) {
  if (Number.isInteger(preferredTabId) && preferredTabId >= 0) {
    return preferredTabId;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs.length ? tabs[0] : null;
  if (tab && tab.id != null) {
    return tab.id;
  }
  throw new Error("No active tab available for delegation.");
}

function getDelegateState(tabId) {
  const existing = HK_DELEGATE_INJECTED.get(tabId);
  if (existing && typeof existing === "object") {
    return existing;
  }
  if (existing === true) {
    const state = { injected: true, ready: true, lastReadyAt: Date.now() };
    HK_DELEGATE_INJECTED.set(tabId, state);
    return state;
  }
  const fresh = { injected: Boolean(existing), ready: Boolean(existing), lastReadyAt: 0 };
  HK_DELEGATE_INJECTED.set(tabId, fresh);
  return fresh;
}

function resetDelegateState(tabId) {
  if (tabId == null) return;
  HK_DELEGATE_INJECTED.delete(tabId);
}

async function getInjectableFrameIds(tabId) {
  if (!chrome.webNavigation?.getAllFrames) {
    return null;
  }
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!Array.isArray(frames) || !frames.length) {
      return null;
    }
    const mainFrame = frames.find((frame) => frame.parentFrameId === -1) || frames[0];
    const mainOrigin = getOriginFromUrl(mainFrame?.url);
    const selectable = frames.filter((frame) => {
      if (frame.errorOccurred) return false;
      if (frame.parentFrameId === -1) return true;
      const origin = getOriginFromUrl(frame.url);
      if (!origin) return false;
      if (mainOrigin && origin !== mainOrigin) return false;
      return true;
    }).map((frame) => frame.frameId);
    return selectable.length ? Array.from(new Set(selectable)) : null;
  } catch (error) {
    console.warn("[HK] Failed to enumerate frames for delegates", error);
    return null;
  }
}

function buildDelegateTarget(tabId, frameIds) {
  if (Array.isArray(frameIds) && frameIds.length) {
    return { tabId, frameIds };
  }
  return { tabId };
}

async function runDelegatePresenceProbe(tabId, frameIds) {
  const target = buildDelegateTarget(tabId, frameIds);
  try {
    const results = await chrome.scripting.executeScript({
      target,
      func: () => Boolean(globalThis.HKDelegates),
      world: "MAIN"
    });
    return Array.isArray(results) && results.some((entry) => entry?.result);
  } catch (error) {
    const message = String(error?.message || "");
    if (!/Cannot access contents/i.test(message)) {
      console.warn("[HK] Delegate presence probe failed", error);
    }
    return false;
  }
}

async function hasDelegatesInAnyFrame(tabId) {
  const frameIds = await getInjectableFrameIds(tabId);
  return runDelegatePresenceProbe(tabId, frameIds);
}

async function injectDelegatesIntoTab(tabId) {
  const frameIds = await getInjectableFrameIds(tabId);
  await chrome.scripting.executeScript({
    target: buildDelegateTarget(tabId, frameIds),
    files: HK_DELEGATE_FILES,
    world: "MAIN"
  });
}

async function waitForDelegates(tabId) {
  const deadline = Date.now() + HK_DELEGATE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const frameIds = await getInjectableFrameIds(tabId);
    if (await runDelegatePresenceProbe(tabId, frameIds)) {
      return true;
    }
    await wait(HK_DELEGATE_POLL_INTERVAL_MS);
  }
  return false;
}

async function ensureDelegateEnvironment(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Invalid tab id for delegation.");
  }
  const state = getDelegateState(tabId);
  if (state.ready) {
    return;
  }
  let ready = await hasDelegatesInAnyFrame(tabId);
  if (!ready) {
    await injectDelegatesIntoTab(tabId);
    state.injected = true;
    ready = await waitForDelegates(tabId);
  }
  if (!ready) {
    state.ready = false;
    throw new DelegatesUnavailableError();
  }
  state.ready = true;
  state.lastReadyAt = Date.now();
}

async function executeDelegateCall({ moduleId, method, args, tabId }) {
  if (!moduleId) {
    throw new Error("Delegate call missing module id.");
  }
  const targetTabId = await resolveDelegateTabId(tabId);
  await ensureDelegateEnvironment(targetTabId);
  let responseEntries;
  try {
    const frameIds = await getInjectableFrameIds(targetTabId);
    responseEntries = await chrome.scripting.executeScript({
      target: buildDelegateTarget(targetTabId, frameIds),
      func: async (mId, mMethod, mArgs) => {
        try {
          if (!globalThis.HKDelegates) {
            throw new Error("HK delegates unavailable in page context.");
          }
          if (mMethod === "listPages") {
            return { ok: true, data: await globalThis.HKDelegates.callListPages(mId, mArgs) };
          }
          if (mMethod === "listChapters") {
            return { ok: true, data: await globalThis.HKDelegates.callListChapters(mId, mArgs) };
          }
          return { ok: true, data: await globalThis.HKDelegates.callSiteMethod(mId, mMethod, mArgs) };
        } catch (error) {
          return { ok: false, error: error?.message || String(error) };
        }
      },
      args: [moduleId, method || "listPages", Array.isArray(args) ? args : []],
      world: "MAIN"
    });
  } catch (error) {
    resetDelegateState(targetTabId);
    throw new DelegatesUnavailableError(error?.message);
  }
  const entries = Array.isArray(responseEntries) ? responseEntries : [];
  const matched = entries.find((entry) => entry?.result);
  const result = matched?.result || null;
  if (!result) {
    throw new Error("Delegate call returned no result.");
  }
  if (!result.ok) {
    const message = result.error || "Delegate call failed.";
    if (/delegates unavailable/i.test(message)) {
      resetDelegateState(targetTabId);
      throw new DelegatesUnavailableError(message);
    }
    throw new Error(message);
  }
  return result;
}

function resolveManagerModuleId(entry, connectorId) {
  if (entry?.module) {
    return entry.module;
  }
  if (connectorId && connectorId.startsWith("delegate.")) {
    return connectorId.split(".").pop();
  }
  return null;
}

async function runManagerListChapters(moduleId, payload) {
  const seriesUrl = payload?.url || payload?.manga?.id;
  if (!seriesUrl) {
    throw new Error("Manager loader requires a series URL.");
  }
  const response = await executeDelegateCall({
    moduleId,
    method: "listChapters",
    args: [seriesUrl],
    tabId: payload?.tabId
  });
  const data = response?.data || {};
  const chapters = normalizeManagerChapters(data);
  if (!chapters.length) {
    throw new Error("No chapters returned by manager connector.");
  }
  const mangaInfo = {
    id: data?.seriesUrl || seriesUrl,
    title: data?.seriesTitle || payload?.manga?.title || "Series",
    viewerId: data?.viewerId || moduleId
  };
  return {
    ok: true,
    data: {
      loader: "manager",
      connectorId: payload?.connectorId || null,
      chapters,
      manga: mangaInfo
    }
  };
}

async function runManagerListPages(moduleId, payload) {
  const chapterRef = payload?.chapter?.id || payload?.chapterId || payload?.url;
  if (!chapterRef) {
    throw new Error("Manager loader requires a chapter id or URL.");
  }
  const response = await executeDelegateCall({
    moduleId,
    method: "listPages",
    args: [chapterRef],
    tabId: payload?.tabId
  });
  const data = response?.data || {};
  const referer = typeof payload?.chapter?.url === "string"
    ? payload.chapter.url
    : (typeof payload?.url === "string"
      ? payload.url
      : (typeof chapterRef === "string" && chapterRef.startsWith("http") ? chapterRef : null));
  const pages = normalizeManagerPages(data).map((page) => ({
    ...page,
    referer: page.referer || referer,
    useBridge: true
  }));
  if (!pages.length) {
    throw new Error("No pages returned by manager connector.");
  }
  return {
    ok: true,
    data: {
      loader: "manager",
      connectorId: payload?.connectorId || null,
      pages
    }
  };
}

async function handleHKManagerMessage(command, payload, entry) {
  const moduleId = resolveManagerModuleId(entry, payload?.connectorId);
  if (!moduleId || !HK_MANAGER_MODULES.has(moduleId)) {
    throw new Error("Selected connector is not supported by the manager loader.");
  }
  const tabId = payload?.tabId;
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Manager loader requires an active tab.");
  }
  if (command === "manga") {
    return runManagerListChapters(moduleId, payload);
  }
  if (command === "pages") {
    return runManagerListPages(moduleId, payload);
  }
  throw new Error(`Manager loader does not support '${command}'.`);
}

async function ensurePageBridge(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Invalid tab id for page fetch.");
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["bridge_inject.js"],
      world: "ISOLATED"
    });
  } catch (error) {
    const msg = String(error?.message || "");
    if (!/Cannot access contents of/i.test(msg)) {
      console.warn("[HK] Failed to inject bridge script", error);
    }
  }
}

async function requestPageWorldFetch(tabId, { url, init = {}, body = null, timeout = 20000 }) {
  await ensurePageBridge(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      {
        action: "hkPageFetch",
        url,
        init,
        body,
        timeout
      },
      (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || String(err)));
          return;
        }
        if (!response) {
          reject(new Error("Page fetch bridge did not respond."));
          return;
        }
        resolve(response);
      }
    );
  });
}

// Expose for internal use by RequestAdapter when running in background
globalThis.hkHandlePageFetchRequest = async (payload) => {
  const tabId = Number(payload?.tabId);
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Page fetch requires a valid tabId.");
  }
  return requestPageWorldFetch(tabId, {
    url: payload.url,
    init: payload.init,
    body: payload.body,
    timeout: payload.timeout
  });
};

async function pruneHostPatterns(validOrigins) {
  const list = await getStoredHostPatterns();
  if (!list.length) return;
  const valid = new Set(validOrigins || []);
  const next = list.filter((item) => valid.has(item));
  if (next.length !== list.length) {
    await setStoredHostPatterns(next);
    await syncBridgeScripts();
  }
}

async function syncBridgeScripts() {
  const matches = await getStoredHostPatterns();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_SCRIPT_ID] }).catch(() => []);
  if (!matches.length) {
    if (existing && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] }).catch(() => { });
    }
    return;
  }
  const sortedMatches = [...matches].sort();
  const current = existing && existing[0] && Array.isArray(existing[0].matches) ? [...existing[0].matches].sort() : [];
  const needsUpdate = sortedMatches.length !== current.length || sortedMatches.some((m, idx) => m !== current[idx]);
  if (needsUpdate) {
    if (existing && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] }).catch(() => { });
    }
    await chrome.scripting.registerContentScripts([{
      id: BRIDGE_SCRIPT_ID,
      js: ["bridge_inject.js"],
      matches: sortedMatches,
      runAt: "document_start",
      allFrames: true,
      persistAcrossSessions: true
    }]).catch(() => { });
  }
}

async function applyPanelBehavior(useSidePanel) {
  const wantsAutoOpen = !!useSidePanel;
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: wantsAutoOpen });
      return wantsAutoOpen;
    }
  } catch { }
  return false;
}

async function syncPanelBehaviorFromStorage() {
  try {
    const prefs = await chrome.storage.sync.get({ useSidePanel: true });
    await applyPanelBehavior(!!prefs.useSidePanel);
  } catch { }
}

async function ensureCoreContentScriptRegistered() {
  if (!chrome.scripting?.registerContentScripts) {
    return;
  }
  // If the manifest already injects content.js, skip dynamic registration to avoid duplicate IDs.
  try {
    const manifest = chrome.runtime.getManifest?.();
    const cs = Array.isArray(manifest?.content_scripts) ? manifest.content_scripts : [];
    const hasContent = cs.some((entry) => Array.isArray(entry.js) && entry.js.includes("content.js"));
    if (hasContent) return;
  } catch { }
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CORE_CONTENT_SCRIPT_ID] }).catch(() => []);
    if (existing && existing.length) {
      return;
    }
    await chrome.scripting.registerContentScripts([CORE_CONTENT_SCRIPT_DEF]).catch((err) => {
      const msg = String(err?.message || "");
      if (/Duplicate script ID/i.test(msg)) {
        return;
      }
      throw err;
    });
  } catch (error) {
    console.warn("[HK] Failed to register core content script", error);
  }
}

async function broadcastHKSettingsUpdate() {
  try {
    const settings = await readSettingsSnapshot();
    chrome.runtime.sendMessage({ action: HK_SETTINGS_UPDATED_EVENT, settings }, () => void chrome.runtime.lastError);
  } catch (error) {
    console.warn("[HK] Failed to broadcast settings update", error);
  }
}

function ensureContextMenu() {
  try {
    chrome.contextMenus.remove(CONTEXT_MENU_ID, () => void chrome.runtime.lastError);
  } catch { }
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: chrome.i18n?.getMessage?.("menu_enable_context") || "Enable right-click & drag on this site",
    contexts: ["all"]
  }, () => void chrome.runtime.lastError);
}

async function fetchAsArrayBuffer(url) {
  if (isConnectorUrl(url)) {
    const response = await handleHKRunnerMessage("connectorPayload", { url });
    if (!response?.ok) {
      throw new Error(response?.error || "Connector payload failed.");
    }
    const payload = response.data || {};
    if (payload.encoding === "base64") {
      return base64ToArrayBuffer(payload.data || "");
    }
    const data = payload.data;
    if (data instanceof ArrayBuffer) {
      return data;
    }
    if (ArrayBuffer.isView(data)) {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }
    if (Array.isArray(data)) {
      return new Uint8Array(data).buffer;
    }
    if (typeof data === "string") {
      return base64ToArrayBuffer(data);
    }
    throw new Error("Unsupported connector payload buffer.");
  }
  // Some GV CDNs require cookies; others reject them. Try both.
  let lastErr;
  for (const cred of ["include", "omit"]) {
    try {
      const res = await fetch(url, { credentials: cred });
      if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      }
      return await res.arrayBuffer();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Fetch failed");
}

async function fetchInstagramProfile(username) {
  if (typeof username !== "string" || !username.trim()) {
    throw new Error("Missing Instagram username.");
  }
  const key = username.trim().toLowerCase();
  const now = Date.now();
  const cached = INSTAGRAM_PROFILE_CACHE.get(key);
  if (cached && (now - cached.timestamp) < INSTAGRAM_PROFILE_TTL_MS) {
    if (!cached.data) {
      throw new Error("Instagram profile unavailable.");
    }
    return cached.data;
  }
  const endpoint = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(key)}`;
  const res = await fetch(endpoint, {
    headers: {
      "X-IG-App-ID": INSTAGRAM_APP_ID
    },
    credentials: "omit"
  });
  if (!res.ok) {
    throw new Error(`Instagram profile request failed (${res.status})`);
  }
  const payload = await res.json().catch(() => null);
  const user = payload?.data?.user;
  if (!user) {
    throw new Error("Instagram profile missing data.");
  }
  const profile = {
    username: user.username || key,
    profile_pic_url: user.profile_pic_url || "",
    profile_pic_url_hd: user.profile_pic_url_hd || ""
  };
  INSTAGRAM_PROFILE_CACHE.set(key, { timestamp: now, data: profile });
  return profile;
}

async function fetchInstagramImageBytes(url) {
  if (typeof url !== "string" || !url) {
    throw new Error("Missing image url.");
  }
  const key = url;
  const cached = INSTAGRAM_IMAGE_CACHE.get(key);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < INSTAGRAM_IMAGE_TTL_MS) {
    return cached.payload;
  }
  const res = await fetch(url, { credentials: "include" }).catch((err) => { throw err; });
  if (!res || !res.ok) {
    throw new Error(`Image fetch failed (${res?.status || "?"})`);
  }
  const buffer = await res.arrayBuffer();
  const mime = res.headers.get("content-type") || "";
  const payload = { buffer, mime, size: buffer.byteLength };
  INSTAGRAM_IMAGE_CACHE.set(key, { timestamp: now, payload });
  return payload;
}

function base64ToArrayBuffer(base64) {
  if (!base64) {
    return new ArrayBuffer(0);
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function trackDownloadUrl(downloadId, url) {
  if (typeof downloadId === "number" && url) {
    DOWNLOAD_URL_CACHE.set(downloadId, url);
  } else if (url) {
    try { URL.revokeObjectURL(url); } catch { }
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta || delta.id == null) return;
  const url = DOWNLOAD_URL_CACHE.get(delta.id);
  if (!url) return;
  const state = delta.state?.current;
  if (state === "complete" || state === "interrupted") {
    try { URL.revokeObjectURL(url); } catch { }
    DOWNLOAD_URL_CACHE.delete(delta.id);
  }
});

ensureCoreContentScriptRegistered().catch(() => { });

chrome.runtime.onInstalled.addListener(async () => {
  ensureContextMenu();
  await ensureCoreContentScriptRegistered();
  await syncPanelBehaviorFromStorage();
  const granted = await chrome.permissions.getAll().then((p) => p?.origins || []).catch(() => []);
  await pruneHostPatterns(granted);
  await syncBridgeScripts();
});

chrome.runtime.onStartup?.addListener(async () => {
  ensureContextMenu();
  await ensureCoreContentScriptRegistered();
  await syncPanelBehaviorFromStorage();
  chrome.permissions.getAll()
    .then((p) => p?.origins || [])
    .then((origins) => pruneHostPatterns(origins))
    .then(() => syncBridgeScripts())
    .catch(() => { });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes?.settings) {
    return;
  }
  hkLoaderPreferenceCache = { value: null, expires: 0 };
  broadcastHKSettingsUpdate();
});

if (chrome.runtime?.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    closeOffscreenDocument().catch(() => { });
  });
}

chrome.permissions.onRemoved.addListener(async ({ origins }) => {
  if (!origins || !origins.length) return;
  const granted = await chrome.permissions.getAll().then((p) => p?.origins || []).catch(() => []);
  await pruneHostPatterns(granted);
});

if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    const prefs = await chrome.storage.sync.get({ useSidePanel: true });
    const useSide = !!prefs.useSidePanel;
    const autoSidePanel = await applyPanelBehavior(useSide);
    try {
      if (useSide && chrome.sidePanel && tab && tab.id !== undefined) {
        await chrome.sidePanel.setOptions({ tabId: tab.id, path: "panel.html", enabled: true });
        if (!autoSidePanel) {
          await chrome.sidePanel.open({ tabId: tab.id });
        }
      } else {
        try {
          if (chrome.sidePanel && tab && tab.id !== undefined) {
            await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
          }
        } catch { }
        try {
          await new Promise((resolve, reject) => {
            chrome.windows.create(
              { url: "panel.html", type: "popup", width: 460, height: 760, focused: true },
              (win) => {
                if (chrome.runtime.lastError || !win) {
                  reject(chrome.runtime.lastError);
                } else {
                  resolve(win);
                }
              }
            );
          });
        } catch {
          chrome.tabs.create({ url: "panel.html" });
        }
      }
    } catch {
      chrome.tabs.create({ url: "panel.html" });
    }
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, { action: "enableInteractions", source: "contextMenu" }, () => void chrome.runtime.lastError);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  resetDelegateState(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const processMessage = async () => {
    if (!msg || typeof msg !== "object") {
      sendResponse({ ok: false, error: "Invalid message" });
      return;
    }
    if (msg.action === "SCAN_PROGRESS") {
      if (msg.forwarded === true) {
        sendResponse({ ok: true });
        return;
      }
      try {
        chrome.runtime.sendMessage({ ...msg, forwarded: true }, () => void chrome.runtime.lastError);
      } catch { }
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === HK_SETTINGS_REQUEST) {
      try {
        const settings = await readSettingsSnapshot();
        sendResponse({ ok: true, data: settings || null });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === HK_STORAGE_OP) {
      try {
        const result = await handleStorageRequestMessage(msg);
        sendResponse({ ok: true, data: result });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.kind === HK_DOWNLOAD_REQUEST) {
      (async () => {
        let job = null;
        try {
          if (HK_DOWNLOAD_JOBS.has(msg.jobId)) {
            throw new Error("A download job with this id is already running.");
          }
          job = createDownloadJobState(msg);
          HK_DOWNLOAD_JOBS.set(job.id, job);
          const result = await runDownloadJob(job);
          sendResponse({ ok: true, archive: result.archive, epub: result.epub || null, jobId: job.id });
        } catch (error) {
          const payload = {
            ok: false,
            error: error?.message || String(error)
          };
          if (error?.code) {
            payload.code = error.code;
          }
          if (error?.code === "HK_CANCELLED") {
            payload.cancelled = true;
          }
          sendResponse(payload);
        } finally {
          if (job?.id) {
            HK_DOWNLOAD_JOBS.delete(job.id);
          }
        }
      })();
      return;
    }
    if (msg.kind === HK_DOWNLOAD_CANCEL) {
      const jobId = typeof msg.jobId === "string" && msg.jobId ? msg.jobId : null;
      if (!jobId) {
        sendResponse({ ok: false, error: "Missing job id." });
        return;
      }
      const job = HK_DOWNLOAD_JOBS.get(jobId);
      if (!job) {
        sendResponse({ ok: false, error: "Job not found." });
        return;
      }
      abortDownloadJob(job, createCancellationError(), { cancelled: true });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === HK_PROXY_REQUEST) {
      (async () => {
        try {
          await ensureOffscreenDocument();
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                type: HK_RUNNER_COMMAND,
                command: msg.command,
                payload: msg.payload
              },
              (resp) => {
                const err = chrome.runtime.lastError;
                if (err) {
                  reject(new Error(err.message || String(err)));
                  return;
                }
                resolve(resp);
              }
            );
          });
          sendResponse(response);
        } catch (error) {
          console.error("[HK] Runner request failed", error);
          sendResponse({ ok: false, error: error?.message || String(error) });
        }
      })();
      return;
    }
    if (msg.type === "HK_PAGE_CHANGED") {
      const tabId = sender?.tab?.id;
      if (tabId != null) {
        resetDelegateState(tabId);
        try {
          chrome.runtime.sendMessage({
            action: "HK_PAGE_CHANGED",
            tabId,
            url: msg.url || sender?.tab?.url || ""
          }, () => void chrome.runtime.lastError);
        } catch { }
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg?.action === "HK_OFFSCREEN_READY") {
      markOffscreenReady();
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === HK_DELEGATE_CALL) {
      executeDelegateCall(msg.payload || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return;
    }
    if (msg.action === "setUIPreference") {
      const val = !!msg.useSidePanel;
      await chrome.storage.sync.set({ useSidePanel: val });
      await applyPanelBehavior(val);
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "rememberHost") {
      if (typeof msg.pattern === "string" && msg.pattern.includes("://")) {
        await rememberHostPattern(msg.pattern);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "enableGlobalPermissions") {
      const origins = Array.isArray(msg.origins) ? msg.origins.filter((entry) => typeof entry === "string" && entry.includes("://")) : [];
      if (origins.length) {
        for (const pattern of origins) {
          await rememberHostPattern(pattern);
        }
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "disableGlobalPermissions") {
      const origins = Array.isArray(msg.origins) ? msg.origins.filter((entry) => typeof entry === "string" && entry.includes("://")) : [];
      if (origins.length) {
        await removeHostPatterns(origins);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "syncBridgeScripts") {
      await syncBridgeScripts();
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "gv.processImage") {
      try {
        const input = msg.buffer;
        const buffer = input instanceof ArrayBuffer
          ? input
          : (ArrayBuffer.isView(input)
            ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
            : null);
        if (!buffer) {
          throw new Error("Missing image buffer");
        }
        const mimeType = typeof msg.mimeType === "string" && msg.mimeType ? msg.mimeType : "image/jpeg";
        const data = await processImageOffscreen(buffer, mimeType, msg.pageMeta || null);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }
    if (msg.action === "zipStore" && Array.isArray(msg.entries)) {
      try {
        const payload = Array.from(msg.entries);
        maybeAppendComicInfoEntry(payload, msg.meta);
        const zipBytes = buildZipStore(payload);
        const buffer = (zipBytes.byteOffset === 0 && zipBytes.byteLength === zipBytes.buffer.byteLength)
          ? zipBytes.buffer
          : zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength);
        sendResponse({ ok: true, data: buffer });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }
    if (msg.action === "HK_PAGE_FETCH") {
      const tabId = Number(msg.tabId);
      if (!Number.isInteger(tabId) || tabId < 0) {
        sendResponse({ ok: false, error: "Page fetch requires a valid tabId." });
        return;
      }
      if (typeof msg.url !== "string" || !msg.url) {
        sendResponse({ ok: false, error: "Page fetch requires a URL." });
        return;
      }
      try {
        const response = await requestPageWorldFetch(tabId, {
          url: msg.url,
          init: msg.init || {},
          body: msg.body || null,
          timeout: msg.timeout || 20000
        });
        sendResponse(response);
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "fetchRequest") {
      const {
        url,
        method = "GET",
        headers = {},
        body = null,
        responseType = "json",
        credentials = "include",
        referrer = null,
        referrerPolicy = undefined
      } = msg;
      if (typeof url !== "string" || !url) {
        sendResponse({ ok: false, error: "Missing URL" });
        return;
      }
      try {
        const init = { method, credentials };
        if (typeof referrer === "string" && referrer) {
          init.referrer = referrer;
        }
        if (typeof referrerPolicy === "string" && referrerPolicy) {
          init.referrerPolicy = referrerPolicy;
        }
        const headerBag = new Headers();
        if (headers && typeof headers === "object") {
          for (const [key, value] of Object.entries(headers)) {
            if (value != null) {
              headerBag.set(key, String(value));
            }
          }
        }
        if ([...headerBag.keys()].length) {
          init.headers = headerBag;
        }
        if (body != null) {
          init.body = typeof body === "string" || body instanceof Blob || body instanceof ArrayBuffer
            ? body
            : (typeof body === "object" ? JSON.stringify(body) : String(body));
          if (!headerBag.has("content-type") && typeof init.body === "string" && body && typeof body === "object") {
            headerBag.set("content-type", "application/json");
            init.headers = headerBag;
          }
        }
        const res = await fetch(url, init);
        const result = {
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          url: res.url,
          headers: {}
        };
        res.headers.forEach((val, key) => {
          result.headers[key] = val;
        });
        if (responseType === "arraybuffer") {
          const ab = await res.arrayBuffer();
          result.data = Array.from(new Uint8Array(ab));
        } else if (responseType === "text") {
          result.data = await res.text();
        } else if (responseType === "json") {
          const text = await res.text();
          try {
            result.data = text ? JSON.parse(text) : null;
          } catch (err) {
            result.ok = false;
            result.error = `JSON parse failed: ${String(err?.message || err)}`;
            result.data = text;
          }
        } else {
          const ab = await res.arrayBuffer();
          result.data = Array.from(new Uint8Array(ab));
        }
        sendResponse(result);
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err), url });
      }
      return;
    }
    if (msg.action === "fetchOne") {
      const ab = await fetchAsArrayBuffer(msg.url);
      const bytes = new Uint8Array(ab);
      sendResponse({ ok: true, kind: "u8", data: Array.from(bytes), url: msg.url });
      return;
    }
    if (msg.action === "fetchMany") {
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      const results = [];
      for (const url of urls) {
        try {
          const ab = await fetchAsArrayBuffer(url);
          const bytes = new Uint8Array(ab);
          results.push({ ok: true, kind: "u8", data: Array.from(bytes), url });
        } catch (err) {
          results.push({ ok: false, error: String(err?.message || err), url });
        }
      }
      sendResponse({ ok: true, results });
      return;
    }
    if (msg.action === "downloadURLs") {
      const items = Array.isArray(msg.items) ? msg.items : [];
      const errors = [];
      await Promise.all(items.map(async (item) => {
        try {
          await new Promise((resolve, reject) => {
            chrome.downloads.download({
              url: item.url,
              filename: item.filename,
              saveAs: msg.saveAs === true,
              conflictAction: "uniquify"
            }, (downloadId) => {
              if (chrome.runtime.lastError || downloadId == null) {
                reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
              } else {
                resolve(downloadId);
              }
            });
          });
        } catch (err) {
          errors.push({ url: item.url, message: String(err?.message || err) });
        }
      }));
      sendResponse({ ok: errors.length === 0, errors });
      return;
    }
    if (msg.action === "downloadURL") {
      const item = msg.item || null;
      if (!item || !item.url) {
        sendResponse({ ok: false, error: "Missing download item" });
        return;
      }
      try {
        const downloadId = await new Promise((resolve, reject) => {
          chrome.downloads.download({
            url: item.url,
            filename: item.filename,
            saveAs: msg.saveAs === true,
            conflictAction: "uniquify"
          }, (id) => {
            if (chrome.runtime.lastError || id == null) {
              reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
            } else {
              resolve(id);
            }
          });
        });
        sendResponse({ ok: true, downloadId });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
      return;
    }

    if (msg.action === "downloadBlob") {
      // Ensure filename has a fallback - blob URLs use UUIDs if filename is empty
      let filename = (typeof msg.filename === "string" && msg.filename.trim()) ? msg.filename.trim() : "";
      if (!filename) {
        // Default fallback based on mime type or generic
        filename = (msg.mimeType === "application/zip" || msg.mimeType === "application/x-zip-compressed")
          ? "download.zip"
          : "download";
      }
      const performDownload = (url) => new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: msg.saveAs === true }, (id) => {
          if (chrome.runtime.lastError || id == null) {
            reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
          } else {
            resolve(id);
          }
        });
      });
      try {
        if (msg.arrayBuffer) {
          const bytes = msg.arrayBuffer instanceof ArrayBuffer ? new Uint8Array(msg.arrayBuffer) : new Uint8Array([]);
          if (!bytes.length) throw new Error("Empty payload");
          const mime = msg.mimeType || "image/png";
          const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
          try {
            const downloadId = await performDownload(blobUrl);
            trackDownloadUrl(downloadId, blobUrl);
            sendResponse({ ok: true });
          } catch (err) {
            trackDownloadUrl(null, blobUrl);
            throw err;
          }
          return;
        }
        if (msg.blobUrl) {
          try {
            const downloadId = await performDownload(msg.blobUrl);
            trackDownloadUrl(downloadId, msg.blobUrl);
            sendResponse({ ok: true });
          } catch (err) {
            trackDownloadUrl(null, msg.blobUrl);
            throw err;
          }
          return;
        }
        sendResponse({ ok: false, error: "No blob payload provided" });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
      return;
    }
    if (msg.action === "fetchInstagramProfile") {
      const username = typeof msg.username === "string" ? msg.username.trim() : "";
      if (!username) {
        sendResponse({ ok: false, error: "Missing username" });
        return;
      }
      try {
        const profile = await fetchInstagramProfile(username);
        sendResponse({ ok: true, profile });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "fetchRemoteImage") {
      const targetUrl = typeof msg.url === "string" ? msg.url : "";
      if (!targetUrl) {
        sendResponse({ ok: false, error: "Missing image URL" });
        return;
      }
      try {
        const { buffer, mime, size } = await fetchInstagramImageBytes(targetUrl);
        const bytes = new Uint8Array(buffer);
        sendResponse({ ok: true, data: Array.from(bytes), mime, size });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    // Network capture actions
    if (msg.action === "getNetworkCaptureEnabled") {
      try {
        const enabled = await getNetworkCaptureEnabled();
        sendResponse({ ok: true, enabled });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "setNetworkCaptureEnabled") {
      try {
        const enabled = Boolean(msg.enabled);
        const tabId = Number(msg.tabId) || null;
        await setNetworkCaptureEnabled(enabled, tabId);
        sendResponse({ ok: true, enabled: networkCaptureEnabled });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "attachNetworkDebugger") {
      try {
        const tabId = Number(msg.tabId);
        if (!Number.isInteger(tabId) || tabId < 0) {
          sendResponse({ ok: false, error: "Invalid tab ID" });
          return;
        }
        const attached = await attachDebuggerToTab(tabId);
        sendResponse({ ok: attached });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "getCapturedImages") {
      try {
        const tabId = Number(msg.tabId);
        if (!Number.isInteger(tabId) || tabId < 0) {
          sendResponse({ ok: false, error: "Invalid tab ID" });
          return;
        }
        const images = getCapturedImagesForTab(tabId);
        sendResponse({ ok: true, images });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "getCapturedImageBytes") {
      try {
        const tabId = Number(msg.tabId);
        const hash = typeof msg.hash === "string" ? msg.hash : "";
        if (!Number.isInteger(tabId) || tabId < 0 || !hash) {
          sendResponse({ ok: false, error: "Invalid parameters" });
          return;
        }
        const result = getCapturedImageBytes(tabId, hash);
        if (!result) {
          sendResponse({ ok: false, error: "Image not found" });
          return;
        }
        sendResponse({ ok: true, data: Array.from(result.bytes), mime: result.mime });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "getCapturedImagesBytesBatch") {
      try {
        const tabId = Number(msg.tabId);
        const hashes = Array.isArray(msg.hashes) ? msg.hashes.filter(h => typeof h === "string" && h) : [];
        if (!Number.isInteger(tabId) || tabId < 0) {
          sendResponse({ ok: false, error: "Invalid tab ID" });
          return;
        }
        const results = {};
        for (const hash of hashes) {
          const data = getCapturedImageBytes(tabId, hash);
          if (data) {
            results[hash] = { data: Array.from(data.bytes), mime: data.mime };
          }
        }
        sendResponse({ ok: true, results });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (msg.action === "clearCapturedImages") {
      try {
        const tabId = Number(msg.tabId);
        if (Number.isInteger(tabId) && tabId >= 0) {
          clearCapturedImages(tabId);
        }
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    sendResponse({ ok: false, error: "Unknown message action" });
  };
  processMessage().catch((error) => {
    const message = error?.message || String(error);
    console.error("[Unshackle] onMessage rejection:", message, error);
    try {
      sendResponse({ ok: false, error: message });
    } catch { }
  });
  return true;
});
