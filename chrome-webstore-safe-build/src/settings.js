(function attachUnshackleSettings(root) {
  const DEFAULTS = {
    mode: "image",
    manga: {
      enabled: false,
      loader: "auto",
      families: {
        speedbinb: true,
        coreview: true,
        madara: false,
        mangastream: false,
        foolslide: false
      },
      includeComicInfo: false,
      includeEPUB: false,
      bookmarks: []
    },
    dev: {
      hkDebug: false
    }
  };

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }

  function isMergeableObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function mergeInto(target, source) {
    if (!isMergeableObject(source)) {
      return target;
    }
    Object.keys(source).forEach((key) => {
      const incoming = source[key];
      const current = target[key];
      if (isMergeableObject(current) && isMergeableObject(incoming)) {
        mergeInto(current, incoming);
      } else {
        target[key] = incoming;
      }
    });
    return target;
  }

  const ALLOWED_MODES = new Set(["image", "manga"]);
  const ALLOWED_LOADERS = new Set(["runner", "manager", "auto"]);

  function normalizeMode(value) {
    return ALLOWED_MODES.has(value) ? value : DEFAULTS.mode;
  }

  function normalizeLoader(value) {
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (ALLOWED_LOADERS.has(normalized)) {
        return normalized;
      }
    }
    return DEFAULTS.manga.loader;
  }

  function applySafeguards(snapshot = {}) {
    const copy = cloneDefaults();
    mergeInto(copy, snapshot);
    copy.mode = normalizeMode(copy.mode);
    if (!copy.manga || typeof copy.manga !== "object") {
      copy.manga = cloneDefaults().manga;
    }
    copy.manga.enabled = Boolean(copy.manga.enabled);
    copy.manga.loader = normalizeLoader(copy.manga.loader);
    return copy;
  }

  function mergeWithDefaults(persisted) {
    return applySafeguards(persisted || {});
  }

  function ensureDefaults(options = {}) {
    const storage =
      options.storage ||
      (root.chrome &&
        root.chrome.storage &&
        root.chrome.storage.local) ||
      null;

    if (!storage) {
      return Promise.resolve(cloneDefaults());
    }

    return new Promise((resolve, reject) => {
      storage.get({ settings: null }, (result = {}) => {
        const readError =
          root.chrome &&
          root.chrome.runtime &&
          root.chrome.runtime.lastError;
        if (readError) {
          reject(readError);
          return;
        }

        const merged = mergeWithDefaults(result.settings || {});

        storage.set({ settings: merged }, () => {
          const writeError =
            root.chrome &&
            root.chrome.runtime &&
            root.chrome.runtime.lastError;
          if (writeError) {
            reject(writeError);
            return;
          }
          resolve(merged);
        });
      });
    });
  }

  root.UnshackleSettings = {
    DEFAULTS,
    cloneDefaults,
    mergeWithDefaults,
    ensureDefaults
  };
})(typeof self !== "undefined" ? self : globalThis);
