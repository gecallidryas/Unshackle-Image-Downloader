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

  const GRID_DIV = 4;
  const PIX_MUL = 8;
  const TILE_FETCH_CACHE = new Map();
  const TILE_FETCH_CONCURRENCY = 4;
  const TILE_FETCH_MAX_ATTEMPTS = 4;
  const TILE_FETCH_BASE_DELAY = 280;

  const runtimeAvailable = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
  const extensionManifest = runtimeAvailable && typeof chrome.runtime.getManifest === "function"
    ? chrome.runtime.getManifest()
    : null;
  let offscreenEnabled = !!(extensionManifest && extensionManifest.offscreen);

  async function runWithConcurrency(items, concurrency, iterator) {
    const list = Array.from(items || []);
    if (!list.length) return [];
    const limit = Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1);
    const results = new Array(list.length);
    let nextIndex = 0;
    let rejected = false;

    const worker = async () => {
      while (!rejected) {
        const current = nextIndex++;
        if (current >= list.length) return;
        try {
          results[current] = await iterator(list[current], current, list);
        } catch (err) {
          rejected = true;
          throw err;
        }
      }
    };

    const workers = [];
    const count = Math.min(limit, list.length);
    for (let i = 0; i < count; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  function decodeHtml(value) {
    if (value == null) return "";
    const textarea = decodeHtml.__textarea || (decodeHtml.__textarea = root.document?.createElement("textarea"));
    if (!textarea) return value;
    textarea.innerHTML = value;
    const decoded = textarea.value;
    textarea.innerHTML = "";
    return decoded;
  }

  function pathLooksLikeGV(url = location.href) {
    try {
      const u = new URL(url, location.href);
      return /^\/(episode|magazine|volume)\/\d+(?:\.json)?$/.test(u.pathname);
    } catch {
      return false;
    }
  }

  function shouldFetchEpisodeJson(url = location.href) {
    if (pathLooksLikeGV(url)) return true;
    try {
      if (typeof document !== "undefined") {
        const current = document.location?.href;
        if (current && pathLooksLikeGV(current)) {
          return true;
        }
      }
    } catch { }
    return false;
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
      } catch { }
    }
  }

  function findEpisodeJsonInDOM() {
    if (typeof document === "undefined") return null;
    const primary = document.querySelector('script#episode-json[data-value], script#episode-json[type="application/json"]');
    if (primary) {
      const rawAttr = primary.getAttribute("data-value");
      if (rawAttr != null) {
        try {
          const decoded = decodeHtml(rawAttr);
          if (decoded) return JSON.parse(decoded);
        } catch { }
      }
      const text = primary.textContent?.trim();
      if (text) {
        try { return JSON.parse(text); } catch { }
      }
    }
    const nodes = document.querySelectorAll('script[type="application/json"], script[id*="NEXT_DATA"], script[id*="NUXT"]');
    for (const node of nodes) {
      const t = node.textContent?.trim();
      if (!t || t.length < 50) continue;
      if (!/readableProduct/.test(t)) continue;
      try {
        const parsed = JSON.parse(t);
        const stack = [parsed];
        while (stack.length) {
          const cur = stack.pop();
          if (cur && typeof cur === "object") {
            if (cur.readableProduct && typeof cur.readableProduct === "object") {
              return cur;
            }
            for (const key in cur) {
              if (Object.prototype.hasOwnProperty.call(cur, key)) {
                const val = cur[key];
                if (val && typeof val === "object") stack.push(val);
              }
            }
          }
        }
      } catch { }
    }
    return null;
  }

  async function fetchEpisodeJson(url = location.href) {
    const u = new URL(url, location.href);
    const base = `${u.origin}${u.pathname}`;
    const jsonPath = u.pathname.endsWith(".json") ? u.pathname : u.pathname.replace(/(?:\.json)?$/, ".json");
    const attempts = [
      base,
      `${u.origin}${jsonPath}`
    ];
    for (const href of attempts) {
      const res = await fetch(href, { credentials: "include" }).catch(() => null);
      if (!res || !res.ok) continue;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        try {
          return await res.json();
        } catch { }
      }
      try {
        const html = await res.text();
        const mAttr = html.match(/<script[^>]*id=["']episode-json["'][^>]*data-value=["']([\s\S]*?)["'][^>]*>/i);
        if (mAttr && mAttr[1]) {
          try {
            const decoded = decodeHtml(mAttr[1]);
            const j = JSON.parse(decoded);
            if (j?.readableProduct) return j;
          } catch { }
        }
        const mText = html.match(/<script[^>]*id=["']episode-json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (mText && mText[1]) {
          try {
            const j = JSON.parse(mText[1].trim());
            if (j?.readableProduct) return j;
          } catch { }
        }
        const matches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/ig) || [];
        for (const tag of matches) {
          const inner = (tag.match(/>([\s\S]*?)<\/script>/i) || [null, ""])[1].trim();
          if (!/readableProduct/.test(inner)) continue;
          try {
            const j = JSON.parse(inner);
            if (j?.readableProduct) return j;
          } catch { }
        }
      } catch { }
    }
    return null;
  }

  function toFiniteNumber(value) {
    if (value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function extractPageList(episodeJson) {
    const rp = episodeJson && episodeJson.readableProduct;
    if (!rp) return [];
    const scrambleMode = (rp.pageStructure?.choJuGiga || "").toLowerCase() || null;
    const pages = Array.isArray(rp.pageStructure?.pages) ? rp.pageStructure.pages : [];
    return pages
      .map((p) => {
        if (!p || typeof p !== "object") return null;
        const src = p.src || p.imageUrl || p.url || null;
        if (!src) return null;
        const type = typeof p.type === "string" && p.type ? p.type : "image/jpeg";
        const width = toFiniteNumber(
          p.width ?? p.imageWidth ?? p.pageWidth ?? p.canvasWidth ?? p.contentWidth ?? p.displayWidth ?? p.size?.width
        );
        const height = toFiniteNumber(
          p.height ?? p.imageHeight ?? p.pageHeight ?? p.canvasHeight ?? p.contentHeight ?? p.displayHeight ?? p.size?.height
        );
        const declaredDiv = toFiniteNumber(
          p.grid ?? p.gridSize ?? p.divisions ?? p.div ?? p.tilesPerRow ?? p.columns ?? p.cols
        );
        const rawTiles = Array.isArray(p.tiles)
          ? p.tiles
          : Array.isArray(p.tileImages)
            ? p.tileImages
            : Array.isArray(p.images)
              ? p.images
              : Array.isArray(p.assets)
                ? p.assets
                : null;
        const tiles = Array.isArray(rawTiles)
          ? rawTiles
            .map((tile, idx) => {
              if (!tile) return null;
              if (typeof tile === "string") {
                return { url: tile, index: idx };
              }
              const url = tile.src || tile.url || tile.imageUrl || tile.href || tile.link || tile.path;
              if (!url) return null;
              const indexCandidate = tile.index ?? tile.position ?? tile.order ?? tile.seq ?? tile.i;
              const tileIndex = toFiniteNumber(indexCandidate);
              return { url, index: tileIndex != null ? tileIndex : idx };
            })
            .filter(Boolean)
          : null;
        return {
          src,
          type,
          width: width && width > 0 ? width : null,
          height: height && height > 0 ? height : null,
          tiles: tiles && tiles.length ? tiles : null,
          tileDiv: declaredDiv && declaredDiv > 0 ? declaredDiv : null,
          scramble: scrambleMode
        };
      })
      .filter(Boolean);
  }

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      return { canvas, ctx };
    }
    const canvas = root.document?.createElement("canvas");
    if (!canvas) throw new Error("Canvas unavailable");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    return { canvas, ctx };
  }

  function detectTileGrid(width, height, tileCount = null, declaredDiv = null) {
    if (Number.isFinite(declaredDiv) && declaredDiv > 0) return declaredDiv;
    if (Number.isFinite(tileCount) && tileCount > 0) {
      const root = Math.round(Math.sqrt(tileCount));
      if (root > 0 && root * root === tileCount) return root;
    }
    const candidates = [GRID_DIV, 5, 6, 3, 2];
    for (const div of candidates) {
      if (width % (div * PIX_MUL) === 0 && height % (div * PIX_MUL) === 0) {
        return div;
      }
    }
    return GRID_DIV;
  }

  function clampDimension(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      const fb = Number(fallback);
      if (Number.isFinite(fb) && fb > 0) {
        return Math.round(fb);
      }
      return 1;
    }
    return Math.max(1, Math.round(num));
  }

  function computeTileGeometry(width, height, div) {
    const clamp = (value) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : 1;
    };
    const quantize = (value) => {
      const safe = clamp(value);
      let q = Math.floor(safe / (div * PIX_MUL)) * PIX_MUL;
      if (q <= 0) {
        q = Math.floor(safe / div);
      }
      if (q <= 0) {
        q = safe;
      }
      return Math.max(1, q);
    };
    const colW = quantize(width);
    const rowH = quantize(height);
    const canvasWidth = Math.max(1, colW * div);
    const canvasHeight = Math.max(1, rowH * div);
    return {
      colW,
      rowH,
      canvasWidth,
      canvasHeight,
      div
    };
  }

  async function exportJPEG(canvas) {
    if (canvas.convertToBlob) {
      return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    }
    return new Promise((resolve) => {
      if (typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
    });
  }

  async function normalizeTiledImage(buffer, mime = "image/jpeg", pageMeta = null) {
    const array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const blob = new Blob([array], { type: mime });
    const bitmap = await createImageBitmap(blob);

    const scrambleMode = (pageMeta?.scramble || "").toLowerCase();
    const transposeTiles = scrambleMode === "baku";
    if (!transposeTiles) {
      if (typeof bitmap.close === "function") {
        try { bitmap.close(); } catch { }
      }
      return array;
    }

    const widthHint = pageMeta && Number.isFinite(pageMeta.width) ? pageMeta.width : null;
    const heightHint = pageMeta && Number.isFinite(pageMeta.height) ? pageMeta.height : null;
    const declaredDiv = pageMeta && Number.isFinite(pageMeta.tileDiv) ? pageMeta.tileDiv : null;
    const tileCount = pageMeta && Array.isArray(pageMeta.tiles) ? pageMeta.tiles.length : null;
    const baseWidth = widthHint && widthHint > 0 ? widthHint : bitmap.width;
    const baseHeight = heightHint && heightHint > 0 ? heightHint : bitmap.height;
    const div = detectTileGrid(baseWidth, baseHeight, tileCount, declaredDiv);
    const geometry = computeTileGeometry(baseWidth, baseHeight, div);
    // Use the full target dimensions for the canvas, not the quantized geometry dimensions
    const { canvas, ctx } = makeCanvas(baseWidth, baseHeight);
    if (!ctx) {
      if (typeof bitmap.close === "function") {
        try { bitmap.close(); } catch { }
      }
      throw new Error("Failed to acquire 2D context");
    }
    ctx.imageSmoothingEnabled = false;

    // 1. Draw the scrambled tiled area
    for (let sy = 0; sy < div; sy++) {
      for (let sx = 0; sx < div; sx++) {
        const srcX = sx * geometry.colW;
        const srcY = sy * geometry.rowH;
        const destRow = transposeTiles ? sx : sy;
        const destCol = transposeTiles ? sy : sx;
        const dstX = destCol * geometry.colW;
        const dstY = destRow * geometry.rowH;

        const drawW = Math.min(geometry.colW, bitmap.width - srcX);
        const drawH = Math.min(geometry.rowH, bitmap.height - srcY);
        const destW = Math.min(geometry.colW, geometry.canvasWidth - dstX);
        const destH = Math.min(geometry.rowH, geometry.canvasHeight - dstY);

        if (drawW <= 0 || drawH <= 0 || destW <= 0 || destH <= 0) continue;
        ctx.drawImage(bitmap, srcX, srcY, drawW, drawH, dstX, dstY, destW, destH);
      }
    }

    // 2. Copy the remaining pixels (right edge and bottom edge) directly
    // These are pixels outside the quantized grid area
    const tiledWidth = geometry.canvasWidth;
    const tiledHeight = geometry.canvasHeight;

    // Right edge
    if (tiledWidth < baseWidth) {
      const w = baseWidth - tiledWidth;
      const h = baseHeight;
      if (w > 0 && h > 0) {
        ctx.drawImage(bitmap, tiledWidth, 0, w, h, tiledWidth, 0, w, h);
      }
    }

    // Bottom edge (excluding the corner already covered by right edge copy if any, 
    // but simpler to just copy the bottom strip below tiledHeight)
    if (tiledHeight < baseHeight) {
      const w = Math.min(tiledWidth, baseWidth); // Copy up to tiledWidth or baseWidth
      const h = baseHeight - tiledHeight;
      if (w > 0 && h > 0) {
        ctx.drawImage(bitmap, 0, tiledHeight, w, h, 0, tiledHeight, w, h);
      }
    }

    if (typeof bitmap.close === "function") {
      try { bitmap.close(); } catch { }
    }

    const outBlob = await exportJPEG(canvas);
    if (!outBlob) throw new Error("Failed to export JPEG");
    const outBuffer = await outBlob.arrayBuffer();
    return new Uint8Array(outBuffer);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
  const shouldRetryStatus = (status) => status === 429 || status >= 500;
  const isTypeError = (err) => err instanceof TypeError || String(err).includes("TypeError");

  async function runtimeRequest(action, payload) {
    if (!runtimeAvailable) throw new Error("Runtime messaging unavailable");
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || String(err)));
          return;
        }
        resolve(response);
      });
    });
  }

  async function normalizePageBytes(buffer, mime, ctx) {
    const pageMeta = ctx?.pageMeta || null;
    if (buffer == null) {
      throw new Error("Missing image buffer");
    }
    let workingBuffer = buffer;
    if (ArrayBuffer.isView(buffer)) {
      workingBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } else if (!(buffer instanceof ArrayBuffer)) {
      workingBuffer = new Uint8Array(buffer).buffer;
    }

    if (offscreenEnabled && runtimeAvailable) {
      try {
        const cloned = workingBuffer.slice(0);
        const response = await runtimeRequest("gv.processImage", { buffer: cloned, mimeType: mime, pageMeta });
        if (response?.ok && response.data) {
          ctx?.pageLog?.attempts.push({ mode: "offscreen", status: "ok" });
          return new Uint8Array(response.data);
        }
        if (response?.error) {
          throw new Error(response.error);
        }
      } catch (err) {
        const message = String(err?.message || err);
        ctx?.pageLog?.attempts.push({ mode: "offscreen", status: "error", message });
        if (/Offscreen/i.test(message)) {
          offscreenEnabled = false;
        } else {
          console.warn("Offscreen normalization failed:", message);
        }
      }
    }
    const normalized = await normalizeTiledImage(workingBuffer, mime, pageMeta);
    return normalized;
  }

  async function fetchArrayBuffer(url, ctx) {
    if (!url) throw new Error("Missing URL");
    if (TILE_FETCH_CACHE.has(url)) {
      const cached = await TILE_FETCH_CACHE.get(url);
      return cached.slice(0);
    }
    const pending = (async () => {
      const buffer = await fetchArrayBufferInternal(url, ctx);
      return buffer;
    })();
    TILE_FETCH_CACHE.set(url, pending);
    try {
      const buffer = await pending;
      return buffer.slice(0);
    } catch (err) {
      TILE_FETCH_CACHE.delete(url);
      throw err;
    }
  }

  async function fetchArrayBufferInternal(url, ctx) {
    let lastError = null;
    for (let attempt = 0; attempt < TILE_FETCH_MAX_ATTEMPTS; attempt++) {
      try {
        ctx?.pageLog?.attempts.push({ mode: "direct", attempt: attempt + 1 });
        const buffer = await fetchDirectWithCredentials(url);
        ctx?.pageLog?.attempts.push({ mode: "direct", attempt: attempt + 1, status: "ok" });
        return buffer;
      } catch (err) {
        const attemptNo = attempt + 1;
        if (isTypeError(err)) {
          try {
            ctx?.pageLog?.attempts.push({ mode: "background", attempt: attemptNo });
            const fallback = await fetchViaBackground(url);
            ctx?.pageLog?.attempts.push({ mode: "background", attempt: attemptNo, status: "ok" });
            return fallback;
          } catch (fallbackErr) {
            ctx?.pageLog?.attempts.push({ mode: "background", attempt: attemptNo, status: "error", message: String(fallbackErr?.message || fallbackErr) });
            lastError = fallbackErr;
          }
        } else if (err && err.isHttpError && shouldRetryStatus(err.status) && attempt < TILE_FETCH_MAX_ATTEMPTS - 1) {
          ctx?.pageLog?.attempts.push({ mode: "direct", attempt: attemptNo, status: "retry", httpStatus: err.status });
          lastError = err;
        } else {
          ctx?.pageLog?.attempts.push({ mode: "direct", attempt: attemptNo, status: "error", message: String(err?.message || err) });
          throw err;
        }
      }
      if (attempt < TILE_FETCH_MAX_ATTEMPTS - 1) {
        ctx?.telemetry && (ctx.telemetry.retries = (ctx.telemetry.retries || 0) + 1);
        await sleep(TILE_FETCH_BASE_DELAY * Math.pow(2, attempt));
      }
    }
    throw lastError ?? new Error("Fetch failed");
  }

  async function fetchDirectWithCredentials(url) {
    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      mode: "cors",
      referrer: typeof location !== "undefined" ? location.href : undefined,
      referrerPolicy: "strict-origin-when-cross-origin"
    });
    if (!res.ok) {
      const error = new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      error.status = res.status;
      error.isHttpError = true;
      throw error;
    }
    return await res.arrayBuffer();
  }

  async function fetchViaBackground(url) {
    const response = await runtimeRequest("fetchOne", { url }).catch(() => null);
    if (!response || response.ok === false) {
      throw new Error(response?.error || "Background fetch failed");
    }
    return await normalizeBackgroundPayload(response);
  }

  function describeShape(x) {
    if (x == null) return "null/undefined";
    if (Array.isArray(x)) return `Array(len=${x.length})`;
    if (x instanceof Uint8Array) return `Uint8Array(len=${x.length})`;
    if (x instanceof ArrayBuffer) return "ArrayBuffer";
    if (typeof x === "string") return `string(len=${x.length})`;
    if (typeof x === "object") return `object(keys=${Object.keys(x).join(",")})`;
    return typeof x;
  }

  async function normalizeBackgroundPayload(resp) {
    if (resp instanceof ArrayBuffer) {
      return resp;
    }
    if (ArrayBuffer.isView(resp)) {
      const view = resp;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (resp instanceof Blob) {
      return await resp.arrayBuffer();
    }
    if (resp?.ok && resp?.kind === "u8" && Array.isArray(resp.data)) {
      return Uint8Array.from(resp.data).buffer;
    }
    if (resp?.ok && Array.isArray(resp.data)) {
      return Uint8Array.from(resp.data).buffer;
    }
    if (resp?.ok && resp.data instanceof Uint8Array) {
      return resp.data.buffer.slice(resp.data.byteOffset, resp.data.byteOffset + resp.data.byteLength);
    }
    if (resp?.ok && resp.data instanceof ArrayBuffer) {
      return resp.data;
    }
    if (resp?.ok && resp.arrayBuffer instanceof ArrayBuffer) {
      return resp.arrayBuffer;
    }
    if (resp?.ok && resp.data instanceof Blob) {
      return await resp.data.arrayBuffer();
    }
    if (resp?.ok && typeof resp.data === "string" && resp.data.startsWith("data:")) {
      const comma = resp.data.indexOf(",");
      const payload = comma >= 0 ? resp.data.slice(comma + 1) : resp.data;
      const bin = atob(payload);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return buf.buffer;
    }
    if (resp?.ok && resp.data) {
      // ArrayBuffer view (e.g., DataView)
      if (ArrayBuffer.isView(resp.data)) {
        const view = resp.data;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      }
    }
    throw new Error("Unsupported background payload: " + describeShape(resp?.data ?? resp));
  }

  const LOGIN_CACHE = new Set();

  async function loginIfNeeded(episodeUrl, credentials) {
    if (!credentials || !credentials.username || !credentials.password) return;
    try {
      const u = new URL(episodeUrl, location.href);
      const base = `${u.protocol}//${u.host}`;
      const cacheKey = `${base}::${credentials.username.toLowerCase()}`;
      if (!credentials.overwrite && LOGIN_CACHE.has(cacheKey)) return;
      const loginUrl = `${base}/user_account/login`;
      const params = new URLSearchParams();
      params.set("email_address", credentials.username);
      params.set("password", credentials.password);
      params.set("return_location_path", u.pathname + u.search + u.hash);
      const res = await fetch(loginUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      if (res.ok) LOGIN_CACHE.add(cacheKey);
    } catch {
      // ignore
    }
  }

  async function buildMetadataEntry(seriesTitle, title, jsonObject) {
    try {
      const encoder = new TextEncoder();
      const metaString = JSON.stringify(jsonObject, null, 2);
      const metaBytes = encoder.encode(metaString);
      const buffer = metaBytes.buffer.slice(metaBytes.byteOffset, metaBytes.byteOffset + metaBytes.byteLength);
      return {
        filename: `${seriesTitle}/${title}/metadata.json`,
        mimeType: "application/json",
        buffer
      };
    } catch {
      return null;
    }
  }

  function sanitizeName(value, fallback) {
    const str = String(value ?? fallback ?? "").trim();
    if (!str) return fallback || "episode";
    return str.replace(/[\\/:*?"<>|]+/g, "_").trim() || fallback || "episode";
  }

  function shouldAbortOnPurchase(rp, behavior) {
    if (!rp) return { abort: false };
    if (rp.isPublic || rp.hasPurchased) return { abort: false };
    if (behavior === "ignore") return { abort: false };
    if (behavior === "prompt") {
      const ok = typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm("This chapter appears to require purchase. Continue anyway?")
        : true;
      if (!ok) {
        return { abort: true, message: "User cancelled after purchase warning." };
      }
      return { abort: false };
    }
    return { abort: true, message: "Chapter is not public and has not been purchased." };
  }

  function createTelemetry(totalPages, zipDownload) {
    return {
      site: "gigaviewer",
      startedAt: Date.now(),
      totalPages,
      zipDownload: !!zipDownload,
      pages: [],
      failures: [],
      retries: 0
    };
  }

  function createPageLog(index, page) {
    return {
      index,
      src: page?.src || "",
      status: "pending",
      attempts: [],
      error: null,
      durationMs: 0
    };
  }

  function resolveAbsoluteUrl(value, base = null) {
    if (!value) return null;
    try {
      if (base) {
        return new URL(value, base).href;
      }
      if (typeof location !== "undefined" && location?.href) {
        return new URL(value, location.href).href;
      }
      return new URL(value).href;
    } catch {
      return null;
    }
  }

  function isSameDocumentUrl(targetUrl) {
    try {
      if (typeof location === "undefined") return false;
      const resolved = new URL(targetUrl, location.href).href;
      return resolved === location.href;
    } catch {
      return false;
    }
  }

  function parseHtmlDocument(html, type = "text/html") {
    if (!html || typeof DOMParser === "undefined") return null;
    try {
      const parser = new DOMParser();
      return parser.parseFromString(html, type);
    } catch {
      return null;
    }
  }

  async function loadDocumentForUrl(targetUrl) {
    const normalized = resolveAbsoluteUrl(targetUrl);
    if (normalized && isSameDocumentUrl(normalized) && typeof document !== "undefined") {
      return { doc: document, html: document.documentElement?.outerHTML || "" };
    }
    if (typeof fetch !== "function") {
      return { doc: null, html: "" };
    }
    try {
      const response = await fetch(normalized, { credentials: "include" });
      if (!response.ok) {
        return { doc: null, html: "" };
      }
      const html = await response.text();
      return { doc: parseHtmlDocument(html), html };
    } catch {
      return { doc: null, html: "" };
    }
  }

  function extractSeriesTitleFromDocument(doc) {
    if (!doc) return "";
    const selectors = [
      "[data-series-title]",
      ".series-header-title",
      ".series-title",
      ".series-info h1",
      "header h1",
      "h1",
      "h2"
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const text = node?.textContent?.trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  function isLikelyGigaEpisodeUrl(candidate, baseUrl = null) {
    if (!candidate) return false;
    try {
      const url = new URL(candidate, baseUrl || (typeof location !== "undefined" ? location.href : undefined));
      const path = url.pathname.toLowerCase();
      if (path.includes("/episode/") || path.includes("/viewer/")) {
        return true;
      }
      if (url.searchParams.has("episode") || url.searchParams.has("content") || url.searchParams.has("cid")) {
        return true;
      }
      if (path.endsWith(".json") && path.includes("episode")) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function nodeIndicatesLocked(node) {
    if (!node) return false;
    const attr = (node.getAttribute?.("aria-disabled") || node.getAttribute?.("data-disabled") || "").toLowerCase();
    if (attr === "true" || attr === "1") return true;
    const purchase = (node.getAttribute?.("data-requires-purchase") || node.dataset?.purchaseRequired || "").toLowerCase();
    if (purchase === "true" || purchase === "1") return true;
    const premium = (node.getAttribute?.("data-premium") || node.dataset?.premium || "").toLowerCase();
    if (premium === "true") return true;
    const className = typeof node.className === "string" ? node.className.toLowerCase() : "";
    if (/locked|disabled|premium|soldout/.test(className)) return true;
    return false;
  }

  function collectDomChapterLinks(doc, baseUrl) {
    if (!doc) return [];
    const selectors = [
      "[data-episode-id]",
      "[data-episode-url]",
      "[data-chapter-id]",
      "[data-chapter-url]",
      "[data-next-episode-url]",
      "a[data-episode-id]",
      "a[data-episode-url]",
      "a[href*=\"/episode/\"]",
      "a[href*=\"/viewer/\"]",
      "li a[href*=\"/read/\"]",
      "option[data-episode-url]",
      "option[value*=\"/episode/\"]",
      "button[data-episode-url]"
    ];
    const nodes = new Set();
    for (const selector of selectors) {
      doc.querySelectorAll(selector).forEach((node) => nodes.add(node));
    }
    const seen = new Set();
    const entries = [];
    let unnamed = 0;
    for (const node of nodes) {
      if (!node) {
        continue;
      }
      const dataset = node.dataset || {};
      const href =
        node.getAttribute?.("data-episode-url") ||
        dataset.episodeUrl ||
        dataset.href ||
        dataset.url ||
        node.getAttribute?.("href") ||
        node.getAttribute?.("value") ||
        node.getAttribute?.("data-href");
      const resolved = resolveAbsoluteUrl(href, baseUrl);
      if (!resolved || !isLikelyGigaEpisodeUrl(resolved, baseUrl)) {
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
      entries.push({
        id: resolved,
        title,
        viewerId: "gigaviewer",
        accessible: !nodeIndicatesLocked(node)
      });
    }
    return entries;
  }

  function findAtomFeedUrl(doc, baseUrl) {
    if (!doc) return null;
    const link = doc.querySelector('link[rel="alternate"][type*="atom"], link[type*="atom"]');
    if (!link) return null;
    const href = link.getAttribute("href") || link.getAttribute("data-href");
    return resolveAbsoluteUrl(href, baseUrl);
  }

  async function fetchAtomFeedChapters(feedUrl) {
    if (!feedUrl || typeof fetch !== "function") return [];
    try {
      const response = await fetch(feedUrl, { credentials: "include" });
      if (!response.ok) return [];
      const xmlText = await response.text();
      return parseAtomFeedEntries(xmlText, feedUrl);
    } catch {
      return [];
    }
  }

  function parseAtomFeedEntries(xmlText, baseUrl) {
    const doc = parseHtmlDocument(xmlText, "text/xml");
    if (!doc) return [];
    const entries = [];
    let unnamed = 0;
    for (const entry of doc.querySelectorAll("entry")) {
      const linkEl = entry.querySelector("link[href]") || entry.querySelector("link");
      const href = linkEl?.getAttribute?.("href") || linkEl?.textContent || entry.querySelector("id")?.textContent;
      const resolved = resolveAbsoluteUrl(href, baseUrl);
      if (!resolved || !isLikelyGigaEpisodeUrl(resolved, baseUrl)) {
        continue;
      }
      let title = entry.querySelector("title")?.textContent?.trim() || "";
      if (!title) {
        unnamed += 1;
        title = `Episode ${unnamed}`;
      }
      const locked = /purchase|required/i.test(entry.textContent || "");
      entries.push({
        id: resolved,
        title,
        viewerId: "gigaviewer",
        accessible: !locked
      });
    }
    return entries;
  }

  async function isGigaViewerPage(url = location.href) {
    try {
      const dom = findEpisodeJsonInDOM();
      if (dom?.readableProduct) {
        const domPages = extractPageList(dom) || [];
        if (Array.isArray(domPages) && domPages.length > 0) {
          return true;
        }
      }
    } catch { }
    if (!shouldFetchEpisodeJson(url)) {
      return false;
    }
    let json = null;
    try {
      json = await fetchEpisodeJson(url);
    } catch { }
    if (!json?.readableProduct) return false;
    const pages = extractPageList(json) || [];
    return Array.isArray(pages) && pages.length > 0;
  }

  async function downloadEpisode(episodeUrl, options = {}) {
    const {
      saveMetadata = false,
      onlyFirst = false,
      purchaseBehavior = "halt",
      credentials = null,
      zipDownload = false,
      loginCookies = null
    } = options || {};

    if (Array.isArray(loginCookies) && loginCookies.length) {
      applyLoginCookies(loginCookies);
    }

    await loginIfNeeded(episodeUrl, credentials);

    let episodeData = null;
    try {
      const samePage = typeof location !== "undefined" && new URL(episodeUrl, location.href).href === location.href;
      if (samePage) {
        episodeData = findEpisodeJsonInDOM();
      }
    } catch { }
    if (!episodeData) {
      episodeData = await fetchEpisodeJson(episodeUrl);
    }
    if (!episodeData?.readableProduct) throw new Error("No readableProduct found. Are you logged in?");

    const rp = episodeData.readableProduct;
    const rawPages = extractPageList(episodeData);
    if (!rawPages.length) throw new Error("No pages in pageStructure.pages");

    const purchaseOutcome = shouldAbortOnPurchase(rp, purchaseBehavior);
    if (purchaseOutcome.abort) {
      return {
        status: "aborted",
        reason: "purchase",
        message: purchaseOutcome.message || "Chapter is not public and has not been purchased."
      };
    }

    const seriesTitle = sanitizeName(rp.series?.title ?? rp.title, "series");
    const title = sanitizeName(rp.title, "episode");
    const totalPages = rawPages.length;
    const telemetry = createTelemetry(totalPages, zipDownload);

    const metadataEntry = saveMetadata ? await buildMetadataEntry(seriesTitle, title, episodeData) : null;
    const metadataSaved = !!metadataEntry;

    const targetPages = onlyFirst ? rawPages.slice(0, 1) : rawPages;

    const processedPages = await runWithConcurrency(targetPages, TILE_FETCH_CONCURRENCY, async (page, index) => {
      const pageLog = createPageLog(index, page);
      telemetry.pages.push(pageLog);
      const start = performance.now();
      try {
        const buffer = await fetchArrayBuffer(page.src, { telemetry, pageLog });
        const normalized = await normalizePageBytes(buffer, page.type, { telemetry, pageLog, pageMeta: page });
        pageLog.status = "success";
        pageLog.durationMs = performance.now() - start;
        return { index, page, bytes: normalized };
      } catch (err) {
        pageLog.status = "error";
        pageLog.error = String(err?.message || err);
        pageLog.durationMs = performance.now() - start;
        telemetry.failures.push({ index, src: page.src, error: pageLog.error });
        throw err;
      }
    });

    const pages = [];
    const width = String(totalPages).length;
    for (const processed of processedPages.filter(Boolean).sort((a, b) => a.index - b.index)) {
      const bytes = processed.bytes;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const filename = `${seriesTitle}/${title}/${String(processed.index + 1).padStart(width, "0")}.jpg`;
      pages.push({
        kind: "page",
        index: processed.index,
        filename,
        mimeType: "image/jpeg",
        size: bytes.byteLength,
        buffer,
        width: processed.page?.width ?? processed.page?.canvasWidth ?? processed.page?.imageWidth ?? null,
        height: processed.page?.height ?? processed.page?.canvasHeight ?? processed.page?.imageHeight ?? null,
        sourceUrl: processed.page?.src || processed.page?.url || null
      });
    }

    if (metadataEntry) {
      pages.push({
        kind: "metadata",
        index: null,
        filename: metadataEntry.filename,
        mimeType: metadataEntry.mimeType,
        size: metadataEntry.buffer?.byteLength ?? 0,
        buffer: metadataEntry.buffer
      });
    }

    const downloaded = pages.filter((entry) => entry.kind === "page").length;

    telemetry.completedAt = Date.now();
    telemetry.durationMs = telemetry.completedAt - telemetry.startedAt;
    telemetry.pagesDownloaded = downloaded;
    telemetry.zipFilename = null;
    telemetry.zipDownloadId = null;

    let nextUri = null;
    let nextUrl = null;
    if (typeof rp?.nextReadableProductUri === "string" && rp.nextReadableProductUri.trim().length) {
      nextUri = rp.nextReadableProductUri.trim();
      try {
        nextUrl = new URL(nextUri, episodeUrl).href;
      } catch {
        nextUrl = null;
      }
    }

    return {
      status: "success",
      seriesTitle,
      title,
      count: downloaded,
      total: rawPages.length,
      metadataSaved,
      onlyFirst: !!onlyFirst,
      zipDownload: !!zipDownload,
      telemetry,
      pages,
      defaultZipName: `${seriesTitle}-${title}.zip`,
      nextUri,
      nextUrl
    };
  }

  async function listChapters(seriesUrl = location.href) {
    const normalizedUrl = resolveAbsoluteUrl(seriesUrl) || (typeof location !== "undefined" ? location.href : String(seriesUrl || ""));
    const { doc } = await loadDocumentForUrl(normalizedUrl);
    let episodeData = null;
    if (shouldFetchEpisodeJson(normalizedUrl)) {
      try {
        episodeData = await fetchEpisodeJson(normalizedUrl);
      } catch {
        episodeData = null;
      }
    }
    const rp = episodeData?.readableProduct || null;
    let seriesTitle =
      rp?.series?.title ||
      extractSeriesTitleFromDocument(doc) ||
      (doc?.title || "");
    if (!seriesTitle) {
      try {
        const parsed = new URL(normalizedUrl);
        seriesTitle = parsed.hostname.replace(/^www\./i, "");
      } catch {
        seriesTitle = "series";
      }
    }
    seriesTitle = sanitizeName(seriesTitle, "series");

    let chapters = [];
    const feedUrl = findAtomFeedUrl(doc, normalizedUrl);
    if (feedUrl) {
      chapters = await fetchAtomFeedChapters(feedUrl);
    }
    if (!chapters.length) {
      chapters = collectDomChapterLinks(doc, normalizedUrl);
    }
    if (!chapters.length && rp?.nextReadableProductUri) {
      const nextUrl = resolveAbsoluteUrl(rp.nextReadableProductUri, normalizedUrl);
      if (nextUrl) {
        chapters.push({
          id: nextUrl,
          title: sanitizeName("Next Chapter", "episode"),
          viewerId: "gigaviewer",
          accessible: true
        });
      }
    }
    if (!chapters.length) {
      const fallbackTitle = sanitizeName(rp?.title || doc?.title || "Episode", "episode");
      chapters.push({
        id: normalizedUrl,
        title: fallbackTitle,
        viewerId: "gigaviewer",
        accessible: true
      });
    }
    return {
      viewerId: "gigaviewer",
      seriesTitle,
      chapters
    };
  }

  async function runOnePageDiagnostic(url = location.href) {
    const result = await downloadEpisode(url, {
      saveMetadata: false,
      onlyFirst: true,
      purchaseBehavior: "ignore",
      zipDownload: false
    });
    if (!result || result.status !== "success") {
      throw new Error(result?.message || "Diagnostic download failed");
    }
    const first = Array.isArray(result.pages)
      ? result.pages.find((entry) => entry && entry.kind === "page")
      : null;
    if (!first) {
      throw new Error("Diagnostic did not produce a page buffer");
    }
    let buffer = null;
    if (first.buffer instanceof ArrayBuffer) {
      buffer = first.buffer;
    } else if (ArrayBuffer.isView(first.buffer)) {
      const view = first.buffer;
      buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    } else if (Array.isArray(first.buffer)) {
      buffer = Uint8Array.from(first.buffer).buffer;
    } else if (first.bytes instanceof ArrayBuffer) {
      buffer = first.bytes;
    } else if (ArrayBuffer.isView(first.bytes)) {
      const view = first.bytes;
      buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    } else if (Array.isArray(first.bytes)) {
      buffer = Uint8Array.from(first.bytes).buffer;
    }
    if (!buffer) {
      throw new Error("Diagnostic buffer unavailable");
    }
    return { ok: true, bytes: buffer.byteLength || 0 };
  }

  function extractEpisodePayloadFromInput(input) {
    if (input && typeof input === "object") {
      if (input.readableProduct) {
        return input;
      }
      if (input.episodeJson?.readableProduct) {
        return input.episodeJson;
      }
      if (input.probeResult?.readableProduct) {
        return input.probeResult;
      }
      if (input.probe?.readableProduct) {
        return input.probe;
      }
    }
    return null;
  }

  function resolveEpisodeUrlFromInput(input) {
    if (typeof input === "string" && input.trim()) {
      return input.trim();
    }
    if (!input || typeof input !== "object") {
      return null;
    }
    const candidates = [
      input.url,
      input.href,
      input.pageUrl,
      input.episodeUrl,
      input.chapterUrl,
      input.id,
      input.chapter?.url,
      input.chapter?.id
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  async function loadEpisodeJsonForInput(input) {
    const existing = extractEpisodePayloadFromInput(input);
    if (existing?.readableProduct) {
      return existing;
    }
    let targetUrl = resolveEpisodeUrlFromInput(input);
    if (!targetUrl && typeof location !== "undefined" && location.href) {
      targetUrl = location.href;
    }
    if (!targetUrl) {
      const domFallback = findEpisodeJsonInDOM();
      return domFallback?.readableProduct ? domFallback : null;
    }
    let normalized = targetUrl;
    try {
      normalized = new URL(targetUrl, typeof location !== "undefined" ? location.href : undefined).href;
    } catch { }
    if (typeof location !== "undefined") {
      try {
        if (location.href && normalized === location.href) {
          const domPayload = findEpisodeJsonInDOM();
          if (domPayload?.readableProduct) {
            return domPayload;
          }
        }
      } catch { }
    }
    try {
      return await fetchEpisodeJson(normalized);
    } catch {
      try {
        return await fetchEpisodeJson(targetUrl);
      } catch {
        return null;
      }
    }
  }

  async function listPages(input = location.href) {
    try {
      const episodeData = await loadEpisodeJsonForInput(input);
      if (!episodeData) {
        return [];
      }
      const pages = extractPageList(episodeData);
      if (!Array.isArray(pages) || !pages.length) {
        throw new Error("No pages extracted from episode JSON.");
      }
      return pages;
    } catch {
      return [];
    }
  }

  const module = {
    id: "gigaviewer",
    displayName: "GigaViewer",
    detect: async (url = location.href) => isGigaViewerPage(url),
    probe: async (url = location.href) => {
      const dom = findEpisodeJsonInDOM();
      if (dom?.readableProduct) return dom;
      if (!shouldFetchEpisodeJson(url)) {
        return null;
      }
      return await fetchEpisodeJson(url);
    },
    listPages,
    listChapters,
    fetchPage: async (page, ctx = {}) => {
      const pageLog = ctx.pageLog || createPageLog(ctx.index ?? 0, page);
      const start = performance.now();
      try {
        const buffer = await fetchArrayBuffer(page.src, { telemetry: ctx.telemetry, pageLog });
        const normalized = await normalizePageBytes(buffer, page.type, { telemetry: ctx.telemetry, pageLog, pageMeta: page });
        pageLog.status = "success";
        pageLog.durationMs = performance.now() - start;
        return { bytes: normalized, mimeType: "image/jpeg" };
      } catch (err) {
        pageLog.status = "error";
        pageLog.error = String(err?.message || err);
        pageLog.durationMs = performance.now() - start;
        throw err;
      }
    },
    downloadEpisode,
    runOnePageDiagnostic
  };

  module.pathLooksLikeGV = pathLooksLikeGV;
  module.findEpisodeJsonInDOM = findEpisodeJsonInDOM;
  module.fetchEpisodeJson = fetchEpisodeJson;
  module.extractPageList = extractPageList;
  module.isGigaViewerPage = isGigaViewerPage;

  registerSiteModule(module);
  root.UnshackleGV = module;
  root.UnshackleGVDetect = module;
  module.downloadGVEpisode = downloadEpisode;
  root.UnshackleGVOnePageDiagnostic = runOnePageDiagnostic;
})();
