import "../shim/engine-shim.js";

const HK_DELEGATE_ACTION = "HK_DELEGATE_CALL";

const CONNECTOR_LOADERS = {};

const connectorCache = new Map();
const ENTRY_INDEX = {
  byId: new Map(),
  list: []
};
let indexPromise = null;

function debug(label, fn) {
  if (typeof globalThis.UnshackleHKDebug?.group === "function") {
    globalThis.UnshackleHKDebug.group(`[HK Runner] ${label}`, fn);
  }
}

async function loadConnectorIndex() {
  if (!indexPromise) {
    const url = chrome.runtime.getURL("vendor/hakuneko/index.json");
    indexPromise = fetch(url)
      .then((res) => res.json())
      .then((list) => Array.isArray(list) ? list : [])
      .catch((error) => {
        console.error("[HK Runner] Failed to load connector index", error);
        return [];
      });
  }
  return indexPromise;
}

function normalizeEntry(entry) {
  const domains = entry.domains || (entry.domain ? [entry.domain] : []);
  return {
    ...entry,
    type: entry.type || "connector",
    engineId: entry.engineId || entry.id,
    family: entry.family ? String(entry.family).toLowerCase() : "",
    domains: domains.map((host) => String(host).toLowerCase())
  };
}

async function ensureIndex() {
  if (ENTRY_INDEX.list.length) {
    return ENTRY_INDEX;
  }
  const raw = await loadConnectorIndex();
  for (const entry of raw) {
    if (!entry?.id) {
      continue;
    }
    if (entry.type !== "delegate" && !entry.path) {
      continue;
    }
    const normalized = normalizeEntry(entry);
    ENTRY_INDEX.byId.set(normalized.id, normalized);
    ENTRY_INDEX.list.push(normalized);
  }
  return ENTRY_INDEX;
}

function buildFamilyFilter(payload = {}) {
  const families = payload.families;
  if (!families || typeof families !== "object") {
    return null;
  }
  const map = new Map();
  for (const [key, value] of Object.entries(families)) {
    map.set(normalizeFamilyKey(key), Boolean(value));
  }
  return map;
}

function normalizeFamilyKey(value) {
  return String(value || "").toLowerCase();
}

function canonicalizeConnectorId(value) {
  return String(value || "").toLowerCase();
}

function isFamilyAllowed(entry, filter) {
  if (!filter) return true;
  const key = normalizeFamilyKey(entry?.family);
  if (!key) return true;
  if (!filter.has(key)) return true;
  return filter.get(key) !== false;
}

function matchEntryForUrl(url, entries, filter) {
  const hostname = url.hostname.toLowerCase();
  let fallback = null;
  for (const entry of entries) {
    if (!isFamilyAllowed(entry, filter)) {
      continue;
    }
    if (!entry.domains || !entry.domains.length) {
      if (!fallback && entry.type === "delegate") {
        fallback = entry;
      }
      continue;
    }
    if (entry.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      return entry;
    }
  }
  return fallback;
}

function preferDelegateEntry(entry, entries, url) {
  if (!entry || entry.type === "delegate") {
    return entry;
  }
  const family = normalizeFamilyKey(entry.family);
  const preferred = new Set(["coreview", "gigaviewer"]);
  if (!preferred.has(family)) {
    return entry;
  }
  const host = url?.hostname?.toLowerCase?.() || null;
  const candidates = entries.filter((item) => item.type === "delegate" && normalizeFamilyKey(item.family) === family);
  if (!candidates.length) {
    return entry;
  }
  if (host) {
    const match = candidates.find((candidate) => Array.isArray(candidate.domains)
      && candidate.domains.some((domain) => {
        const normalized = String(domain || "").toLowerCase();
        return host === normalized || host.endsWith(`.${normalized}`);
      }));
    if (match) {
      return match;
    }
  }
  return candidates[0];
}

