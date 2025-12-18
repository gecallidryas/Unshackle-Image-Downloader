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

  const API_BASE = "https://www.lezhinus.com";
  const CDN_FALLBACK = "https://rcdn.lezhin.com";
  const IMAGE_QUALITY = 40;
  const SITE_ID = "lezhin";
  const TOKEN_CACHE = new Map();

  const SUPPORTED_SITES = [
    { key: "en", locale: "en-US", cookieLocale: "en_US", pathSegment: "en", hosts: [/(?:^|\.)lezhinus\.com$/i] },
    { key: "ja", locale: "ja-JP", cookieLocale: "ja_JP", pathSegment: "ja", hosts: [/(?:^|\.)lezhin\.jp$/i] },
    { key: "ko", locale: "ko-KR", cookieLocale: "ko_KR", pathSegment: "ko", hosts: [/(?:^|\.)lezhin\.com$/i] }
  ];

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function runWithConcurrency(items, concurrency, fn) {
    const list = Array.from(items || []);
    if (!list.length) return Promise.resolve([]);
    const limit = Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : 1);
    const results = new Array(list.length);
    let nextIndex = 0;
    let rejected = false;

    const worker = async () => {
      while (!rejected) {
        const current = nextIndex++;
        if (current >= list.length) return;
        try {
          results[current] = await fn(list[current], current, list);
        } catch (err) {
          rejected = true;
          throw err;
        }
      }
    };

    const workers = [];
    const count = Math.min(limit, list.length);
    for (let i = 0; i < count; i++) workers.push(worker());
    return Promise.all(workers).then(() => results);
  }

  function sanitizeName(value, fallback) {
    const str = String(value ?? "").trim();
    if (!str) return fallback || "episode";
    return str.replace(/[\\/:*?"<>|]+/g, "_").trim() || fallback || "episode";
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

  async function buildMetadataEntry(seriesTitle, title, data) {
    try {
      const encoder = new TextEncoder();
      const text = JSON.stringify(data, null, 2);
      const bytes = encoder.encode(text);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        filename: `${seriesTitle}/${title}/metadata.json`,
        mimeType: "application/json",
        buffer
      };
    } catch {
      return null;
    }
  }

  function createTelemetry(totalPages, zipDownload) {
    return {
      site: SITE_ID,
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
      src: page?.path || page?.src || "",
      status: "pending",
      attempts: [],
      error: null,
      durationMs: 0
    };
  }

  function matchHost(host, entry) {
    return entry.hosts.some((regex) => regex.test(host));
  }

  function inferSiteFromUrl(url = location.href) {
    try {
      const u = new URL(url, location.href);
      const host = u.hostname.toLowerCase();
      const segments = u.pathname.split("/").filter(Boolean);
      const lang = segments[0] ? segments[0].toLowerCase() : "";
      let site = null;
      for (const entry of SUPPORTED_SITES) {
        if (lang === entry.pathSegment.toLowerCase() && matchHost(host, entry)) {
          site = entry;
          break;
        }
      }
      if (!site) return null;
      let alias = null;
      let chapterId = null;
      if (segments[1] && segments[1].toLowerCase() === "comic") {
        alias = segments[2] || null;
        const maybeChapter = segments[3] || null;
        if (maybeChapter && !["viewer", "list"].includes(maybeChapter.toLowerCase())) {
          chapterId = maybeChapter;
        } else if (segments[4] && segments[3] && segments[3].toLowerCase() === "detail") {
          chapterId = segments[4];
        }
      }
      const search = u.searchParams;
      if (!chapterId) {
        chapterId = search.get("name") || search.get("episode") || search.get("chapter") || null;
      }
      return {
        site,
        locale: site.locale,
        cookieLocale: site.cookieLocale,
        langSegment: site.pathSegment,
        origin: u.origin,
        alias: alias || null,
        chapterId: chapterId || null,
        href: u.href
      };
    } catch {
      return null;
    }
  }

  async function waitForValue(getter, timeout = 4000, interval = 120) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const value = getter();
        if (value != null) return value;
      } catch {}
      await delay(interval);
    }
    return null;
  }

  const getRuntimeConfig = () => waitForValue(() => root.__LZ_CONFIG__ ?? null, 5000, 150);
  const getProductData = () => waitForValue(() => root.__LZ_PRODUCT__ ?? null, 5000, 150);

  function isChapterAccessible(chapter) {
    if (!chapter) return false;
    if (chapter.purchased) return true;
    if (chapter.coin === 0) return true;
    const now = Date.now();
    const freed = chapter.freedAt ? Number(chapter.freedAt) : null;
    if (Number.isFinite(freed) && freed <= now) return true;
    const prefree = chapter.prefree && chapter.prefree.closeTimer ? Number(chapter.prefree.closeTimer.expiredAt) : null;
    if (Number.isFinite(prefree) && prefree > now) return true;
    return false;
  }

  function formatChapterTitle(chapter) {
    if (!chapter || !chapter.display) return chapter?.name || "Episode";
    const prefix = chapter.display.displayName || "";
    const suffix = chapter.display.title || "";
    if (prefix && suffix) return `${prefix} - ${suffix}`;
    return prefix || suffix || chapter.name || "Episode";
  }

  function resolveAliasFromProduct(product) {
    if (!product) return null;
    if (product.alias) return product.alias;
    if (product.product && product.product.alias) return product.product.alias;
    if (product.product && product.product.aliasName) return product.product.aliasName;
    if (product.product && product.product.aliasTitle) return product.product.aliasTitle;
    return null;
  }

  function buildEpisodeUrl(context, chapterId) {
    if (!context) return null;
    const { origin, langSegment, alias } = context;
    if (!origin || !langSegment || !alias || !chapterId) return null;
    return `${origin}/${langSegment}/comic/${alias}/${chapterId}`;
  }

  function buildHeaders(locale, token, cookieLocale, extra = {}) {
    const headers = {
      "x-lz-locale": locale || "en-US",
      "x-cookie": cookieLocale ? `x-lz-locale=${cookieLocale}` : "x-lz-locale=en_US",
      accept: "application/json, text/plain, */*",
      ...extra
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  function getCdnUrl(config) {
    if (!config) return CDN_FALLBACK;
    if (config.contentsCdnUrl) return config.contentsCdnUrl;
    if (config.contentsCdnUrls && config.contentsCdnUrls.default) return config.contentsCdnUrls.default;
    return CDN_FALLBACK;
  }

  function mapChapterList(product, context) {
    const list = [];
    const entries = Array.isArray(product?.all) ? product.all : [];
    const alias = resolveAliasFromProduct(product) || context.alias;
    const locale = context.locale;
    for (const entry of entries) {
      if (!entry?.name) continue;
      const accessible = isChapterAccessible(entry);
      const url = buildEpisodeUrl({ ...context, alias }, entry.name);
      list.push({
        id: entry.name,
        alias,
        locale,
        title: formatChapterTitle(entry),
        purchased: !!entry.purchased,
        accessible,
        coins: entry.coin ?? null,
        freedAt: entry.freedAt ?? null,
        url,
        raw: {
          display: entry.display || null,
          publishedAt: entry.publishedAt ?? null
        }
      });
    }
    return list;
  }

  function findChapterMeta(product, chapterId) {
    if (!chapterId) return null;
    const entries = Array.isArray(product?.all) ? product.all : [];
    return entries.find((entry) => entry && entry.name === chapterId) || null;
  }

  async function buildContext(url = location.href, opts = {}) {
    const info = typeof url === "object" && url?.site ? url : inferSiteFromUrl(url);
    if (!info) throw new Error("Lezhin page not detected.");
    const product = opts.skipProduct ? null : await getProductData();
    const config = await getRuntimeConfig();
    const alias = info.alias || resolveAliasFromProduct(product?.product || product) || resolveAliasFromProduct(product) || null;
    if (!alias) throw new Error("Unable to determine comic alias. Open the comic overview page first.");
    const locale = info.locale;
    return {
      ...info,
      alias,
      product,
      config,
      locale,
      cookieLocale: info.cookieLocale,
      cdnUrl: getCdnUrl(config),
      token: config?.token || null
    };
  }

  async function fetchInventory(context, chapterIdOverride = null) {
    const alias = context.alias;
    const chapterId = chapterIdOverride || context.chapterId;
    if (!alias || !chapterId) throw new Error("Missing alias or chapter id.");
    const params = new URLSearchParams({
      platform: "web",
      store: "web",
      alias,
      name: chapterId,
      preload: "false",
      type: "comic_episode"
    });
    const url = new URL("/lz-api/v2/inventory_groups/comic_viewer", API_BASE);
    url.search = params.toString();
    const headers = buildHeaders(context.locale, context.token, context.cookieLocale);
    const res = await fetch(url.href, { headers, credentials: "include" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Inventory request failed (${res.status}) ${text}`);
    }
    return res.json();
  }

  function extractPageDescriptors(inventory) {
    const episode = inventory?.data?.extra?.episode;
    if (!episode) return [];
    const pages = Array.isArray(episode.pagesInfo)
      ? episode.pagesInfo
      : Array.isArray(episode.scrollsInfo)
        ? episode.scrollsInfo
        : [];
    return pages.map((entry, index) => ({
      index,
      path: entry?.path || entry?.url || entry?.src || "",
      width: entry?.width ?? entry?.imageWidth ?? entry?.canvasWidth ?? null,
      height: entry?.height ?? entry?.imageHeight ?? entry?.canvasHeight ?? null
    })).filter((entry) => entry.path);
  }

  function signedUrlCacheKey(episodeId, path, purchased) {
    return `${episodeId}:${path}:${purchased ? "1" : "0"}`;
  }

  async function generateSignedUrl(context, inventory, path, purchased) {
    const episode = inventory?.data?.extra?.episode;
    if (!episode) throw new Error("Episode metadata missing.");
    const cacheKey = signedUrlCacheKey(episode.id, path, purchased);
    const now = Date.now();
    const cached = TOKEN_CACHE.get(cacheKey);
    if (cached && now - cached.timestamp < 30000) {
      return cached.url;
    }
    const tokenUrl = new URL("/lz-api/v2/cloudfront/signed-url/generate", API_BASE);
    tokenUrl.search = new URLSearchParams({
      contentId: episode.idComic,
      episodeId: episode.id,
      purchased: purchased ? "true" : "false",
      q: IMAGE_QUALITY,
      firstCheckType: "P"
    }).toString();
    const headers = buildHeaders(context.locale, context.token, context.cookieLocale, { "x-referer": API_BASE });
    const response = await fetch(tokenUrl.href, { headers, credentials: "include" });
    if (!response.ok) {
      throw new Error(`Token request failed (${response.status})`);
    }
    const token = await response.json();
    const ext = context.forceJpeg ? ".jpg" : ".webp";
    const imageUrl = new URL(`/v2${path}${ext}`, context.cdnUrl || CDN_FALLBACK);
    imageUrl.search = new URLSearchParams({
      purchased: purchased ? "true" : "false",
      q: IMAGE_QUALITY,
      updated: episode.updatedAt || "",
      Policy: token.data?.Policy || "",
      Signature: token.data?.Signature || "",
      "Key-Pair-Id": token.data?.["Key-Pair-Id"] || ""
    }).toString();
    const finalUrl = imageUrl.href;
    TOKEN_CACHE.set(cacheKey, { timestamp: now, url: finalUrl });
    return finalUrl;
  }

  async function fetchImageBuffer(page, context, inventory, telemetry, index) {
    const purchased = !!(inventory?.data?.extra?.subscribed || context.chapterPurchased);
    const url = await generateSignedUrl(context, inventory, page.path, purchased);
    const headers = buildHeaders(context.locale, context.token, context.cookieLocale, {
      Referer: context.href || context.origin || API_BASE,
      "x-referer": context.origin || API_BASE
    });
    const log = createPageLog(index, page);
    telemetry.pages.push(log);
    const start = performance.now();
    try {
      const res = await fetch(url, { headers, credentials: "include" });
      if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
      let blob = await res.blob();
      const scrambled = !!(inventory?.data?.extra?.comic?.metadata?.imageShuffle);
      if (scrambled) {
        blob = await descrambleImage(blob, inventory?.data?.extra?.episode?.id);
      }
      const buffer = await blob.arrayBuffer();
      log.status = "success";
      log.durationMs = performance.now() - start;
      return { buffer, size: blob.size, url };
    } catch (error) {
      log.status = "error";
      log.error = String(error?.message || error);
      log.durationMs = performance.now() - start;
      telemetry.failures.push({ index, src: page.path, error: log.error });
      throw error;
    }
  }

  async function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      }, type, quality);
    });
  }

  async function getBitmap(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const cleanup = () => {
        if (img.src.startsWith("blob:")) {
          URL.revokeObjectURL(img.src);
        }
      };
      img.onload = () => {
        cleanup();
        resolve(img);
      };
      img.onerror = (err) => {
        cleanup();
        reject(err);
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  async function descrambleImage(blob, episodeId) {
    if (!blob) return blob;
    const bitmap = await getBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    let scrambleTable = generateScrambleTable(episodeId, 5);
    const divisions = Math.floor(Math.sqrt(scrambleTable.length));
    const dimensions = { width: canvas.width, height: canvas.height };
    scrambleTable = addLength(scrambleTable);
    scrambleTable = createSuperArray(scrambleTable);

    const pieces = scrambleTable.map((entry) => {
      const n = parseInt(entry[0], 10);
      const r = entry[1];
      return { from: calculatePieces(dimensions, divisions, n), to: calculatePieces(dimensions, divisions, r) };
    }).filter((entry) => entry.from && entry.to);

    for (const piece of pieces) {
      ctx.drawImage(
        bitmap,
        piece.to.left,
        piece.to.top,
        piece.to.width,
        piece.to.height,
        piece.from.left,
        piece.from.top,
        piece.from.width,
        piece.from.height
      );
    }

    if (bitmap.close) {
      try { bitmap.close(); } catch {}
    }
    const outBlob = await canvasToBlob(canvas, blob.type || "image/jpeg", 0.95);
    return outBlob || blob;
  }

  function generateScrambleTable(episodeId, size) {
    return episodeId ? new Randomizer(episodeId, size).get() : [];
  }

  function addLength(table) {
    return [].concat(table, [table.length, table.length + 1]);
  }

  function createSuperArray(array) {
    return Array(array.length).fill().map((_, index) => [index.toString(), array[index]]);
  }

  function calculatePieces(dimensions, divisions, n) {
    const total = divisions * divisions;
    if (n < total) {
      const left = (n % divisions);
      const top = Math.floor(n / divisions);
      const width = Math.floor(dimensions.width / divisions);
      const height = Math.floor(dimensions.height / divisions);
      return {
        left: left * width,
        top: top * height,
        width,
        height
      };
    }
    if (n === total) {
      const remainder = dimensions.width % divisions;
      if (!remainder) return null;
      return {
        left: dimensions.width - remainder,
        top: 0,
        width: remainder,
        height: dimensions.height
      };
    }
    const remainder = dimensions.height % divisions;
    if (!remainder) return null;
    return {
      left: 0,
      top: dimensions.height - remainder,
      width: dimensions.width - (dimensions.width % divisions),
      height: remainder
    };
  }

  function Randomizer(seed, size) {
    if (!(this instanceof Randomizer)) return new Randomizer(seed, size);
    this.seed = seed;
    this.state = BigInt(this.seed);
    const area = size * size;
    const order = Array.from({ length: area }, (_, idx) => idx);
    for (let idx = 0; idx < order.length; idx++) {
      const rand = this.random(area);
      const tmp = order[idx];
      order[idx] = order[rand];
      order[rand] = tmp;
    }
    this.order = order;
  }

  Randomizer.prototype.random = function(max) {
    const BIGT = BigInt(max);
    const big12 = BigInt(12);
    const big25 = BigInt(25);
    const big27 = BigInt(27);
    const big32 = BigInt(32);
    const mask = BigInt("18446744073709551615");
    let state = this.state;
    state = state ^ (state >> big12);
    const shifter = (state << big25) & mask;
    state = state ^ shifter;
    state = state ^ (state >> big27);
    this.state = state & mask;
    return Number((state >> big32) % BIGT);
  };

  Randomizer.prototype.get = function() {
    return this.order;
  };

  async function listChapters(url = location.href) {
    const context = await buildContext(url);
    if (!context.product) {
      throw new Error("Chapter list not available yet. Open the comic overview page and wait for it to load.");
    }
    const list = mapChapterList(context.product, context);
    return {
      viewerId: SITE_ID,
      alias: context.alias,
      locale: context.locale,
      seriesTitle: sanitizeName(
        context.product?.product?.title || context.product?.title || context.alias,
        context.alias
      ),
      chapters: list
    };
  }

  async function detect(url = location.href) {
    return !!inferSiteFromUrl(url);
  }

  async function probe(url = location.href) {
    const context = await buildContext(url, { skipProduct: true });
    if (!context.chapterId) return null;
    const inventory = await fetchInventory(context);
    const pages = extractPageDescriptors(inventory);
    if (!pages.length) return null;
    return { context: { alias: context.alias, chapterId: context.chapterId }, pages };
  }

  function listPages(probeResult) {
    if (!probeResult?.pages) return [];
    return probeResult.pages.map((entry) => ({
      kind: "page",
      src: entry.path
    }));
  }

  function shouldAbortOnPurchase(chapterMeta, behavior) {
    if (!chapterMeta) return { abort: false };
    if (isChapterAccessible(chapterMeta)) return { abort: false };
    if (behavior === "ignore") return { abort: false };
    if (behavior === "prompt" && typeof root.confirm === "function") {
      const ok = root.confirm("This chapter appears to be locked. Continue anyway?");
      return { abort: !ok, message: ok ? null : "User cancelled after purchase warning." };
    }
    return { abort: true, message: "Chapter is locked. Purchase or unlock it on Lezhin first." };
  }

  async function downloadEpisode(episodeUrl, options = {}) {
    const {
      saveMetadata = false,
      onlyFirst = false,
      purchaseBehavior = "halt",
      zipDownload = false,
      alias: aliasOverride = null,
      chapterId: chapterIdOverride = null,
      chapterMeta: chapterMetaOverride = null,
      forceJpeg = false,
      loginCookies = null
    } = options || {};
    if (Array.isArray(loginCookies) && loginCookies.length) {
      applyLoginCookies(loginCookies);
    }
    const context = await buildContext(episodeUrl, {});
    if (aliasOverride) context.alias = aliasOverride;
    if (chapterIdOverride) context.chapterId = chapterIdOverride;
    context.forceJpeg = !!forceJpeg;
    if (!context.chapterId) throw new Error("Unable to determine chapter id from the URL. Use the chapter list to pick one.");
    const product = context.product || await getProductData();
    const chapterMeta = chapterMetaOverride || findChapterMeta(product, context.chapterId);
    const purchaseGate = shouldAbortOnPurchase(chapterMeta, purchaseBehavior);
    if (purchaseGate.abort) {
      return { status: "aborted", reason: "purchase", message: purchaseGate.message };
    }
    context.chapterPurchased = !!chapterMeta?.purchased;

    const inventory = await fetchInventory(context);
    const pageDescriptors = extractPageDescriptors(inventory);
    if (!pageDescriptors.length) throw new Error("This chapter does not expose any pages.");
    const targetPages = onlyFirst ? pageDescriptors.slice(0, 1) : pageDescriptors;
    const seriesTitleRaw = product?.product?.title || product?.title || context.alias;
    const chapterTitleRaw = chapterMeta ? formatChapterTitle(chapterMeta) : context.chapterId;
    const seriesTitle = sanitizeName(seriesTitleRaw, context.alias);
    const chapterTitle = sanitizeName(chapterTitleRaw, context.chapterId);
    const telemetry = createTelemetry(pageDescriptors.length, zipDownload);

    const processed = await runWithConcurrency(targetPages, 4, async (page, index) => {
      return await fetchImageBuffer(page, context, inventory, telemetry, index);
    });

    const pages = [];
    const padding = String(pageDescriptors.length).length;
    processed.forEach((entry, idx) => {
      if (!entry) return;
      const descriptor = targetPages[idx] || pageDescriptors[idx];
      const filename = `${seriesTitle}/${chapterTitle}/${String(idx + 1).padStart(padding, "0")}.${context.forceJpeg ? "jpg" : "webp"}`;
      pages.push({
        kind: "page",
        index: idx,
        filename,
        mimeType: context.forceJpeg ? "image/jpeg" : "image/webp",
        size: entry.size || entry.buffer?.byteLength || 0,
        buffer: entry.buffer,
        width: descriptor?.width ?? null,
        height: descriptor?.height ?? null,
        sourceUrl: entry.url
      });
    });

    let metadataSaved = false;
    if (saveMetadata) {
      const meta = await buildMetadataEntry(seriesTitle, chapterTitle, {
        viewer: SITE_ID,
        alias: context.alias,
        chapterId: context.chapterId,
        locale: context.locale,
        sourceUrl: episodeUrl,
        downloadedAt: new Date().toISOString(),
        totalPages: pageDescriptors.length
      });
      if (meta) {
        metadataSaved = true;
        pages.push({
          kind: "metadata",
          filename: meta.filename,
          mimeType: meta.mimeType,
          size: meta.buffer?.byteLength ?? 0,
          buffer: meta.buffer
        });
      }
    }

    telemetry.completedAt = Date.now();
    telemetry.durationMs = telemetry.completedAt - telemetry.startedAt;
    telemetry.pagesDownloaded = pages.filter((entry) => entry.kind === "page").length;

    return {
      status: "success",
      seriesTitle,
      title: chapterTitle,
      count: telemetry.pagesDownloaded,
      total: pageDescriptors.length,
      metadataSaved,
      onlyFirst: !!onlyFirst,
      zipDownload: !!zipDownload,
      telemetry,
      pages,
      defaultZipName: `${seriesTitle}-${chapterTitle}.zip`
    };
  }

  const module = {
    id: SITE_ID,
    displayName: "Lezhin",
    detect,
    probe,
    listPages,
    downloadEpisode,
    listChapters
  };

  registerSiteModule(module);
  root.UnshackleLezhin = module;
})();
