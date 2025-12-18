(() => {
  const root = typeof window !== "undefined" ? window : self;
  if (root.__HK_MANGA_CONTENT_READY__) {
    return;
  }

  const SCRIPT_QUEUE = [
    "sites/site-registry.js",
    "sites/gigaviewer/module.js",
    "sites/speedbinb/module.js",
    "sites/bellaciao/module.js",
    "sites/madara/module.js",
    "sites/mangastream/module.js",
    "sites/foolslide/module.js",
    "adapters/hakuneko/registry.js",
    "adapters/hakuneko/delegates.js"
  ];

  const loadedScripts = new Set();
  let initialized = false;

  function injectScript(resource) {
    if (!resource || loadedScripts.has(resource)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      try {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL(resource);
        script.async = false;
        script.onload = () => {
          loadedScripts.add(resource);
          try {
            script.remove();
          } catch {}
          resolve();
        };
        script.onerror = (err) => {
          try {
            script.remove();
          } catch {}
          reject(new Error(`Failed to load ${resource}: ${err?.message || err}`));
        };
        (document.documentElement || document.head || document.body || document).appendChild(script);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function bootstrapMangaContent() {
    for (const resource of SCRIPT_QUEUE) {
      // eslint-disable-next-line no-await-in-loop
      await injectScript(resource);
    }
    root.__HK_MANGA_CONTENT_READY__ = true;
    initialized = true;
  }

  const readyState = document.readyState;
  const readyPromise = readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
    : Promise.resolve();

  readyPromise
    .then(bootstrapMangaContent)
    .catch((error) => {
      console.error("[HK] Manga content bootstrap failed", error);
    });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === "getCached") {
      sendResponse({ ok: initialized, source: "content_manga" });
    }
  });
})();