async function resolveEntry(payload = {}, url = null, options = {}) {
  const preferDelegate = options?.preferDelegate === true;
  const { list, byId } = await ensureIndex();
  const filter = buildFamilyFilter(payload);
  if (payload.connectorId && byId.has(payload.connectorId)) {
    let entry = byId.get(payload.connectorId);
    if (isFamilyAllowed(entry, filter)) {
      return preferDelegate ? preferDelegateEntry(entry, list, url) : entry;
    }
    return null;
  }
  if (url) {
    const entry = matchEntryForUrl(url, list, filter);
    return preferDelegate ? preferDelegateEntry(entry, list, url) : entry;
  }
  return null;
}

function normalizeUrl(value) {
  if (value instanceof URL) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return new URL(value.trim());
  }
  throw new Error("A valid URL is required.");
}

function toArrayBuffer(value) {
  const view = toUint8ArrayLike(value);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function toUint8ArrayLike(value) {
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
  if (typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  if (typeof value === "object") {
    if (value.type === "Buffer" && Array.isArray(value.data)) {
      return new Uint8Array(value.data);
    }
    if (Array.isArray(value.data)) {
      return new Uint8Array(value.data);
    }
    if (value.data) {
      return toUint8ArrayLike(value.data);
    }
    const numericKeys = Object.keys(value).filter((key) => /^\d+$/.test(key));
    if (numericKeys.length) {
      numericKeys.sort((a, b) => Number(a) - Number(b));
      return new Uint8Array(numericKeys.map((key) => Number(value[key]) & 0xff));
    }
  }
  throw new Error("Unsupported connector payload buffer.");
}

function uint8ToBase64(u8) {
  if (!u8 || !u8.length) {
    return "";
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    const slice = u8.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

async function ensureConnector(entry) {
  if (!entry) {
    throw new Error("Missing connector entry.");
  }
  const connectorKey = entry.engineId || entry.id;
  if (connectorCache.has(connectorKey)) {
    return connectorCache.get(connectorKey);
  }
  let loader = CONNECTOR_LOADERS[connectorKey];
  if (!loader && entry.path) {
    loader = async () => {
      const moduleUrl = chrome.runtime.getURL(entry.path);
      const mod = await import(moduleUrl);
      return new mod.default();
    };
    CONNECTOR_LOADERS[connectorKey] = loader;
  }
  if (!loader) {
    throw new Error(`Unsupported connector '${connectorKey}'.`);
  }
  const instance = await loader();
  connectorCache.set(connectorKey, instance);
  return instance;
}

function serializeManga(manga) {
  if (!manga) {
    return null;
  }
  return {
    id: manga.id,
    title: manga.title,
    status: manga.status || null
  };
}

function serializeChapter(chapter) {
  if (!chapter) {
    return null;
  }
  return {
    id: chapter.id ?? chapter.url ?? "",
    title: chapter.title ?? chapter.name ?? "",
    language: chapter.language ?? "",
    number: chapter.number ?? chapter.index ?? null
  };
}

function normalizePages(pages) {
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages
    .map((page, index) => {
      if (typeof page === "string") {
        return { index, url: page };
      }
      if (page && typeof page === "object") {
        return {
          index,
          url: page.url ?? page.href ?? page.id ?? null,
          id: page.id ?? null,
          type: page.type ?? null
        };
      }
      return { index, url: null };
    })
    .filter((entry) => typeof entry.url === "string" && entry.url.length > 0);
}

function sendDelegateMessage(moduleId, method, args, tabId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: HK_DELEGATE_ACTION,
        payload: {
          moduleId,
          method,
          args,
          tabId
        }
      },
      (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || String(err)));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Delegate call failed"));
          return;
        }
        resolve(response.data);
      }
    );
  });
}

async function delegateDetect(entry, url, tabId) {
  try {
    const result = await sendDelegateMessage(entry.module, "detect", [url], tabId);
    return !!result;
  } catch (error) {
    console.warn("[HK Runner] Delegate detect failed", error);
    return false;
  }
}

function coerceChaptersList(chapters) {
  if (!Array.isArray(chapters)) {
    return [];
  }
  return chapters.map((chapter, index) => ({
    id: chapter?.id || chapter?.url || `chapter-${index + 1}`,
    title: chapter?.title || chapter?.name || `Chapter ${index + 1}`,
    language: chapter?.language || ""
  }));
}

