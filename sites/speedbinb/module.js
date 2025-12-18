(() => {
  const root = typeof self !== "undefined" ? self : window;
  const REGISTRY_KEY = "__UnshackleSiteRegistry__";
  const REGISTRY_QUEUE_KEY = "__UnshacklePendingSiteModules__";

  function enqueueSiteModule(mod) {
    if (!mod) return;
    const queue = root[REGISTRY_QUEUE_KEY] || (root[REGISTRY_QUEUE_KEY] = []);
    queue.push(mod);
  }

  function registerSiteModule(mod) {
    if (!mod) return;
    const registry = root[REGISTRY_KEY] || root.UnshackleSites || null;
    if (registry && typeof registry.register === "function") {
      registry.register(mod);
      root.UnshackleSites = registry;
      return;
    }
    enqueueSiteModule(mod);
  }

  function sanitizeName(value, fallback) {
    const str = String(value ?? "").trim();
    if (!str) return fallback || "episode";
    return str.replace(/[\\/:*?"<>|]+/g, "_").trim() || fallback || "episode";
  }

  function unique(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  function resolveCandidates(relativePath, baseUrl) {
    const candidates = new Set();
    try {
      const base = new URL(baseUrl, location.href);
      const directUrl = new URL(relativePath, base);
      candidates.add(directUrl.href);
      const dirBase = new URL(".", base);
      candidates.add(new URL(relativePath, dirBase).href);
      if (/123hon\.com/i.test(base.hostname)) {
        const trimmed = base.href.replace(/index\.html?$/i, "");
        candidates.add(new URL(relativePath, trimmed).href);
      }
      if (/kirapo\.jp/i.test(base.hostname)) {
        const adjusted = base.href.replace(/\/viewer\//i, "/");
        candidates.add(new URL(relativePath, adjusted).href);
      }
      if (/yanmaga\.jp/i.test(base.hostname)) {
        try {
          const viewerUrl = new URL(directUrl.href);
          viewerUrl.hostname = "viewer-yanmaga.comici.jp";
          candidates.add(viewerUrl.href);
          if (/^data\//i.test(relativePath)) {
            const dataPath = relativePath.replace(/^data\//i, "");
            const viewerOrigin = `${viewerUrl.protocol}//${viewerUrl.host}/`;
            candidates.add(new URL(dataPath, viewerOrigin).href);
            candidates.add(`https://viewer-yanmaga.comici.jp/${relativePath.replace(/^\.\//, "")}`);
          }
          const sbcUrl = new URL(directUrl.href);
          sbcUrl.hostname = "sbc.yanmaga.jp";
          candidates.add(sbcUrl.href);
        } catch {}
      }
    } catch {}
    return Array.from(candidates);
  }

  function withNoStore(init = {}) {
    const headers = new Headers(init.headers || {});
    if (!headers.has("pragma")) headers.set("pragma", "no-cache");
    if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");
    return {
      ...init,
      headers,
      cache: "no-store",
      credentials: init.credentials || "include"
    };
  }

  function hostMatchesCookieDomain(host, domain) {
    if (!host || !domain) return false;
    const normalizedHost = host.toLowerCase();
    const normalizedDomain = domain.toLowerCase().replace(/^\./, "");
    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  }

  function applyLoginCookies(cookies) {
    if (!Array.isArray(cookies) || !cookies.length) return;
    const host = typeof location?.hostname === "string" ? location.hostname.toLowerCase() : "";
    for (const cookie of cookies) {
      if (!cookie || typeof cookie.name !== "string" || !cookie.name || cookie.httpOnly) continue;
      const value = typeof cookie.value === "string" ? cookie.value : "";
      if (!value) continue;
      const domain = typeof cookie.domain === "string" ? cookie.domain : "";
      if (domain && host && !hostMatchesCookieDomain(host, domain)) continue;
      const parts = [`${cookie.name}=${value}`];
      if (cookie.path) parts.push(`path=${cookie.path}`);
      if (domain && hostMatchesCookieDomain(host, domain)) parts.push(`domain=${domain}`);
      if (cookie.secure) parts.push("Secure");
      const sameSite = typeof cookie.sameSite === "string" ? cookie.sameSite.toLowerCase() : "";
      if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
        const cap = sameSite.charAt(0).toUpperCase() + sameSite.slice(1);
        parts.push(`SameSite=${cap}`);
      }
      if (Number.isFinite(cookie.expirationDate)) {
        const expires = new Date(cookie.expirationDate * 1000);
        if (!Number.isNaN(expires.getTime())) {
          parts.push(`Expires=${expires.toUTCString()}`);
        }
      }
      try {
        document.cookie = parts.join("; ");
      } catch {}
    }
  }

  function isDebugEnabled() {
    try {
      const w = typeof root !== "undefined" ? root : (typeof window !== "undefined" ? window : null);
      if (w && w.__UNSHACKLE_DEBUG__ === true) return true;
      if (typeof localStorage !== "undefined") {
        const v = localStorage.getItem("__UNSHACKLE_DEBUG__");
        if (v === "1" || v === "true") return true;
      }
    } catch {}
    return false;
  }

  const PAGE_FETCH_REQUEST_TOKEN = "__UNSHACKLE_PAGE_FETCH_REQUEST__";
  const PAGE_FETCH_RESPONSE_TOKEN = "__UNSHACKLE_PAGE_FETCH_RESPONSE__";
  const PAGE_FETCH_READY_TOKEN = "__UNSHACKLE_PAGE_FETCH_READY__";
  const PAGE_FETCH_TIMEOUT_MS = 8000;
  const PAGE_FETCH_READY_TIMEOUT_MS = 600;
  const pageFetchState = (() => {
    const key = "__UNSHACKLE_PAGE_FETCH_STATE__";
    if (root && root[key]) return root[key];
    const state = { ready: false, waiters: [] };
    if (root) root[key] = state;
    return state;
  })();
  (function primeBridgeReadyFlag() {
    if (pageFetchState.ready) return;
    try {
      const doc = typeof document !== "undefined" ? document : null;
      if (!doc) return;
      const el = doc.documentElement || doc.body || doc.head;
      if (el && el.getAttribute("data-unshackle-page-fetch-ready") === "1") {
        pageFetchState.ready = true;
        resolvePageBridgeWaiters();
      }
    } catch {}
  })();

  function pageBridgeSupported() {
    try {
      return typeof window !== "undefined" && typeof window.postMessage === "function" && typeof window.addEventListener === "function";
    } catch {
      return false;
    }
  }

  function serializeBridgeHeaders(headers) {
    const result = {};
    if (!headers) return result;
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        if (typeof key === "string") result[key] = value;
      });
      return result;
    }
    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (!entry) continue;
        const [key, value] = entry;
        if (typeof key === "string" && value != null) {
          result[key] = value;
        }
      }
      return result;
    }
    if (typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        if (typeof key === "string" && value != null) {
          result[key] = value;
        }
      }
    }
    return result;
  }

  function serializeBridgeInit(init = {}) {
    if (!init || typeof init !== "object") return {};
    const allowed = {};
    const keys = ["method", "mode", "cache", "credentials", "redirect", "referrer", "referrerPolicy", "integrity", "keepalive"];
    for (const key of keys) {
      if (key in init && init[key] != null) {
        allowed[key] = init[key];
      }
    }
    const headers = serializeBridgeHeaders(init.headers);
    if (Object.keys(headers).length) {
      allowed.headers = headers;
    }
    if (typeof init.body === "string") {
      allowed.body = init.body;
    }
    return allowed;
  }

  function normalizeBridgeHeaders(pairs) {
    if (!pairs) return {};
    if (Array.isArray(pairs)) {
      const map = {};
      for (const entry of pairs) {
        if (!entry) continue;
        const [key, value] = entry;
        if (!key) continue;
        const existing = map[key];
        if (existing != null) {
          map[key] = `${existing}, ${value}`;
        } else {
          map[key] = value;
        }
      }
      return map;
    }
    if (typeof pairs === "object") {
      return { ...pairs };
    }
    return {};
  }

  function resolvePageBridgeWaiters() {
    if (!pageFetchState.waiters || !pageFetchState.waiters.length) return;
    const waiters = pageFetchState.waiters.slice();
    pageFetchState.waiters.length = 0;
    for (const waiter of waiters) {
      try {
        waiter(true);
      } catch {}
    }
  }

  function awaitPageBridgeReady(timeoutMs = PAGE_FETCH_READY_TIMEOUT_MS) {
    if (!pageBridgeSupported()) return Promise.resolve(false);
    if (pageFetchState.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiters = pageFetchState.waiters || (pageFetchState.waiters = []);
      let timer = null;
      const resolver = (value) => {
        if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
        const idx = waiters.indexOf(resolver);
        if (idx >= 0) waiters.splice(idx, 1);
        resolve(value);
      };
      waiters.push(resolver);
      timer = setTimeout(() => {
        const idx = waiters.indexOf(resolver);
        if (idx >= 0) waiters.splice(idx, 1);
        resolve(false);
      }, timeoutMs);
    });
  }

  if (pageBridgeSupported() && !root.__UNSHACKLE_PAGE_FETCH_READY_HANDLER__) {
    try {
      const handler = (event) => {
        const data = event?.data;
        if (!data || data.__unshackleFetch !== PAGE_FETCH_READY_TOKEN) return;
        if (data.ready) {
          pageFetchState.ready = true;
          resolvePageBridgeWaiters();
        }
      };
      window.addEventListener("message", handler);
      root.__UNSHACKLE_PAGE_FETCH_READY_HANDLER__ = handler;
    } catch {}
  }

  function shouldUsePageBridge(url) {
    try {
      const parsed = new URL(url, (typeof location !== "undefined" && location.href) ? location.href : undefined);
      const host = parsed.hostname || "";
      if (!host) return false;
      if (/\.yanmaga\.jp$/i.test(host)) return true;
      if (/\.comici\.jp$/i.test(host)) return true;
      if (/\.futabanet\.jp$/i.test(host)) return true;
      return false;
    } catch {
      return false;
    }
  }

  function refreshDynamicTimestamp(url, base) {
    if (!url) return url;
    try {
      const parsed = new URL(url, base || ((typeof location !== "undefined" && location.href) ? location.href : undefined));
      const host = parsed.hostname || "";
      if (!host) return url;
      if (parsed.searchParams.has("dmytime")) {
        parsed.searchParams.set("dmytime", Date.now().toString());
        return parsed.href;
      }
      return url;
    } catch {
      return url;
    }
  }

  function buildResponseFromBridge(payload) {
    if (!payload || !payload.body) return null;
    try {
      const headers = normalizeBridgeHeaders(payload.headers);
      return {
        response: new Response(payload.body, {
          status: payload.status || 0,
          statusText: payload.statusText || "",
          headers
        }),
        url: payload.url
      };
    } catch {
      return null;
    }
  }

  async function pageBridgeFetch(url, init = {}) {
    if (!pageBridgeSupported() || !url) return null;
    const target = typeof window !== "undefined" ? window : null;
    if (!target || typeof target.postMessage !== "function" || typeof target.addEventListener !== "function") {
      return null;
    }
    if (!pageFetchState.ready) {
      await awaitPageBridgeReady();
      if (!pageFetchState.ready) {
        return null;
      }
    }
    const requestId = `pf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const payload = {
      __unshackleFetch: PAGE_FETCH_REQUEST_TOKEN,
      requestId,
      url,
      init: serializeBridgeInit(init)
    };
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        target.removeEventListener("message", handleMessage);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Page fetch timeout"));
      }, PAGE_FETCH_TIMEOUT_MS);
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
          body: data.body,
          status: data.status,
          statusText: data.statusText,
          headers: data.headers,
          url: data.url || url
        });
      };
      target.addEventListener("message", handleMessage);
      try {
        target.postMessage(payload, "*");
      } catch (err) {
        clearTimeout(timer);
        cleanup();
        reject(err);
      }
    });
  }

  const PTBINB_QUERY_PARAM_RE = /^(?:u\d+|cv\d{2}|cv0[12]|p|vm|src|k|random_identification|rid|type)$/i;
  const PTBINB_KEY_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const PTBINB_PORTRAIT_CASE_RE = /<t-case\s+[^>]*screen\.portrait[^>]*>[\s\S]*?<\/t-case>/gi;
  const PTBINB_PORTRAIT_NOCASE_RE = /<t-nocase\s+[^>]*screen\.portrait[^>]*>[\s\S]*?<\/t-nocase>/gi;
  const PTBINB_SERVER_TYPES = {
    sbc: 0,
    direct: 1,
    rest: 2
  };
  const IS_IOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/i.test(navigator.userAgent || "");

  let PTBINB_INDEX_TABLE = null;

  function getPtbinbIndexTable() {
    if (PTBINB_INDEX_TABLE) return PTBINB_INDEX_TABLE;
    const map = new Array(128).fill(-1);
    for (let i = 0; i < PTBINB_KEY_CHARSET.length; i++) {
      map[PTBINB_KEY_CHARSET.charCodeAt(i)] = i;
    }
    PTBINB_INDEX_TABLE = map;
    return PTBINB_INDEX_TABLE;
  }
  function normalizeBaseUrl(value, fallback) {
    try {
      if (!value) throw new Error("missing");
      const url = new URL(value, fallback);
      const normalizedPath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      return `${url.origin}${normalizedPath}`;
    } catch {
      return fallback;
    }
  }

  function normalizeEpisodeUrl(url) {
    try {
      if (typeof location !== "undefined" && location?.href) {
        return new URL(url, location.href).href;
      }
      return new URL(url).href;
    } catch {
      if (typeof location !== "undefined" && location?.href) {
        return location.href;
      }
      return String(url ?? "");
    }
  }

  function generatePtbinbKey(cid) {
    const seed = String(cid || "");
    let nonce = Date.now().toString(16);
    if (nonce.length < 16) {
      nonce = nonce.padStart(16, "x");
    } else if (nonce.length > 16) {
      nonce = nonce.slice(-16);
    }
    if (!seed) {
      let accum = 0;
      return nonce
        .split("")
        .map((ch, index) => {
          accum ^= nonce.charCodeAt(index);
          const offset = accum & 63;
          return ch + PTBINB_KEY_CHARSET.charAt(offset);
        })
        .join("");
    }
    const repeats = Math.ceil(16 / seed.length) + 1;
    const repeated = Array(repeats).join(seed);
    const head = repeated.substr(0, 16);
    const tail = repeated.substr(-16, 16);
    let accumA = 0;
    let accumB = 0;
    let accumC = 0;
    return nonce
      .split("")
      .map((ch, index) => {
        accumA ^= nonce.charCodeAt(index);
        accumB ^= head.charCodeAt(index);
        accumC ^= tail.charCodeAt(index);
        const tableIndex = (accumA + accumB + accumC) & 63;
        return ch + PTBINB_KEY_CHARSET.charAt(tableIndex);
      })
      .join("");
  }

  function decodePtbinbTable(cipher, cid, key) {
    if (!cipher) return null;
    const decrypt = (subject) => {
      if (!subject) return null;
      let hash = 0;
      for (let index = 0; index < subject.length; index++) {
        hash += subject.charCodeAt(index) << (index % 16);
      }
      hash &= 0x7fffffff;
      if (hash === 0) {
        hash = 0x12345678;
      }
      let state = hash;
      let decoded = "";
      for (let i = 0; i < cipher.length; i++) {
        state = (state >>> 1) ^ (1210056708 & -(state & 1));
        const charCode = ((cipher.charCodeAt(i) - 32 + state) % 94) + 32;
        decoded += String.fromCharCode(charCode);
      }
      try {
        return JSON.parse(decoded);
      } catch {
        return null;
      }
    };
    return decrypt(`${cid}:${key}`) || decrypt(`${key}:${cid}`) || null;
  }

  function ensureNumberArray(value) {
    if (!Array.isArray(value)) {
      throw new Error("Expected numeric array.");
    }
    return value.map((entry) => {
      const num = Number(entry);
      if (!Number.isFinite(num)) {
        throw new Error("Invalid numeric entry in scramble table.");
      }
      return num;
    });
  }

  function ensureStringArray(value) {
    if (!Array.isArray(value)) {
      throw new Error("Expected string array.");
    }
    return value.map((entry) => String(entry ?? ""));
  }

  function parsePtbinbMetadata(payload, cid, key, pageUrl) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid bibGetCntntInfo payload.");
    }
    if (!("result" in payload) || Number(payload.result) !== 1) {
      throw new Error("bibGetCntntInfo request failed.");
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const entry = items[0] || {};
    const contentsServer = entry.ContentsServer;
    if (!contentsServer) {
      throw new Error("Undefined ContentsServer.");
    }
    const sbcurl = normalizeBaseUrl(contentsServer, pageUrl);
    const serverTypeValue = Number.parseInt(entry.ServerType ?? 0, 10);
    let serverType = PTBINB_SERVER_TYPES.sbc;
    if (serverTypeValue === PTBINB_SERVER_TYPES.direct) {
      serverType = PTBINB_SERVER_TYPES.direct;
    } else if (serverTypeValue === PTBINB_SERVER_TYPES.rest) {
      serverType = PTBINB_SERVER_TYPES.rest;
    } else if (serverTypeValue !== PTBINB_SERVER_TYPES.sbc) {
      throw new Error("Invalid ptbinb server type.");
    }
    const rawViewMode = Number.parseInt(entry.ViewMode ?? -1, 10);
    if (rawViewMode === -1) {
      throw new Error("Unsupported view mode.");
    }
    const requestToken = entry.p ?? null;
    if (requestToken !== null && typeof requestToken !== "string") {
      throw new Error("Invalid ptbinb request token.");
    }
    if (!entry.ctbl || !entry.ptbl) {
      throw new Error("Missing ptbinb scramble tables.");
    }
    const decodedCtbl = decodePtbinbTable(entry.ctbl, cid, key);
    const decodedPtbl = decodePtbinbTable(entry.ptbl, cid, key);
    if (!Array.isArray(decodedCtbl) || !Array.isArray(decodedPtbl)) {
      throw new Error("ptbinb: could not decode tables.");
    }
    const ctbl = ensureStringArray(decodedCtbl);
    const ptbl = ensureStringArray(decodedPtbl);
    let stbl = null;
    let ttbl = null;
    if (entry.stbl) {
      const decoded = decodePtbinbTable(entry.stbl, cid, key);
      if (Array.isArray(decoded)) {
        try {
          stbl = ensureNumberArray(decoded);
        } catch (err) {
          console.warn("ptbinb: stbl decode skipped", err);
        }
      }
    }
    if (entry.ttbl) {
      const decoded = decodePtbinbTable(entry.ttbl, cid, key);
      if (Array.isArray(decoded)) {
        try {
          ttbl = ensureNumberArray(decoded);
        } catch (err) {
          console.warn("ptbinb: ttbl decode skipped", err);
        }
      }
    }
    return {
      sbcurl,
      servertype: serverType,
      viewmode: rawViewMode,
      token: requestToken === null ? null : requestToken,
      stbl,
      ttbl,
      ctbl,
      ptbl
    };
  }

  function buildPtbinbContentUrl(context, meta, timestamp) {
    const base = meta?.sbcurl || context.infoHref || context.pageUrl;
    const timeParam = timestamp || Date.now().toString();
    let target;
    if (meta.servertype === PTBINB_SERVER_TYPES.direct) {
      target = new URL("content.js", base);
      target.searchParams.set("dmytime", timeParam);
    } else if (meta.servertype === PTBINB_SERVER_TYPES.rest) {
      target = new URL("content", base);
      if (timeParam) target.searchParams.set("dmytime", timeParam);
    } else {
      target = new URL("sbcGetCntnt.php", base);
      target.searchParams.set("cid", context.cid);
      if (meta.token) {
        target.searchParams.set("p", meta.token);
      }
      target.searchParams.set("vm", String(meta.viewmode ?? 0));
      target.searchParams.set("dmytime", timeParam);
    }
    const extraEntries = Object.entries(context.extraQuery || {});
    for (const [key, value] of extraEntries) {
      if (value == null || value === "") continue;
      target.searchParams.set(key, value);
    }
    if (meta.servertype === PTBINB_SERVER_TYPES.rest && typeof target.searchParams.sort === "function") {
      target.searchParams.sort();
    }
    if (isDebugEnabled()) {
      try {
        const hasU0 = target.searchParams.has("u0");
        const hasU1 = target.searchParams.has("u1");
        const u0Len = (target.searchParams.get("u0") || "").length;
        const u1Len = (target.searchParams.get("u1") || "").length;
        console.debug("[Unshackle][ptbinb] content URL built", {
          serverType: meta.servertype,
          url: target.href,
          hasU0,
          hasU1,
          u0Len,
          u1Len
        });
      } catch {}
    }
    return target.href;
  }

  async function fetchPtbinbMetadata(context) {
    const liveExtras = collectPtbinbConfigParams();
    if (liveExtras && context) {
      context.extraQuery = { ...(context.extraQuery || {}), ...liveExtras };
    }
    const key = (typeof context.initialKey === "string" && context.initialKey.trim())
      ? context.initialKey.trim()
      : generatePtbinbKey(context.cid);
    context.initialKey = key;
    const infoUrl = new URL(context.infoHref);
    infoUrl.searchParams.set("cid", context.cid);
    infoUrl.searchParams.set("k", key);
    infoUrl.searchParams.set("dmytime", Date.now().toString());
    const extraEntries = Object.entries(context.extraQuery || {});
    for (const [param, value] of extraEntries) {
      if (!infoUrl.searchParams.has(param) && value != null && value !== "") {
        infoUrl.searchParams.set(param, value);
      }
    }
    if (typeof infoUrl.searchParams.sort === "function") {
      infoUrl.searchParams.sort();
    }
    const headers = {};
    if (context.referer) {
      headers.Referer = context.referer;
    }
    const requestInit = withNoStore({ headers, credentials: "include" });
    if (isDebugEnabled()) {
      try {
        console.debug("[Unshackle][ptbinb] info URL", {
          url: infoUrl.href,
          hasK: infoUrl.searchParams.has("k"),
          kLen: (infoUrl.searchParams.get("k") || "").length,
          hasU0: infoUrl.searchParams.has("u0"),
          hasU1: infoUrl.searchParams.has("u1")
        });
      } catch {}
    }
    const { response } = await fetchWithCandidates(infoUrl.href, context.pageUrl, requestInit);
    const payload = await response.json();
    const meta = parsePtbinbMetadata(payload, context.cid, key, context.pageUrl);
    return {
      meta,
      infoItem: Array.isArray(payload.items) ? payload.items[0] || null : null
    };
  }

  async function fetchPtbinbContent(context, meta, tapState) {
    const cachedPayload = tapState ? getTapContentPayload(tapState, context?.cid) : null;
    if (cachedPayload) {
      const parsed = parsePtbinbContentPayload(cachedPayload);
      return { ...parsed, timestamp: Date.now().toString(), source: "tap" };
    }
    const liveExtras = collectPtbinbConfigParams();
    if (liveExtras && context) {
      context.extraQuery = { ...(context.extraQuery || {}), ...liveExtras };
    }
    const timestamp = Date.now().toString();
    const contentUrl = buildPtbinbContentUrl(context, meta, timestamp);
    const headers = {};
    if (context.referer) {
      headers.Referer = context.referer;
    }
    const requestInit = withNoStore({ headers, credentials: "include" });
    if (isDebugEnabled()) {
      try {
        const u = new URL(contentUrl, context.pageUrl);
        console.debug("[Unshackle][ptbinb] fetching content", {
          url: u.href,
          host: u.host,
          path: u.pathname,
          hasU0: u.searchParams.has("u0"),
          hasU1: u.searchParams.has("u1"),
          u0Len: (u.searchParams.get("u0") || "").length,
          u1Len: (u.searchParams.get("u1") || "").length
        });
      } catch {}
    }
    let response = null;
    // Prefer direct fetch for speed; fall back to page bridge only if needed.
    try {
      const result = await fetchWithCandidates(contentUrl, context.pageUrl, requestInit);
      response = result.response;
    } catch {
      response = null;
    }
    if (!response && shouldUsePageBridge(contentUrl)) {
      try {
        const bridged = await pageBridgeFetch(contentUrl, requestInit);
        const built = bridged ? buildResponseFromBridge(bridged) : null;
        if (built?.response) {
          response = built.response;
          if (tapState) {
            try {
              const bridgeClone = response.clone();
              bridgeClone.text().then(text => {
                try {
                  const payload = JSON.parse(text);
                  storeTapContentResponse(tapState, contentUrl, payload);
                } catch {
                  storeTapContentResponse(tapState, contentUrl, text);
                }
              }).catch(() => {});
            } catch {}
          }
          if (isDebugEnabled()) {
            try {
              console.debug("[Unshackle][ptbinb] content via bridge", { url: built.url || contentUrl });
            } catch {}
          }
        }
      } catch (err) {
        if (isDebugEnabled()) {
          try { console.debug("[Unshackle][ptbinb] bridge fetch failed, falling back", { error: String(err?.message || err) }); } catch {}
        }
      }
    }
    if (!response) {
      const result = await fetchWithCandidates(contentUrl, context.pageUrl, requestInit);
      response = result.response;
    }
    const text = await response.text();
    const parsed = parsePtbinbContentPayload(text);
    if (tapState) {
      storeTapContentResponse(tapState, contentUrl, parsed);
    }
    return { ...parsed, timestamp };
  }

  function parsePtbinbContentPayload(payload) {
    let data = payload;
    if (typeof payload === "string") {
      let trimmed = payload.trim();
      const jsonpMatch = trimmed.match(/^[A-Za-z0-9_]+\(([\s\S]*)\)$/);
      if (jsonpMatch) {
        trimmed = jsonpMatch[1];
      }
      data = JSON.parse(trimmed);
    }
    if (!data || typeof data !== "object") {
      throw new Error("Invalid ptbinb content payload.");
    }
    if (Number(data.result) !== 1) {
      throw new Error("ptbinb content request failed.");
    }
    if (typeof data.ttx !== "string") {
      throw new Error("Missing TTX data.");
    }
    return {
      ttx: data.ttx,
      searchData: typeof data.SearchData === "string" ? data.SearchData : "",
      imageClass: (data.ImageClass || "").toString(),
      isPaginated: data.IsTateyomi ? !data.IsTateyomi : true
    };
  }

  function stripPtbinbLandscapeTtx(ttx) {
    if (!ttx || typeof ttx !== "string") return "";
    return ttx.replace(PTBINB_PORTRAIT_CASE_RE, "").replace(PTBINB_PORTRAIT_NOCASE_RE, "");
  }

  function parsePtbinbTagAttributes(fragment) {
    const attrs = {};
    if (!fragment) return attrs;
    const regex = /([^\s=]+)(?:\s*=\s*(["'])(.*?)\2|\s*=\s*([^\s"'>]+))?/g;
    let match;
    while ((match = regex.exec(fragment))) {
      const name = match[1].toLowerCase();
      const value = match[3] ?? match[4] ?? "";
      attrs[name] = value;
    }
    return attrs;
  }

  function parsePtbinbPages(ttx) {
    const working = stripPtbinbLandscapeTtx(ttx);
    if (!working) return [];
    const results = [];
    const regex = /<(t-img|img)\b([^>]*)>/gi;
    let match;
    while ((match = regex.exec(working))) {
      const attrs = parsePtbinbTagAttributes(match[2]);
      const rawSrc = attrs.src || "";
      const width = Number.parseInt(attrs.orgwidth || attrs.width || "0", 10);
      const height = Number.parseInt(attrs.orgheight || attrs.height || "0", 10);
      if (!rawSrc || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        continue;
      }
      results.push({
        id: attrs.id || `page-${results.length + 1}`,
        src: rawSrc.replace(/^binb:\/\//i, ""),
        orgWidth: width,
        orgHeight: height,
        usemap: attrs.usemap || ""
      });
    }
    return results;
  }

  class PtbinbIdentityScrambler {
    wt() {
      return true;
    }
    It() {
      return false;
    }
    yt(rect) {
      return rect;
    }
    Ot(rect) {
      return [
        {
          xsrc: 0,
          ysrc: 0,
          width: rect.width,
          height: rect.height,
          xdest: 0,
          ydest: 0
        }
      ];
    }
  }

  class PtbinbGridScrambler {
    constructor(sourcePattern, targetPattern) {
      this.source = this.parsePattern(sourcePattern);
      this.target = this.parsePattern(targetPattern);
    }

    wt() {
      return !!(this.source && this.target);
    }

    It(rect) {
      return rect.width >= 64 && rect.height >= 64 && rect.width * rect.height >= 102400;
    }

    yt(rect) {
      return rect;
    }

    Ot(rect) {
      if (!this.wt()) return null;
      if (!this.It(rect)) {
        return [
          {
            xsrc: 0,
            ysrc: 0,
            width: rect.width,
            height: rect.height,
            xdest: 0,
            ydest: 0
          }
        ];
      }
      const width = rect.width - (rect.width % 8);
      const baseTileWidth = Math.floor((width - 1) / 7) - (Math.floor((width - 1) / 7) % 8);
      const remainderWidth = width - 7 * baseTileWidth;
      const height = rect.height - (rect.height % 8);
      const baseTileHeight = Math.floor((height - 1) / 7) - (Math.floor((height - 1) / 7) % 8);
      const remainderHeight = height - 7 * baseTileHeight;
      const transfers = [];
      for (let index = 0; index < this.source.piece.length; index++) {
        const sourcePiece = this.source.piece[index];
        const targetPiece = this.target.piece[index];
        transfers.push({
          xsrc: Math.floor(sourcePiece.x / 2) * baseTileWidth + (sourcePiece.x % 2) * remainderWidth,
          ysrc: Math.floor(sourcePiece.y / 2) * baseTileHeight + (sourcePiece.y % 2) * remainderHeight,
          width: Math.floor(sourcePiece.w / 2) * baseTileWidth + (sourcePiece.w % 2) * remainderWidth,
          height: Math.floor(sourcePiece.h / 2) * baseTileHeight + (sourcePiece.h % 2) * remainderHeight,
          xdest: Math.floor(targetPiece.x / 2) * baseTileWidth + (targetPiece.x % 2) * remainderWidth,
          ydest: Math.floor(targetPiece.y / 2) * baseTileHeight + (targetPiece.y % 2) * remainderHeight
        });
      }
      const maxWidth = baseTileWidth * (this.source.ndx - 1) + remainderWidth;
      const maxHeight = baseTileHeight * (this.source.ndy - 1) + remainderHeight;
      if (maxWidth < rect.width) {
        transfers.push({
          xsrc: maxWidth,
          ysrc: 0,
          width: rect.width - maxWidth,
          height: maxHeight,
          xdest: maxWidth,
          ydest: 0
        });
      }
      if (maxHeight < rect.height) {
        transfers.push({
          xsrc: 0,
          ysrc: maxHeight,
          width: rect.width,
          height: rect.height - maxHeight,
          xdest: 0,
          ydest: maxHeight
        });
      }
      return transfers;
    }

    parsePattern(value) {
      if (!value) return null;
      const parts = value.split("-");
      if (parts.length !== 3) return null;
      const ndx = Number.parseInt(parts[0], 10);
      const ndy = Number.parseInt(parts[1], 10);
      const payload = parts[2];
      if (!Number.isFinite(ndx) || !Number.isFinite(ndy) || payload.length !== ndx * ndy * 2) {
        return null;
      }
      const bothLimit = (ndx - 1) * (ndy - 1) - 1;
      const widthLimit = ndx - 1 + bothLimit;
      const heightLimit = ndy - 1 + widthLimit;
      const singleLimit = 1 + heightLimit;
      const pieces = [];
      for (let index = 0; index < ndx * ndy; index++) {
        const x = this.decodeChar(payload.charAt(2 * index));
        const y = this.decodeChar(payload.charAt(2 * index + 1));
        let widthPieces = 2;
        let heightPieces = 2;
        if (index > bothLimit && index <= widthLimit) {
          widthPieces = 2;
          heightPieces = 1;
        } else if (index > widthLimit && index <= heightLimit) {
          widthPieces = 1;
          heightPieces = 2;
        } else if (index > heightLimit && index <= singleLimit) {
          widthPieces = 1;
          heightPieces = 1;
        }
        pieces.push({ x, y, w: widthPieces, h: heightPieces });
      }
      return { ndx, ndy, piece: pieces };
    }

    decodeChar(ch) {
      const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const lower = "abcdefghijklmnopqrstuvwxyz";
      let offset = upper.indexOf(ch);
      if (offset >= 0) {
        return 1 + 2 * offset;
      }
      offset = lower.indexOf(ch);
      if (offset >= 0) {
        return 2 * offset;
      }
      return 0;
    }
  }

  class PtbinbPieceScrambler {
    constructor(sourcePattern, targetPattern) {
      this.kt = null;
      const sourceMatch = sourcePattern ? sourcePattern.match(/^=([0-9]+)-([0-9]+)([-+])([0-9]+)-([-_0-9A-Za-z]+)$/) : null;
      const targetMatch = targetPattern ? targetPattern.match(/^=([0-9]+)-([0-9]+)([-+])([0-9]+)-([-_0-9A-Za-z]+)$/) : null;
      if (
        sourceMatch &&
        targetMatch &&
        sourceMatch[1] === targetMatch[1] &&
        sourceMatch[2] === targetMatch[2] &&
        sourceMatch[4] === targetMatch[4] &&
        sourceMatch[3] === "+" &&
        targetMatch[3] === "-"
      ) {
        this.T = Number.parseInt(sourceMatch[1], 10);
        this.j = Number.parseInt(sourceMatch[2], 10);
        this.Dt = Number.parseInt(sourceMatch[4], 10);
        if (Number.isFinite(this.T) && Number.isFinite(this.j) && Number.isFinite(this.Dt) && this.T <= 8 && this.j <= 8 && this.T * this.j <= 64) {
          const expectedLength = this.T + this.j + this.T * this.j;
          if (sourceMatch[5].length === expectedLength && targetMatch[5].length === expectedLength) {
            const sourceData = this.decodePattern(sourceMatch[5]);
            const targetData = this.decodePattern(targetMatch[5]);
            if (sourceData && targetData) {
              this.Rt = sourceData.columns;
              this.Ft = sourceData.rows;
              this.Lt = targetData.columns;
              this.Nt = targetData.rows;
              this.kt = [];
              for (let index = 0; index < this.T * this.j; index++) {
                this.kt.push(sourceData.pieces[targetData.pieces[index]]);
              }
            }
          }
        }
      }
    }

    wt() {
      return Array.isArray(this.kt);
    }

    It(rect) {
      const horizontalMargin = 2 * this.T * this.Dt;
      const verticalMargin = 2 * this.j * this.Dt;
      return rect.width >= 64 + horizontalMargin && rect.height >= 64 + verticalMargin && rect.width * rect.height >= (320 + horizontalMargin) * (320 + verticalMargin);
    }

    yt(rect) {
      if (!this.It(rect)) return rect;
      return {
        width: rect.width - 2 * this.T * this.Dt,
        height: rect.height - 2 * this.j * this.Dt
      };
    }

    Ot(rect) {
      if (!this.wt()) return null;
      if (!this.It(rect)) {
        return [
          {
            xsrc: 0,
            ysrc: 0,
            width: rect.width,
            height: rect.height,
            xdest: 0,
            ydest: 0
          }
        ];
      }
      const innerWidth = rect.width - 2 * this.T * this.Dt;
      const innerHeight = rect.height - 2 * this.j * this.Dt;
      if (innerWidth <= 0 || innerHeight <= 0) return null;
      const baseWidth = Math.floor((innerWidth + this.T - 1) / this.T);
      const tileWidth = baseWidth - 2 * this.Dt;
      const remainderWidth = innerWidth - (this.T - 1) * tileWidth;
      const baseHeight = Math.floor((innerHeight + this.j - 1) / this.j);
      const tileHeight = baseHeight - 2 * this.Dt;
      const remainderHeight = innerHeight - (this.j - 1) * tileHeight;
      const transfers = [];
      for (let index = 0; index < this.T * this.j; index++) {
        const columnIndex = index % this.T;
        const rowIndex = Math.floor(index / this.T);
        const sourceX = this.Dt + columnIndex * (tileWidth + 2 * this.Dt) + (this.Lt[rowIndex] < columnIndex ? remainderWidth - tileWidth : 0);
        const sourceY = this.Dt + rowIndex * (tileHeight + 2 * this.Dt) + (this.Nt[columnIndex] < rowIndex ? remainderHeight - tileHeight : 0);
        const targetIndex = this.kt[index];
        const targetColumn = targetIndex % this.T;
        const targetRow = Math.floor(targetIndex / this.T);
        const destX = targetColumn * tileWidth + (this.Rt[targetRow] < targetColumn ? remainderWidth - tileWidth : 0);
        const destY = targetRow * tileHeight + (this.Ft[targetColumn] < targetRow ? remainderHeight - tileHeight : 0);
        const currentWidth = this.Lt[rowIndex] === columnIndex ? remainderWidth : tileWidth;
        const currentHeight = this.Nt[columnIndex] === rowIndex ? remainderHeight : tileHeight;
        transfers.push({
          xsrc: sourceX,
          ysrc: sourceY,
          width: currentWidth,
          height: currentHeight,
          xdest: destX,
          ydest: destY
        });
      }
      return transfers;
    }

    decodePattern(payload) {
      if (!payload || payload.length !== this.T + this.j + this.T * this.j) return null;
      const rows = [];
      const columns = [];
      const pieces = [];
      for (let i = 0; i < this.T; i++) {
        rows.push(this.decodeCharCode(payload.charCodeAt(i)));
      }
      for (let i = 0; i < this.j; i++) {
        columns.push(this.decodeCharCode(payload.charCodeAt(this.T + i)));
      }
      for (let i = 0; i < this.T * this.j; i++) {
        pieces.push(this.decodeCharCode(payload.charCodeAt(this.T + this.j + i)));
      }
      if (rows.some((value) => value < 0) || columns.some((value) => value < 0) || pieces.some((value) => value < 0)) {
        return null;
      }
      return { rows, columns, pieces };
    }

    decodeCharCode(code) {
      const table = getPtbinbIndexTable();
      if (code < 0 || code >= table.length) return -1;
      return table[code];
    }
  }

  function getPtbinbScrambler(meta, imageId) {
    if (!meta || !Array.isArray(meta.ptbl) || !Array.isArray(meta.ctbl)) return null;
    const identifier = typeof imageId === "string" ? imageId : "";
    const scores = [0, 0];
    if (identifier) {
      const segment = identifier.slice(identifier.lastIndexOf("/") + 1);
      for (let i = 0; i < segment.length; i++) {
        scores[i % 2] += segment.charCodeAt(i);
      }
      scores[0] %= 8;
      scores[1] %= 8;
    }
    const ptEntry = meta.ptbl[scores[0]] || "";
    const ctEntry = meta.ctbl[scores[1]] || "";
    if (ptEntry.startsWith("=") && ctEntry.startsWith("=")) {
      const scrambler = new PtbinbPieceScrambler(ctEntry, ptEntry);
      return scrambler.wt() ? scrambler : null;
    }
    if (/^[0-9]/.test(ctEntry) && /^[0-9]/.test(ptEntry)) {
      const scrambler = new PtbinbGridScrambler(ctEntry, ptEntry);
      return scrambler.wt() ? scrambler : null;
    }
    if (!ctEntry && !ptEntry) {
      return new PtbinbIdentityScrambler();
    }
    return null;
  }

  function buildPtbinbDescramble(meta, page, widthOverride, heightOverride) {
    const scrambler = getPtbinbScrambler(meta, page?.src);
    if (!scrambler || !scrambler.wt()) return null;
    const width = Math.max(
      1,
      Math.round(Number.isFinite(widthOverride) ? widthOverride : Number(page?.orgWidth) || 0)
    );
    const height = Math.max(
      1,
      Math.round(Number.isFinite(heightOverride) ? heightOverride : Number(page?.orgHeight) || 0)
    );
    if (!width || !height) return null;
    const rect = { width, height };
    const targetRect = scrambler.yt(rect) || rect;
    const transfers = scrambler.Ot(rect);
    if (!transfers || !transfers.length) return null;
    return {
      width: Math.max(1, Math.round(targetRect.width || width)),
      height: Math.max(1, Math.round(targetRect.height || height)),
      transfers
    };
  }

  function createPtbinbDownloadSession(ptbinb) {
    return {
      cid: ptbinb.cid,
      extraQuery: { ...(ptbinb.extraQuery || {}) },
      pageUrl: ptbinb.pageUrl,
      timestamp: Date.now().toString(),
      useHighQualityImage: true,
      forceQualityParameter: false
    };
  }

  function buildPtbinbImageUrl(meta, session, page, imageClass) {
    const base = meta?.sbcurl || session.pageUrl;
    const singleQuality = imageClass === "singlequality";
    const timestamp = session.timestamp || Date.now().toString();
    let target;
    if (meta.servertype === PTBINB_SERVER_TYPES.direct) {
      const suffix = singleQuality ? "M.jpg" : session.useHighQualityImage ? "M_H.jpg" : "M_L.jpg";
      const imagePath = `${page.src.replace(/\/?$/, "/")}${suffix}`;
      target = new URL(imagePath, base);
      target.searchParams.set("dmytime", timestamp);
    } else if (meta.servertype === PTBINB_SERVER_TYPES.rest) {
      target = new URL(`img/${page.src}`, base);
      if (!singleQuality && !session.useHighQualityImage) {
        target.searchParams.set("q", "1");
      }
      if (timestamp) target.searchParams.set("dmytime", timestamp);
      const extras = Object.entries(session.extraQuery || {});
      for (const [key, value] of extras) {
        if (value == null || value === "") continue;
        target.searchParams.set(key, value);
      }
      if (IS_IOS) {
        target.searchParams.set("pmax", "2000000");
      }
      if (typeof target.searchParams.sort === "function") {
        target.searchParams.sort();
      }
    } else {
      target = new URL("sbcGetImg.php", base);
      target.searchParams.set("cid", session.cid);
      target.searchParams.set("src", encodeURIComponent(page.src));
      if (meta.token) target.searchParams.set("p", meta.token);
      if (!singleQuality || session.forceQualityParameter) {
        target.searchParams.set("q", session.useHighQualityImage ? "0" : "1");
      }
      target.searchParams.set("vm", String(meta.viewmode ?? 0));
      target.searchParams.set("dmytime", timestamp);
      const extras = Object.entries(session.extraQuery || {});
      for (const [key, value] of extras) {
        if (value == null || value === "") continue;
        target.searchParams.set(key, value);
      }
    }
    return target.href;
  }

  async function hydratePtbinbContext(ptbinb, force = false, tapState = null) {
    if (!ptbinb) return null;
    if (!force && ptbinb.meta && Array.isArray(ptbinb.pages) && ptbinb.pages.length) {
      return ptbinb;
    }
    let metadata = null;
    if (ptbinb.meta) {
      metadata = { meta: ptbinb.meta, infoItem: ptbinb.infoItem || null };
    } else {
      metadata = await fetchPtbinbMetadata(ptbinb);
      ptbinb.meta = metadata.meta;
      ptbinb.infoItem = metadata.infoItem;
    }
    const content = await fetchPtbinbContent(ptbinb, metadata.meta, tapState || ptbinb.tapState || null);
    const pages = parsePtbinbPages(content.ttx);
    ptbinb.imageClass = content.imageClass;
    ptbinb.pages = pages;
    ptbinb.pageCount = pages.length;
    ptbinb.hydrated = true;
    ptbinb.lastHydratedAt = Date.now();
    return ptbinb;
  }

  async function assemblePtbinbPage(page, ptbinb, session, options = {}) {
    const meta = ptbinb.meta;
    if (!meta) {
      throw new Error("Missing ptbinb metadata.");
    }
    const headers = {};
    if (ptbinb.referer) {
      headers.Referer = ptbinb.referer;
    }
    const imageUrl = buildPtbinbImageUrl(meta, session, page, ptbinb.imageClass);
    const requestInit = withNoStore({ headers, credentials: "include" });
    const { response, url } = await fetchWithCandidates(imageUrl, session.pageUrl, requestInit);
    const blob = await response.blob();
    const bitmap = await loadBitmapFromBlob(blob);
    const dims = getBitmapDimensions(bitmap, page.orgWidth, page.orgHeight);
    const descramble = buildPtbinbDescramble(meta, page, dims.width, dims.height);
    const targetWidth = descramble?.width || dims.width;
    const targetHeight = descramble?.height || dims.height;
    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    ctx.imageSmoothingEnabled = false;
    if (!descramble || !Array.isArray(descramble.transfers) || !descramble.transfers.length) {
      ctx.drawImage(bitmap, 0, 0, dims.width, dims.height, 0, 0, targetWidth, targetHeight);
    } else {
      for (const transfer of descramble.transfers) {
        ctx.drawImage(
          bitmap,
          transfer.xsrc,
          transfer.ysrc,
          transfer.width,
          transfer.height,
          transfer.xdest,
          transfer.ydest,
          transfer.width,
          transfer.height
        );
      }
    }
    if (bitmap && typeof bitmap.close === "function") {
      try {
        bitmap.close();
      } catch {}
    }
    const outputBlob = await canvasToBlob(canvas, options.outputType || "image/png");
    const buffer = await outputBlob.arrayBuffer();
    return {
      buffer,
      mimeType: outputBlob.type || "image/png",
      width: targetWidth,
      height: targetHeight,
      size: buffer.byteLength,
      sourceUrl: url
    };
  }

  function resolveAbsoluteUrl(value, baseUrl) {
    try {
      const base = baseUrl ? new URL(baseUrl, location.href) : new URL(location.href);
      return new URL(value, base).href;
    } catch {
      try {
        return new URL(value).href;
      } catch {
        return String(value ?? "");
      }
    }
  }

  function toUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  const PTBINB_CID_REGEX = /([0-9A-Z]{12,})/i;

  function normalizePtbinbCid(value) {
    if (!value && value !== 0) return "";
    const match = String(value).toUpperCase().match(PTBINB_CID_REGEX);
    return match ? match[1] : "";
  }

  function getTapInfoPayload(tapState) {
    if (!tapState) return null;
    if (tapState.contentInfo) {
      return tapState.contentInfo;
    }
    if (Array.isArray(tapState.infoResponses)) {
      for (const entry of tapState.infoResponses) {
        if (entry?.body) {
          return entry.body;
        }
      }
    }
    return null;
  }

  function getTapContentPayload(tapState, cid) {
    if (!tapState) return null;
    const list = Array.isArray(tapState.contentResponses) ? tapState.contentResponses : [];
    for (const entry of list) {
      let payload = entry?.body;
      if (!payload) continue;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          continue;
        }
      }
      const contentId = payload?.items?.[0]?.ContentID;
      if (!cid || !contentId || normalizePtbinbCid(contentId) === normalizePtbinbCid(cid)) {
        return payload;
      }
    }
    return null;
  }

  function storeTapContentResponse(tapState, url, payload) {
    if (!tapState) return;
    try {
      const entry = {
        url,
        receivedAt: Date.now(),
        body: payload
      };
      if (!Array.isArray(tapState.contentResponses)) {
        tapState.contentResponses = [];
      }
      tapState.contentResponses.unshift(entry);
      if (tapState.contentResponses.length > 4) {
        tapState.contentResponses.length = 4;
      }
    } catch {}
  }

  function buildPtbinbFromTapState(tapState, pageUrl) {
    const infoPayload = getTapInfoPayload(tapState);
    if (!infoPayload) {
      return null;
    }
    const node = tapState.ptbinbNode || null;
    const rawInfoPath = node?.ptbinb || tapState.infoResponses?.[0]?.url || "";
    const infoHref = resolveAbsoluteUrl(rawInfoPath, pageUrl);
    let cid = node?.cid || infoPayload?.items?.[0]?.ContentID || "";
    cid = normalizePtbinbCid(cid);
    if (!cid || !infoHref) {
      return null;
    }
    let infoUrl;
    try {
      infoUrl = new URL(infoHref, pageUrl);
    } catch {
      return null;
    }
    const initialKey = infoUrl.searchParams.get("k") || "";
    if (!initialKey) {
      return null;
    }
    const extraQuery = {};
    try {
      for (const [key, value] of infoUrl.searchParams.entries()) {
        if (PTBINB_QUERY_PARAM_RE.test(key) && value) {
          extraQuery[key] = value;
        }
      }
    } catch {}
    if (tapState.cvTokens) {
      for (const [key, value] of Object.entries(tapState.cvTokens)) {
        if (key && value && !extraQuery[key]) {
          extraQuery[key] = value;
        }
      }
    }
    let meta = null;
    try {
      meta = parsePtbinbMetadata(infoPayload, cid, initialKey, pageUrl);
    } catch (err) {
      console.warn("Speedbinb tap metadata parse failed:", err);
      return null;
    }
    const infoItem = Array.isArray(infoPayload.items) ? infoPayload.items[0] : null;
    const context = {
      cid,
      infoPath: rawInfoPath,
      infoHref,
      pageUrl,
      referer: pageUrl,
      extraQuery,
      initialKey,
      meta,
      infoItem,
      tapHydrated: true,
      tapState
    };
    if (isDebugEnabled()) {
      try {
        console.debug("[Unshackle][speedbinb] tap metadata applied", { cid, infoHref });
      } catch {}
    }
    return context;
  }

  function createProbeFromTapState(tapState, pageUrl) {
    const ptbinb = buildPtbinbFromTapState(tapState, pageUrl);
    if (!ptbinb) {
      return null;
    }
    const infoItem = ptbinb.infoItem || null;
    return {
      pageUrl,
      title: infoItem?.Title || "",
      jsonPaths: [],
      ptbinb,
      tapState,
      cv: {
        hasConfig: !!tapState.config,
        hasTokens: !!(tapState.cvTokens && Object.values(tapState.cvTokens).some(Boolean)),
        cv01: tapState.config?.cv01 || "",
        cv02: tapState.config?.cv02 || ""
      }
    };
  }

  function extractCidFromMetaContent(content) {
    if (!content) return "";
    const normalized = normalizePtbinbCid(content);
    if (normalized) return normalized;
    const thumbMatch = content.match(/thumbnail\/episode\/([0-9A-Z]{12,})\.(?:jpg|png|webp)/i);
    if (thumbMatch) return normalizePtbinbCid(thumbMatch[1]);
    return "";
  }

  function extractCidFromDocumentLike(doc) {
    if (!doc) return "";
    try {
      const field = doc.getElementById("binb_cid");
      if (field) {
        const value = field.value ?? field.getAttribute("value");
        const cid = normalizePtbinbCid(value);
        if (cid) return cid;
      }
    } catch {}
    try {
      const node = doc.querySelector("[data-ptbinb-cid]");
      if (node) {
        const attr = node.getAttribute("data-ptbinb-cid") || node.getAttribute("ptbinb-cid") || node.dataset?.ptbinbCid;
        const cid = normalizePtbinbCid(attr);
        if (cid) return cid;
      }
    } catch {}
    try {
      const selectors = [
        'meta[property="og:image"]',
        'meta[name="og:image"]',
        'meta[property="og:url"]',
        'meta[name="og:url"]',
        'meta[property="twitter:image"]',
        'meta[name="twitter:image"]'
      ];
      for (const selector of selectors) {
        const meta = doc.querySelector(selector);
        if (!meta) continue;
        const cid = extractCidFromMetaContent(meta.getAttribute("content"));
        if (cid) return cid;
      }
    } catch {}
    try {
      const jsonScripts = doc.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]');
      for (const script of jsonScripts) {
        const text = script?.textContent || "";
        const cid = normalizePtbinbCid((text.match(/"ContentID"\s*:\s*"([^"]+)"/i) || [])[1]);
        if (cid) return cid;
      }
    } catch {}
    try {
      const inlineScripts = doc.querySelectorAll("script:not([src])");
      let inspected = 0;
      for (const script of inlineScripts) {
        if (inspected > 8) break;
        inspected++;
        const text = script?.textContent || "";
        const cid = normalizePtbinbCid((text.match(/ContentID\s*[:=]\s*["']?([0-9A-Z]{12,})["']?/i) || [])[1]);
        if (cid) return cid;
      }
    } catch {}
    return "";
  }

  function extractCidFromWindowGlobals() {
    const win = root || (typeof window !== "undefined" ? window : null);
    if (!win) return "";
    const candidates = [
      win.__binb_cid__,
      win.cid,
      win.CID,
      win.viewerCid,
      win.__contentID__,
      win.__sreaderFunc__?.contentInfo?.items?.[0]?.ContentID,
      win.__sreaderFunc__?.bibGetCntntInfoResult?.items?.[0]?.ContentID
    ];
    for (const candidate of candidates) {
      const cid = normalizePtbinbCid(candidate);
      if (cid) return cid;
    }
    return "";
  }

  function extractCidFromUrlLike(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, typeof location !== "undefined" ? location.href : undefined);
      const byQuery = parsed.searchParams.get("cid");
      if (byQuery) {
        const cid = normalizePtbinbCid(byQuery);
        if (cid) return cid;
      }
      const pathMatch = parsed.pathname.match(/([0-9A-Z]{12,})/i);
      if (pathMatch) {
        const cid = normalizePtbinbCid(pathMatch[1]);
        if (cid) return cid;
      }
    } catch {}
    return normalizePtbinbCid((String(url).match(/([0-9A-Z]{12,})/i) || [])[1]);
  }

  function extractCidFromHtmlText(html) {
    if (!html) return "";
    const attrMatch = html.match(/data-ptbinb-cid\s*=\s*["']([^"']+)["']/i);
    if (attrMatch) {
      const cid = normalizePtbinbCid(attrMatch[1]);
      if (cid) return cid;
    }
    const jsonMatch = html.match(/"ContentID"\s*:\s*"([0-9A-Z]+)"/i);
    if (jsonMatch) {
      const cid = normalizePtbinbCid(jsonMatch[1]);
      if (cid) return cid;
    }
    const thumbMatch = html.match(/thumbnail\/episode\/([0-9A-Z]{12,})\.(?:jpg|png|webp)/i);
    if (thumbMatch) {
      const cid = normalizePtbinbCid(thumbMatch[1]);
      if (cid) return cid;
    }
    return "";
  }

  function parsePtbinbNode(element, pageUrl, context = {}) {
    if (!element) return null;
    const attr = (name) => {
      if (!element) return "";
      if (typeof element.getAttribute === "function") {
        return element.getAttribute(name) || element.getAttribute(name.toLowerCase()) || "";
      }
      return "";
    };
    const dataset = element.dataset || {};
    const infoPath = (attr("data-ptbinb") || attr("ptbinb") || dataset.ptbinb || "").trim();
    let cid = (attr("data-ptbinb-cid") || attr("ptbinb-cid") || dataset.ptbinbCid || dataset.cid || "").trim();
    if (!cid && context?.doc) {
      cid = extractCidFromDocumentLike(context.doc);
    }
    if (!cid) {
      const ownerDoc = element.ownerDocument;
      cid = extractCidFromDocumentLike(ownerDoc);
    }
    if (!cid) {
      cid = extractCidFromWindowGlobals();
    }
    if (!cid && context?.html) {
      cid = extractCidFromHtmlText(context.html);
    }
    if (!cid) {
      cid = extractCidFromUrlLike(pageUrl);
    }
    cid = normalizePtbinbCid(cid);
    if (!infoPath || !cid) return null;
    const normalizedPage = normalizeEpisodeUrl(pageUrl);
    const infoHref = resolveAbsoluteUrl(infoPath, normalizedPage);
    const infoUrl = toUrl(infoHref);
    let initialKey = "";
    const extraQuery = {};
    if (infoUrl) {
      initialKey = infoUrl.searchParams.get("k") || "";
      for (const [key, value] of infoUrl.searchParams.entries()) {
        if (PTBINB_QUERY_PARAM_RE.test(key)) {
          extraQuery[key] = value;
        }
      }
    }
    // Merge SpeedBinb query params present on the viewer page URL (e.g., u0/u1)
    try {
      const pageLoc = toUrl(normalizedPage || pageUrl);
      if (pageLoc && typeof pageLoc.searchParams?.entries === "function") {
        for (const [key, value] of pageLoc.searchParams.entries()) {
          if (PTBINB_QUERY_PARAM_RE.test(key) && value != null && value !== "") {
            if (!(key in extraQuery)) extraQuery[key] = value;
          }
        }
      }
    } catch {}
    const configExtras = collectPtbinbConfigParams();
    if (configExtras) {
      Object.assign(extraQuery, configExtras);
    }
    if (isDebugEnabled()) {
      try {
        console.debug("[Unshackle][ptbinb] extraQuery keys", { keys: Object.keys(extraQuery), hasU0: !!extraQuery.u0, hasU1: !!extraQuery.u1 });
      } catch {}
    }
    const referer = normalizedPage;
    return {
      cid,
      infoPath,
      infoHref,
      pageUrl: normalizedPage,
      extraQuery,
      title: typeof document !== "undefined" ? document.title || "" : "",
      referer,
      initialKey: initialKey || null
    };
  }

  function readFirstNamedValue(name) {
    if (!name || typeof document === "undefined") return "";
    try {
      const nodes = document.getElementsByName(name);
      if (!nodes || !nodes.length) return "";
      const node = nodes[0];
      const direct = node?.value ?? node?.getAttribute?.("value") ?? "";
      return typeof direct === "string" ? direct.trim() : "";
    } catch {
      return "";
    }
  }

  function isLocalStorageAvailable() {
    if (typeof window === "undefined") return false;
    try {
      const storage = window.localStorage;
      if (!storage) return false;
      const testKey = "__ptbinb_test__";
      storage.setItem(testKey, "1");
      storage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  function readSrhiddenCookie() {
    if (typeof document === "undefined" || typeof document.cookie !== "string") return { first: "", second: "" };
    const entries = document.cookie.split(/;\s*/);
    for (const entry of entries) {
      if (!entry) continue;
      const [rawName, ...rawValueParts] = entry.split("=");
      if (!rawName) continue;
      if (rawName.trim() !== "srhidden") continue;
      const rawValue = rawValueParts.join("=");
      if (!rawValue) continue;
      try {
        const decoded = decodeURIComponent(rawValue);
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          return {
            first: typeof parsed[0] === "string" ? parsed[0] : "",
            second: typeof parsed[1] === "string" ? parsed[1] : ""
          };
        }
      } catch {
        return { first: "", second: "" };
      }
    }
    return { first: "", second: "" };
  }

  function persistCvTokens(config, first, second, storageAccessible) {
    if (!config?.cv01 || !config?.cv02) return;
    if (storageAccessible && typeof window !== "undefined" && window.localStorage) {
      try {
        if (first) window.localStorage.setItem(config.cv01, first);
        if (second) window.localStorage.setItem(config.cv02, second);
      } catch {}
      return;
    }
    try {
      const payload = JSON.stringify([first || "", second || ""]);
      document.cookie = `srhidden=${encodeURIComponent(payload)}; path=/;`;
    } catch {}
  }

  function extractCvTokens(config) {
    if (!config?.cv01 || !config?.cv02) return null;
    let first = "";
    let second = "";
    const storageAccessible = isLocalStorageAvailable();
    if (storageAccessible) {
      try {
        first = window.localStorage.getItem(config.cv01) || "";
        second = window.localStorage.getItem(config.cv02) || "";
      } catch {}
    }
    if (!first || !second) {
      const cookieTokens = readSrhiddenCookie();
      if (!first && cookieTokens.first) first = cookieTokens.first;
      if (!second && cookieTokens.second) second = cookieTokens.second;
    }
    if (!first || !second) {
      const fieldFirst = readFirstNamedValue(config.cv01);
      const fieldSecond = readFirstNamedValue(config.cv02);
      if (!first && fieldFirst) first = fieldFirst;
      if (!second && fieldSecond) second = fieldSecond;
    }
    if (!first && !second) return null;
    persistCvTokens(config, first, second, storageAccessible);
    return { first, second };
  }

  function getPtbinbGlobal() {
    if (typeof root !== "undefined") return root;
    if (typeof window !== "undefined") return window;
    return null;
  }

  function collectFromSpeedbinbInstance() {
    try {
      const global = getPtbinbGlobal();
      const SpeedBinb = global?.SpeedBinb;
      if (!SpeedBinb || typeof SpeedBinb.getInstance !== "function") return null;
      const instance = SpeedBinb.getInstance("content");
      if (!instance || typeof instance !== "object") return null;
      const query = instance.K || instance.kq || instance.extQuery;
      if (!query || typeof query !== "object") return null;
      const params = {};
      for (const [key, value] of Object.entries(query)) {
        if (!PTBINB_QUERY_PARAM_RE.test(key)) continue;
        if (value == null || value === "") continue;
        params[key] = value;
      }
      return Object.keys(params).length ? params : null;
    } catch {
      return null;
    }
  }

  function collectPtbinbConfigParams() {
    if (typeof document === "undefined") return null;
    const instanceParams = collectFromSpeedbinbInstance();
    if (instanceParams) {
      return instanceParams;
    }
    const global = getPtbinbGlobal();
    const config = global?.Config;
    if (!config) return null;
    const tokens = extractCvTokens(config);
    if (!tokens) return null;
    const params = {};
    if (tokens.first && config.cv01) {
      params[config.cv01] = tokens.first;
    }
    if (tokens.second && config.cv02) {
      params[config.cv02] = tokens.second;
    }
    if (Object.keys(params).length && config.cv04 && config.cv03 && params[config.cv02]) {
      try {
        document.cookie = `${config.cv04}=${encodeURIComponent(`v=1&c=${params[config.cv02]}`)}; domain=${config.cv03}; path=/; expires=Tue, 19 Jan 2038 00:00:00 GMT`;
      } catch {}
    }
    return Object.keys(params).length ? params : null;
  }

  function collectPtbinbRequestParamsFromPerformance(cid) {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
      return null;
    }
    const entries = performance.getEntriesByType("resource") || [];
    for (const entry of entries) {
      const name = entry?.name || "";
      if (!name || !/bibgetcntntinfo/i.test(name)) continue;
      let url;
      try {
        url = new URL(name, typeof location !== "undefined" ? location.href : undefined);
      } catch {
        continue;
      }
      const entryCid = url.searchParams.get("cid") || "";
      if (cid && entryCid && entryCid !== cid) continue;
      const params = {};
      for (const [key, value] of url.searchParams.entries()) {
        if (key.toLowerCase() === "k") continue;
        if (key.toLowerCase() === "dmytime") continue;
        if (PTBINB_QUERY_PARAM_RE.test(key)) {
          params[key] = value;
        }
      }
      const key = url.searchParams.get("k") || "";
      return { key, params };
    }
    return null;
  }

  function getLivePtbinbContext(pageUrl) {
    if (typeof document === "undefined") return null;
    const selectorCandidates = ["#content[data-ptbinb]", "[data-ptbinb][data-ptbinb-cid]"];
    for (const selector of selectorCandidates) {
      const node = document.querySelector(selector);
      const parsed = parsePtbinbNode(node, pageUrl, { doc: document });
      if (parsed) {
        const perfParams = collectPtbinbRequestParamsFromPerformance(parsed.cid);
        if (perfParams) {
          if (perfParams.key) {
            parsed.initialKey = perfParams.key;
          }
          if (perfParams.params && Object.keys(perfParams.params).length) {
            parsed.extraQuery = { ...(parsed.extraQuery || {}), ...perfParams.params };
          }
        }
        return parsed;
      }
    }
    return null;
  }

  function extractPtbinbFromHtml(html, pageUrl) {
    if (!html) return null;
    if (typeof DOMParser === "function") {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const node = doc.querySelector("#content[data-ptbinb]") || doc.querySelector("[data-ptbinb][data-ptbinb-cid]");
        const parsed = parsePtbinbNode(node, pageUrl, { doc });
        if (parsed) return parsed;
      } catch {}
    }
    // Yanmaga viewer markup (see fix1.md) keeps the ptbinb attributes on the #content div.
    const contentTag = html.match(/<div[^>]+id=(["'])content\1[^>]*>/i) || html.match(/<[^>]+data-ptbinb[^>]*>/i);
    if (contentTag) {
      const tag = contentTag[0];
      const pull = (attr) => {
        const attrMatch = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
        return attrMatch ? attrMatch[1] : "";
      };
      const infoPath = pull("data-ptbinb") || pull("ptbinb");
      let cid = pull("data-ptbinb-cid") || pull("ptbinb-cid");
      if (!cid) {
        cid = extractCidFromHtmlText(html);
      }
      if (infoPath && cid) {
        const parsed = parsePtbinbNode(
          {
            getAttribute: (name) => {
              const map = {
                "data-ptbinb": infoPath,
                "ptbinb": infoPath,
                "data-ptbinb-cid": cid,
                "ptbinb-cid": cid
              };
              return map[name] ?? map[name.toLowerCase()] ?? null;
            },
            dataset: {},
            ownerDocument: null
          },
          pageUrl,
          { html }
        );
        if (parsed) {
          const ptimgMatches = html.match(/data-ptimg\s*=\s*["']binb:\/\//gi);
          if (ptimgMatches && ptimgMatches.length) {
            parsed.pageCount = ptimgMatches.length;
          }
          return parsed;
        }
      }
    }
    return null;
  }

  function detectCvPresence() {
    const result = { hasConfig: false, hasTokens: false, cv01: "", cv02: "" };
    try {
      const global = getPtbinbGlobal();
      const cfg = global?.Config;
      if (cfg) {
        const cv01 = typeof cfg.cv01 === "string" && cfg.cv01.trim() ? cfg.cv01.trim() : "";
        const cv02 = typeof cfg.cv02 === "string" && cfg.cv02.trim() ? cfg.cv02.trim() : "";
        result.cv01 = cv01;
        result.cv02 = cv02;
        result.hasConfig = !!(cv01 && cv02);
        if (result.hasConfig) {
          const tokens = extractCvTokens(cfg);
          result.hasTokens = !!(tokens && (tokens.first || tokens.second));
        }
      }
      if (!result.hasTokens) {
        const instanceTokens = collectFromSpeedbinbInstance();
        if (instanceTokens) {
          const cvKeys = Object.keys(instanceTokens).filter((key) => /^cv\d+/i.test(key));
          if (cvKeys.length) {
            result.hasConfig = true;
            result.hasTokens = true;
            if (!result.cv01) result.cv01 = cvKeys[0];
            if (!result.cv02 && cvKeys[1]) result.cv02 = cvKeys[1];
          }
        }
      }
    } catch {}
    return result;
  }

  function countPtbinbNodesFromDom() {
    if (typeof document === "undefined") return 0;
    try {
      const scoped = document.querySelectorAll("#content [data-ptimg]").length;
      if (scoped > 0) return scoped;
      return document.querySelectorAll("[data-ptimg]").length;
    } catch {
      return 0;
    }
  }

  function countPtbinbNodesFromHtml(html) {
    if (!html || typeof html !== "string") return 0;
    const matches = html.match(/data-ptimg\s*=\s*["']binb:\/\/[^"']+["']/gi);
    return matches ? matches.length : 0;
  }

  function collectJsonPathsFromDom() {
    const html = getDocumentHtml();
    if (!html) return [];
    return extractJsonPathsFromHtml(html);
  }

  const PROBE_CACHE_TTL_MS = 15000; // Reuse probes per URL for 15 seconds.
  const probeCache = new Map();
  const probePending = new Map();

  function resolveProbeKey(value) {
    const raw = String(value ?? "");
    try {
      if (typeof location !== "undefined" && location?.href) {
        return new URL(raw, location.href).href;
      }
      return new URL(raw).href;
    } catch {
      return raw;
    }
  }

  function getCachedProbe(key) {
    if (!key) return null;
    const entry = probeCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > PROBE_CACHE_TTL_MS) {
      probeCache.delete(key);
      return null;
    }
    return entry.value;
  }

  function setCachedProbe(key, probe) {
    if (!key) return;
    const now = Date.now();
    probeCache.set(key, { value: probe, timestamp: now });
    const cutoff = now - PROBE_CACHE_TTL_MS;
    for (const [cacheKey, entry] of probeCache) {
      if (entry.timestamp < cutoff) {
        probeCache.delete(cacheKey);
      }
    }
  }

  async function fetchWithCandidates(relativePath, baseUrl, init = {}) {
    const tried = [];
    const requestInit = withNoStore(init);
    const candidates = resolveCandidates(relativePath, baseUrl);
    for (const originalCandidate of candidates) {
      const candidate = refreshDynamicTimestamp(originalCandidate, baseUrl);
      let resolvedUrl = candidate;
      try {
        if (isDebugEnabled()) {
          try {
            const u = new URL(candidate, baseUrl);
            console.debug("[Unshackle][fetchWithCandidates] try", {
              url: u.href,
              host: u.host,
              path: u.pathname,
              hasU0: u.searchParams.has("u0"),
              hasU1: u.searchParams.has("u1"),
              u0Len: (u.searchParams.get("u0") || "").length,
              u1Len: (u.searchParams.get("u1") || "").length
            });
          } catch {}
        }
        let response = null;
        if (shouldUsePageBridge(candidate)) {
          try {
            const bridged = await pageBridgeFetch(candidate, requestInit);
            const built = bridged ? buildResponseFromBridge(bridged) : null;
            if (built?.response) {
              response = built.response;
              resolvedUrl = built.url || candidate;
              if (isDebugEnabled()) {
                try {
                  console.debug("[Unshackle][fetchWithCandidates] bridged OK", { url: resolvedUrl, status: response.status });
                } catch {}
              }
            }
          } catch {
            // Bridge unavailable or failed; fall back to standard fetch below.
          }
        }
        if (!response) {
          response = await fetch(candidate, requestInit);
          if (isDebugEnabled()) {
            try {
              console.debug("[Unshackle][fetchWithCandidates] fetch status", { url: candidate, status: response?.status });
            } catch {}
          }
        }
        if (response && response.ok) {
          if (isDebugEnabled()) {
            try {
              console.debug("[Unshackle][fetchWithCandidates] success", { url: resolvedUrl });
            } catch {}
          }
          return { url: resolvedUrl, response };
        }
        tried.push({ url: resolvedUrl, status: response?.status ?? 0 });
      } catch (err) {
        tried.push({ url: resolvedUrl, error: String(err?.message || err) });
      }
    }
    const error = tried.length
      ? `All fetch attempts failed for ${relativePath}: ${tried.map((t) => `${t.url} (${t.status || t.error || "X"})`).join(", ")}`
      : `No URL candidates available for ${relativePath}`;
    throw new Error(error);
  }

  function extractJsonPathsFromHtml(html) {
    if (!html || typeof html !== "string") return [];
    const results = new Set();
    const attrRe = /data-ptimg\s*=\s*["']([^"']+?\.ptimg\.json(?:\?[^"']*)?)["']/gi;
    let match;
    while ((match = attrRe.exec(html))) {
      const value = match[1]?.trim();
      if (value) results.add(value);
    }
    const genericRe = /(?:["'(=]|%3D)([^"'()<>\\s]+\.ptimg\.json(?:\?[^"'()<>\\s]*)?)/gi;
    while ((match = genericRe.exec(html))) {
      const value = match[1]?.trim();
      if (value) results.add(value);
    }
    return Array.from(results);
  }

  function sortJsonPaths(paths) {
    const toIndex = (value) => {
      const match = /(\d+)(?=\.ptimg\.json)/i.exec(value || "");
      return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
    };
    return paths.slice().sort((a, b) => {
      const aIdx = toIndex(a);
      const bIdx = toIndex(b);
      if (Number.isFinite(aIdx) && Number.isFinite(bIdx)) {
        if (aIdx === bIdx) return a.localeCompare(b);
        return aIdx - bIdx;
      }
      if (Number.isFinite(aIdx)) return -1;
      if (Number.isFinite(bIdx)) return 1;
      return a.localeCompare(b);
    });
  }

  function extractTitleFromHtml(html) {
    if (!html || typeof html !== "string") return "";
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) return "";
    return match[1].replace(/\s+/g, " ").trim();
  }

  function getDocumentHtml() {
    if (typeof document === "undefined") return "";
    const doc = document.documentElement;
    if (!doc) return "";
    return doc.outerHTML || doc.innerHTML || "";
  }

  function parseHtmlDocument(html) {
    if (!html || typeof DOMParser === "undefined") return null;
    try {
      const parser = new DOMParser();
      return parser.parseFromString(html, "text/html");
    } catch {
      return null;
    }
  }

  function resolveCandidateUrl(value, base) {
    if (!value) return null;
    try {
      return new URL(value, base || (typeof location !== "undefined" ? location.href : undefined)).href;
    } catch {
      return null;
    }
  }

  function isSameDocumentUrl(url) {
    try {
      if (typeof location === "undefined") return false;
      return new URL(url, location.href).href === location.href;
    } catch {
      return false;
    }
  }

  async function loadDocumentForUrl(url) {
    const normalized = normalizeEpisodeUrl(url);
    if (normalized && isSameDocumentUrl(normalized) && typeof document !== "undefined") {
      return { doc: document, html: getDocumentHtml() };
    }
    if (typeof fetch !== "function") {
      return { doc: null, html: "" };
    }
    try {
    const { response } = await fetchWithCandidates(normalized, location.href, withNoStore({}));
    if (!response || !response.ok) {
      return { doc: null, html: "" };
    }
    const text = await response.text();
    return { doc: parseHtmlDocument(text), html: text };
  } catch {
      return { doc: null, html: "" };
    }
  }

  function nodeHasLockedState(node) {
    if (!node) return false;
    const disabledAttr = (node.getAttribute?.("aria-disabled") || node.getAttribute?.("data-disabled") || "").toLowerCase();
    if (disabledAttr === "true" || disabledAttr === "1") return true;
    const premium = (node.getAttribute?.("data-premium") || node.dataset?.premium || "").toLowerCase();
    if (premium === "true") return true;
    const locked = (node.getAttribute?.("data-locked") || node.dataset?.locked || "").toLowerCase();
    if (locked === "true" || locked === "1") return true;
    const className = typeof node.className === "string" ? node.className.toLowerCase() : "";
    return /locked|disabled|premium|soldout/.test(className);
  }

  function isLikelySpeedbinbEpisodeUrl(candidate) {
    if (!candidate) return false;
    try {
      const url = new URL(candidate);
      const path = url.pathname.toLowerCase();
      if (url.searchParams.has("cid") || url.searchParams.has("content_id") || url.searchParams.has("episode_id")) {
        return true;
      }
      if (/\/(viewer|episode|episodes|chapter|chapters)\//.test(path)) {
        return true;
      }
      if (path.endsWith(".ptimg.json") || path.includes("ptimg.json")) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function extractChapterLinksFromDom(doc, baseUrl) {
    if (!doc) return [];
    const selectors = [
      "[data-episode-url]",
      "[data-episode-id]",
      "[data-chapter-url]",
      "[data-chapter-id]",
      "[data-href]",
      "[data-url]",
      "a[data-episode-url]",
      "a[href*=\"cid=\"]",
      "a[href*=\"/episode/\"]",
      "a[href*=\"/viewer/\"]",
      "option[value*=\"cid=\"]",
      "option[data-url]",
      "option[data-href]",
      "button[data-episode-url]"
    ];
    const nodes = new Set();
    for (const selector of selectors) {
      doc.querySelectorAll(selector).forEach((node) => nodes.add(node));
    }
    const seen = new Set();
    const chapters = [];
    let unnamed = 0;
    for (const node of nodes) {
      const href =
        node.getAttribute?.("data-episode-url") ||
        node.dataset?.episodeUrl ||
        node.dataset?.href ||
        node.dataset?.url ||
        node.getAttribute?.("href") ||
        node.getAttribute?.("value") ||
        node.getAttribute?.("data-href");
      const resolved = resolveCandidateUrl(href, baseUrl);
      if (!resolved || !isLikelySpeedbinbEpisodeUrl(resolved)) {
        continue;
      }
      const key = resolved.replace(/#.*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      let title =
        node.getAttribute?.("data-episode-title") ||
        node.getAttribute?.("title") ||
        node.textContent ||
        "";
      title = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
      if (!title) {
        unnamed += 1;
        title = `Episode ${unnamed}`;
      }
      chapters.push({
        id: resolved,
        title,
        viewerId: "speedbinb",
        accessible: !nodeHasLockedState(node)
      });
    }
    return chapters;
  }

  function extractChapterLinksFromHtml(html, baseUrl) {
    if (!html) return [];
    const seen = new Set();
    const chapters = [];
    const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(html))) {
      const resolved = resolveCandidateUrl(match[1], baseUrl);
      if (!resolved || !isLikelySpeedbinbEpisodeUrl(resolved)) {
        continue;
      }
      const key = resolved.replace(/#.*$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      chapters.push({
        id: resolved,
        title: `Episode ${chapters.length + 1}`,
        viewerId: "speedbinb",
        accessible: true
      });
      if (chapters.length >= 200) break;
    }
    return chapters;
  }

  function parseCoordsString(coord) {
    if (!coord || typeof coord !== "string") return null;
    const items = coord.match(/^([^:]+):(\d+),(\d+)\+(\d+),(\d+)>(\d+),(\d+)$/);
    if (!items) return null;
    return {
      srcX: parseInt(items[2], 10),
      srcY: parseInt(items[3], 10),
      width: parseInt(items[4], 10),
      height: parseInt(items[5], 10),
      destX: parseInt(items[6], 10),
      destY: parseInt(items[7], 10)
    };
  }

  function createTelemetry(totalPages, zipDownload = false, site = "speedbinb") {
    return {
      site,
      startedAt: Date.now(),
      totalPages,
      zipDownload: !!zipDownload,
      pages: [],
      failures: [],
      retries: 0
    };
  }

  function createPageLog(index, src) {
    return {
      index,
      src: src || "",
      status: "pending",
      attempts: [],
      error: null,
      durationMs: 0
    };
  }

  function createCanvas(width, height) {
    if (typeof OffscreenCanvas === "function") {
      return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      return canvas;
    }
    throw new Error("Canvas APIs unavailable");
  }

  async function loadBitmapFromBlob(blob) {
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }
    if (typeof document === "undefined") {
      throw new Error("Cannot decode image blob without DOM");
    }
    let objectUrl = null;
    return await new Promise((resolve, reject) => {
      const img = document.createElement("img");
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode image blob"));
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
    }).finally(() => {
      setTimeout(() => {
        try {
          if (objectUrl && typeof URL.revokeObjectURL === "function") {
            URL.revokeObjectURL(objectUrl);
          }
        } catch {}
      }, 0);
    });
  }

  function readBitmapDimension(bitmap, keys, fallback) {
    for (const key of keys) {
      if (!key) continue;
      const raw = bitmap && typeof bitmap === "object" ? bitmap[key] : null;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    const fallbackValue = Number(fallback);
    return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : 0;
  }

  function getBitmapDimensions(bitmap, fallbackWidth, fallbackHeight) {
    const width = readBitmapDimension(bitmap, ["width", "videoWidth", "naturalWidth", "clientWidth"], fallbackWidth);
    const height = readBitmapDimension(bitmap, ["height", "videoHeight", "naturalHeight", "clientHeight"], fallbackHeight);
    return {
      width: Math.max(1, Math.round(width || 1)),
      height: Math.max(1, Math.round(height || 1))
    };
  }

  async function canvasToBlob(canvas, type = "image/png") {
    if (canvas instanceof OffscreenCanvas) {
      return await canvas.convertToBlob({ type });
    }
    if (typeof canvas.toBlob === "function") {
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob produced null"));
        }, type);
      });
    }
    throw new Error("Canvas blob conversion unavailable");
  }

  function clampNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function describeView(config) {
    if (!config) return null;
    const views = Array.isArray(config.views) ? config.views : [];
    if (!views.length) return null;
    return views[0] || null;
  }

  async function assemblePageFromConfig(config, baseUrl, pageLog, options = {}) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid ptimg json payload");
    }
    const view = describeView(config);
    if (!view) throw new Error("Missing views data");
    const coordsList = Array.isArray(view.coords) ? view.coords : [];
    if (!coordsList.length) throw new Error("No coords information in view");
    const width = clampNumber(view.width, 1);
    const height = clampNumber(view.height, 1);
    const imageRef = config?.resources?.i?.src || config?.resources?.i?.url || config?.resources?.i?.path;
    if (!imageRef) throw new Error("Missing base image reference");

    const normalizedImagePath = imageRef.startsWith("data/") ? imageRef : `data/${imageRef}`;
    const { response, url } = await fetchWithCandidates(normalizedImagePath, baseUrl, { credentials: "include" });
    const blob = await response.blob();
    const bitmap = await loadBitmapFromBlob(blob);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    for (const coordEntry of coordsList) {
      const coords = parseCoordsString(coordEntry);
      if (!coords) continue;
      ctx.drawImage(
        bitmap,
        coords.srcX,
        coords.srcY,
        coords.width,
        coords.height,
        coords.destX,
        coords.destY,
        coords.width,
        coords.height
      );
    }

    if (bitmap && typeof bitmap.close === "function") {
      try { bitmap.close(); } catch {}
    }

    const outputBlob = await canvasToBlob(canvas, options.outputType || "image/png");
    const arrayBuffer = await outputBlob.arrayBuffer();
    return {
      buffer: arrayBuffer,
      mimeType: outputBlob.type || "image/png",
      width,
      height,
      size: arrayBuffer.byteLength,
      sourceUrl: url
    };
  }

  function deriveTitles(pageUrl, providedTitle) {
    const urlObj = (() => {
      try { return new URL(pageUrl, location.href); } catch { return null; }
    })();
    const hostName = sanitizeName(urlObj?.hostname?.replace(/^www\./i, "") || "Speedbinb", "Speedbinb");
    const rawTitle = typeof providedTitle === "string" ? providedTitle.trim() : "";
    if (!rawTitle) {
      const lastSegment = urlObj?.pathname ? urlObj.pathname.replace(/\/$/, "").split("/").pop() : "";
      const fallbackEpisode = sanitizeName(lastSegment || "Episode", "Episode");
      return { seriesTitle: hostName, episodeTitle: fallbackEpisode };
    }
    const split = rawTitle.split(/\s*[|｜:-]\s*/).filter(Boolean);
    if (split.length >= 2) {
      return {
        seriesTitle: sanitizeName(split[0], hostName),
        episodeTitle: sanitizeName(split.slice(1).join(" - "), "Episode")
      };
    }
    return {
      seriesTitle: hostName,
      episodeTitle: sanitizeName(rawTitle, "Episode")
    };
  }

  async function getProbe(url = location.href, options = {}) {
    const tapState = options?.tapState || null;
    const u = String(url || location.href || "");
    const keyCandidate = resolveProbeKey(u);
    const cacheKey = keyCandidate || u;
    const cached = getCachedProbe(cacheKey);
    if (cached) return cached;
    const pending = probePending.get(cacheKey);
    if (pending) return pending;

    const loadProbe = (async () => {
      const tapProbe = tapState ? createProbeFromTapState(tapState, u) : null;
      if (tapProbe) {
        setCachedProbe(cacheKey, tapProbe);
        return tapProbe;
      }
      let html = "";
      let title = "";
      try {
        const current = typeof location !== "undefined" ? location.href : "";
        if (current && new URL(u, current).href === current) {
          const { response } = await fetchWithCandidates(u, current, withNoStore({}));
          if (response && response.ok) {
            html = await response.text();
          }
        }
      } catch {}
      if (!html) {
        html = getDocumentHtml();
        if (!title && typeof document !== "undefined") {
          title = document.title || "";
        }
      }
      if (!html) {
        const { response } = await fetchWithCandidates(u, location.href, withNoStore({}));
        if (response) {
          html = await response.text();
        }
      }
      if (!title) {
        title = extractTitleFromHtml(html);
      }
      let jsonPaths = extractJsonPathsFromHtml(html);
      const cv = detectCvPresence();
      const domPtbinbCount = countPtbinbNodesFromDom();
      const htmlPtbinbCount = countPtbinbNodesFromHtml(html);
      let ptbinb = getLivePtbinbContext(u);
      if (!ptbinb) {
        ptbinb = extractPtbinbFromHtml(html, u);
      }
      if (ptbinb) {
        const estimatedCount = ptbinb.pageCount || domPtbinbCount || htmlPtbinbCount;
        if (estimatedCount) {
          ptbinb.pageCount = estimatedCount;
        }
        ptbinb.hydrated = Array.isArray(ptbinb.pages) && ptbinb.pages.length > 0;
        if (tapState && !ptbinb.tapState) {
          ptbinb.tapState = tapState;
        }
      }
      jsonPaths = sortJsonPaths(jsonPaths);
      const probe = {
        pageUrl: u,
        title,
        jsonPaths,
        ptbinb: ptbinb || null,
        cv
      };
      setCachedProbe(cacheKey, probe);
      return probe;
    })();

    const tracked = loadProbe.finally(() => {
      probePending.delete(cacheKey);
    });
    probePending.set(cacheKey, tracked);
    return tracked;
  }

  async function detect(url = location.href) {
    try {
      const probe = await getProbe(url);
      if (probe?.ptbinb) {
        return true;
      }
      return Array.isArray(probe?.jsonPaths) && probe.jsonPaths.length > 0;
    } catch {
      return false;
    }
  }

  async function probe(url = location.href, options = {}) {
    return await getProbe(url, options);
  }

  async function probeWithTap(url = location.href, options = {}) {
    if (!options?.tapState) {
      return null;
    }
    return createProbeFromTapState(options.tapState, url || location.href);
  }

  async function downloadPtimgJsonEpisode(jsonPaths, pageUrl, probeTitle, options = {}) {
    const { zipDownload = false, onlyFirst = false } = options || {};
    const sortedPaths = sortJsonPaths(Array.isArray(jsonPaths) ? jsonPaths : []);
    if (!sortedPaths.length) {
      throw new Error("No ptimg json files found on this page.");
    }
    const totalPages = sortedPaths.length;
    const telemetry = createTelemetry(totalPages, zipDownload);
    const { seriesTitle, episodeTitle } = deriveTitles(pageUrl, probeTitle);

    const targetPaths = onlyFirst ? sortedPaths.slice(0, 1) : sortedPaths;
    const pages = [];
    const widthDigits = String(targetPaths.length).length;

    for (let i = 0; i < targetPaths.length; i++) {
      const rel = targetPaths[i];
      const pageLog = createPageLog(i, rel);
      telemetry.pages.push(pageLog);
      const start = performance.now ? performance.now() : Date.now();
      try {
        pageLog.status = "loading";
        const { response } = await fetchWithCandidates(rel, pageUrl, { credentials: "include" });
        const config = await response.json();
        pageLog.status = "assembling";
        const assembled = await assemblePageFromConfig(config, pageUrl, pageLog, options);
        pageLog.status = "success";
        pageLog.durationMs = (performance.now ? performance.now() : Date.now()) - start;
        const filename = `${seriesTitle}/${episodeTitle}/${String(i + 1).padStart(widthDigits, "0")}.png`;
        pages.push({
          kind: "page",
          index: i,
          filename,
          mimeType: assembled.mimeType,
          size: assembled.size,
          buffer: assembled.buffer,
          width: assembled.width,
          height: assembled.height,
          sourceUrl: assembled.sourceUrl
        });
      } catch (err) {
        pageLog.status = "error";
        pageLog.error = String(err?.message || err);
        pageLog.durationMs = (performance.now ? performance.now() : Date.now()) - start;
        telemetry.failures.push({ index: i, src: rel, error: pageLog.error });
        throw err;
      }
    }

    telemetry.completedAt = Date.now();
    telemetry.durationMs = telemetry.completedAt - telemetry.startedAt;
    telemetry.pagesDownloaded = pages.length;

    return {
      status: "success",
      seriesTitle,
      title: episodeTitle,
      count: pages.length,
      total: totalPages,
      metadataSaved: false,
      onlyFirst: !!onlyFirst,
      zipDownload: !!zipDownload,
      telemetry,
      pages,
      defaultZipName: `${seriesTitle}-${episodeTitle}.zip`,
      nextUri: null,
      nextUrl: null
    };
  }

  async function downloadPtbinbEpisode(probeResult, pageUrl, options = {}) {
    const { zipDownload = false, onlyFirst = false, tapState = null } = options || {};
    const ptbinb = probeResult.ptbinb;
    if (!ptbinb || !ptbinb.cid || !ptbinb.infoHref) {
      throw new Error("Missing ptbinb viewer metadata.");
    }
    const effectiveTapState = tapState || ptbinb.tapState || probeResult.tapState || null;
    if (effectiveTapState && !ptbinb.tapState) {
      ptbinb.tapState = effectiveTapState;
    }

    try {
      const liveCtx = getLivePtbinbContext(pageUrl);
      if (liveCtx) {
        ptbinb.extraQuery = { ...(ptbinb.extraQuery || {}), ...(liveCtx.extraQuery || {}) };
        if (liveCtx.referer) ptbinb.referer = liveCtx.referer;
        if (liveCtx.infoHref) ptbinb.infoHref = liveCtx.infoHref;
        if (liveCtx.cid) ptbinb.cid = liveCtx.cid;
        if (liveCtx.initialKey) ptbinb.initialKey = liveCtx.initialKey;
      }
    } catch {}
    const liveExtras = collectPtbinbConfigParams();
    if (liveExtras) {
      ptbinb.extraQuery = { ...(ptbinb.extraQuery || {}), ...liveExtras };
    }

    try {
      await hydratePtbinbContext(ptbinb, false, effectiveTapState);
      if (!Array.isArray(ptbinb.pages) || !ptbinb.pages.length) {
        throw new Error("No ptbinb pages were discovered.");
      }
    } catch (err) {
      console.warn("Speedbinb ptbinb hydrate failed, attempting JSON fallback:", err);
      let fallbackPaths = Array.isArray(probeResult?.jsonPaths) ? probeResult.jsonPaths : [];
      if (!fallbackPaths.length) {
        fallbackPaths = collectJsonPathsFromDom();
      }
      fallbackPaths = sortJsonPaths(fallbackPaths);
      if (fallbackPaths.length) {
        return await downloadPtimgJsonEpisode(fallbackPaths, pageUrl, probeResult?.title, { zipDownload, onlyFirst });
      }
      throw err;
    }

    const session = createPtbinbDownloadSession(ptbinb);
    const totalPages = ptbinb.pages.length;
    const telemetry = createTelemetry(totalPages, zipDownload, "ptbinb");
    const derivedTitles = deriveTitles(pageUrl, ptbinb.infoItem?.Title || probeResult.title || ptbinb.title);
    const seriesTitle = sanitizeName(ptbinb.infoItem?.ParentTitle || derivedTitles.seriesTitle, derivedTitles.seriesTitle || "Series");
    const episodeTitle = sanitizeName(ptbinb.infoItem?.Title || derivedTitles.episodeTitle, derivedTitles.episodeTitle || "Episode");
    const targetPages = onlyFirst ? ptbinb.pages.slice(0, 1) : ptbinb.pages;
    const pages = [];
    const widthDigits = String(targetPages.length).length;

    for (let index = 0; index < targetPages.length; index++) {
      const pageEntry = targetPages[index];
      const pageLog = createPageLog(index, pageEntry.src);
      telemetry.pages.push(pageLog);
      const start = performance.now ? performance.now() : Date.now();
      try {
        pageLog.status = "loading";
        const assembled = await assemblePtbinbPage(pageEntry, ptbinb, session, options);
        pageLog.status = "success";
        pageLog.durationMs = (performance.now ? performance.now() : Date.now()) - start;
        const filename = `${seriesTitle}/${episodeTitle}/${String(index + 1).padStart(widthDigits, "0")}.png`;
        pages.push({
          kind: "page",
          index,
          filename,
          mimeType: assembled.mimeType,
          size: assembled.size,
          buffer: assembled.buffer,
          width: assembled.width,
          height: assembled.height,
          sourceUrl: assembled.sourceUrl
        });
      } catch (err) {
        pageLog.status = "error";
        pageLog.error = String(err?.message || err);
        pageLog.durationMs = (performance.now ? performance.now() : Date.now()) - start;
        telemetry.failures.push({ index, src: pageEntry.src, error: pageLog.error });
        throw err;
      }
    }

    telemetry.completedAt = Date.now();
    telemetry.durationMs = telemetry.completedAt - telemetry.startedAt;
    telemetry.pagesDownloaded = pages.length;

    return {
      status: "success",
      seriesTitle,
      title: episodeTitle,
      count: pages.length,
      total: totalPages,
      metadataSaved: false,
      onlyFirst: !!onlyFirst,
      zipDownload: !!zipDownload,
      telemetry,
      pages,
      defaultZipName: `${seriesTitle}-${episodeTitle}.zip`,
      nextUri: null,
      nextUrl: null
    };
  }

  async function listPages(input = location.href) {
    const pageUrl = typeof input === "string" && input ? input : (input?.pageUrl || location.href);
    let probeResult = input && typeof input === "object" && (input.ptbinb || input.jsonPaths)
      ? input
      : null;
    if (!probeResult) {
      probeResult = await getProbe(pageUrl);
    }
    if (!probeResult) {
      return [];
    }
    if (probeResult.ptbinb) {
      const ptbinb = probeResult.ptbinb;
      const tapState = probeResult.tapState || null;
      await hydratePtbinbContext(ptbinb, false, tapState);
      const session = createPtbinbDownloadSession(ptbinb);
      const pages = Array.isArray(ptbinb.pages) ? ptbinb.pages : [];
      if (!pages.length) {
        return [];
      }
      const derivedTitles = deriveTitles(pageUrl, ptbinb.infoItem?.Title || probeResult.title || ptbinb.title);
      const seriesSlug = sanitizeName(derivedTitles.seriesTitle || "Series", "Series");
      const episodeSlug = sanitizeName(derivedTitles.episodeTitle || "Episode", "Episode");
      const widthDigits = String(Math.max(1, pages.length)).length;
      return pages.map((pageEntry, index) => {
        const imageUrl = buildPtbinbImageUrl(ptbinb.meta, session, pageEntry, ptbinb.imageClass);
        return {
          id: `${ptbinb.cid || "ptbinb"}-${index + 1}`,
          title: `Page ${index + 1}`,
          url: imageUrl,
          filename: `${seriesSlug}/${episodeSlug}/${String(index + 1).padStart(widthDigits, "0")}.jpg`,
          referer: ptbinb.referer || pageUrl
        };
      });
    }
    // JSON-based viewers require assembly; return empty array so the runner fallback can handle it.
    return [];
  }

  async function downloadEpisode(pageUrl, options = {}) {
    const { zipDownload = false, onlyFirst = false, tapState = null, loginCookies = null } = options || {};
    if (Array.isArray(loginCookies) && loginCookies.length) {
      applyLoginCookies(loginCookies);
    }
    let probeResult = tapState ? createProbeFromTapState(tapState, pageUrl) : null;
    if (!probeResult) {
      probeResult = await getProbe(pageUrl, { tapState });
    }
    if (probeResult?.ptbinb) {
      return await downloadPtbinbEpisode(
        probeResult,
        pageUrl,
        { zipDownload, onlyFirst, tapState: tapState || probeResult.tapState || null }
      );
    }
    let jsonPaths = Array.isArray(probeResult?.jsonPaths) ? probeResult.jsonPaths : [];
    if (!jsonPaths.length) {
      jsonPaths = collectJsonPathsFromDom();
    }
    return await downloadPtimgJsonEpisode(jsonPaths, pageUrl, probeResult.title, { zipDownload, onlyFirst });
  }

  async function listChapters(seriesUrl = location.href) {
    const normalizedUrl = normalizeEpisodeUrl(seriesUrl);
    const { doc, html } = await loadDocumentForUrl(normalizedUrl);
    const docTitle = doc?.querySelector?.("title")?.textContent?.trim() || extractTitleFromHtml(html) || "";
    const derivedTitles = deriveTitles(normalizedUrl, docTitle);
    let chapters = extractChapterLinksFromDom(doc, normalizedUrl);
    if (!chapters.length) {
      chapters = extractChapterLinksFromHtml(html, normalizedUrl);
    }
    if (!chapters.length) {
      chapters.push({
        id: normalizedUrl,
        title: derivedTitles.episodeTitle || "Episode",
        viewerId: "speedbinb",
        accessible: true
      });
    }
    return {
      viewerId: "speedbinb",
      seriesTitle: derivedTitles.seriesTitle || "Series",
      chapters
    };
  }

  const sharedKey = "__UnshackleBinbShared__";
  const shared = root[sharedKey] || {};
  Object.assign(shared, {
    sanitizeName,
    withNoStore,
    fetchWithCandidates,
    createTelemetry,
    createPageLog,
    createCanvas,
    loadBitmapFromBlob,
    canvasToBlob,
    deriveTitles,
    normalizeBaseUrl,
    normalizeEpisodeUrl,
    extractTitleFromHtml,
    getDocumentHtml
  });
  root[sharedKey] = shared;

  const module = {
    id: "speedbinb",
    displayName: "Speedbinb",
    detect,
    probe,
    probeWithTap,
    listChapters,
    listPages,
    downloadEpisode,
    // Expose page-bridge fetch so other modules (e.g., Yanmaga) can leverage page-context requests
    pageBridgeFetch
  };

  registerSiteModule(module);
})();
