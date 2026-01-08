(() => {
  const THEME_KEY = "__unshackle_theme";
  const DEFAULT_THEME = "contrast";

  function normalizeThemeKey(themeKey) {
    const normalized = typeof themeKey === "string" ? themeKey.trim().toLowerCase() : "";
    if (normalized === "dark" || normalized === "lightdark") return normalized;
    return DEFAULT_THEME;
  }

  function getSyncStorage(keys) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === "undefined" || !chrome?.storage?.sync) {
        resolve({});
        return;
      }
      chrome.storage.sync.get(keys, (result) => {
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(error);
        } else {
          resolve(result || {});
        }
      });
    });
  }

  function getLocalStorage(keys) {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  async function applyTheme() {
    let theme = DEFAULT_THEME;
    try {
      const sync = await getSyncStorage({ panelTheme: DEFAULT_THEME });
      if (sync && typeof sync.panelTheme === "string") {
        theme = normalizeThemeKey(sync.panelTheme);
      } else {
        const local = await getLocalStorage({ [THEME_KEY]: DEFAULT_THEME });
        if (local && typeof local[THEME_KEY] === "string") {
          theme = normalizeThemeKey(local[THEME_KEY]);
        }
      }
    } catch {
      try {
        const local = await getLocalStorage({ [THEME_KEY]: DEFAULT_THEME });
        if (local && typeof local[THEME_KEY] === "string") {
          theme = normalizeThemeKey(local[THEME_KEY]);
        }
      } catch {
        theme = DEFAULT_THEME;
      }
    }
    document.body.dataset.theme = theme;
  }

  function bindScrollShortcuts() {
    document.querySelectorAll("[data-scroll]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.getAttribute("data-scroll");
        if (!target) return;
        const el = document.querySelector(target);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function updateYear() {
    const yearEl = document.getElementById("helpYear");
    if (yearEl) {
      yearEl.textContent = String(new Date().getFullYear());
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme().catch(() => {});
    bindScrollShortcuts();
    updateYear();
  }, { once: true });
})();
