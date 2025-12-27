import "../../vendor/hakuneko/shim/engine-shim.js";
import Connectors from "../../hakuneko-runtime/src/web/mjs/engine/Connectors.mjs";
import Enums from "../../hakuneko-runtime/src/web/mjs/engine/Enums.mjs";
import { runnerDispatch } from "../../vendor/hakuneko/runner/runner.mjs";
import RequestAdapter from "./RequestAdapter.mjs";
import StorageAdapter from "./StorageAdapter.mjs";
import DownloadAdapter from "./DownloadAdapter.mjs";
import InterProcessCommunicationAdapter from "./InterProcessCommunicationAdapter.mjs";
import { sendRuntimeRequest } from "./runtimeMessaging.mjs";

const nativeRequest = globalThis.Request;

const HK_COMMAND = "HK_RUN_EXEC";
const HK_DELEGATE_ACTION = "HK_DELEGATE_CALL";
const CONNECTOR_CACHE = new Map();
const REGISTERED_NATIVE_CONNECTORS = new Set();
const ENTRY_INDEX = {
  byId: new Map(),
  list: []
};
const HYBRID_COMMANDS = new Set(["probe", "manga", "pages", "catalog", "connectorPayload"]);
const HK_GET_SETTINGS_ACTION = "HK_GET_SETTINGS";
const HK_SETTINGS_UPDATED_EVENT = "HK_SETTINGS_UPDATED";
const SETTINGS_REQUEST_TIMEOUT_MS = 12000;

let loaderMode = "runner";
let indexPromise = null;
let connectorsManager = null;
let connectorsManagerPromise = null;

function installEngineAdapters() {
  const engine = globalThis.Engine || {};
  engine.Request = RequestAdapter;
  engine.Storage = StorageAdapter;
  engine.Download = DownloadAdapter;
  engine.InterProcessCommunication = InterProcessCommunicationAdapter;
  globalThis.Engine = engine;
  if (typeof nativeRequest === "undefined") {
    globalThis.Request = RequestAdapter;
  }
  if (typeof globalThis.EventListener === "undefined" && Enums?.EventListener) {
    globalThis.EventListener = Enums.EventListener;
  }
}

installEngineAdapters();

async function requestSettingsSnapshot() {
  try {
    const response = await sendRuntimeRequest(
      { action: HK_GET_SETTINGS_ACTION },
      { timeout: SETTINGS_REQUEST_TIMEOUT_MS, requireOk: true }
    );
    return response?.data || null;
  } catch (error) {
    console.warn("[HK] Failed to request settings snapshot", error);
    return null;
  }
}

async function refreshLoaderMode() {
  const settings = await requestSettingsSnapshot();
  loaderMode = settings?.manga?.loader || "runner";
  return loaderMode;
}

await refreshLoaderMode();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === HK_SETTINGS_UPDATED_EVENT) {
    const nextSettings = message.settings || null;
    loaderMode = nextSettings?.manga?.loader || "runner";
  }
});

