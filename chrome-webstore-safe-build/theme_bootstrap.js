(() => {
  const DEFAULT_THEME = "contrast";
  const THEME_KEY = "__unshackle_theme";
  const ALLOWED_THEMES = new Set([
    "contrast",
    "blueberry",
    "lightdark",
    "noirgold",
    "purplefanatic",
    "sakura",
    "ocean",
    "forest",
    "slate",
    "ember"
  ]);

  function normalizeThemeKey(value) {
    const key = String(value || "").toLowerCase();
    return ALLOWED_THEMES.has(key) ? key : DEFAULT_THEME;
  }

  function applyTheme(themeKey) {
    const theme = normalizeThemeKey(themeKey);
    document.documentElement.dataset.theme = theme;

    const applyToBody = () => {
      if (!document.body || !document.body.dataset) return;
      document.body.dataset.theme = theme;
    };

    if (document.body) applyToBody();
    else document.addEventListener("DOMContentLoaded", applyToBody, { once: true });

    return theme;
  }

  function reveal() {
    document.documentElement.classList.remove("theme-loading");
  }

  function getLocalTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }

  function setLocalTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch { }
  }

  const local = getLocalTheme();
  if (local) {
    applyTheme(local);
    reveal();
    return;
  }

  let revealed = false;
  const fallbackReveal = setTimeout(() => {
    if (revealed) return;
    revealed = true;
    reveal();
  }, 800);

  function applyAndReveal(themeCandidate) {
    const theme = applyTheme(themeCandidate);
    setLocalTheme(theme);
    if (!revealed) {
      revealed = true;
      clearTimeout(fallbackReveal);
      reveal();
    }
  }

  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.sync?.get) {
      chrome.storage.sync.get({ panelTheme: DEFAULT_THEME }, (result) => {
        applyAndReveal(result?.panelTheme);
      });
      return;
    }
  } catch { }

  applyAndReveal(DEFAULT_THEME);
})();

