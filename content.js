(() => {
  if (globalThis.__UNSHACKLE_CONTENT_LOADED__) {
    return;
  }
  globalThis.__UNSHACKLE_CONTENT_LOADED__ = true;
  // content.js v1.3.4
  const STATE = { images: [], lastScanAt: 0, seenKeys: new Set() };
  const AUTO = {
    enabled: false,
    handler: null,
    timer: null,
    lastRun: 0,
    intervalMs: null,
    options: {},
    lastScrollY: null,
    accumulated: 0,
    distancePx: null,
    pending: false
  };
  const DYNAMIC = { observer: null, timer: null, ignoreUntil: 0, lastOptions: null };
  function getPersistentSeenSet() {
    if (STATE.seenKeys instanceof Set) {
      return STATE.seenKeys;
    }
    STATE.seenKeys = new Set();
    return STATE.seenKeys;
  }
  // Registry for blob: URLs captured from page context. Shared across this
  // page's content scripts via a global on the isolated world.
  const BLOB_REG = (globalThis.__UNSHACKLE_BLOB_REG = globalThis.__UNSHACKLE_BLOB_REG || new Map()); // url -> { buffer, mime, size, createdAt, revoked }
  const SVG_OBJECT_URLS = (globalThis.__UNSHACKLE_SVG_URLS = globalThis.__UNSHACKLE_SVG_URLS || new Map()); // url -> timeoutId
  const SVG_OBJECT_URL_TTL = 5 * 60 * 1000; // revoke after 5 minutes if not explicitly released
  const EXTENSION_ORIGIN = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL("") : "";
  const RESERVED_FILE_NAMES = new Set([
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
  ]);
  const TRAILING_DOTS_SPACES_RE = /[. ]+$/;
  const MAX_SANITIZED_NAME = 80;
  const OVERLAY_HISTORY = [];
  const OVERLAY_PREVIEW = new Set();
  let OVERLAY_INTERACTIONS_BOUND = false;
  const YIELD_BATCH = 400;
  const MAX_BG_SCAN_NODES = 1500;
  const MAX_BG_RESULTS = 500;
  const BG_CLASS_HINT = /(bg|background|hero|banner|cover|modal|overlay|image|thumb|gallery|card|tile|masthead|header|poster|figure|photo|media|content)/i;
  const MAX_OVERLAY_SCAN_NODES = 2200;
  const MAX_OVERLAY_ACTIONS = 120;
  const MAX_DOM_ORDER_NODES = 20000;
  let DOM_ORDER_MAP = new WeakMap();
  let DOM_ORDER_COUNTER = 1;
  let DISCOVERY_SEQUENCE = 0;
  const ELEMENT_SIGNATURES = new WeakMap();
  let ELEMENT_SIGNATURE_COUNTER = 1;
  const HK_FAMILY_HEURISTICS = [
    { key: "speedbinb", detect: detectSpeedBinbMarkers },
    { key: "coreview", detect: detectCoreViewMarkers },
    { key: "madara", detect: detectMadaraMarkers },
    { key: "mangastream", detect: detectMangastreamMarkers },
    { key: "foolslide", detect: detectFoolslideMarkers }
  ];
  const HK_PAGE_CHANGE_DEBOUNCE_MS = 150;
  const HK_PAGE_CHANGE_POLL_INTERVAL = 1000;
  let hkLastNotifiedHref = (typeof location !== "undefined" && location.href) || "";
  let hkPageChangeTimer = null;
  let hkPageChangePoller = null;
  const DOM_READY_STATES = new Set(["interactive", "complete"]);
  const DOM_READY_TIMEOUT_MS = 7000;
  const INSTAGRAM_PROFILE_BLOCKLIST = new Set([
    "accounts", "account", "about", "ad", "ads", "api", "challenge", "developer",
    "direct", "directory", "explore", "graphql", "help", "legal", "node", "privacy",
    "p", "press", "reel", "reels", "stories", "story", "tv", "web"
  ]);
  const INSTAGRAM_PROFILE_CACHE = (globalThis.__UNSHACKLE_IG_PROFILE_CACHE = globalThis.__UNSHACKLE_IG_PROFILE_CACHE || new Map());
  const INSTAGRAM_PROFILE_PENDING = (globalThis.__UNSHACKLE_IG_PROFILE_PENDING = globalThis.__UNSHACKLE_IG_PROFILE_PENDING || new Map());
  const INSTAGRAM_PROFILE_TTL = 5 * 60 * 1000;
  const IMAGE_DIMENSION_CACHE = (globalThis.__UNSHACKLE_DIM_CACHE = globalThis.__UNSHACKLE_DIM_CACHE || new Map());
  const IMAGE_DIMENSION_TTL = 5 * 60 * 1000;

  function resetAutoScanRuntime() {
    if (AUTO.handler) {
      try { window.removeEventListener("scroll", AUTO.handler); } catch { }
    }
    if (AUTO.timer) {
      try { clearInterval(AUTO.timer); } catch { }
    }
    AUTO.handler = null;
    AUTO.timer = null;
    AUTO.intervalMs = null;
    AUTO.lastScrollY = null;
    AUTO.accumulated = 0;
    AUTO.distancePx = null;
    AUTO.lastRun = 0;
    AUTO.pending = false;
  }

  function disableAutoScan() {
    resetAutoScanRuntime();
    AUTO.enabled = false;
    AUTO.options = {};
  }

  function isDocumentReady() {
    if (typeof document === "undefined") {
      return true;
    }
    return DOM_READY_STATES.has(document.readyState);
  }

  function waitForDocumentReady(timeoutMs = DOM_READY_TIMEOUT_MS) {
    if (isDocumentReady()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener("DOMContentLoaded", onReady);
        window.removeEventListener("load", onReady);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };
      const onReady = () => cleanup();
      document.addEventListener("DOMContentLoaded", onReady, { once: true });
      window.addEventListener("load", onReady, { once: true });
      const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DOM_READY_TIMEOUT_MS;
      timer = setTimeout(cleanup, duration);
    });
  }

  function afterNextFrame() {
    return new Promise((resolve) => {
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
      if (!raf) {
        setTimeout(resolve, 32);
        return;
      }
      raf(() => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(resolve);
        } else {
          setTimeout(resolve, 16);
        }
      });
    });
  }

  function delay(ms) {
    const duration = Math.max(0, Number(ms) || 0);
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  function parseSrcsetList(value) {
    if (typeof value !== "string" || !value.length) return [];
    const entries = [];
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const segments = trimmed.split(/\s+/);
      const url = segments[0];
      if (!url) continue;
      const descriptor = segments[1] || "";
      let width = null;
      let density = null;
      if (descriptor.endsWith("w")) {
        const parsed = parseFloat(descriptor.slice(0, -1));
        if (Number.isFinite(parsed)) width = parsed;
      } else if (descriptor.endsWith("x")) {
        const parsed = parseFloat(descriptor.slice(0, -1));
        if (Number.isFinite(parsed)) density = parsed;
      }
      entries.push({ url, width, density });
    }
    return entries;
  }

  function sendExtensionMessage(payload) {
    if (!chrome?.runtime?.sendMessage) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message || String(err) });
          } else {
            resolve(response);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  function isInstagramHost(hostname) {
    if (typeof hostname !== "string" || !hostname) return false;
    return hostname.toLowerCase().endsWith("instagram.com");
  }

  function getInstagramUsernameFromLocation(urlString = null) {
    try {
      const href = typeof urlString === "string" && urlString.length ? urlString : (location?.href || "");
      if (!href) return null;
      const parsed = new URL(href);
      if (!isInstagramHost(parsed.hostname)) return null;
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (!segments.length) return null;
      const first = decodeURIComponent(segments[0]).trim();
      if (!first) return null;
      if (INSTAGRAM_PROFILE_BLOCKLIST.has(first.toLowerCase())) return null;
      if (!/^[a-z0-9._]+$/i.test(first)) return null;
      return first;
    } catch {
      return null;
    }
  }

  async function requestInstagramProfile(username) {
    if (!username) return null;
    const key = username.toLowerCase();
    const now = Date.now();
    const cached = INSTAGRAM_PROFILE_CACHE.get(key);
    if (cached && (now - cached.timestamp) < INSTAGRAM_PROFILE_TTL) {
      return cached.data;
    }
    if (INSTAGRAM_PROFILE_PENDING.has(key)) {
      return INSTAGRAM_PROFILE_PENDING.get(key);
    }
    const pending = (async () => {
      const response = await sendExtensionMessage({ action: "fetchInstagramProfile", username: key });
      if (response?.ok && response.profile) {
        const payload = {
          username: response.profile.username || key,
          profile_pic_url: response.profile.profile_pic_url || "",
          profile_pic_url_hd: response.profile.profile_pic_url_hd || ""
        };
        INSTAGRAM_PROFILE_CACHE.set(key, { timestamp: Date.now(), data: payload });
        return payload;
      }
      return null;
    })().finally(() => {
      INSTAGRAM_PROFILE_PENDING.delete(key);
    });
    INSTAGRAM_PROFILE_PENDING.set(key, pending);
    return pending;
  }

  async function probeImageDimensions(url) {
    if (typeof url !== "string" || !url) return null;
    const now = Date.now();
    const cached = IMAGE_DIMENSION_CACHE.get(url);
    if (cached && (now - cached.timestamp) < IMAGE_DIMENSION_TTL) {
      return cached.value;
    }
    const dims = await new Promise((resolve) => {
      try {
        const img = new Image();
        let done = false;
        const settle = (value) => {
          if (done) return;
          done = true;
          resolve(value);
        };
        img.onload = () => settle({ width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0 });
        img.onerror = () => settle(null);
        img.onabort = () => settle(null);
        try { img.decoding = "async"; } catch { }
        img.src = url;
        setTimeout(() => settle(null), 7000);
      } catch {
        resolve(null);
      }
    });
    IMAGE_DIMENSION_CACHE.set(url, { timestamp: now, value: dims });
    return dims;
  }

  function parseSrcset(value) {
    if (typeof value !== "string" || !value.length) return [];
    return value.split(",").map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return "";
      const spaceIdx = trimmed.indexOf(" ");
      return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    }).filter(Boolean);
  }

  function looksLikeGifSource(url, typeHint = "") {
    if (!url) return false;
    if (/\.gif(?:$|\?)/i.test(url)) return true;
    if (typeof typeHint === "string" && typeHint.toLowerCase().includes("gif")) return true;
    return false;
  }

  async function collectGifSources({ minW = 0, minH = 0 } = {}) {
    const results = [];
    const dedup = new Set();
    const nodes = [];
    try { nodes.push(...document.querySelectorAll("source")); } catch { }
    try { nodes.push(...document.querySelectorAll("video")); } catch { }
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      const typeHint = (node.getAttribute("type") || node.type || "").toLowerCase();
      const urlCandidates = new Set();
      const direct = node.currentSrc || node.src || node.getAttribute("src");
      if (direct) urlCandidates.add(direct);
      const dataSrc = node.getAttribute("data-src");
      if (dataSrc) urlCandidates.add(dataSrc);
      const srcset = node.getAttribute("srcset");
      if (srcset) {
        for (const entry of parseSrcset(srcset)) {
          if (entry) urlCandidates.add(entry);
        }
      }
      for (const raw of urlCandidates) {
        const abs = toAbsURL(raw);
        if (!abs) continue;
        if (!looksLikeGifSource(abs, typeHint)) continue;
        if (dedup.has(abs)) continue;
        dedup.add(abs);
        const dims = await probeImageDimensions(abs);
        if (!dims && (minW > 0 || minH > 0)) {
          continue;
        }
        const width = dims?.width || 0;
        const height = dims?.height || 0;
        if ((minW > 0 && width && width < minW) || (minH > 0 && height && height < minH)) continue;
        let name = filenameFromURL(abs);
        if (!name) {
          name = "image.gif";
        } else if (!/\.gif$/i.test(name)) {
          const dot = name.lastIndexOf(".");
          name = dot > 0 ? `${name.slice(0, dot)}.gif` : `${name}.gif`;
        }
        const item = {
          kind: "img",
          type: "gifSource",
          rawUrl: abs,
          url: abs,
          width,
          height,
          filename: sanitizeName(name)
        };
        const signature = getElementSignature(node, "gifSource");
        if (signature) item.sourceId = signature;
        stampDiscoveryMeta(item, node);
        results.push(item);
      }
    }
    return results;
  }

  async function collectInstagramProfileExtras({ minW = 0, minH = 0, allowImages = true } = {}) {
    if (!allowImages) return [];
    const username = getInstagramUsernameFromLocation();
    if (!username) return [];
    const profile = await requestInstagramProfile(username);
    if (!profile) return [];
    const url = profile.profile_pic_url_hd || profile.profile_pic_url;
    if (!url) return [];
    const abs = toAbsURL(url) || url;
    if (!abs) return [];
    const fetched = await fetchImageAsDataUrl(abs, { mimeHint: "image/jpeg" });
    if (!fetched || !fetched.url) return [];
    let dims = await probeImageDimensions(fetched.url);
    if (!dims && (minW > 0 || minH > 0)) {
      return [];
    }
    const width = dims?.width || 0;
    const height = dims?.height || 0;
    if ((minW > 0 && width && width < minW) || (minH > 0 && height && height < minH)) return [];
    let name = filenameFromURL(abs);
    if (!name || !/\./.test(name)) {
      name = `${username}-profile.jpg`;
    }
    const item = {
      kind: "img",
      type: "instagramProfile",
      rawUrl: fetched.url,
      url: fetched.url,
      width,
      height,
      filename: sanitizeName(name),
      sourceId: `instagram-profile:${username.toLowerCase()}`
    };
    if (fetched.mime) item.mime = fetched.mime;
    if (fetched.size) item.size = fetched.size;
    item.remoteUrl = abs;
    stampDiscoveryMeta(item, null);
    return [item];
  }

  async function fetchImageAsDataUrl(resourceUrl, { mimeHint = "image/jpeg" } = {}) {
    if (typeof resourceUrl !== "string" || !resourceUrl.length) return null;
    try {
      const response = await sendExtensionMessage({ action: "fetchRemoteImage", url: resourceUrl });
      if (response?.ok && Array.isArray(response.data)) {
        const bytes = new Uint8Array(response.data);
        const dataUrl = await arrayBufferToDataURL(bytes.buffer, response.mime || mimeHint);
        if (dataUrl) {
          return {
            url: dataUrl,
            mime: response.mime || mimeHint,
            size: response.size || bytes.byteLength
          };
        }
      }
    } catch (err) {
      console.warn("[Scan] background image fetch failed", err);
    }
    try {
      const res = await fetch(resourceUrl, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status}`);
      }
      const blob = await res.blob();
      const mime = blob.type || mimeHint;
      const size = typeof blob.size === "number" ? blob.size : 0;
      const buffer = await blob.arrayBuffer();
      const dataUrl = await arrayBufferToDataURL(buffer, mime);
      if (!dataUrl) return null;
      return { url: dataUrl, mime, size: size || buffer.byteLength || 0 };
    } catch (err) {
      console.warn("[Scan] fetchImageAsDataUrl failed", err);
      return null;
    }
  }

  async function ensureDomReadyForDetection(timeoutMs = DOM_READY_TIMEOUT_MS) {
    await waitForDocumentReady(timeoutMs);
    await afterNextFrame();
  }

  function resetDomOrderMap() {
    DOM_ORDER_MAP = new WeakMap();
    DOM_ORDER_COUNTER = 1;
    const root = document.body || document.documentElement;
    if (!root) return;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let inspected = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node instanceof Element) {
          DOM_ORDER_MAP.set(node, DOM_ORDER_COUNTER++);
        }
        inspected++;
        if (inspected >= MAX_DOM_ORDER_NODES) break;
      }
    } catch { }
  }

  function getDomOrder(el) {
    if (!el || typeof el !== "object") return Number.MAX_SAFE_INTEGER;
    let idx = DOM_ORDER_MAP.get(el);
    if (typeof idx === "number") return idx;
    idx = DOM_ORDER_COUNTER++;
    DOM_ORDER_MAP.set(el, idx);
    return idx;
  }

  function getElementSignature(el, namespace = "default") {
    if (!el || typeof el !== "object") return null;
    let bucket = ELEMENT_SIGNATURES.get(el);
    if (!bucket) {
      bucket = Object.create(null);
      ELEMENT_SIGNATURES.set(el, bucket);
    }
    if (!bucket[namespace]) {
      bucket[namespace] = `${namespace}:${ELEMENT_SIGNATURE_COUNTER++}`;
    }
    return bucket[namespace];
  }

  function resetDiscoverySequence() {
    DISCOVERY_SEQUENCE = 0;
  }

  function stampDiscoveryMeta(item, el) {
    if (!item || typeof item !== "object") return item;
    const order = getDomOrder(el);
    if (Number.isFinite(order)) item.__domOrder = order;
    item.__discoverySeq = ++DISCOVERY_SEQUENCE;
    return item;
  }

  function compareByDomOrder(a, b) {
    const ao = Number.isFinite(a?.__domOrder) ? a.__domOrder : Number.MAX_SAFE_INTEGER;
    const bo = Number.isFinite(b?.__domOrder) ? b.__domOrder : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    const as = Number.isFinite(a?.__discoverySeq) ? a.__discoverySeq : Number.MAX_SAFE_INTEGER;
    const bs = Number.isFinite(b?.__discoverySeq) ? b.__discoverySeq : Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    const af = typeof a?.filename === "string" ? a.filename : "";
    const bf = typeof b?.filename === "string" ? b.filename : "";
    return af.localeCompare(bf);
  }

  function emitScanProgress(scanId, payload = {}) {
    if (!Number.isFinite(scanId)) return;
    if (!chrome?.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage({
        action: "SCAN_PROGRESS",
        scanId,
        forwarded: false,
        ...payload,
        timestamp: Date.now()
      });
    } catch { }
  }
  const ESSENTIAL_TAGS = /^(MAIN|NAV|HEADER|FOOTER|VIDEO|AUDIO|DIALOG)$/;
  const ESSENTIAL_ROLES = /^(dialog|navigation|main|search|banner|alertdialog)$/i;
  const CANVAS_NAME_CACHE = (globalThis.__UNSHACKLE_CANVAS_NAME_CACHE = globalThis.__UNSHACKLE_CANVAS_NAME_CACHE || {
    counter: 1,
    hashToName: new Map(),
    nameToHash: new Map()
  });
  // Note: Auto Canvas Watcher removed (cleanup). Canvas capture remains available
  // via the dedicated Canvas button and the canvas scan modes.

  // Bridge is now injected at document_start by bridge_inject.js. No-op here.

  // (Auto canvas watch removed)

  const toAbsURL = (url) => { try { return new URL(url, location.href).href; } catch { return null; } };
  const filenameFromURL = (url) => { try { const { pathname } = new URL(url); const base = pathname.split("/").pop() || "image"; return base.split("?")[0].split("#")[0]; } catch { return "image"; } };
  const sanitizeName = (name) => {
    const fallback = "image";
    let value = (name || fallback).replace(/[^a-z0-9._-]+/gi, "_");
    value = value.replace(TRAILING_DOTS_SPACES_RE, "");
    value = value.replace(/^\.+/, "");
    if (!value) value = fallback;
    const dot = value.lastIndexOf(".");
    let stem = dot > 0 ? value.slice(0, dot) : value;
    let ext = dot > 0 ? value.slice(dot + 1) : "";
    if (!stem) stem = fallback;
    if (RESERVED_FILE_NAMES.has(stem.toLowerCase())) stem = `_${stem}`;
    if (stem.length > MAX_SANITIZED_NAME) stem = stem.slice(0, MAX_SANITIZED_NAME);
    if (ext.length > 12) ext = ext.slice(0, 12);
    const combined = ext ? `${stem}.${ext}` : stem;
    return combined || fallback;
  };

  function getCanonicalCanvasName(hash) {
    const key = (typeof hash === "string" && hash.length) ? hash : null;
    if (key && CANVAS_NAME_CACHE.hashToName.has(key)) {
      return CANVAS_NAME_CACHE.hashToName.get(key);
    }
    let name;
    do {
      name = `Canvas_${String(CANVAS_NAME_CACHE.counter++).padStart(2, "0")}`;
    } while (CANVAS_NAME_CACHE.nameToHash.has(name));
    CANVAS_NAME_CACHE.nameToHash.set(name, key);
    if (key) CANVAS_NAME_CACHE.hashToName.set(key, name);
    return name;
  }

  function getCanvasFilename(hash, ext = "png") {
    const canonicalName = getCanonicalCanvasName(hash);
    let safeExt = (typeof ext === "string" && ext.trim().length) ? ext.trim().toLowerCase() : "png";
    safeExt = safeExt.replace(/[^a-z0-9]/gi, "");
    if (!safeExt) safeExt = "png";
    const filename = sanitizeName(`${canonicalName}.${safeExt}`);
    return { canonicalName, filename, ext: safeExt };
  }

  globalThis.__UnshackleGetCanvasName = getCanonicalCanvasName;
  globalThis.__UnshackleGetCanvasFilename = getCanvasFilename;
  initHKPageChangeObservers();

  function getDocumentScrollY() {
    try {
      if (typeof window.scrollY === "number") return window.scrollY;
      const doc = document.documentElement;
      if (doc && typeof doc.scrollTop === "number") return doc.scrollTop;
      const body = document.body;
      if (body && typeof body.scrollTop === "number") return body.scrollTop;
    } catch { }
    return 0;
  }

  function notifyHKPageChange(reason) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
    const href = typeof location !== "undefined" ? location.href : "";
    if (!href || href === hkLastNotifiedHref) return;
    hkLastNotifiedHref = href;
    try {
      chrome.runtime.sendMessage({ type: "HK_PAGE_CHANGED", url: href, reason });
    } catch { }
  }

  function scheduleHKPageChange(reason) {
    if (hkPageChangeTimer) {
      clearTimeout(hkPageChangeTimer);
    }
    hkPageChangeTimer = setTimeout(() => {
      hkPageChangeTimer = null;
      notifyHKPageChange(reason);
    }, HK_PAGE_CHANGE_DEBOUNCE_MS);
  }

  function hookHistoryMethod(method) {
    try {
      const original = history?.[method];
      if (typeof original !== "function") return;
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleHKPageChange(method);
        return result;
      };
    } catch { }
  }

  function initHKPageChangeObservers() {
    if (typeof window === "undefined") return;
    hookHistoryMethod("pushState");
    hookHistoryMethod("replaceState");
    window.addEventListener("popstate", () => scheduleHKPageChange("popstate"));
    window.addEventListener("hashchange", () => scheduleHKPageChange("hashchange"));
    if (hkPageChangePoller) {
      clearInterval(hkPageChangePoller);
    }
    hkPageChangePoller = setInterval(() => {
      if (typeof location === "undefined") return;
      if (location.href !== hkLastNotifiedHref) {
        scheduleHKPageChange("poll");
      }
    }, HK_PAGE_CHANGE_POLL_INTERVAL);
  }

  function scheduleDynamicScan(reason) {
    if (!DYNAMIC.lastOptions) return;
    if (DYNAMIC.timer) return;
    DYNAMIC.timer = setTimeout(() => {
      DYNAMIC.timer = null;
      try {
        const opts = { ...DYNAMIC.lastOptions, __fromDynamic: true };
        scanForImagesConcurrent(opts).catch(() => { });
      } catch { }
    }, reason === "mutation" ? 700 : 400);
  }

  function ensureDynamicObserver() {
    if (DYNAMIC.observer || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      if (!DYNAMIC.lastOptions) return;
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      if (DYNAMIC.ignoreUntil && now < DYNAMIC.ignoreUntil) return;
      let trigger = false;
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          trigger = true;
        }
        if (mutation.addedNodes && mutation.addedNodes.length) {
          for (const node of mutation.addedNodes) {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node;
            const tag = el.tagName;
            if (tag && ["IMG", "PICTURE", "CANVAS", "SVG", "VIDEO", "SOURCE"].includes(tag)) {
              trigger = true;
              break;
            }
            if (typeof el.querySelector === "function") {
              if (el.querySelector("img, picture, canvas, svg, video")) {
                trigger = true;
                break;
              }
            }
          }
        }
        if (trigger) break;
      }
      if (trigger) {
        scheduleDynamicScan("mutation");
      }
    });
    observer.observe(document.documentElement || document.body || document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-src", "data-srcset", "style"] });
    DYNAMIC.observer = observer;
  }

  async function hashDataURL(dataUrl) {
    try {
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
      const idx = dataUrl.indexOf(",");
      if (idx === -1) return null;
      const meta = dataUrl.slice(0, idx);
      const payload = dataUrl.slice(idx + 1);
      let bytes;
      if (meta.includes(";base64")) {
        const bin = atob(payload);
        const len = bin.length;
        bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      } else if (typeof TextEncoder !== "undefined") {
        bytes = new TextEncoder().encode(decodeURIComponent(payload));
      } else {
        const decoded = decodeURIComponent(payload);
        const tmp = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) tmp[i] = decoded.charCodeAt(i) & 0xff;
        bytes = tmp;
      }
      if (crypto?.subtle?.digest) {
        const digest = await crypto.subtle.digest("SHA-1", bytes);
        return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
      }
      let hash = 0;
      for (let i = 0; i < bytes.length; i++) {
        hash = (hash * 31 + bytes[i]) >>> 0;
      }
      return hash.toString(16);
    } catch {
      return null;
    }
  }

  function hashTextFast(text) {
    if (typeof text !== "string" || !text.length) return null;
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  async function hashArrayBuffer(buffer) {
    if (!buffer) return null;
    try {
      if (crypto?.subtle?.digest) {
        const digest = await crypto.subtle.digest("SHA-1", buffer);
        return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
      }
    } catch { }
    let view;
    if (buffer instanceof ArrayBuffer) {
      view = new Uint8Array(buffer);
    } else if (ArrayBuffer.isView(buffer)) {
      view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      return null;
    }
    let hash = 0;
    for (let i = 0; i < view.length; i++) {
      hash = (hash * 31 + view[i]) >>> 0;
    }
    return hash.toString(16);
  }

  async function canvasToPNGBlob(canvas) {
    if (!canvas) return null;
    if (typeof canvas.toBlob === "function") {
      return await new Promise((resolve) => {
        try {
          canvas.toBlob((blob) => resolve(blob || null), "image/png");
        } catch {
          resolve(null);
        }
      });
    }
    try {
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl) return null;
      const comma = dataUrl.indexOf(",");
      if (comma < 0) return null;
      const header = dataUrl.slice(0, comma);
      const mimeMatch = header.match(/data:([^;]+)/i);
      const mime = mimeMatch ? mimeMatch[1] : "image/png";
      const binary = atob(dataUrl.slice(comma + 1));
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch {
      return null;
    }
  }

  async function snapshotCanvasElement(canvas) {
    // Capture canvases as blob URLs to avoid gigantic message payloads when
    // auto-scanning many frames. Bytes are kept in BLOB_REG for hydration.
    let blob = null;
    try {
      blob = await canvasToPNGBlob(canvas);
    } catch { }
    if (!blob) return null;
    const mime = blob.type || "image/png";
    const size = typeof blob.size === "number" ? blob.size : 0;
    let buffer = null;
    try {
      buffer = await blob.arrayBuffer();
    } catch { }
    let hash = null;
    if (buffer) {
      try {
        hash = await hashArrayBuffer(buffer);
      } catch { }
    }
    let url = null;
    try {
      url = URL.createObjectURL(blob);
    } catch { }
    // If object URL creation fails, fall back to a data URL so callers still get a value.
    if (!url && buffer) {
      url = await arrayBufferToDataURL(buffer, mime);
    }
    if (!url) {
      try {
        url = canvas.toDataURL("image/png");
      } catch { }
    }
    if (!url) return null;
    if (!hash && url.startsWith("data:")) {
      try {
        hash = await hashDataURL(url);
      } catch { }
    }
    if (url.startsWith("blob:")) {
      let storedBuffer = buffer;
      try {
        if (storedBuffer && typeof storedBuffer.slice === "function") {
          storedBuffer = storedBuffer.slice(0);
        }
      } catch { }
      BLOB_REG.set(url, {
        buffer: storedBuffer || null,
        mime,
        size: size || (storedBuffer ? storedBuffer.byteLength || 0 : 0),
        createdAt: Date.now(),
        revoked: false
      });
      rememberObjectUrl(url);
    }
    return {
      url,
      rawUrl: url,
      hash,
      width: canvas.width,
      height: canvas.height,
      mime,
      size: size || (buffer ? buffer.byteLength || 0 : 0)
    };
  }

  function rememberObjectUrl(url) {
    if (!url) return;
    const existing = SVG_OBJECT_URLS.get(url);
    if (existing) clearTimeout(existing);
    const timeoutId = setTimeout(() => { releaseSvgObjectUrl(url); }, SVG_OBJECT_URL_TTL);
    SVG_OBJECT_URLS.set(url, timeoutId);
    return timeoutId;
  }

  function trackSvgObjectUrl(url, serialized, blobSize) {
    if (!url) return;
    try {
      let buffer = null;
      if (typeof serialized === "string" && serialized.length) {
        try {
          if (typeof TextEncoder !== "undefined") {
            buffer = new TextEncoder().encode(serialized);
          } else {
            const tmp = new Uint8Array(serialized.length);
            for (let i = 0; i < serialized.length; i++) tmp[i] = serialized.charCodeAt(i) & 0xff;
            buffer = tmp;
          }
        } catch { }
      }
      if (buffer) {
        const slice = buffer.buffer.slice(buffer.byteOffset || 0, (buffer.byteOffset || 0) + buffer.byteLength);
        BLOB_REG.set(url, { buffer: slice, mime: "image/svg+xml", size: slice.byteLength, createdAt: Date.now(), revoked: false });
      } else if (!BLOB_REG.has(url)) {
        BLOB_REG.set(url, { buffer: null, mime: "image/svg+xml", size: blobSize || 0, createdAt: Date.now(), revoked: false });
      }
    } catch { }
    rememberObjectUrl(url);
  }

  function releaseSvgObjectUrl(url) {
    if (!url) return false;
    let released = false;
    const timer = SVG_OBJECT_URLS.get(url);
    if (timer) {
      clearTimeout(timer);
      SVG_OBJECT_URLS.delete(url);
      released = true;
    }
    if (BLOB_REG.has(url)) {
      BLOB_REG.delete(url);
      released = true;
    }
    try {
      URL.revokeObjectURL(url);
      released = true;
    } catch { }
    return released;
  }

  function releaseSvgObjectUrls(urls) {
    if (!Array.isArray(urls) || !urls.length) return 0;
    let released = 0;
    for (const url of urls) {
      if (releaseSvgObjectUrl(url)) released++;
    }
    return released;
  }

  async function cooperativeYield() {
    await new Promise((resolve) => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => resolve(), { timeout: 80 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  async function blobUrlToDataURL(blobUrl) {
    try {
      const res = await fetch(blobUrl);
      const blob = await res.blob();
      return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
    } catch { return null; }
  }

  async function blobUrlToArrayBuffer(blobUrl, sizeLimit = Infinity) {
    try {
      const res = await fetch(blobUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      const size = typeof blob.size === "number" ? blob.size : 0;
      if (size > sizeLimit) {
        return {
          buffer: null,
          mime: blob.type || "",
          size,
          oversized: true
        };
      }
      const buffer = await blob.arrayBuffer();
      return {
        buffer,
        mime: blob.type || "",
        size
      };
    } catch {
      return null;
    }
  }

  async function collectBlobPayload(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.startsWith("blob:")) return null;
    const SIZE_LIMIT = 25 * 1024 * 1024;
    const tooLarge = (size, mime) => ({ tooLarge: true, size, mime: mime || "application/octet-stream" });
    const buildPayload = async (buffer, mimeHint, sizeHint) => {
      try {
        if (!buffer) return null;
        const mime = mimeHint || "application/octet-stream";
        const dataUrl = await arrayBufferToDataURL(buffer, mime);
        if (!dataUrl) return null;
        return {
          dataUrl,
          mime,
          size: sizeHint || buffer.byteLength || 0
        };
      } catch {
        return null;
      }
    };
    const reg = BLOB_REG.get(rawUrl);
    if (reg && reg.buffer) {
      const size = reg.size || (reg.buffer.byteLength || 0);
      if (size > SIZE_LIMIT) return tooLarge(size, reg.mime);
      const payload = await buildPayload(reg.buffer, reg.mime, size);
      if (payload) return payload;
    }
    const fetched = await blobUrlToArrayBuffer(rawUrl, SIZE_LIMIT);
    if (fetched) {
      if (fetched.oversized) return tooLarge(fetched.size, fetched.mime);
      if (fetched.buffer) {
        const payload = await buildPayload(fetched.buffer, fetched.mime, fetched.size);
        if (payload) return payload;
      }
    }
    const fallback = await blobUrlToDataURL(rawUrl);
    if (fallback) {
      return {
        dataUrl: fallback,
        mime: (reg && reg.mime) || "application/octet-stream",
        size: (reg && reg.size) || 0
      };
    }
    return null;
  }

  async function arrayBufferToDataURL(buffer, mime = 'application/octet-stream') {
    try {
      const blob = new Blob([buffer], { type: mime });
      const r = new FileReader();
      return await new Promise((res, rej) => { r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    } catch { return null; }
  }

  // ---- Overlay keywords loader ----
  let __OVERLAY_KEYWORDS_CACHE = null;
  async function loadOverlayKeywordsFromMD() {
    if (Array.isArray(__OVERLAY_KEYWORDS_CACHE) && __OVERLAY_KEYWORDS_CACHE.length) return __OVERLAY_KEYWORDS_CACHE;
    try {
      const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('overlay_keywords.md')
        : null;
      if (!url) throw new Error('no runtime url');
      const res = await fetch(url);
      const text = await res.text();
      const set = new Set();
      let inCodeBlock = false;

      for (const rawLine of text.split(/\r?\n/)) {
        const line = String(rawLine || '').trim();
        if (!line) continue;

        // Toggle code block state on backtick fences
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          continue;
        }

        // Skip markdown headers and separators
        if (line.startsWith('#') || line.includes('---')) continue;

        // Table format: |keyword|category|description|
        if (line[0] === '|') {
          const cells = line.split('|').map(s => s.trim()).filter(Boolean);
          if (cells.length) {
            const key = String(cells[0] || '').trim().toLowerCase();
            if (key && !key.startsWith('#')) set.add(key);
          }
          continue;
        }

        // Simple list format (inside code block or plain text)
        // Accept lines that look like keywords (alphanumeric with dashes/underscores)
        if (inCodeBlock || /^[a-z0-9_-]+$/i.test(line)) {
          const key = line.toLowerCase();
          if (key && key.length >= 2 && key.length <= 50) {
            set.add(key);
          }
        }
      }

      const arr = Array.from(set);
      __OVERLAY_KEYWORDS_CACHE = arr.length ? arr : DEFAULT_OVERLAY_KEYWORDS;
      return __OVERLAY_KEYWORDS_CACHE;
    } catch {
      __OVERLAY_KEYWORDS_CACHE = DEFAULT_OVERLAY_KEYWORDS;
      return __OVERLAY_KEYWORDS_CACHE;
    }
  }

  function clearOverlayPreview() {
    if (!OVERLAY_PREVIEW.size) return;
    OVERLAY_PREVIEW.forEach((el) => {
      if (!el) return;
      try {
        const prev = el.dataset.unshacklePreviewOutline;
        const prevShadow = el.dataset.unshacklePreviewShadow;
        const prevBg = el.dataset.unshacklePreviewBg;

        if (prev !== undefined) {
          if (prev === "__none__") el.style.removeProperty("outline");
          else el.style.setProperty("outline", prev);
          delete el.dataset.unshacklePreviewOutline;
        } else {
          el.style.removeProperty("outline");
        }

        if (prevShadow !== undefined) {
          if (prevShadow === "__none__") el.style.removeProperty("box-shadow");
          else el.style.setProperty("box-shadow", prevShadow);
          delete el.dataset.unshacklePreviewShadow;
        } else {
          el.style.removeProperty("box-shadow");
        }

        if (prevBg !== undefined) {
          if (prevBg === "__none__") el.style.removeProperty("background");
          else el.style.setProperty("background", prevBg);
          delete el.dataset.unshacklePreviewBg;
        } else {
          el.style.removeProperty("background");
        }
        el.removeAttribute("data-unshackle-preview");
      } catch { }
    });
    OVERLAY_PREVIEW.clear();
  }

  function captureOverlayState(el) {
    return {
      el,
      parent: el.parentElement,
      nextSibling: el.nextSibling,
      prevStyle: el.getAttribute("style"),
      removed: false,
      flag: ""
    };
  }

  function restoreOverlayChange(entry) {
    if (!entry || !entry.el) return false;
    const { el, parent, nextSibling, prevStyle, removed } = entry;
    try {
      if (removed && parent) {
        parent.insertBefore(el, nextSibling || null);
      }
      if (prevStyle == null) el.removeAttribute("style");
      else el.setAttribute("style", prevStyle);
      el.removeAttribute("data-unshackle-hidden");
      el.removeAttribute("data-unshackle-softened");
      return true;
    } catch {
      return false;
    }
  }

  function bindOverlayInteractions() {
    if (OVERLAY_INTERACTIONS_BOUND) return;
    OVERLAY_INTERACTIONS_BOUND = true;
    ["contextmenu", "dragstart", "selectstart", "mousedown", "mouseup", "click"].forEach((t) => {
      document.addEventListener(t, (ev) => {
        if (!ev) return;
        ev.stopPropagation();
      }, { capture: true, passive: true });
    });
  }

  async function findOverlayCandidates(opts = {}) {
    const minCoverage = opts.minCoverage ?? 0.55;
    const minZ = opts.minZ ?? 999;
    const maxCandidates = Math.min(
      typeof opts.maxCandidates === "number" && opts.maxCandidates > 0 ? opts.maxCandidates : MAX_OVERLAY_ACTIONS,
      MAX_OVERLAY_ACTIONS
    );
    const out = [];
    const vw = Math.max(1, innerWidth * innerHeight);
    const walker = document.body ? document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT) : null;
    if (!walker) return out;
    let inspected = 0;
    while (walker.nextNode()) {
      inspected++;
      if (inspected > MAX_OVERLAY_SCAN_NODES) break;
      if ((inspected % YIELD_BATCH) === 0) await cooperativeYield();
      const node = walker.currentNode;
      if (!(node instanceof HTMLElement)) continue;
      const el = node;
      const tag = (el.tagName || "").toUpperCase();
      if (ESSENTIAL_TAGS.test(tag)) continue;
      if (/(IMG|CANVAS|SVG|PICTURE)/.test(tag)) continue;
      if (el.closest("video, audio, iframe, object")) continue;
      const role = String(el.getAttribute("role") || "").toLowerCase();
      if (ESSENTIAL_ROLES.test(role)) continue;
      if (el.getAttribute("aria-modal") === "true") continue;
      if (el.dataset && el.dataset.unshackleKeep === "1") continue;
      const cs = getComputedStyle(el);
      if (!cs) continue;
      const pos = cs.position;
      if (!(pos === "fixed" || pos === "absolute" || pos === "sticky")) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const coverage = (Math.max(0, Math.min(r.width, innerWidth)) * Math.max(0, Math.min(r.height, innerHeight))) / vw;
      if (coverage < minCoverage) continue;
      const zVal = parseFloat(cs.zIndex || "0") || 0;
      if (zVal < minZ && coverage < 0.75) continue;
      out.push({ el, coverage, z: zVal });
      if (out.length >= maxCandidates) break;
    }
    return out;
  }

  async function previewOverlays(opts = {}) {
    clearOverlayPreview();
    const list = await findOverlayCandidates({ ...opts, maxCandidates: opts.maxCandidates ?? 60 });
    list.forEach(({ el }) => {
      try {
        const current = el.style.getPropertyValue("outline") || "";
        const currentShadow = el.style.getPropertyValue("box-shadow") || "";
        const currentBg = el.style.getPropertyValue("background") || "";

        el.dataset.unshacklePreviewOutline = current ? current : "__none__";
        el.dataset.unshacklePreviewShadow = currentShadow ? currentShadow : "__none__";
        el.dataset.unshacklePreviewBg = currentBg ? currentBg : "__none__";

        el.style.setProperty("outline", "4px solid #ff0000", "important");
        // Add double box shadow (inset and outset) to ensure visibility even if clipped
        el.style.setProperty("box-shadow", "inset 0 0 0 4px #ff0000, 0 0 0 4px #ff0000", "important");
        // Add striped red background
        el.style.setProperty("background", "repeating-linear-gradient(45deg, rgba(255, 0, 0, 0.1), rgba(255, 0, 0, 0.1) 10px, rgba(255, 0, 0, 0.2) 10px, rgba(255, 0, 0, 0.2) 20px)", "important");

        el.setAttribute("data-unshackle-preview", "1");
        OVERLAY_PREVIEW.add(el);
      } catch { }
    });
    return { ok: true, count: list.length };
  }

  function undoOverlayCleanup() {
    clearOverlayPreview();
    const last = OVERLAY_HISTORY.pop();
    if (!last) return { ok: false, restored: 0 };
    let restored = 0;
    for (const entry of last.items || []) {
      if (restoreOverlayChange(entry)) restored++;
    }
    return { ok: true, restored };
  }

  // List of default overlay keywords used for automatic removal. These cover common
  // class/id names seen on blocker overlays (lightbox, subscribe walls, etc.).
  const DEFAULT_OVERLAY_KEYWORDS = [
    // Core overlay terms
    "overlay", "cover", "wrapper", "wrap", "shield", "modal", "popup",
    "backdrop", "scrim", "dimmer", "veil", "curtain", "mask", "shade",
    "blocker", "guard", "pane", "glass", "glasspane", "fog", "blackout",
    // Subscription/paywall patterns
    "subscribe", "paywall", "paywalled", "hard-paywall", "soft-paywall",
    "consent", "banner", "promo", "signup", "newsletter", "interstitial",
    // Cookie/GDPR patterns
    "cookie", "gdpr", "cookie-banner", "cookie-notice", "cookieconsent",
    "onetrust", "osano", "cmplz", "cky-consent", "eu-cookie",
    // Framework-specific (Angular CDK, Material, Ant Design, Vue, etc.)
    "cdk-overlay", "muibackdrop", "muidialog", "ant-modal", "ant-drawer",
    "v-overlay", "swal2", "fancybox", "lightbox", "mfp-bg", "mfp-wrap",
    "reveal-overlay", "lean-overlay", "ui-widget-overlay",
    // Ad/blocker patterns
    "ad", "adblock", "adblock-modal", "adblock-overlay",
    // Click/event blockers
    "click-blocker", "click-catcher", "click-guard", "click-capture",
    "pointer-blocker", "event-blocker", "tap-blocker",
    // Protection patterns
    "no-copy", "nocopy", "no-download", "nodownload", "no-save", "nosave",
    "anti-copy", "prevent-download", "image-protect", "canvas-protect",
    // Misc
    "gate", "gateway", "lock", "locked", "restricted", "protected",
    "challenge", "captcha", "spinner-backdrop", "loading-overlay"
  ];

  // Suffix patterns - class/id ending with these are likely overlays
  const OVERLAY_SUFFIX_PATTERNS = [
    "-overlay", "-wrapper", "-mask", "-cover", "-scrim", "-dimmer",
    "-veil", "-curtain", "-shield", "-guard", "-blocker", "-backdrop",
    "-pane", "-layer", "-modal", "-popup", "-banner", "-shade"
  ];

  // Prefix patterns - class/id starting with these are likely overlays
  const OVERLAY_PREFIX_PATTERNS = [
    "overlay-", "modal-", "popup-", "paywall-", "cookie-", "consent-",
    "backdrop-", "mask-", "cover-", "shield-", "blocker-", "cdk-overlay"
  ];

  // ---- Keyword overlay remover ----
  async function nukeByKeywords(keywords = [], opts = {}) {
    const keys = (keywords || []).map(k => String(k || "").trim().toLowerCase()).filter(Boolean);
    if (!keys.length) return { ok: true, removed: 0, softened: 0, records: [], totalMatched: 0 };
    const touched = opts.touched instanceof Set ? opts.touched : new Set();
    const mode = opts.preview === true ? "preview" : (opts.remove === true || opts.mode === "hard" ? "hard" : "soft");
    const maxAffect = Math.min(Number(opts.maxAffect) || MAX_OVERLAY_ACTIONS, MAX_OVERLAY_ACTIONS * 2);
    const previewOnly = mode === "preview";
    let removed = 0;
    let softened = 0;
    let affected = 0;
    let totalMatched = 0;
    const records = [];
    const generic = new Set(["wrap", "wrapper", "cover"]);
    const walker = document.body ? document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT) : null;
    if (!walker) return { ok: true, removed: 0, softened: 0, records: [], totalMatched: 0 };
    let inspected = 0;
    while (walker.nextNode()) {
      inspected++;
      if (inspected > MAX_OVERLAY_SCAN_NODES) break;
      if ((inspected % YIELD_BATCH) === 0) await cooperativeYield();
      const node = walker.currentNode;
      if (!(node instanceof HTMLElement)) continue;
      const el = node;
      if (touched.has(el)) continue;
      const tag = (el.tagName || "").toUpperCase();
      if (ESSENTIAL_TAGS.test(tag)) continue;
      if (/(IMG|CANVAS|SVG|PICTURE|VIDEO|AUDIO)/.test(tag)) continue;
      const role = String(el.getAttribute("role") || "").toLowerCase();
      if (ESSENTIAL_ROLES.test(role)) continue;
      if (el.getAttribute("aria-modal") === "true") continue;
      if (el.closest("main, nav, header, footer, video, audio, dialog, [data-focus-lock-disabled=true]")) continue;
      if (touched.has(el)) continue;
      const cs = getComputedStyle(el);
      if (!cs) continue;
      const pos = cs.position;
      if (!(pos === "fixed" || pos === "absolute" || pos === "sticky")) continue;
      const className = (el.getAttribute("class") || "").toLowerCase();
      const idName = (el.getAttribute("id") || "").toLowerCase();
      const sample = [
        el.innerText || "",
        className,
        idName,
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("alt") || "",
        el.getAttribute("role") || "",
        el.tagName || ""
      ].join(" ").toLowerCase();

      // Check for keyword matches
      let matched = null;
      for (const k of keys) {
        if (k && sample.includes(k)) { matched = k; break; }
      }

      // If no keyword match, check for suffix/prefix patterns on class/id
      if (!matched) {
        const classTokens = className.split(/\s+/).filter(Boolean);
        const idTokens = idName ? [idName] : [];
        const allTokens = [...classTokens, ...idTokens];

        // Check suffix patterns (e.g., "custom-overlay", "xyz-modal")
        for (const token of allTokens) {
          for (const suffix of OVERLAY_SUFFIX_PATTERNS) {
            if (token.endsWith(suffix)) {
              matched = `pattern:${suffix}`;
              break;
            }
          }
          if (matched) break;
        }

        // Check prefix patterns (e.g., "overlay-content", "modal-wrapper")
        if (!matched) {
          for (const token of allTokens) {
            for (const prefix of OVERLAY_PREFIX_PATTERNS) {
              if (token.startsWith(prefix)) {
                matched = `pattern:${prefix}`;
                break;
              }
            }
            if (matched) break;
          }
        }
      }

      if (!matched) continue;
      totalMatched++;
      if (generic.has(matched)) {
        const r = el.getBoundingClientRect();
        const vw = Math.max(1, innerWidth * innerHeight);
        const coverage = (Math.max(0, Math.min(r.width, innerWidth)) * Math.max(0, Math.min(r.height, innerHeight))) / vw;
        if (coverage < 0.4) continue;
      }
      if (previewOnly) continue;
      try {
        if (affected >= maxAffect) break;
        const entry = captureOverlayState(el);
        entry.flag = mode === "hard" ? "keyword-hard" : "keyword-soft";
        if (mode === "hard") {
          entry.removed = true;
          el.remove();
          removed++;
        } else {
          el.setAttribute("data-unshackle-hidden", "1");
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("pointer-events", "none", "important");
          el.style.setProperty("opacity", "0.15", "important");
          softened++;
        }
        touched.add(el);
        records.push(entry);
        affected++;
      } catch {
        // Ignore failures but keep loop cooperative
      }
    }
    return { ok: true, removed, softened, records, totalMatched, affected, capped: totalMatched > affected };
  }

  // ---- Overlay nuker ----
  async function nukeOverlays(opts = {}) {
    clearOverlayPreview();
    const minCoverage = opts.minCoverage ?? 0.55;
    const minZ = opts.minZ ?? 999;
    const touched = new Set();
    const records = [];
    const candidates = await findOverlayCandidates({ minCoverage, minZ });
    for (const { el } of candidates) {
      if (!el || touched.has(el)) continue;
      try {
        const entry = captureOverlayState(el);
        entry.flag = "soften";
        el.setAttribute("data-unshackle-softened", "1");
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("user-select", "auto", "important");
        el.style.setProperty("backdrop-filter", "none", "important");
        el.style.setProperty("z-index", "0", "important");
        records.push(entry);
        touched.add(el);
      } catch { }
    }
    let removedCount = 0;
    let keywordSoftened = 0;
    try {
      const fileKeywords = await loadOverlayKeywordsFromMD();
      const merged = Array.from(new Set([...(fileKeywords || []), ...(opts.keywords || []), ...DEFAULT_OVERLAY_KEYWORDS]));
      const kwRes = await nukeByKeywords(merged, {
        touched,
        mode: opts.keywordMode === "hard" ? "hard" : "soft",
        maxAffect: opts.maxKeywords ?? MAX_OVERLAY_ACTIONS
      });
      if (kwRes && kwRes.ok) {
        removedCount = kwRes.removed || 0;
        keywordSoftened = kwRes.softened || 0;
        if (Array.isArray(kwRes.records) && kwRes.records.length) {
          records.push(...kwRes.records);
        }
      }
    } catch { }
    if (records.length) {
      OVERLAY_HISTORY.push({ timestamp: Date.now(), items: records });
    }
    bindOverlayInteractions();
    return {
      ok: true,
      affected: records.length,
      softened: Math.max(0, records.length - removedCount),
      removed: removedCount,
      keywordSoftened,
      capped: records.length >= MAX_OVERLAY_ACTIONS
    };
  }

  async function collectBackgroundImages({ minW = 0, minH = 0, allowKinds = {}, profile = "default" } = {}) {
    const results = [];
    const walkerRoot = document.body || document.documentElement;
    if (!walkerRoot) return results;
    const aggressive = profile === "background" || profile === "aggressive";
    const maxNodes = aggressive ? MAX_BG_SCAN_NODES * 2 : MAX_BG_SCAN_NODES;
    const maxResults = aggressive ? MAX_BG_RESULTS : Math.max(120, Math.floor(MAX_BG_RESULTS * 0.6));
    const baseMinEdge = aggressive ? Math.max(32, minW) : Math.max(64, minW);
    const inlineAreaThreshold = aggressive ? 1536 : 4096;
    const rectAreaThreshold = aggressive ? 1024 : 2048;

    const extractUrls = (value) => {
      if (typeof value !== "string" || !value.length) return [];
      const matches = value.matchAll(/url\(["']?(.+?)["']?\)/g);
      const urls = [];
      for (const match of matches) {
        if (match && match[1]) {
          urls.push(match[1]);
        }
      }
      return urls;
    };

    const shouldInspect = (el, forceRect = false) => {
      if (!(el instanceof HTMLElement)) return null;
      let rect = null;
      if (!forceRect) {
        const classHint = BG_CLASS_HINT.test(el.className || "");
        const inlineStyle = el.hasAttribute("style") ? el.getAttribute("style") || "" : "";
        const hasInlineBg = inlineStyle && /\bbackground/i.test(inlineStyle);
        const datasetHint = el.dataset && (el.dataset.bg || el.dataset.background || el.dataset.image || el.dataset.lazy || el.dataset.src);
        if (!hasInlineBg && !classHint && !datasetHint) {
          rect = el.getBoundingClientRect();
          const minEdge = baseMinEdge;
          if (rect.width < minEdge || rect.height < minEdge) return null;
          if ((rect.width * rect.height) < inlineAreaThreshold) return null;
        }
      }
      if (!rect) {
        rect = el.getBoundingClientRect();
      }
      if (!rect) return null;
      if (rect.width < minW || rect.height < minH) return null;
      if (!forceRect && (rect.width * rect.height) < rectAreaThreshold) return null;
      return rect;
    };

    const captureBackgrounds = (el, rect, { pseudo = null, forceRect = false } = {}) => {
      let cs = null;
      try {
        cs = getComputedStyle(el, pseudo || null);
      } catch {
        cs = null;
      }
      if (!cs) return 0;
      const bg = cs.getPropertyValue("background-image");
      if (!bg || bg === "none") return 0;
      if (!rect) rect = el.getBoundingClientRect();
      if (!rect) return 0;
      if (!forceRect && (rect.width * rect.height) < rectAreaThreshold) return 0;
      const urls = extractUrls(bg);
      if (!urls.length) return 0;
      let added = 0;
      for (const raw of urls) {
        const abs = toAbsURL(raw);
        if (!abs) continue;
        const kind = abs.startsWith("data:") ? "dataUri" : (abs.startsWith("blob:") ? "blob" : "background");
        if (allowKinds && allowKinds[kind] !== true) continue;
        const item = {
          kind,
          type: "background",
          rawUrl: abs,
          url: abs,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          filename: sanitizeName(filenameFromURL(abs))
        };
        const signature = getElementSignature(el, pseudo ? `bg:${pseudo}` : "bg");
        if (signature) item.sourceId = signature;
        if (pseudo) {
          item.pseudo = pseudo;
        }
        stampDiscoveryMeta(item, el);
        results.push(item);
        added++;
        if (results.length >= maxResults) {
          break;
        }
      }
      return added;
    };

    const processElement = (el, { forceRect = false, includePseudo = false } = {}) => {
      const rect = shouldInspect(el, forceRect);
      if (!rect) return;
      captureBackgrounds(el, rect, { forceRect });
      if (includePseudo) {
        captureBackgrounds(el, rect, { pseudo: "::before", forceRect: true });
        if (results.length >= maxResults) return;
        captureBackgrounds(el, rect, { pseudo: "::after", forceRect: true });
      }
    };

    const rootCandidates = [];
    if (document.documentElement) rootCandidates.push(document.documentElement);
    if (document.body && document.body !== document.documentElement) rootCandidates.push(document.body);
    for (const el of rootCandidates) {
      processElement(el, { forceRect: true, includePseudo: true });
      if (results.length >= maxResults) {
        return results.slice(0, maxResults);
      }
    }

    const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_ELEMENT);
    let inspected = 0;
    while (walker.nextNode()) {
      inspected++;
      if (inspected > maxNodes) break;
      if ((inspected % YIELD_BATCH) === 0) await cooperativeYield();
      const node = walker.currentNode;
      processElement(node, { includePseudo: aggressive });
      if (results.length >= maxResults) break;
    }
    if (results.length >= maxResults) {
      return results.slice(0, maxResults);
    }
    return results;
  }

  const CANVAS_RESULT_KINDS = new Set(["canvas"]);
  const IMAGE_RESULT_KINDS = new Set(["img", "background", "dataUri", "blob"]);

  function getResultDedupKey(item) {
    if (!item || typeof item !== "object") return null;
    if (typeof item.contentHash === "string" && item.contentHash.length) {
      return `hash:${item.contentHash}`;
    }
    if (typeof item.sourceId === "string" && item.sourceId.length) {
      return `src:${item.sourceId}`;
    }
    const kind = typeof item.kind === "string" ? item.kind : "";
    const isCanvas = CANVAS_RESULT_KINDS.has(kind);
    if (isCanvas) {
      if (typeof item.canonicalName === "string" && item.canonicalName.length) {
        return `${kind}:name:${item.canonicalName}`;
      }
      if (typeof item.filename === "string" && item.filename.length) {
        return `${kind}:${item.filename}`;
      }
    }
    if (typeof item.url === "string" && item.url.length) {
      return item.url;
    }
    if (typeof item.rawUrl === "string" && item.rawUrl.length) {
      return `raw:${item.rawUrl}`;
    }
    if (typeof item.filename === "string" && item.filename.length) {
      return `${kind}:${item.filename}`;
    }
    if (Number.isFinite(item.__domOrder)) {
      return `dom:${item.__domOrder}`;
    }
    return null;
  }

  function mergePersistentItems(previous, current, persistentKinds) {
    const hasPrev = Array.isArray(previous) && previous.length;
    const hasCurr = Array.isArray(current) && current.length;
    const kindSet = persistentKinds instanceof Set
      ? persistentKinds
      : Array.isArray(persistentKinds)
        ? new Set(persistentKinds.filter((kind) => typeof kind === "string" && kind.length))
        : persistentKinds && typeof persistentKinds === "object"
          ? new Set(Object.keys(persistentKinds))
          : new Set();
    if (!kindSet.size) {
      if (hasCurr) return current.slice();
      return hasPrev ? previous.slice() : [];
    }
    if (!hasPrev && !hasCurr) {
      return [];
    }
    const merged = [];
    const seen = new Set();
    let fallbackCounter = 0;
    const remember = (item) => {
      if (!item) return;
      let key = getResultDedupKey(item);
      if (!key) key = `__keyless:${++fallbackCounter}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    };
    if (hasCurr) {
      current.forEach(remember);
    }
    if (hasPrev) {
      previous.forEach((item) => {
        if (!item || !kindSet.has(item.kind)) return;
        remember(item);
      });
    }
    return merged;
  }

  // ---- Mode1 (Other Scan Mode) ----
  // (temporarily disabled)

  // ---- Scan ----
  async function scanForImages(options = {}) {
    resetDomOrderMap();
    resetDiscoverySequence();
    const minW = options.minWidth || 0;
    const minH = options.minHeight || 0;
    const types = Array.isArray(options.types) && options.types.length ? options.types : [
      "img", "background", "canvas", "svg", "dataUri", "blob"
    ];
    const found = [];
    const persistentSeen = getPersistentSeenSet();
    const seenCanvasHashes = new Set();

    // Helper to decide if a kind is requested
    const want = (kind) => types.includes(kind);

    // Collect images from <img> elements
    if (want("img") || want("dataUri") || want("blob")) {
      for (const img of document.images) {
        const raw = img.currentSrc || img.src; if (!raw) continue;
        const abs = toAbsURL(raw); if (!abs) continue;
        if (img.naturalWidth < minW || img.naturalHeight < minH) continue;
        const kind = (() => {
          if (abs.startsWith("data:")) return "dataUri";
          if (abs.startsWith("blob:")) return "blob";
          return "img";
        })();
        if (!want(kind)) continue;
        const item = {
          kind,
          type: "img",
          rawUrl: abs,
          url: abs,
          width: img.naturalWidth,
          height: img.naturalHeight,
          filename: sanitizeName(img.alt || filenameFromURL(abs))
        };
        const signature = getElementSignature(img, "img");
        if (signature) item.sourceId = signature;
        stampDiscoveryMeta(item, img);
        found.push(item);
      }
      if (want("img")) {
        try {
          const gifExtras = await collectGifSources({ minW, minH });
          if (gifExtras.length) {
            found.push(...gifExtras);
          }
        } catch { }
      }
      if (want("img")) {
        const ratioCache = new WeakMap();
        const getRatio = (img) => {
          if (!img) return null;
          if (ratioCache.has(img)) return ratioCache.get(img);
          const w = Number(img.naturalWidth || img.width || 0);
          const h = Number(img.naturalHeight || img.height || 0);
          const ratio = (w > 0 && h > 0) ? (h / w) : null;
          ratioCache.set(img, ratio);
          return ratio;
        };
        const appendSrcsetCandidate = (targetEl, candidateUrl, { widthHint = null, namespace = "img:srcset" } = {}) => {
          const abs = toAbsURL(candidateUrl);
          if (!abs) return;
          const ratio = targetEl instanceof HTMLImageElement ? getRatio(targetEl) : null;
          const width = widthHint || Number(targetEl?.naturalWidth || 0) || 0;
          let height = Number(targetEl?.naturalHeight || 0) || 0;
          if ((!height || !Number.isFinite(height)) && ratio && Number.isFinite(width)) {
            height = Math.round(width * ratio);
          }
          if (width && width < minW) return;
          if (height && height < minH) return;
          const item = {
            kind: "img",
            type: "img",
            rawUrl: abs,
            url: abs,
            width: width || targetEl?.naturalWidth || 0,
            height: height || targetEl?.naturalHeight || 0,
            filename: sanitizeName(targetEl?.alt || filenameFromURL(abs))
          };
          const signature = getElementSignature(targetEl, namespace);
          if (signature) item.sourceId = signature;
          stampDiscoveryMeta(item, targetEl);
          found.push(item);
        };
        for (const img of document.querySelectorAll("img[srcset]")) {
          const entries = parseSrcsetList(img.getAttribute("srcset"));
          for (const entry of entries) {
            if (!entry || !entry.url) continue;
            const widthHint = entry.width ? Math.round(entry.width) : null;
            appendSrcsetCandidate(img, entry.url, { widthHint, namespace: "img:srcset" });
          }
        }
        for (const source of document.querySelectorAll("source")) {
          const src = source.getAttribute("src");
          if (src) appendSrcsetCandidate(source, src, { namespace: "source:src" });
          const srcset = source.getAttribute("srcset");
          if (srcset) {
            const entries = parseSrcsetList(srcset);
            for (const entry of entries) {
              if (!entry || !entry.url) continue;
              const widthHint = entry.width ? Math.round(entry.width) : null;
              appendSrcsetCandidate(source, entry.url, { widthHint, namespace: "source:srcset" });
            }
          }
        }
      }
    }

    // Collect CSS background images cooperatively to avoid long main-thread blocks
    const profile = typeof options.scanProfile === "string" ? options.scanProfile : "default";
    if (want("background") || want("dataUri") || want("blob")) {
      const allowed = { background: want("background"), dataUri: want("dataUri"), blob: want("blob") };
      const bgItems = await collectBackgroundImages({ minW, minH, allowKinds: allowed, profile });
      if (bgItems.length) found.push(...bgItems);
    }

    // Collect canvas images (asynchronous snapshot)
    if (want("canvas")) {
      for (const cv of document.querySelectorAll("canvas")) {
        const w = cv.width;
        const h = cv.height;
        if (w < minW || h < minH) continue;
        const capture = await snapshotCanvasElement(cv);
        if (!capture || !capture.url) continue;
        if (capture.hash && seenCanvasHashes.has(capture.hash)) {
          releaseSvgObjectUrl(capture.url);
          continue;
        }
        if (capture.hash) seenCanvasHashes.add(capture.hash);
        const naming = getCanvasFilename(capture.hash, "png");
        const item = {
          kind: "canvas",
          type: "canvas",
          rawUrl: capture.url,
          url: capture.url,
          width: w,
          height: h,
          filename: naming.filename,
          canonicalName: naming.canonicalName,
          mime: capture.mime || "image/png",
          size: capture.size || 0
        };
        if (capture.hash) item.contentHash = capture.hash;
        stampDiscoveryMeta(item, cv);
        found.push(item);
      }
    }

    // Collect inline SVGs
    if (want("svg")) {
      for (const svg of document.querySelectorAll("svg")) {
        try {
          const r = svg.getBoundingClientRect(); if (r.width < minW || r.height < minH) continue;
          const s = new XMLSerializer().serializeToString(svg);
          const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
          const item = { kind: "svg", type: "svg", rawUrl: "", url: dataUrl, width: Math.round(r.width), height: Math.round(r.height), filename: sanitizeName("vector.svg") };
          stampDiscoveryMeta(item, svg);
          found.push(item);
        } catch { }
      }
    }

    const augmented = [];
    for (const item of found) {
      try {
        if (item.rawUrl && item.rawUrl.startsWith("blob:")) {
          const reg = BLOB_REG.get(item.rawUrl);
          if (reg) {
            augmented.push({
              ...item,
              mime: reg.mime || item.mime,
              size: reg.size || item.size || (reg.buffer ? reg.buffer.byteLength || 0 : 0)
            });
            continue;
          }
        }
      } catch { }
      augmented.push(item);
    }

    if (want("img")) {
      try {
        const igExtras = await collectInstagramProfileExtras({ minW, minH, allowImages: true });
        if (igExtras.length) {
          augmented.push(...igExtras);
        }
      } catch { }
    }

    // Deduplicate by URL for ordinary images, but keep individual canvas captures even if data matches.
    const seen = new Set();
    const unique = [];
    let dedupFallback = 0;
    for (const it of augmented) {
      let key = getResultDedupKey(it);
      const hasStableKey = typeof key === "string" && key.length > 0;
      if (!hasStableKey) key = `__idx:${++dedupFallback}`;
      if (seen.has(key)) continue;
      if (hasStableKey && persistentSeen.has(key)) continue;
      seen.add(key);
      unique.push(it);
      if (hasStableKey) {
        persistentSeen.add(key);
      }
    }

    const persistentKinds = new Set();
    if (want("canvas")) {
      persistentKinds.add("canvas");
    }
    ["img", "background", "dataUri", "blob"].forEach((kind) => {
      if (want(kind)) persistentKinds.add(kind);
    });
    unique.sort(compareByDomOrder);

    const finalImages = persistentKinds.size ? mergePersistentItems(STATE.images, unique, persistentKinds) : unique.slice();
    finalImages.sort(compareByDomOrder);

    STATE.images = finalImages;
    STATE.lastScanAt = Date.now();
    return { images: finalImages };
  }

  // New concurrent scanner that runs all extraction passes together and can stream incremental results.
  async function scanForImagesConcurrent(options = {}) {
    resetDomOrderMap();
    resetDiscoverySequence();
    const fromDynamic = options.__fromDynamic === true;
    const minW = options.minWidth || 0;
    const minH = options.minHeight || 0;
    const types = Array.isArray(options.types) && options.types.length ? options.types : [
      "img", "background", "canvas", "svg", "dataUri", "blob"
    ];
    const scanId = Number.isFinite(options.scanId) ? options.scanId : null;
    const intervalMs = Number.isFinite(options.intervalMs) ? Math.max(500, options.intervalMs) : 1500;
    const want = (kind) => types.includes(kind);
    const seenCanvasHashes = new Set();
    const persistentSeen = getPersistentSeenSet();
    const seenKeys = new Set();
    let dedupFallback = 0;
    const found = [];
    let pendingChunk = [];
    let lastEmit = Date.now();

    const rememberItem = (item) => {
      if (!item) return false;
      let key = getResultDedupKey(item);
      const hasStableKey = typeof key === "string" && key.length > 0;
      if (!hasStableKey) key = `__idx:${++dedupFallback}`;
      if (seenKeys.has(key)) return false;
      if (hasStableKey && persistentSeen.has(key)) return false;
      seenKeys.add(key);
      if (hasStableKey) {
        persistentSeen.add(key);
      }
      found.push(item);
      pendingChunk.push(item);
      return true;
    };

    const flushIncremental = (force = false, label = null) => {
      if (!scanId || !pendingChunk.length) return;
      const now = Date.now();
      if (!force && now - lastEmit < intervalMs) return;
      emitScanProgress(scanId, { phase: "step", images: pendingChunk, label });
      lastEmit = now;
      pendingChunk = [];
    };

    if (want("img") || want("dataUri") || want("blob")) {
      for (const img of document.images) {
        const raw = img.currentSrc || img.src; if (!raw) continue;
        const abs = toAbsURL(raw); if (!abs) continue;
        if (img.naturalWidth < minW || img.naturalHeight < minH) continue;
        const kind = abs.startsWith("data:") ? "dataUri" : (abs.startsWith("blob:") ? "blob" : "img");
        if (!want(kind)) continue;
        const item = {
          kind,
          type: "img",
          rawUrl: abs,
          url: abs,
          width: img.naturalWidth,
          height: img.naturalHeight,
          filename: sanitizeName(img.alt || filenameFromURL(abs))
        };
        const signature = getElementSignature(img, "img");
        if (signature) item.sourceId = signature;
        stampDiscoveryMeta(item, img);
        rememberItem(item);
      }
      flushIncremental(true, "[img] collected");
    }

    if (want("img")) {
      try {
        const gifExtras = await collectGifSources({ minW, minH });
        for (const item of gifExtras) {
          rememberItem(item);
        }
        if (gifExtras.length) {
          flushIncremental(true, "[gif] collected");
        }
      } catch (err) {
        console.warn("[Scan] gif collection failed", err);
      }
    }

    if (want("img")) {
      const ratioCache = new WeakMap();
      const getRatio = (node) => {
        if (!node) return null;
        if (ratioCache.has(node)) return ratioCache.get(node);
        const w = Number(node.naturalWidth || node.width || 0);
        const h = Number(node.naturalHeight || node.height || 0);
        const ratio = (w > 0 && h > 0) ? (h / w) : null;
        ratioCache.set(node, ratio);
        return ratio;
      };
      const appendSrcsetCandidate = (targetEl, candidateUrl, { widthHint = null, namespace = "img:srcset" } = {}) => {
        const abs = toAbsURL(candidateUrl);
        if (!abs) return;
        const ratio = targetEl instanceof HTMLImageElement ? getRatio(targetEl) : null;
        const width = widthHint || Number(targetEl?.naturalWidth || 0) || 0;
        let height = Number(targetEl?.naturalHeight || 0) || 0;
        if ((!height || !Number.isFinite(height)) && ratio && Number.isFinite(width)) {
          height = Math.round(width * ratio);
        }
        if (width && width < minW) return;
        if (height && height < minH) return;
        const item = {
          kind: "img",
          type: "img",
          rawUrl: abs,
          url: abs,
          width: width || targetEl?.naturalWidth || 0,
          height: height || targetEl?.naturalHeight || 0,
          filename: sanitizeName(targetEl?.alt || filenameFromURL(abs))
        };
        const signature = getElementSignature(targetEl, namespace);
        if (signature) item.sourceId = signature;
        stampDiscoveryMeta(item, targetEl);
        if (rememberItem(item)) {
          if (pendingChunk.length >= 8) flushIncremental(false, `[srcset] batching`);
        }
      };
      for (const img of document.querySelectorAll("img[srcset]")) {
        const entries = parseSrcsetList(img.getAttribute("srcset"));
        for (const entry of entries) {
          if (!entry || !entry.url) continue;
          const widthHint = entry.width ? Math.round(entry.width) : null;
          appendSrcsetCandidate(img, entry.url, { widthHint, namespace: "img:srcset" });
        }
      }
      for (const source of document.querySelectorAll("source")) {
        const src = source.getAttribute("src");
        if (src) appendSrcsetCandidate(source, src, { namespace: "source:src" });
        const srcset = source.getAttribute("srcset");
        if (srcset) {
          const entries = parseSrcsetList(srcset);
          for (const entry of entries) {
            if (!entry || !entry.url) continue;
            const widthHint = entry.width ? Math.round(entry.width) : null;
            appendSrcsetCandidate(source, entry.url, { widthHint, namespace: "source:srcset" });
          }
        }
      }
      flushIncremental(true, "[srcset] collected");
    }

    if (want("background") || want("dataUri") || want("blob")) {
      const allowedKinds = { background: want("background"), dataUri: want("dataUri"), blob: want("blob") };
      try {
        const bgItems = await collectBackgroundImages({ minW, minH, allowKinds: allowedKinds });
        for (const item of bgItems) rememberItem(item);
        flushIncremental(true, "[background] collected");
      } catch (err) {
        console.warn("[Scan] background collection failed", err);
      }
    }

    if (want("canvas")) {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      for (const cv of canvases) {
        const w = cv.width;
        const h = cv.height;
        if (w < minW || h < minH) continue;

        const capture = await snapshotCanvasElement(cv);
        if (!capture || !capture.url) continue;
        if (capture.hash && seenCanvasHashes.has(capture.hash)) {
          releaseSvgObjectUrl(capture.url);
          continue;
        }
        if (capture.hash) seenCanvasHashes.add(capture.hash);
        const naming = getCanvasFilename(capture.hash, "png");
        const item = {
          kind: "canvas",
          type: "canvas",
          rawUrl: capture.url,
          url: capture.url,
          width: w,
          height: h,
          filename: naming.filename,
          canonicalName: naming.canonicalName,
          mime: capture.mime || "image/png",
          size: capture.size || 0
        };
        if (capture.hash) item.contentHash = capture.hash;
        stampDiscoveryMeta(item, cv);
        rememberItem(item);
        if (pendingChunk.length >= 6) flushIncremental(false, "[canvas] batching");
      }
      flushIncremental(true, "[canvas] collected");
    }

    if (want("svg")) {
      const serializer = new XMLSerializer();
      for (const svg of document.querySelectorAll("svg")) {
        try {
          const r = svg.getBoundingClientRect();
          if (r.width < minW || r.height < minH) continue;
          const serialized = serializer.serializeToString(svg);
          const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
          const objectUrl = URL.createObjectURL(blob);
          trackSvgObjectUrl(objectUrl, serialized, blob.size);
          const item = {
            kind: "svg",
            type: "svg",
            rawUrl: objectUrl,
            url: objectUrl,
            width: Math.round(r.width),
            height: Math.round(r.height),
            filename: sanitizeName("vector.svg")
          };
          const signature = getElementSignature(svg, "svg");
          if (signature) item.sourceId = signature;
          const svgHash = hashTextFast(serialized);
          if (svgHash) item.contentHash = svgHash;
          stampDiscoveryMeta(item, svg);
          rememberItem(item);
        } catch { }
      }
      flushIncremental(true, "[svg] collected");
    }

    if (want("img")) {
      try {
        const igExtras = await collectInstagramProfileExtras({ minW, minH, allowImages: true });
        for (const item of igExtras) {
          rememberItem(item);
        }
        if (igExtras.length) {
          flushIncremental(true, "[instagram] collected");
        }
      } catch (err) {
        console.warn("[Scan] instagram profile collection failed", err);
      }
    }

    const augmented = [];
    for (const item of found) {
      try {
        if (item.rawUrl && item.rawUrl.startsWith("blob:")) {
          const reg = BLOB_REG.get(item.rawUrl);
          if (reg) {
            const payload = {
              ...item,
              mime: reg.mime || item.mime,
              size: reg.size || item.size || (reg.buffer ? reg.buffer.byteLength || 0 : 0)
            };
            augmented.push(payload);
            continue;
          }
        }
      } catch { }
      augmented.push(item);
    }

    // Deduplicate by URL for network resources, but keep distinct canvas captures even if their data matches.
    const finalUnique = [];
    const finalSeen = new Set();
    let finalFallback = 0;
    for (const it of augmented) {
      let key = getResultDedupKey(it);
      if (!key) key = `__idx:${++finalFallback}`;
      if (finalSeen.has(key)) continue;
      finalSeen.add(key);
      finalUnique.push(it);
    }
    finalUnique.sort(compareByDomOrder);

    const persistentKinds = new Set();
    if (want("canvas")) {
      persistentKinds.add("canvas");
    }
    if (want("img") || want("background") || want("dataUri") || want("blob")) {
      IMAGE_RESULT_KINDS.forEach((kind) => persistentKinds.add(kind));
    }
    const finalImages = persistentKinds.size ? mergePersistentItems(STATE.images, finalUnique, persistentKinds) : finalUnique.slice();
    finalImages.sort(compareByDomOrder);
    STATE.images = finalImages;
    STATE.lastScanAt = Date.now();
    DYNAMIC.lastOptions = { minWidth: minW, minHeight: minH, types };
    if (fromDynamic) {
      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      DYNAMIC.ignoreUntil = now + 1000;
    }
    ensureDynamicObserver();
    return { total: finalImages.length };
  }
  window.addEventListener("beforeunload", () => {
    SVG_OBJECT_URLS.forEach((timer, url) => {
      if (timer) clearTimeout(timer);
      try { URL.revokeObjectURL(url); } catch { }
      BLOB_REG.delete(url);
    });
    SVG_OBJECT_URLS.clear();
  });

  function hasSelector(selector) {
    if (!selector) return false;
    try {
      return Boolean(document.querySelector(selector));
    } catch {
      return false;
    }
  }

  function matchScript(pattern) {
    if (!pattern) return false;
    try {
      const scripts = document.scripts || [];
      for (const script of scripts) {
        const src = script?.src || "";
        if (src && pattern.test(src)) return true;
        if (!src && pattern.test(script?.textContent || "")) return true;
      }
    } catch { }
    return false;
  }

  function detectSpeedBinbMarkers() {
    const hints = [];
    if (hasSelector("canvas#viewer, canvas.binbCanvas, .binb-viewport, .binb-wrapper, .pbContainer, .pbViewer")) {
      hints.push("BINB canvas or container detected.");
    }
    if (typeof globalThis.BINB !== "undefined" || typeof globalThis.binb !== "undefined") {
      hints.push("BINB global present.");
    }
    if (matchScript(/binb|viewer\/binb|speedbinb/i)) {
      hints.push("BINB script reference detected.");
    }
    if (!hints.length) return null;
    return { confidence: 0.95, hints };
  }

  function detectCoreViewMarkers() {
    const hints = [];
    if (hasSelector("#viewer-container, .viewer-container, .main-viewer, .giga-viewer, .gvContainer")) {
      hints.push("CoreView/GigaViewer container detected.");
    }
    if (matchScript(/giga(viewer)?|coreview|comic-earthstar/i)) {
      hints.push("CoreView script reference detected.");
    }
    if (!hints.length) return null;
    return { confidence: 0.85, hints };
  }

  function detectMadaraMarkers() {
    const hints = [];
    if (hasSelector(".wp-manga, .wp-manga-chapter, .wp-manga-post, [class*='madara-'], body[class*='madara-']")) {
      hints.push("Madara WordPress classes detected.");
    }
    if (hasSelector(".chapter-release-date, .wp-manga-nav, form[action*='admin-ajax.php'][data-action*='manga']")) {
      hints.push("Madara navigation/AJAX markers present.");
    }
    if (!hints.length) return null;
    return { confidence: 0.7, hints };
  }

  function detectMangastreamMarkers() {
    const hints = [];
    if (hasSelector(".chapter-list, .list-chapter, .chapter-item")) {
      hints.push("MangaStream chapter list detected.");
    }
    if (hasSelector(".reader-area img, .chapter-content img, .entry-content .page-break img")) {
      hints.push("Reader image layout matches MangaStream.");
    }
    if (!hints.length) return null;
    return { confidence: 0.6, hints };
  }

  function detectFoolslideMarkers() {
    const hints = [];
    if (hasSelector("#reader, .fs-reader, .fs-chapter, .fs-page, .fs-nav-top")) {
      hints.push("FoolSlide reader elements present.");
    }
    if (hasSelector(".reader-controls, .chapter-nav-top, .chapter-nav-bottom")) {
      hints.push("FoolSlide navigation detected.");
    }
    if (!hints.length) return null;
    return { confidence: 0.55, hints };
  }

  function normalizeFamilyPrefs(families) {
    if (!families || typeof families !== "object") return null;
    const prefs = {};
    for (const [key, value] of Object.entries(families)) {
      if (!key) continue;
      prefs[String(key).toLowerCase()] = Boolean(value);
    }
    return prefs;
  }

  function runHKFamilyHeuristics(families) {
    const prefs = normalizeFamilyPrefs(families);
    const results = [];
    for (const entry of HK_FAMILY_HEURISTICS) {
      const family = String(entry.key || "").toLowerCase();
      if (!family) continue;
      if (prefs && prefs[family] === false) continue;
      const match = entry.detect();
      if (match) {
        results.push({
          family,
          confidence: Number.isFinite(match.confidence) ? match.confidence : 0.5,
          hints: Array.isArray(match.hints) ? match.hints : []
        });
      }
    }
    results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return results;
  }

  const isYanmagaHost = (hostname) => {
    if (!hostname) return false;
    const normalized = String(hostname).toLowerCase();
    if (normalized === "yanmaga.jp" || normalized.endsWith(".yanmaga.jp")) {
      return true;
    }
    return normalized === "viewer-yanmaga.comici.jp";
  };

  async function readYanmagaChaptersFromDom() {
    await ensureDomReadyForDetection();

    if (!isYanmagaHost(location.hostname)) {
      return { ok: false, error: "Not on Yanmaga page" };
    }

    const links = document.querySelectorAll("a.mod-episode-link");
    const chapters = [];

    for (const link of links) {
      const href = link.href || link.getAttribute("href");
      if (!href) continue;

      let id = "";
      try {
        const url = new URL(href, location.href);
        id = url.pathname;
      } catch {
        continue;
      }

      const titleElement = link.querySelector(".mod-episode-title");
      const title = titleElement?.textContent?.trim() || "Untitled Episode";

      chapters.push({ id, title });
    }

    return { ok: true, chapters, count: chapters.length };
  }

  // ---- Messaging ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== "object") {
      return false;
    }
    if (msg?.action === "SCAN_PROGRESS") {
      return false;
    }
    (async () => {
      try {
        if (msg.action === "scan") {
          const res = await scanForImagesConcurrent(msg.options || {}); sendResponse({ ok: true, ...res });
        } else if (msg.action === "enableInteractions") {
          const res = await nukeOverlays({ minCoverage: 0.5, minZ: 900 }); sendResponse({ ok: true, ...res });
        } else if (msg.action === "nukeOverlays") {
          const res = await nukeOverlays(msg.options || {}); sendResponse({ ok: true, ...res });
        } else if (msg.action === "nukeByKeywords") {
          clearOverlayPreview();
          const options = msg.options || {};
          const res = await nukeByKeywords(msg.keywords || [], options);
          if (res && res.ok && options.preview !== true && Array.isArray(res.records) && res.records.length) {
            OVERLAY_HISTORY.push({ timestamp: Date.now(), items: res.records });
            bindOverlayInteractions();
          }
          sendResponse({
            ok: !!(res && res.ok),
            removed: res?.removed || 0,
            softened: res?.softened || 0,
            totalMatched: res?.totalMatched || 0,
            affected: res?.affected || 0,
            capped: !!res?.capped
          });
        } else if (msg.action === "previewOverlays") {
          const res = await previewOverlays(msg.options || {});
          sendResponse(res);
        } else if (msg.action === "undoOverlayCleanup") {
          const res = undoOverlayCleanup();
          sendResponse(res);
        } else if (msg.action === "getCached") {
          sendResponse({ ok: true, images: STATE.images, lastScanAt: STATE.lastScanAt });
        } else if (msg.action === "startAutoScan") {
          if (AUTO.enabled) return sendResponse({ ok: true });
          const opts = msg.options || {};
          AUTO.enabled = true;
          AUTO.options = opts;
          const debounceMs = Math.max(150, Number(opts.debounceMs) || 600);
          const distancePx = Number(opts.distancePx);
          const useDistance = Number.isFinite(distancePx) && distancePx > 0;
          AUTO.distancePx = useDistance ? distancePx : null;
          AUTO.accumulated = 0;
          AUTO.lastScrollY = useDistance ? getDocumentScrollY() : null;
          AUTO.lastRun = 0;
          AUTO.pending = false;
          const runAutoScan = () => {
            if (AUTO.pending) return;
            AUTO.pending = true;
            AUTO.lastRun = Date.now();
            const scanBase = AUTO.options.scanOptions && typeof AUTO.options.scanOptions === "object"
              ? { ...AUTO.options.scanOptions }
              : {};
            AUTO.sequence = (AUTO.sequence || 0) + 1;
            const scanOptions = {
              ...scanBase,
              scanId: AUTO.sequence,
              intervalMs: 1200
            };
            scanForImagesConcurrent(scanOptions)
              .catch((err) => console.warn("[AutoScan] scan failed", err))
              .finally(() => { AUTO.pending = false; });
          };
          AUTO.handler = () => {
            const now = Date.now();
            if (useDistance) {
              const currentY = getDocumentScrollY();
              const lastY = typeof AUTO.lastScrollY === "number" ? AUTO.lastScrollY : currentY;
              const delta = Math.abs(currentY - lastY);
              AUTO.lastScrollY = currentY;
              AUTO.accumulated = (AUTO.accumulated || 0) + (Number.isFinite(delta) ? delta : 0);
              if (AUTO.accumulated < distancePx) return;
              if (now - AUTO.lastRun < debounceMs) return;
              AUTO.accumulated = AUTO.accumulated % distancePx;
            } else {
              if (now - AUTO.lastRun < debounceMs) return;
            }
            runAutoScan();
          };
          window.addEventListener("scroll", AUTO.handler, { passive: true });
          runAutoScan();
          sendResponse({ ok: true });
        } else if (msg.action === "stopAutoScan") {
          if (AUTO.enabled) {
            disableAutoScan();
          }
          sendResponse({ ok: true });
        } else if (msg.action === "listBlobs") {
          const blobs = [];
          BLOB_REG.forEach((entry, url) => {
            if (!entry || entry.revoked) return;
            blobs.push({
              url,
              mime: entry.mime || "",
              size: entry.size || (entry.buffer ? entry.buffer.byteLength || 0 : 0),
              createdAt: entry.createdAt || Date.now()
            });
          });
          sendResponse({ ok: true, blobs });
        } else if (msg.action === "getCanvasNameCache") {
          const entries = [];
          try {
            const registry = globalThis.__UNSHACKLE_CANVAS_NAME_CACHE;
            if (registry && registry.hashToName instanceof Map) {
              registry.hashToName.forEach((name, hash) => {
                entries.push({ hash, name });
              });
            }
          } catch { }
          sendResponse({ ok: true, entries, counter: CANVAS_NAME_CACHE?.counter || 1 });
        } else if (msg.action === "serializeBlobUrls") {
          const urls = Array.isArray(msg.urls) ? msg.urls : [];
          const out = {};
          const unique = new Set();
          for (const url of urls) {
            if (typeof url !== "string" || !url.startsWith("blob:")) continue;
            if (unique.has(url)) continue;
            unique.add(url);
            const payload = await collectBlobPayload(url);
            if (payload) out[url] = payload; else out[url] = { missing: true };
            await cooperativeYield();
          }
          sendResponse({ ok: true, data: out });
        } else if (msg.action === "releaseObjectUrls") {
          const urls = Array.isArray(msg.urls) ? msg.urls : [];
          const released = releaseSvgObjectUrls(urls);
          sendResponse({ ok: true, released });
        } else if (msg.action === "HK_DETECT_FAMILY") {
          await ensureDomReadyForDetection();
          const candidates = runHKFamilyHeuristics(msg.families);
          sendResponse({
            ok: true,
            url: location.href,
            title: document.title || "",
            candidates
          });
        } else if (msg.action === "YANMAGA_FORWARD_TO_CONTENT_SCRIPT" || msg.action === "GET_YANMAGA_CHAPTERS_FROM_CURRENT_PAGE") {
          const result = await readYanmagaChaptersFromDom();
          if (result.ok) {
            console.log("[Yanmaga Content] Read from current page:", result.count || result.chapters?.length || 0, "chapters");
          }
          sendResponse(result);
        } else if (msg.action === "HK_PING") {
          // Relaxed check: if body exists, we can start scanning even if some resources are loading
          const isReady = isDocumentReady() || !!document.body;
          sendResponse({
            ok: true,
            domReady: isReady,
            readyState: document.readyState,
            url: location.href
          });
        } else if (msg.action === "HK_FETCH_IMAGE_IN_CONTEXT") {
          // Aggressive fallback: fetch image using page context (has cookies, correct Referer)
          const targetUrl = msg.url;
          if (!targetUrl || typeof targetUrl !== "string") {
            sendResponse({ ok: false, error: "Missing URL" });
            return;
          }
          try {
            // First check if it's a blob URL we already have
            if (targetUrl.startsWith("blob:")) {
              const blobEntry = BLOB_REG.get(targetUrl);
              if (blobEntry && blobEntry.buffer) {
                const bytes = new Uint8Array(blobEntry.buffer);
                sendResponse({
                  ok: true,
                  data: Array.from(bytes),
                  mime: blobEntry.mime || "application/octet-stream",
                  size: blobEntry.size || bytes.length
                });
                return;
              }
            }
            // Fetch using page context
            const res = await fetch(targetUrl, { credentials: "include" });
            if (!res.ok) {
              sendResponse({ ok: false, error: `Fetch failed: ${res.status}` });
              return;
            }
            const blob = await res.blob();
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);

            // Proactive blob registration: store in BLOB_REG for future use
            if (targetUrl.startsWith("blob:") && buffer.byteLength > 0) {
              BLOB_REG.set(targetUrl, {
                buffer: buffer,
                mime: blob.type || "application/octet-stream",
                size: buffer.byteLength,
                createdAt: Date.now(),
                revoked: false
              });
            }

            sendResponse({
              ok: true,
              data: Array.from(bytes),
              mime: blob.type || "application/octet-stream",
              size: bytes.length
            });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
        } else if (msg.action === "collectAllVisualAssets") {
          // Deep scan: collect all visual assets from DOM and BLOB_REG
          try {
            const assets = [];
            const seen = new Set();

            // Helper to convert ArrayBuffer to base64 for transfer
            const bufferToBase64 = (buffer) => {
              try {
                const bytes = new Uint8Array(buffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
              } catch { return null; }
            };

            // 1. Collect all blobs from BLOB_REG (with hydration data)
            BLOB_REG.forEach((entry, url) => {
              if (!entry || entry.revoked) return;
              if (seen.has(url)) return;
              seen.add(url);
              assets.push({
                kind: 'blob',
                url,
                mime: entry.mime || 'application/octet-stream',
                size: entry.size || 0,
                source: entry.source || 'unknown',
                hasBuffer: !!entry.buffer,
                // Include base64 data for hydration in panel
                base64: entry.buffer ? bufferToBase64(entry.buffer) : null
              });
            });

            // 2. Walk DOM for existing blob: URLs not in BLOB_REG (early-created blobs)
            const discoverDomBlobUrls = async () => {
              const blobUrls = new Set();
              // Check img elements
              document.querySelectorAll('img[src^="blob:"]').forEach(el => blobUrls.add(el.src));
              // Check video elements
              document.querySelectorAll('video[src^="blob:"], video source[src^="blob:"]').forEach(el => {
                const src = el.src || el.getAttribute('src');
                if (src?.startsWith('blob:')) blobUrls.add(src);
              });
              // Check CSS background-images
              document.querySelectorAll('*').forEach(el => {
                try {
                  const bg = getComputedStyle(el).backgroundImage;
                  const match = bg?.match(/url\(["']?(blob:[^"')]+)["']?\)/);
                  if (match) blobUrls.add(match[1]);
                } catch { }
              });

              // Fetch any blob URLs not already in registry
              for (const blobUrl of blobUrls) {
                if (seen.has(blobUrl)) continue;
                if (BLOB_REG.has(blobUrl)) continue;
                try {
                  const res = await fetch(blobUrl);
                  if (!res.ok) continue;
                  const blob = await res.blob();
                  const buffer = await blob.arrayBuffer();
                  const mime = blob.type || 'image/unknown';
                  // Store in BLOB_REG for future use
                  BLOB_REG.set(blobUrl, {
                    buffer,
                    mime,
                    size: buffer.byteLength,
                    createdAt: Date.now(),
                    revoked: false,
                    source: 'domDiscovery'
                  });
                  seen.add(blobUrl);
                  assets.push({
                    kind: 'blob',
                    url: blobUrl,
                    mime,
                    size: buffer.byteLength,
                    source: 'domDiscovery',
                    hasBuffer: true,
                    base64: bufferToBase64(buffer)
                  });
                } catch { /* blob may be revoked or inaccessible */ }
              }
            };
            await discoverDomBlobUrls();

            // 2. Collect inline SVGs
            const svgs = document.querySelectorAll('svg');
            for (const svg of svgs) {
              try {
                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(svg);
                if (!svgString || svgString.length < 10) continue;
                const blob = new Blob([svgString], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(blob);
                trackSvgObjectUrl(url, svgString, blob.size);
                if (!seen.has(url)) {
                  seen.add(url);
                  assets.push({
                    kind: 'svg',
                    url,
                    mime: 'image/svg+xml',
                    size: blob.size,
                    source: 'inlineSvg',
                    // Convert SVG string to base64 for proper hydration in panel
                    base64: btoa(unescape(encodeURIComponent(svgString)))
                  });
                }
              } catch { }
            }

            // 3. Collect canvas elements
            const canvases = document.querySelectorAll('canvas');
            for (const canvas of canvases) {
              try {
                if (canvas.width < 10 || canvas.height < 10) continue;
                const snapshot = await snapshotCanvasElement(canvas);
                if (snapshot && snapshot.url && !seen.has(snapshot.url)) {
                  seen.add(snapshot.url);
                  assets.push({
                    kind: 'canvas',
                    url: snapshot.url, // Page-bound URL, needs hydration
                    mime: snapshot.mime || 'image/png',
                    size: snapshot.size || 0,
                    width: canvas.width,
                    height: canvas.height,
                    source: 'canvasSnapshot',
                    // Snapshot function returns page blob URL. Fetch it to get bytes for hydration
                    base64: await (async () => {
                      try {
                        const res = await fetch(snapshot.url);
                        const buf = await res.arrayBuffer();
                        return bufferToBase64(buf); // Re-use helper
                      } catch { return null; }
                    })()
                  });
                }
              } catch { }
            }

            // 4. Collect background images
            const bgResults = await collectBackgroundImages({ minW: 32, minH: 32, allowKinds: { img: true, background: true }, profile: 'aggressive' });
            for (const bg of bgResults) {
              if (!bg.url || seen.has(bg.url)) continue;
              seen.add(bg.url);
              assets.push({
                kind: 'background',
                url: bg.url,
                mime: bg.mime || guessMimeFromURL(bg.url) || 'image/unknown',
                width: bg.width || 0,
                height: bg.height || 0,
                source: 'cssBackground'
              });
            }

            sendResponse({ ok: true, assets, count: assets.length });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
        } else {
          sendResponse({ ok: false, error: "Unknown action" });
        }

      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  });

  // === WINDOW MESSAGE LISTENER FOR YANMAGA ===
  // Listen for requests from the Yanmaga connector running in offscreen/worker context
  window.addEventListener('message', async (event) => {
    // Only handle our own messages
    if (event.source !== window) return;

    if (event.data?.type === 'UNSHACKLE_REQUEST_YANMAGA_CHAPTERS') {
      try {
        const result = await readYanmagaChaptersFromDom();
        if (result.ok) {
          console.log('[Yanmaga Window Listener] Found chapters:', result.count || result.chapters?.length || 0);
        }
        window.postMessage({
          type: 'UNSHACKLE_YANMAGA_CHAPTERS_FROM_PANEL',
          ...result
        }, '*');
      } catch (error) {
        console.error('[Yanmaga Window Listener] Error:', error);
        window.postMessage({
          type: 'UNSHACKLE_YANMAGA_CHAPTERS_FROM_PANEL',
          ok: false,
          error: error.message
        }, '*');
      }
    }
  });

  // === BLOB BRIDGE LISTENER ===
  // Listen for blob creation events from page_blob_patch.js (main world)
  // This populates BLOB_REG so we can capture blob: URLs created by the page.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || !data.__blobBridge) return;

    try {
      if (data.kind === 'createObjectURL' && data.url && data.buffer) {
        // Store the blob data in our registry
        const buffer = data.buffer instanceof ArrayBuffer ? data.buffer : null;
        if (buffer) {
          BLOB_REG.set(data.url, {
            buffer: buffer,
            mime: data.mime || 'application/octet-stream',
            size: data.size || buffer.byteLength || 0,
            createdAt: Date.now(),
            revoked: false,
            source: 'createObjectURL'
          });
        }
      } else if (data.kind === 'revokeObjectURL' && data.url) {
        // Mark the blob as revoked (but keep data for a while in case we need it)
        const entry = BLOB_REG.get(data.url);
        if (entry) {
          entry.revoked = true;
        }
      } else if (data.kind === 'canvasBlob' && data.url && data.buffer) {
        // Canvas.toBlob() captured - store as blob URL
        const buffer = data.buffer instanceof ArrayBuffer ? data.buffer : null;
        if (buffer) {
          BLOB_REG.set(data.url, {
            buffer: buffer,
            mime: data.mime || 'image/png',
            size: data.size || buffer.byteLength || 0,
            createdAt: Date.now(),
            revoked: false,
            source: 'canvasBlob'
          });
        }
      } else if (data.kind === 'canvasDataURL' && data.dataUrl) {
        // Canvas.toDataURL() captured - store as synthetic blob
        try {
          const comma = data.dataUrl.indexOf(',');
          if (comma > 0) {
            const header = data.dataUrl.slice(0, comma);
            const isBase64 = header.includes(';base64');
            const payload = data.dataUrl.slice(comma + 1);
            let bytes;
            if (isBase64) {
              const binary = atob(payload);
              bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            } else {
              bytes = new TextEncoder().encode(decodeURIComponent(payload));
            }
            // Create a synthetic blob URL for tracking
            const blob = new Blob([bytes], { type: data.mime || 'image/png' });
            const url = URL.createObjectURL(blob);
            BLOB_REG.set(url, {
              buffer: bytes.buffer,
              mime: data.mime || 'image/png',
              size: bytes.byteLength,
              createdAt: Date.now(),
              revoked: false,
              source: 'canvasDataURL',
              syntheticUrl: url,  // Track that we created this URL
              needsRevoke: true   // Mark for cleanup on prune
            });
          }
        } catch { }
      } else if (data.kind === 'fetchBlob' && data.url && data.buffer) {
        // Fetch response blob captured - store with original URL as key
        const buffer = data.buffer instanceof ArrayBuffer ? data.buffer : null;
        if (buffer) {
          // Create blob URL for this fetch result
          const blob = new Blob([buffer], { type: data.mime || 'image/png' });
          const blobUrl = URL.createObjectURL(blob);
          BLOB_REG.set(blobUrl, {
            buffer: buffer,
            mime: data.mime || 'image/png',
            size: data.size || buffer.byteLength || 0,
            createdAt: Date.now(),
            revoked: false,
            source: 'fetchBlob',
            originalUrl: data.url,
            syntheticUrl: blobUrl,  // Track that we created this URL
            needsRevoke: true       // Mark for cleanup on prune
          });
        }
      }
    } catch (err) {
      // Silent fail
    }
  });

})();