async function loadConnectorIndex() {
  if (!indexPromise) {
    const url = chrome.runtime.getURL("vendor/hakuneko/index.json");
    indexPromise = fetch(url)
      .then((res) => res.json())
      .then((list) => Array.isArray(list) ? list : [])
      .catch((error) => {
        console.error("[HK] Failed to load connector index", error);
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

async function ensureConnectorsManager() {
  if (connectorsManager) {
    return connectorsManager;
  }
  if (!connectorsManagerPromise) {
    connectorsManagerPromise = Promise.resolve(new Connectors(new InterProcessCommunicationAdapter()));
  }
  connectorsManager = await connectorsManagerPromise;
  return connectorsManager;
}

async function importConnector(entry) {
  if (entry.type === "delegate") {
    return null;
  }
  if (CONNECTOR_CACHE.has(entry.id)) {
    return CONNECTOR_CACHE.get(entry.id);
  }
  const manager = await ensureConnectorsManager();
  if (!REGISTERED_NATIVE_CONNECTORS.has(entry.id)) {
    const moduleUrl = chrome.runtime.getURL(entry.path);
    await manager.register([moduleUrl]);
    REGISTERED_NATIVE_CONNECTORS.add(entry.id);
  }
  const connectorId = entry.engineId || entry.id;
  const connector = manager.list.find((item) => item.id === connectorId);
  if (!connector) {
    throw new Error(`Connector '${entry.id}' failed to register.`);
  }
  CONNECTOR_CACHE.set(entry.id, connector);
  return connector;
}

function normalizeUrl(value) {
  if (value instanceof URL) {
    return value;
  }
  if (typeof value === "string") {
    return new URL(value);
  }
  throw new Error("A valid URL is required.");
}

function normalizeFamilyKey(value) {
  return String(value || "").toLowerCase();
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

function serializeManga(manga) {
  if (!manga) return null;
  return {
    id: manga.id,
    title: manga.title,
    status: manga.status || null
  };
}

function serializeChapter(chapter) {
  if (!chapter) return null;
  return {
    id: chapter.id ?? chapter.url ?? "",
    title: chapter.title ?? chapter.name ?? "",
    language: chapter.language ?? "",
    number: chapter.number ?? chapter.index ?? null
  };
}

function normalizePages(pages) {
  if (!Array.isArray(pages)) return [];
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

async function tryModernCall(connector, method, ...args) {
  if (typeof connector[method] !== "function") return undefined;
  try {
    return await connector[method](...args);
  } catch (error) {
    if (error && /Not implemented/i.test(error.message || "")) {
      return undefined;
    }
    throw error;
  }
}

async function fetchChapters(connector, manga) {
  const modern = await tryModernCall(connector, "_getChapters", manga);
  if (modern) return modern;
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
  if (modern) return modern;
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

async function fetchMangaCatalog(connector) {
  const modern = await tryModernCall(connector, "_getMangas");
  if (modern) return modern;
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
    console.warn("[HK] Delegate detect failed", error);
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

async function managerHandleProbe(payload = {}) {
  const { list, byId } = await ensureIndex();
  if (!payload.url) {
    return { canHandle: false, connectorId: null };
  }
  const url = normalizeUrl(payload.url);
  const filter = buildFamilyFilter(payload);
  let entry = payload.connectorId ? byId.get(payload.connectorId) : null;
  if (entry && !isFamilyAllowed(entry, filter)) {
    entry = null;
  }
  if (!entry) {
    entry = matchEntryForUrl(url, list, filter);
  }
  if (!entry) {
    return { canHandle: false, connectorId: null };
  }
  if (entry.type === "delegate") {
    const canHandle = await delegateDetect(entry, url.href, payload.tabId);
    return { canHandle, connectorId: entry.id, family: entry.family || null };
  }
  const connector = await importConnector(entry);
  const canHandle = typeof connector.canHandleURI === "function"
    ? connector.canHandleURI(url)
    : true;
  return { canHandle, connectorId: entry.id, family: entry.family || null };
}

async function managerHandleManga(payload = {}) {
  const { list, byId } = await ensureIndex();
  const url = normalizeUrl(payload.url);
  const filter = buildFamilyFilter(payload);
  let entry = payload.connectorId ? byId.get(payload.connectorId) : null;
  if (entry && !isFamilyAllowed(entry, filter)) {
    entry = null;
  }
  if (!entry) {
    entry = matchEntryForUrl(url, list, filter);
  }
  if (!entry) {
    throw new Error("No connector available for requested manga URL.");
  }
  if (entry.type === "delegate") {
    return delegateHandleManga(entry, payload, url.href);
  }
  const connector = await importConnector(entry);
  const manga = await connector.getMangaFromURI(url);
  let chapters = await fetchChapters(connector, manga);
  if (!Array.isArray(chapters)) {
    chapters = [];
  }
  return {
    connectorId: entry.id,
    family: entry.family || null,
    manga: serializeManga(manga),
    chapters: chapters.map(serializeChapter)
  };
}

async function managerHandlePages(payload = {}) {
  const { list, byId } = await ensureIndex();
  const url = payload.url ? normalizeUrl(payload.url) : null;
  let entry = payload.connectorId ? byId.get(payload.connectorId) : null;
  const filter = buildFamilyFilter(payload);
  if (entry && !isFamilyAllowed(entry, filter)) {
    entry = null;
  }
  if (!entry && url) {
    entry = matchEntryForUrl(url, list, filter);
  }
  if (!entry) {
    throw new Error("No connector available for requested chapter.");
  }
  if (entry.type === "delegate") {
    return delegateHandlePages(entry, payload, url?.href || null);
  }
  const connector = await importConnector(entry);
  const manga = payload.manga?.id ? payload.manga : { id: payload.mangaId || "", title: payload.mangaTitle || "" };
  const chapter = payload.chapter ? { ...payload.chapter } : {};
  if (!chapter.id) {
    chapter.id = payload.chapterId || (url ? url.pathname + url.search : "");
  }
  if (!chapter.title) {
    chapter.title = payload.chapterTitle || chapter.id;
  }
  if (!chapter.id) {
    throw new Error("Chapter identifier is required.");
  }
  let pages = await fetchPages(connector, manga, chapter);
  return {
    connectorId: entry.id,
    family: entry.family || null,
    chapter: serializeChapter(chapter),
    pages: normalizePages(pages)
  };
}

async function managerHandleCatalog(payload = {}) {
  const { byId } = await ensureIndex();
  const inputId = typeof payload.connectorId === "string" ? payload.connectorId.trim() : "";
  if (!inputId) {
    throw new Error("Connector id is required for catalog listings.");
  }
  const normalizedId = inputId.toLowerCase();
  const entry = byId.get(inputId) || byId.get(normalizedId);
  if (!entry) {
    throw new Error(`Connector '${inputId}' is not registered.`);
  }
  if (entry.type === "delegate") {
    throw new Error("Delegate connectors do not provide catalog listings.");
  }
  const connector = await importConnector(entry);
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

async function managerHandleConnectorPayload(payload = {}) {
  const urlString = typeof payload?.url === "string" ? payload.url : "";
  if (!urlString) {
    throw new Error("Connector payload URL is required.");
  }
  let url = null;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Invalid connector payload URL.");
  }
  const { list, byId } = await ensureIndex();
  const connectorId = url.hostname;
  let entry = null;
  const inputId = typeof payload.connectorId === "string" ? payload.connectorId.trim() : "";
  if (inputId) {
    entry = byId.get(inputId) || byId.get(inputId.toLowerCase()) || null;
  }
  if (!entry) {
    entry = byId.get(connectorId) || byId.get(connectorId.toLowerCase()) || null;
  }
  if (!entry) {
    entry = matchEntryForUrl(url, list, buildFamilyFilter(payload)) || null;
  }
  if (!entry) {
    throw new Error(`Connector '${connectorId}' is not registered.`);
  }
  if (entry.type === "delegate") {
    throw new Error("Delegate connectors do not expose connector payloads.");
  }
  const connector = await importConnector(entry);
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

const MANAGER_COMMANDS = {
  probe: managerHandleProbe,
  manga: managerHandleManga,
  pages: managerHandlePages,
  catalog: managerHandleCatalog,
  connectorPayload: managerHandleConnectorPayload
};

async function managerDispatch(command, payload) {
  const handler = MANAGER_COMMANDS[command];
  if (!handler) {
    throw new Error(`Unknown HK manager command '${command}'.`);
  }
  const data = await handler(payload || {});
  return { ok: true, data };
}

function toArrayBuffer(value) {
  if (value == null) {
    return new ArrayBuffer(0);
  }
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value).buffer;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value).buffer;
  }
  if (typeof value === "object" && value.data) {
    return toArrayBuffer(value.data);
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

function describeLoaderError(label, error) {
  const message = error?.message || String(error);
  return `${label}: ${message}`;
}

function getHostFromContext(context) {
  if (!context?.url) return "";
  try {
    return new URL(context.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const MANAGER_FAILURES = new Map();
const MANAGER_BLOCK_MS = 5 * 60 * 1000;

function noteManagerFailure(host) {
  if (!host) return;
  const current = MANAGER_FAILURES.get(host) || { count: 0, blockedUntil: 0 };
  const nextCount = current.count + 1;
  const blockedUntil = nextCount >= 2 ? Date.now() + MANAGER_BLOCK_MS : current.blockedUntil;
  MANAGER_FAILURES.set(host, { count: nextCount, blockedUntil });
}

function resetManagerFailure(host) {
  if (!host) return;
  MANAGER_FAILURES.delete(host);
}

function isManagerBlocked(host) {
  if (!host) return false;
  const entry = MANAGER_FAILURES.get(host);
  if (!entry) return false;
  const now = Date.now();
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return true;
  }
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    MANAGER_FAILURES.delete(host);
  }
  return false;
}

function runLoaderCandidate(label, context, executor) {
  const host = getHostFromContext(context);
  return RequestAdapter.runWithContext(context, () => executor())
    .then((response) => {
      if (label === "manager") {
        resetManagerFailure(host);
      }
      return { label, response };
    })
    .catch((error) => {
      if (label === "manager") {
        // Gate delegate usage on repeated failures to prefer runner when delegates misbehave (CORS/cookies).
        noteManagerFailure(host);
      }
      throw { label, error };
    });
}

async function hybridDispatch(command, payload, context) {
  if (!HYBRID_COMMANDS.has(command)) {
    return RequestAdapter.runWithContext(context, () => managerDispatch(command, payload));
  }
  const host = getHostFromContext(context);
  return new Promise((resolve, reject) => {
    let settled = false;
    const errors = [];

    const settle = ({ label, response }) => {
      if (settled) {
        return;
      }
      settled = true;
      if (console?.debug) {
        console.debug(label === "manager" ? "[HK] Manager loader won" : "[HK] Runner loader won", command);
      }
      resolve(response);
    };

    const fail = ({ label, error }) => {
      if (settled) {
        return;
      }
      errors.push({ label, error });
      if (errors.length >= 2) {
        const message = errors.map((entry) => describeLoaderError(entry.label, entry.error)).join(" | ");
        reject(new Error(message || "Both HK loaders failed."));
      }
    };

    if (!isManagerBlocked(host)) {
      runLoaderCandidate("manager", context, () => managerDispatch(command, payload))
        .then(settle)
        .catch(fail);
    }
    runLoaderCandidate("runner", context, () => runnerDispatch(command, payload))
      .then(settle)
      .catch(fail);
  });
}

async function dispatchMessage(command, payload = {}) {
  const context = {
    tabId: Number.isInteger(payload?.tabId) ? payload.tabId : null,
    url: payload?.url || null,
    cookies: payload?.cookies || null
  };
  if (!HYBRID_COMMANDS.has(command)) {
    const host = getHostFromContext(context);
    if (isManagerBlocked(host)) {
      console.warn("[HK] Manager loader temporarily blocked for host, using runner", host || "<unknown>");
      return RequestAdapter.runWithContext(context, () => runnerDispatch(command, payload));
    }
    return RequestAdapter.runWithContext(context, () => managerDispatch(command, payload));
  }
  if (loaderMode === "manager") {
    return RequestAdapter.runWithContext(context, () => managerDispatch(command, payload));
  }
  if (loaderMode === "runner") {
    return RequestAdapter.runWithContext(context, () => runnerDispatch(command, payload));
  }
  // Default: race manager vs runner when loader mode is auto/unknown
  return hybridDispatch(command, payload, context);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== HK_COMMAND) {
    return;
  }
  (async () => {
    try {
      const response = await dispatchMessage(message.command, message.payload);
      sendResponse(response);
    } catch (error) {
      console.error("[HK] Dispatch failed", error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

try {
  chrome.runtime.sendMessage({ action: "HK_OFFSCREEN_READY", ready: true }, () => void chrome.runtime.lastError);
} catch (error) {
  console.warn("[HK] Failed to announce offscreen readiness", error);
}
