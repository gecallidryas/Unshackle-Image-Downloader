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

  const MODULE_ID = "mangastream";
  const MODULE_NAME = "Mangastream";

  function sanitizeFilename(value, fallback = "chapter") {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    return text.replace(/[\\/:*?"<>|]+/g, "_");
  }

  function resolveUrl(url, base = location.href) {
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  async function fetchDocument(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`Mangastream fetch failed (${res.status})`);
    }
    const text = await res.text();
    return new DOMParser().parseFromString(text, "text/html");
  }

  function extractImageSource(img) {
    if (!img) return null;
    return (
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("srcset") ||
      img.getAttribute("src") ||
      null
    );
  }

  async function detect(url = location.href) {
    try {
      const doc = document;
      if (doc?.body?.classList?.contains("wp-mangastream-theme")) {
        return true;
      }
      const hostname = new URL(url).hostname;
      return /(mangastream|readmanga|mangax)/i.test(hostname);
    } catch {
      return false;
    }
  }

  async function listChapters(seriesUrl = location.href) {
    const doc = await fetchDocument(seriesUrl);
    const nodes = doc.querySelectorAll(".listing-chapters_wrap li a, .chapter-list li a");
    if (!nodes.length) {
      throw new Error("Mangastream chapter list is empty.");
    }
    const seriesTitle = sanitizeFilename(
      doc.querySelector(".post-title h1, .manga-title h1, .series-title")?.textContent || "series",
      "series"
    );
    const chapters = Array.from(nodes).map((anchor, index) => ({
      id: resolveUrl(anchor.getAttribute("href"), seriesUrl),
      title: anchor.textContent?.trim() || `Chapter ${index + 1}`,
      viewerId: MODULE_ID
    }));
    return {
      viewerId: MODULE_ID,
      seriesTitle,
      chapters
    };
  }

  async function listPages(chapterUrl = location.href) {
    const doc = await fetchDocument(chapterUrl);
    const images = Array.from(doc.querySelectorAll(".reading-content img, .page-break img"));
    if (!images.length) {
      throw new Error("Mangastream chapter exposes no readable pages.");
    }
    return images
      .map((img, index) => {
        const src = extractImageSource(img);
        if (!src) return null;
        const pageNum = String(index + 1).padStart(3, "0");
        const filename = `${sanitizeFilename(doc.querySelector(".post-title h1")?.textContent || "chapter")}/Page_${pageNum}.jpg`;
        return {
          index,
          url: resolveUrl(src, chapterUrl),
          filename
        };
      })
      .filter(Boolean);
  }

  const module = {
    id: MODULE_ID,
    displayName: MODULE_NAME,
    detect,
    listChapters,
    listPages
  };

  registerSiteModule(module);
})();
