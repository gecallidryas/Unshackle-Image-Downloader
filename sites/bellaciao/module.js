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
  const registry = root[REGISTRY_KEY] || root.UnshackleSites || null;
  if (registry?.modules) {
    delete registry.modules.ciaoplus;
    delete registry.modules.pocketshonenmagazine;
  }
  const textEncoder = new TextEncoder();
  const runtimeAvailable = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;

  const SITE_CONFIGS = [
    {
      slug: "ciaoplus",
      displayName: "Ciao Plus",
      apiBase: "https://api.ciao.shogakukan.co.jp/",
      headerName: "X-Bambi-Hash",
      hashSeed: "",
      baseParams: { platform: "3", version: "6.0.0" },
      gridSize: 4,
      preserveRight: 4,
      referer: "https://ciao.shogakukan.co.jp/",
      hostPatterns: [
        /(?:^|\.)ciao(?:-?plus)?\.shogakukan\.co\.jp$/i,
        /(?:^|\.)bellaciao\.shogakukan\.co\.jp$/i
      ]
    },
    {
      slug: "pocketmag",
      displayName: "Pocket Magazine",
      apiBase: "https://api.pocket.shonenmagazine.com/",
      headerName: "X-Manga-Hash",
      hashSeed: [
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"
      ].join("_"),
      baseParams: { platform: "3" },
      gridSize: 4,
      preserveRight: 0,
      referer: "https://pocket.shonenmagazine.com/",
      hostPatterns: [
        /(?:^|\.)pocket\.shonenmagazine\.com$/i,
        /(?:^|\.)magazinepocket\.com$/i,
        /(?:^|\.)shonenmagazine\.com$/i
      ]
    }
  ];

  function toUtf8(value) {
    return textEncoder.encode(value == null ? "" : String(value));
  }

  function bytesToHex(bytes) {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex;
  }

  async function digestHex(algorithm, value) {
    if (!root.crypto?.subtle) {
      throw new Error("SubtleCrypto unavailable");
    }
    const hash = await root.crypto.subtle.digest(algorithm, toUtf8(value));
    return bytesToHex(new Uint8Array(hash));
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

  async function computeHeaderHash(params, seed = "") {
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const hashedPairs = [];
    for (const [key, value] of entries) {
      const keyHash = await digestHex("SHA-256", key);
      const valueHash = await digestHex("SHA-512", value);
      hashedPairs.push(`${keyHash}_${valueHash}`);
    }
    const aggregate = await digestHex("SHA-256", hashedPairs.join(","));
    return digestHex("SHA-512", aggregate + (seed || ""));
  }

  function headersToPlainObject(headers) {
    const obj = {};
    if (!headers) return obj;
    headers.forEach((value, key) => {
      if (value != null) {
        obj[key] = value;
      }
    });
    return obj;
  }

  async function runtimeFetch(request) {
    if (!runtimeAvailable) {
      throw new Error("Runtime messaging unavailable");
    }
    return await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ action: "fetchRequest", ...request }, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message || String(err)));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchJsonWithBackground(url, headers) {
    if (runtimeAvailable) {
      try {
        const refererValue = typeof headers?.get === "function" ? headers.get("Referer") : undefined;
        const response = await runtimeFetch({
          url,
          method: "GET",
          headers: headersToPlainObject(headers),
          responseType: "json",
          credentials: "include",
          referrer: refererValue || undefined
        });
        if (!response || !response.ok) {
          const reason = response?.error || `HTTP ${response?.status || "error"}`;
          throw new Error(reason);
        }
        return response.data;
      } catch (err) {
        if (typeof fetch === "function") {
          const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers
          }).catch(() => null);
          if (res && res.ok) {
            return res.json();
          }
        }
        throw err;
      }
    }
    if (typeof fetch === "function") {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers
      }).catch(() => null);
      if (res && res.ok) {
        return res.json();
      }
    }
    throw new Error("Network fetch unavailable");
  }

  async function fetchBinaryWithBackground(url, headers) {
    if (runtimeAvailable) {
      try {
        const refererValue = typeof headers?.get === "function" ? headers.get("Referer") : undefined;
        const response = await runtimeFetch({
          url,
          method: "GET",
          headers: headersToPlainObject(headers),
          responseType: "arraybuffer",
          credentials: "include",
          referrer: refererValue || undefined
        });
        if (!response || !response.ok || response.data == null) {
          const reason = response?.error || `HTTP ${response?.status || "error"}`;
          throw new Error(reason);
        }
        if (response.data instanceof ArrayBuffer) {
          return new Uint8Array(response.data);
        }
        if (ArrayBuffer.isView(response.data)) {
          const view = response.data;
          return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
        }
        if (Array.isArray(response.data)) {
          return new Uint8Array(response.data);
        }
        if (typeof response.data === "string") {
          const bin = atob(response.data);
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
        throw new Error("Unexpected binary payload");
      } catch (err) {
        if (typeof fetch === "function") {
          const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            headers
          }).catch(() => null);
          if (res && res.ok) {
            const ab = await res.arrayBuffer();
            return new Uint8Array(ab);
          }
        }
        throw err;
      }
    }
    if (typeof fetch === "function") {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers
      }).catch(() => null);
      if (res && res.ok) {
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
      }
    }
    throw new Error("Network fetch unavailable");
  }

  function sanitizeName(value, fallback) {
    const str = String(value ?? fallback ?? "").trim();
    if (!str) return fallback || "episode";
    return str.replace(/[\\/:*?"<>|]+/g, "_").trim() || fallback || "episode";
  }

  function createTelemetry(site, totalPages, zipDownload) {
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

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to acquire 2D context");
      return { canvas, ctx };
    }
    const canvas = root.document?.createElement("canvas");
    if (!canvas) throw new Error("Canvas APIs unavailable");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to acquire 2D context");
    return { canvas, ctx };
  }

  async function canvasToBytes(canvas) {
    if (typeof canvas.convertToBlob === "function") {
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    }
    return await new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") {
        reject(new Error("Canvas toBlob unavailable"));
        return;
      }
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob returned empty blob"));
          return;
        }
        try {
          const buffer = await blob.arrayBuffer();
          resolve(new Uint8Array(buffer));
        } catch (err) {
          reject(err);
        }
      }, "image/jpeg", 0.92);
    });
  }

  async function loadImageFromBlob(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob);
    }
    return await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.crossOrigin = "anonymous";
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Image decode failed"));
      };
      img.src = url;
    });
  }

  function makeRandom(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
  }

  function createTileMap(gridSize, seed) {
    const total = gridSize * gridSize;
    const indices = Array.from({ length: total }, (_, i) => i);
    const rand = makeRandom(seed);
    return indices
      .map((item) => ({ order: rand(), item }))
      .sort((a, b) => a.order - b.order)
      .map(({ item }, destIndex) => {
        const sourceIndex = item;
        return {
          source: {
            x: sourceIndex % gridSize,
            y: Math.floor(sourceIndex / gridSize)
          },
          dest: {
            x: destIndex % gridSize,
            y: Math.floor(destIndex / gridSize)
          }
        };
      });
  }

  function createDescrambler(config) {
    const gridSize = config.gridSize ?? 4;
    const preserveRight = config.preserveRight ?? 0;
    return async function descramble(buffer, scrambleSeed) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const blob = new Blob([bytes], { type: "image/jpeg" });
      const image = await loadImageFromBlob(blob);
      const width = image.width || 0;
      const height = image.height || 0;
      if (!width || !height) {
        if (typeof image.close === "function") {
          try { image.close(); } catch {}
        }
        throw new Error("Image dimensions unavailable");
      }
      const { canvas, ctx } = makeCanvas(width, height);
      const activeWidth = Math.max(1, width - preserveRight);
      const tileWidth = Math.max(1, Math.floor(activeWidth / gridSize));
      const tileHeight = Math.max(1, Math.floor(height / gridSize));

      if (preserveRight > 0) {
        ctx.drawImage(
          image,
          width - preserveRight, 0,
          preserveRight, height,
          width - preserveRight, 0,
          preserveRight, height
        );
      }

      const tileMap = createTileMap(gridSize, scrambleSeed >>> 0 || 1);
      for (const { source, dest } of tileMap) {
        ctx.drawImage(
          image,
          source.x * tileWidth,
          source.y * tileHeight,
          tileWidth,
          tileHeight,
          dest.x * tileWidth,
          dest.y * tileHeight,
          tileWidth,
          tileHeight
        );
      }

      const result = await canvasToBytes(canvas);
      if (typeof image.close === "function") {
        try { image.close(); } catch {}
      }
      return result;
    };
  }

  function extractEpisodeId(url) {
    try {
      const parsed = url instanceof URL ? url : new URL(url, location.href);
      const fromQuery = parsed.searchParams.get("episode_id");
      if (fromQuery && /^\d+$/.test(fromQuery)) {
        return fromQuery;
      }
      const segments = parsed.pathname.split("/").filter(Boolean).reverse();
      for (const segment of segments) {
        if (/^\d+$/.test(segment)) {
          return segment;
        }
        const match = segment.match(/(\d{5,})/);
        if (match) return match[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  function matchSiteConfig(url) {
    try {
      const parsed = url instanceof URL ? url : new URL(url, location.href);
      const host = parsed.hostname.toLowerCase();
      for (const config of SITE_CONFIGS) {
        if (config.hostPatterns.some((pattern) => pattern.test(host))) {
          return { config, url: parsed.href };
        }
      }
    } catch {}
    return null;
  }

  function resolveSiteConfig(url = null) {
    const direct = url ? matchSiteConfig(url) : null;
    if (direct) return direct;
    if (typeof location !== "undefined" && location?.href) {
      const fallback = matchSiteConfig(location.href);
      if (fallback) return fallback;
    }
    return null;
  }

  function resolveTitles(config, payload, episodeUrl) {
    const episodeKeys = ["episode_title", "episode_name", "title_name", "chapter_title", "chapter_name"];
    const seriesKeys = ["series_title", "series_name", "title_name"];

    const directEpisode = findString(payload, episodeKeys);
    const nestedEpisode = findString(payload?.episode, episodeKeys) || findString(payload?.title, episodeKeys);
    const directSeries = findString(payload, seriesKeys);
    const nestedSeries = findString(payload?.title, seriesKeys) || findString(payload?.episode, seriesKeys);

    const metaEpisode = metaContent('meta[property="og:title"], meta[name="twitter:title"]');
    const metaSeries = metaContent('meta[property="og:site_name"], meta[name="application-name"]');
    const docTitle = (root.document?.title || "").trim();
    const titleParts = docTitle.split(/[|–\-]/).map((part) => part.trim()).filter(Boolean);

    let seriesTitle = directSeries || nestedSeries || metaSeries || titleParts.slice(1).join(" ");
    if (!seriesTitle) {
      try {
        const parsed = new URL(episodeUrl, location.href);
        seriesTitle = parsed.hostname.replace(/^www\./i, "");
      } catch {
        seriesTitle = config.displayName;
      }
    }

    const episodeTitle = directEpisode || nestedEpisode || metaEpisode || titleParts[0] || config.displayName;

    return {
      seriesTitle: sanitizeName(seriesTitle, "series"),
      episodeTitle: sanitizeName(episodeTitle, "episode")
    };
  }

  function buildEpisodeUrlFromId(baseUrl, episodeId) {
    if (!episodeId) return null;
    try {
      const url = new URL(baseUrl || (typeof location !== "undefined" ? location.href : "https://ciao.shogakukan.co.jp/"));
      url.searchParams.set("episode_id", episodeId);
      return url.href;
    } catch {
      return null;
    }
  }

  function extractChaptersFromPayload(payload, referenceUrl, moduleId = "bellaciao") {
    const collections = [];
    if (Array.isArray(payload?.episode_list)) collections.push(payload.episode_list);
    if (Array.isArray(payload?.episodes)) collections.push(payload.episodes);
    if (Array.isArray(payload?.chapter_list)) collections.push(payload.chapter_list);
    if (Array.isArray(payload?.title?.episode_list)) collections.push(payload.title.episode_list);
    if (Array.isArray(payload?.title?.episodes)) collections.push(payload.title.episodes);
    if (Array.isArray(payload?.title?.chapters)) collections.push(payload.title.chapters);
    if (Array.isArray(payload?.episode?.siblings)) collections.push(payload.episode.siblings);
    if (!collections.length) return [];

    const seen = new Set();
    const chapters = [];
    const baseUrl = referenceUrl || (typeof location !== "undefined" ? location.href : "");

    for (const list of collections) {
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const href = entry.viewer_url || entry.episode_url || entry.url || entry.link;
        const id = entry.episode_id || entry.id || entry.content_id;
        const resolved = href ? normalizeEpisodeUrl(href) : buildEpisodeUrlFromId(baseUrl, id);
        if (!resolved) continue;
        const key = resolved.replace(/#.*$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        const title =
          entry.title ||
          entry.episode_title ||
          entry.chapter_title ||
          entry.name ||
          `Episode ${chapters.length + 1}`;
        const accessible = entry.is_free != null
          ? !!entry.is_free
          : entry.free_flg != null
            ? String(entry.free_flg) === "1"
            : true;
        chapters.push({
          id: resolved,
          title: sanitizeName(title, "episode"),
          viewerId: moduleId,
          accessible
        });
      }
    }

    return chapters;
  }

  function findString(source, keys) {
    if (!source || typeof source !== "object") return null;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  function metaContent(selector) {
    try {
      return root.document?.querySelector(selector)?.content?.trim() || "";
    } catch {
      return "";
    }
  }

  const payloadCache = new Map();

  async function fetchPayload(config, episodeId) {
    const cacheKey = `${config.slug}:${episodeId}`;
    if (payloadCache.has(cacheKey)) {
      return payloadCache.get(cacheKey);
    }
    const pending = (async () => {
      const params = new URLSearchParams(config.baseParams || {});
      params.set("platform", params.get("platform") || "3");
      params.set("episode_id", episodeId);
      params.sort();
      const hash = await computeHeaderHash(params, config.hashSeed || "");
      const endpoint = new URL("./web/episode/viewer", config.apiBase);
      endpoint.search = params.toString();
      const headers = new Headers({ [config.headerName]: hash });
      if (config.referer) {
        headers.set("Referer", config.referer);
      }
      return fetchJsonWithBackground(endpoint.toString(), headers);
    })();
    payloadCache.set(cacheKey, pending);
    try {
      const data = await pending;
      Object.defineProperty(data, "__bellaSlug", { value: config.slug, enumerable: false });
      return data;
    } catch (err) {
      payloadCache.delete(cacheKey);
      throw err;
    }
  }

  function normalizeEpisodeUrl(url) {
    try {
      return new URL(url, typeof location === "undefined" ? undefined : location.href).href;
    } catch {
      if (typeof location !== "undefined" && location?.href) {
        return location.href;
      }
      return String(url ?? "");
    }
  }

  async function fetchEpisodeContext(url, { suppressErrors = false } = {}) {
    const normalizedUrl = normalizeEpisodeUrl(url);
    const episodeId = extractEpisodeId(normalizedUrl);
    if (!episodeId) {
      if (suppressErrors) return null;
      throw new Error("Unable to determine episode id.");
    }
    const direct = resolveSiteConfig(normalizedUrl);
    const candidates = [];
    if (direct?.config) {
      candidates.push(direct.config);
    }
    for (const config of SITE_CONFIGS) {
      if (!candidates.includes(config)) {
        candidates.push(config);
      }
    }
    const errors = [];
    for (const config of candidates) {
      try {
        const payload = await fetchPayload(config, episodeId);
        return { config, payload, episodeId, url: normalizedUrl };
      } catch (err) {
        errors.push({ config, error: err });
      }
    }
    if (suppressErrors) {
      return null;
    }
    const primary = errors.find((entry) => entry?.error);
    if (primary?.error) {
      throw primary.error;
    }
    throw new Error("Unsupported BellaCiao site or host.");
  }

  async function listChapters(seriesUrl = location.href) {
    const context = await fetchEpisodeContext(seriesUrl, { suppressErrors: true });
    const referenceUrl = context?.url || normalizeEpisodeUrl(seriesUrl);
    const config = context?.config || resolveSiteConfig(seriesUrl)?.config || SITE_CONFIGS[0];
    let seriesTitle = config?.displayName || "BellaCiao";
    let defaultEpisodeTitle = "Episode";
    if (context?.payload) {
      const titles = resolveTitles(config, context.payload, referenceUrl);
      seriesTitle = titles.seriesTitle || seriesTitle;
      defaultEpisodeTitle = titles.episodeTitle || defaultEpisodeTitle;
    }
    let chapters = context?.payload ? extractChaptersFromPayload(context.payload, referenceUrl, "bellaciao") : [];
    if (!chapters.length) {
      chapters = [{
        id: referenceUrl,
        title: sanitizeName(defaultEpisodeTitle, "episode"),
        viewerId: "bellaciao",
        accessible: true
      }];
    }
    return {
      viewerId: "bellaciao",
      seriesTitle: sanitizeName(seriesTitle, "series"),
      chapters
    };
  }

  const module = {
    id: "bellaciao",
    displayName: "BellaCiao",
    detect: async (url = location.href) => {
      try {
        if (!extractEpisodeId(url)) return false;
        const match = resolveSiteConfig(url);
        if (match) return true;
        const host = new URL(url, typeof location === "undefined" ? undefined : location.href).hostname.toLowerCase();
        return /(ciao|shogakukan|shonenmagazine|magazinepocket)/.test(host);
      } catch {
        return false;
      }
    },
    probe: async (url = location.href) => {
      const context = await fetchEpisodeContext(url);
      return context?.payload ?? null;
    },
    listChapters,
    listPages: (payload) => {
      if (!payload || typeof payload !== "object") return [];
      const list = Array.isArray(payload.page_list) ? payload.page_list : [];
      const seed = Number(payload.scramble_seed) || Number(payload.seed) || 1;
      return list.map((src, index) => ({
        src,
        index,
        type: "image/jpeg",
        scrambleSeed: seed
      }));
    },
    downloadEpisode: async (episodeUrl, options = {}) => {
      const { saveMetadata = false, onlyFirst = false, zipDownload = false, loginCookies = null } = options || {};
      if (Array.isArray(loginCookies) && loginCookies.length) {
        applyLoginCookies(loginCookies);
      }
      const context = await fetchEpisodeContext(episodeUrl);
      if (!context?.config || !context.payload) {
        throw new Error("Unsupported BellaCiao site or host.");
      }
      const { config, payload } = context;
      if (saveMetadata) {
        console.warn(`${config.displayName}: metadata export not supported; continuing without metadata.`);
      }
      const status = typeof payload?.status === "string" ? payload.status : "ok";
      if (status !== "ok" && payload?.error_code) {
        throw new Error(`API error: ${payload.error_code}`);
      }
      const pages = Array.isArray(payload?.page_list) ? payload.page_list : [];
      if (!pages.length) {
        throw new Error("No pages available for this episode.");
      }
      const scrambleSeed = Number(payload?.scramble_seed) || 1;
      const telemetry = createTelemetry(config.slug, pages.length, zipDownload);
      const targetPages = onlyFirst ? pages.slice(0, 1) : pages.slice();
      const processed = [];
      const { seriesTitle, episodeTitle } = resolveTitles(config, payload, episodeUrl);
      const filenameWidth = String(targetPages.length).length;
      const descramble = createDescrambler(config);

      for (let index = 0; index < targetPages.length; index++) {
        const pageUrl = targetPages[index];
        const pageLog = createPageLog(index, pageUrl);
        telemetry.pages.push(pageLog);
        const start = performance.now();
        try {
          pageLog.attempts.push({ mode: "background", status: "start" });
          const headers = new Headers();
          if (config.referer) {
            headers.set("Referer", config.referer);
          }
          const rawBytes = await fetchBinaryWithBackground(pageUrl, headers);
          pageLog.attempts.push({ mode: "background", status: "ok" });
          const bytes = await descramble(rawBytes, scrambleSeed);
          pageLog.status = "success";
          pageLog.durationMs = performance.now() - start;
          processed.push({
            index,
            sourceUrl: pageUrl,
            bytes
          });
        } catch (err) {
          pageLog.status = "error";
          pageLog.error = String(err?.message || err);
          pageLog.durationMs = performance.now() - start;
          telemetry.failures.push({ index, src: pageUrl, error: pageLog.error });
          throw err;
        }
      }

      processed.sort((a, b) => a.index - b.index);
      const resultPages = [];
      for (const entry of processed) {
        const bytes = entry.bytes;
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const filename = `${seriesTitle}/${episodeTitle}/${String(entry.index + 1).padStart(filenameWidth, "0")}.jpg`;
        resultPages.push({
          kind: "page",
          index: entry.index,
          filename,
          mimeType: "image/jpeg",
          size: bytes.byteLength,
          buffer,
          sourceUrl: entry.sourceUrl
        });
      }

      telemetry.completedAt = Date.now();
      telemetry.durationMs = telemetry.completedAt - telemetry.startedAt;
      telemetry.pagesDownloaded = resultPages.length;
      telemetry.zipFilename = null;
      telemetry.zipDownloadId = null;

      return {
        status: "success",
        seriesTitle,
        title: episodeTitle,
        count: resultPages.length,
        total: pages.length,
        metadataSaved: false,
        onlyFirst: !!onlyFirst,
        zipDownload: !!zipDownload,
        telemetry,
        pages: resultPages,
        defaultZipName: `${seriesTitle}-${episodeTitle}.zip`,
        nextUri: null,
        nextUrl: null
      };
    },
    runOnePageDiagnostic: async (url = location.href) => {
      const result = await module.downloadEpisode(url, { onlyFirst: true, zipDownload: false, saveMetadata: false });
      if (!result || result.status !== "success") {
        throw new Error(result?.message || "Diagnostic download failed");
      }
      const first = Array.isArray(result.pages)
        ? result.pages.find((entry) => entry && entry.kind === "page")
        : null;
      if (!first) {
        throw new Error("Diagnostic result missing page data");
      }
      const buffer = first.buffer instanceof ArrayBuffer
        ? first.buffer.slice(0)
        : ArrayBuffer.isView(first.buffer)
          ? first.buffer.buffer.slice(first.buffer.byteOffset, first.buffer.byteOffset + first.buffer.byteLength)
          : null;
      if (!buffer) {
        throw new Error("Diagnostic buffer unavailable");
      }
      return { ok: true, bytes: buffer.byteLength };
    }
  };

  registerSiteModule(module);
})();
