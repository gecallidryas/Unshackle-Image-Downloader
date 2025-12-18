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

  const MODULE_ID = "foolslide";
  const MODULE_NAME = "FoolSlide";

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
      throw new Error(`FoolSlide fetch failed (${res.status})`);
    }
    const text = await res.text();
    return new DOMParser().parseFromString(text, "text/html");
  }

  async function detect(url = location.href) {
    try {
      const doc = document;
      if (doc?.querySelector("body.foolslide") || doc?.querySelector("#chapter-list")) {
        return true;
      }
      const hostname = new URL(url).hostname;
      return /reader|foolslide/i.test(hostname);
    } catch {
      return false;
    }
  }

  async function listChapters(seriesUrl = location.href) {
    const doc = await fetchDocument(seriesUrl);
    const nodes = doc.querySelectorAll("#chapter-list li a, table.table td a");
    if (!nodes.length) {
      throw new Error("FoolSlide chapter list is empty.");
    }
    const seriesTitle = sanitizeFilename(
      doc.querySelector(".title h2, .series-title h1, h1[itemprop='name']")?.textContent || "series",
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
    const images = Array.from(doc.querySelectorAll("#image-container img, .page img"));
    if (!images.length) {
      throw new Error("FoolSlide chapter exposes no readable pages.");
    }
    return images
      .map((img, index) => {
        const src = img.getAttribute("data-src") || img.getAttribute("src");
        if (!src) return null;
        const pageNum = String(index + 1).padStart(3, "0");
        const filename = `${sanitizeFilename(doc.querySelector(".title h2")?.textContent || "chapter")}/Page_${pageNum}.jpg`;
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