async function delegateHandleManga(entry, payload, resolvedUrl) {
  const targetUrl = payload.url || resolvedUrl;
  const data = await sendDelegateMessage(entry.module, "listChapters", [targetUrl], payload.tabId);
  const chapters = coerceChaptersList(data?.chapters);
  return {
    connectorId: entry.id,
    family: entry.family || null,
    manga: {
      id: targetUrl,
      title: data?.seriesTitle || payload.mangaTitle || "Series"
    },
    chapters
  };
}

async function delegateHandlePages(entry, payload, resolvedUrl) {
  const chapterId = payload?.chapter?.id || payload.chapterId || resolvedUrl;
  if (!chapterId) {
    throw new Error("Chapter identifier is required for delegate connector.");
  }
  const result = await sendDelegateMessage(entry.module, "listPages", [chapterId], payload.tabId);
  const pages = normalizePages(result?.pages || result);
  return {
    connectorId: entry.id,
    family: entry.family || null,
    chapter: serializeChapter({
      id: chapterId,
      title: payload?.chapter?.title || payload.chapterTitle || chapterId,
      language: payload?.chapter?.language || ""
    }),
    pages
  };
}

async function tryModernCall(connector, method, ...args) {
  if (typeof connector[method] !== "function") {
    return undefined;
  }
  try {
    const result = await connector[method](...args);
    return result;
  } catch (error) {
    if (error && /Not implemented/i.test(error.message || "")) {
      return undefined;
    }
    throw error;
  }
}

async function fetchChapters(connector, manga) {
  const modern = await tryModernCall(connector, "_getChapters", manga);
  if (modern) {
    return modern;
  }
  if (typeof connector._getChapterList === "function") {
    return new Promise((resolve, reject) => {
      connector._getChapterList(manga, (err, chapters) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(chapters || []);
      });
    });
  }
  throw new Error("Connector does not expose a chapter loader.");
}

async function fetchPages(connector, manga, chapter) {
  const modern = await tryModernCall(connector, "_getPages", chapter);
  if (modern) {
    return modern;
  }
  if (typeof connector._getPageList === "function") {
    return new Promise((resolve, reject) => {
      connector._getPageList(manga, chapter, (err, pages) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(pages || []);
      });
    });
  }
  throw new Error("Connector does not expose a page loader.");
}

async function handleProbe(payload = {}) {
  const url = normalizeUrl(payload.url);
  const entry = await resolveEntry(payload, url, { preferDelegate: true });
  if (!entry) {
    return { canHandle: false, connectorId: null };
  }
  if (entry.type === "delegate") {
    const canHandle = await delegateDetect(entry, url.href, payload.tabId);
    return { canHandle, connectorId: entry.id, family: entry.family || null };
  }
  const connector = await ensureConnector(entry);
  const canHandle = typeof connector.canHandleURI === "function"
    ? connector.canHandleURI(url)
    : false;
  return { canHandle, connectorId: entry.id, family: entry.family || null };
}

async function handleManga(payload = {}) {
  const url = normalizeUrl(payload.url);
  const entry = await resolveEntry(payload, url, { preferDelegate: true });
  if (!entry) {
    throw new Error("Unable to determine connector for requested URL.");
  }
  if (entry.type === "delegate") {
    return delegateHandleManga(entry, payload, url.href);
  }
  const connector = await ensureConnector(entry);
  const manga = await connector.getMangaFromURI(url);
  const chapters = await fetchChapters(connector, manga);
  return {
    connectorId: entry.id,
    family: entry.family || null,
    manga: serializeManga(manga),
    chapters: chapters.map(serializeChapter)
  };
}

