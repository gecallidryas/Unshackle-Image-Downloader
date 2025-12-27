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

  const MODULE_ID = "madara";
  const MODULE_NAME = "Madara";

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
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Madara fetch failed (${response.status})`);
    }
    const text = await response.text();
    return new DOMParser().parseFromString(text, "text/html");
  }

  function extractImageSource(img) {
    if (!img) return null;
    const candidates = [
      img.getAttribute("data-src"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("data-original"),
      img.getAttribute("srcset"),
      img.getAttribute("src")
    ];
    const srcset = (candidates.find((val) => val && val.includes(" ")) || "").trim();
    if (srcset) {
      return srcset.split(" ").find((token) => token.startsWith("http")) || srcset.split(" ")[0];
    }
    return candidates.find((val) => typeof val === "string" && val.trim())?.trim() || null;
  }

  async function detect(url = location.href) {
    try {
      const doc = document;
      if (doc?.body?.classList?.contains("madara")) {
        return true;
      }
      const html = doc?.documentElement?.outerHTML || "";
      if (/wp-manga/m.test(html) || /madara-theme/.test(html)) {
        return true;
      }
      const hostname = new URL(url).hostname;
      return /\.manga/.test(hostname);
    } catch {
      return false;
    }
  }

  async function listChapters(seriesUrl = location.href) {
    const doc = await fetchDocument(seriesUrl);
    const seriesTitle = sanitizeFilename(
      doc.querySelector(".post-title h1, .manga-title")?.textContent || "series",
      "series"
    );
    const list = Array.from(doc.querySelectorAll("li.wp-manga-chapter > a")).map((anchor, index) => {
      const href = anchor.getAttribute("href");
      const title = anchor.textContent?.trim() || `Chapter ${index + 1}`;
      return {
        id: resolveUrl(href, seriesUrl),
        title,
        viewerId: MODULE_ID
      };
    });
    if (!list.length) {
      throw new Error("Madara chapter list is empty.");
    }
    return {
      viewerId: MODULE_ID,
      seriesTitle,
      chapters: list
    };
  }

  async function listPages(chapterUrl = location.href) {
    const doc = await fetchDocument(chapterUrl);
    const images = Array.from(doc.querySelectorAll(".reading-content img"));
    if (!images.length) {
      throw new Error("Madara chapter exposes no readable pages.");
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
