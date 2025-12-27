// bridge_inject.js
// Runs as a content script at document_start. It injects the page-world patch
// and maintains a shared registry of blob: URLs in the extension's isolated
// world so later content scripts (like content.js) can use the captured bytes.
(function () {
  try {
    const g = globalThis;
    const appendScript = (resource, flagKey) => {
      if (!resource || !flagKey) return;
      if (g[flagKey]) return;
      if (!chrome?.runtime?.getURL) return;
      try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(resource);
        (document.documentElement || document.head || document.body || document).appendChild(script);
        script.addEventListener('load', () => {
          try { script.remove(); } catch { }
        });
        g[flagKey] = true;
      } catch {
        // ignore injection errors; script may be blocked by CSP
      }
    };
    // Shared registry across this page's content scripts
    g.__UNSHACKLE_BLOB_REG = g.__UNSHACKLE_BLOB_REG || new Map();
    const REG = g.__UNSHACKLE_BLOB_REG;

    const pruneRegistry = (() => {
      if (typeof g.__UNSHACKLE_PRUNE_BLOB_REG__ === "function") return g.__UNSHACKLE_PRUNE_BLOB_REG__;
      const LIMITS = g.__UNSHACKLE_BLOB_REG_LIMITS__ || {
        maxEntries: 600,
        maxBytes: 50 * 1024 * 1024,
        maxAgeMs: 5 * 60 * 1000,
        revokedTtlMs: 30 * 1000
      };
      g.__UNSHACKLE_BLOB_REG_LIMITS__ = LIMITS;
      const fn = function prune({ aggressive = false } = {}) {
        const now = Date.now();
        let totalBytes = 0;
        const survivors = [];
        for (const [url, entry] of REG.entries()) {
          if (!entry) { REG.delete(url); continue; }
          const createdAt = Number(entry.createdAt) || 0;
          const age = now - createdAt;
          const size = Number(entry.size) || (entry.buffer && entry.buffer.byteLength) || 0;
          const dropForAge = age > LIMITS.maxAgeMs;
          const dropRevoked = entry.revoked && age > LIMITS.revokedTtlMs;
          const dropAggressive = aggressive && age > (LIMITS.maxAgeMs * 0.5);
          if (dropForAge || dropRevoked || dropAggressive) {
            // Revoke synthetic blob URLs to prevent memory leaks
            if (entry.needsRevoke && entry.syntheticUrl) {
              try { URL.revokeObjectURL(entry.syntheticUrl); } catch { }
            }
            REG.delete(url);
            continue;
          }
          totalBytes += size;
          survivors.push([url, entry, size, createdAt]);
        }
        if (totalBytes > LIMITS.maxBytes || REG.size > LIMITS.maxEntries) {
          survivors.sort((a, b) => a[3] - b[3]);
          while ((totalBytes > LIMITS.maxBytes || REG.size > LIMITS.maxEntries) && survivors.length) {
            const [url, entry, size] = survivors.shift();
            // Revoke synthetic blob URLs to prevent memory leaks
            if (entry && entry.needsRevoke && entry.syntheticUrl) {
              try { URL.revokeObjectURL(entry.syntheticUrl); } catch { }
            }
            if (REG.delete(url)) totalBytes -= size;
          }
        }
      };
      g.__UNSHACKLE_PRUNE_BLOB_REG__ = fn;
      return fn;
    })();

    if (!g.__UNSHACKLE_BLOB_REG_PRUNE_TIMER__) {
      pruneRegistry({ aggressive: true });
      g.__UNSHACKLE_BLOB_REG_PRUNE_TIMER__ = setInterval(() => pruneRegistry(), 60000);
    }

    // Install the bridge listener once
    if (!g.__UNSHACKLE_BLOB_BRIDGE_LISTENER__) {
      g.__UNSHACKLE_BLOB_BRIDGE_LISTENER__ = true;
      window.addEventListener('message', (ev) => {
        const d = ev && ev.data; if (!d || !d.__blobBridge) return;
        if (d.kind === 'createObjectURL' && typeof d.url === 'string' && d.buffer) {
          try {
            REG.set(d.url, { buffer: d.buffer, mime: d.mime || 'application/octet-stream', size: d.size || (d.buffer.byteLength || 0), createdAt: Date.now(), revoked: false });
            pruneRegistry();
          } catch { }
        } else if (d.kind === 'revokeObjectURL' && typeof d.url === 'string') {
          const ent = REG.get(d.url); if (ent) ent.revoked = true;
          pruneRegistry({ aggressive: true });
        }
      }, false);
    }

    // Inject page-world patch at the earliest possible time
    appendScript('page_blob_patch.js', '__UNSHACKLE_PAGE_PATCH_INJECTED__');
    appendScript('page_fetch_bridge.js', '__UNSHACKLE_FETCH_BRIDGE_INJECTED__');

    // Page-world fetch proxy so RequestAdapter can re-use site cookies/DOM context.
    const PAGE_FETCH_REQUEST_TOKEN = "__UNSHACKLE_PAGE_FETCH_REQUEST__";
    const PAGE_FETCH_RESPONSE_TOKEN = "__UNSHACKLE_PAGE_FETCH_RESPONSE__";
    const PAGE_FETCH_READY_TOKEN = "__UNSHACKLE_PAGE_FETCH_READY__";
    const PAGE_FETCH_TIMEOUT_MS = 20000;
    const PAGE_FETCH_READY_TIMEOUT_MS = 2500;
    const PAGE_FETCH_INIT_KEYS = ["method", "mode", "cache", "credentials", "redirect", "referrer", "referrerPolicy", "integrity", "keepalive"];
    const PF_STATE_KEY = "__UNSHACKLE_PAGE_FETCH_STATE_EXT__";
    const pageFetchState = g[PF_STATE_KEY] || { ready: false, waiters: [] };
    g[PF_STATE_KEY] = pageFetchState;

    function resolvePageFetchWaiters(value) {
      const waiters = Array.isArray(pageFetchState.waiters) ? pageFetchState.waiters.splice(0) : [];
      for (const waiter of waiters) {
        try { waiter(value); } catch { }
      }
    }

    (function primePageFetchReadyFlag() {
      try {
        const el = document?.documentElement || document?.body || document?.head;
        if (el && el.getAttribute("data-unshackle-page-fetch-ready") === "1") {
          if (!pageFetchState.ready) {
            pageFetchState.ready = true;
            resolvePageFetchWaiters(true);
          }
        }
      } catch { }
    })();

    if (!g.__UNSHACKLE_PAGE_FETCH_READY_HANDLER_EXT__) {
      const readyHandler = (event) => {
        const data = event?.data;
        if (!data || data.__unshackleFetch !== PAGE_FETCH_READY_TOKEN) return;
        if (data.ready) {
          if (!pageFetchState.ready) {
            pageFetchState.ready = true;
            resolvePageFetchWaiters(true);
          }
        }
      };
      window.addEventListener("message", readyHandler, false);
      g.__UNSHACKLE_PAGE_FETCH_READY_HANDLER_EXT__ = readyHandler;
    }

    function awaitPageFetchReady(timeoutMs = PAGE_FETCH_READY_TIMEOUT_MS) {
      if (pageFetchState.ready) return Promise.resolve(true);
      return new Promise((resolve) => {
        const waiters = pageFetchState.waiters || (pageFetchState.waiters = []);
        let timer = null;
        const settle = (value) => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          const idx = waiters.indexOf(settle);
          if (idx >= 0) {
            waiters.splice(idx, 1);
          }
          resolve(value);
        };
        waiters.push(settle);
        timer = setTimeout(() => settle(false), timeoutMs);
      });
    }

    function serializeHeaders(headers) {
      const map = {};
      if (!headers) return map;
      if (headers instanceof Headers) {
        headers.forEach((value, key) => {
          map[key] = value;
        });
        return map;
      }
      if (Array.isArray(headers)) {
        for (const entry of headers) {
          if (!entry) continue;
          const [key, value] = entry;
          if (typeof key === "string" && value != null) {
            map[key] = value;
          }
        }
        return map;
      }
      if (typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) {
          if (value != null) {
            map[key] = value;
          }
        }
      }
      return map;
    }

    function normalizeBody(body) {
      if (body == null) return null;
      if (typeof body === "string") {
        return body;
      }
      if (body instanceof ArrayBuffer) {
        return body;
      }
      if (ArrayBuffer.isView(body)) {
        const view = body;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      }
      return null;
    }

    function buildInitPayload(init = {}, body = null) {
      const payload = {};
      for (const key of PAGE_FETCH_INIT_KEYS) {
        if (init[key] != null) {
          payload[key] = init[key];
        }
      }
      const normalizedHeaders = serializeHeaders(init.headers);
      if (Object.keys(normalizedHeaders).length) {
        payload.headers = normalizedHeaders;
      }
      const normalizedBody = normalizeBody(body != null ? body : init.body);
      if (normalizedBody != null) {
        payload.body = normalizedBody;
      }
      return payload;
    }

    async function pageBridgeFetch(url, init = {}, body = null, timeoutMs = PAGE_FETCH_TIMEOUT_MS) {
      if (!url) {
        throw new Error("Page fetch requires a URL.");
      }
      const target = typeof window !== "undefined" ? window : null;
      if (!target) {
        throw new Error("Page fetch bridge unavailable.");
      }
      const ready = await awaitPageFetchReady();
      if (!ready) {
        throw new Error("Page fetch bridge not ready.");
      }
      const requestId = `pf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const payload = {
        __unshackleFetch: PAGE_FETCH_REQUEST_TOKEN,
        requestId,
        url,
        init: buildInitPayload(init, body)
      };
      const transfer = [];
      if (payload.init && payload.init.body instanceof ArrayBuffer) {
        transfer.push(payload.init.body);
      }
      return new Promise((resolve, reject) => {
        let finished = false;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          window.removeEventListener("message", handleMessage);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Page fetch timeout"));
        }, Math.max(1000, timeoutMs || PAGE_FETCH_TIMEOUT_MS));
        const handleMessage = (event) => {
          const data = event?.data;
          if (!data || data.__unshackleFetch !== PAGE_FETCH_RESPONSE_TOKEN || data.requestId !== requestId) {
            return;
          }
          clearTimeout(timer);
          cleanup();
          if (!data.ok) {
            reject(new Error(data.error || "Page fetch failed"));
            return;
          }
          resolve({
            body: data.body || null,
            status: data.status || 0,
            statusText: data.statusText || "",
            headers: data.headers || [],
            url: data.url || url
          });
        };
        window.addEventListener("message", handleMessage, false);
        try {
          target.postMessage(payload, "*", transfer);
        } catch (error) {
          clearTimeout(timer);
          cleanup();
          reject(error);
        }
      });
    }

    if (!g.__UNSHACKLE_PAGE_FETCH_RUNTIME_HANDLER__) {
      const runtimeHandler = (message, sender, sendResponse) => {
        if (!message || message.action !== "hkPageFetch") {
          return;
        }
        (async () => {
          try {
            const result = await pageBridgeFetch(message.url, message.init || {}, message.body || null, message.timeout || PAGE_FETCH_TIMEOUT_MS);
            sendResponse({ ok: true, ...result });
          } catch (error) {
            sendResponse({ ok: false, error: String(error?.message || error) });
          }
        })();
        return true;
      };
      chrome.runtime.onMessage.addListener(runtimeHandler);
      g.__UNSHACKLE_PAGE_FETCH_RUNTIME_HANDLER__ = runtimeHandler;
    }
  } catch { }
})();