async function handlePages(payload = {}) {
  const url = payload.url ? normalizeUrl(payload.url) : null;
  const entry = await resolveEntry(payload, url, { preferDelegate: true });
  if (!entry) {
    throw new Error("Unable to determine connector for pages request.");
  }
  if (entry.type === "delegate") {
    return delegateHandlePages(entry, payload, url?.href || null);
  }
  const connector = await ensureConnector(entry);
  const normalizedManga = payload.manga && payload.manga.id
    ? payload.manga
    : (payload.mangaId ? { id: payload.mangaId, title: payload.mangaTitle || "" } : null);
  const fallbackManga = normalizedManga || { id: "", title: "" };
  const chapter = payload.chapter ? { ...payload.chapter } : {};
  if (!chapter.id && payload.chapterId) {
    chapter.id = payload.chapterId;
  }
  if (!chapter.title && payload.chapterTitle) {
    chapter.title = payload.chapterTitle;
  }
  if (!chapter.id && url) {
    chapter.id = url.pathname + url.search;
    chapter.title = chapter.title || chapter.id;
  }
  if (!chapter.id) {
    throw new Error("Missing chapter identifier.");
  }
  const pages = await fetchPages(connector, fallbackManga, chapter);
  return {
    connectorId: entry.id,
    family: entry.family || null,
    chapter: serializeChapter(chapter),
    pages: normalizePages(pages)
  };
}

async function fetchMangaCatalog(connector) {
  const modern = await tryModernCall(connector, "_getMangas");
  if (modern) {
    return modern;
  }
  if (typeof connector._getMangaList === "function") {
    return new Promise((resolve, reject) => {
      connector._getMangaList((err, mangas) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(mangas || []);
      });
    });
  }
  throw new Error("Connector does not expose a manga catalog loader.");
}

async function handleCatalog(payload = {}) {
  const rawId = typeof payload.connectorId === "string" ? payload.connectorId.trim() : "";
  if (!rawId) {
    throw new Error("Connector id is required for catalog listings.");
  }
  const { byId } = await ensureIndex();
  const normalized = canonicalizeConnectorId(rawId);
  const entry = byId.get(rawId) || byId.get(normalized);
  if (!entry) {
    throw new Error(`Connector '${rawId}' is not registered.`);
  }
  if (entry.type === "delegate") {
    throw new Error("Delegate connectors do not provide catalog listings.");
  }
  const connector = await ensureConnector(entry);
  const mangas = await fetchMangaCatalog(connector);
  const baseUrl = typeof connector.url === "string"
    ? connector.url
    : (connector.config?.url?.value || connector.config?.url || "");
  return {
    connectorId: entry.id,
    baseUrl: baseUrl || "",
    mangas: Array.isArray(mangas) ? mangas.map(serializeManga) : []
  };
}

async function handleConnectorPayload(payload = {}) {
  const urlInput = payload?.url || payload?.href;
  if (!urlInput || typeof urlInput !== "string") {
    throw new Error("Connector payload URL is required.");
  }
  const url = new URL(urlInput);
  if (url.protocol !== "connector:") {
    throw new Error("Unsupported connector protocol.");
  }
  const { byId } = await ensureIndex();
  const entry = byId.get(url.hostname);
  if (!entry) {
    throw new Error(`Connector '${url.hostname}' is not registered.`);
  }
  if (entry.type === "delegate") {
    throw new Error("Delegate connectors do not expose connector payloads.");
  }
  const connector = await ensureConnector(entry);
  if (!connector || typeof connector.handleConnectorURI !== "function") {
    throw new Error("Connector cannot resolve payload URLs.");
  }
  const result = await connector.handleConnectorURI(url);
  if (!result || !result.data) {
    throw new Error("Connector returned no data for payload.");
  }
  const arrayBuffer = toArrayBuffer(result.data);
  const base64 = uint8ToBase64(new Uint8Array(arrayBuffer));
  return {
    connectorId: entry.id,
    mimeType: result.mimeType || "",
    data: base64,
    encoding: "base64"
  };
}

const COMMANDS = {
  probe: handleProbe,
  manga: handleManga,
  pages: handlePages,
  connectorPayload: handleConnectorPayload,
  catalog: handleCatalog
};

async function dispatch(command, payload) {
  const handler = COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown HK_RUN command '${command}'.`);
  }
  debug(command, () => {
    console.log("HK_RUN command", command, payload);
  });
  return handler(payload || {});
}

export async function runnerDispatch(command, payload) {
  const data = await dispatch(command, payload);
  return { ok: true, data };
}
