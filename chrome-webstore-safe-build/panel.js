// panel.js v2.0.0
(function () {
  const $ = (q, r = document) => r.querySelector(q);
  const TEMP_URLS = new Set();
  const EXTENSION_ORIGIN = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL("") : "";
  const ZIP_JOBS = new Map();
  let zipWorker = null;
  let zipJobId = 0;
  const RAW_BLOB_CACHE = new Map(); // raw blob URL -> { url, mime, size }
  const BLOB_BATCH_SIZE = 6;
  const PLACEHOLDER_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
  const HOST_PERMISSION_EXPLAINED_KEY = "__unshackle_perm_explained";
  const PERMISSION_PROMPT_KEY = "__unshackle_permission_prompt";
  const HK_TEST_HOST_PATTERNS = [
    "https://booklive.jp/*",
    "https://*.booklive.jp/*",
    "https://comic-action.com/*",
    "https://*.comic-action.com/*"
  ];
  const GLOBAL_PERMISSION_PRIMARY_ORIGINS = HK_TEST_HOST_PATTERNS.slice();
  const GLOBAL_PERMISSION_ALL_ORIGINS = HK_TEST_HOST_PATTERNS.slice();
  const TOAST_DURATION_MS = 6000;
  const LEGACY_TELEMETRY_KEY = "__unshackle_telemetry";
  const DONATION_KEY = "__unshackle_donation";
  const DONATION_MIN_TOTAL = 1500;
  const DONATION_MONTHLY_THRESHOLD = 300;
  const DOWNLOAD_PATH_KEY = "__unshackle_download_path_prompt";
  const FIRST_RUN_KEY = "__unshackle_first_run_done";
  const HK_SYNC_KEYS = Object.freeze({
    MODE: "hk_mode",
    FAMILIES: "hk_enabled_families"
  });
  const HK_PREVIEW_SOURCE = "manga-preview";
  const CHROME_DOWNLOADS_URL = "chrome://downloads/";
  const HELP_PAGE_PATH = "help.html";
  const HELP_FALLBACK_URL = "https://www.unshackle.scernix.com/";
  const THEME_KEY = "__unshackle_theme";
  const DEFAULT_THEME = "contrast";
  const ALLOWED_THEMES = new Set(["contrast", "blueberry", "lightdark", "noirgold", "purplefanatic", "sakura", "ocean", "forest", "slate", "ember"]);
  const OVERLAY_RECENTS_KEY = "__unshackle_overlay_recent";
  const MAX_RECENT_OVERLAY_TAGS = 12;
  const DEFAULT_OVERLAY_TAGS = [
    "overlay", "cover", "wrapper", "wrap", "shield", "modal", "popup", "subscribe", "paywall", "consent", "banner",
    "veil", "mask", "promo", "ad", "signup", "cookie", "newsletter", "interstitial", "gate"
  ];
  const FILTER_STATE = { format: "", kind: "all", discovery: "all", search: "", sort: "detected" };
  const DISCOVERY_REGISTRY = new Map();
  const DOWNLOAD_STATUS = new Map(); // url -> { status, message, updatedAt }
  let SCAN_SEQUENCE = 0;
  let CURRENT_SCAN_ID = 0;
  let ACTIVE_SCAN_SESSION = null;
  let toastHost = null;
  let progressState = null;
  let askPermissionEachScan = true;
  let downloadCounts = { images: 0 };
  const STATS_KEY = "__unshackle_stats";
  let STATS = { scans: 0, imagesScanned: 0, overlaysNuked: 0, overlayTweaks: 0, imagesDownloaded: 0 };
  let statsSaveQueue = Promise.resolve();
  let donationState = { lifetime: 0, monthly: {}, lastPromptMonth: "" };
  let donationModalEl = null;
  let donationCloseBtn = null;
  let donationTipBtn = null;
  let donationExtensionsLink = null;
  let donationPromptOpen = false;
  let alwaysAskDownloadPath = true;
  let downloadPathPromptedForScanId = null;
  let recentOverlayTags = [];
  const CANVAS_NAME_CACHE = new Map();
  const FOOTER_LOG_LIMIT = 5;
  const FOOTER_LOG = [];
  let FOOTER_LOG_SEQ = 0;
  let footerMessagesHidden = false;

  // Onboarding and dynamic locale system
  const ONBOARDING_DONE_KEY = "__unshackle_onboarding_done";
  const SELECTED_LOCALE_KEY = "__unshackle_locale";
  const AVAILABLE_LOCALES = ["en", "de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW"];
  const LOCALE_CACHE = new Map(); // locale code -> messages object
  let selectedLocale = null; // null = use chrome.i18n default
  let onboardingModalEl = null;
  let onboardingStep = 1;
  let onboardingSelectedLocale = "en";
  let onboardingSelectedTheme = DEFAULT_THEME;
  let carouselSlide = 1;

  const GV_INJECTION_TOKEN = "main-v7";
  const GV_INJECTED_STATE = new Map();
  const GV_DEFAULT_OPTIONS = {
    saveMetadata: false,
    onlyFirst: false,
    purchaseGuard: true,
    zipDownload: false
  };
  const GV_OPTIONS_KEY = "gvOptions";
  const GV_COOKIE_CANDIDATES = new Set(["glsc", "glsession", "glclient", "gl_client", "glsid", "gl_session"]);
  const GV_PERMISSION_CACHE_KEY = "__unshackle_gv_permission_cache";
  const HK_BOOKMARK_STORAGE_PATH = "manga.bookmarks";
  const HK_BOOKMARK_LIMIT = 200;
  let GV_OPTIONS = { ...GV_DEFAULT_OPTIONS };
  const gvOptionListeners = [];
  let GV_PERMISSION_CACHE = null;
  let GV_PERMISSION_PROMPT = null;
  let GV_LAST_REPORT = null;
  let VIEWER_LAST_PROBE = null;
  const GV_GALLERY_ITEMS = [];
  let gvGalleryGrid = null;
  let gvSaveAllButton = null;
  let gvClearGalleryButton = null;
  let gvGalleryStatusLabel = null;
  let gvCurrentSeriesTitle = "";
  let gvCurrentEpisodeTitle = "";
  let gvChapterListEl = null;
  let gvChapterStatusEl = null;
  let gvChapterRefreshBtn = null;
  const CHAPTER_STATE = { viewerId: null, alias: null, locale: null, items: [] };
  let chapterLoadPending = false;
  let chapterAutoRequested = false;
  const HK_MODE_DEFAULT = "image";
  const HK_ALLOWED_LOADERS = new Set(["auto", "runner", "manager"]);
  const HK_FAMILY_CONNECTOR_HINTS = Object.freeze({
    speedbinb: "delegate.speedbinb",
    coreview: "delegate.coreview",
    madara: "delegate.madara",
    mangastream: "delegate.mangastream",
    foolslide: "delegate.foolslide"
  });
  const HK_VIRTUAL_CONNECTORS = Object.freeze([
    { id: "delegate.speedbinb", label: "SpeedBinb (Native)", type: "delegate", module: "speedbinb", family: "SpeedBinb" },
    { id: "delegate.coreview", label: "CoreView (Native)", type: "delegate", module: "gigaviewer", family: "CoreView" }
  ]);
  const HK_ALLOWLIST_PATH = "integrations/hakuneko/allowlist.json";
  const HK_LAST_DETECTION_KEY = "__hk_last_detection_cache";
  // Keep detection cache short-lived to avoid stale oscillations.
  const HK_DETECTION_CACHE_TTL = 60 * 60 * 1000;
  const canonicalizeConnectorId = typeof globalThis.canonicalHKConnectorId === "function"
    ? (id) => globalThis.canonicalHKConnectorId(id)
    : (id) => (typeof id === "string" ? id : "");
  const getHKConnectorMeta = typeof globalThis.getHKConnectorMeta === "function"
    ? (id) => globalThis.getHKConnectorMeta(id)
    : () => null;
  const getPreferredHKConnectorId = typeof globalThis.getPreferredHKConnectorId === "function"
    ? (id, preference) => globalThis.getPreferredHKConnectorId(id, preference)
    : (id) => canonicalizeConnectorId(id);
  let hkCurrentMode = HK_MODE_DEFAULT;
  let hkConnectorCatalog = [];
  let hkChapterCache = [];
  let hkSelectedChapterId = null;
  let hkModeButtons = [];
  let hkUrlInputEl = null;
  let hkListButtonEl = null;
  let hkDetectButtonEl = null;
  let hkDownloadButtonEl = null;
  let hkChapterListEl = null;
  let hkMangaStatusEl = null;
  let hkMangaStatusTextEl = null;
  let hkRetryRunnerBtn = null;
  let hkDetectedConnectorLabelEl = null;
  let hkConnectorSelectEl = null;
  let hkRefreshConnectorBtn = null;
  let hkDetectedConnectorId = null;
  let hkDetectedConnectorSource = "";
  let hkDetectedFamilyKey = null;
  let hkConnectorPickerEl = null;
  let hkConnectorPickerSelectEl = null;
  let hkConnectorPickerApplyEl = null;
  let hkConnectorPickerCloseEl = null;
  let hkConnectorCandidates = [];
  let hkConnectorPickerResolver = null;
  let hkShowPreviewButtonEl = null;
  let hkSeriesTitleEl = null;
  let hkBookmarkButtonEl = null;
  let hkPreviewGridEl = null;
  let hkPreviewStatusEl = null;
  let hkActiveDownloadJob = null;
  let hkDownloadButtonDefaultLabel = "";
  let hkDownloadAdapterPromise = null;
  let hkLastMangaResult = null;
  let hkIncludeComicInfoEl = null;
  let hkIncludeEpubEl = null;
  let hkSettingsSnapshot = null;
  let hkMangaEnabled = false;
  const hkSelectedChapterIds = new Set();
  let hkMangaPanelEl = null;
  let hkImagePanelEl = null;
  let hkModeToggleEl = null;
  let hkMangaReadyPromise = null;
  let hkMangaInitialized = false;
  let hkIgnoreModeEventDepth = 0;
  let hkLoaderMode = "auto";
  let hkLoaderSelectEl = null;
  let hkForceNextLoader = null;
  let hkRunnerRetryAction = null;
  const hkWarningHistory = new Set();
  let hkInitialDetectAttempted = false;
  const hkChapterPreviewState = new Map();
  let hkLastPageChangeAt = 0;
  let hkLastActiveTabInfo = null;
  let hkDetectedSeriesTitle = "";
  let hkBookmarks = [];
  /**
   * ⚠️ CRITICAL: DO NOT MODIFY FAMILY ASSIGNMENTS
   * The "family" property MUST match the connector's actual family for descrambling to work.
   * CoreView sites (comic-action, comic-earthstar, comic-days, etc.) require family: "coreview"
   * to trigger image descrambling in shouldDescrambleHKPreview().
   * 
   * Incorrect family assignment = broken/scrambled images for that site.
   */
  const HK_HOST_CONNECTOR_OVERRIDES = Object.freeze({
    // Deterministic host → connector mapping to avoid oscillation
    "yanmaga.jp": { connectorId: "yanmaga", family: "speedbinb", source: "host-map" },
    "viewer-yanmaga.comici.jp": { connectorId: "yanmaga", family: "speedbinb", source: "host-map" },
    "sbc.yanmaga.jp": { connectorId: "yanmaga", family: "speedbinb", source: "host-map" },
    "comic-action.com": { connectorId: "comicaction", family: "coreview", source: "host-map" },
    "www.comic-action.com": { connectorId: "comicaction", family: "coreview", source: "host-map" },
    "comic-days.com": { connectorId: "comicdays", family: "coreview", source: "host-map" },
    "www.comic-days.com": { connectorId: "comicdays", family: "coreview", source: "host-map" },
    "comic-earthstar.com": { connectorId: "comicearthstar", family: "coreview", source: "host-map" },
    "www.comic-earthstar.com": { connectorId: "comicearthstar", family: "coreview", source: "host-map" }
  });
  const HK_FAMILY_DEFAULTS = Object.freeze({
    speedbinb: true,
    coreview: true,
    madara: false,
    mangastream: false,
    foolslide: false
  });
  let hkAllowListEntries = null;
  let hkLastDetectionCache = null;

  function hkDebugLog(...args) {
    try {
      if (globalThis.UnshackleHKDebug?.isEnabled?.()) {
        console.log(...args);
      }
    } catch {
      // Keep console silent if debug plumbing is unavailable.
    }
  }

  function normalizeHKLoaderMode(value) {
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (HK_ALLOWED_LOADERS.has(normalized)) {
        return normalized;
      }
    }
    return "auto";
  }
  function createHKSafeDefaults() {
    if (typeof UnshackleSettings?.cloneDefaults === "function") {
      return UnshackleSettings.cloneDefaults();
    }
    return {
      mode: HK_MODE_DEFAULT,
      manga: {
        enabled: false,
        loader: "auto",
        families: { ...HK_FAMILY_DEFAULTS },
        includeComicInfo: false,
        includeEPUB: false,
        bookmarks: []
      },
      dev: { hkDebug: false }
    };
  }
  const HK_VIRTUALIZE_THRESHOLD = 150;
  const HK_VIRTUALIZE_OVERSCAN = 12;
  let hkChapterVirtualizer = null;
  const VIEWER_CONFIG = {
    gigaviewer: {
      id: "gigaviewer",
      displayName: "GigaViewer",
      supportsNext: true,
      ensureAssets: ensureGVAssetPermissions,
      getOptions: () => ({
        saveMetadata: !!GV_OPTIONS.saveMetadata,
        onlyFirst: !!GV_OPTIONS.onlyFirst,
        purchaseBehavior: GV_OPTIONS.purchaseGuard ? "halt" : "ignore",
        zipDownload: !!GV_OPTIONS.zipDownload
      })
    },
    lezhin: {
      id: "lezhin",
      displayName: "Lezhin",
      supportsNext: false,
      ensureAssets: null,
      getOptions: () => ({
        saveMetadata: !!GV_OPTIONS.saveMetadata,
        onlyFirst: !!GV_OPTIONS.onlyFirst,
        purchaseBehavior: GV_OPTIONS.purchaseGuard ? "halt" : "ignore",
        zipDownload: !!GV_OPTIONS.zipDownload
      })
    },
    speedbinb: {
      id: "speedbinb",
      displayName: "Speedbinb",
      supportsNext: false,
      ensureAssets: null,
      getOptions: () => ({
        onlyFirst: !!GV_OPTIONS.onlyFirst,
        zipDownload: !!GV_OPTIONS.zipDownload
      })
    },
    bellaciao: {
      id: "bellaciao",
      displayName: "BellaCiao",
      supportsNext: false,
      ensureAssets: null,
      getOptions: () => ({
        onlyFirst: !!GV_OPTIONS.onlyFirst,
        zipDownload: !!GV_OPTIONS.zipDownload
      })
    }
  };
  const VIEWER_MODULE_IDS = Object.freeze(["gigaviewer", "speedbinb", "bellaciao", "lezhin"]);
  function getViewerConfig(viewerId) {
    return viewerId ? (VIEWER_CONFIG[viewerId] || null) : null;
  }

  async function collectLoginCookiesForTab(tab) {
    if (!tab?.url || !chrome?.cookies?.getAll) {
      return [];
    }
    try {
      const cookieList = await new Promise((resolve, reject) => {
        chrome.cookies.getAll({ url: tab.url }, (cookies) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            reject(new Error(err.message || String(err)));
            return;
          }
          resolve(Array.isArray(cookies) ? cookies : []);
        });
      });
      if (!Array.isArray(cookieList) || !cookieList.length) {
        return [];
      }
      const loginCookies = cookieList.filter((entry) => entry?.name && GV_COOKIE_CANDIDATES.has(entry.name));
      const source = loginCookies.length ? loginCookies : cookieList;
      return source
        .filter((cookie) => typeof cookie?.name === "string" && cookie.name)
        .map((cookie) => ({
          name: cookie.name,
          value: typeof cookie.value === "string" ? cookie.value : "",
          domain: typeof cookie.domain === "string" ? cookie.domain : "",
          path: typeof cookie.path === "string" ? cookie.path : "/",
          secure: Boolean(cookie.secure),
          httpOnly: Boolean(cookie.httpOnly),
          sameSite: cookie.sameSite || null,
          expirationDate: cookie.expirationDate
        }));
    } catch (error) {
      console.warn("[GV] Failed to read cookies for tab", error);
      return [];
    }
  }

  function getViewerDisplayName(viewerId) {
    const cfg = getViewerConfig(viewerId);
    return cfg?.displayName || viewerId || "Viewer";
  }
  const DIMENSION_FILTER = { minWidth: 0, minHeight: 0 };
  let autoRestartTimer = null;

  const INVALID_FILENAME_CHARS = /[\x00-\x1f<>:"/\\|?*]+/g;
  const TRAILING_DOTS_SPACES_RE = /[. ]+$/;
  const RESERVED_FILE_BASENAMES = new Set([
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
  ]);
  const MAX_FILENAME_LENGTH = 180;
  const MAX_FILENAME_STEM = 120;
  const HTML_ESCAPE_LOOKUP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  function normalizeThemeKey(themeKey) {
    const key = String(themeKey || "").toLowerCase();
    return ALLOWED_THEMES.has(key) ? key : DEFAULT_THEME;
  }

  function applyTheme(themeKey) {
    const theme = normalizeThemeKey(themeKey);
    const root = document.documentElement;
    if (root?.dataset) root.dataset.theme = theme;
    if (document.body?.dataset) document.body.dataset.theme = theme;
  }

  function readThemeFromLocalStorage() {
    try {
      return normalizeThemeKey(localStorage.getItem(THEME_KEY));
    } catch {
      return DEFAULT_THEME;
    }
  }

  applyTheme(readThemeFromLocalStorage());

  async function loadStoredGVOptions() {
    try {
      const stored = await chrome.storage.local.get({ [GV_OPTIONS_KEY]: GV_DEFAULT_OPTIONS });
      const merged = { ...GV_DEFAULT_OPTIONS, ...(stored[GV_OPTIONS_KEY] || {}) };
      GV_OPTIONS = merged;
      return merged;
    } catch {
      GV_OPTIONS = { ...GV_DEFAULT_OPTIONS };
      return GV_OPTIONS;
    }
  }

  async function persistGVOptions() {
    try {
      await chrome.storage.local.set({ [GV_OPTIONS_KEY]: GV_OPTIONS });
    } catch { }
  }

  function updateGVOption(key, value) {
    if (!(key in GV_DEFAULT_OPTIONS)) return;
    GV_OPTIONS = { ...GV_OPTIONS, [key]: value };
    persistGVOptions();
    for (const fn of gvOptionListeners) {
      try { fn(GV_OPTIONS); } catch { }
    }
  }

  function applyGVOptionUI(options = GV_OPTIONS) {
    const opts = { ...GV_DEFAULT_OPTIONS, ...(options || {}) };
    const onlyFirstEl = document.getElementById("gvOnlyFirst");
    const saveMetaEl = document.getElementById("gvSaveMetadata");
    const purchaseEl = document.getElementById("gvPurchaseGuard");
    const zipEl = document.getElementById("gvZipDownload");
    if (onlyFirstEl) onlyFirstEl.checked = !!opts.onlyFirst;
    if (saveMetaEl) saveMetaEl.checked = !!opts.saveMetadata;
    if (purchaseEl) purchaseEl.checked = !!opts.purchaseGuard;
    if (zipEl) zipEl.checked = !!opts.zipDownload;
  }

  gvOptionListeners.push(applyGVOptionUI);

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "-";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 5000 ? 2 : 1)} s`;
    const sec = Math.round(ms / 1000);
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  function renderGVReport(telemetry) {
    GV_LAST_REPORT = telemetry || null;
    const container = document.getElementById("gvReport");
    if (!container) return;
    const summaryEl = document.getElementById("gvReportSummary");
    const failuresEl = document.getElementById("gvReportFailures");
    if (!telemetry) {
      container.classList.add("hidden");
      if (summaryEl) summaryEl.textContent = "";
      if (failuresEl) failuresEl.innerHTML = "";
      return;
    }
    container.classList.remove("hidden");

    if (summaryEl) {
      const parts = [];
      const downloaded = telemetry.pagesDownloaded ?? telemetry.totalPages ?? 0;
      const total = telemetry.totalPages ?? downloaded;
      parts.push(`Pages: ${downloaded}/${total}`);
      if (telemetry.zipDownload) {
        parts.push("ZIP pref: on");
      }
      if (typeof telemetry.retries === "number" && telemetry.retries > 0) {
        parts.push(`Retries: ${telemetry.retries}`);
      }
      const duration = formatDuration(telemetry.durationMs);
      parts.push(`Duration: ${duration}`);
      summaryEl.textContent = parts.join(" • ");
    }

    if (failuresEl) {
      failuresEl.innerHTML = "";
      const failures = Array.isArray(telemetry.failures) ? telemetry.failures.filter(Boolean) : [];
      if (!failures.length) {
        const li = document.createElement("li");
        li.textContent = "No errors recorded.";
        li.style.color = "var(--muted)";
        failuresEl.appendChild(li);
      } else {
        failures.slice(0, 5).forEach((failure) => {
          const li = document.createElement("li");
          const idx = failure.index != null && failure.index >= 0 ? `Page ${failure.index + 1}` : "General";
          li.textContent = `${idx}: ${failure.error || "Unknown error"}`;
          failuresEl.appendChild(li);
        });
        if (failures.length > 5) {
          const li = document.createElement("li");
          li.textContent = `...and ${failures.length - 5} more`;
          failuresEl.appendChild(li);
        }
      }
    }
  }

  async function loadGVPermissionCache() {
    if (GV_PERMISSION_CACHE) return GV_PERMISSION_CACHE;
    try {
      const stored = await chrome.storage.local.get({ [GV_PERMISSION_CACHE_KEY]: {} });
      const raw = stored[GV_PERMISSION_CACHE_KEY];
      GV_PERMISSION_CACHE = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
    } catch {
      GV_PERMISSION_CACHE = {};
    }
    return GV_PERMISSION_CACHE;
  }

  async function persistGVPermissionCache() {
    if (!GV_PERMISSION_CACHE) return;
    try {
      await chrome.storage.local.set({ [GV_PERMISSION_CACHE_KEY]: GV_PERMISSION_CACHE });
    } catch { }
  }

  async function updateGVPermissionCache(patterns, granted) {
    if (!Array.isArray(patterns) || !patterns.length) return;
    const cache = await loadGVPermissionCache();
    let changed = false;
    for (const pattern of patterns) {
      if (!pattern) continue;
      if (granted) {
        if (!cache[pattern]) {
          cache[pattern] = Date.now();
          changed = true;
        }
      } else if (cache[pattern]) {
        delete cache[pattern];
        changed = true;
      }
    }
    if (changed) {
      await persistGVPermissionCache();
    }
  }

  function ensureGVPermissionPrompt() {
    if (GV_PERMISSION_PROMPT) return GV_PERMISSION_PROMPT;
    const overlay = document.createElement("div");
    overlay.className = "gv-permission-overlay hidden";
    overlay.setAttribute("role", "presentation");

    const modal = document.createElement("div");
    modal.className = "gv-permission-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "gvPermissionTitle");

    const title = document.createElement("h3");
    title.id = "gvPermissionTitle";
    title.textContent = "Site access required";

    const description = document.createElement("p");
    description.className = "gv-permission-description";
    description.textContent = "This download needs temporary access to:";

    const list = document.createElement("ul");
    list.className = "gv-permission-list";

    const actionRow = document.createElement("div");
    actionRow.className = "gv-permission-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "gv-permission-cancel";
    cancelBtn.textContent = "Cancel";

    const allowBtn = document.createElement("button");
    allowBtn.type = "button";
    allowBtn.className = "gv-permission-allow";
    allowBtn.textContent = "Allow & Continue";

    actionRow.append(cancelBtn, allowBtn);
    modal.append(title, description, list, actionRow);
    overlay.append(modal);
    document.body.appendChild(overlay);

    GV_PERMISSION_PROMPT = {
      overlay,
      modal,
      list,
      allowBtn,
      cancelBtn
    };
    return GV_PERMISSION_PROMPT;
  }

  async function showGVPermissionChecklist(origins) {
    if (!Array.isArray(origins) || !origins.length) return true;
    const prompt = ensureGVPermissionPrompt();
    prompt.list.innerHTML = "";
    const normalized = origins.map((origin) => {
      try {
        const u = new URL(origin);
        return `${u.protocol}//${u.host}`;
      } catch {
        return origin;
      }
    });
    const unique = Array.from(new Set(normalized));
    unique.forEach((origin) => {
      const li = document.createElement("li");
      li.textContent = origin.replace(/^https?:\/\//i, "");
      prompt.list.appendChild(li);
    });

    const overlay = prompt.overlay;
    overlay.classList.remove("hidden");

    const previousActive = document.activeElement;
    const focusTarget = prompt.allowBtn;
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
    }

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = (result) => {
        if (settled) return;
        settled = true;
        overlay.classList.add("hidden");
        overlay.removeEventListener("click", onOverlayClick);
        prompt.allowBtn.removeEventListener("click", onAllow);
        prompt.cancelBtn.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKeydown, true);
        if (previousActive && typeof previousActive.focus === "function") {
          setTimeout(() => previousActive.focus({ preventScroll: true }), 0);
        }
        resolve(result);
      };

      const onAllow = (ev) => {
        ev.preventDefault();
        cleanup(true);
      };

      const onCancel = (ev) => {
        ev.preventDefault();
        cleanup(false);
      };

      const onOverlayClick = (ev) => {
        if (ev.target === overlay) {
          cleanup(false);
        }
      };

      const onKeydown = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          cleanup(false);
        }
      };

      prompt.allowBtn.addEventListener("click", onAllow);
      prompt.cancelBtn.addEventListener("click", onCancel);
      overlay.addEventListener("click", onOverlayClick);
      document.addEventListener("keydown", onKeydown, true);
    });
  }

  async function ensureGVAssetPermissions(tab, episodeUrl) {
    // Permission prompts are intentionally skipped. We still return a success
    // payload so the caller can proceed without additional UX.
    return { ok: true, origins: [] };
  }

  async function startViewerDownload(viewerId, tabOverride = null, overrides = null) {
    const viewer = getViewerConfig(viewerId);
    if (!viewer) {
      recordUserNotice("error", "Viewer not supported.");
      return;
    }
    const displayName = getViewerDisplayName(viewerId);
    const tab = tabOverride || await getActiveTab();
    if (!tab || !tab.id) {
      recordUserNotice("error", "No active tab.");
      return;
    }
    const {
      episodeUrl: explicitUrl = null,
      options: optionOverrides = null,
      skipStatusCheck = false
    } = overrides || {};
    const probeBase = (VIEWER_LAST_PROBE && VIEWER_LAST_PROBE.tabId === tab.id)
      ? VIEWER_LAST_PROBE
      : (!skipStatusCheck ? await robustViewerCheck(tab.id, 2000) : null);
    let probe = null;
    if (!skipStatusCheck) {
      probe = probeBase || null;
      if (!probe) {
        recordUserNotice("error", "Unable to inspect viewer data for this page.");
        return;
      }
      const status = findViewerStatus(probe, viewerId);
      if (!status || !status.ok) {
        const reason = status?.reason;
        const message = (!status || !status.detected)
          ? "This page does not expose compatible viewer data."
          : reason
            ? `Viewer not ready: ${reason}`
            : "This page does not expose compatible viewer data.";
        recordUserNotice("warn", message);
        return;
      }
    } else if (tab.id != null) {
      await injectGV(tab.id);
    }
    VIEWER_LAST_PROBE = probe;
    const perm = await ensureHostPermission(tab);
    if (!perm.ok) {
      if (perm.reason) {
        recordUserNotice("warn", perm.reason);
      }
      return;
    }
    await ensureBridgeInjected(tab.id);
    resetGVGallery();
    gvCurrentSeriesTitle = "";
    gvCurrentEpisodeTitle = "";
    window.currentEpisodeTitle = "";

    const options = viewer.getOptions ? { ...viewer.getOptions() } : {};
    if (optionOverrides && typeof optionOverrides === "object") {
      Object.assign(options, optionOverrides);
    }
    const loginCookies = await collectLoginCookiesForTab(tab);
    if (loginCookies.length) {
      options.loginCookies = loginCookies;
    }

    renderGVReport(null);

    const executeDownload = async (episodeUrl, opts) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (targetUrl, moduleId, downloadOptions) => {
          try {
            const registry = globalThis.UnshackleSites;
            const mod = registry && (registry.get ? registry.get(moduleId) : registry.modules?.[moduleId]);
            const fallback = moduleId === "gigaviewer"
              ? (globalThis.UnshackleGV || globalThis.UnshackleGVDetect || null)
              : null;
            const targetModule = mod || fallback;
            if (!targetModule) {
              throw new Error("Module not loaded");
            }
            const downloader = targetModule && (targetModule.downloadEpisode || targetModule.downloadGVEpisode);
            if (typeof downloader !== "function") {
              throw new Error("Downloader not available");
            }
            const r = await downloader.call(targetModule, targetUrl, downloadOptions);
            return { ok: true, data: r };
          } catch (error) {
            return { ok: false, error: String(error?.message || error) };
          }
        },
        args: [episodeUrl, viewerId, opts],
        world: "ISOLATED"
      });
      return results[0]?.result;
    };

    const targetUrl = explicitUrl || tab.url || "";
    if (!targetUrl) {
      recordUserNotice("error", "Unable to determine the current page URL.");
      return;
    }

    try {
      if (typeof viewer.ensureAssets === "function") {
        const permResult = await viewer.ensureAssets(tab, targetUrl);
        if (!permResult?.ok) {
          const err = permResult?.error;
          const message = (err === "No readableProduct" || err === "Detector not loaded")
            ? "This page does not expose compatible viewer data."
            : (err ? `Viewer assets issue: ${err}` : "Viewer assets require additional access.");
          recordUserNotice("warn", message);
          return;
        }
      }
      recordUserNotice("info", `${displayName} download started.`);
      const result = await executeDownload(targetUrl, options);

      // Count download ATTEMPTS right after we get the result (regardless of success/abort/failure)
      const resultInfo = result?.data || {};
      const attemptCount = Number.isFinite(resultInfo.count) ? resultInfo.count
        : (Array.isArray(resultInfo.pages) ? resultInfo.pages.length : (Number.isFinite(resultInfo.total) ? resultInfo.total : 1));
      await recordDownloadSuccess(attemptCount);

      if (!result?.ok) {
        renderGVReport(result?.data?.telemetry || null);
        recordUserNotice("error", `Viewer download failed: ${result?.error || "Unknown error"}`);
        return;
      }
      const info = result.data || {};
      if (info.status === "aborted") {
        renderGVReport(info.telemetry || null);
        recordUserNotice("warn", info.message || "Viewer download cancelled.");
        return;
      }
      if (info.status !== "success") {
        renderGVReport(info.telemetry || null);
        recordUserNotice("error", "Viewer downloader returned an unexpected response.");
        return;
      }

      renderGVReport(info.telemetry || null);

      gvCurrentSeriesTitle = info.seriesTitle || gvCurrentSeriesTitle || "";
      gvCurrentEpisodeTitle = info.title || gvCurrentEpisodeTitle || "";
      window.currentEpisodeTitle = gvCurrentEpisodeTitle;
      if (gvCurrentSeriesTitle) {
        setHKSeriesTitle(gvCurrentSeriesTitle);
      }

      if (Array.isArray(info.pages) && info.pages.length) {
        await ingestGVPages(info.pages, viewerId);
      }

      const totalPages = typeof info.total === "number" ? info.total : info.count ?? 0;
      const downloadedPages = typeof info.count === "number" ? info.count : null;
      const limited = info.onlyFirst && typeof downloadedPages === "number" && typeof totalPages === "number" && totalPages > downloadedPages;
      const pageSummary = downloadedPages == null
        ? `${totalPages}`
        : (limited ? `${downloadedPages} of ${totalPages}` : `${downloadedPages}`);
      const metaNote = info.metadataSaved ? "Metadata.json added to gallery." : "";
      const galleryNote = 'Images added to the panel grid. Use "Save all (ZIP)" to pick a folder.';
      let zipAutoNote = "";
      if (info.zipDownload) {
        try {
          await saveGVGalleryAsZip(info.defaultZipName);
          zipAutoNote = "ZIP preference enabled; save dialog opened.";
        } catch (err) {
          const msg = String(err?.message || err || "");
          if (/interrupted|canceled|cancelled/i.test(msg)) {
            zipAutoNote = "ZIP save cancelled.";
          } else {
            zipAutoNote = `ZIP save failed (${msg || "unknown error"}).`;
          }
        }
      }
      const baseMessageParts = [
        `Viewer download ready: ${pageSummary} page(s) queued for ${info.seriesTitle || "series"}/${info.title || "episode"}.`,
        metaNote,
        galleryNote,
        zipAutoNote
      ].filter((part) => part && part.length);
      // Note: Download attempts already counted earlier (right after executeDownload)
      recordUserNotice("info", baseMessageParts.join(" "));
    } catch (err) {
      recordUserNotice("error", `Viewer download failed: ${String(err && err.message ? err.message : err || "Unknown error")}`);
    }
  }

  async function startGVDownload(tabOverride = null) {
    return startViewerDownload("gigaviewer", tabOverride);
  }

  async function startSpeedbinbDownload(tabOverride = null) {
    return startViewerDownload("speedbinb", tabOverride);
  }

  async function injectGV(tabId) {
    if (!tabId) return;
    if (GV_INJECTED_STATE.get(tabId) === GV_INJECTION_TOKEN) return;
    try {
      const baseFiles = [
        "sites/site-registry.js",
        "sites/gigaviewer/module.js",
        "sites/speedbinb/module.js",
        "sites/bellaciao/module.js",
        "sites/madara/module.js",
        "sites/mangastream/module.js",
        "sites/foolslide/module.js",
        "adapters/hakuneko/delegates.js",
        "adapters/hakuneko/registry.js"
      ];
      const isolatedFiles = [...baseFiles];
      await chrome.scripting.executeScript({ target: { tabId }, files: baseFiles, world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId }, files: isolatedFiles, world: "ISOLATED" });
      GV_INJECTED_STATE.set(tabId, GV_INJECTION_TOKEN);
    } catch (err) {
      GV_INJECTED_STATE.delete(tabId);
      throw err;
    }
  }

  async function isGigaViewer(tabId) {
    if (!tabId) return false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          try {
            const registry = globalThis.UnshackleSites;
            const mod = registry && (registry.get ? registry.get("gigaviewer") : registry.modules?.gigaviewer);
            if (!mod || typeof mod.detect !== "function") return false;
            return await mod.detect(location.href);
          } catch (error) {
            return { __error: String(error) };
          }
        },
        world: "MAIN"
      });
      if (!Array.isArray(results) || !results.length) return false;
      const { result } = results[0] || {};
      if (result && typeof result === "object" && "__error" in result) {
        throw new Error(result.__error);
      }
      return !!result;
    } catch {
      return false;
    }
  }

  async function guardViewerBeforeScan(tab) {
    if (!tab || !tab.id) return true;
    const probe = await robustViewerCheck(tab.id, 1500);
    if (!probe.ok) return true;
    const viewer = findFirstReadyViewer(probe);
    if (!viewer || !viewer.ok) return true;
    switch (viewer.id) {
      case "gigaviewer":
        await startGVDownload(tab);
        break;
      case "speedbinb":
        await startSpeedbinbDownload(tab);
        break;
      default:
        await startViewerDownload(viewer.id, tab);
        break;
    }
    return false;
  }

  function handleGVTabRemoved(tabId) {
    GV_INJECTED_STATE.delete(tabId);
  }

  function handleGVTabUpdated(tabId, info) {
    if (info && info.status === "loading") {
      GV_INJECTED_STATE.delete(tabId);
    }
  }

  try {
    if (chrome?.tabs?.onRemoved && !chrome.tabs.onRemoved.hasListener(handleGVTabRemoved)) {
      chrome.tabs.onRemoved.addListener(handleGVTabRemoved);
    }
    if (chrome?.tabs?.onUpdated && !chrome.tabs.onUpdated.hasListener(handleGVTabUpdated)) {
      chrome.tabs.onUpdated.addListener(handleGVTabUpdated);
    }
  } catch { }

  function formatKindLabel(kind) {
    switch (kind) {
      case "img": return t("kind_img", "Image");
      case "background": return t("kind_background", "Background");
      case "blob": return t("kind_blob", "Blob");
      case "dataUri": return t("kind_data", "Data URI");
      case "canvas": return t("kind_canvas", "Canvas");
      case "svg": return t("kind_svg", "SVG");
      case "manga": return "Manga";
      case "gv": return "GigaViewer";
      case "speedbinb": return "Speedbinb";
      case "bellaciao": return "BellaCiao";
      default: return kind ? String(kind).toUpperCase() : t("kind_unknown", "Item");
    }
  }

  function formatSize(bytes) {
    const val = Number(bytes);
    if (!Number.isFinite(val) || val <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = val;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }
    const rounded = idx === 0 ? Math.round(size) : (size < 10 ? size.toFixed(1) : Math.round(size));
    return `${rounded} ${units[idx]}`;
  }

  function discoveryKey(item) {
    if (!item || typeof item !== "object") return null;
    if (item.rawUrl && typeof item.rawUrl === "string" && item.rawUrl) return item.rawUrl;
    if (item.url && typeof item.url === "string" && item.url && !item.url.startsWith("data:")) return item.url;
    if (item.url && typeof item.url === "string" && item.url.startsWith("data:")) return `${item.kind || "data"}:${item.url.slice(0, 120)}`;
    if (item.filename) return `${item.kind || "item"}:${item.filename}`;
    return null;
  }

  function annotateDiscovery(items, scanId) {
    if (!Array.isArray(items)) return;
    const now = Date.now();
    const effectiveScanId = Number.isFinite(scanId) ? scanId : CURRENT_SCAN_ID;
    for (const item of items) {
      const key = discoveryKey(item);
      if (!key) continue;
      let entry = DISCOVERY_REGISTRY.get(key);
      if (!entry) {
        entry = { firstSeen: now, lastSeen: now, seenCount: 0, lastScanId: null, order: DISCOVERY_REGISTRY.size + 1 };
        DISCOVERY_REGISTRY.set(key, entry);
      }
      if (entry.lastScanId !== effectiveScanId) {
        entry.seenCount += 1;
        entry.lastScanId = effectiveScanId;
      }
      entry.lastSeen = now;
      item.__discovery = {
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        seenCount: entry.seenCount,
        status: entry.seenCount === 1 ? "new" : "seen",
        order: entry.order
      };
    }
  }

  function computeDiscoveryStats(items = CACHE) {
    let newCount = 0;
    let seenCount = 0;
    for (const it of items) {
      if (!it) continue;
      const status = it.__discovery?.status;
      if (status === "new") newCount++;
      else if (status === "seen") seenCount++;
      else seenCount++;
    }
    return { newCount, seenCount };
  }
  function sanitizeExtension(ext, fallback = "png") {
    const cleaned = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!cleaned) return fallback;
    return cleaned.slice(0, 8);
  }

  function sanitizeFilenameStem(stem, fallback = "image") {
    let val = String(stem ?? "").replace(INVALID_FILENAME_CHARS, "_");
    val = val.replace(TRAILING_DOTS_SPACES_RE, "");
    val = val.replace(/^\.+/, "");
    val = val.trim();
    if (!val) val = fallback;
    if (RESERVED_FILE_BASENAMES.has(val.toLowerCase())) val = `_${val}`;
    if (val.length > MAX_FILENAME_STEM) val = val.slice(0, MAX_FILENAME_STEM);
    return val || fallback;
  }

  function assembleFilename(stem, ext, maxLength = MAX_FILENAME_LENGTH) {
    const safeExt = sanitizeExtension(ext);
    let safeStem = sanitizeFilenameStem(stem);
    let candidate = safeExt ? `${safeStem}.${safeExt}` : safeStem;
    if (candidate.length > maxLength) {
      const allowedStem = Math.max(1, maxLength - (safeExt ? safeExt.length + 1 : 0));
      safeStem = safeStem.slice(0, allowedStem);
      candidate = safeExt ? `${safeStem}.${safeExt}` : safeStem;
    }
    return candidate;
  }

  function ensureSafeFilenameCandidate(name, { defaultExt = "png", fallback = "image", maxLength = MAX_FILENAME_LENGTH } = {}) {
    const raw = String(name || "").trim();
    let stemPart = raw;
    const slashIdx = stemPart.lastIndexOf("/");
    if (slashIdx !== -1) stemPart = stemPart.slice(slashIdx + 1);
    let extPart = "";
    const dotIdx = stemPart.lastIndexOf(".");
    if (dotIdx > 0) {
      extPart = stemPart.slice(dotIdx + 1);
      stemPart = stemPart.slice(0, dotIdx);
    }
    if (!extPart) extPart = defaultExt;
    const safeStem = sanitizeFilenameStem(stemPart, fallback);
    const safeExt = sanitizeExtension(extPart, defaultExt);
    return assembleFilename(safeStem, safeExt, maxLength);
  }

  // ---- Modes & Manga Panel ----

  function logHKDevEvent(message, detail = null) {
    if (globalThis.UnshackleHKDebug?.isEnabled?.() && globalThis.UnshackleHKDebug?.log) {
      try {
        globalThis.UnshackleHKDebug.log(message, detail);
      } catch { }
    }
  }

  function emitHKModeChanged(mode, meta = {}) {
    try {
      document.dispatchEvent(new CustomEvent("hkModeChanged", { detail: { mode, ...meta } }));
    } catch { }
  }

  /**
   * ⚠️⚠️⚠️ CRITICAL - DO NOT MODIFY OR REMOVE ⚠️⚠️⚠️
   * 
   * Normalizes a family key to lowercase for consistent comparison.
   * Used to match connector families for descrambling detection.
   * 
   * THIS FUNCTION IS REQUIRED FOR COREVIEW/GIGAVIEWER DESCRAMBLING TO WORK.
   * Removing or modifying this will break image descrambling for ALL CoreView sites:
   * - ComicAction, ComicEarthStar, ComicDays, ShonenJumpPlus, and 10+ more sites
   * 
   * If you modify this, users will see SCRAMBLED/CORRUPTED images.
   */
  function normalizeHKFamilyKey(value) {
    if (!value) return "";
    return String(value).toLowerCase().trim();
  }

  function buildHKFamilyMap(source) {
    const merged = { ...HK_FAMILY_DEFAULTS };
    if (source && typeof source === "object") {
      for (const [key, value] of Object.entries(source)) {
        const normalized = normalizeHKFamilyKey(key);
        if (!normalized) continue;
        merged[normalized] = Boolean(value);
      }
    }
    return merged;
  }

  function applyHKFamilyList(list) {
    if (!Array.isArray(list)) {
      return { ...HK_FAMILY_DEFAULTS };
    }
    const enabled = new Set(list.map(normalizeHKFamilyKey).filter(Boolean));
    const map = { ...HK_FAMILY_DEFAULTS };
    Object.keys(map).forEach((key) => {
      map[key] = enabled.has(key);
    });
    enabled.forEach((key) => {
      if (!(key in map)) {
        map[key] = true;
      }
    });
    return map;
  }

  function listEnabledHKFamilies(snapshot = hkSettingsSnapshot) {
    const families = snapshot?.manga?.families || {};
    const enabled = new Set();
    for (const [key, value] of Object.entries(families)) {
      if (value === false) continue;
      const normalized = normalizeHKFamilyKey(key);
      if (normalized) {
        enabled.add(normalized);
      }
    }
    return Array.from(enabled);
  }

  async function syncHKModeToStorage(mode) {
    try {
      await chrome.storage.sync.set({ [HK_SYNC_KEYS.MODE]: mode });
    } catch { }
  }

  async function syncHKFamiliesToStorage(snapshot = hkSettingsSnapshot) {
    try {
      await chrome.storage.sync.set({ [HK_SYNC_KEYS.FAMILIES]: listEnabledHKFamilies(snapshot) });
    } catch { }
  }

  async function mirrorHKSettingToSync(path, snapshot) {
    if (path === "mode") {
      await syncHKModeToStorage(snapshot?.mode || HK_MODE_DEFAULT);
      return;
    }
    if (path.startsWith("manga.families")) {
      await syncHKFamiliesToStorage(snapshot);
    }
  }

  function getHKFamilySettingsSnapshot() {
    const stored = getHKSetting("manga.families", HK_FAMILY_DEFAULTS);
    return buildHKFamilyMap(stored);
  }

  function isHKFamilyEnabled(family) {
    const map = getHKFamilySettingsSnapshot();
    const key = normalizeHKFamilyKey(family);
    if (!key) return true;
    return map[key] !== false;
  }

  function getHKFamiliesPayload() {
    return getHKFamilySettingsSnapshot();
  }

  function buildHKFamiliesPayload(base = {}) {
    return { ...base, families: getHKFamiliesPayload() };
  }

  function normalizeHKUrlForDetection(input) {
    if (typeof input !== "string" || !input) return "";
    try {
      const url = new URL(input);
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  async function buildHKCookieContext(url) {
    if (!chrome?.cookies?.getAll) return null;
    if (typeof url !== "string" || !url) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    const cookieList = await new Promise((resolve) => {
      chrome.cookies.getAll({ url }, (cookies) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve(null);
          return;
        }
        resolve(Array.isArray(cookies) ? cookies : []);
      });
    });
    if (!cookieList || !cookieList.length) {
      return null;
    }
    const pairs = cookieList
      .filter((cookie) => typeof cookie?.name === "string" && cookie.name)
      .map((cookie) => `${cookie.name}=${typeof cookie.value === "string" ? cookie.value : ""}`)
      .filter(Boolean);
    const header = pairs.join("; ");
    if (!header) {
      return null;
    }
    return {
      host: parsed.hostname.toLowerCase(),
      value: header,
      updatedAt: Date.now()
    };
  }

  function getHostnameFromUrl(input) {
    if (typeof input !== "string" || !input) return "";
    try {
      const url = new URL(input);
      return url.hostname?.toLowerCase() || "";
    } catch {
      return "";
    }
  }

  function hostMatchesDomain(host, domain) {
    if (!host || !domain) return false;
    const normalizedHost = host.toLowerCase();
    const normalizedDomain = domain.toLowerCase();
    const match = normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
    return match;
  }

  function normalizeHKDetectionRecord(record) {
    if (!record || typeof record !== "object") {
      return record;
    }
    const canonicalId = canonicalizeConnectorId(record.connectorId || record.id || "");
    if (!canonicalId) {
      return record;
    }
    if ((record.connectorId || record.id) === canonicalId) {
      return { ...record, canonicalId };
    }
    return {
      ...record,
      connectorId: canonicalId,
      canonicalId,
      aliasId: record.connectorId || record.id || null
    };
  }

  function normalizeBookmarkUrl(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    try {
      return new URL(trimmed).href;
    } catch {
      return trimmed;
    }
  }

  function normalizeHKBookmarkEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const connectorId = canonicalizeConnectorId(entry.connectorId || entry.id || "");
    const url = normalizeBookmarkUrl(entry.url || entry.href || "");
    if (!connectorId || !url) {
      return null;
    }
    const title = typeof entry.title === "string" && entry.title.trim()
      ? entry.title.trim()
      : (typeof entry.seriesTitle === "string" ? entry.seriesTitle.trim() : "");
    const family = normalizeHKFamilyKey(entry.family || entry.module) || null;
    const addedAt = Number(entry.addedAt);
    return {
      id: `${connectorId}::${url}`,
      connectorId,
      url,
      title,
      family,
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now()
    };
  }

  function normalizeHKBookmarks(list = []) {
    const seen = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
      const normalized = normalizeHKBookmarkEntry(raw);
      if (!normalized) continue;
      const key = normalized.id;
      const existing = seen.get(key);
      if (!existing || (existing.addedAt || 0) < (normalized.addedAt || 0)) {
        seen.set(key, normalized);
      }
    }
    return Array.from(seen.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  function getCurrentSeriesUrl() {
    const inputValue = hkUrlInputEl?.value?.trim();
    if (inputValue) {
      return normalizeBookmarkUrl(inputValue);
    }
    const tabUrl = hkLastActiveTabInfo?.url || "";
    return normalizeBookmarkUrl(tabUrl);
  }

  function updateHKSeriesTitleLabel() {
    if (!hkSeriesTitleEl) return;
    const text = hkDetectedSeriesTitle && hkDetectedSeriesTitle.trim();
    if (text) {
      hkSeriesTitleEl.textContent = text;
      hkSeriesTitleEl.dataset.state = "detected";
    } else {
      hkSeriesTitleEl.textContent = "Not detected";
      hkSeriesTitleEl.dataset.state = "idle";
    }
  }

  function setHKSeriesTitle(title) {
    hkDetectedSeriesTitle = typeof title === "string" ? title.trim() : "";
    updateHKSeriesTitleLabel();
    updateHKBookmarkButtonState();
  }

  function getHKBookmarkTitleCandidate() {
    const detected = hkDetectedSeriesTitle && hkDetectedSeriesTitle.trim();
    return detected || "";
  }

  function updateHKBookmarkButtonState() {
    if (!hkBookmarkButtonEl) return;
    const url = getCurrentSeriesUrl();
    const ready = Boolean(url && hkDetectedConnectorId && hkDetectedSeriesTitle);
    hkBookmarkButtonEl.disabled = !ready;
  }

  async function probeHKSeriesTitle(tabId) {
    if (!Number.isInteger(tabId)) {
      return "";
    }
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const pick = (sel) => {
            const node = document.querySelector(sel);
            const value = node && (node.content || node.getAttribute?.("content") || node.textContent);
            return typeof value === "string" ? value.trim() : "";
          };
          const candidates = [
            pick('meta[property="og:title"]'),
            pick('meta[name="og:title"]'),
            pick('meta[name="twitter:title"]'),
            pick('meta[name="title"]'),
            pick('meta[itemprop="name"]'),
            pick("h1"),
            document.title || ""
          ];
          const title = candidates.find((value) => value && value.trim()) || "";
          return { title: title.trim() };
        }
      });
      const title = result?.result?.title || "";
      return typeof title === "string" ? title.trim() : "";
    } catch (error) {
      console.warn("[HK] Failed to probe series title", error);
      return "";
    }
  }

  async function refreshHKSeriesTitle(reason = "auto") {
    const direct = hkLastMangaResult?.manga?.title;
    if (direct) {
      setHKSeriesTitle(direct);
      return hkDetectedSeriesTitle;
    }
    try {
      const tabInfo = await hkGetActiveTabInfo();
      if (tabInfo?.id != null) {
        const probed = await probeHKSeriesTitle(tabInfo.id);
        if (probed) {
          setHKSeriesTitle(probed);
        }
      }
    } catch { }
    return hkDetectedSeriesTitle;
  }

  async function handleHKBookmarkClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (hkBookmarkButtonEl?.disabled) {
      return;
    }
    const connectorId = hkDetectedConnectorId;
    const url = getCurrentSeriesUrl();
    const family = hkDetectedFamilyKey;
    if (!connectorId || !url) {
      return;
    }
    const title = getHKBookmarkTitleCandidate() || url;
    const entry = normalizeHKBookmarkEntry({
      connectorId,
      url,
      title,
      family,
      addedAt: Date.now()
    });
    if (!entry) {
      return;
    }
    const nextList = normalizeHKBookmarks([entry, ...hkBookmarks]).slice(0, HK_BOOKMARK_LIMIT);
    hkBookmarks = nextList;
    updateHKBookmarkButtonState();
    try {
      await updateHKSetting(HK_BOOKMARK_STORAGE_PATH, nextList);
      const label = entry.title || entry.url;
      showToast(`Saved bookmark for ${label}.`, { duration: 3000 });
    } catch (error) {
      console.warn("[HK] Failed to persist bookmark", error);
      showToast("Failed to save bookmark.", { duration: 3200 });
    }
  }

  async function loadHKAllowList(force = false) {
    if (hkAllowListEntries && !force) {
      return hkAllowListEntries;
    }
    try {
      const res = await fetch(chrome.runtime.getURL(HK_ALLOWLIST_PATH));
      const data = await res.json();
      hkAllowListEntries = Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn("[HK] Failed to load allow-list", error);
      hkAllowListEntries = [];
    }
    return hkAllowListEntries;
  }

  async function findHKAllowListMatches(url, families) {
    const host = getHostnameFromUrl(url);
    if (!host) return [];
    const entries = await loadHKAllowList();
    const matches = [];
    for (const entry of entries) {
      if (!Array.isArray(entry?.domains) || !entry.domains.length) continue;
      const familyKey = normalizeHKFamilyKey(entry.family || entry.module);
      if (families && familyKey && families[familyKey] === false) continue;
      if (entry.domains.some((domain) => hostMatchesDomain(host, domain?.toLowerCase?.() || domain))) {
        const canonicalId = canonicalizeConnectorId(entry.id);
        matches.push({
          connectorId: canonicalId || entry.id,
          aliasId: entry.id,
          label: entry.label || entry.id,
          family: familyKey,
          source: "allowlist",
          host
        });
      }
    }
    if (!matches.length) {
      hkDebugLog("[HK] Allowlist had no match for host", host);
    }
    return matches;
  }

  const TAB_MESSAGE_TIMEOUT_MS = 12000;
  const CONTENT_PING_TIMEOUT_MS = 1500;
  const CONTENT_READY_TIMEOUT_MS = 15000;
  const CONTENT_READY_POLL_DELAY_MS = 200;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function classifyHKErrorMessage(message) {
    const text = String(message || "").toLowerCase();
    if (!text) return null;
    if (/401|403|unauth|forbidden|login|cookie/.test(text)) {
      return "Authentication or cookies may be required. Make sure you are logged in on the site.";
    }
    if (/cors|blocked by client|fetch failed|network/.test(text)) {
      return "Request was blocked by the site (CORS/network). Try opening the page in a tab and retry.";
    }
    if (/timeout|timed out/.test(text)) {
      return "Request timed out. Retry or switch loader.";
    }
    return null;
  }

  function sendMessageToTab(tabId, payload, { timeout = TAB_MESSAGE_TIMEOUT_MS } = {}) {
    if (!Number.isInteger(tabId)) {
      return Promise.reject(new Error("Invalid tab id."));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finalize = (error, response) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(response);
      };
      if (Number.isFinite(timeout) && timeout > 0) {
        timer = setTimeout(() => {
          finalize(new Error(`Tab message timed out after ${timeout}ms.`));
        }, timeout);
      }
      try {
        chrome.tabs.sendMessage(tabId, payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            finalize(new Error(err.message || String(err)));
            return;
          }
          finalize(null, response);
        });
      } catch (error) {
        finalize(error);
      }
    });
  }

  async function injectCoreContentScript(tabId) {
    if (!chrome.scripting?.executeScript) {
      return false;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
        world: "ISOLATED"
      });
      return true;
    } catch (error) {
      const message = String(error?.message || "");
      if (!/Cannot access contents/i.test(message)) {
        console.warn("[HK] Failed to inject content script", error);
      }
      return false;
    }
  }

  async function ensureContentScriptReady(tabId, timeoutMs = CONTENT_READY_TIMEOUT_MS) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return false;
    }
    const deadline = Date.now() + timeoutMs;
    let injected = await injectCoreContentScript(tabId);
    while (Date.now() < deadline) {
      try {
        const response = await sendMessageToTab(
          tabId,
          { action: "HK_PING" },
          { timeout: CONTENT_PING_TIMEOUT_MS }
        );
        if (response?.domReady) {
          return true;
        }
      } catch (error) {
        const message = String(error?.message || "").toLowerCase();
        if (/no tab with id|tab was closed/.test(message)) {
          throw error;
        }
        if (!injected && (/receiving end does not exist/.test(message) || /could not establish connection/.test(message))) {
          injected = await injectCoreContentScript(tabId);
          await delay(CONTENT_READY_POLL_DELAY_MS);
          continue;
        }
        if (!/timed out/.test(message)) {
          console.warn("[HK] Content script ping failed", error);
        }
      }
      await delay(CONTENT_READY_POLL_DELAY_MS);
    }
    return false;
  }

  async function detectWithPageHeuristics(tabId, families) {
    if (!Number.isInteger(tabId)) return null;
    try {
      const ready = await ensureContentScriptReady(tabId);
      if (!ready) {
        console.warn("[HK] Content script not ready; skipping heuristic detection.");
        return null;
      }
    } catch (error) {
      console.warn("[HK] Unable to prepare content script for heuristics", error);
      return null;
    }
    try {
      const response = await sendMessageToTab(
        tabId,
        { action: "HK_DETECT_FAMILY", families },
        { timeout: TAB_MESSAGE_TIMEOUT_MS }
      );
      const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
      for (const candidate of candidates) {
        const family = normalizeHKFamilyKey(candidate.family);
        if (!family) continue;
        if (families && families[family] === false) continue;
        const connectorId = HK_FAMILY_CONNECTOR_HINTS[family];
        if (!connectorId) continue;
        const host = response?.url ? getHostnameFromUrl(response.url) : "";
        return {
          connectorId,
          family,
          confidence: Number(candidate.confidence) || 0,
          hints: Array.isArray(candidate.hints) ? candidate.hints : [],
          source: "heuristics",
          host
        };
      }
    } catch (error) {
      console.warn("[HK] Heuristic detection failed", error);
    }
    return null;
  }

  async function loadHKLastDetectionCache(force = false) {
    if (hkLastDetectionCache && !force) {
      return hkLastDetectionCache;
    }
    try {
      const result = await chrome.storage.local.get({ [HK_LAST_DETECTION_KEY]: {} });
      const cache = result[HK_LAST_DETECTION_KEY];
      hkLastDetectionCache = cache && typeof cache === "object" ? cache : {};
    } catch (error) {
      console.warn("[HK] Unable to load detection cache", error);
      hkLastDetectionCache = {};
    }
    return hkLastDetectionCache;
  }

  async function rememberHKDetection(host, record) {
    const canonicalId = canonicalizeConnectorId(record?.connectorId);
    if (!host || !canonicalId) return;
    const cache = await loadHKLastDetectionCache();
    const now = Date.now();
    cache[host] = {
      connectorId: canonicalId,
      family: record.family || null,
      timestamp: now
    };
    for (const [key, value] of Object.entries(cache)) {
      if (!value) {
        delete cache[key];
        continue;
      }
      const ts = Number(value.timestamp) || 0;
      if (!ts || now - ts > HK_DETECTION_CACHE_TTL) {
        delete cache[key];
      }
    }
    try {
      await chrome.storage.local.set({ [HK_LAST_DETECTION_KEY]: cache });
    } catch (error) {
      console.warn("[HK] Failed to persist detection cache", error);
    }
  }

  async function getCachedHKDetection(host, families) {
    if (!host) return null;
    const cache = await loadHKLastDetectionCache();
    const record = cache?.[host];
    if (!record) return null;
    const now = Date.now();
    const timestamp = Number(record.timestamp) || 0;
    if (!timestamp || now - timestamp > HK_DETECTION_CACHE_TTL) {
      delete cache[host];
      try {
        await chrome.storage.local.set({ [HK_LAST_DETECTION_KEY]: cache });
      } catch (error) {
        console.warn("[HK] Failed to prune detection cache", error);
      }
      return null;
    }
    const family = normalizeHKFamilyKey(record.family || "");
    const connectorId = canonicalizeConnectorId(record.connectorId || "");
    if (!connectorId) {
      return null;
    }
    if (families && family && families[family] === false) {
      return null;
    }
    hkDebugLog("[HK] Using cached detection", { host, connectorId, family });
    return {
      connectorId,
      family,
      source: "cache",
      host
    };
  }

  function resolveFamilyFromConnectorId(connectorId) {
    if (!connectorId) return "";
    const entry = hkConnectorCatalog.find((item) => item?.id === connectorId);
    if (entry?.family) {
      return normalizeHKFamilyKey(entry.family);
    }
    for (const [family, id] of Object.entries(HK_FAMILY_CONNECTOR_HINTS)) {
      if (id === connectorId) {
        return normalizeHKFamilyKey(family);
      }
    }
    return "";
  }

  async function probeHKConnectors(url, tabId, families) {
    if (!globalThis.hkProxy?.probe) return null;
    try {
      const result = await hkProxy.probe(buildHKFamiliesPayload({ url, tabId }));
      if (!result?.connectorId) return null;
      const family = normalizeHKFamilyKey(result.family || resolveFamilyFromConnectorId(result.connectorId));
      if (families && family && families[family] === false) {
        return null;
      }
      return {
        connectorId: result.connectorId,
        family,
        source: "probe",
        host: getHostnameFromUrl(url),
        metadata: result
      };
    } catch (error) {
      console.warn("[HK] Probe failed", error);
      return null;
    }
  }

  function getHKConnectorOverride(host) {
    if (!host) return null;
    const entry = HK_HOST_CONNECTOR_OVERRIDES[host];
    if (!entry) return null;
    return {
      connectorId: entry.connectorId,
      family: entry.family || null,
      source: entry.source || "host-map",
      host
    };
  }

  async function runHKDetectionPipeline({ url, tabId }) {
    const normalizedUrl = normalizeHKUrlForDetection(url) || url;
    const families = getHKFamiliesPayload();
    const host = getHostnameFromUrl(normalizedUrl);
    const candidates = [];
    const pushCandidate = (entry, priority = 10) => {
      if (!entry?.connectorId) return;
      const id = canonicalizeConnectorId(entry.connectorId);
      if (!id || candidates.find((c) => canonicalizeConnectorId(c.connectorId) === id)) {
        return;
      }
      const normalized = normalizeHKDetectionRecord(entry);
      if (!normalized.family) {
        normalized.family = resolveFamilyFromConnectorId(normalized.connectorId);
      }
      if (!normalized.host) {
        normalized.host = host;
      }
      normalized.__priority = priority;
      candidates.push(normalized);
    };
    const stages = [
      { name: "host-map", priority: 0, exec: () => getHKConnectorOverride(host) },
      { name: "cache", priority: 1, exec: () => getCachedHKDetection(host, families) },
      { name: "allowlist", priority: 2, exec: () => findHKAllowListMatches(normalizedUrl, families) },
      { name: "heuristics", priority: 3, exec: () => detectWithPageHeuristics(tabId, families) },
      { name: "probe", priority: 4, exec: () => probeHKConnectors(normalizedUrl, tabId, families) }
    ];
    for (const stage of stages) {
      try {
        const result = await stage.exec();
        if (Array.isArray(result)) {
          result.forEach((entry) => pushCandidate(entry, stage.priority));
        } else if (result?.connectorId) {
          pushCandidate(result, stage.priority);
        }
      } catch (error) {
        console.warn("[HK] Detection stage failed", stage?.name || "unknown", error);
      }
    }
    candidates.sort((a, b) => {
      const pa = Number.isFinite(a.__priority) ? a.__priority : 10;
      const pb = Number.isFinite(b.__priority) ? b.__priority : 10;
      if (pa !== pb) return pa - pb;
      return (a.connectorId || "").localeCompare(b.connectorId || "", undefined, { sensitivity: "base" });
    });
    if (candidates.length && host) {
      await rememberHKDetection(host, candidates[0]);
    }
    if (!candidates.length && host) {
      console.warn("[HK] No connector matched host", host, { url: normalizedUrl });
    }
    return candidates.length ? candidates : null;
  }

  async function detectConnectorForCurrentContext(options = {}) {
    const { silent = false, reason = "manual", tabInfo: tabInfoOverride = null } = options;
    const tabInfo = tabInfoOverride || await hkGetActiveTabInfo();
    const urlValue = hkUrlInputEl?.value?.trim() || tabInfo?.url || "";
    if (!urlValue) {
      if (!silent) {
        hkSetMangaStatus("Enter a URL to detect connectors.", "warn", { loading: false });
      }
      return null;
    }
    if (!silent) {
      hkSetMangaStatus("Detecting connector...", "info", { loading: true });
    }
    const detections = await runHKDetectionPipeline({ url: urlValue, tabId: tabInfo?.id ?? null });
    if (Array.isArray(detections) && detections.length) {
      let chosen = detections[0];
      if (!silent && detections.length > 1) {
        chosen = await showHKConnectorPicker(detections) || detections[0];
      }
      applyHKDetectedConnector(chosen);
      const host = getHostnameFromUrl(normalizeHKUrlForDetection(urlValue) || urlValue);
      if (host && chosen) {
        await rememberHKDetection(host, chosen);
      }
      if (!silent) {
        let msg = `Detected ${chosen.connectorId}`;
        if (chosen.source) {
          msg += ` via ${chosen.source}`;
        }
        hkSetMangaStatus(`${msg}.`, "ok", { loading: false });
      }
      logHKDevEvent(`[Detect] ${reason} -> ${chosen.connectorId}`, { source: chosen.source });
      return chosen;
    }
    if (!silent) {
      hkSetMangaStatus("No connector matched this URL. Try refreshing the page or switch to Image mode.", "warn", { loading: false });
      resetHKDetectedConnectorLabel();
      console.warn("[HK] Detection failed for URL", urlValue);
    }
    return null;
  }

  function hideHKConnectorPicker() {
    if (hkConnectorPickerEl) {
      hkConnectorPickerEl.classList.add("hidden");
    }
    hkConnectorCandidates = [];
    hkConnectorPickerResolver = null;
  }

  function handleHKConnectorPickerSubmit() {
    if (!hkConnectorPickerResolver) {
      hideHKConnectorPicker();
      return;
    }
    const value = hkConnectorPickerSelectEl?.value || "";
    const match = hkConnectorCandidates.find((c) => c.connectorId === value) || hkConnectorCandidates[0] || null;
    const resolver = hkConnectorPickerResolver;
    hkConnectorPickerResolver = null;
    hideHKConnectorPicker();
    resolver(match);
  }

  function handleHKConnectorPickerCancel() {
    const resolver = hkConnectorPickerResolver;
    hkConnectorPickerResolver = null;
    const fallback = hkConnectorCandidates[0] || null;
    hideHKConnectorPicker();
    if (resolver) resolver(fallback);
  }

  function showHKConnectorPicker(candidates = []) {
    hideHKConnectorPicker();
    if (!hkConnectorPickerEl || !hkConnectorPickerSelectEl || !Array.isArray(candidates) || candidates.length <= 1) {
      return Promise.resolve(candidates[0] || null);
    }
    hkConnectorCandidates = candidates.slice();
    hkConnectorPickerSelectEl.innerHTML = "";
    candidates.forEach((entry, idx) => {
      const opt = document.createElement("option");
      opt.value = entry.connectorId;
      const parts = [entry.label || entry.connectorId];
      if (entry.family) parts.push(entry.family);
      if (entry.source) parts.push(entry.source);
      opt.textContent = parts.join(" • ");
      if (idx === 0) opt.selected = true;
      hkConnectorPickerSelectEl.appendChild(opt);
    });
    hkConnectorPickerEl.classList.remove("hidden");
    hkConnectorPickerSelectEl.focus();
    return new Promise((resolve) => {
      hkConnectorPickerResolver = resolve;
    });
  }

  function handleHKExternalPageChange(payload = {}) {
    if (!hkMangaEnabled) return;
    const now = Date.now();
    if (now - hkLastPageChangeAt < 400) return;
    hkLastPageChangeAt = now;
    if (payload?.tab) {
      hkLastActiveTabInfo = payload.tab;
    } else if (Number.isInteger(payload?.tabId)) {
      hkLastActiveTabInfo = {
        id: payload.tabId,
        url: payload.url || hkLastActiveTabInfo?.url || ""
      };
    }
    hkInitialDetectAttempted = false;
    resetHKDetectedConnectorLabel();
    setHKSeriesTitle("");
    if (typeof payload.url === "string" && hkUrlInputEl) {
      hkUrlInputEl.value = payload.url;
    }
    renderHKConnectorSelect();
    updateHKBookmarkButtonState();
    refreshHKSeriesTitle("page-change").catch(() => { });
    hkSetMangaStatus("Page changed — detecting connector...", "info", { loading: true });
    maybeAutoDetectConnector().catch(() => {
      hkSetMangaStatus("Page changed. Click Detect to refresh.", "warn", { loading: false });
    });
  }

  async function maybeAutoDetectConnector() {
    if (hkInitialDetectAttempted) return null;
    hkInitialDetectAttempted = true;
    const detection = await detectConnectorForCurrentContext({ silent: true, reason: "auto" });
    if (detection?.connectorId) {
      const msg = `Detected ${detection.connectorId} (${detection.source || "auto"}).`;
      hkSetMangaStatus(msg, "ok", { loading: false });
    }
    await refreshHKSeriesTitle("auto").catch(() => { });
    updateHKBookmarkButtonState();
    return detection;
  }

  function applyHKModeClasses() {
    if (!hkMangaEnabled && hkCurrentMode === "manga") {
      hkCurrentMode = HK_MODE_DEFAULT;
    }
    const mode = hkCurrentMode === "manga" ? "manga" : "image";
    hkCurrentMode = mode;
    document.body.classList.toggle("hk-mode-manga", mode === "manga" && hkMangaEnabled);
    document.body.classList.toggle("hk-mode-image", mode !== "manga" || !hkMangaEnabled);
    if (hkModeToggleEl) {
      hkModeToggleEl.hidden = !hkMangaEnabled;
      hkModeToggleEl.setAttribute("aria-hidden", String(!hkMangaEnabled));
    }
    hkModeButtons.forEach((button) => {
      const isMangaTab = button.dataset.mode === "manga";
      button.disabled = isMangaTab && !hkMangaEnabled;
      const selected = button.dataset.mode === mode;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    if (hkMangaPanelEl) {
      const mangaHidden = mode !== "manga" || !hkMangaEnabled;
      hkMangaPanelEl.setAttribute("aria-hidden", String(mangaHidden));
      hkMangaPanelEl.setAttribute("tabindex", mangaHidden ? "-1" : "0");
    }
    if (hkImagePanelEl) {
      hkImagePanelEl.hidden = false;
      hkImagePanelEl.setAttribute("aria-hidden", "false");
      hkImagePanelEl.setAttribute("tabindex", "0");
    }
    if (hkMangaPanelEl) {
      hkMangaPanelEl.hidden = !hkMangaEnabled || mode !== "manga";
    }
  }

  async function ensureHKMangaPanelReady() {
    if (!hkMangaEnabled) {
      return false;
    }
    if (hkMangaInitialized) {
      return true;
    }
    if (!hkMangaReadyPromise) {
      hkMangaReadyPromise = initHKMangaPanel()
        .then(() => true)
        .catch((error) => {
          hkMangaReadyPromise = null;
          throw error;
        });
    }
    return hkMangaReadyPromise;
  }

  async function setHKMode(nextMode, options = {}) {
    const desired = nextMode === "manga" ? "manga" : HK_MODE_DEFAULT;
    const mode = desired === "manga" && hkMangaEnabled ? "manga" : HK_MODE_DEFAULT;
    const previous = hkCurrentMode;
    hkCurrentMode = mode;
    applyHKModeClasses();
    await updateHKSetting("mode", mode);
    if (globalThis.HKModes?.setMode) {
      hkIgnoreModeEventDepth += 1;
      try {
        await HKModes.setMode(mode);
      } catch (error) {
        console.warn("[HK] Failed to sync HKModes", error);
      } finally {
        hkIgnoreModeEventDepth = Math.max(0, hkIgnoreModeEventDepth - 1);
      }
    }
    if (mode !== previous || options.forceEmit) {
      emitHKModeChanged(mode, { reason: options.reason || "panel" });
      logHKDevEvent(`[Mode] ${previous} -> ${mode}`, options.meta || null);
    }
    return mode;
  }

  async function requestHKModeChange(nextMode) {
    try {
      const mode = nextMode === "manga" ? "manga" : "image";
      if (mode === "manga") {
        if (!hkMangaEnabled) {
          recordUserNotice("warn", "Manga mode is disabled in settings.");
          return;
        }
        await ensureHKMangaPanelReady();
      }
      if (mode === hkCurrentMode) return;
      await setHKMode(mode, { reason: "user" });
    } catch (error) {
      console.error("[HK] Failed to switch mode", error);
      recordUserNotice("error", "Unable to switch modes right now.");
    }
  }

  async function initHKModeSection() {
    await loadHKSettingsSnapshot(false);
    hkModeButtons = Array.from(document.querySelectorAll(".hk-mode-btn"));
    hkModeToggleEl = document.querySelector(".hk-mode-toggle");
    hkUrlInputEl = document.getElementById("hkUrlInput");
    hkListButtonEl = document.getElementById("hkListChapters");
    hkDetectButtonEl = document.getElementById("hkDetectConnector");
    hkDetectedConnectorLabelEl = document.getElementById("hkDetectedConnectorLabel");
    hkConnectorPickerEl = document.getElementById("hkConnectorPicker");
    hkConnectorPickerSelectEl = document.getElementById("hkConnectorPickerSelect");
    hkConnectorPickerApplyEl = document.getElementById("hkConnectorPickerApply");
    hkConnectorPickerCloseEl = document.getElementById("hkConnectorPickerClose");
    hkConnectorSelectEl = document.getElementById("hkConnectorSelect");
    hkRefreshConnectorBtn = document.getElementById("hkRefreshConnectorIndex");
    hkSeriesSearchInputEl = document.getElementById("hkSeriesSearchInput");
    hkSeriesResultsEl = document.getElementById("hkSeriesResults");
    hkSeriesSearchStatusEl = document.getElementById("hkSeriesSearchStatus");
    hkRefreshSeriesCatalogBtn = document.getElementById("hkRefreshSeriesCatalog");
    hkDownloadButtonEl = document.getElementById("hkDownloadChapter");
    hkDownloadButtonDefaultLabel = hkDownloadButtonEl?.textContent?.trim() || hkDownloadButtonDefaultLabel || "Download";
    hkChapterListEl = document.getElementById("hkChapterList");
    hkChapterSummaryEl = document.getElementById("hkChapterSummary");
    hkMangaStatusEl = document.getElementById("hkMangaStatus");
    hkMangaStatusTextEl = document.getElementById("hkMangaStatusText") || hkMangaStatusEl;
    hkRetryRunnerBtn = document.getElementById("hkRetryRunnerBtn");
    if (hkRetryRunnerBtn) {
      hkRetryRunnerBtn.addEventListener("click", handleHKRunnerRetryClick);
    }
    hkShowPreviewButtonEl = document.getElementById("hkShowPreview");
    hkPreviewGridEl = document.getElementById("hkPreviewGrid");
    hkPreviewStatusEl = document.getElementById("hkPreviewStatus");
    if (hkConnectorPickerApplyEl) {
      hkConnectorPickerApplyEl.addEventListener("click", () => {
        handleHKConnectorPickerSubmit();
      });
    }
    if (hkConnectorPickerCloseEl) {
      hkConnectorPickerCloseEl.addEventListener("click", () => {
        handleHKConnectorPickerCancel();
      });
    }
    if (hkShowPreviewButtonEl) {
      hkShowPreviewButtonEl.dataset.loading = "false";
      hkShowPreviewButtonEl.addEventListener("click", handleHKShowPreviewClick);
    }
    hkMangaPanelEl = document.getElementById("hkMangaPanel");
    hkImagePanelEl = document.getElementById("hkImagePanel");
    bindMangaSettingsToggle();
    bindHKLoaderSelect();
    bindHKResetButton();

    if (hkModeButtons.length) {
      hkModeButtons.forEach((button) => {
        button.addEventListener("click", () => requestHKModeChange(button.dataset.mode));
        button.addEventListener("keydown", (event) => {
          const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
          if (!keys.includes(event.key)) {
            return;
          }
          event.preventDefault();
          const currentIndex = hkModeButtons.indexOf(button);
          let nextIndex = currentIndex;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % hkModeButtons.length;
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            nextIndex = (currentIndex - 1 + hkModeButtons.length) % hkModeButtons.length;
          } else if (event.key === "Home") {
            nextIndex = 0;
          } else if (event.key === "End") {
            nextIndex = hkModeButtons.length - 1;
          }
          const target = hkModeButtons[nextIndex];
          target?.focus();
          if (target?.dataset?.mode) {
            requestHKModeChange(target.dataset.mode);
          }
        });
      });
    }

    if (globalThis.HKModes?.onChanged) {
      HKModes.onChanged(async ({ mode }) => {
        if (hkIgnoreModeEventDepth > 0) {
          hkIgnoreModeEventDepth = Math.max(0, hkIgnoreModeEventDepth - 1);
          return;
        }
        if (mode === "manga" && !hkMangaEnabled) {
          await setHKMode(HK_MODE_DEFAULT, { reason: "manga-disabled", forceEmit: true });
          return;
        }
        const nextMode = mode === "manga" ? "manga" : HK_MODE_DEFAULT;
        hkCurrentMode = nextMode;
        applyHKModeClasses();
        await updateHKSetting("mode", nextMode);
        emitHKModeChanged(nextMode, { reason: "external" });
        logHKDevEvent(`[Mode] External -> ${nextMode}`);
      });
    } else {
      hkIgnoreModeEventDepth = 0;
    }
    applyHKModeClasses();
    if (hkMangaEnabled && hkCurrentMode === "manga") {
      await ensureHKMangaPanelReady().catch(() => {
        hkCurrentMode = HK_MODE_DEFAULT;
        applyHKModeClasses();
      });
    }
    updateHKDetectedConnectorLabel();
  }

  async function initHKMangaPanel() {
    if (hkMangaInitialized) return;
    hkSeriesTitleEl = document.getElementById("hkSeriesTitleLabel");
    hkIncludeComicInfoEl = document.getElementById("hkIncludeComicInfo");
    hkIncludeEpubEl = document.getElementById("hkIncludeEpub");
    hkBookmarkButtonEl = document.getElementById("hkBookmarkSeries");
    await loadHKSettingsSnapshot();
    hkIncludeComicInfoEl?.addEventListener("change", (event) => {
      updateHKSetting("manga.includeComicInfo", !!event.target.checked);
    });
    hkIncludeEpubEl?.addEventListener("change", (event) => {
      updateHKSetting("manga.includeEPUB", !!event.target.checked);
    });
    if (hkBookmarkButtonEl) {
      hkBookmarkButtonEl.addEventListener("click", handleHKBookmarkClick);
    }
    hkUrlInputEl?.addEventListener("input", () => {
      updateHKBookmarkButtonState();
      renderHKConnectorSelect();
    });
    if (hkConnectorSelectEl) {
      hkConnectorSelectEl.addEventListener("change", handleHKConnectorSelectChange);
    }
    if (hkRefreshConnectorBtn) {
      hkRefreshConnectorBtn.addEventListener("click", () => hkLoadConnectorIndex(true).catch(() => { }));
    }
    if (hkSeriesSearchInputEl) {
      hkSeriesSearchInputEl.addEventListener("input", applyHKSeriesSearchFilter);
    }
    if (hkRefreshSeriesCatalogBtn) {
      hkRefreshSeriesCatalogBtn.addEventListener("click", () => refreshHKSeriesCatalog({ force: true }));
    }
    updateHKChapterSummary();
    hkDetectButtonEl?.addEventListener("click", handleHKDetectConnectorClick);
    hkListButtonEl?.addEventListener("click", handleHKListChaptersClick);
    hkDownloadButtonEl?.addEventListener("click", handleHKDownloadChapterClick);
    hkChapterListEl?.addEventListener("change", hkHandleChapterSelection);
    await hkLoadConnectorIndex();
    const tabUrl = await hkGetActiveTabUrl();
    if (hkUrlInputEl && tabUrl) {
      hkUrlInputEl.value = tabUrl;
    }
    renderHKConnectorSelect();
    updateHKBookmarkButtonState();
    updateHKSeriesTitleLabel();
    refreshHKSeriesTitle("init").catch(() => { });
    maybeAutoDetectConnector().catch(() => { });
    updateHKDownloadButtonState();
    hkMangaInitialized = true;
  }

  function hideHKRunnerRetryHint() {
    hkRunnerRetryAction = null;
    hkForceNextLoader = null;
    if (hkRetryRunnerBtn) {
      hkRetryRunnerBtn.hidden = true;
      hkRetryRunnerBtn.disabled = false;
    }
  }

  function showHKRunnerRetryHint(action = "list") {
    hkRunnerRetryAction = action || "list";
    if (hkRetryRunnerBtn) {
      hkRetryRunnerBtn.hidden = false;
      hkRetryRunnerBtn.disabled = false;
    }
  }

  async function handleHKRunnerRetryClick() {
    if (!hkRetryRunnerBtn || hkRetryRunnerBtn.disabled) return;
    hkRetryRunnerBtn.disabled = true;
    hkForceNextLoader = "runner";
    hkSetMangaStatus("Retrying with runner...", "info", { keepRunnerHint: true, loading: true });
    const action = hkRunnerRetryAction || "list";
    try {
      if (action === "download") {
        await handleHKDownloadChapterClick();
      } else {
        await handleHKListChaptersClick();
      }
    } catch (error) {
      console.error("[HK] Runner retry failed", error);
      hkSetMangaStatus(error?.message || "Retry failed.", "error");
    } finally {
      hkForceNextLoader = null;
      if (hkRetryRunnerBtn) {
        hkRetryRunnerBtn.disabled = false;
      }
    }
  }

  function hkSetMangaStatus(message, tone = "info", options = {}) {
    if (!hkMangaStatusEl) return;
    const { keepRunnerHint = false, loading = false } = options || {};
    if (hkMangaStatusTextEl && hkMangaStatusTextEl !== hkMangaStatusEl) {
      hkMangaStatusTextEl.textContent = message || "";
    } else {
      hkMangaStatusEl.textContent = message || "";
    }
    hkMangaStatusEl.dataset.state = tone;
    hkMangaStatusEl.dataset.loading = loading ? "true" : "false";
    hkMangaStatusEl.setAttribute("aria-busy", loading ? "true" : "false");
    if (!keepRunnerHint) {
      hideHKRunnerRetryHint();
    }
  }

  function hkReportWarning(message, suffix = "", options = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    const combined = suffix ? `${text} ${suffix}`.trim() : text;
    hkSetMangaStatus(combined, "warn", { keepRunnerHint: true, loading: false, ...options });
    if (!hkWarningHistory.has(text)) {
      hkWarningHistory.add(text);
      showToast(text, { duration: 5500 });
    }
  }

  function isHKDownloadBusy() {
    const status = hkActiveDownloadJob?.status;
    return status === "running" || status === "canceling";
  }

  function setHKButtonLoadingState(button, loading, labelWhenLoading) {
    if (!button) return;
    if (loading) {
      if (button.dataset.loading === "true") {
        return;
      }
      button.dataset.loading = "true";
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent?.trim() || "";
      }
      if (labelWhenLoading) {
        button.textContent = labelWhenLoading;
      }
      button.disabled = true;
      return;
    }
    if (button.dataset.loading !== "true") {
      return;
    }
    button.dataset.loading = "false";
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }

  function getHKPreferredSeriesTitle(fallback = "manga") {
    if (hkLastMangaResult?.manga?.title) {
      return hkLastMangaResult.manga.title;
    }
    if (hkDetectedSeriesTitle && hkDetectedSeriesTitle.trim()) {
      return hkDetectedSeriesTitle.trim();
    }
    return fallback;
  }

  function updateHKChapterSummary(message) {
    if (!hkChapterSummaryEl) return;
    hkChapterSummaryEl.textContent = message || "Ready to list chapters";
  }

  function updateHKDownloadButtonState() {
    if (!hkDownloadButtonEl) return;
    const status = hkActiveDownloadJob?.status;
    const defaultLabel = hkDownloadButtonDefaultLabel || "Download";
    if (status === "running") {
      hkDownloadButtonEl.textContent = "Cancel download";
      hkDownloadButtonEl.disabled = false;
      hkDownloadButtonEl.setAttribute("data-hk-download-mode", "cancel");
      return;
    }
    if (status === "canceling") {
      hkDownloadButtonEl.textContent = "Canceling...";
      hkDownloadButtonEl.disabled = true;
      hkDownloadButtonEl.setAttribute("data-hk-download-mode", "canceling");
      return;
    }
    hkDownloadButtonEl.textContent = defaultLabel;
    hkDownloadButtonEl.setAttribute("data-hk-download-mode", "download");
    hkDownloadButtonEl.disabled = hkSelectedChapterIds.size === 0;
    updateHKPreviewButtonState();
  }

  function updateHKPreviewButtonState() {
    if (!hkShowPreviewButtonEl) return;
    const busy = isHKDownloadBusy();
    const hasSelection = hkSelectedChapterIds.size > 0;
    if (!busy && hkShowPreviewButtonEl.dataset.loading === "true") {
      return;
    }
    hkShowPreviewButtonEl.disabled = busy || !hasSelection;
  }

  async function cancelActiveHKDownload() {
    if (!hkActiveDownloadJob?.jobId) return;
    if (hkActiveDownloadJob.status === "canceling") {
      return;
    }
    hkActiveDownloadJob.status = "canceling";
    updateHKDownloadButtonState();
    hkSetMangaStatus("Canceling download...", "warn");
    try {
      const adapter = await ensureHKDownloadAdapter();
      await adapter.cancelJob(hkActiveDownloadJob.jobId);
    } catch (error) {
      console.error(error);
      hkSetMangaStatus(error?.message || "Unable to cancel download.", "error");
    }
  }

  function syncHKStateFromSettings() {
    hkMangaEnabled = Boolean(getHKSetting("manga.enabled", false));
    const storedMode = getHKSetting("mode", HK_MODE_DEFAULT);
    hkLoaderMode = normalizeHKLoaderMode(getHKSetting("manga.loader", "auto"));
    hkCurrentMode = storedMode === "manga" ? "manga" : HK_MODE_DEFAULT;
    if (!hkMangaEnabled) {
      hkCurrentMode = HK_MODE_DEFAULT;
    }
    hkBookmarks = normalizeHKBookmarks(getHKSetting(HK_BOOKMARK_STORAGE_PATH, []));
    document.body.classList.toggle("hk-manga-disabled", !hkMangaEnabled);
    updateHKBookmarkButtonState();
  }

  async function loadHKSettingsSnapshot(applyUI = true) {
    const defaults = createHKSafeDefaults();
    let syncResult = {};
    try {
      const [localResult, syncValues] = await Promise.all([
        chrome.storage.local.get({ settings: null }),
        chrome.storage.sync.get({
          [HK_SYNC_KEYS.MODE]: null,
          [HK_SYNC_KEYS.FAMILIES]: null
        })
      ]);
      syncResult = syncValues || {};
      const base = localResult?.settings && typeof localResult.settings === "object"
        ? localResult.settings
        : defaults;
      hkSettingsSnapshot = JSON.parse(JSON.stringify(base));
    } catch {
      hkSettingsSnapshot = JSON.parse(JSON.stringify(defaults));
    }
    if (!hkSettingsSnapshot || typeof hkSettingsSnapshot !== "object") {
      hkSettingsSnapshot = JSON.parse(JSON.stringify(defaults));
    }
    hkSettingsSnapshot.mode = hkSettingsSnapshot.mode === "manga" ? "manga" : HK_MODE_DEFAULT;
    hkSettingsSnapshot.manga = hkSettingsSnapshot.manga && typeof hkSettingsSnapshot.manga === "object"
      ? hkSettingsSnapshot.manga
      : JSON.parse(JSON.stringify(defaults.manga));
    hkSettingsSnapshot.manga.families = buildHKFamilyMap(hkSettingsSnapshot.manga.families);
    const syncMode = syncResult?.[HK_SYNC_KEYS.MODE];
    if (syncMode === "manga" || syncMode === "image") {
      hkSettingsSnapshot.mode = syncMode;
    }
    const syncFamilies = syncResult?.[HK_SYNC_KEYS.FAMILIES];
    if (Array.isArray(syncFamilies)) {
      hkSettingsSnapshot.manga.families = applyHKFamilyList(syncFamilies);
    }
    if (applyUI) {
      applyHKSettingsUI();
    } else {
      syncHKStateFromSettings();
    }
  }

  function applyHKSettingsUI() {
    syncHKStateFromSettings();
    const includeComicInfo = getHKSetting("manga.includeComicInfo", false);
    const includeEpub = getHKSetting("manga.includeEPUB", false);
    const enableToggle = document.getElementById("enableMangaSwitch");
    if (enableToggle) {
      enableToggle.checked = hkMangaEnabled;
    }
    if (hkLoaderSelectEl) {
      hkLoaderSelectEl.value = hkLoaderMode;
      hkLoaderSelectEl.disabled = !hkMangaEnabled;
    }
    if (hkIncludeComicInfoEl) {
      hkIncludeComicInfoEl.checked = Boolean(includeComicInfo);
    }
    if (hkIncludeEpubEl) {
      hkIncludeEpubEl.checked = Boolean(includeEpub);
    }
    applyHKModeClasses();
  }

  function getHKSetting(path, fallback = null) {
    if (!hkSettingsSnapshot || !path) return fallback;
    return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), hkSettingsSnapshot) ?? fallback;
  }

  async function updateHKSetting(path, value) {
    if (!path) return;
    const parts = path.split(".");
    const next = hkSettingsSnapshot ? JSON.parse(JSON.stringify(hkSettingsSnapshot)) : createHKSafeDefaults();
    let cursor = next;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (!cursor[key] || typeof cursor[key] !== "object") {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
    hkSettingsSnapshot = next;
    try {
      await chrome.storage.local.set({ settings: next });
      await mirrorHKSettingToSync(path, next);
    } catch (error) {
      console.warn("[HK] Failed to persist setting", error);
    }
    applyHKSettingsUI();
  }

  async function hkLoadConnectorIndex(force = false) {
    if (!hkConnectorCatalog.length || force) {
      try {
        const res = await fetch(chrome.runtime.getURL("vendor/hakuneko/index.json"));
        const data = await res.json();
        const normalizedData = Array.isArray(data)
          ? data.map(normalizeHKConnectorEntry)
          : [];
        hkConnectorCatalog = dedupeHKConnectorEntries(normalizedData.slice());
        const knownIds = new Set(hkConnectorCatalog.map((entry) => entry?.id).filter(Boolean));
        HK_VIRTUAL_CONNECTORS.forEach((entry) => {
          const normalized = normalizeHKConnectorEntry(entry);
          if (!normalized || !normalized.id || knownIds.has(normalized.id)) return;
          hkConnectorCatalog.push(normalized);
          knownIds.add(normalized.id);
        });
        logHKDevEvent(`[Connectors] Loaded ${hkConnectorCatalog.length} entries`);
      } catch (error) {
        console.error(error);
        hkSetMangaStatus("Unable to load connectors.", "error");
        hkConnectorCatalog = [];
      }
      renderHKConnectorSelect();
    }
    return hkConnectorCatalog;
  }

  function dedupeHKConnectorEntries(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }
    const buckets = new Map();
    for (const entry of entries) {
      if (!entry || !entry.id) continue;
      const key = (canonicalizeConnectorId(entry.id) || entry.id).toLowerCase();
      const existing = buckets.get(key);
      if (!existing || preferHKConnectorEntry(entry, existing)) {
        buckets.set(key, entry);
      }
    }
    return Array.from(buckets.values());
  }

  function connectorMatchesHost(entry, host) {
    if (!host || !entry || !Array.isArray(entry.domains) || !entry.domains.length) {
      return false;
    }
    return entry.domains.some((domain) => hostMatchesDomain(host, String(domain).toLowerCase()));
  }

  function getCurrentConnectorHost() {
    const url = getCurrentSeriesUrl();
    return getHostnameFromUrl(url);
  }

  function renderHKConnectorSelect() {
    if (!hkConnectorSelectEl) return;
    const select = hkConnectorSelectEl;
    const cursor = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Auto-detect";
    select.appendChild(placeholder);
    const host = getCurrentConnectorHost();
    const filtered = hkConnectorCatalog
      .slice()
      .filter((entry) => entry?.id)
      .filter((entry) => {
        if (!host) return true;
        return connectorMatchesHost(entry, host);
      })
      .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id, undefined, { sensitivity: "base" }));
    filtered.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label || entry.id;
      select.appendChild(option);
    });
    const desired = hkDetectedConnectorId || cursor || "";
    select.value = desired;
  }

  function preferHKConnectorEntry(next, prev) {
    const score = (entry) => {
      if (!entry) return 0;
      if (entry.path) return 5; // native connector bundled with HakuNeko
      if (entry.type && entry.type !== "delegate") return 4;
      if (entry.family && entry.module && entry.type === "delegate") return 2;
      if (entry.type === "delegate") return 1;
      return 0;
    };
    const nextScore = score(next);
    const prevScore = score(prev);
    if (nextScore !== prevScore) {
      return nextScore > prevScore;
    }
    const nextLabel = (next?.label || "").toLowerCase();
    const prevLabel = (prev?.label || "").toLowerCase();
    return nextLabel.localeCompare(prevLabel) < 0;
  }

  function getHKConnectorEntryById(connectorId) {
    if (!connectorId) return null;
    const normalized = canonicalizeConnectorId(connectorId);
    return hkConnectorCatalog.find((entry) => canonicalizeConnectorId(entry?.id) === normalized) || null;
  }

  function handleHKConnectorSelectChange(event) {
    const value = canonicalizeConnectorId(event?.target?.value || "");
    if (!value) {
      updateHKDetectedConnectorLabel();
      updateHKSeriesCatalogContext(null);
      return;
    }
    const entry = getHKConnectorEntryById(value);
    if (!entry) {
      event.target.value = hkDetectedConnectorId || "";
      return;
    }
    applyHKDetectedConnector({
      connectorId: entry.id,
      family: entry.family || "",
      source: "manual"
    });
    updateHKSeriesCatalogContext(entry.id, { autoLoad: true });
  }

  function updateHKSeriesCatalogContext(connectorId, { autoLoad = false } = {}) {
    const normalized = canonicalizeConnectorId(connectorId || "");
    if (hkSeriesCatalogState.connectorId !== normalized) {
      hkSeriesCatalogState = { connectorId: normalized, entries: [], filtered: [], baseUrl: "", updatedAt: 0 };
      hkSelectedSeriesId = null;
      if (hkSeriesResultsEl) {
        hkSeriesResultsEl.innerHTML = "";
      }
      if (hkSeriesSearchInputEl) {
        hkSeriesSearchInputEl.value = "";
      }
      if (hkSeriesSearchStatusEl) {
        hkSeriesSearchStatusEl.textContent = normalized
          ? "Series list not loaded."
          : "Select a connector to load series.";
      }
    }
    if (normalized && autoLoad) {
      refreshHKSeriesCatalog({ connectorId: normalized }).catch(() => { });
    }
  }

  function resetHKSeriesSearchState(message = "Series list not loaded.") {
    hkSeriesCatalogState = { connectorId: hkSeriesCatalogState.connectorId, entries: [], filtered: [], baseUrl: "", updatedAt: 0 };
    hkSelectedSeriesId = null;
    if (hkSeriesResultsEl) {
      hkSeriesResultsEl.innerHTML = "";
    }
    if (hkSeriesSearchStatusEl) {
      hkSeriesSearchStatusEl.textContent = message;
    }
  }

  async function refreshHKSeriesCatalog({ connectorId = null, force = false } = {}) {
    const statusEl = hkSeriesSearchStatusEl;
    const targetId = canonicalizeConnectorId(connectorId || hkConnectorSelectEl?.value || hkDetectedConnectorId || "");
    if (!targetId) {
      resetHKSeriesSearchState("Select a connector to load series.");
      return;
    }
    if (!globalThis.hkProxy?.fetchCatalog) {
      if (statusEl) {
        statusEl.textContent = "Series catalog not available.";
      }
      return;
    }
    if (!force) {
      const cached = hkSeriesCatalogCache.get(targetId);
      if (cached) {
        hkSeriesCatalogState = { ...cached };
        applyHKSeriesSearchFilter();
        if (statusEl) {
          statusEl.textContent = cached.entries.length
            ? `Loaded ${cached.entries.length} series (cached)`
            : "Series list is empty.";
        }
        return;
      }
    }
    if (statusEl) {
      statusEl.textContent = "Loading series list...";
    }
    try {
      const payload = buildHKFamiliesPayload({
        connectorId: targetId,
        url: hkSeriesCatalogState.baseUrl || hkUrlInputEl?.value || ""
      });
      const result = await hkProxy.fetchCatalog(payload);
      const rawEntries = Array.isArray(result?.mangas) ? result.mangas : [];
      const normalized = rawEntries.map((entry, index) => ({
        id: entry?.id || entry?.url || `series-${index + 1}`,
        title: entry?.title || entry?.label || `Series ${index + 1}`,
        status: entry?.status || "",
        connectorId: result?.connectorId || targetId
      })).filter((item) => item.id && item.title);
      const info = {
        connectorId: targetId,
        entries: normalized,
        filtered: normalized,
        baseUrl: result?.baseUrl || "",
        updatedAt: Date.now()
      };
      hkSeriesCatalogCache.set(targetId, info);
      hkSeriesCatalogState = { ...info };
      applyHKSeriesSearchFilter();
      if (statusEl) {
        statusEl.textContent = normalized.length
          ? `Loaded ${normalized.length} series`
          : "Series list is empty.";
      }
    } catch (error) {
      console.warn("[HK] Failed to load series catalog", error);
      if (statusEl) {
        statusEl.textContent = error?.message || "Unable to load series.";
      }
    }
  }

  function applyHKSeriesSearchFilter() {
    if (!hkSeriesResultsEl) return;
    const query = (hkSeriesSearchInputEl?.value || "").trim().toLowerCase();
    const source = hkSeriesCatalogState.entries || [];
    const filtered = query
      ? source.filter((entry) => entry.title?.toLowerCase().includes(query))
      : source.slice();
    hkSeriesCatalogState.filtered = filtered;
    renderHKSeriesResults(filtered);
    if (hkSeriesSearchStatusEl && source.length) {
      hkSeriesSearchStatusEl.textContent = filtered.length === source.length
        ? `Showing ${source.length} series`
        : `Showing ${filtered.length} of ${source.length} series`;
    }
  }

  function renderHKSeriesResults(entries = []) {
    if (!hkSeriesResultsEl) return;
    hkSeriesResultsEl.innerHTML = "";
    if (!entries.length) {
      return;
    }
    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.dataset.id = entry.id;
      li.dataset.selected = entry.id === hkSelectedSeriesId ? "true" : "false";
      const title = document.createElement("span");
      title.textContent = entry.title || entry.id;
      li.appendChild(title);
      if (entry.status) {
        const status = document.createElement("small");
        status.textContent = entry.status;
        li.appendChild(status);
      }
      li.tabIndex = 0;
      li.addEventListener("click", () => selectHKSeriesResult(entry));
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectHKSeriesResult(entry);
        }
      });
      fragment.appendChild(li);
    });
    hkSeriesResultsEl.appendChild(fragment);
  }

  function selectHKSeriesResult(entry) {
    if (!entry) return;
    hkSelectedSeriesId = entry.id;
    setHKSeriesTitle(entry.title || entry.id || "");
    const resolvedUrl = resolveHKSeriesEntryUrl(entry);
    if (resolvedUrl && hkUrlInputEl) {
      hkUrlInputEl.value = resolvedUrl;
    }
    renderHKSeriesResults(hkSeriesCatalogState.filtered || []);
  }

  function resolveHKSeriesEntryUrl(entry) {
    if (!entry?.id) return "";
    if (/^https?:\/\//i.test(entry.id)) {
      return entry.id;
    }
    const base = hkSeriesCatalogState.baseUrl || "";
    if (!base) {
      return entry.id;
    }
    try {
      const url = new URL(entry.id, base);
      return url.href;
    } catch {
      return entry.id;
    }
  }

  function normalizeHKConnectorEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return entry;
    }
    const canonicalId = canonicalizeConnectorId(entry.id);
    if (!canonicalId) {
      return entry;
    }
    if (canonicalId === entry.id) {
      return { ...entry, canonicalId };
    }
    return {
      ...entry,
      aliasId: entry.id,
      id: canonicalId,
      canonicalId
    };
  }

  async function hkGetActiveTabInfo() {
    try {
      const tab = await getActiveTab();
      if (tab) {
        hkLastActiveTabInfo = tab;
        return tab;
      }
    } catch {
      // ignore and fall back to the last known tab info
    }
    return hkLastActiveTabInfo || null;
  }

  async function hkGetActiveTabUrl() {
    const tab = await hkGetActiveTabInfo();
    return tab?.url || "";
  }

  function teardownHKChapterVirtualizer() {
    if (hkChapterVirtualizer?.cleanup) {
      try { hkChapterVirtualizer.cleanup(); } catch { }
    }
    hkChapterVirtualizer = null;
    if (hkChapterListEl) {
      hkChapterListEl.style.paddingTop = "";
      hkChapterListEl.style.paddingBottom = "";
    }
  }

  function getHKChapterMetaText(chapter) {
    if (!chapter) return "";
    const parts = [];
    if (chapter.language) parts.push(chapter.language);
    if (chapter.status) parts.push(chapter.status);
    return parts.join(" · ");
  }

  function getHKChapterById(chapterId) {
    if (!chapterId || !hkChapterCache?.length) return null;
    return hkChapterCache.find((chapter) => chapter.id === chapterId) || null;
  }

  function isHKChapterPreviewed(chapterId) {
    return hkChapterPreviewState.has(chapterId);
  }

  function updateHKChapterPreviewIndicator(chapterId) {
    if (!hkChapterListEl || !chapterId) return;
    const safeId = CSS && CSS.escape ? CSS.escape(chapterId) : chapterId.replace(/"/g, '\\"');
    const button = hkChapterListEl.querySelector(`.hk-chapter-preview-btn[data-chapter-id="${safeId}"]`);
    if (button) {
      button.dataset.active = isHKChapterPreviewed(chapterId) ? "true" : "false";
    }
  }

  function disposeHKPreviewResources(record) {
    if (!record || !Array.isArray(record.blobUrls) || !record.blobUrls.length) {
      return;
    }
    record.blobUrls.forEach((url) => {
      if (!url) return;
      try {
        URL.revokeObjectURL(url);
      } catch { }
    });
    record.blobUrls.length = 0;
  }

  function deleteHKPreviewRecord(chapterId, { silent = false } = {}) {
    if (!chapterId || !hkChapterPreviewState.has(chapterId)) {
      return;
    }
    const record = hkChapterPreviewState.get(chapterId);
    disposeHKPreviewResources(record);
    hkChapterPreviewState.delete(chapterId);
    updateHKChapterPreviewIndicator(chapterId);
    removeHKPreviewItems(new Set([chapterId]), { silent: true });
    if (!silent) {
      renderGrid();
      summarize();
    }
  }

  function pruneHKPreviewState() {
    if (!hkChapterPreviewState.size) return;
    const valid = new Set(hkChapterCache.map((chapter) => chapter.id));
    let removed = false;
    Array.from(hkChapterPreviewState.keys()).forEach((chapterId) => {
      if (!valid.has(chapterId)) {
        deleteHKPreviewRecord(chapterId, { silent: true });
        removed = true;
      }
    });
    if (removed) {
      renderGrid();
      summarize();
      renderHKPreviewGrid();
    }
  }

  function renderHKPreviewGrid() {
    if (!hkPreviewGridEl || !hkPreviewStatusEl) return;
    hkPreviewGridEl.innerHTML = "";
    if (!hkChapterPreviewState.size) {
      hkPreviewStatusEl.textContent = "No chapters in preview.";
      return;
    }
    hkPreviewStatusEl.textContent = "";
    hkChapterPreviewState.forEach((record, chapterId) => {
      const section = document.createElement("section");
      section.className = "hk-preview-section";
      const header = document.createElement("div");
      header.className = "hk-preview-header";
      const title = document.createElement("span");
      title.textContent = record.chapter?.title || record.chapter?.id || "Chapter";
      header.appendChild(title);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Close preview for ${record.chapter?.title || record.chapter?.id}`);
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => {
        deleteHKPreviewRecord(chapterId);
        renderHKPreviewGrid();
      });
      header.appendChild(removeBtn);
      section.appendChild(header);
      const body = document.createElement("div");
      body.className = "hk-preview-body";
      if (record.loading) {
        body.textContent = "Loading preview...";
      } else if (record.error) {
        const errorText = document.createElement("div");
        errorText.className = "hk-preview-error";
        errorText.textContent = record.error;
        body.appendChild(errorText);
      } else if (!record.pages?.length) {
        const emptyText = document.createElement("div");
        emptyText.className = "hk-preview-empty";
        emptyText.textContent = "No pages returned.";
        body.appendChild(emptyText);
      } else {
        const grid = document.createElement("div");
        grid.className = "hk-preview-thumbs";
        record.pages.forEach((page, index) => {
          const img = document.createElement("img");
          img.className = "hk-preview-thumb";
          img.loading = "lazy";
          img.src = page.url;
          img.alt = `${record.chapter?.title || "Chapter"} page ${index + 1}`;
          grid.appendChild(img);
        });
        body.appendChild(grid);
      }
      section.appendChild(body);
      hkPreviewGridEl.appendChild(section);
    });
  }

  async function fetchHKPagesForChapter(chapter, loaderOverride = null) {
    if (!chapter) {
      throw new Error("Chapter unavailable.");
    }
    let connectorId = hkDetectedConnectorId;
    if (!connectorId) {
      const detection = await detectConnectorForCurrentContext({ reason: "preview" });
      connectorId = detection?.connectorId || "";
      if (!connectorId) {
        throw new Error("Unable to detect connector.");
      }
    }
    const tabInfo = await hkRequireActiveTabPermission();
    if (!tabInfo) {
      throw new Error("Site permission is required to load pages.");
    }
    const urlValue = hkUrlInputEl?.value?.trim() || tabInfo.url || "";
    const pageRequest = buildHKFamiliesPayload({
      connectorId,
      chapterId: chapter.id,
      chapter,
      manga: hkLastMangaResult?.manga || null,
      url: urlValue,
      tabId: tabInfo?.id ?? null
    });
    pageRequest.loader = loaderOverride || hkLoaderMode;
    const pagesResult = await hkProxy.fetchPages(pageRequest);
    if (pagesResult?.warningCode === "manager-fallback") {
      showHKRunnerRetryHint("download");
    }
    const pages = pagesResult?.pages || [];
    const familyFallback = normalizeHKFamilyKey(
      pagesResult?.family
      || resolveFamilyFromConnectorId(pagesResult?.connectorId || connectorId)
      || hkDetectedFamilyKey
    );
    if (familyFallback) {
      pagesResult.family = familyFallback;
    }
    if (!pages.length) {
      throw new Error("No pages returned for preview.");
    }
    // Return the full result so we have access to family metadata
    return pagesResult;
  }

  async function ensureHKChapterPreview(chapterId) {
    const existing = hkChapterPreviewState.get(chapterId);
    if (existing?.loading) return;
    if (existing?.pages?.length) return;
    if (existing) {
      disposeHKPreviewResources(existing);
    }
    const chapter = getHKChapterById(chapterId);
    if (!chapter) return;
    const record = {
      chapter,
      loading: true,
      error: null,
      pages: [],
      blobUrls: []
    };
    hkChapterPreviewState.set(chapterId, record);
    renderHKPreviewGrid();
    updateHKChapterPreviewIndicator(chapterId);
    try {
      const pagesResult = await fetchHKPagesForChapter(chapter);
      const pages = pagesResult?.pages || [];
      const chapterFamily = normalizeHKFamilyKey(
        pagesResult?.family
        || resolveFamilyFromConnectorId(pagesResult?.connectorId || hkDetectedConnectorId)
        || hkDetectedFamilyKey
      );

      hkDebugLog(`[HK Preview] Chapter "${chapter.title}" - Family: "${chapterFamily}", Pages: ${pages.length}`);

      const resolvedPages = [];
      const failedPages = [];

      /**
       * ⚠️⚠️⚠️ CRITICAL: Per-Chapter Descrambling Decision ⚠️⚠️⚠️
       * 
       * We MUST determine descrambling based on THIS chapter's family metadata,
       * NOT the global hkDetectedFamilyKey variable!
       * 
       * WHY: When processing multiple chapters:
       * - Global state can be overwritten between chapters
       * - Different chapters might theoretically come from different connectors
       * - Async operations can cause race conditions with globals
       * 
       * FIX: Each chapter gets its own family from pagesResult.family,
       * ensuring reliable descrambling regardless of global state.
       * 
       * DO NOT change this to use shouldDescrambleHKPreview() or globals!
       */
      const needDescramble = chapterFamily === "coreview" || chapterFamily === "gigaviewer";

      if (needDescramble) {
        hkDebugLog(`[HK Preview] ✅ Descrambling ENABLED for chapter "${chapter.title}" (family: "${chapterFamily}")`);
      } else {
        hkDebugLog(`[HK Preview] ℹ️  No descrambling needed for chapter "${chapter.title}" (family: "${chapterFamily}")`);
      }

      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        const sourceUrl = typeof page === "string" ? page : (page?.url || page?.src || "");

        try {
          const resolved = await resolveHKPreviewPageUrl(sourceUrl, record);
          if (resolved?.url) {
            if (needDescramble) {
              const processed = await descrambleHKCoreViewImage(resolved, record);
              if (processed?.url) {
                resolved.url = processed.url;
                resolved.displayUrl = processed.url;
                resolved.mime = processed.mime || resolved.mime;
                resolved.size = processed.size ?? resolved.size;
                resolved.width = processed.width ?? resolved.width;
                resolved.height = processed.height ?? resolved.height;
              }
            }
            const mime = resolved.mime || page?.mime || hkGuessMimeFromUrl(sourceUrl, "");
            resolvedPages.push({
              url: resolved.url,
              displayUrl: resolved.url,
              sourceUrl,
              width: page?.width ?? null,
              height: page?.height ?? null,
              mime: mime || null,
              size: page?.size ?? null,
              index
            });
          } else {
            failedPages.push({ index, url: sourceUrl, reason: "Resolution returned null" });
          }
        } catch (error) {
          failedPages.push({ index, url: sourceUrl, reason: error?.message || String(error) });
          console.warn(`[HK Preview] Failed to resolve page ${index + 1}:`, sourceUrl, error);
        }
      }

      hkDebugLog(`[HK Preview] Successfully resolved ${resolvedPages.length}/${pages.length} page(s)`);
      if (failedPages.length > 0) {
        console.warn(`[HK Preview] ${failedPages.length} page(s) failed to resolve:`, failedPages);
      }

      record.pages = resolvedPages;
      record.loading = false;
      hkChapterPreviewState.set(chapterId, record);

      if (resolvedPages.length) {
        await addHKPreviewItems(chapter, resolvedPages);
      } else if (pages.length > 0) {
        // Pages were fetched but ALL failed to resolve - this is an error condition
        const errorMsg = `Failed to load any pages: ${failedPages.length} page(s) failed to resolve. Check console for details.`;
        record.error = errorMsg;
        console.error(`[HK Preview] ${errorMsg}`);
        hkSetMangaStatus(errorMsg, "error", { loading: false });
      }
    } catch (error) {
      record.loading = false;
      record.error = error?.message || "Failed to load preview.";
      console.error("[HK Preview] Chapter preview failed:", error);
    }
    renderHKPreviewGrid();
    updateHKChapterPreviewIndicator(chapterId);
  }

  async function toggleHKChapterPreviewById(chapterId) {
    if (!chapterId) return;
    const record = hkChapterPreviewState.get(chapterId);
    if (record?.loading) return;
    if (record?.pages?.length || record?.error) {
      deleteHKPreviewRecord(chapterId);
      renderHKPreviewGrid();
      return;
    }
    await ensureHKChapterPreview(chapterId);
  }

  function hkGuessMimeFromUrl(url, fallback = "") {
    if (!url) return fallback || "";
    try {
      const base = typeof location !== "undefined" && location?.href ? location.href : "http://localhost/";
      const parsed = new URL(url, base);
      const pathname = parsed.pathname || "";
      const match = pathname.match(/\.([a-z0-9]+)(?:$|[?#])/i);
      const extension = match ? match[1].toLowerCase() : "";
      if (!extension) {
        return fallback || "";
      }
      switch (extension) {
        case "jpg":
        case "jpeg":
        case "pjpeg":
          return "image/jpeg";
        case "png":
          return "image/png";
        case "webp":
          return "image/webp";
        case "gif":
          return "image/gif";
        case "bmp":
          return "image/bmp";
        case "avif":
          return "image/avif";
        case "svg":
          return "image/svg+xml";
        default:
          return fallback || "";
      }
    } catch {
      return fallback || "";
    }
  }

  async function resolveHKPreviewPageUrl(url, record) {
    if (!url) {
      console.warn("[HK Preview] Page URL is empty or null");
      return null;
    }
    if (!url.startsWith("connector://")) {
      return { url, mime: hkGuessMimeFromUrl(url, "") };
    }
    if (!globalThis.hkProxy?.fetchConnectorPayload) {
      console.error("[HK Preview] Connector previews are unavailable - hkProxy.fetchConnectorPayload not found");
      throw new Error("Connector previews are unavailable.");
    }
    try {
      const payload = await hkProxy.fetchConnectorPayload({ url });
      if (!payload || !payload.data) {
        console.error("[HK Preview] Connector returned empty payload for URL:", url);
        throw new Error("Connector returned an empty payload.");
      }
      const normalized = hkNormalizeConnectorBuffer(payload);
      const mimeType = typeof payload.mimeType === "string" && payload.mimeType
        ? payload.mimeType
        : "application/octet-stream";
      const blob = new Blob([normalized], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      if (record && Array.isArray(record.blobUrls)) {
        record.blobUrls.push(objectUrl);
      }
      return { url: objectUrl, mime: mimeType, blob };
    } catch (error) {
      console.error("[HK Preview] Failed to resolve connector URL:", url, error);
      throw error;
    }
  }

  function hkNormalizeConnectorBuffer(payload) {
    if (!payload) {
      return new Uint8Array(0).buffer;
    }
    if (payload.encoding === "base64") {
      const bytes = hkBase64ToUint8Array(payload.data || "");
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    const raw = (payload && Object.prototype.hasOwnProperty.call(payload, "data"))
      ? payload.data
      : payload;
    const u8 = hkCoerceUint8Array(raw);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  /**
   * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION
   * This function determines whether CoreView/GigaViewer images need descrambling.
   * Connectors like ComicAction, ComicEarthStar, and other CoreView-based sites
   * REQUIRE descrambling to display images correctly.
   * 
   * Changes to this logic will break image display for ALL CoreView family sites.
   * See: HK_HOST_CONNECTOR_OVERRIDES (lines 174-185) for site mappings.
   */
  /**
   * ⚠️⚠️⚠️ CRITICAL - DO NOT MODIFY THIS FUNCTION ⚠️⚠️⚠️
   * 
   * This function determines whether CoreView/GigaViewer images need descrambling.
   * Connectors like ComicAction, ComicEarthStar, and other CoreView-based sites
   * REQUIRE descrambling to display images correctly.
   * 
   * HOW IT WORKS:
   * 1. Checks hkDetectedFamilyKey (primary source)
   * 2. If missing, attempts to resolve family from hkDetectedConnectorId via catalog
   * 3. If still missing, checks HK_HOST_CONNECTOR_OVERRIDES for the current host
   * 4. Returns true if family is "coreview" or "gigaviewer"
   * 
   * DEPENDENCIES:
   * - normalizeHKFamilyKey() function
   * - HK_HOST_CONNECTOR_OVERRIDES (lines 182-193)
   * - vendor/hakuneko/index.json
   * 
   * MODIFYING THIS WILL BREAK IMAGE DISPLAY FOR 15+ COREVIEW SITES.
   * Users will see scrambled/corrupted images.
   */
  function shouldDescrambleHKPreview() {
    // 1. Primary check: Detected family
    let family = normalizeHKFamilyKey(hkDetectedFamilyKey);

    // 2. Fallback: If family not set, try to derive it from connector ID
    if (!family && hkDetectedConnectorId) {
      // Try catalog resolution
      family = resolveFamilyFromConnectorId(hkDetectedConnectorId);

      // 3. Fallback: Check host overrides if we are on that host
      if (!family) {
        const host = getHostnameFromUrl(hkUrlInputEl?.value || hkLastActiveTabInfo?.url);
        const override = HK_HOST_CONNECTOR_OVERRIDES[host];
        if (override && override.connectorId === hkDetectedConnectorId) {
          family = normalizeHKFamilyKey(override.family);
        }
      }
    }

    // Fallback for legacy behavior: check if connector ID itself is the family key (rare)
    if (!family && hkDetectedConnectorId) {
      family = normalizeHKFamilyKey(hkDetectedConnectorId);
    }

    hkDebugLog(`[HK Descramble] Checking descramble for family: "${family}" (detectedFamily: "${hkDetectedFamilyKey}", connectorId: "${hkDetectedConnectorId}")`);

    // Check both coreview and gigaviewer (legacy name)
    const needsDescramble = family === "coreview" || family === "gigaviewer";

    if (needsDescramble) {
      hkDebugLog(`[HK Descramble] ✅ Descrambling ENABLED for family: "${family}"`);
    } else {
      hkDebugLog(`[HK Descramble] ℹ️ No descrambling needed for family: "${family}"`);
    }

    return needsDescramble;
  }

  /**
   * ⚠️⚠️⚠️ CRITICAL - DO NOT MODIFY THE DESCRAMBLING ALGORITHM ⚠️⚠️⚠️
   * 
   * This function descrambles CoreView/GigaViewer images using a 4x4 tile scrambling algorithm.
   * CoreView sites scramble images by shuffling 16 tiles in a specific pattern.
   * 
   * SITES THAT DEPEND ON THIS:
   * - ComicAction, ComicBorder, ComicBushi, ComicDays, ComicEarthStar, ComicGardo
   * - ComicTrail, ComicZenon, MagComi, ShonenJumpPlus, ShonenMagazine
   * - ShonenMagazinePocket, SundayWebry, TonariNoYoungJump, and more...
   * 
   * MODIFYING THIS WILL:
   * - Break image display for ALL CoreView family connectors
   * - Show users scrambled/corrupted images
   * - Require manual testing on 15+ different manga sites to verify fix
   * 
   * DO NOT:
   * - Change the DIVIDE_NUM (4) or MULTIPLE (8) constants
   * - Modify the tile calculation logic (lines 3220-3233)
   * - Change the canvas drawing operations
   * - Remove console logging (used for debugging)
   * 
   * See CoreView.mjs in hakuneko-runtime for the original algorithm.
   */
  async function descrambleHKCoreViewImage(resolved, record) {
    const sourceUrl = resolved?.url || "";
    if (!sourceUrl) {
      console.warn("[HK Descramble] No source URL provided for descrambling");
      return null;
    }

    hkDebugLog("[HK Descramble] 🔄 Starting CoreView descrambling for:", sourceUrl.substring(0, 100));
    let blob = resolved?.blob || null;
    try {
      if (!blob) {
        const response = await fetch(sourceUrl);
        blob = await response.blob();
      }
      const bitmap = await createImageBitmap(blob);
      const DIVIDE_NUM = 4;
      const MULTIPLE = 8;
      const canvas = document.createElement("canvas");
      const width = bitmap.width;
      const height = bitmap.height;
      const cellWidthBase = Math.floor(width / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE;
      const cellHeightBase = Math.floor(height / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE;
      const cellWidth = cellWidthBase > 0 ? cellWidthBase : Math.floor(width / DIVIDE_NUM) || width / DIVIDE_NUM;
      const cellHeight = cellHeightBase > 0 ? cellHeightBase : Math.floor(height / DIVIDE_NUM) || height / DIVIDE_NUM;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height, 0, 0, width, height);
      for (let e = 0; e < DIVIDE_NUM * DIVIDE_NUM; e++) {
        const t = Math.floor(e / DIVIDE_NUM) * cellHeight;
        const n = (e % DIVIDE_NUM) * cellWidth;
        const r = Math.floor(e / DIVIDE_NUM);
        const i = e % DIVIDE_NUM * DIVIDE_NUM + r;
        const o = (i % DIVIDE_NUM) * cellWidth;
        const s = Math.floor(i / DIVIDE_NUM) * cellHeight;
        ctx.drawImage(bitmap, n, t, cellWidth, cellHeight, o, s, cellWidth, cellHeight);
      }
      if (typeof bitmap.close === "function") {
        try { bitmap.close(); } catch { }
      }
      const descrambledBlob = await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob);
        }, "image/png");
      });
      const objectUrl = URL.createObjectURL(descrambledBlob);

      hkDebugLog(`[HK Descramble] ✅ CoreView descrambling completed successfully (${width}x${height})`);

      if (record && Array.isArray(record.blobUrls)) {
        record.blobUrls.push(objectUrl);
      }
      return { url: objectUrl, mime: "image/png", blob: descrambledBlob, width, height };
    } catch (err) {
      console.warn("HK preview descramble failed:", err);
      return null;
    }
  }

  function hkCoerceUint8Array(value) {
    if (value == null) {
      return new Uint8Array(0);
    }
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    if (typeof value === "string") {
      return new TextEncoder().encode(value);
    }
    if (Array.isArray(value)) {
      return new Uint8Array(value);
    }
    if (typeof value === "object") {
      if (value.type === "Buffer" && Array.isArray(value.data)) {
        return new Uint8Array(value.data);
      }
      if (Array.isArray(value.data)) {
        return new Uint8Array(value.data);
      }
      if (value.data) {
        return hkCoerceUint8Array(value.data);
      }
      const numericKeys = Object.keys(value).filter((key) => /^\d+$/.test(key));
      if (numericKeys.length) {
        numericKeys.sort((a, b) => Number(a) - Number(b));
        return new Uint8Array(numericKeys.map((key) => Number(value[key]) & 0xff));
      }
    }
    throw new Error("Connector payload is malformed.");
  }

  function hkBase64ToUint8Array(base64) {
    if (!base64) {
      return new Uint8Array(0);
    }
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function removeHKPreviewItems(chapterIds = null, { silent = false } = {}) {
    const targets = chapterIds
      ? new Set(Array.from(chapterIds).filter(Boolean))
      : null;
    let changed = false;
    const next = [];
    for (const item of CACHE) {
      if (item?.__source !== HK_PREVIEW_SOURCE) {
        next.push(item);
        continue;
      }
      if (targets && item.__chapterId && !targets.has(item.__chapterId)) {
        next.push(item);
        continue;
      }
      changed = true;
    }
    if (changed) {
      CACHE = next;
      syncSelectionWithCache();
      if (!silent) {
        renderGrid();
        summarize();
      }
    }
    return changed;
  }

  function buildHKPreviewItems(chapter, pages) {
    if (!chapter || !Array.isArray(pages)) return [];
    const chapterId = chapter.id || chapter.url || chapter.title || `chapter-${Date.now()}`;
    const chapterTitle = chapter.title || chapterId;
    const chapterFolder = sanitizeFilenameStem(chapterTitle, "chapter");
    return pages
      .map((page, index) => {
        const displayUrl = typeof page === "string"
          ? page
          : (page?.url || page?.displayUrl || page?.src || "");
        if (!displayUrl) return null;
        const sourceUrl = page?.sourceUrl || page?.rawUrl || displayUrl;
        const pageMime = typeof page?.mime === "string" && page.mime ? page.mime : "";
        const extensionFromMime = sanitizeExtension(mimeToExtension(pageMime) || "");
        const extension = extensionFromMime || sanitizeExtension(ext(sourceUrl || displayUrl || "")) || "png";
        const pageLabel = `Page ${String(index + 1).padStart(3, "0")}`;
        const filename = `${chapterFolder}/${pageLabel}.${extension || "png"}`;
        const width = Number(page?.width);
        const height = Number(page?.height);
        const size = Number(page?.size);
        return {
          url: displayUrl,
          rawUrl: sourceUrl || displayUrl,
          filename,
          kind: "manga",
          width: Number.isFinite(width) ? width : undefined,
          height: Number.isFinite(height) ? height : undefined,
          size: Number.isFinite(size) ? size : undefined,
          mime: pageMime || hkGuessMimeFromUrl(sourceUrl || displayUrl || "", "") || undefined,
          __source: HK_PREVIEW_SOURCE,
          __chapterId: chapterId,
          __chapterTitle: chapterTitle,
          __chapterFolder: chapterFolder,
          __chapterIndex: index + 1
        };
      })
      .filter(Boolean);
  }

  async function addHKPreviewItems(chapter, pages) {
    const items = buildHKPreviewItems(chapter, pages);
    if (!items.length) {
      return;
    }
    removeHKPreviewItems(new Set([chapter?.id || chapter?.title]), { silent: true });
    CURRENT_SCAN_ID = ++SCAN_SEQUENCE;
    await incrementStat("scans", 1);
    await incrementStat("imagesScanned", items.length);
    annotateDiscovery(items, CURRENT_SCAN_ID);
    CACHE = CACHE.concat(items);
    items.forEach((item) => {
      if (item?.url) {
        SELECTED.add(item.url);
      }
    });
    renderGrid();
    summarize();
    const chapterTitle = chapter?.title || chapter?.id || "Chapter";
    hkSetMangaStatus(`${chapterTitle}: ${items.length} page(s) added to the panel grid.`, "ok", { loading: false });
  }

  async function handleHKShowPreviewClick() {
    if (!hkSelectedChapterIds.size) {
      hkSetMangaStatus("Select at least one chapter first.", "warn");
      return;
    }
    hkSetMangaStatus("Sending to panel...", "info", { loading: true });
    if (hkShowPreviewButtonEl) {
      hkShowPreviewButtonEl.disabled = true;
      hkShowPreviewButtonEl.dataset.loading = "true";
      hkShowPreviewButtonEl.textContent = "Sending...";
    }
    try {
      const targets = Array.from(hkSelectedChapterIds);
      targets.forEach((chapterId) => deleteHKPreviewRecord(chapterId, { silent: true }));
      if (targets.length) {
        renderGrid();
        summarize();
      }
      for (const chapterId of targets) {
        // eslint-disable-next-line no-await-in-loop
        await ensureHKChapterPreview(chapterId);
      }
      hkSetMangaStatus("Pages sent to panel.", "ok", { loading: false });
    } catch (error) {
      hkSetMangaStatus(error?.message || "Failed to send pages to panel.", "error", { loading: false });
    } finally {
      if (hkShowPreviewButtonEl) {
        hkShowPreviewButtonEl.dataset.loading = "false";
        hkShowPreviewButtonEl.textContent = hkShowPreviewButtonEl.dataset.originalLabel || "Send to panel";
        updateHKPreviewButtonState();
      }
      hkMangaStatusEl?.removeAttribute("data-loading");
    }
  }

  async function handleHKChapterZip(chapterId, triggerButton) {
    if (!chapterId) return;
    stopActiveScan("Scan stopped to prepare chapter ZIP.");
    const chapter = getHKChapterById(chapterId);
    if (!chapter) {
      hkSetMangaStatus("Chapter unavailable.", "warn");
      return;
    }
    if (triggerButton) {
      triggerButton.disabled = true;
      triggerButton.dataset.loading = "true";
    }
    try {
      hkSetMangaStatus(`Preparing ${chapter.title || chapterId}...`, "info", { loading: true });
      await ensureHKChapterPreview(chapterId);
      const items = CACHE.filter((item) => item?.__source === HK_PREVIEW_SOURCE && item.__chapterId === chapterId);
      if (!items.length) {
        throw new Error("Preview images are unavailable. Use the eye button first.");
      }
      const sortedItems = items.slice().sort((a, b) => {
        const ai = Number(a.__chapterIndex) || 0;
        const bi = Number(b.__chapterIndex) || 0;
        return ai - bi;
      });
      startProgress(`Packing ${chapter.title || chapterId}`, sortedItems.length);
      await zipChapterItems(chapter, sortedItems);
      await recordDownloadSuccess(sortedItems.length);
      finishProgress(t("label_progress_done", "Done"));
      hkSetMangaStatus(`${chapter.title || chapterId}: archive ready.`, "ok");
    } catch (error) {
      if (progressState) {
        finishProgress(error?.message === "Operation cancelled." ? "Cancelled." : "Stopped.");
      }
      const message = error?.message || "Chapter download failed.";
      hkSetMangaStatus(message, "error");
    } finally {
      if (triggerButton) {
        delete triggerButton.dataset.loading;
        triggerButton.disabled = false;
      }
    }
  }

  function createHKChapterListItem(chapter, index) {
    const li = document.createElement("li");
    li.className = "hk-chapter-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "hkChapterChoice";
    checkbox.value = chapter.id || `chapter-${index}`;
    checkbox.id = `hkChapter-${index}`;
    checkbox.checked = hkSelectedChapterIds.has(checkbox.value);
    const label = document.createElement("label");
    label.setAttribute("for", checkbox.id);
    const title = document.createElement("span");
    title.textContent = chapter.title || `Chapter ${index + 1}`;
    title.style.cursor = "pointer";
    title.title = `Click to view/edit: ${chapter.id}`;

    // Click to edit handler
    title.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const newUrl = prompt(`Edit chapter URL:\n\nCurrent: ${chapter.id}`, chapter.id);
      if (newUrl && newUrl.trim() && newUrl !== chapter.id) {
        const newTitle = prompt(`Edit chapter title:\n\nCurrent: ${chapter.title}`, chapter.title);
        if (newTitle && newTitle.trim()) {
          chapter.id = newUrl.trim();
          chapter.title = newTitle.trim();
          // Re-render
          renderHKChapters(hkChapterCache);
          showToast && showToast(`Updated: ${newTitle}`);
        }
      }
    });

    label.appendChild(title);

    // Add manual badge if this chapter was manually added
    if (chapter._manual) {
      const manualBadge = document.createElement("small");
      manualBadge.textContent = "✨ Manually added";
      manualBadge.style.color = "var(--accent)";
      manualBadge.style.marginLeft = "6px";
      label.appendChild(manualBadge);
    }

    const metaText = getHKChapterMetaText(chapter);
    if (metaText) {
      const meta = document.createElement("small");
      const metaId = `hkChapterMeta-${index}`;
      meta.id = metaId;
      meta.textContent = metaText;
      label.appendChild(meta);
      checkbox.setAttribute("aria-describedby", metaId);
    }
    li.appendChild(checkbox);
    li.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "hk-chapter-actions";
    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "hk-chapter-preview-btn";
    previewButton.innerHTML = "&#128065;";
    previewButton.dataset.chapterId = checkbox.value;
    previewButton.dataset.active = isHKChapterPreviewed(checkbox.value) ? "true" : "false";
    previewButton.setAttribute("aria-label", `Toggle preview for ${chapter.title || `Chapter ${index + 1}`}`);
    previewButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleHKChapterPreviewById(checkbox.value);
    });
    actions.appendChild(previewButton);
    const zipButton = document.createElement("button");
    zipButton.type = "button";
    zipButton.className = "hk-chapter-zip-btn";
    zipButton.textContent = "ZIP";
    zipButton.dataset.chapterId = checkbox.value;
    zipButton.setAttribute("aria-label", `Download ${chapter.title || `Chapter ${index + 1}`} as ZIP`);
    zipButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleHKChapterZip(checkbox.value, zipButton);
    });
    actions.appendChild(zipButton);
    li.appendChild(actions);
    return li;
  }

  function measureHKChapterItemHeight(sampleChapter = {}) {
    if (!hkChapterListEl) {
      return 48;
    }
    const probe = createHKChapterListItem(sampleChapter, 0);
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    hkChapterListEl.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    const height = Math.max(32, Math.round(rect.height || probe.offsetHeight || 48));
    hkChapterListEl.removeChild(probe);
    return height;
  }

  function renderHKVirtualChapterWindow(state, force = false) {
    if (!hkChapterListEl || !state) return;
    const total = state.chapters.length;
    if (!total) {
      hkChapterListEl.innerHTML = "";
      hkChapterListEl.style.paddingTop = "0px";
      hkChapterListEl.style.paddingBottom = "0px";
      return;
    }
    if (!state.itemHeight) {
      state.itemHeight = measureHKChapterItemHeight(state.chapters[0] || {});
    }
    const listHeight = hkChapterListEl.clientHeight || state.itemHeight;
    const visibleCount = Math.max(1, Math.ceil(listHeight / state.itemHeight));
    const overscan = HK_VIRTUALIZE_OVERSCAN;
    const scrollTop = hkChapterListEl.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / state.itemHeight) - overscan);
    const end = Math.min(total, start + visibleCount + overscan * 2);
    if (!force && start === state.start && end === state.end) {
      return;
    }
    state.start = start;
    state.end = end;
    hkChapterListEl.innerHTML = "";
    hkChapterListEl.style.paddingTop = `${start * state.itemHeight}px`;
    hkChapterListEl.style.paddingBottom = `${Math.max(0, total - end) * state.itemHeight}px`;
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      fragment.appendChild(createHKChapterListItem(state.chapters[index], index));
    }
    hkChapterListEl.appendChild(fragment);
  }

  function initHKChapterVirtualizer(chapters) {
    if (!hkChapterListEl) return;
    const state = {
      chapters,
      itemHeight: 0,
      start: 0,
      end: 0,
      raf: null,
      cleanup: null
    };
    const handleScroll = () => {
      if (state.raf) return;
      state.raf = requestAnimationFrame(() => {
        state.raf = null;
        renderHKVirtualChapterWindow(state);
      });
    };
    hkChapterListEl.addEventListener("scroll", handleScroll);
    state.cleanup = () => {
      hkChapterListEl.removeEventListener("scroll", handleScroll);
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
    };
    hkChapterVirtualizer = state;
    renderHKVirtualChapterWindow(state, true);
  }

  function renderHKChapters(chapters = []) {
    if (!hkChapterListEl) return;
    hkChapterCache = chapters;
    if (chapters.length) {
      updateHKChapterSummary(`Chapters: ${chapters.length}`);
    } else {
      updateHKChapterSummary("No chapters loaded.");
    }
    hkSelectedChapterIds.clear();
    pruneHKPreviewState();
    renderHKPreviewGrid();
    hkChapterListEl.scrollTop = 0;
    hkChapterListEl.innerHTML = "";
    teardownHKChapterVirtualizer();
    if (!chapters.length) {
      updateHKDownloadButtonState();
      updateHKPreviewButtonState();
      return;
    }
    if (chapters.length > HK_VIRTUALIZE_THRESHOLD) {
      initHKChapterVirtualizer(chapters);
    } else {
      const fragment = document.createDocumentFragment();
      chapters.forEach((chapter, index) => {
        fragment.appendChild(createHKChapterListItem(chapter, index));
      });
      hkChapterListEl.style.paddingTop = "0px";
      hkChapterListEl.style.paddingBottom = "0px";
      hkChapterListEl.appendChild(fragment);
    }
    hkChapterPreviewState.forEach((_, chapterId) => updateHKChapterPreviewIndicator(chapterId));
    updateHKDownloadButtonState();
    updateHKPreviewButtonState();
  }

  function hkHandleChapterSelection(event) {
    const target = event.target;
    if (!target || target.name !== "hkChapterChoice") return;
    if (target.checked) {
      hkSelectedChapterIds.add(target.value);
    } else {
      hkSelectedChapterIds.delete(target.value);
    }
    updateHKDownloadButtonState();
    updateHKPreviewButtonState();
  }

  async function handleHKListChaptersClick() {
    if (hkListButtonEl?.dataset.loading === "true") {
      return;
    }
    if (!globalThis.hkProxy?.fetchManga) {
      hkSetMangaStatus("Manga proxy unavailable.", "error");
      return;
    }
    setHKButtonLoadingState(hkListButtonEl, true, "Listing...");
    const tabInfo = await hkRequireActiveTabPermission();
    if (!tabInfo) {
      setHKButtonLoadingState(hkListButtonEl, false);
      return;
    }
    let progressActive = false;
    try {
      if (!progressState) {
        startProgress("Listing chapters...", 0);
        progressActive = true;
      }
      const loaderOverride = hkForceNextLoader;
      hkForceNextLoader = null;
      hideHKRunnerRetryHint();
      let connectorId = hkDetectedConnectorId;
      if (!connectorId) {
        const detection = await detectConnectorForCurrentContext({ reason: "list", tabInfo });
        connectorId = detection?.connectorId || "";
        if (!connectorId) {
          hkSetMangaStatus("Unable to detect a connector for this page.", "warn");
          return;
        }
      }
      const urlValue = hkUrlInputEl?.value?.trim() || tabInfo?.url || "";
      if (!urlValue) {
        hkSetMangaStatus("Enter a valid series URL.", "warn");
        return;
      }
      const loaderIntent = (loaderOverride || hkLoaderMode || "auto").toLowerCase();
      const expectsDelegates = loaderIntent !== "runner";
      hkSetMangaStatus(expectsDelegates ? "Connecting to delegates..." : "Listing chapters...", "info", { loading: true });
      if (tabInfo?.id != null) {
        await ensureModeContent(tabInfo.id, "manga", 1).catch(() => { });
      }
      const request = buildHKFamiliesPayload({ connectorId, url: urlValue, tabId: tabInfo?.id ?? null });
      request.loader = loaderOverride || hkLoaderMode;
      const result = await hkProxy.fetchManga(request);
      hkLastMangaResult = result;
      if (result?.manga?.title) {
        setHKSeriesTitle(result.manga.title);
      }
      renderHKChapters(result?.chapters || []);
      const summary = hkChapterCache.length
        ? `Found ${hkChapterCache.length} chapters.`
        : "No chapters found on this URL.";
      const keepRunnerHint = result?.warningCode === "manager-fallback";
      if (result?.warning) {
        hkReportWarning(result.warning, summary, { keepRunnerHint, loading: false });
      } else {
        hkSetMangaStatus(summary, hkChapterCache.length ? "ok" : "warn", { keepRunnerHint, loading: false });
      }
      if (keepRunnerHint) {
        showHKRunnerRetryHint("list");
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || "Failed to fetch chapters.";
      const hint = classifyHKErrorMessage(message);
      const statusMessage = hint ? `${message} (${hint})` : message;
      const suggestRunner = /delegate/i.test(message) || /manager/i.test(message);
      hkSetMangaStatus(statusMessage, "error", { keepRunnerHint: suggestRunner, loading: false });
      if (suggestRunner) {
        showHKRunnerRetryHint("list");
      }
    } finally {
      if (progressActive) {
        finishProgress(t("label_progress_done", "Done"));
      }
      setHKButtonLoadingState(hkListButtonEl, false);
    }
  }

  async function handleHKDetectConnectorClick() {
    if (hkDetectButtonEl?.dataset.loading === "true") {
      return;
    }
    setHKButtonLoadingState(hkDetectButtonEl, true, "Detecting...");
    try {
      const tabInfo = await hkRequireActiveTabPermission();
      if (!tabInfo) {
        return;
      }
      await detectConnectorForCurrentContext({ silent: false, reason: "manual", tabInfo });
    } catch (error) {
      console.error(error);
      hkSetMangaStatus(error?.message || "Detection failed.", "error");
    } finally {
      setHKButtonLoadingState(hkDetectButtonEl, false);
    }
  }

  async function handleHKDownloadChapterClick() {
    stopActiveScan("Scan stopped to download chapters.");
    if (hkActiveDownloadJob?.status === "running") {
      await cancelActiveHKDownload();
      return;
    }
    if (hkActiveDownloadJob?.status === "canceling") {
      return;
    }
    if (!globalThis.hkProxy?.fetchPages) {
      hkSetMangaStatus("Manga proxy unavailable.", "error");
      return;
    }
    if (!hkSelectedChapterIds.size) {
      hkSetMangaStatus("Select at least one chapter first.", "warn");
      return;
    }
    let connectorId = hkDetectedConnectorId;
    if (!connectorId) {
      const detection = await detectConnectorForCurrentContext({ reason: "download" });
      connectorId = detection?.connectorId || "";
      if (!connectorId) {
        hkSetMangaStatus("Unable to detect a connector for this page.", "warn");
        return;
      }
    }
    const loaderOverride = hkForceNextLoader;
    hkForceNextLoader = null;
    hideHKRunnerRetryHint();
    const chapters = Array.from(hkSelectedChapterIds).map(
      (id) => hkChapterCache.find((item) => item.id === id) || { id }
    );
    const includeComicInfo = Boolean(getHKSetting("manga.includeComicInfo", false));
    const includeEpub = Boolean(getHKSetting("manga.includeEPUB", false));
    const tabInfo = await hkRequireActiveTabPermission();
    if (!tabInfo) {
      return;
    }
    const urlValue = hkUrlInputEl?.value?.trim() || tabInfo.url || "";
    if (!urlValue) {
      hkSetMangaStatus("Enter a valid series URL.", "warn", { loading: false });
      return;
    }
    hkSetMangaStatus("Preparing download...", "info", { loading: true });
    if (tabInfo.id != null) {
      await ensureModeContent(tabInfo.id, "manga", 1).catch(() => { });
    }
    try {
      const adapter = await ensureHKDownloadAdapter();
      let completed = 0;
      let cancelled = false;
      const contextUrl = urlValue || tabInfo?.url || "";
      const downloadCookies = await buildHKCookieContext(contextUrl);
      for (const chapter of chapters) {
        const pageRequest = buildHKFamiliesPayload({
          connectorId,
          chapterId: chapter.id,
          chapter,
          manga: hkLastMangaResult?.manga || null,
          url: urlValue,
          tabId: tabInfo?.id ?? null
        });
        pageRequest.loader = loaderOverride || hkLoaderMode;
        const pagesResult = await hkProxy.fetchPages(pageRequest);
        if (pagesResult?.warning) {
          hkReportWarning(pagesResult.warning, "Continuing download.", {
            keepRunnerHint: pagesResult.warningCode === "manager-fallback",
            loading: true
          });
        }
        if (pagesResult?.warningCode === "manager-fallback") {
          showHKRunnerRetryHint("download");
        }
        const pages = pagesResult?.pages || [];
        const familyFallback = normalizeHKFamilyKey(
          pagesResult?.family
          || resolveFamilyFromConnectorId(pagesResult?.connectorId || connectorId)
          || hkDetectedFamilyKey
        );
        if (familyFallback) {
          pagesResult.family = familyFallback;
        }
        const downloadContext = {
          tabId: tabInfo?.id ?? null,
          url: contextUrl,
          origin: contextUrl,
          referer: contextUrl,
          connectorId,
          family: familyFallback || null
        };
        if (downloadCookies) {
          downloadContext.cookies = downloadCookies;
        }
        if (!pages.length) {
          throw new Error(`Connector returned no pages for ${chapter.title || chapter.id}.`);
        }
        const job = await adapter.createJob({
          title: getHKPreferredSeriesTitle("manga"),
          chapter,
          pages
        });
        hkActiveDownloadJob = { jobId: job.id, status: "running" };
        updateHKDownloadButtonState();
        let result;
        try {
          result = await adapter.runJob(
            job,
            {
              includeComicInfo,
              includeEPUB: includeEpub
            },
            downloadContext
          );
        } catch (error) {
          if (error?.code === "HK_CANCELLED") {
            cancelled = true;
            hkSetMangaStatus("Download cancelled.", "warn");
            break;
          }
          const hint = classifyHKErrorMessage(error?.message);
          if (hint) {
            hkSetMangaStatus(`${error?.message || String(error)} (${hint})`, "error");
          }
          throw error;
        } finally {
          hkActiveDownloadJob = null;
          updateHKDownloadButtonState();
        }

        const archive = result?.archive;
        if (!archive) {
          throw new Error("Download returned no archive.");
        }
        const filename = ensureSafeFilenameCandidate(
          `${getHKPreferredSeriesTitle("manga")} - ${chapter.title || "chapter"}.cbz`,
          { defaultExt: "cbz", fallback: "chapter" }
        );
        const blob = new Blob([archive], { type: "application/x-cbz" });
        const blobUrl = URL.createObjectURL(blob);
        await chrome.downloads.download({ url: blobUrl, filename, saveAs: shouldSaveAs() });
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        if (includeEpub && result?.epub) {
          const epubName = ensureSafeFilenameCandidate(
            `${getHKPreferredSeriesTitle("manga")} - ${chapter.title || "chapter"}.epub`,
            { defaultExt: "epub", fallback: "chapter" }
          );
          const epubBlob = new Blob([result.epub], { type: "application/epub+zip" });
          const epubUrl = URL.createObjectURL(epubBlob);
          await chrome.downloads.download({ url: epubUrl, filename: epubName, saveAs: shouldSaveAs() });
          setTimeout(() => URL.revokeObjectURL(epubUrl), 60000);
        }
        await recordDownloadSuccess(pages.length);
        completed += 1;
        const stillRunning = completed < chapters.length;
        hkSetMangaStatus(`Downloaded ${completed}/${chapters.length} chapters.`, "ok", { loading: stillRunning });
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || "Download failed.";
      const suggestRunner = /delegate/i.test(message) || /manager/i.test(message);
      hkSetMangaStatus(message, "error", { keepRunnerHint: suggestRunner, loading: false });
      if (suggestRunner) {
        showHKRunnerRetryHint("download");
      }
    }
    updateHKDownloadButtonState();
  }

  async function ensureHKDownloadAdapter() {
    if (!hkDownloadAdapterPromise) {
      hkDownloadAdapterPromise = import(chrome.runtime.getURL("integrations/hakuneko/DownloadAdapter.mjs")).then(
        (mod) => mod.default || mod
      );
    }
    return hkDownloadAdapterPromise;
  }

  function isExtensionBlobUrl(url) {
    if (!url || typeof url !== "string" || !url.startsWith("blob:") || !EXTENSION_ORIGIN) return false;
    return url.startsWith(`blob:${EXTENSION_ORIGIN}`);
  }

  // Only release blob URLs if the UI is no longer using them (i.e., we have an extension-backed URL)
  function getReleasableBlobUrl(item) {
    const raw = (item && typeof item.rawUrl === "string" && item.rawUrl.startsWith("blob:")) ? item.rawUrl : null;
    if (!raw) return null;
    const currentUrl = (item && typeof item.url === "string") ? item.url : "";
    if (!currentUrl || currentUrl === raw) return null;
    return raw;
  }

  function escapeHtml(val) {
    return String(val ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPE_LOOKUP[ch] || ch);
  }

  function showToast(message, options = {}) {
    if (!toastHost) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
    if (options.action && typeof options.action === "object") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = options.action.label || "Open";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        try { options.action.handler?.(); } catch { }
        toast.remove();
      });
      toast.appendChild(btn);
    }
    toastHost.appendChild(toast);
    const duration = Math.max(1500, options.duration ?? TOAST_DURATION_MS);
    setTimeout(() => {
      toast.classList.add("toast-hide");
      setTimeout(() => toast.remove(), 220);
    }, duration);
    toast.addEventListener("click", () => {
      toast.classList.add("toast-hide");
      setTimeout(() => toast.remove(), 220);
    });
  }

  function openDownloads() {
    try {
      chrome.tabs.create({ url: CHROME_DOWNLOADS_URL });
    } catch { }
  }

  function setDownloadStatus(url, status, message = "") {
    if (!url) return;
    if (!status) {
      DOWNLOAD_STATUS.delete(url);
      return;
    }
    DOWNLOAD_STATUS.set(url, { status, message, updatedAt: Date.now() });
  }

  function setDownloadStatusForItem(item, status, message = "") {
    if (!item) return;
    const key = typeof item === "string" ? item : item.url || item.rawUrl || "";
    if (!key) return;
    setDownloadStatus(key, status, message);
  }

  function bulkSetDownloadStatus(items, status, message = "") {
    if (!Array.isArray(items)) return;
    for (const it of items) setDownloadStatusForItem(it, status, message);
  }

  function clearDownloadStatus(url) {
    if (url) DOWNLOAD_STATUS.delete(url);
  }

  function getDownloadStatus(url) {
    return url ? DOWNLOAD_STATUS.get(url) : null;
  }

  function getProgressElements() {
    return {
      wrap: $("#progressWrap"),
      bar: $("#progressBar"),
      text: $("#progressText"),
      cancelBtn: $("#progressCancel")
    };
  }

  function setProgressPhase(phase) {
    const { wrap } = getProgressElements();
    if (!wrap) return;
    if (phase) {
      wrap.dataset.phase = String(phase);
    } else {
      wrap.removeAttribute("data-phase");
    }
  }

  function startProgress(label, total = 0) {
    const { wrap, bar, text, cancelBtn } = getProgressElements();
    if (!wrap || !bar || !text || !cancelBtn) return;
    progressState = {
      total: Math.max(0, total),
      completed: 0,
      label: label || "",
      cancelled: false
    };
    wrap.hidden = false;
    setProgressPhase(null);
    bar.style.setProperty("--pct", total ? "0%" : "10%");
    text.textContent = label || "";
    cancelBtn.disabled = false;
  }

  function updateProgress(completed, total, label) {
    if (!progressState) return;
    const { bar, text } = getProgressElements();
    if (!bar || !text) return;
    if (typeof total === "number" && total >= 0) progressState.total = total;
    progressState.completed = Math.max(0, completed || 0);
    const denom = progressState.total > 0 ? progressState.total : 0;
    const pct = denom ? Math.min(100, Math.floor((progressState.completed / denom) * 100)) : 0;
    bar.style.setProperty("--pct", `${pct}%`);
    if (label) {
      progressState.label = label;
      text.textContent = label;
    } else if (progressState.label) {
      text.textContent = progressState.label;
    }
  }

  function finishProgress(message) {
    const { wrap, bar, text, cancelBtn } = getProgressElements();
    if (!wrap || !bar || !text || !cancelBtn) return;
    if (message) text.textContent = message;
    cancelBtn.disabled = true;
    setProgressPhase(null);
    setTimeout(() => {
      wrap.hidden = true;
      bar.style.setProperty("--pct", "0%");
    }, 280);
    progressState = null;
  }

  function cancelProgress() {
    if (!progressState) return;
    progressState.cancelled = true;
    const { cancelBtn } = getProgressElements();
    if (cancelBtn) cancelBtn.disabled = true;
  }

  function isProgressCancelled() {
    return !!(progressState && progressState.cancelled);
  }

  function stopActiveScan(reason = "") {
    cancelProgress();
    endScanSession();
    if (autoImagesEnabled) {
      handleAutoImagesToggle(false, { silent: true }).catch(() => { });
    }
    const btnScan = $("#btnScan");
    if (btnScan) {
      btnScan.textContent = "Scan";
      btnScan.classList.remove("scanning", "network-scanning");
      btnScan.style.background = "";
      btnScan.style.borderColor = "";
      btnScan.style.color = "";
      delete btnScan.dataset.scanning;
    }
    if (reason) {
      setHintMessage("hint_scan_stopped", reason);
      recordUserNotice("info", reason);
    }
  }

  function bindProgressControls() {
    const { cancelBtn } = getProgressElements();
    if (!cancelBtn) return;
    cancelBtn.addEventListener("click", () => {
      cancelProgress();
      setHintMessage("hint_progress_cancelled", "Operation cancelled.");
      showToast(t("hint_progress_cancelled", "Operation cancelled."));
      recordUserNotice("warn", t("hint_progress_cancelled", "Operation cancelled."));
    });
  }

  // Record stats (always increments, no opt-in)
  async function recordScanStat(imagesFound = 0) {
    STATS.scans = (STATS.scans || 0) + 1;
    if (imagesFound > 0) {
      STATS.imagesScanned = (STATS.imagesScanned || 0) + imagesFound;
    }
    await saveStats();
    updateStatsUI();
  }

  async function recordOverlaysNukedStat(count = 0) {
    if (count <= 0) return;
    STATS.overlaysNuked = (STATS.overlaysNuked || 0) + count;
    await saveStats();
    updateStatsUI();
  }

  function getMonthKey(date = new Date()) {
    const yr = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, "0");
    return `${yr}-${mo}`;
  }

  function getPrevMonthKey(date = new Date()) {
    const prev = new Date(date);
    prev.setDate(1);
    prev.setMonth(prev.getMonth() - 1);
    return getMonthKey(prev);
  }

  async function loadDonationState() {
    try {
      const stored = await chrome.storage.local.get({ [DONATION_KEY]: null });
      const payload = stored[DONATION_KEY];
      if (payload && typeof payload === "object") {
        donationState = {
          lifetime: Number.isFinite(payload.lifetime) ? payload.lifetime : 0,
          monthly: payload.monthly && typeof payload.monthly === "object" ? payload.monthly : {},
          lastPromptMonth: typeof payload.lastPromptMonth === "string" ? payload.lastPromptMonth : ""
        };
        const storedDownloads = Number.isFinite(payload.downloads) ? payload.downloads : null;
        if (storedDownloads != null) {
          downloadCounts.images = storedDownloads;
        }
      }
    } catch {
      donationState = { lifetime: 0, monthly: {}, lastPromptMonth: "" };
    }
  }

  async function persistDonationState() {
    try {
      await chrome.storage.local.set({ [DONATION_KEY]: { ...donationState, downloads: downloadCounts.images } });
    } catch { }
  }

  async function recordDownloadMilestone(count = 0) {
    const increment = Number(count) || 0;
    if (increment <= 0) return;
    downloadCounts.images = (Number(downloadCounts.images) || 0) + increment;
    if (!donationState || typeof donationState !== "object") {
      donationState = { lifetime: 0, monthly: {}, lastPromptMonth: "" };
    }
    // Note: Removed loadDonationState() call here - it was overwriting the increment
    const monthKey = getMonthKey();
    donationState.lifetime = Math.max(0, donationState.lifetime) + increment;
    donationState.monthly = donationState.monthly && typeof donationState.monthly === "object" ? donationState.monthly : {};
    donationState.monthly[monthKey] = (Number(donationState.monthly[monthKey]) || 0) + increment;
    await persistDonationState();
    // Update the stats section (imagesDownloaded is tracked via STATS)
    STATS.imagesDownloaded = (STATS.imagesDownloaded || 0) + increment;
    await saveStats();
    updateStatsUI();
    await maybeShowDonationPrompt();
  }

  async function recordDownloadSuccess(count = 1) {
    try {
      await recordDownloadMilestone(count);
    } catch {
      // keep UI responsive even if storage fails
    }
  }

  // === Stats tracking ===
  async function loadStats() {
    try {
      const stored = await chrome.storage.local.get({ [STATS_KEY]: null, [DONATION_KEY]: null, [LEGACY_TELEMETRY_KEY]: null });
      const payload = stored[STATS_KEY];
      const mergeStat = (key, value) => {
        if (!key || !Object.prototype.hasOwnProperty.call(STATS, key)) return false;
        const num = Number(value);
        if (!Number.isFinite(num)) return false;
        const safe = Math.max(0, Math.floor(num));
        const current = Number(STATS[key]);
        const next = Number.isFinite(current) ? Math.max(Math.max(0, Math.floor(current)), safe) : safe;
        if (next !== STATS[key]) {
          STATS[key] = next;
          return true;
        }
        return false;
      };

      if (payload && typeof payload === "object") {
        mergeStat("scans", payload.scans);
        mergeStat("imagesScanned", payload.imagesScanned);
        mergeStat("overlaysNuked", payload.overlaysNuked);
        mergeStat("overlayTweaks", payload.overlayTweaks);
        mergeStat("imagesDownloaded", payload.imagesDownloaded);
      }

      let shouldPersist = false;
      const legacyTelemetry = stored[LEGACY_TELEMETRY_KEY];
      if (legacyTelemetry && typeof legacyTelemetry === "object") {
        const legacyScans = Number.isFinite(legacyTelemetry.scans) ? legacyTelemetry.scans : null;
        const legacyOverlayTweaks = Number.isFinite(legacyTelemetry.overlays) ? legacyTelemetry.overlays : null;
        shouldPersist = mergeStat("scans", legacyScans) || shouldPersist;
        shouldPersist = mergeStat("overlayTweaks", legacyOverlayTweaks) || shouldPersist;
      }

      const donationPayload = stored[DONATION_KEY];
      if (donationPayload && typeof donationPayload === "object") {
        const legacyDownloads = Number.isFinite(donationPayload.downloads) ? donationPayload.downloads : null;
        shouldPersist = mergeStat("imagesDownloaded", legacyDownloads) || shouldPersist;
      }

      if (shouldPersist) {
        await saveStats();
      }
    } catch {
      // Ignore errors, keep defaults
    }
    updateStatsUI();
  }

  async function saveStats() {
    try {
      const snapshot = { ...STATS };
      statsSaveQueue = statsSaveQueue
        .then(() => chrome.storage.local.set({ [STATS_KEY]: snapshot }))
        .catch(() => { });
      await statsSaveQueue;
    } catch { }
  }

  function updateStatsUI() {
    const scansEl = $("#statScans");
    const scannedEl = $("#statImagesScanned");
    const nukedEl = $("#statOverlaysNuked");
    const overlayTweaksEl = $("#statOverlayTweaks");
    const downloadedEl = $("#statImagesDownloaded");
    if (scansEl) scansEl.textContent = String(STATS.scans || 0);
    if (scannedEl) scannedEl.textContent = String(STATS.imagesScanned || 0);
    if (nukedEl) nukedEl.textContent = String(STATS.overlaysNuked || 0);
    if (overlayTweaksEl) overlayTweaksEl.textContent = String(STATS.overlayTweaks || 0);
    if (downloadedEl) downloadedEl.textContent = String(STATS.imagesDownloaded || 0);
  }

  async function incrementStat(key, amount = 1) {
    if (!key || !STATS.hasOwnProperty(key)) return;
    STATS[key] = (Number(STATS[key]) || 0) + amount;
    updateStatsUI();
    await saveStats();
  }

  async function maybeShowDonationPrompt() {
    if (donationPromptOpen) return;
    await loadDonationState();
    const now = new Date();
    const monthKey = getMonthKey(now);
    if (donationState.lastPromptMonth === monthKey) {
      return;
    }
    const currentMonthCount = Number(donationState.monthly?.[monthKey]) || 0;
    const prevMonthCount = Number(donationState.monthly?.[getPrevMonthKey(now)]) || 0;
    const hitLifetime = donationState.lifetime >= DONATION_MIN_TOTAL;
    const hitMonthly = currentMonthCount >= DONATION_MONTHLY_THRESHOLD || prevMonthCount >= DONATION_MONTHLY_THRESHOLD;
    if (!hitLifetime && !hitMonthly) {
      return;
    }
    openDonationModal();
    donationState.lastPromptMonth = monthKey;
    await persistDonationState();
  }

  function openDonationModal() {
    if (!donationModalEl) return;
    donationPromptOpen = true;
    donationModalEl.style.display = "flex";
    donationModalEl.setAttribute("aria-hidden", "false");
  }

  function closeDonationModal() {
    if (!donationModalEl) return;
    donationPromptOpen = false;
    donationModalEl.style.display = "none";
    donationModalEl.setAttribute("aria-hidden", "true");
  }

  function bindDonationModal() {
    donationModalEl = $("#donationModal");
    donationCloseBtn = $("#donationClose");
    donationTipBtn = $("#donationTipBtn");
    donationExtensionsLink = $("#donationExtensionsLink");
    const tipLink = $("#tipLink");
    if (donationTipBtn && tipLink?.href) {
      donationTipBtn.href = tipLink.href;
    }
    const contactLink = $("#contactLink");
    if (donationExtensionsLink && contactLink?.href) {
      donationExtensionsLink.href = contactLink.href;
    }
    if (donationCloseBtn) {
      donationCloseBtn.addEventListener("click", closeDonationModal);
    }
    if (donationModalEl) {
      const overlay = donationModalEl.querySelector(".hk-modal-overlay");
      overlay?.addEventListener("click", closeDonationModal);
    }
  }

  async function initDonationTracking() {
    bindDonationModal();
    await loadDonationState();
    await maybeShowDonationPrompt();
  }

  function bindMangaSettingsToggle() {
    const toggle = $("#enableMangaSwitch");
    if (!toggle) return;
    toggle.checked = hkMangaEnabled;
    toggle.addEventListener("change", async (event) => {
      // Chrome Web Store version - manga mode disabled
      if (event.target.checked) {
        event.target.checked = false;
        alert("Manga Mode is not available in the Chrome Web Store version.\n\nDownload the full version from:\nhttps://github.com/gecallidryas/unshackle-final");
        return;
      }
      const enabled = !!event.target.checked;
      const wasManga = hkCurrentMode === "manga";
      logHKDevEvent(`[Settings] Manga mode ${enabled ? "enabled" : "disabled"}`);
      await updateHKSetting("manga.enabled", enabled);
      if (!enabled && wasManga) {
        await setHKMode(HK_MODE_DEFAULT, { reason: "manga-disabled", forceEmit: true });
      } else {
        emitHKModeChanged(hkCurrentMode, { reason: "settings-toggle" });
      }
    });
  }

  function bindHKLoaderSelect() {
    hkLoaderSelectEl = document.getElementById("hkLoaderModeSelect");
    if (!hkLoaderSelectEl) return;
    hkLoaderSelectEl.value = hkLoaderMode;
    hkLoaderSelectEl.addEventListener("change", async (event) => {
      const next = normalizeHKLoaderMode(event.target.value);
      if (next === hkLoaderMode) return;
      hkLoaderMode = next;
      logHKDevEvent(`[Settings] HK loader -> ${next}`);
      await updateHKSetting("manga.loader", next);
      let toastMessage = "HK loader set to Auto (Runner + Manager).";
      if (next === "runner") {
        toastMessage = "HK loader set to Compatibility (Runner only).";
      } else if (next === "manager") {
        toastMessage = "HK loader set to Manager only (experimental).";
      }
      showToast(toastMessage, { duration: 3200 });
    });
  }

  async function resetHKSettingsToSafeDefaults() {
    const defaults = createHKSafeDefaults();
    hkSettingsSnapshot = JSON.parse(JSON.stringify(defaults));
    try {
      await chrome.storage.local.set({ settings: hkSettingsSnapshot });
      await syncHKFamiliesToStorage(hkSettingsSnapshot);
      await setHKMode(HK_MODE_DEFAULT, { reason: "reset", forceEmit: true });
      applyHKSettingsUI();
      showToast(t("toast_reset_safe_defaults", "Settings restored to safe defaults."), { duration: 3600 });
      return true;
    } catch (error) {
      console.error("[HK] Failed to reset settings", error);
      showToast(t("toast_reset_safe_defaults_failed", "Unable to reset settings. Try again."), { duration: 3600 });
      return false;
    }
  }

  function bindHKResetButton() {
    const resetBtn = document.getElementById("resetMangaDefaults");
    if (!resetBtn) return;
    resetBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        t("confirm_reset_manga_defaults", "Reset to safe defaults? This disables Manga mode until re-enabled.")
      );
      if (!confirmed) return;
      resetBtn.disabled = true;
      try {
        await resetHKSettingsToSafeDefaults();
      } finally {
        resetBtn.disabled = false;
      }
    });
  }

  function resolveHelpPageUrl() {
    try {
      if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
        return chrome.runtime.getURL(HELP_PAGE_PATH);
      }
    } catch { }
    return HELP_FALLBACK_URL;
  }

  function bindHelpButton() {
    const btn = $("#helpBtn");
    if (!btn) return;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openHelpPage().catch(() => { });
    });
  }

  async function openHelpPage() {
    const targetUrl = resolveHelpPageUrl();
    let activeTabId = null;
    try {
      const activeTab = await getActiveTab();
      activeTabId = activeTab?.id ?? null;
    } catch { }
    if (chrome?.tabs?.create) {
      try {
        const options = { url: targetUrl };
        if (activeTabId != null) options.active = false;
        const created = chrome.tabs.create(options);
        if (created && typeof created.catch === "function") {
          created.catch(() => { });
        }
        if (activeTabId != null && chrome.tabs?.update) {
          const restored = chrome.tabs.update(activeTabId, { active: true });
          if (restored && typeof restored.catch === "function") {
            restored.catch(() => { });
          }
        }
        showToast(t("toast_help_opened", "Help opened in a new tab."), { duration: 2800 });
        return;
      } catch (error) {
        console.warn("[Panel] Failed to open help tab", error);
      }
    }
    try {
      window.open(targetUrl, "_blank", "noopener");
    } catch { }
  }

  function showFirstRunNotice() {
    const notice = $("#firstRunNotice");
    if (!notice) return;
    notice.classList.remove("hidden");
    notice.removeAttribute("hidden");
    notice.removeAttribute("inert");
  }

  function bindFirstRunNotice() {
    const notice = $("#firstRunNotice");
    if (!notice) return;
    const dismissBtn = $("#firstRunDismiss");
    const helpBtn = $("#firstRunHelp");
    const releaseNoticeFocus = () => {
      const active = document.activeElement;
      if (active && notice.contains(active)) {
        if (typeof active.blur === "function") {
          active.blur();
        }
        const fallback = $("#helpBtn") || $("#settingsBtn") || document.body;
        if (fallback && typeof fallback.focus === "function") {
          try {
            fallback.focus({ preventScroll: true });
          } catch {
            fallback.focus();
          }
        }
      }
    };
    const hideNotice = async (store = true) => {
      releaseNoticeFocus();
      notice.classList.add("hidden");
      notice.setAttribute("hidden", "");
      notice.setAttribute("inert", "");
      if (store) {
        try {
          await chrome.storage.local.set({ [FIRST_RUN_KEY]: true });
          await chrome.storage.sync.set({ firstRunNoticeDone: true });
        } catch { }
      }
    };
    dismissBtn?.addEventListener("click", () => { hideNotice(true).catch(() => { }); });
    helpBtn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      openHelpPage().catch(() => { });
      hideNotice(true).catch(() => { });
    });
  }

  async function maybeShowFirstRun() {
    let seen = false;
    try {
      const stored = await chrome.storage.local.get({ [FIRST_RUN_KEY]: false });
      seen = !!stored[FIRST_RUN_KEY];
    } catch {
      seen = false;
    }
    if (!seen) {
      try {
        const syncSeen = await chrome.storage.sync.get({ firstRunNoticeDone: false });
        if (syncSeen?.firstRunNoticeDone) seen = true;
      } catch { }
    }
    if (!seen) {
      showFirstRunNotice();
      showToast(t("toast_first_run", "Unshackle only asks for site access when you run scans or captures."), {
        duration: 9000,
        action: {
          label: t("toast_first_run_link", "Learn more"),
          handler: () => { openHelpPage().catch(() => { }); }
        }
      });
      try {
        await chrome.storage.local.set({ [FIRST_RUN_KEY]: true });
        await chrome.storage.sync.set({ firstRunNoticeDone: true });
      } catch { }
    }
  }

  function mimeToExtension(mime) {
    if (!mime) return "";
    const m = String(mime || "").toLowerCase().split(";")[0].trim();
    if (!m || !m.startsWith("image/")) return "";
    const type = m.slice(6);
    if (!type) return "";
    if (type.includes("svg")) return "svg";
    if (type.includes("jpeg")) return "jpg";
    if (type.includes("pjpeg")) return "jpg";
    if (type.includes("x-icon")) return "ico";
    return type.replace(/[^a-z0-9]/g, "") || "";
  }

  function guessMimeFromBuffer(buffer) {
    try {
      const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      if (view.length >= 8 &&
        view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47 &&
        view[4] === 0x0D && view[5] === 0x0A && view[6] === 0x1A && view[7] === 0x0A) {
        return "image/png";
      }
      if (view.length >= 3 && view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) {
        return "image/jpeg";
      }
      if (view.length >= 6 &&
        view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38 &&
        (view[4] === 0x37 || view[4] === 0x39) && view[5] === 0x61) {
        return "image/gif";
      }
      if (view.length >= 12 &&
        view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
        view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) {
        return "image/webp";
      }
      if (view.length >= 4 && view[0] === 0x42 && view[1] === 0x4D) {
        return "image/bmp";
      }
      if (view.length >= 12 &&
        view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70 &&
        view[8] === 0x61 && view[9] === 0x76 && view[10] === 0x69 && view[11] === 0x66) {
        return "image/avif";
      }
    } catch { }
    return "";
  }


  function inferFormat(item) {
    if (!item || typeof item !== "object") return "";
    if (item.__format && typeof item.__format === "string") return item.__format;
    const candidates = [];
    candidates.push(ext(item.url || ""));
    candidates.push(mimeToExtension(item.mime));
    candidates.push(ext(item.filename || ""));
    if (item.rawUrl && item.rawUrl.startsWith("data:image/")) {
      const m = /^data:image\/([a-z0-9+.-]+);/i.exec(item.rawUrl);
      if (m) candidates.push(m[1]);
    }
    if (item.kind === "canvas") candidates.push("png");
    if (item.kind === "svg") candidates.push("svg");
    if (item.kind === "dataUri") candidates.push("data");
    candidates.push(item.kind || "");
    let fmt = "";
    for (const cand of candidates) {
      if (!cand) continue;
      const lower = String(cand).toLowerCase();
      if (!lower) continue;
      if (lower === "jpeg") { fmt = "jpg"; break; }
      fmt = lower;
      if (["png", "jpg", "webp", "gif", "svg", "ico", "avif", "bmp"].includes(fmt)) break;
    }
    if (!fmt) fmt = "data";
    item.__format = fmt;
    return fmt;
  }

  function t(key, substitutions, fallback) {
    let subs = substitutions;
    let fb = fallback;
    if (typeof substitutions === "string" && fallback === undefined) {
      fb = substitutions;
      subs = undefined;
    }
    // Check custom locale cache first for dynamic locale switching
    if (selectedLocale && LOCALE_CACHE.has(selectedLocale)) {
      const messages = LOCALE_CACHE.get(selectedLocale);
      const entry = messages?.[key];
      if (entry?.message) {
        let msg = entry.message;
        // Handle substitutions ($1, $2, etc.)
        if (Array.isArray(subs)) {
          subs.forEach((sub, i) => {
            msg = msg.replace(new RegExp(`\\$${i + 1}`, "g"), String(sub));
          });
        } else if (typeof subs === "string") {
          msg = msg.replace(/\$1/g, subs);
        }
        return msg;
      }
    }
    // Fall back to Chrome's i18n API
    try {
      const val = chrome?.i18n?.getMessage?.(key, subs);
      if (val) return val;
    } catch { }
    return fb ?? "";
  }


  function trackBlobUrl(url) {
    if (!url) return url;
    TEMP_URLS.add(url);
    return url;
  }

  function revokeTracked(url) {
    if (!url || !TEMP_URLS.has(url)) return;
    TEMP_URLS.delete(url);
    try { URL.revokeObjectURL(url); } catch { }
  }

  function revokeAllTracked() {
    if (!TEMP_URLS.size) return;
    TEMP_URLS.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch { }
    });
    TEMP_URLS.clear();
  }

  async function cooperativeDelay(ms = 0) {
    await new Promise((resolve) => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => resolve(), { timeout: Math.max(16, ms || 50) });
      } else {
        setTimeout(resolve, ms);
      }
    });
  }

  async function fetchAsUint8(url) {
    try {
      if (url.startsWith('data:')) {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
      }
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        const ab = await res.arrayBuffer();
        return new Uint8Array(ab);
      } catch {
        const resp = await chrome.runtime.sendMessage({ action: 'fetchOne', url });
        if (resp && resp.ok && resp.data != null) {
          if (resp.data instanceof ArrayBuffer) {
            return new Uint8Array(resp.data);
          }
          if (ArrayBuffer.isView(resp.data)) {
            const view = resp.data;
            return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
          }
          if (Array.isArray(resp.data)) {
            return new Uint8Array(resp.data);
          }
          if (typeof resp.data === 'string') {
            const bin = atob(resp.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
          }
        }
      }
    } catch { }
    return null;
  }

  function ensureZipWorker() {
    if (zipWorker) return zipWorker;
    const workerUrl = chrome.runtime?.getURL ? chrome.runtime.getURL("zip.worker.js") : "zip.worker.js";
    zipWorker = new Worker(workerUrl);
    zipWorker.onmessage = (event) => {
      const { id, ok, buffer, error, progress } = event.data || {};
      if (id == null) return;
      const job = ZIP_JOBS.get(id);
      if (!job) return;
      if (typeof progress === "number" && ok == null && buffer == null) {
        try { job.progress?.(event.data); } catch { }
        return;
      }
      ZIP_JOBS.delete(id);
      if (ok) job.resolve(buffer);
      else job.reject(new Error(error || "Zip worker failed"));
    };
    zipWorker.onerror = (err) => {
      ZIP_JOBS.forEach(({ reject }) => reject(err));
      ZIP_JOBS.clear();
      try { zipWorker.terminate(); } catch { }
      zipWorker = null;
    };
    return zipWorker;
  }

  function terminateZipWorker() {
    if (!zipWorker) return;
    try { zipWorker.terminate(); } catch { }
    zipWorker = null;
    ZIP_JOBS.clear();
  }

  function runZipWorker(files, onProgress) {
    return new Promise((resolve, reject) => {
      try {
        ensureZipWorker();
      } catch (err) {
        reject(err);
        return;
      }
      const id = ++zipJobId;
      ZIP_JOBS.set(id, { resolve, reject, progress: typeof onProgress === "function" ? onProgress : null });
      const payload = files.map(({ filename, buffer }) => ({ filename, buffer }));
      const transfers = files.map(({ buffer }) => buffer).filter((buf) => buf instanceof ArrayBuffer);
      zipWorker.postMessage({ id, files: payload }, transfers);
    });
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (!key) return;
      const fallback = el.textContent || "";
      const msg = t(key, fallback);
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.dataset.i18nTitle;
      if (!key) return;
      const fallback = el.getAttribute("title") || "";
      const msg = t(key, fallback);
      if (msg) el.setAttribute("title", msg);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.dataset.i18nPlaceholder;
      if (!key) return;
      const fallback = el.getAttribute("placeholder") || "";
      const msg = t(key, fallback);
      if (msg) el.setAttribute("placeholder", msg);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      const key = el.dataset.i18nAriaLabel;
      if (!key) return;
      const fallback = el.getAttribute("aria-label") || "";
      const msg = t(key, fallback);
      if (msg) el.setAttribute("aria-label", msg);
    });
  }

  // Load locale messages from extension's _locales directory
  async function loadLocaleMessages(locale) {
    if (!locale || !AVAILABLE_LOCALES.includes(locale)) return null;
    if (LOCALE_CACHE.has(locale)) return LOCALE_CACHE.get(locale);
    try {
      const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
      const response = await fetch(url);
      if (!response.ok) return null;
      const messages = await response.json();
      LOCALE_CACHE.set(locale, messages);
      return messages;
    } catch (err) {
      console.warn(`[i18n] Failed to load locale ${locale}:`, err);
      return null;
    }
  }

  // Set the active locale and refresh all translated elements
  async function setActiveLocale(locale) {
    if (!locale || !AVAILABLE_LOCALES.includes(locale)) {
      selectedLocale = null;
      applyI18n();
      return;
    }
    await loadLocaleMessages(locale);
    selectedLocale = locale;
    applyI18n();
    // Persist preference
    try {
      await chrome.storage.sync.set({ [SELECTED_LOCALE_KEY]: locale });
    } catch { }
  }

  // Load saved locale preference
  async function loadLocalePreference() {
    try {
      const stored = await chrome.storage.sync.get({ [SELECTED_LOCALE_KEY]: null });
      const locale = stored[SELECTED_LOCALE_KEY];
      if (locale && AVAILABLE_LOCALES.includes(locale)) {
        await loadLocaleMessages(locale);
        selectedLocale = locale;
        const select = $("#localeSelect");
        if (select) select.value = locale;
      }
    } catch { }
  }

  // Check if onboarding should be shown
  async function shouldShowOnboarding() {
    try {
      const stored = await chrome.storage.local.get([ONBOARDING_DONE_KEY]);
      const done = stored[ONBOARDING_DONE_KEY] === true;
      console.log("[Onboarding] shouldShowOnboarding:", !done, "stored:", stored);
      return !done;
    } catch (err) {
      console.warn("[Onboarding] Error checking storage, showing onboarding:", err);
      return true; // Show on error (first run scenario)
    }
  }

  // Mark onboarding as complete
  async function markOnboardingDone() {
    try {
      await chrome.storage.local.set({ [ONBOARDING_DONE_KEY]: true });
    } catch { }
  }

  // Show onboarding modal
  function showOnboardingModal() {
    onboardingModalEl = $("#onboardingModal");
    console.log("[Onboarding] showOnboardingModal called, element:", onboardingModalEl);
    if (!onboardingModalEl) {
      console.warn("[Onboarding] Modal element not found!");
      return;
    }

    onboardingStep = 1;
    carouselSlide = 1;
    onboardingSelectedLocale = selectedLocale || "en";
    onboardingSelectedTheme = (document.body?.dataset?.theme) || DEFAULT_THEME;

    onboardingModalEl.style.display = "flex";
    onboardingModalEl.setAttribute("aria-hidden", "false");
    console.log("[Onboarding] Modal displayed, style.display:", onboardingModalEl.style.display, "computed:", getComputedStyle(onboardingModalEl).display);

    renderOnboardingStep();
    bindOnboardingEvents();
  }

  // Hide onboarding modal
  function hideOnboardingModal() {
    if (!onboardingModalEl) return;
    // Blur any focused element inside modal before hiding to avoid a11y warning
    const activeEl = document.activeElement;
    if (activeEl && onboardingModalEl.contains(activeEl)) {
      activeEl.blur();
    }
    onboardingModalEl.style.display = "none";
    onboardingModalEl.setAttribute("aria-hidden", "true");
  }

  // Render current onboarding step
  function renderOnboardingStep() {
    const steps = document.querySelectorAll(".onboarding-step");
    const dots = document.querySelectorAll(".step-dot");
    const backBtn = $("#onboardingBack");
    const nextBtn = $("#onboardingNext");

    steps.forEach((step) => {
      const stepNum = parseInt(step.dataset.step, 10);
      step.classList.toggle("active", stepNum === onboardingStep);
    });

    dots.forEach((dot) => {
      const stepNum = parseInt(dot.dataset.step, 10);
      dot.classList.toggle("active", stepNum === onboardingStep);
      dot.classList.toggle("completed", stepNum < onboardingStep);
    });

    if (backBtn) backBtn.disabled = onboardingStep === 1;
    if (nextBtn) {
      nextBtn.textContent = onboardingStep === 3
        ? t("onboarding_btn_start", "Get Started")
        : t("onboarding_btn_next", "Next");
    }

    // Update language card selection
    document.querySelectorAll(".lang-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.locale === onboardingSelectedLocale);
    });

    // Update theme card selection  
    document.querySelectorAll(".theme-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.theme === onboardingSelectedTheme);
    });

    // Reset carousel if on step 3
    if (onboardingStep === 3) {
      renderCarouselSlide();
    }
  }

  // Render carousel slide
  function renderCarouselSlide() {
    const slides = document.querySelectorAll(".feature-slide");
    const dots = document.querySelectorAll(".carousel-dot");
    const prevBtn = $(".carousel-prev");
    const nextBtn = $(".carousel-next");

    slides.forEach((slide) => {
      const num = parseInt(slide.dataset.slide, 10);
      slide.classList.toggle("active", num === carouselSlide);
    });

    dots.forEach((dot) => {
      const num = parseInt(dot.dataset.slide, 10);
      dot.classList.toggle("active", num === carouselSlide);
    });

    if (prevBtn) prevBtn.disabled = carouselSlide === 1;
    if (nextBtn) nextBtn.disabled = carouselSlide === 6;
  }

  // Bind onboarding event handlers
  function bindOnboardingEvents() {
    // Language selection
    document.querySelectorAll(".lang-card").forEach((card) => {
      card.addEventListener("click", async () => {
        onboardingSelectedLocale = card.dataset.locale;
        await setActiveLocale(onboardingSelectedLocale);
        renderOnboardingStep();
      });
    });

    // Theme selection with live preview
    document.querySelectorAll(".theme-card").forEach((card) => {
      card.addEventListener("click", async () => {
        onboardingSelectedTheme = card.dataset.theme;
        applyTheme(onboardingSelectedTheme);
        renderOnboardingStep();
      });
    });

    // Navigation buttons
    const backBtn = $("#onboardingBack");
    const nextBtn = $("#onboardingNext");
    const skipBtn = $("#onboardingSkip");

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        if (onboardingStep > 1) {
          onboardingStep--;
          renderOnboardingStep();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", async () => {
        if (onboardingStep < 3) {
          onboardingStep++;
          renderOnboardingStep();
        } else {
          // Complete onboarding
          await completeOnboarding();
        }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener("click", async () => {
        await completeOnboarding();
      });
    }

    // Carousel navigation
    const prevSlide = $(".carousel-prev");
    const nextSlide = $(".carousel-next");

    if (prevSlide) {
      prevSlide.addEventListener("click", () => {
        if (carouselSlide > 1) {
          carouselSlide--;
          renderCarouselSlide();
        }
      });
    }

    if (nextSlide) {
      nextSlide.addEventListener("click", () => {
        if (carouselSlide < 6) {
          carouselSlide++;
          renderCarouselSlide();
        }
      });
    }

    // Carousel dots
    document.querySelectorAll(".carousel-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        carouselSlide = parseInt(dot.dataset.slide, 10);
        renderCarouselSlide();
      });
    });
  }

  // Complete onboarding and save preferences
  async function completeOnboarding() {
    // Save theme preference
    const theme = normalizeThemeKey(onboardingSelectedTheme);
    try {
      await chrome.storage.sync.set({ panelTheme: theme });
    } catch { }
    try { localStorage.setItem(THEME_KEY, theme); } catch { }
    applyTheme(theme);

    // Theme is already applied via live preview
    const themeSelect = $("#themeSelect");
    if (themeSelect) themeSelect.value = theme;

    await markOnboardingDone();
    hideOnboardingModal();

    showToast(t("toast_theme_applied", "Theme updated."), { duration: 2000 });
  }

  // Initialize onboarding on first run
  async function maybeShowOnboarding() {
    const shouldShow = await shouldShowOnboarding();
    if (shouldShow) {
      showOnboardingModal();
    }
  }


  function setHintMessage(key, fallback = "", substitutions) {
    const hintEl = $("#hint");
    if (!hintEl) return;
    if (key === null) {
      hintEl.textContent = "";
      return;
    }
    // Redundant message display disabled in favor of footer log.
    // hintEl.textContent = t(key, substitutions, fallback);
  }

  function recordUserNotice(level, message) {
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return;
    const entry = {
      type: level === "error" ? "error" : level === "warn" ? "warn" : "info",
      message: text,
      time: Date.now(),
      id: ++FOOTER_LOG_SEQ
    };
    const last = FOOTER_LOG[FOOTER_LOG.length - 1];
    if (last && last.type === entry.type && last.message === entry.message) {
      last.time = entry.time;
      renderFooterLog();
      return;
    }
    FOOTER_LOG.push(entry);
    if (FOOTER_LOG.length > FOOTER_LOG_LIMIT) {
      FOOTER_LOG.splice(0, FOOTER_LOG.length - FOOTER_LOG_LIMIT);
    }
    renderFooterLog();
  }

  function renderFooterLog() {
    const container = document.getElementById("footerDiagnostics");
    if (!container) return;

    const entries = FOOTER_LOG.slice(-FOOTER_LOG_LIMIT);
    const placeholder = container.querySelector(".footer-log-empty");
    const existingNodes = Array.from(container.querySelectorAll(".footer-log-entry"));

    if (!entries.length) {
      container.dataset.state = "empty";
      existingNodes.forEach((node) => node.remove());
      if (placeholder) {
        placeholder.textContent = t("label_footer_logs_empty", "No recent messages.");
      } else {
        const empty = document.createElement("div");
        empty.className = "footer-log-empty";
        empty.textContent = t("label_footer_logs_empty", "No recent messages.");
        container.appendChild(empty);
      }
      return;
    }

    container.dataset.state = "filled";
    if (placeholder) placeholder.remove();

    const nodeById = new Map();
    existingNodes.forEach((node) => {
      const nodeId = node.dataset.logId;
      if (nodeId) {
        nodeById.set(nodeId, node);
      }
    });

    const desired = entries.slice().reverse();
    let previousRow = null;

    const updateRow = (row, entry) => {
      row.className = `footer-log-entry footer-log-${entry.type}`;
      row.dataset.logId = String(entry.id);

      const timeEl = row.querySelector(".footer-log-time");
      if (timeEl) {
        try {
          const d = new Date(entry.time);
          const timeText = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          if (timeEl.textContent !== timeText) {
            timeEl.textContent = timeText;
          }
        } catch {
          if (timeEl.textContent) {
            timeEl.textContent = "";
          }
        }
      }

      const textEl = row.querySelector(".footer-log-text");
      if (textEl && textEl.textContent !== entry.message) {
        textEl.textContent = entry.message;
      }
    };

    desired.forEach((entry) => {
      if (!entry) return;
      if (!entry.id) {
        entry.id = ++FOOTER_LOG_SEQ;
      }
      const idKey = String(entry.id);
      let row = nodeById.get(idKey);
      if (row) {
        nodeById.delete(idKey);
      } else {
        row = document.createElement("div");
        const timeEl = document.createElement("span");
        timeEl.className = "footer-log-time";
        const textEl = document.createElement("span");
        textEl.className = "footer-log-text";
        row.appendChild(timeEl);
        row.appendChild(textEl);
      }

      updateRow(row, entry);

      const target = previousRow ? previousRow.nextSibling : (existingNodes.length ? existingNodes[0] : null);
      if (row.parentNode !== container) {
        container.insertBefore(row, target);
      } else if (target !== row && row.nextSibling !== target) {
        container.insertBefore(row, target);
      }

      previousRow = row;
    });

    nodeById.forEach((node) => {
      if (node.parentNode === container) {
        node.remove();
      }
    });
  }

  function setFooterMessagesHidden(hidden) {
    footerMessagesHidden = !!hidden;
    const shell = document.querySelector(".footer-shell");
    if (shell) shell.dataset.messages = footerMessagesHidden ? "hidden" : "visible";
    const toggle = $("#toggleFooterMessages");
    if (toggle) {
      toggle.textContent = footerMessagesHidden ? t("button_show_messages", "Show messages") : t("button_hide_messages", "Hide messages");
      toggle.setAttribute("aria-pressed", footerMessagesHidden ? "true" : "false");
    }
  }

  function bindFooterMessageToggle() {
    const toggle = $("#toggleFooterMessages");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      setFooterMessagesHidden(!footerMessagesHidden);
    });
    setFooterMessagesHidden(false);
  }

  function rememberCanvasName(hash, name) {
    if (typeof hash !== "string" || !hash || typeof name !== "string" || !name) return;
    if (CANVAS_NAME_CACHE.get(hash) === name) return;
    CANVAS_NAME_CACHE.set(hash, name);
  }

  function applyCanonicalCanvasName(item) {
    if (!item || item.kind !== "canvas") return;
    const hash = typeof item.contentHash === "string" && item.contentHash ? item.contentHash : null;
    if (hash && typeof item.canonicalName === "string" && item.canonicalName) {
      rememberCanvasName(hash, item.canonicalName);
    } else if (hash && CANVAS_NAME_CACHE.has(hash)) {
      item.canonicalName = CANVAS_NAME_CACHE.get(hash);
    }
    if (item.canonicalName) {
      const ext = (() => {
        if (item.filename && item.filename.includes(".")) {
          const candidate = item.filename.split(".").pop();
          if (candidate) return candidate.toLowerCase();
        }
        if (item.mime) {
          const guessed = mimeToExtension(item.mime);
          if (guessed) return guessed;
        }
        return "png";
      })();
      const safeName = ensureSafeFilenameCandidate(`${item.canonicalName}.${ext}`, { defaultExt: ext });
      item.filename = safeName;
    }
  }

  async function syncCanvasNameRegistry(tabId) {
    try {
      const resp = await sendToContent(tabId, { action: "getCanvasNameCache" });
      if (resp && resp.ok && Array.isArray(resp.entries)) {
        for (const entry of resp.entries) {
          if (!entry || typeof entry !== "object") continue;
          const hash = typeof entry.hash === "string" ? entry.hash : null;
          const name = typeof entry.name === "string" ? entry.name : null;
          if (hash && name) rememberCanvasName(hash, name);
        }
      }
    } catch { }
  }

  function isSupportedContentUrl(url) {
    if (!url || typeof url !== "string") return false;
    const lower = url.toLowerCase();
    return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("file://");
  }

  function tabSupportsContent(tab) {
    if (!tab || typeof tab !== "object" || tab.id == null) return false;
    return isSupportedContentUrl(tab.url || "");
  }

  const INSTAGRAM_CDN_PATTERNS = ["*://*.fbcdn.net/*", "*://*.cdninstagram.com/*"];

  function originPatternFromUrl(url) {
    try {
      const u = new URL(url);
      return `${u.origin}/*`;
    } catch {
      return null;
    }
  }

  function isInstagramLikeUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const { hostname } = new URL(url);
      const host = hostname.toLowerCase();
      return host.endsWith("instagram.com") || host.endsWith("fbcdn.net") || host.endsWith("cdninstagram.com");
    } catch {
      return false;
    }
  }

  async function ensureInstagramCdnPermissions() {
    if (!chrome?.permissions?.contains || !chrome.permissions?.request) return true;
    try {
      const has = await chrome.permissions.contains({ origins: INSTAGRAM_CDN_PATTERNS });
      if (has) return true;
      const granted = await chrome.permissions.request({ origins: INSTAGRAM_CDN_PATTERNS });
      return !!granted;
    } catch {
      return false;
    }
  }

  async function ensureHostPermission(tab) {
    if (!tab || !tab.url) {
      const message = "Open a webpage (http/https/file) in the main browser window first.";
      setHintMessage("hint_tab_not_supported", message);
      return { ok: false, reason: message };
    }
    let host = null;
    try {
      host = new URL(tab.url).hostname;
    } catch {
      host = null;
    }
    const pattern = originPatternFromUrl(tab.url);
    if (!pattern) {
      const message = "Open a webpage (http/https/file) in the main browser window first.";
      setHintMessage("hint_tab_not_supported", message);
      return { ok: false, reason: message };
    }
    if (!askPermissionEachScan) {
      let has = await hasGlobalPermission();
      if (!has) {
        has = await requestGlobalPermission();
      }
      if (!has) {
        const fallback = "Site access was not granted. Re-enable prompts or allow access in the settings.";
        setHintMessage("hint_permission_global_required", fallback);
        return { ok: false, reason: fallback };
      }
      try { await chrome.runtime.sendMessage({ action: "enableGlobalPermissions", origins: GLOBAL_PERMISSION_ALL_ORIGINS }); } catch { }
      setHintMessage(null);
      return { ok: true, pattern };
    }
    const hasPermission = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
    if (!hasPermission) {
      const explainedSeen = await chrome.storage.local.get({ [HOST_PERMISSION_EXPLAINED_KEY]: false });
      if (!explainedSeen[HOST_PERMISSION_EXPLAINED_KEY]) {
        const fallback = `Unshackle only requests access after you click scan.\nWe need temporary access to ${host || "this site"} to read images. Continue?`;
        const message = t("confirm_host_permission", [host || ""], fallback);
        const proceed = window.confirm(message);
        if (!proceed) {
          const message = "Permission request was cancelled.";
          setHintMessage("hint_permission_cancelled", message);
          return { ok: false, reason: message };
        }
        await chrome.storage.local.set({ [HOST_PERMISSION_EXPLAINED_KEY]: true });
      }
      const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
      if (!granted) {
        const message = "Chrome did not grant access to this site.";
        setHintMessage("hint_permission_denied", message);
        return { ok: false, reason: message };
      }
      try { await chrome.runtime.sendMessage({ action: "rememberHost", pattern }); } catch { }
    } else {
      try { await chrome.runtime.sendMessage({ action: "rememberHost", pattern }); } catch { }
    }
    return { ok: true, pattern };
  }

  async function hkRequireActiveTabPermission() {
    const tabInfo = await hkGetActiveTabInfo();
    if (!tabInfo) {
      hkSetMangaStatus("Open a webpage (http/https/file) in the main browser window first.", "warn");
      return null;
    }
    const perm = await ensureHostPermission(tabInfo);
    if (!perm?.ok) {
      if (perm.reason) {
        hkSetMangaStatus(perm.reason, "warn");
      }
      return null;
    }
    return tabInfo;
  }

  async function ensureBridgeInjected(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["bridge_inject.js"],
        world: "ISOLATED"
      });
    } catch (err) {
      const msg = String(err?.message || "");
      if (!/Cannot access contents of url/i.test(msg)) {
        // ignore duplicate injections
      }
    }
  }

  function ensureEligibleTab(tab) {
    if (!tab || tab.id == null) {
      setHintMessage("hint_no_active_tab", "No active tab.");
      return false;
    }
    if (!tabSupportsContent(tab)) {
      setHintMessage("hint_tab_not_supported", "Open a webpage (http/https/file) in the main browser window first.");
      return false;
    }
    return true;
  }

  async function hydrateBlobUrlsForCache(tabId, previousSelection = new Set()) {
    const resultSelection = new Set();
    if (!CACHE.length) return resultSelection;
    const activeRaw = new Set();
    const needsFetch = [];
    for (const item of CACHE) {
      if (!item || typeof item !== "object") continue;
      const raw = (typeof item.rawUrl === "string" && item.rawUrl.startsWith("blob:")) ? item.rawUrl : null;
      if (!raw) continue;
      activeRaw.add(raw);
      if (!RAW_BLOB_CACHE.has(raw) && tabId != null) {
        needsFetch.push(raw);
      }
    }
    if (RAW_BLOB_CACHE.size) {
      RAW_BLOB_CACHE.forEach((entry, raw) => {
        if (!activeRaw.has(raw)) {
          if (entry && entry.url && isExtensionBlobUrl(entry.url)) revokeTracked(entry.url);
          RAW_BLOB_CACHE.delete(raw);
        }
      });
    }
    if (needsFetch.length && tabId != null) {
      for (let i = 0; i < needsFetch.length; i += BLOB_BATCH_SIZE) {
        const batch = needsFetch.slice(i, i + BLOB_BATCH_SIZE);
        try {
          const resp = await sendToContent(tabId, { action: "serializeBlobUrls", urls: batch });
          if (resp && resp.ok && resp.data) {
            for (const raw of batch) {
              const payload = resp.data[raw];
              if (!payload) continue;
              const prev = RAW_BLOB_CACHE.get(raw);
              let entry = null;
              let mime = payload.mime || prev?.mime || "";
              if (payload.tooLarge) {
                entry = {
                  url: PLACEHOLDER_DATA_URL,
                  mime: mime ? String(mime).toLowerCase() : "",
                  size: payload.size || prev?.size || 0,
                  tooLarge: true
                };
              } else if (payload.missing) {
                entry = {
                  url: PLACEHOLDER_DATA_URL,
                  mime: mime ? String(mime).toLowerCase() : "",
                  size: prev?.size || 0,
                  missing: true
                };
              } else if (typeof payload.dataUrl === "string" && payload.dataUrl.startsWith("data:")) {
                if (!mime) {
                  const m = /^data:([^;]+);/i.exec(payload.dataUrl);
                  if (m && m[1]) mime = m[1].toLowerCase();
                }
                entry = {
                  url: payload.dataUrl,
                  mime: mime ? String(mime).toLowerCase() : "",
                  size: payload.size || prev?.size || 0
                };
              } else if (payload.buffer && payload.buffer instanceof ArrayBuffer) {
                if (!mime || mime === "application/octet-stream") {
                  const guessed = guessMimeFromBuffer(payload.buffer);
                  if (guessed) mime = guessed;
                }
                try {
                  const blob = new Blob([payload.buffer], { type: mime || "application/octet-stream" });
                  const blobUrl = trackBlobUrl(URL.createObjectURL(blob));
                  entry = {
                    url: blobUrl,
                    mime: mime ? String(mime).toLowerCase() : "",
                    size: payload.size || prev?.size || 0
                  };
                } catch { }
              }
              if (entry) {
                if (prev && prev.url && prev.url !== entry.url && isExtensionBlobUrl(prev.url)) {
                  revokeTracked(prev.url);
                }
                RAW_BLOB_CACHE.set(raw, entry);
              }
            }
          }
        } catch { }
        await cooperativeDelay(50);
      }
    }
    for (const item of CACHE) {
      if (!item || typeof item !== "object") continue;
      const rawKey = (typeof item.rawUrl === "string" && item.rawUrl.startsWith("blob:")) ? item.rawUrl : null;
      if (rawKey) {
        const cached = RAW_BLOB_CACHE.get(rawKey);
        if (cached) {
          if (cached.url) {
            item.url = cached.url;
          }
          if (cached.mime) item.mime = String(cached.mime).toLowerCase();
          item.__format = undefined;
          if (cached.tooLarge) {
            item.__tooLarge = true;
            item.__format = "blob";
            item.__previewMessage = t("hint_blob_too_large", "Blob exceeds 25 MB limit; preview unavailable.");
          } else if (cached.missing) {
            item.__missingBlob = true;
            item.__format = "blob";
            item.__previewMessage = t("hint_blob_missing", "Blob bytes unavailable for preview.");
          } else {
            item.__previewMessage = null;
          }
        }
      }
      applyCanonicalCanvasName(item);
      const selectionKeys = [item.url, rawKey];
      for (const key of selectionKeys) {
        if (key && previousSelection.has(key)) {
          resultSelection.add(item.url);
          break;
        }
      }
    }
    if (!resultSelection.size && previousSelection.size) {
      CACHE.forEach((it) => {
        if (previousSelection.has(it.url)) resultSelection.add(it.url);
      });
    }
    return resultSelection;
  }

  // In memory cache of scanned images. Each entry: { kind, type, rawUrl, url, width, height, filename }
  let CACHE = [];
  // Selected items keyed by url
  let SELECTED = new Set();

  function getCacheDedupKey(item) {
    if (!item || typeof item !== "object") return null;
    if (typeof item.contentHash === "string" && item.contentHash.length) {
      return `hash:${item.contentHash}`;
    }
    if (typeof item.sourceId === "string" && item.sourceId.length) {
      return `src:${item.sourceId}`;
    }
    const normalized = typeof item.normalizedUrl === "string" && item.normalizedUrl.length ? item.normalizedUrl : null;
    if (normalized) return normalized;
    const kind = typeof item.kind === "string" ? item.kind : "";
    const isCanvas = kind === "canvas";
    if (isCanvas) {
      if (typeof item.canonicalName === "string" && item.canonicalName.length) {
        return `${kind}:name:${item.canonicalName}`;
      }
      if (typeof item.filename === "string" && item.filename.length) {
        return `${kind}:${item.filename}`;
      }
    }
    if (typeof item.url === "string" && item.url.length) return item.url;
    if (typeof item.rawUrl === "string" && item.rawUrl.length) return `raw:${item.rawUrl}`;
    if (typeof item.filename === "string" && item.filename.length) return `${kind}:${item.filename}`;
    if (Number.isFinite(item.__domOrder)) return `dom:${item.__domOrder}`;
    return null;
  }

  function syncSelectionWithCache() {
    const valid = new Set(CACHE.map((item) => item && item.url).filter(Boolean));
    SELECTED = new Set(Array.from(SELECTED).filter((url) => valid.has(url)));
  }

  // Auto scan polling timer
  let autoScanTimer = null;
  let autoImagesEnabled = false;
  let autoCanvasEnabled = false;
  let moduleStatusEl = null;
  let moduleScanBtn = null;
  let moduleTriggerButtons = [];
  let AUTO_STREAM_TAB_ID = null;
  const PENDING_BLOB_HYDRATION = new Set();

  function markBlobHydrationNeeded(tabId) {
    if (tabId == null) return;
    PENDING_BLOB_HYDRATION.add(tabId);
  }

  function stopAutoScanLoop() {
    if (autoScanTimer) {
      clearInterval(autoScanTimer);
      autoScanTimer = null;
    }
  }

  async function refreshCacheFromContent(tabId, prevSelection = null, options = {}) {
    const { force = false } = options;
    const shouldHydrate = force || (tabId != null && PENDING_BLOB_HYDRATION.has(tabId));
    if (!shouldHydrate) return;
    const prev = prevSelection instanceof Set ? prevSelection : new Set(SELECTED);
    const viewerItems = CACHE.filter((item) => item?.__viewer || item?.__source);
    try {
      CACHE.forEach(applyCanonicalCanvasName);
      SELECTED = await hydrateBlobUrlsForCache(tabId, prev);
      CACHE.forEach(applyCanonicalCanvasName);
      if (viewerItems.length) {
        const existingUrls = new Set(CACHE.map((item) => item && item.url).filter(Boolean));
        const reattach = viewerItems.filter((item) => item && item.url && !existingUrls.has(item.url));
        reattach.forEach((item) => applyCanonicalCanvasName(item));
        CACHE = CACHE.concat(reattach);
        viewerItems.forEach((item) => {
          if (item?.url && prev.has(item.url)) {
            SELECTED.add(item.url);
          }
        });
      }
      annotateDiscovery(CACHE, CURRENT_SCAN_ID || SCAN_SEQUENCE);
      renderGrid();
      if (tabId != null) {
        PENDING_BLOB_HYDRATION.delete(tabId);
      }
    } catch {
      // hydration errors are non-fatal
    }
  }

  async function reloadCacheSnapshotFromContent(tabId) {
    try {
      const res = await sendToContent(tabId, { action: "getCached" });
      if (!res || !res.ok || !Array.isArray(res.images)) return false;

      // Deduplication logic
      const existingKeys = new Set(CACHE.map(getCacheDedupKey).filter(Boolean));
      const newItems = [];
      for (const item of res.images) {
        const key = getCacheDedupKey(item);
        if (key && !existingKeys.has(key)) {
          newItems.push(item);
          existingKeys.add(key);
        }
      }

      if (newItems.length > 0) {
        CACHE = CACHE.concat(newItems);
        await incrementStat("imagesScanned", newItems.length);
        markBlobHydrationNeeded(tabId);
        await refreshCacheFromContent(tabId, new Set(SELECTED), { force: true });
      }
      return true;
    } catch {
      return false;
    }
  }

  function addImageItem(item) {
    if (!item || typeof item !== "object") return false;
    const candidate = { ...item };
    applyCanonicalCanvasName(candidate);
    const existingKeys = new Set(CACHE.map(getCacheDedupKey).filter(Boolean));
    const key = getCacheDedupKey(candidate);
    if (key && existingKeys.has(key)) return false;
    const scanId = CURRENT_SCAN_ID || (++SCAN_SEQUENCE);
    CACHE.push(candidate);
    annotateDiscovery([candidate], scanId);
    renderGrid();
    summarize();
    return true;
  }

  function startAutoScanLoop(tabId, interval = 900) {
    stopAutoScanLoop();
    autoScanTimer = setInterval(() => {
      reloadCacheSnapshotFromContent(tabId).catch(() => { });
    }, interval);
  }

  // --- Helpers ---
  function ext(url) {
    const m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(url);
    if (m) return m[1].toLowerCase();
    if (url.startsWith("data:image/")) {
      const mm = /^data:image\/([a-z0-9+.-]+);/i.exec(url);
      return mm ? (mm[1].includes("jpeg") ? "jpg" : mm[1]) : "";
    }
    return "";
  }

  // Convert a Blob to another image format using a temporary canvas. Supports
  // WEBP, JPG (JPEG), and PNG. If fmt is falsy or the browser cannot convert,
  // the original blob is returned. JPEG quality is set to 0.92.
  async function convertBlobToFormat(blob, fmt) {
    if (!fmt) return blob;
    const mime = fmt === 'jpg' ? 'image/jpeg' : (fmt === 'png' ? 'image/png' : (fmt === 'webp' ? 'image/webp' : ''));
    if (!mime) return blob;
    // Create an Image from the blob
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((newBlob) => {
            revokeTracked(tempUrl);
            resolve(newBlob || blob);
          }, mime, fmt === 'jpg' ? 0.92 : undefined);
        } catch {
          revokeTracked(tempUrl);
          resolve(blob);
        }
      };
      img.onerror = () => {
        revokeTracked(tempUrl);
        resolve(blob);
      };
      const tempUrl = trackBlobUrl(URL.createObjectURL(blob));
      img.src = tempUrl;
    });
  }

  // Convert a Uint8Array (or ArrayBuffer) containing image data to another format.
  // Returns a new Uint8Array. If conversion fails, returns the original buffer.
  async function convertArrayBufferToFormat(buffer, fmt) {
    try {
      const blob = new Blob([buffer]);
      const converted = await convertBlobToFormat(blob, fmt);
      if (converted === blob) return new Uint8Array(buffer);
      const arrBuf = await converted.arrayBuffer();
      return new Uint8Array(arrBuf);
    } catch {
      return new Uint8Array(buffer);
    }
  }

  // Replace or append the extension of a filename. If the filename already has
  // an extension, it is replaced with newExt; otherwise newExt is appended.
  function replaceExtension(name, newExt) {
    const base = String(name || "");
    if (!newExt) {
      const fallbackExt = sanitizeExtension(ext(base) || "png");
      return ensureSafeFilenameCandidate(base, { defaultExt: fallbackExt, fallback: base || "image" });
    }
    const safeExt = sanitizeExtension(newExt);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return ensureSafeFilenameCandidate(`${stem}.${safeExt}`, { defaultExt: safeExt, fallback: stem || "image" });
  }
  function currentFilter() {
    return { ...FILTER_STATE };
  }
  function matchesFilters(item) {
    if (!item || typeof item !== "object") return false;
    const { format, kind, discovery, search } = FILTER_STATE;
    if (format && inferFormat(item) !== format) return false;
    if (kind && kind !== "all" && item.kind !== kind) return false;
    if (discovery && discovery !== "all") {
      const status = item.__discovery?.status || "seen";
      if (discovery === "new" && status !== "new") return false;
      if (discovery === "seen" && status !== "seen") return false;
    }
    if (search) {
      const hay = `${item.filename || ""} ${item.url || ""} ${item.rawUrl || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    const skipDimensions = item.__source === HK_PREVIEW_SOURCE;
    if (!skipDimensions) {
      const minW = DIMENSION_FILTER.minWidth || 0;
      const minH = DIMENSION_FILTER.minHeight || 0;
      if (minW > 0) {
        const width = Number(item.width);
        if (!Number.isFinite(width) || width < minW) return false;
      }
      if (minH > 0) {
        const height = Number(item.height);
        if (!Number.isFinite(height) || height < minH) return false;
      }
    }
    return true;
  }
  function filteredItems() {
    const items = CACHE.filter((item) => matchesFilters(item));
    return applySortToItems(items);
  }

  function getDetectionOrder(item) {
    if (item?.__discovery && Number.isFinite(item.__discovery.order)) {
      return item.__discovery.order;
    }
    const idx = CACHE.indexOf(item);
    return idx >= 0 ? idx + 1 : Number.MAX_SAFE_INTEGER;
  }

  function compareByDetection(a, b) {
    const orderA = getDetectionOrder(a);
    const orderB = getDetectionOrder(b);
    if (orderA === orderB) return 0;
    return orderA - orderB;
  }

  function compareByName(a, b) {
    const nameA = (a?.filename || a?.name || "").toString();
    const nameB = (b?.filename || b?.name || "").toString();
    const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp;
    return compareByDetection(a, b);
  }

  function getPixelArea(item) {
    const w = Number(item?.width);
    const h = Number(item?.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 0;
    return w * h;
  }

  function compareByPixelArea(a, b) {
    const pixelsA = getPixelArea(a);
    const pixelsB = getPixelArea(b);
    if (pixelsA !== pixelsB) {
      return pixelsB - pixelsA;
    }
    return compareByDetection(a, b);
  }

  function getFileSizeValue(item) {
    const raw = Number(item?.size);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw;
  }

  function compareByFileSize(a, b) {
    const sizeA = getFileSizeValue(a);
    const sizeB = getFileSizeValue(b);
    if (sizeA !== sizeB) {
      return sizeB - sizeA;
    }
    return compareByDetection(a, b);
  }

  function applySortToItems(items) {
    if (!Array.isArray(items) || items.length <= 1) return items;
    const sortKey = FILTER_STATE.sort || "detected";
    if (sortKey === "detected") {
      return items;
    }
    const list = items.slice();
    switch (sortKey) {
      case "name":
        list.sort(compareByName);
        break;
      case "pixels":
        list.sort(compareByPixelArea);
        break;
      case "filesize":
        list.sort(compareByFileSize);
        break;
      default:
        list.sort(compareByDetection);
        break;
    }
    return list;
  }
  function selectedItems({ visibleOnly = false } = {}) {
    const source = visibleOnly ? filteredItems() : CACHE;
    return source.filter(it => SELECTED.has(it.url));
  }
  function hasActiveFilters() {
    return Boolean(
      FILTER_STATE.format ||
      FILTER_STATE.search ||
      FILTER_STATE.kind !== "all" ||
      FILTER_STATE.discovery !== "all" ||
      FILTER_STATE.sort !== "detected" ||
      (DIMENSION_FILTER.minWidth || 0) > 0 ||
      (DIMENSION_FILTER.minHeight || 0) > 0
    );
  }
  function updateFilterToggleIndicator() {
    const toggle = $("#filterToggle");
    const panel = $("#filterPanel");
    if (!toggle) return;
    const active = hasActiveFilters();
    toggle.dataset.active = active ? "true" : "false";
    if (panel) {
      const open = !panel.hidden;
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }
  function setFilterPanelOpen(open) {
    const toggle = $("#filterToggle");
    const panel = $("#filterPanel");
    if (!toggle || !panel) return;
    const next = !!open;
    panel.hidden = !next;
    panel.classList.toggle("open", next);
    toggle.classList.toggle("is-open", next);
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    updateFilterToggleIndicator();
  }
  function bindFilterToggle() {
    const toggle = $("#filterToggle");
    const panel = $("#filterPanel");
    if (!toggle || !panel) return;
    setFilterPanelOpen(false);
    toggle.addEventListener("click", () => {
      const next = panel.hidden;
      setFilterPanelOpen(next);
      if (next) {
        const focusTarget = panel.querySelector("input, select");
        if (focusTarget && typeof focusTarget.focus === "function") {
          try { focusTarget.focus({ preventScroll: true }); } catch { focusTarget.focus(); }
        }
      }
    });
    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || toggle.contains(event.target)) return;
      setFilterPanelOpen(false);
    });
    updateFilterToggleIndicator();
  }
  function summarize() {
    const total = CACHE.length;
    const visibleItems = filteredItems();
    const visible = visibleItems.length;
    const selectedVisible = selectedItems({ visibleOnly: true }).length;
    const selectedTotal = selectedItems({ visibleOnly: false }).length;
    const countsEl = $("#summaryCounts");
    if (countsEl) countsEl.textContent = t("summary_counts", [total, visible, selectedTotal], `${total} total | ${visible} visible | ${selectedTotal} selected`);
    const discoveryEl = $("#summaryDiscovery");
    if (discoveryEl) {
      const stats = computeDiscoveryStats(visibleItems);
      discoveryEl.textContent = t("label_discovery_stats", [stats.newCount, stats.seenCount], `${stats.newCount} new | ${stats.seenCount} seen`);
    }
    updateSelectionToggleButton(visibleItems);
  }
  function renderGrid() {
    updateFilterToggleIndicator();
    const grid = $("#grid");
    if (!grid) return;
    grid.innerHTML = "";
    const items = filteredItems();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "grid-empty";
      empty.textContent = t("label_no_results", "No captures match these filters yet. Try a scan or adjust filters.");
      grid.appendChild(empty);
      summarize();
      return;
    }
    let lastChapterTitle = null;
    for (const it of items) {
      const chapterTitle = it?.__chapterTitle || null;
      if (chapterTitle && chapterTitle !== lastChapterTitle) {
        const divider = document.createElement("div");
        divider.className = "chapter-divider";
        const label = document.createElement("span");
        label.className = "chapter-divider-text";
        label.textContent = chapterTitle;
        divider.appendChild(label);
        grid.appendChild(divider);
        lastChapterTitle = chapterTitle;
      }
      const card = document.createElement("div");
      card.className = "card";
      if (it?.__source === HK_PREVIEW_SOURCE) {
        card.classList.add("card-manga-preview");
      }
      if (it?.__source === HK_PREVIEW_SOURCE) {
        card.classList.add("card-manga-preview");
      }
      if (it?.__discovery?.status === "new") card.classList.add("card-new");
      card.setAttribute("role", "listitem");
      if (it?.rawUrl) {
        try { card.dataset.rawUrl = it.rawUrl; } catch { }
      }

      const sel = document.createElement("label");
      sel.className = "sel";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = SELECTED.has(it.url);
      cb.addEventListener("change", () => {
        if (cb.checked) SELECTED.add(it.url); else SELECTED.delete(it.url);
        summarize();
      });
      sel.appendChild(cb);

      const img = document.createElement("img");
      img.className = "thumb";
      img.src = it.url;
      img.alt = it.filename;
      img.loading = "lazy";
      if (it.__previewMessage) img.title = it.__previewMessage;

      const formatKey = inferFormat(it);
      const formatLabel = String(formatKey || "data").toUpperCase();

      const meta = document.createElement("div");
      meta.className = "meta";
      const headerRow = document.createElement("div");
      headerRow.className = "meta-row meta-header";
      const nameEl = document.createElement("span");
      nameEl.className = "name";
      nameEl.title = it.filename;
      nameEl.textContent = it.filename;
      const formatEl = document.createElement("span");
      formatEl.className = "format-label";
      formatEl.textContent = formatLabel;
      headerRow.appendChild(nameEl);
      headerRow.appendChild(formatEl);
      meta.appendChild(headerRow);

      const detailsRow = document.createElement("div");
      detailsRow.className = "meta-row meta-details";
      const dimBadge = document.createElement("span");
      dimBadge.className = "badge";
      const w = Number(it.width);
      const h = Number(it.height);
      dimBadge.textContent = (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)
        ? `${Math.round(w)}x${Math.round(h)}`
        : "—";
      detailsRow.appendChild(dimBadge);
      const kindBadge = document.createElement("span");
      kindBadge.className = "badge";
      kindBadge.textContent = formatKindLabel(it.kind);
      detailsRow.appendChild(kindBadge);
      const sizeLabel = formatSize(it.size);
      if (sizeLabel) {
        const sizeBadge = document.createElement("span");
        sizeBadge.className = "badge";
        sizeBadge.textContent = sizeLabel;
        detailsRow.appendChild(sizeBadge);
      }
      meta.appendChild(detailsRow);

      if (it.__discovery) {
        const discoveryRow = document.createElement("div");
        discoveryRow.className = "meta-row meta-discovery";
        const statusBadge = document.createElement("span");
        statusBadge.className = `badge ${it.__discovery.status === "new" ? "badge-new" : "badge-seen"}`;
        statusBadge.textContent = it.__discovery.status === "new" ? t("badge_new", "New") : t("badge_seen", "Seen");
        discoveryRow.appendChild(statusBadge);
        const seenBadge = document.createElement("span");
        seenBadge.className = "badge";
        seenBadge.textContent = t("badge_seen_count", [it.__discovery.seenCount], `Seen ${it.__discovery.seenCount}x`);
        discoveryRow.appendChild(seenBadge);
        meta.appendChild(discoveryRow);
      }

      const downloadStatus = getDownloadStatus(it.url);
      if (downloadStatus) {
        const statusRow = document.createElement("div");
        statusRow.className = "meta-row meta-status";
        const badge = document.createElement("span");
        let key = "badge_download_queued";
        let fallback = "Queued";
        let cls = "badge-queued";
        if (downloadStatus.status === "success") {
          key = "badge_download_done";
          fallback = "Downloaded";
          cls = "badge-success";
        } else if (downloadStatus.status === "error") {
          key = "badge_download_failed";
          fallback = "Download failed";
          cls = "badge-error";
        }
        badge.className = `badge ${cls}`;
        badge.textContent = t(key, fallback);
        if (downloadStatus.message) badge.title = downloadStatus.message;
        statusRow.appendChild(badge);
        meta.appendChild(statusRow);
      }

      const actionsRow = document.createElement("div");
      actionsRow.className = "meta-row meta-actions";

      const deleteBtnWrap = document.createElement("div");
      deleteBtnWrap.className = "action-stack";
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = t("button_delete", "Delete");
      deleteBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const idx = CACHE.indexOf(it);
        if (idx !== -1) {
          revokeTracked(it.url);
          CACHE.splice(idx, 1);
          SELECTED.delete(it.url);
          renderGrid();
        }
      });
      deleteBtnWrap.appendChild(deleteBtn);

      const previewBtn = document.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "preview-btn";
      previewBtn.textContent = t("button_preview", "Preview");
      const handlePreviewClick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const directSrc = it.url || "";
        if (directSrc.startsWith("blob:")) {
          const rawTarget = (typeof it.rawUrl === "string" && it.rawUrl.startsWith("blob:")) ? it.rawUrl : directSrc;
          if (!rawTarget.startsWith(`blob:${EXTENSION_ORIGIN}`)) {
            const w = window.open(rawTarget, "_blank", "noopener");
            if (w) {
              try { w.opener = null; } catch { }
            }
            return;
          }
        }
        const title = escapeHtml(it.filename || "Preview");
        const safeSrc = escapeHtml(it.url || "");
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;background:#111;color:#f5f5f5;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}figure{margin:0;padding:24px;max-width:100%;box-sizing:border-box;text-align:center;}img{max-width:100%;max-height:80vh;object-fit:contain;border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,0.45);}figcaption{margin-top:16px;font-size:14px;word-break:break-word;}</style></head><body><figure><img src="${safeSrc}" alt="${title}"><figcaption>${title}</figcaption></figure></body></html>`;
        const pageBlob = new Blob([html], { type: "text/html;charset=utf-8" });
        const pageUrl = trackBlobUrl(URL.createObjectURL(pageBlob));
        let cleaned = false;
        let timerId = null;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          if (timerId) clearTimeout(timerId);
          revokeTracked(pageUrl);
        };
        timerId = setTimeout(cleanup, 5 * 60 * 1000);
        const previewWin = window.open(pageUrl, "_blank", "noopener");
        if (previewWin) {
          try { previewWin.opener = null; } catch { }
          try { previewWin.addEventListener("beforeunload", cleanup, { once: true }); } catch { }
        } else {
          cleanup();
        }
      };
      if (it.__tooLarge || it.__missingBlob) {
        previewBtn.disabled = true;
        previewBtn.title = it.__previewMessage || t("hint_blob_preview_unavailable", "Preview unavailable for this item.");
      } else {
        previewBtn.addEventListener("click", handlePreviewClick);
      }
      deleteBtnWrap.appendChild(previewBtn);
      actionsRow.appendChild(deleteBtnWrap);

      if (it.__previewMessage) {
        const note = document.createElement("div");
        note.className = "meta-note";
        note.textContent = it.__previewMessage;
        meta.appendChild(note);
      }
      meta.appendChild(actionsRow);

      card.appendChild(sel);
      card.appendChild(img);
      card.appendChild(meta);
      grid.appendChild(card);
    }
    summarize();
  }


  async function getActiveTab() {
    const queryActiveTab = async (criteria) => {
      try {
        const tabs = await chrome.tabs.query(criteria);
        if (Array.isArray(tabs) && tabs.length) {
          return tabs[0];
        }
      } catch {
        // ignore and fall through to the next strategy
      }
      return null;
    };
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (win?.id != null) {
        const tab = await queryActiveTab({ windowId: win.id, active: true });
        if (tab) {
          return tab;
        }
      }
    } catch {
      // ignore and try the fallback
    }
    const fallbackTab = await queryActiveTab({ active: true, lastFocusedWindow: true });
    if (fallbackTab) {
      return fallbackTab;
    }
    return queryActiveTab({ active: true });
  }

  function sendToContent(tabId, payload) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, payload, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: String(chrome.runtime.lastError.message || chrome.runtime.lastError) });
        } else {
          resolve(resp);
        }
      });
    });
  }

  async function ensureContent(tabId, retries = 3) {
    return ensureModeContent(tabId, "image", retries);
  }

  async function ensureModeContent(tabId, mode = "image", retries = 3) {
    let tabInfo = null;
    try {
      tabInfo = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (!ensureEligibleTab(tabInfo)) return false;
    const perm = await ensureHostPermission(tabInfo);
    if (!perm.ok) {
      if (perm.reason) {
        recordUserNotice("warn", perm.reason);
      }
      return false;
    }
    await ensureBridgeInjected(tabId);
    let pong = await sendToContent(tabId, { action: "getCached" });
    if (pong && pong.ok) return true;
    try {
      const fileName = mode === "manga" ? "content_manga.js" : "content.js";
      await chrome.scripting.executeScript({ target: { tabId }, files: [fileName] });
    } catch {
      return false;
    }
    while (retries-- > 0) {
      await new Promise(r => setTimeout(r, 150));
      pong = await sendToContent(tabId, { action: "getCached" });
      if (pong && pong.ok) return true;
    }
    return false;
  }

  function deriveScanProfile(types = []) {
    const list = Array.isArray(types) ? types : [];
    const backgroundOnly = list.length > 0 && list.every((type) => type === "background" || type === "dataUri" || type === "svg");
    return backgroundOnly ? "background" : "primary";
  }

  function beginScanSession(types = []) {
    const scanId = ++SCAN_SEQUENCE;
    const profile = deriveScanProfile(types);
    CURRENT_SCAN_ID = scanId;
    ACTIVE_SCAN_SESSION = {
      id: scanId,
      types: Array.isArray(types) ? types.slice() : [],
      profile,
      startedAt: Date.now()
    };
    return ACTIVE_SCAN_SESSION;
  }

  function endScanSession(scanId) {
    if (ACTIVE_SCAN_SESSION && (!scanId || ACTIVE_SCAN_SESSION.id === scanId)) {
      ACTIVE_SCAN_SESSION = null;
    }
  }

  function getSelectedExtractionTypes() {
    // Default to tags plus related background/data sources so manual scans stay comprehensive.
    return ["img", "background", "dataUri", "blob", "svg"];
  }

  async function runScan(types) {
    const requestedTypes = Array.isArray(types) && types.length ? types.slice() : getSelectedExtractionTypes();
    const session = beginScanSession(requestedTypes);
    await incrementStat("scans", 1);
    startProgress(t("label_scanning_prepare", "Preparing scan..."), 100);
    updateProgress(3, 100, t("label_scanning_prepare", "Preparing scan..."));
    const tab = await getActiveTab();
    if (session) session.tabId = tab?.id ?? null;
    if (!ensureEligibleTab(tab)) {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      endScanSession(session?.id);
      return;
    }
    const proceed = await guardViewerBeforeScan(tab);
    if (!proceed) {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      endScanSession(session?.id);
      return;
    }
    updateProgress(8, 100, t("label_scanning_connect", "Connecting to page..."));
    const ok = await ensureContent(tab.id);
    if (!ok) {
      const message = t("hint_connect_retry", null, "Could not connect to page (try reloading).");
      setHintMessage("hint_connect_retry", "Could not connect to page (try reloading).");
      recordUserNotice("error", message);
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      endScanSession(session?.id);
      return;
    }
    updateProgress(12, 100, t("label_scanning_sync", "Preparing canvas registry..."));
    await syncCanvasNameRegistry(tab.id);
    const dims = updateDimensionFilterFromInputs();
    const minW = dims.minWidth;
    const minH = dims.minHeight;
    CACHE = [];
    SELECTED = new Set();
    renderGrid();
    const options = {
      minWidth: minW,
      minHeight: minH,
      types: requestedTypes,
      scanId: session?.id,
      scanProfile: session?.profile || "primary"
    };
    const { cancelBtn } = getProgressElements();
    if (cancelBtn) cancelBtn.disabled = true;
    const res = await sendToContent(tab.id, { action: "scan", options });
    if (res && res.ok) {
      markBlobHydrationNeeded(tab.id);
      await refreshCacheFromContent(tab.id, new Set(), { force: true });
      if (!CACHE.length && Number(res?.total) > 0) {
        await reloadCacheSnapshotFromContent(tab.id);
      }
      updateProgress(100, 100, t("label_progress_done", "Done"));
      finishProgress(t("label_progress_done", "Done"));
      setHintMessage(null);
    } else {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      if (res && res.error) {
        const hint = $("#hint");
        if (hint) hint.textContent = res.error;
        recordUserNotice("error", res.error);
      } else {
        const message = t("hint_scan_failed", null, "Scan failed.");
        setHintMessage("hint_scan_failed", "Scan failed.");
        recordUserNotice("error", message);
      }
    }
    endScanSession(session?.id);
  }

  async function handleScanProgressMessage(message, sender) {
    if (!message || typeof message.scanId !== "number") return;
    const senderTabId = sender?.tab?.id ?? null;
    const session = (ACTIVE_SCAN_SESSION && message.scanId === ACTIVE_SCAN_SESSION.id) ? ACTIVE_SCAN_SESSION : null;
    const sessionTabMatch = session && (session.tabId == null || senderTabId == null || senderTabId === session.tabId);
    const autoMatch = !session && AUTO_STREAM_TAB_ID != null && senderTabId === AUTO_STREAM_TAB_ID;
    if (!sessionTabMatch && !autoMatch) return;

    if (Array.isArray(message.images) && message.images.length) {
      const tabId = sessionTabMatch ? session.tabId : senderTabId;
      const dedup = new Set(CACHE.map((item) => getCacheDedupKey(item) || "").filter(Boolean));
      const newItems = [];
      let containsBlob = false;
      for (const raw of message.images) {
        const item = raw ? { ...raw } : null;
        if (!item) continue;
        applyCanonicalCanvasName(item);
        let key = getCacheDedupKey(item);
        if (!key) key = `__idx:${dedup.size + newItems.length + 1}`;
        if (dedup.has(key)) continue;
        dedup.add(key);
        newItems.push(item);
        if (!containsBlob && typeof item?.rawUrl === "string" && item.rawUrl.startsWith("blob:")) {
          containsBlob = true;
        }
      }
      if (newItems.length) {
        CACHE = CACHE.concat(newItems);
        await incrementStat("imagesScanned", newItems.length);
        if (containsBlob && tabId != null) {
          markBlobHydrationNeeded(tabId);
        }
        CACHE.forEach(applyCanonicalCanvasName);
        annotateDiscovery(CACHE, CURRENT_SCAN_ID || session?.id || SCAN_SEQUENCE);
        renderGrid();
      }
    }

    if (!sessionTabMatch || !progressState) return;
    if (typeof message.phase === "string") {
      setProgressPhase(message.phase);
    } else if (session?.profile) {
      setProgressPhase(session.profile);
    }
    if (typeof message.percent === "number") {
      const pct = Math.max(0, Math.min(100, message.percent));
      updateProgress(pct, 100, message.label || progressState.label || t("label_scanning", "Scanning..."));
    } else if (message.label) {
      updateProgress(progressState.completed || 0, progressState.total || 100, message.label);
    }
  }

  // Event handlers for scanning buttons
  function bindScanButtons() {
    const btnScan = $("#btnScan");
    if (btnScan) {
      btnScan.addEventListener("click", () => {
        const isNetworkOnly = !!window.__UNSHACKLE_NETWORK_ONLY_MODE__;
        const isScanning = isNetworkOnly ? btnScan.dataset.scanning === "true" : autoImagesEnabled;
        handleAutoImagesToggle(!isScanning).catch(() => { });
      });
    }
    const btnCanvas = $("#btnCanvas");
    if (btnCanvas) {
      btnCanvas.addEventListener("click", () => {
        handleAutoCanvasToggle(!autoCanvasEnabled).catch(() => { });
      });
    }
  }

  function runInitGuard(fn, label) {
    try {
      return fn();
    } catch (error) {
      console.error(`[Panel] Failed to initialize ${label}:`, error);
      return null;
    }
  }

  async function robustViewerCheck(tabId, timeoutMs = 1500) {
    const probe = {
      ok: false,
      frames: [],
      error: null,
      tabId,
      timestamp: Date.now()
    };
    if (!tabId && tabId !== 0) {
      VIEWER_LAST_PROBE = probe;
      return probe;
    }
    try {
      await injectGV(tabId);
    } catch (err) {
      probe.error = String(err?.message || err);
      VIEWER_LAST_PROBE = probe;
      return probe;
    }
    let results = [];
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func: async () => {
          const registry = globalThis.UnshackleSites;
          const mods = registry
            ? (typeof registry.list === "function"
              ? registry.list()
              : Array.isArray(registry.modules)
                ? registry.modules
                : Object.values(registry.modules || {}))
            : [];
          const frameInfo = {
            frame: location.href,
            viewers: [],
            error: null
          };
          if (!Array.isArray(mods) || !mods.length) {
            frameInfo.error = "registry-empty";
            return frameInfo;
          }
          for (const mod of mods) {
            if (!mod || !mod.id) continue;
            const entry = {
              id: mod.id,
              displayName: mod.displayName || mod.id,
              detected: false,
              ok: false,
              readable: false,
              pageCount: 0,
              reason: "",
              origins: []
            };
            try {
              let detected = true;
              if (typeof mod.detect === "function") {
                try {
                  detected = await mod.detect(location.href);
                } catch (err) {
                  detected = false;
                  entry.reason = `detect-error:${String(err?.message || err)}`;
                }
              }
              entry.detected = !!detected;
              let probeResult = null;
              if (entry.detected || typeof mod.detect !== "function") {
                if (typeof mod.probe === "function") {
                  try {
                    probeResult = await mod.probe(location.href);
                  } catch (err) {
                    entry.reason = entry.reason || `probe-error:${String(err?.message || err)}`;
                  }
                }
              }
              const probeReady = !!probeResult && (
                probeResult.ok === true
                || probeResult.ready === true
                || probeResult.hydrated === true
                || probeResult.descrambled === true
                || Number.isFinite(probeResult.pageCount)
                || (Array.isArray(probeResult.pages) && probeResult.pages.length > 0)
              );
              if (!entry.detected && probeReady) {
                entry.detected = true;
              }
              let pages = [];
              if (typeof mod.listPages === "function") {
                try {
                  const listInput = probeResult ?? location.href;
                  const listed = mod.listPages(listInput);
                  if (Array.isArray(listed)) {
                    pages = listed;
                  } else if (listed && typeof listed.then === "function") {
                    const awaited = await listed;
                    if (Array.isArray(awaited)) {
                      pages = awaited;
                    }
                  }
                } catch (err) {
                  entry.reason = entry.reason || `pages-error:${String(err?.message || err)}`;
                }
              }
              let pageCount = Array.isArray(pages) ? pages.length : 0;
              if (!pageCount && probeResult) {
                const candidates = [];
                const pushCount = (value) => {
                  const num = typeof value === "number" ? value : Number(value);
                  if (Number.isFinite(num)) candidates.push(num);
                };
                const pushLength = (value) => {
                  if (Array.isArray(value)) candidates.push(value.length);
                };
                pushCount(probeResult.pageCount);
                pushLength(probeResult.pages);
                if (probeResult.ptbinb) {
                  pushCount(probeResult.ptbinb.pageCount);
                  pushLength(probeResult.ptbinb.pages);
                  if (!candidates.length && probeResult.ptbinb.hydrated) {
                    candidates.push(1);
                  }
                }
                pushLength(probeResult.jsonPaths);
                if (probeResult.payload) {
                  pushLength(probeResult.payload.pages);
                  pushLength(probeResult.payload.page_list);
                }
                pushCount(probeResult.total);
                const derived = candidates.find((val) => Number.isFinite(val) && val > 0);
                if (Number.isFinite(derived) && derived > 0) {
                  pageCount = derived;
                }
              }
              if (!pageCount && probeReady) {
                const fallbackCount = Number.isFinite(probeResult?.pageCount)
                  ? probeResult.pageCount
                  : (Array.isArray(probeResult?.pages) ? probeResult.pages.length : 1);
                if (Number.isFinite(fallbackCount) && fallbackCount > 0) {
                  pageCount = fallbackCount;
                }
              }
              entry.pageCount = pageCount;
              entry.readable = pageCount > 0 || probeReady;
              if (Array.isArray(pages) && pages.length) {
                entry.origins = pages.slice(0, 8).map((page) => {
                  try {
                    const src = page && typeof page === "object"
                      ? (page.src || page.url || page.href || page.imageUrl || page.path)
                      : page;
                    return src ? new URL(src, location.href).origin : null;
                  } catch {
                    return null;
                  }
                }).filter(Boolean);
              }
              if ((!Array.isArray(entry.origins) || !entry.origins.length) && Array.isArray(probeResult?.origins)) {
                entry.origins = probeResult.origins.map((url) => {
                  try {
                    return new URL(url, location.href).origin;
                  } catch {
                    return null;
                  }
                }).filter(Boolean);
              }
              entry.ok = entry.detected && entry.readable;
            } catch (err) {
              entry.reason = entry.reason || `exception:${String(err?.message || err)}`;
            }
            frameInfo.viewers.push(entry);
          }
          return frameInfo;
        },
        args: []
      });
    } catch (err) {
      probe.error = String(err?.message || err);
      VIEWER_LAST_PROBE = probe;
      return probe;
    }
    const frames = [];
    for (const entry of Array.isArray(results) ? results : []) {
      if (entry && entry.result) {
        frames.push(entry.result);
      }
    }
    probe.frames = frames;
    probe.ok = frames.some((frame) => {
      if (!frame || !Array.isArray(frame.viewers)) return false;
      return frame.viewers.some((viewer) => viewer && viewer.ok);
    });
    VIEWER_LAST_PROBE = probe;
    return probe;
  }

  function findViewerStatus(probe, viewerId) {
    if (!probe || !viewerId) return null;
    const matches = [];
    for (const frame of Array.isArray(probe.frames) ? probe.frames : []) {
      const viewers = Array.isArray(frame?.viewers) ? frame.viewers : [];
      for (const viewer of viewers) {
        if (viewer && viewer.id === viewerId) {
          matches.push({ ...viewer, frame: frame?.frame || null });
        }
      }
    }
    if (!matches.length) return null;
    const ready = matches.find((entry) => entry && entry.ok);
    if (ready) return ready;
    const detected = matches.find((entry) => entry && entry.detected);
    if (detected) return detected;
    return matches[0];
  }

  function findFirstReadyViewer(probe) {
    if (!probe) return null;
    const frames = Array.isArray(probe.frames) ? probe.frames : [];
    const entries = [];
    for (const frame of frames) {
      const viewers = Array.isArray(frame?.viewers) ? frame.viewers : [];
      for (const viewer of viewers) {
        if (viewer) {
          entries.push({ ...viewer, frame: frame?.frame || null });
        }
      }
    }
    if (!entries.length) return null;
    const priority = ["speedbinb"];
    for (const viewerId of priority) {
      const readyMatch = entries.find((entry) => entry.id === viewerId && entry.ok);
      if (readyMatch) {
        return readyMatch;
      }
    }
    const firstReady = entries.find((entry) => entry.ok);
    if (firstReady) {
      return firstReady;
    }
    for (const viewerId of priority) {
      const detectedMatch = entries.find((entry) => entry.id === viewerId && entry.detected);
      if (detectedMatch) {
        return detectedMatch;
      }
    }
    const firstDetected = entries.find((entry) => entry.detected);
    if (firstDetected) {
      return firstDetected;
    }
    return entries[0];
  }

  function collectViewerStatusMap(probe) {
    const map = new Map();
    if (!probe || !Array.isArray(probe.frames)) return map;
    for (const frame of probe.frames) {
      const viewers = Array.isArray(frame?.viewers) ? frame.viewers : [];
      for (const viewer of viewers) {
        if (!viewer?.id) continue;
        const existing = map.get(viewer.id);
        if (!existing || viewer.ok || (viewer.detected && !existing.detected)) {
          map.set(viewer.id, viewer);
        }
      }
    }
    return map;
  }

  function setModuleStatus(message, state = "idle") {
    if (moduleStatusEl) {
      moduleStatusEl.textContent = message || "";
      moduleStatusEl.dataset.state = state || "idle";
    }
    if (moduleScanBtn) {
      moduleScanBtn.classList.toggle("scanning", state === "busy");
    }
  }

  function updateModuleTriggersFromProbe(probe) {
    const map = collectViewerStatusMap(probe);
    moduleTriggerButtons.forEach((btn) => {
      const id = btn?.dataset?.module;
      if (!id) return;
      const status = map.get(id);
      if (status?.ok) {
        btn.dataset.state = "active";
        btn.title = `${getViewerDisplayName(id)} ready (${status.pageCount || "?"} pages)`;
      } else if (status?.detected) {
        btn.dataset.state = "detected";
        btn.title = `${getViewerDisplayName(id)} detected, waiting for data`;
      } else {
        delete btn.dataset.state;
        btn.title = getViewerDisplayName(id);
      }
    });
  }

  async function runModuleScan() {
    const tab = await getActiveTab();
    if (!ensureEligibleTab(tab)) {
      setModuleStatus("Open a supported tab to scan modules.", "warn");
      return;
    }
    const perm = await ensureHostPermission(tab);
    if (!perm.ok) {
      setModuleStatus(perm.reason || "Permission denied.", "warn");
      return;
    }
    setModuleStatus("Scanning modules…", "busy");
    try {
      const probe = await robustViewerCheck(tab.id, 2000);
      VIEWER_LAST_PROBE = probe;
      updateModuleTriggersFromProbe(probe);
      if (probe.ok) {
        const ready = findFirstReadyViewer(probe);
        if (ready) {
          setModuleStatus(`Ready: ${getViewerDisplayName(ready.id)} (${ready.pageCount || "?"}p)`, "ok");
        } else {
          setModuleStatus("Modules loaded. Awaiting data.", "warn");
        }
      } else {
        const msg = probe.error ? `Probe failed: ${probe.error}` : "No compatible modules detected.";
        setModuleStatus(msg, "warn");
      }
    } catch (err) {
      setModuleStatus(`Module scan failed: ${String(err?.message || err)}`, "warn");
    }
  }

  async function triggerViewerModule(viewerId, button = null) {
    if (!viewerId) return;
    const tab = await getActiveTab();
    if (!ensureEligibleTab(tab)) {
      setModuleStatus("Open the target comic tab first.", "warn");
      return;
    }
    const perm = await ensureHostPermission(tab);
    if (!perm.ok) {
      setModuleStatus(perm.reason || "Permission denied.", "warn");
      return;
    }
    setModuleStatus(`Triggering ${getViewerDisplayName(viewerId)}...`, "busy");
    if (button) {
      button.disabled = true;
      button.dataset.loading = "true";
    }
    try {
      await injectGV(tab.id);
      const downloadPromise = startViewerDownload(viewerId, tab, { skipStatusCheck: true });
      // Kick a quick probe in parallel to refresh trigger states without blocking the download
      robustViewerCheck(tab.id, 900).then((probe) => {
        VIEWER_LAST_PROBE = probe;
        updateModuleTriggersFromProbe(probe);
      }).catch((err) => {
        console.warn("Module probe after trigger failed:", err);
      });
      await downloadPromise;
      setModuleStatus(`Triggered ${getViewerDisplayName(viewerId)}.`, "ok");
    } catch (err) {
      setModuleStatus(`Module trigger failed: ${String(err?.message || err)}`, "warn");
    } finally {
      if (button) {
        button.disabled = false;
        delete button.dataset.loading;
      }
    }
  }

  function rebuildSelectionFromCache() {
    const valid = new Set(CACHE.map((item) => item.url));
    SELECTED = new Set([...SELECTED].filter((url) => valid.has(url)));
  }

  function removeViewerItemsFromCache(viewerId = null) {
    if (!CACHE.length) return false;
    const removedUrls = [];
    CACHE = CACHE.filter((item) => {
      const sourceId = item?.__viewer || item?.__source || null;
      const shouldRemove = viewerId ? sourceId === viewerId : !!sourceId;
      if (shouldRemove && item?.url) {
        removedUrls.push(item.url);
      }
      return !shouldRemove;
    });
    if (!removedUrls.length) return false;
    removedUrls.forEach((url) => revokeTracked(url));
    rebuildSelectionFromCache();
    return true;
  }

  function resetGVGallery() {
    GV_GALLERY_ITEMS.forEach((item) => {
      if (item && item.url) {
        try { URL.revokeObjectURL(item.url); } catch { }
      }
    });
    GV_GALLERY_ITEMS.length = 0;
    if (gvGalleryGrid && gvGalleryGrid.dataset.render !== "hidden") {
      gvGalleryGrid.innerHTML = "";
    }
    const removed = removeViewerItemsFromCache();
    updateGVGalleryStatus();
    if (removed) {
      renderGrid();
    }
  }

  function updateGVGalleryStatus() {
    if (gvSaveAllButton) {
      gvSaveAllButton.disabled = GV_GALLERY_ITEMS.length === 0;
    }
    if (gvClearGalleryButton) {
      gvClearGalleryButton.disabled = GV_GALLERY_ITEMS.length === 0;
    }
    if (gvGalleryStatusLabel) {
      if (!GV_GALLERY_ITEMS.length) {
        gvGalleryStatusLabel.textContent = "Gallery empty.";
      } else {
        const pageCount = GV_GALLERY_ITEMS.filter((item) => item.kind === "page").length;
        const extraCount = GV_GALLERY_ITEMS.length - pageCount;
        const parts = [];
        parts.push(`${pageCount} page${pageCount === 1 ? "" : "s"}`);
        if (extraCount > 0) {
          parts.push(`${extraCount} file${extraCount === 1 ? "" : "s"}`);
        }
        gvGalleryStatusLabel.textContent = parts.join(" • ");
      }
    }
  }

  function resolveGalleryBuffer(entry) {
    if (!entry) return null;
    if (entry.buffer instanceof ArrayBuffer) return entry.buffer;
    if (Array.isArray(entry.buffer)) return Uint8Array.from(entry.buffer).buffer;
    if (entry.bytes instanceof ArrayBuffer) return entry.bytes;
    if (Array.isArray(entry.bytes)) return Uint8Array.from(entry.bytes).buffer;
    if (ArrayBuffer.isView(entry.buffer)) {
      const view = entry.buffer;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (ArrayBuffer.isView(entry.bytes)) {
      const view = entry.bytes;
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    if (entry.data instanceof ArrayBuffer) return entry.data;
    if (Array.isArray(entry.data)) return Uint8Array.from(entry.data).buffer;
    return null;
  }

  function addGVGalleryItem({ filename, blob, kind = "page", mimeType = "application/octet-stream", index = null, viewerId = "gigaviewer" }) {
    if (!blob) return;
    const safeName = filename && filename.trim() ? filename : `item-${GV_GALLERY_ITEMS.length + 1}`;
    const entry = {
      name: safeName,
      blob,
      kind,
      mimeType,
      index,
      url: null,
      viewerId
    };
    try {
      entry.url = URL.createObjectURL(blob);
    } catch {
      entry.url = null;
    }
    GV_GALLERY_ITEMS.push(entry);
    if (gvGalleryGrid && gvGalleryGrid.dataset.render !== "hidden") {
      const wrap = document.createElement("div");
      wrap.className = "gv-thumb";
      if (mimeType && mimeType.startsWith("image/") && entry.url) {
        const img = document.createElement("img");
        img.src = entry.url;
        img.alt = safeName;
        img.loading = "lazy";
        wrap.appendChild(img);
      } else {
        const label = document.createElement("div");
        label.className = "gv-thumb-label";
        label.textContent = safeName;
        wrap.appendChild(label);
      }
      gvGalleryGrid.appendChild(wrap);
    }
    updateGVGalleryStatus();
  }

  async function bgZipStoreFromGallery(items) {
    const payload = [];
    for (const item of items) {
      try {
        const arrayBuffer = await item.blob.arrayBuffer();
        payload.push({ name: item.name, buffer: arrayBuffer });
      } catch (err) {
        console.warn("Failed to serialize gallery item for ZIP:", item?.name, err);
      }
    }
    const response = await chrome.runtime.sendMessage({ action: "zipStore", entries: payload });
    if (!response?.ok) throw new Error(response?.error || "zipStore failed");
    if (!(response.data instanceof ArrayBuffer)) {
      throw new Error("zipStore returned unsupported payload");
    }
    return new Blob([response.data], { type: "application/zip" });
  }

  async function downloadBlobWithSaveAs(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: objectUrl,
        filename,
        saveAs: shouldSaveAs(),
        conflictAction: "uniquify"
      }, (downloadId) => {
        if (chrome.runtime.lastError || downloadId == null) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
          return;
        }
        const onChanged = (delta) => {
          if (delta.id !== downloadId || !delta.state) return;
          const state = delta.state.current;
          if (state === "complete") {
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(objectUrl);
            resolve(downloadId);
          } else if (state === "interrupted") {
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(objectUrl);
            const reason = delta.error?.current || "interrupted";
            reject(new Error(reason));
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
      });
    });
  }

  function buildGVZipFilename(seriesTitle, episodeTitle, fallback = "GigaViewer.zip") {
    const base = [seriesTitle, episodeTitle].filter(Boolean).join(" - ") || fallback;
    return ensureSafeFilenameCandidate(`${base}.zip`, { defaultExt: "zip", fallback: "chapter" });
  }

  async function saveGVGalleryAsZip(defaultName) {
    if (!GV_GALLERY_ITEMS.length) {
      const message = "No gallery items to save yet.";
      recordUserNotice("warn", message);
      alert(message);
      return;
    }
    const itemCount = GV_GALLERY_ITEMS.length;
    const zipBlob = await bgZipStoreFromGallery(GV_GALLERY_ITEMS);
    const filename = ensureSafeFilenameCandidate(
      defaultName && defaultName.trim() ? defaultName : buildGVZipFilename(gvCurrentSeriesTitle, gvCurrentEpisodeTitle),
      { defaultExt: "zip", fallback: "chapter" }
    );
    await downloadBlobWithSaveAs(zipBlob, filename);
    // Count all items in the ZIP as downloads
    await recordDownloadSuccess(itemCount);
  }

  async function ingestGVPages(entries, viewerId = "gigaviewer") {
    if (!Array.isArray(entries) || !entries.length) return;
    const sourceId = viewerId || "gigaviewer";
    const viewerKind = sourceId === "gigaviewer" ? "gv" : sourceId;
    const newCacheItems = [];
    for (const entry of entries) {
      try {
        const buffer = resolveGalleryBuffer(entry);
        if (!buffer) continue;
        const mime = typeof entry.mimeType === "string" && entry.mimeType ? entry.mimeType : "image/jpeg";
        const blob = new Blob([buffer], { type: mime });
        const entryKind = entry.kind || (mime.startsWith("image/") ? "page" : "file");
        addGVGalleryItem({
          filename: entry.filename,
          blob,
          kind: entryKind,
          mimeType: mime,
          index: entry.index ?? null,
          viewerId: sourceId
        });
        if (entryKind !== "page") {
          continue;
        }
        let width = Number(entry.width);
        let height = Number(entry.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          try {
            const bitmap = await createImageBitmap(blob);
            width = bitmap.width;
            height = bitmap.height;
            if (typeof bitmap.close === "function") {
              try { bitmap.close(); } catch { }
            }
          } catch { }
        }
        const objectUrl = trackBlobUrl(URL.createObjectURL(blob));
        const size = Number(entry.size) || blob.size || buffer.byteLength || 0;
        const nameFromSource = filenameFromUrl(entry.sourceUrl || entry.src || entry.url || "");
        const fileExt = sanitizeExtension(mimeToExtension(mime) || ext(nameFromSource) || "png");
        const indexNumber = Number.isFinite(entry.index) ? entry.index : null;
        const seriesTitle = sanitizeFilenameStem(entry.seriesTitle || gvCurrentSeriesTitle || sourceId, "series");
        const episodeTitle = sanitizeFilenameStem(entry.title || entry.episodeTitle || gvCurrentEpisodeTitle || "chapter", "chapter");
        const chapterFolder = episodeTitle || seriesTitle || "chapter";
        let providedName = entry.filename || entry.name || entry.title || nameFromSource || "";
        let providedFolder = "";
        if (providedName.includes("/")) {
          const parts = providedName.split("/");
          providedName = parts.pop() || "";
          providedFolder = sanitizeFilenameStem(parts.pop() || chapterFolder, "chapter") || chapterFolder;
        }
        const baseName = providedName && providedName.trim()
          ? providedName
          : (indexNumber != null
            ? `${String(indexNumber + 1).padStart(3, "0")}.${fileExt || "png"}`
            : `${sourceId}-${Date.now()}.${fileExt || "png"}`);
        const safeBaseName = ensureSafeFilenameCandidate(baseName, { defaultExt: fileExt || "png", fallback: `${sourceId}-${(indexNumber ?? 0) + 1}` });
        const folder = providedFolder || chapterFolder;
        const finalName = `${folder}/${safeBaseName}`;
        newCacheItems.push({
          kind: viewerKind,
          type: sourceId,
          rawUrl: entry.sourceUrl || entry.src || "",
          url: objectUrl,
          width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
          height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0,
          filename: finalName,
          size,
          mime,
          __format: mimeToExtension(mime) || "png",
          __viewer: sourceId,
          __source: sourceId,
          __chapterFolder: folder,
          __chapterTitle: episodeTitle || seriesTitle || folder,
          __discovery: { status: "new", seenCount: 1 }
        });
      } catch (err) {
        console.warn("Failed to add viewer entry to gallery:", err);
      }
    }
    if (!newCacheItems.length) return;
    newCacheItems.sort((a, b) => {
      const aIdx = Number.isFinite(a.index) ? a.index : Number.MAX_SAFE_INTEGER;
      const bIdx = Number.isFinite(b.index) ? b.index : Number.MAX_SAFE_INTEGER;
      if (aIdx === bIdx) return 0;
      return aIdx - bIdx;
    });
    removeViewerItemsFromCache(sourceId);
    CACHE = CACHE.concat(newCacheItems);
    rebuildSelectionFromCache();
    CURRENT_SCAN_ID = ++SCAN_SEQUENCE;
    await incrementStat("scans", 1);
    await incrementStat("imagesScanned", newCacheItems.length);
    annotateDiscovery(CACHE, CURRENT_SCAN_ID);
    renderGrid();
  }

  function setChapterStatus(message, state = "idle") {
    if (!gvChapterStatusEl) return;
    gvChapterStatusEl.textContent = message || "";
    gvChapterStatusEl.dataset.state = state || "idle";
  }

  function renderChapterList() {
    if (!gvChapterListEl) return;
    gvChapterListEl.innerHTML = "";
    const items = Array.isArray(CHAPTER_STATE.items) ? CHAPTER_STATE.items : [];
    if (!items.length) {
      return;
    }
    items.forEach((chapter, index) => {
      const li = document.createElement("li");
      li.className = "gv-chapter-item";
      const info = document.createElement("div");
      info.className = "gv-chapter-info";
      const title = document.createElement("div");
      title.className = "gv-chapter-title";
      title.textContent = chapter.title || `#${index + 1}`;
      const meta = document.createElement("div");
      meta.className = "gv-chapter-meta";
      const labels = [];
      if (chapter.purchased) {
        labels.push(t("label_chapter_purchased", "Purchased"));
      } else if (chapter.accessible) {
        labels.push(t("label_chapter_free", "Free"));
      } else {
        labels.push(t("label_chapter_locked", "Locked"));
      }
      if (Number.isFinite(chapter.coins) && chapter.coins > 0) {
        labels.push(`${chapter.coins} coin${chapter.coins === 1 ? "" : "s"}`);
      }
      meta.textContent = labels.join(" • ");
      info.appendChild(title);
      info.appendChild(meta);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gv-chapter-add";
      button.textContent = "+";
      button.dataset.index = String(index);
      button.disabled = !chapter.accessible;
      const aria = t("aria_chapter_add", [chapter.title || `#${index + 1}`], `Add ${chapter.title || `#${index + 1}`}`);
      button.setAttribute("aria-label", aria);
      if (!chapter.accessible) {
        button.title = t("label_chapter_locked", "Locked");
      }
      li.appendChild(info);
      li.appendChild(button);
      gvChapterListEl.appendChild(li);
    });
  }

  function guessViewerFromUrl(url = "") {
    if (!url) return null;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const segments = u.pathname.split("/").filter(Boolean);
      const lang = segments[0] ? segments[0].toLowerCase() : "";
      const english = /(?:^|\.)lezhinus\.com$/.test(host) && lang === "en";
      const japanese = /(?:^|\.)lezhin\.jp$/.test(host) && lang === "ja";
      const korean = /(?:^|\.)lezhin\.com$/.test(host) && lang === "ko";
      if (english || japanese || korean) {
        return "lezhin";
      }
    } catch { }
    return null;
  }

  async function fetchViewerChapters(tabId, viewerId) {
    if (!tabId && tabId !== 0) return { ok: false, error: "Tab is unavailable." };
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (moduleId) => {
        try {
          const registry = globalThis.UnshackleSites;
          if (!registry) throw new Error("Site registry not loaded.");
          const module = registry.get ? registry.get(moduleId) : registry.modules?.[moduleId];
          if (!module || typeof module.listChapters !== "function") {
            throw new Error("The current viewer does not expose a chapter list.");
          }
          const data = await module.listChapters(location.href);
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: String(error?.message || error) };
        }
      },
      args: [viewerId],
      world: "ISOLATED"
    });
    return results[0]?.result || { ok: false, error: "No response from page." };
  }

  async function loadChaptersForActiveTab() {
    if (chapterLoadPending) return;
    chapterLoadPending = true;
    if (gvChapterRefreshBtn) gvChapterRefreshBtn.disabled = true;
    setChapterStatus(t("label_chapter_loading", "Loading chapters..."), "loading");
    try {
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) {
        setChapterStatus(t("label_chapter_error", "Unable to load chapters. Open the comic overview and try again."), "error");
        CHAPTER_STATE.viewerId = null;
        CHAPTER_STATE.alias = null;
        CHAPTER_STATE.items = [];
        renderChapterList();
        return;
      }
      const perm = await ensureHostPermission(tab);
      if (!perm.ok) {
        setChapterStatus(perm.reason || t("label_chapter_error", "Unable to load chapters. Open the comic overview and try again."), "error");
        return;
      }
      let modulesInjected = false;
      let viewerId = null;
      if (tab.id != null) {
        try {
          const probe = await robustViewerCheck(tab.id, 1200);
          modulesInjected = true;
          const readyViewer = findFirstReadyViewer(probe);
          if (readyViewer?.id) {
            viewerId = readyViewer.id;
          } else {
            const lezhinStatus = findViewerStatus(probe, "lezhin");
            if (lezhinStatus) {
              viewerId = "lezhin";
            }
          }
        } catch { }
      }
      if (!viewerId) {
        viewerId = guessViewerFromUrl(tab.url || "");
      }
      if (!viewerId) {
        setChapterStatus(t("label_chapter_error", "Unable to load chapters. Open the comic overview and try again."), "error");
        CHAPTER_STATE.viewerId = null;
        CHAPTER_STATE.items = [];
        renderChapterList();
        return;
      }
      if (!modulesInjected && tab.id != null) {
        await injectGV(tab.id);
      }
      const reply = await fetchViewerChapters(tab.id, viewerId);
      if (!reply?.ok) {
        setChapterStatus(reply?.error || t("label_chapter_error", "Unable to load chapters. Open the comic overview and try again."), "error");
        CHAPTER_STATE.viewerId = viewerId;
        CHAPTER_STATE.items = [];
        renderChapterList();
        return;
      }
      const data = reply.data || {};
      CHAPTER_STATE.viewerId = data.viewerId || viewerId;
      CHAPTER_STATE.alias = data.alias || null;
      CHAPTER_STATE.locale = data.locale || null;
      const items = Array.isArray(data.chapters) ? data.chapters : [];
      CHAPTER_STATE.items = items.map((entry) => ({
        ...entry,
        viewerId: entry.viewerId || CHAPTER_STATE.viewerId
      }));
      if (!CHAPTER_STATE.items.length) {
        setChapterStatus(t("label_chapter_empty", "No chapters available on this page."), "empty");
      } else {
        setChapterStatus(
          t("label_chapter_loaded", [`${CHAPTER_STATE.items.length}`], `Loaded ${CHAPTER_STATE.items.length} chapter(s).`),
          "ok"
        );
      }
      renderChapterList();
    } catch (err) {
      const message = String(err?.message || err || t("label_chapter_error", "Unable to load chapters. Open the comic overview and try again."));
      setChapterStatus(message, "error");
      CHAPTER_STATE.viewerId = null;
      CHAPTER_STATE.items = [];
      renderChapterList();
    } finally {
      chapterLoadPending = false;
      if (gvChapterRefreshBtn) gvChapterRefreshBtn.disabled = false;
    }
  }

  async function handleChapterSelection(index) {
    const chapter = CHAPTER_STATE.items[index];
    if (!chapter || !chapter.accessible) return;
    const tab = await getActiveTab();
    if (!ensureEligibleTab(tab)) {
      recordUserNotice("warn", "Open the target comic tab to add chapters.");
      return;
    }
    if (tab.id == null) {
      recordUserNotice("error", "Active tab is unavailable.");
      return;
    }
    const perm = await ensureHostPermission(tab);
    if (!perm.ok) {
      if (perm.reason) {
        recordUserNotice("warn", perm.reason);
      }
      return;
    }
    const button = gvChapterListEl?.querySelector(`.gv-chapter-add[data-index="${index}"]`);
    if (button) {
      button.disabled = true;
      button.dataset.loading = "true";
      button.textContent = "…";
    }
    try {
      await injectGV(tab.id);
      await startViewerDownload(chapter.viewerId || CHAPTER_STATE.viewerId || "lezhin", tab, {
        episodeUrl: chapter.url || tab.url || "",
        options: {
          alias: chapter.alias,
          chapterId: chapter.id,
          chapterMeta: chapter
        },
        skipStatusCheck: true
      });
      setChapterStatus(t("label_chapter_added", "Chapter added to the grid."), "ok");
    } catch (err) {
      const message = String(err?.message || err || "Chapter download failed.");
      setChapterStatus(message, "error");
      recordUserNotice("error", message);
    } finally {
      if (button) {
        button.disabled = !chapter.accessible;
        delete button.dataset.loading;
        button.textContent = "+";
      }
    }
  }

  function maybeAutoLoadChapters() {
    if (chapterAutoRequested || !hkMangaEnabled || hkCurrentMode !== "manga") return;
    chapterAutoRequested = true;
    ensureHKMangaPanelReady()
      .then(() => loadChaptersForActiveTab())
      .catch(() => { });
  }

  function updateDimensionFilterFromInputs() {
    const minWInput = $("#minW");
    const minHInput = $("#minH");
    const currentMinW = DIMENSION_FILTER.minWidth;
    const currentMinH = DIMENSION_FILTER.minHeight;
    const rawW = parseInt(minWInput?.value || "0", 10);
    const rawH = parseInt(minHInput?.value || "0", 10);
    const minWidth = Number.isFinite(rawW) && rawW > 0 ? rawW : 0;
    const minHeight = Number.isFinite(rawH) && rawH > 0 ? rawH : 0;
    if (minWInput && minWidth !== rawW) minWInput.value = String(minWidth);
    if (minHInput && minHeight !== rawH) minHInput.value = String(minHeight);
    DIMENSION_FILTER.minWidth = minWidth;
    DIMENSION_FILTER.minHeight = minHeight;
    const changed = currentMinW !== minWidth || currentMinH !== minHeight;
    return { minWidth, minHeight, changed };
  }

  function applyDimensionFilters() {
    const dims = updateDimensionFilterFromInputs();
    if (!dims.changed) return;
    renderGrid();
    scheduleAutoRestart();
  }

  function scheduleAutoRestart() {
    if (autoRestartTimer) clearTimeout(autoRestartTimer);
    autoRestartTimer = setTimeout(() => {
      autoRestartTimer = null;
      void restartAutoScansIfEnabled();
    }, 350);
  }

  async function restartAutoScansIfEnabled() {
    // const autoImagesToggle = $("#autoImages"); // Removed
    if (!autoImagesEnabled && !autoCanvasEnabled) return;
    const tab = await getActiveTab();
    if (!tab || tab.id == null) return;
    if (autoImagesEnabled) {
      try {
        await handleAutoImagesToggle(false, { silent: true, tabOverride: tab });
        await handleAutoImagesToggle(true, { silent: true, tabOverride: tab });
      } catch (err) {
        console.warn("Failed to restart auto image scan:", err);
      }
    }
    if (autoCanvasEnabled) {
      try {
        await handleAutoCanvasToggle(false, { silent: true, tabOverride: tab });
        await handleAutoCanvasToggle(true, { silent: true, tabOverride: tab });
      } catch (err) {
        console.warn("Failed to restart auto canvas scan:", err);
      }
    }
  }

  function bindDimensionFilters() {
    updateDimensionFilterFromInputs();
    const minWInput = $("#minW");
    const minHInput = $("#minH");
    const handler = () => applyDimensionFilters();
    minWInput?.addEventListener("input", handler);
    minHInput?.addEventListener("input", handler);
  }

  async function runViewerDiagnostics(tabId) {
    const outEl = document.getElementById("gv-diag-out");
    if (outEl) outEl.textContent = "Probing…";
    const probe = await robustViewerCheck(tabId, 2000);
    if (outEl) {
      const lines = [];
      lines.push(`Viewer data ready: ${probe.ok ? "YES" : "NO"}`);
      if (probe.error) lines.push(`error: ${probe.error}`);
      const aggregated = new Map();
      for (const frame of Array.isArray(probe.frames) ? probe.frames : []) {
        for (const viewer of Array.isArray(frame?.viewers) ? frame.viewers : []) {
          if (!viewer || !viewer.id) continue;
          const current = aggregated.get(viewer.id) || {
            id: viewer.id,
            displayName: getViewerDisplayName(viewer.id),
            ok: false,
            detected: false,
            pages: 0
          };
          current.ok = current.ok || !!viewer.ok;
          current.detected = current.detected || !!viewer.detected;
          const pageCount = Number(viewer.pageCount);
          if (Number.isFinite(pageCount) && pageCount > current.pages) {
            current.pages = pageCount;
          }
          aggregated.set(viewer.id, current);
        }
      }
      if (aggregated.size) {
        const summaryParts = [];
        for (const entry of aggregated.values()) {
          const status = entry.ok ? "ready" : (entry.detected ? "detected" : "absent");
          const pagesLabel = entry.pages > 0 ? ` (${entry.pages} pages)` : "";
          summaryParts.push(`${entry.displayName}: ${status}${pagesLabel}`);
        }
        lines.push(`Detected viewers: ${summaryParts.join(" | ")}`);
      } else {
        lines.push("Detected viewers: none");
      }
      for (const frame of Array.isArray(probe.frames) ? probe.frames : []) {
        if (!frame) continue;
        lines.push(`• frame: ${frame.frame || "(unknown)"}`);
        const viewers = Array.isArray(frame.viewers) ? frame.viewers : [];
        if (!viewers.length) {
          lines.push("  (no viewers reported)");
          continue;
        }
        for (const viewer of viewers) {
          if (!viewer || !viewer.id) continue;
          const status = viewer.ok ? "ready" : (viewer.detected ? "detected" : "missed");
          const parts = [`pages:${viewer.pageCount ?? 0}`];
          if (Array.isArray(viewer.origins) && viewer.origins.length) {
            parts.push(`origins:${viewer.origins.join(", ")}`);
          }
          lines.push(`  - ${getViewerDisplayName(viewer.id)}: ${status} (${parts.join(" • ")})`);
          if (viewer.reason && !viewer.ok) {
            lines.push(`    note: ${viewer.reason}`);
          }
        }
      }
      outEl.textContent = lines.join("\n");
    }
    return probe;
  }

  async function gvOnePageDryRun(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      world: "MAIN",
      func: async () => {
        try {
          const registry = globalThis.UnshackleSites;
          const mod = registry && (registry.get ? registry.get("gigaviewer") : registry.modules?.gigaviewer) || globalThis.UnshackleGV;
          const diag = mod?.runOnePageDiagnostic || globalThis.UnshackleGVOnePageDiagnostic;
          if (typeof diag !== "function") {
            return { ok: false, error: "diagnostic-unavailable" };
          }
          const res = await diag.call(mod, location.href);
          return { ok: !!res?.ok, bytes: res?.bytes ?? 0 };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }
    }).catch(() => []);
    if (!Array.isArray(results) || !results.length) {
      return { ok: false, error: "no-response" };
    }
    const payload = results[0]?.result;
    if (!payload) {
      return { ok: false, error: "no-result" };
    }
    return payload;
  }

  function bindGVControls() {
    gvGalleryGrid = document.getElementById("gv-gallery");
    if (gvGalleryGrid) {
      gvGalleryGrid.dataset.render = "hidden";
    }
    gvSaveAllButton = document.getElementById("gv-save-all");
    gvClearGalleryButton = document.getElementById("gv-clear-gallery");
    gvGalleryStatusLabel = document.getElementById("gv-gallery-status");
    const gvDiagButton = document.getElementById("gv-run-diagnostics");
    const gvDiagOutput = document.getElementById("gv-diag-out");
    updateGVGalleryStatus();
    if (gvClearGalleryButton) {
      gvClearGalleryButton.addEventListener("click", () => resetGVGallery());
    }
    if (gvSaveAllButton) {
      gvSaveAllButton.addEventListener("click", async () => {
        try {
          await saveGVGalleryAsZip();
          showToast("Save dialog opened for ZIP export.");
        } catch (err) {
          const msg = String(err?.message || err || "");
          if (/interrupted|canceled|cancelled/i.test(msg)) {
            showToast("ZIP download cancelled.");
          } else {
            const message = `Failed to save ZIP: ${msg || "Unknown error"}`;
            recordUserNotice("error", message);
            alert(message);
          }
        }
      });
    }
    if (gvDiagOutput && !gvDiagOutput.textContent) {
      gvDiagOutput.textContent = "Diagnostics not run.";
    }
    if (gvDiagButton) {
      gvDiagButton.addEventListener("click", async () => {
        const tab = await getActiveTab();
        if (!tab?.id) return;
        if (gvDiagOutput) gvDiagOutput.textContent = "Requesting permission…";
        const perm = await ensureHostPermission(tab);
        if (!perm.ok) {
          if (perm.reason) {
            recordUserNotice("warn", perm.reason);
          }
          if (gvDiagOutput) gvDiagOutput.textContent = perm.reason || "Permission request cancelled.";
          return;
        }
        const probe = await runViewerDiagnostics(tab.id);
        const gvStatus = findViewerStatus(probe, "gigaviewer");
        if (!gvStatus || !gvStatus.detected) {
          if (gvDiagOutput) {
            gvDiagOutput.textContent += "\nGigaViewer-specific checks skipped (viewer not detected).";
          }
          return;
        }
        const assetPerm = await ensureGVAssetPermissions(tab, tab.url || location.href || "");
        if (!assetPerm.ok) {
          if (gvDiagOutput) {
            gvDiagOutput.textContent += `\nGigaViewer asset permissions: FAILED (${assetPerm.error || "unknown"})`;
          }
          return;
        }
        if (gvDiagOutput) {
          const originCount = Array.isArray(assetPerm.origins) ? assetPerm.origins.length : 0;
          gvDiagOutput.textContent += `\nGigaViewer asset permissions: OK (${originCount} origin${originCount === 1 ? "" : "s"})`;
        }
        try {
          const sample = await gvOnePageDryRun(tab.id);
          if (gvDiagOutput) {
            if (sample.ok) {
              gvDiagOutput.textContent += `\n1-page extract: OK (${sample.bytes} bytes)`;
            } else {
              gvDiagOutput.textContent += `\n1-page extract: FAILED (${sample.error || "unknown error"})`;
            }
          }
        } catch (err) {
          if (gvDiagOutput) {
            gvDiagOutput.textContent += `\n1-page extract: FAILED (${String(err?.message || err)})`;
          }
        }
      });
    }
    resetGVGallery();

    loadStoredGVOptions().then(applyGVOptionUI);

    const onlyFirstEl = document.getElementById("gvOnlyFirst");
    const saveMetaEl = document.getElementById("gvSaveMetadata");
    const purchaseEl = document.getElementById("gvPurchaseGuard");
    const zipEl = document.getElementById("gvZipDownload");
    const cookieBtn = document.getElementById("gvCopyCookie");
    const cookieStatusEl = document.getElementById("gvCookieStatus");
    const cookieInfoEl = document.getElementById("gvCookieInfo");
    let cookieStatusTimer = null;

    const setCookieStatus = (message, isError = false) => {
      if (!cookieStatusEl) return;
      cookieStatusEl.textContent = message || "";
      if (message) {
        cookieStatusEl.dataset.state = isError ? "error" : "ok";
        if (cookieStatusTimer) clearTimeout(cookieStatusTimer);
        cookieStatusTimer = setTimeout(() => {
          if (cookieStatusEl) {
            cookieStatusEl.textContent = "";
            cookieStatusEl.dataset.state = "";
          }
          cookieStatusTimer = null;
        }, 6000);
      } else {
        cookieStatusEl.dataset.state = "";
      }
    };

    const renderCookieInfo = (cookies) => {
      if (!cookieInfoEl) return;
      cookieInfoEl.innerHTML = "";
      if (!Array.isArray(cookies) || !cookies.length) return;
      cookies.forEach((cookie, index) => {
        const li = document.createElement("li");
        const includeSubdomains = cookie.hostOnly ? "FALSE" : "TRUE";
        const secureFlag = cookie.secure ? "TRUE" : "FALSE";
        const expiry = typeof cookie.expirationDate === "number"
          ? new Date(cookie.expirationDate * 1000).toUTCString()
          : "Session";
        const details = [
          `Domain: ${cookie.domain || ""}`,
          `Include Subdomains: ${includeSubdomains}`,
          `Path: ${cookie.path || "/"}`,
          `Secure: ${secureFlag}`,
          `Expiry: ${expiry}`,
          `Name: ${cookie.name || ""}`,
          `Value: ${cookie.value || ""}`
        ];
        li.textContent = `#${index + 1} | ${details.join(" | ")}`;
        cookieInfoEl.appendChild(li);
      });
    };

    renderCookieInfo([]);

    if (onlyFirstEl) {
      onlyFirstEl.addEventListener("change", (e) => {
        updateGVOption("onlyFirst", !!e.target.checked);
      });
    }
    if (saveMetaEl) {
      saveMetaEl.addEventListener("change", (e) => {
        updateGVOption("saveMetadata", !!e.target.checked);
      });
    }
    if (purchaseEl) {
      purchaseEl.addEventListener("change", (e) => {
        updateGVOption("purchaseGuard", !!e.target.checked);
      });
    }
    if (zipEl) {
      zipEl.addEventListener("change", (e) => {
        updateGVOption("zipDownload", !!e.target.checked);
      });
    }
    if (cookieBtn) {
      cookieBtn.addEventListener("click", async () => {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
          const message = "No active tab.";
          recordUserNotice("error", message);
          alert(message);
          setCookieStatus("No active tab.", true);
          return;
        }
        const perm = await ensureHostPermission(tab);
        if (!perm.ok) {
          if (perm.reason) {
            recordUserNotice("warn", perm.reason);
          }
          return;
        }
        try {
          const cookieList = await chrome.cookies.getAll({ url: tab.url });
          if (!cookieList || !cookieList.length) {
            const message = "No cookies were found for this site.";
            recordUserNotice("warn", message);
            alert(message);
            setCookieStatus("No cookies found.", true);
            return;
          }
          const loginCookies = cookieList.filter((entry) => {
            const name = typeof entry?.name === "string" ? entry.name.toLowerCase() : "";
            return name && GV_COOKIE_CANDIDATES.has(name);
          });
          const sourceCookies = loginCookies.length ? loginCookies : cookieList;
          const pairs = sourceCookies.map((entry) => `${entry.name}=${entry.value}`);
          const cookieString = pairs.join("; ");
          if (!cookieString) {
            const message = "Cookie extraction returned an empty result.";
            recordUserNotice("warn", message);
            alert(message);
            setCookieStatus("Cookie not available.", true);
            renderCookieInfo([]);
            return;
          }
          let copied = false;
          if (navigator?.clipboard?.writeText) {
            try {
              await navigator.clipboard.writeText(cookieString);
              copied = true;
            } catch { }
          }
          const count = sourceCookies.length;
          const countLabel = `${count} cookie${count === 1 ? "" : "s"}`;
          if (copied) {
            setCookieStatus(`Copied ${countLabel} to clipboard.`);
          } else {
            setCookieStatus(`Cookie ready — copy from prompt (${countLabel}).`);
            prompt("Copy this login cookie string", cookieString);
          }
          renderCookieInfo(sourceCookies);
        } catch (err) {
          const msg = String(err?.message || err || "Cookie extraction failed.");
          const message = `Cookie extraction failed: ${msg}`;
          recordUserNotice("error", message);
          alert(message);
          setCookieStatus("Cookie extraction failed.", true);
          renderCookieInfo([]);
        }
      });
    }

  }

  function updateAutoCanvasButton(active) {
    const canvasBtn = $("#btnCanvas");
    if (!canvasBtn) return;
    canvasBtn.textContent = active ? "Canvas scanning" : "Canvas";
    canvasBtn.dataset.scanning = active ? "true" : "false";
    canvasBtn.classList.toggle("canvas-active", !!active);
    if (!active) {
      delete canvasBtn.dataset.scanning;
    }
  }

  async function handleAutoImagesToggle(on, options = {}) {
    const { silent = false, tabOverride = null } = options;
    const btnScan = $("#btnScan");
    const syncNetworkCapture = typeof window.__syncNetworkCaptureWithScan === "function"
      ? window.__syncNetworkCaptureWithScan
      : null;

    // Check for network-only mode - if enabled, use network scan toggle instead of DOM scan
    if (window.__UNSHACKLE_NETWORK_ONLY_MODE__) {
      if (typeof window.toggleNetworkOnlyScan === "function") {
        await window.toggleNetworkOnlyScan(on, { silent, tabOverride });
      } else if (on && typeof window.performNetworkOnlyScan === "function") {
        await window.performNetworkOnlyScan({ keepButtonActive: true });
      }
      return;
    }

    const updateBtn = (active) => {
      if (!btnScan) return;
      if (active) {
        btnScan.textContent = "Scanning...";
        btnScan.classList.remove("network-scanning");
        btnScan.classList.add("scanning");
        btnScan.dataset.scanning = "true";
      } else {
        btnScan.textContent = "Scan";
        btnScan.classList.remove("scanning", "network-scanning");
        btnScan.style.background = "";
        btnScan.style.borderColor = "";
        btnScan.style.color = "";
        delete btnScan.dataset.scanning;
      }
    };

    // Update internal state
    autoImagesEnabled = !!on;
    updateBtn(on);

    const tab = tabOverride || await getActiveTab();
    if (on) {
      if (!ensureEligibleTab(tab)) {
        autoImagesEnabled = false;
        updateBtn(false);
        return;
      }
      if (isInstagramLikeUrl(tab?.url)) {
        const cdnGranted = await ensureInstagramCdnPermissions();
        if (!cdnGranted && !silent) {
          setHintMessage("hint_permission_denied", "Allow Instagram CDN access to load profile pictures.");
        }
      }
      const ok = await ensureContent(tab.id);
      if (!ok) {
        autoImagesEnabled = false;
        updateBtn(false);
        if (!silent) setHintMessage("hint_connect_failed", "Could not connect to page.");
        return;
      }
      if (autoCanvasEnabled) {
        await handleAutoCanvasToggle(false, { silent: true, tabOverride: tab });
      }
      try {
        await syncCanvasNameRegistry(tab.id);
        const dims = updateDimensionFilterFromInputs();
        const minW = dims.minWidth;
        const minH = dims.minHeight;
        const types = getSelectedExtractionTypes();
        CURRENT_SCAN_ID = ++SCAN_SEQUENCE;
        await sendToContent(tab.id, { action: "startAutoScan", options: { debounceMs: 600, scanOptions: { minWidth: minW, minHeight: minH, types } } });
        await incrementStat("scans", 1);
        AUTO_STREAM_TAB_ID = tab.id;
        CACHE = [];
        SELECTED = new Set();
        renderGrid();
        startAutoScanLoop(tab.id);
        if (syncNetworkCapture) {
          await syncNetworkCapture(true, { tabOverride: tab, silent });
        }
        if (!silent) setHintMessage("hint_auto_images_on", "Auto images enabled.");
      } catch (err) {
        autoImagesEnabled = false;
        updateBtn(false);
        stopAutoScanLoop();
        await sendToContent(tab.id, { action: "stopAutoScan" }).catch(() => { });
        if (AUTO_STREAM_TAB_ID === tab.id) {
          AUTO_STREAM_TAB_ID = null;
        }
        if (!silent) {
          const hint = $("#hint");
          if (hint) hint.textContent = String(err?.message || err || "Auto scan failed.");
        }
        if (syncNetworkCapture) {
          await syncNetworkCapture(false, { silent: true });
        }
      }
    } else {
      if (tab && tab.id != null) {
        await sendToContent(tab.id, { action: "stopAutoScan" }).catch(() => { });
      }
      stopAutoScanLoop();
      if (AUTO_STREAM_TAB_ID === tab?.id) {
        AUTO_STREAM_TAB_ID = null;
      }
      if (tab?.id != null) {
        PENDING_BLOB_HYDRATION.delete(tab.id);
      }
      if (!silent) setHintMessage(null);
      if (syncNetworkCapture) {
        await syncNetworkCapture(false, { silent: true });
      }
      updateAutoCanvasButton(autoCanvasEnabled);
    }
  }

  async function handleAutoCanvasToggle(on, options = {}) {
    const { silent = false, tabOverride = null } = options;
    const tab = tabOverride || await getActiveTab();
    if (on) {
      if (!ensureEligibleTab(tab)) {
        autoCanvasEnabled = false;
        updateAutoCanvasButton(false);
        return;
      }
      const ok = await ensureContent(tab.id);
      if (!ok) {
        autoCanvasEnabled = false;
        updateAutoCanvasButton(false);
        if (!silent) setHintMessage("hint_connect_failed", "Could not connect to page.");
        return;
      }
      if (autoImagesEnabled) {
        await handleAutoImagesToggle(false, { silent: true, tabOverride: tab });
      }
      try {
        autoCanvasEnabled = true;
        updateAutoCanvasButton(true);
        await syncCanvasNameRegistry(tab.id);
        const dims = updateDimensionFilterFromInputs();
        const minW = dims.minWidth;
        const minH = dims.minHeight;
        const types = ["canvas"];
        CURRENT_SCAN_ID = ++SCAN_SEQUENCE;
        await sendToContent(tab.id, { action: "startAutoScan", options: { debounceMs: 500, distancePx: 2500, scanOptions: { minWidth: minW, minHeight: minH, types } } });
        await incrementStat("scans", 1);
        AUTO_STREAM_TAB_ID = tab.id;
        CACHE = [];
        SELECTED = new Set();
        renderGrid();
        startAutoScanLoop(tab.id);
        if (!silent) setHintMessage("hint_auto_canvas_on", "Auto canvas enabled.");
      } catch (err) {
        autoCanvasEnabled = false;
        updateAutoCanvasButton(false);
        stopAutoScanLoop();
        await sendToContent(tab.id, { action: "stopAutoScan" }).catch(() => { });
        if (AUTO_STREAM_TAB_ID === tab.id) {
          AUTO_STREAM_TAB_ID = null;
        }
        if (!silent) {
          const hint = $("#hint");
          if (hint) hint.textContent = String(err?.message || err || "Auto canvas failed.");
        }
      }
    } else {
      autoCanvasEnabled = false;
      updateAutoCanvasButton(false);
      if (tab && tab.id != null) {
        await sendToContent(tab.id, { action: "stopAutoScan" }).catch(() => { });
      }
      stopAutoScanLoop();
      if (AUTO_STREAM_TAB_ID === tab?.id) {
        AUTO_STREAM_TAB_ID = null;
      }
      if (tab?.id != null) {
        PENDING_BLOB_HYDRATION.delete(tab.id);
      }
      if (!silent) setHintMessage(null);
    }
  }

  function bindAutoToggles() {
    // No-op: legacy auto toggles removed; canvas auto is integrated into the Canvas button.
  }

  function bindModuleControls() {
    moduleStatusEl = $("#moduleStatus");
    moduleScanBtn = $("#moduleScan");
    moduleTriggerButtons = Array.from(document.querySelectorAll(".module-trigger"));
    if (moduleStatusEl && !moduleStatusEl.dataset.state) {
      moduleStatusEl.dataset.state = "idle";
    }
    if (moduleScanBtn) {
      moduleScanBtn.addEventListener("click", () => {
        runModuleScan().catch(() => { });
      });
    }
    moduleTriggerButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        triggerViewerModule(btn.dataset.module, btn).catch(() => { });
      });
    });
  }

  // Overlay removal handlers
  function bindOverlayActions() {
    const aggressivenessInput = $("#overlayAggressiveness");
    const aggressivenessValue = $("#overlayAggressivenessValue");
    const previewBtn = $("#overlayPreview");
    const previewCountEl = $("#overlayPreviewCount");
    const keywordPreviewBtn = $("#previewKeywords");
    const keywordInput = $("#overlayKeywords");
    const undoBtn = $("#undoOverlays");
    const modeRadios = Array.from(document.querySelectorAll('input[name="overlayMode"]'));

    const getAggressiveness = () => {
      const raw = parseInt(aggressivenessInput?.value || "50", 10);
      return Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 50));
    };

    const updateAggressivenessLabel = () => {
      if (!aggressivenessInput || !aggressivenessValue) return;
      const val = getAggressiveness();
      aggressivenessValue.textContent = `${val}%`;
    };

    // Derived values based on aggressiveness:
    // 0%  (Safe)     -> Coverage 80%, Z-Index 2000
    // 100% (Ruthless) -> Coverage 20%, Z-Index 100
    const getCoverage = () => {
      const agg = getAggressiveness();
      // Linear interpolation: 80 -> 20
      // 80 - (agg * 0.6)
      const pct = 80 - (agg * 0.6);
      return Math.max(0, pct) / 100;
    };

    const getMinZ = () => {
      const agg = getAggressiveness();
      // Linear interpolation: 2000 -> 100
      // 2000 - (agg * 19)
      const z = 2000 - (agg * 19);
      return Math.max(0, Math.round(z));
    };

    const getMode = () => {
      const selected = modeRadios.find((r) => r.checked);
      return selected && selected.value === "hard" ? "hard" : "soft";
    };
    const setPreviewStatus = (key, fallback, substitutions) => {
      if (!previewCountEl) return;
      previewCountEl.textContent = t(key, substitutions, fallback);
    };
    const resetPreviewStatus = () => {
      setPreviewStatus("label_overlay_preview_idle", "No preview yet.");
    };

    aggressivenessInput?.addEventListener("input", updateAggressivenessLabel);
    updateAggressivenessLabel();
    resetPreviewStatus();

    previewBtn?.addEventListener("click", async () => {
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) return;
      const ok = await ensureContent(tab.id);
      if (!ok) { setHintMessage("hint_connect_failed", "Could not connect to page."); return; }
      setPreviewStatus("label_overlay_preview_running", "Highlighting overlays...");
      try {
        const res = await sendToContent(tab.id, { action: "previewOverlays", options: { minCoverage: getCoverage(), minZ: getMinZ() } });
        if (res && res.ok) {
          const count = Number(res.count || 0);
          if (count > 0) {
            setPreviewStatus("label_overlay_preview_match", [`${count}`], `${count} overlay(s) highlighted.`);
            // Fix: fallback string first, substitutions array second
            const msg = t("hint_overlay_preview_match", [count], `${count} overlay element(s) highlighted.`);
            setHintMessage("hint_overlay_preview_match", `${count} overlay element(s) highlighted.`, [count]);
            // Also log to footer
            recordUserNotice("info", msg);
          } else {
            setPreviewStatus("label_overlay_preview_none", "No overlay candidates met the thresholds.");
            setHintMessage("hint_overlay_preview_none", "No overlay candidates met the thresholds.");
          }
        } else {
          setPreviewStatus("label_overlay_preview_failed", "Preview failed.");
          setHintMessage("hint_overlay_preview_failed", "Overlay preview failed.");
        }
      } catch (err) {
        console.error("overlay preview failed", err);
        setPreviewStatus("label_overlay_preview_failed", "Preview failed.");
        setHintMessage("hint_overlay_preview_failed", "Overlay preview failed.");
      }
    });

    $("#enable")?.addEventListener("click", async () => {
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) return;
      const ok = await ensureContent(tab.id);
      if (!ok) { setHintMessage("hint_connect_failed", "Could not connect to page."); return; }
      const res = await sendToContent(tab.id, { action: "enableInteractions", options: { minCoverage: getCoverage(), minZ: getMinZ() } });
      if (res && res.ok) {
        setHintMessage("hint_enable_success", "Right-click and dragging enabled; overlays softened.");
        recordUserNotice("info", t("hint_enable_success", "Right-click and dragging enabled; overlays softened."));
        await incrementStat("overlayTweaks", 1);
      }
    });

    $("#nuke")?.addEventListener("click", async () => {
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) return;
      const ok = await ensureContent(tab.id);
      if (!ok) { setHintMessage("hint_connect_failed", "Could not connect to page."); return; }
      resetPreviewStatus();
      const res = await sendToContent(tab.id, {
        action: "nukeOverlays",
        options: { minCoverage: getCoverage(), minZ: getMinZ(), keywordMode: getMode() }
      });
      if (res && res.ok) {
        const count = res.affected || 0;
        const msg = t("hint_overlay_removed", [count], `Overlay cleanup affected ${count} elements.`);
        setHintMessage("hint_overlay_removed", `Overlay cleanup affected ${count} elements.`, [count]);
        recordUserNotice("info", msg);
        await incrementStat("overlayTweaks", 1);
        // Track overlays nuked in stats (always, regardless of telemetry opt-in)
        await recordOverlaysNukedStat(count);
      }
    });

    undoBtn?.addEventListener("click", async () => {
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) return;
      const ok = await ensureContent(tab.id);
      if (!ok) { setHintMessage("hint_connect_failed", "Could not connect to page."); return; }
      resetPreviewStatus();
      const res = await sendToContent(tab.id, { action: "undoOverlayCleanup" });
      if (res && res.ok && res.restored) {
        const count = res.restored;
        const msg = t("hint_overlay_undo", [count], `Restored ${count} overlay element(s).`);
        setHintMessage("hint_overlay_undo", `Restored ${count} overlay element(s).`, [count]);
        recordUserNotice("info", msg);
      } else {
        setHintMessage("hint_overlay_nothing_to_undo", "No overlay cleanup to undo.");
      }
    });

    keywordPreviewBtn?.addEventListener("click", async () => {
      const raw = (keywordInput?.value || "").trim();
      if (!raw) { setHintMessage("hint_enter_keywords", "Enter keyword(s) first."); return; }
      const parts = raw.split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (!parts.length) { setHintMessage("hint_enter_keywords", "Enter keyword(s) first."); return; }
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) return;
      const ok = await ensureContent(tab.id);
      if (!ok) { setHintMessage("hint_connect_failed", "Could not connect to page."); return; }
      setPreviewStatus("label_overlay_preview_running", "Highlighting overlays...");
      try {
        const res = await sendToContent(tab.id, { action: "nukeByKeywords", keywords: parts, options: { preview: true, mode: getMode() } });
        recordRecentOverlayTags(parts);
        if (res && res.ok) {
          const total = Number(res.totalMatched || 0);
          if (total > 0) {
            setPreviewStatus("label_overlay_preview_match", [`${total}`], `${total} overlay(s) highlighted.`);
            const msg = t("hint_keywords_preview", [total], `${total} element(s) match those keywords.`);
            setHintMessage("hint_keywords_preview", `${total} element(s) match those keywords.`, [total]);
            recordUserNotice("info", msg);
          } else {
            setPreviewStatus("label_overlay_preview_none", "No overlay candidates met the thresholds.");
            setHintMessage("hint_keywords_preview_none", "No overlay elements match those keywords.");
          }
        } else {
          setPreviewStatus("label_overlay_preview_failed", "Preview failed.");
          setHintMessage("hint_keywords_preview_failed", "Keyword preview failed.");
        }
      } catch (err) {
        console.error("keyword preview failed", err);
        setPreviewStatus("label_overlay_preview_failed", "Preview failed.");
        setHintMessage("hint_keywords_preview_failed", "Keyword preview failed.");
      }
    });

    $("#nukeKeywords")?.addEventListener("click", async () => {
      const raw = (keywordInput?.value || "").trim();
      if (!raw) { setHintMessage("hint_enter_keywords", "Enter keyword(s) first."); return; }
      const parts = raw.split(/[,;\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (!parts.length) { setHintMessage("hint_enter_keywords", "Enter keyword(s) first."); return; }
      const mode = getMode();
      if (mode === "hard") {
        const confirmRemove = confirm(t("confirm_keyword_remove", "Removing overlays by keyword may break site functionality. Proceed?"));
        if (!confirmRemove) return;
      }
      const tab = await getActiveTab();
      if (!ensureEligibleTab(tab)) return;
      const ok = await ensureContent(tab.id);
      if (!ok) { setHintMessage("hint_connect_failed", "Could not connect to page."); return; }
      resetPreviewStatus();
      try {
        const res = await sendToContent(tab.id, { action: "nukeByKeywords", keywords: parts, options: { remove: true, mode } });
        recordRecentOverlayTags(parts);
        if (res && res.ok) {
          const removed = Number(res.removed || 0);
          const softened = Number(res.softened || 0);
          if (removed > 0 || softened > 0) {
            await incrementStat("overlayTweaks", 1);
            await recordOverlaysNukedStat(removed + softened);
          }
          if (removed > 0) {
            setHintMessage("hint_keywords_removed", [removed], `Removed ${removed} element(s) by keyword.`);
          } else if (softened > 0) {
            setHintMessage("hint_keywords_softened", [softened], `Softened ${softened} keyword overlay(s).`);
          } else {
            setHintMessage("hint_keywords_preview_none", "No overlay elements match those keywords.");
          }
        } else {
          setHintMessage("hint_keywords_preview_failed", "Keyword cleanup failed.");
        }
      } catch (err) {
        console.error("keyword cleanup failed", err);
        setHintMessage("hint_keywords_preview_failed", "Keyword cleanup failed.");
      }
    });
  }

  function appendOverlayKeyword(tag) {
    if (!tag) return;
    const inp = $("#overlayKeywords");
    if (!inp) return;
    const existing = inp.value ? inp.value.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean) : [];
    if (!existing.includes(tag)) existing.push(tag);
    inp.value = existing.join(", ");
    inp.focus();
  }

  function renderOverlayTagList(container, tags, options = {}) {
    if (!container) return;
    const { emptyKey, emptyFallback } = options;
    container.innerHTML = "";
    if (!Array.isArray(tags) || !tags.length) {
      if (emptyFallback || emptyKey) {
        const empty = document.createElement("span");
        empty.className = "tag tag-empty";
        empty.textContent = t(emptyKey || "", emptyFallback || "No recent tags yet.");
        container.appendChild(empty);
      }
      return;
    }
    for (const tag of tags) {
      if (!tag) continue;
      const el = document.createElement("span");
      el.className = "tag";
      el.textContent = tag;
      el.addEventListener("click", () => appendOverlayKeyword(tag));
      container.appendChild(el);
    }
  }

  function renderOverlayTags() {
    renderOverlayTagList($("#overlayTags"), DEFAULT_OVERLAY_TAGS);
    renderOverlayTagList($("#overlayRecentTags"), recentOverlayTags, {
      emptyKey: "label_overlay_no_recent",
      emptyFallback: "No recent tags yet."
    });
  }

  async function loadDownloadPathPreference() {
    try {
      const prefs = await chrome.storage.sync.get({ [DOWNLOAD_PATH_KEY]: true });
      alwaysAskDownloadPath = prefs[DOWNLOAD_PATH_KEY] !== false;
    } catch {
      alwaysAskDownloadPath = true;
    }
    const toggle = $("#downloadPathSwitch");
    if (toggle) toggle.checked = alwaysAskDownloadPath;
    downloadPathPromptedForScanId = null;
  }

  async function setDownloadPathPreference(value) {
    alwaysAskDownloadPath = !!value;
    downloadPathPromptedForScanId = null;
    try { await chrome.storage.sync.set({ [DOWNLOAD_PATH_KEY]: alwaysAskDownloadPath }); } catch { }
  }

  function shouldSaveAs() {
    if (alwaysAskDownloadPath) return true;
    const scanId = (Number.isFinite(CURRENT_SCAN_ID) && CURRENT_SCAN_ID > 0) ? CURRENT_SCAN_ID : 0;
    if (downloadPathPromptedForScanId !== scanId) {
      downloadPathPromptedForScanId = scanId;
      return true;
    }
    return false;
  }

  async function loadOverlayTags() {
    try {
      const stored = await chrome.storage.local.get({ [OVERLAY_RECENTS_KEY]: [] });
      const raw = stored?.[OVERLAY_RECENTS_KEY];
      if (Array.isArray(raw)) {
        recentOverlayTags = raw.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, MAX_RECENT_OVERLAY_TAGS);
      } else {
        recentOverlayTags = [];
      }
    } catch {
      recentOverlayTags = [];
    }
    renderOverlayTags();
  }

  function recordRecentOverlayTags(tags) {
    if (!Array.isArray(tags) || !tags.length) return;
    const seen = new Set();
    const normalized = [];
    for (const raw of tags) {
      const key = String(raw || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalized.push(key);
    }
    if (!normalized.length) return;
    const existing = Array.isArray(recentOverlayTags) ? recentOverlayTags : [];
    for (const tag of existing) {
      if (seen.has(tag)) continue;
      normalized.push(tag);
    }
    recentOverlayTags = normalized.slice(0, MAX_RECENT_OVERLAY_TAGS);
    renderOverlayTags();
    chrome.storage.local.set({ [OVERLAY_RECENTS_KEY]: recentOverlayTags }).catch(() => { });
  }

  async function loadThemePreference() {
    try {
      const prefs = await chrome.storage.sync.get({ panelTheme: DEFAULT_THEME });
      const theme = normalizeThemeKey(prefs.panelTheme);
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch { }
      const select = $("#themeSelect");
      if (select) select.value = theme;
    } catch {
      applyTheme(readThemeFromLocalStorage());
    }
  }

  function bindThemePreference() {
    const select = $("#themeSelect");
    if (!select) return;
    select.addEventListener("change", async (event) => {
      const theme = normalizeThemeKey(event.target.value);
      const current = (document.body || document.documentElement)?.dataset?.theme || DEFAULT_THEME;
      if (theme === current) return;
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch { }
      try { await chrome.storage.sync.set({ panelTheme: theme }); } catch { }
      showToast(t("toast_theme_applied", "Theme updated."), { duration: 2400 });
    });
  }

  function bindLocalePreference() {
    const select = $("#localeSelect");
    if (!select) return;
    select.addEventListener("change", async (event) => {
      const locale = event.target.value;
      if (!AVAILABLE_LOCALES.includes(locale)) return;
      await setActiveLocale(locale);
      showToast(t("toast_locale_applied", "Language updated."), { duration: 2400 });
    });
  }

  function bindShowOnboardingButton() {
    const btn = $("#showOnboardingBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const modal = $("#settingsModal");
      if (modal && getComputedStyle(modal).display !== "none") {
        const activeEl = document.activeElement;
        if (activeEl && modal.contains(activeEl)) {
          activeEl.blur();
        }
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        $("#settingsBtn")?.setAttribute("aria-expanded", "false");
      }
      showOnboardingModal();
    });
  }

  // Preference: side panel or popup
  async function loadUIPreference() {
    const prefs = await chrome.storage.sync.get({ useSidePanel: true });
    const val = !!prefs.useSidePanel;
    const menuSwitch = $("#settingsModeSwitch");
    if (menuSwitch) menuSwitch.checked = val;
  }
  function bindUIPreference() {
    const menuSwitch = $("#settingsModeSwitch");
    if (!menuSwitch) return;
    async function onChange(val) {
      await chrome.runtime.sendMessage({ action: "setUIPreference", useSidePanel: val });
      const msg = val ? "Side panel enabled by default." : "Popup enabled by default.";
      setHintMessage(val ? "hint_sidepanel_enabled" : "hint_popup_enabled", msg);
      recordUserNotice("info", msg);
      if (menuSwitch.checked !== val) menuSwitch.checked = val;
    }
    menuSwitch.addEventListener("change", (e) => onChange(e.target.checked));
  }

  async function hasGlobalPermission() {
    try {
      const contains = await chrome.permissions.contains({ origins: GLOBAL_PERMISSION_PRIMARY_ORIGINS });
      return !!contains;
    } catch {
      return false;
    }
  }

  async function requestGlobalPermission() {
    const already = await hasGlobalPermission();
    if (!already) {
      const granted = await chrome.permissions.request({ origins: GLOBAL_PERMISSION_PRIMARY_ORIGINS }).catch(() => false);
      if (!granted) return false;
    }
    return true;
  }

  async function removeGlobalPermission() {
    try {
      await chrome.permissions.remove({ origins: GLOBAL_PERMISSION_ALL_ORIGINS });
    } catch { }
  }

  async function setPermissionPromptMode(next, options = {}) {
    const { skipToast = false, force = false } = options || {};
    if (!force && next === askPermissionEachScan) {
      return true;
    }
    if (!next) {
      const granted = await requestGlobalPermission();
      if (!granted) {
        const fallback = "Site access was not granted. Re-enable prompts or allow access in the settings.";
        setHintMessage("hint_permission_global_required", fallback);
        recordUserNotice("error", fallback);
        if (!skipToast) {
          showToast(t("toast_permission_prompt_denied", "Site access request was declined."), { duration: 4200 });
        }
        return false;
      }
      askPermissionEachScan = false;
      try { await chrome.storage.sync.set({ [PERMISSION_PROMPT_KEY]: false }); } catch { }
      try { await chrome.runtime.sendMessage({ action: "enableGlobalPermissions", origins: GLOBAL_PERMISSION_ALL_ORIGINS }); } catch { }
      if (!skipToast) {
        showToast(t("toast_permission_prompt_disabled", "Site access stays granted; no more prompts."), { duration: 3600 });
      }
      setHintMessage(null);
      return true;
    }
    await removeGlobalPermission();
    askPermissionEachScan = true;
    try { await chrome.storage.sync.set({ [PERMISSION_PROMPT_KEY]: true }); } catch { }
    try { await chrome.runtime.sendMessage({ action: "disableGlobalPermissions", origins: GLOBAL_PERMISSION_ALL_ORIGINS }); } catch { }
    if (!skipToast) {
      showToast(t("toast_permission_prompt_enabled", "You'll be asked for site access per site."), { duration: 3600 });
    }
    setHintMessage(null);
    return true;
  }

  async function loadPermissionPromptPreference() {
    let stored = true;
    try {
      const prefs = await chrome.storage.sync.get({ [PERMISSION_PROMPT_KEY]: true });
      stored = prefs[PERMISSION_PROMPT_KEY] !== false;
    } catch {
      stored = true;
    }
    if (!stored) {
      const has = await hasGlobalPermission();
      if (!has) {
        stored = true;
        try { await chrome.storage.sync.set({ [PERMISSION_PROMPT_KEY]: true }); } catch { }
      } else {
        try { await chrome.runtime.sendMessage({ action: "enableGlobalPermissions", origins: GLOBAL_PERMISSION_ALL_ORIGINS }); } catch { }
      }
    }
    askPermissionEachScan = stored;
    const toggle = $("#permissionPromptSwitch");
    if (toggle) toggle.checked = askPermissionEachScan;
  }

  function bindPermissionPromptPreference() {
    const toggle = $("#permissionPromptSwitch");
    if (!toggle) return;
    toggle.addEventListener("change", async (event) => {
      const next = !!event.target.checked;
      const prev = askPermissionEachScan;
      if (next === prev) return;
      toggle.disabled = true;
      try {
        const ok = await setPermissionPromptMode(next);
        if (!ok) {
          askPermissionEachScan = prev;
          event.target.checked = prev;
        }
      } finally {
        toggle.disabled = false;
      }
    });
  }

  function bindDownloadPathPreference() {
    const toggle = $("#downloadPathSwitch");
    if (!toggle) return;
    toggle.addEventListener("change", async (event) => {
      await setDownloadPathPreference(!!event.target.checked);
    });
  }

  function bindSettingsMenu() {
    const btn = $("#settingsBtn");
    const modal = $("#settingsModal");
    const closeBtn = $("#settingsCloseBtn");
    if (!btn || !modal) return;

    function isOpen() {
      return modal.style.display !== "none" && getComputedStyle(modal).display !== "none";
    }

    function close({ returnFocus = true } = {}) {
      if (!isOpen()) return;
      const activeEl = document.activeElement;
      if (activeEl && modal.contains(activeEl)) {
        activeEl.blur();
      }
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      btn.setAttribute("aria-expanded", "false");
      if (returnFocus) btn.focus?.();
    }

    function open() {
      if (isOpen()) return;
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
      btn.setAttribute("aria-expanded", "true");
      closeBtn?.focus?.();
    }

    const bookmarksBtn = document.getElementById("openBookmarksBtn");
    if (bookmarksBtn) {
      bookmarksBtn.addEventListener("click", (event) => {
        event.preventDefault();
        close({ returnFocus: false });
        const targetUrl = chrome.runtime.getURL("bookmarks.html");
        if (chrome?.tabs?.create) {
          try {
            const created = chrome.tabs.create({ url: targetUrl });
            if (created && typeof created.catch === "function") {
              created.catch(() => { });
            }
          } catch (err) {
            console.warn("[HK] Failed to open bookmarks", err);
          }
        }
      });
    }
    const overlay = modal.querySelector(".hk-modal-overlay");
    overlay?.addEventListener("click", () => close());
    closeBtn?.addEventListener("click", () => close());

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (isOpen()) close(); else open();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!isOpen()) return;
      close();
    });
  }

  // Load tip/contact links
  async function loadLinks() {
    try {
      const resTip = await fetch(chrome.runtime.getURL("tip_link.txt"));
      const tipUrl = (await resTip.text()).trim();
      if (tipUrl) $("#tipLink").href = tipUrl;
    } catch { }
    try {
      const resContact = await fetch(chrome.runtime.getURL("contact_link.txt"));
      const contactUrl = (await resContact.text()).trim();
      if (contactUrl) $("#contactLink").href = contactUrl;
    } catch { }
  }

  // Download selected items individually
  async function downloadSelected() {
    stopActiveScan("Scan stopped to download files.");
    const chosen = selectedItems({ visibleOnly: false });
    if (!chosen.length) { $("#hint").textContent = t("hint_select_items", "Select some items first."); return; }
    const tab = await getActiveTab();
    const tabSupports = tabSupportsContent(tab);
    const tabId = tabSupports ? tab.id : null;
    const rawRelease = new Set();
    const conv = $("#convertFormat").value;
    const files = buildFileList(chosen);
    const total = files.length;
    if (!total) {
      if (!total) {
        const msg = t("hint_download_failed", "Download request failed.");
        recordUserNotice("error", msg);
        return;
      }
    }
    bulkSetDownloadStatus(chosen, "queued");
    renderGrid();
    // Count all download ATTEMPTS at the start (not just successes)
    await recordDownloadSuccess(total);
    if (!conv) {
      let success = 0;
      let processed = 0;
      const errors = [];
      startProgress(t("label_progress_download", ["0", `${total}`], `Requesting download 0 of ${total}`), total);
      for (let idx = 0; idx < files.length; idx++) {
        if (isProgressCancelled()) break;
        const entry = files[idx];
        const original = chosen[idx];
        try {
          const resp = await chrome.runtime.sendMessage({ action: "downloadURL", item: entry, saveAs: shouldSaveAs() });
          if (!resp || resp.ok === false) throw new Error(resp?.error || "Download failed");
          const releasable = getReleasableBlobUrl(original);
          if (releasable) {
            rawRelease.add(releasable);
          }
          setDownloadStatusForItem(original, "success");
          success++;
        } catch (err) {
          const msg = String(err?.message || err || "Download failed");
          setDownloadStatusForItem(original, "error", msg);
          errors.push({ item: original, message: msg });
          const releasable = getReleasableBlobUrl(original);
          if (releasable) {
            rawRelease.add(releasable);
          }
        }
        processed = idx + 1;
        updateProgress(processed, total, t("label_progress_download", [`${processed}`, `${total}`], `Requesting download ${processed} of ${total}`));
        await cooperativeDelay(30);
      }
      const cancelled = isProgressCancelled();
      if (cancelled) {
        finishProgress(t("label_progress_cancelled", "Cancelled"));
        setHintMessage("hint_progress_cancelled", "Operation cancelled.");
        recordUserNotice("warn", t("hint_progress_cancelled", "Operation cancelled."));
        for (let j = processed; j < chosen.length; j++) setDownloadStatusForItem(chosen[j], null);
      } else {
        finishProgress(t("label_progress_done", "Done"));
        const msg = t("hint_download_complete", [success, total], `Requested ${success} of ${total} download(s).`);
        recordUserNotice("info", msg);
        if (errors.length) {
          showToast(t("toast_downloads_partial", [success, errors.length], `${success} download(s) queued, ${errors.length} failed.`), {
            duration: 6000,
            action: { label: t("toast_downloads_link", "Open Downloads"), handler: openDownloads }
          });
        } else {
          showToast(t("toast_downloads", [success], `Requested ${success} download(s).`), {
            action: { label: t("toast_downloads_link", "Open Downloads"), handler: openDownloads }
          });
        }
        // Note: Download attempts already counted at the start
      }
    } else {
      let success = 0;
      let processed = 0;
      const errors = [];
      startProgress(t("label_progress_converting_step", ["0", `${total}`], `Converting 0 of ${total}`), total);
      for (let idx = 0; idx < files.length; idx++) {
        if (isProgressCancelled()) break;
        const entry = files[idx];
        const original = chosen[idx];
        let tempUrl = null;
        try {
          const buffer = await fetchAsUint8(entry.url);
          if (!buffer) throw new Error("Missing bytes");
          const converted = await convertArrayBufferToFormat(buffer, conv);
          const newName = replaceExtension(entry.filename.split('/').pop(), conv);
          const blobMime = conv === "jpg" ? "image/jpeg" : (conv === "png" ? "image/png" : "image/webp");
          const blob = new Blob([converted], { type: blobMime });
          tempUrl = trackBlobUrl(URL.createObjectURL(blob));
          const resp = await chrome.runtime.sendMessage({ action: "downloadBlob", blobUrl: tempUrl, filename: newName, saveAs: shouldSaveAs() });
          if (!resp || resp.ok === false) throw new Error(resp?.error || "Download failed");
          const releasable = getReleasableBlobUrl(original);
          if (releasable) {
            rawRelease.add(releasable);
          }
          setDownloadStatusForItem(original, "success");
          success++;
        } catch (err) {
          const msg = String(err?.message || err || "Download failed");
          setDownloadStatusForItem(original, "error", msg);
          errors.push({ item: original, message: msg });
          const releasable = getReleasableBlobUrl(original);
          if (releasable) {
            rawRelease.add(releasable);
          }
        } finally {
          if (tempUrl) revokeTracked(tempUrl);
        }
        processed = idx + 1;
        updateProgress(processed, total, t("label_progress_converting_step", [`${processed}`, `${total}`], `Converting ${processed} of ${total}`));
        await cooperativeDelay(30);
      }
      const cancelled = isProgressCancelled();
      if (cancelled) {
        finishProgress(t("label_progress_cancelled", "Cancelled"));
        setHintMessage("hint_progress_cancelled", "Operation cancelled.");
        recordUserNotice("warn", t("hint_progress_cancelled", "Operation cancelled."));
        for (let j = processed; j < chosen.length; j++) setDownloadStatusForItem(chosen[j], null);
      } else {
        finishProgress(t("label_progress_done", "Done"));
        const msg = t("hint_convert_requested", [success], `Converted and requested ${success} download(s).`);
        recordUserNotice("info", msg);
        if (errors.length) {
          showToast(t("toast_downloads_partial", [success, errors.length], `${success} download(s) queued, ${errors.length} failed.`), {
            duration: 6000,
            action: { label: t("toast_downloads_link", "Open Downloads"), handler: openDownloads }
          });
        } else {
          showToast(t("toast_downloads", [success], `Requested ${success} download(s).`), {
            action: { label: t("toast_downloads_link", "Open Downloads"), handler: openDownloads }
          });
        }
        // Note: Download attempts already counted at the start
      }
    }
    if (rawRelease.size && tabId != null) {
      try { await sendToContent(tabId, { action: "releaseObjectUrls", urls: Array.from(rawRelease) }); } catch { }
    }
    renderGrid();
  }

  async function zipChapterItems(chapter, items) {
    if (!Array.isArray(items) || !items.length) {
      throw new Error("No pages to zip.");
    }
    const chapterFolder = sanitizeFilenameStem(chapter?.title || chapter?.id || "chapter");
    const zip = new JSZip();
    const rawRelease = new Set();
    for (let i = 0; i < items.length; i++) {
      if (isProgressCancelled()) {
        throw new Error("Operation cancelled.");
      }
      const entry = items[i];
      let buffer = await fetchAsUint8(entry.url);
      buffer = await convertArrayBufferToFormat(buffer, "png");
      const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const arrBuf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      const baseName = (entry.filename && entry.filename.split("/").pop()) || `${chapterFolder}_page_${String(i + 1).padStart(3, "0")}.png`;
      const safeName = `${chapterFolder}/${replaceExtension(baseName, "png")}`;
      zip.file(safeName, arrBuf);
      const releasable = getReleasableBlobUrl(entry);
      if (releasable) {
        rawRelease.add(releasable);
      }
      updateProgress(i + 1, items.length, `Packing ${chapter.title || chapterFolder} (${i + 1}/${items.length})`);
      await cooperativeDelay(16);
    }
    if (isProgressCancelled()) {
      throw new Error("Operation cancelled.");
    }
    updateProgress(items.length, items.length, "Creating archive...");
    const blob = await zip.generateAsync({ type: "blob" });
    const blobUrl = trackBlobUrl(URL.createObjectURL(blob));
    const zipName = `${chapterFolder || "chapter"}.zip`;
    await chrome.downloads.download({ url: blobUrl, filename: zipName, saveAs: shouldSaveAs() });
    setTimeout(() => revokeTracked(blobUrl), 60000);
    rawRelease.forEach((url) => revokeTracked(url));
    return zipName;
  }

  // Build list of filenames ensuring uniqueness, grouping manga items by chapter
  function filenameFromUrl(input) {
    if (typeof input !== "string" || !input) return "";
    try {
      const url = new URL(input);
      const segments = url.pathname.split("/").filter(Boolean);
      if (!segments.length) return "";
      return decodeURIComponent(segments.pop());
    } catch {
      return "";
    }
  }

  function buildFileList(list) {
    const out = [];
    const takenByFolder = new Map();
    list.forEach((it, idx) => {
      const formatKey = inferFormat(it) || sanitizeExtension(ext(it?.url) || ext(it?.rawUrl) || "png");
      const fallbackExt = sanitizeExtension(formatKey || "png");
      const provided = String(it?.filename || filenameFromUrl(it?.url) || filenameFromUrl(it?.rawUrl) || "");
      let folder = "";
      if (it?.__chapterFolder) {
        folder = sanitizeFilenameStem(it.__chapterFolder, "chapter");
      } else if (it?.__chapterTitle) {
        folder = sanitizeFilenameStem(it.__chapterTitle, "chapter");
      }
      let baseName = provided;
      const slashIdx = provided.lastIndexOf("/");
      if (slashIdx >= 0) {
        if (!folder) {
          const folderName = provided.slice(0, slashIdx).split("/").filter(Boolean).pop();
          folder = folderName ? sanitizeFilenameStem(folderName, "images") : "";
        }
        baseName = provided.slice(slashIdx + 1);
      }
      if (!folder) folder = "images";
      const taken = takenByFolder.get(folder) || new Set();
      takenByFolder.set(folder, taken);
      const safeBase = ensureSafeFilenameCandidate(baseName, { defaultExt: fallbackExt, fallback: `image_${idx}` });
      let name = safeBase;
      let n = 1;
      while (taken.has(name)) {
        const dot = safeBase.lastIndexOf('.');
        const stem = dot > 0 ? safeBase.slice(0, dot) : safeBase;
        const extPart = dot > 0 ? safeBase.slice(dot + 1) : fallbackExt;
        name = ensureSafeFilenameCandidate(`${stem} (${n++}).${extPart}`, { defaultExt: extPart || fallbackExt, fallback: stem || `image_${idx}` });
      }
      taken.add(name);
      out.push({ url: it.url, filename: `${folder}/${name}` });
    });
    return out;
  }

  function deriveZipName(selected) {
    const chapterFolders = new Map(); // folder -> label
    for (const it of selected) {
      if (it?.__chapterFolder) {
        const folder = sanitizeFilenameStem(it.__chapterFolder, "chapter");
        const label = sanitizeFilenameStem(it.__chapterTitle || it.__chapterFolder || folder, folder);
        chapterFolders.set(folder, label);
      } else if (it?.__chapterTitle) {
        const folder = sanitizeFilenameStem(it.__chapterTitle, "chapter");
        chapterFolders.set(folder, folder);
      }
    }
    if (chapterFolders.size === 1) {
      const [, label] = Array.from(chapterFolders.entries())[0];
      return `${label}.zip`;
    }
    if (chapterFolders.size > 1) {
      return "chapters.zip";
    }
    return "zippedimages.zip";
  }

  // ZIP selected items using JSZip and download
  async function zipSelectedItems() {
    stopActiveScan("Scan stopped to zip files.");
    const chosen = selectedItems({ visibleOnly: false });
    if (!chosen.length) {
      const msg = t("hint_select_items", "Select some items first.");
      recordUserNotice("warn", msg);
      return;
    }
    const zipFilename = deriveZipName(chosen);
    const tab = await getActiveTab();
    const tabSupports = tabSupportsContent(tab);
    const tabId = tabSupports ? tab.id : null;
    const rawRelease = new Set();
    const conv = $("#convertFormat").value;
    const items = buildFileList(chosen);
    const saveAsFlag = shouldSaveAs();
    bulkSetDownloadStatus(chosen, "queued");
    renderGrid();
    // Count all ZIP download ATTEMPTS at the start (not just successes)
    await recordDownloadMilestone(chosen.length);
    const PROGRESS_TOTAL = 100;
    const STAGING_END = 55;
    const PACKING_END = 85;
    startProgress(t("label_staging_items", ["0", `${items.length}`], items.length ? `Staging 0 of ${items.length}` : "Staging 0 of 0"), PROGRESS_TOTAL);
    const staged = [];
    const stagedItems = [];
    let processed = 0;
    for (let i = 0; i < items.length; i++) {
      if (isProgressCancelled()) break;
      const it = items[i];
      let filename = it.filename;
      try {
        const buffer = await fetchAsUint8(it.url);
        if (!buffer) throw new Error("Missing bytes");
        let outBuf = buffer;
        if (conv) {
          outBuf = await convertArrayBufferToFormat(buffer, conv);
          const parts = filename.split('/');
          parts[parts.length - 1] = replaceExtension(parts[parts.length - 1], conv);
          filename = parts.join('/');
        }
        const view = outBuf instanceof Uint8Array ? outBuf : new Uint8Array(outBuf);
        const arrBuf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        staged.push({ filename, buffer: arrBuf });
        stagedItems.push(chosen[i]);
        const source = chosen[i];
        const releasable = getReleasableBlobUrl(source);
        if (releasable) {
          rawRelease.add(releasable);
        }
      } catch (err) {
        const msg = String(err?.message || err || "Staging failed");
        setDownloadStatusForItem(chosen[i], "error", msg);
        const source = chosen[i];
        const releasable = getReleasableBlobUrl(source);
        if (releasable) {
          rawRelease.add(releasable);
        }
      }
      processed = i + 1;
      const pct = items.length ? Math.round((processed / items.length) * STAGING_END) : STAGING_END;
      updateProgress(pct, PROGRESS_TOTAL, t("label_staging_items", [`${processed}`, `${items.length}`], items.length ? `Staging ${processed} of ${items.length}` : "Staging 0 of 0"));
      await cooperativeDelay();
    }
    if (isProgressCancelled()) {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      setHintMessage("hint_progress_cancelled", "Operation cancelled.");
      recordUserNotice("warn", t("hint_progress_cancelled", "Operation cancelled."));
      for (let j = processed; j < chosen.length; j++) {
        const status = getDownloadStatus(chosen[j]?.url);
        if (status && status.status === "queued") setDownloadStatusForItem(chosen[j], null);
      }
      renderGrid();
      // Note: Not revoking blob URLs here - they are still displayed in the grid
      return;
    }
    if (!staged.length) {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      const msg = t("hint_zip_no_items", "No files could be added to ZIP.");
      recordUserNotice("warn", msg);
      // Note: Not revoking blob URLs here - they are still displayed in the grid
      renderGrid();
      return;
    }
    updateProgress(STAGING_END, PROGRESS_TOTAL, t("label_zip_packing", "Packing ZIP..."));
    if (isProgressCancelled()) {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      setHintMessage("hint_progress_cancelled", "Operation cancelled.");
      recordUserNotice("warn", t("hint_progress_cancelled", "Operation cancelled."));
      // Note: Not revoking blob URLs here - they are still displayed in the grid
      return;
    }
    let zipBuffer = null;
    try {
      zipBuffer = await runZipWorker(staged, (meta) => {
        if (!meta || typeof meta.progress !== "number") return;
        const pct = Math.max(0, Math.min(100, Math.round(meta.progress)));
        const mapped = STAGING_END + Math.round((pct / 100) * (PACKING_END - STAGING_END));
        updateProgress(mapped, PROGRESS_TOTAL, t("label_zip_packing_progress", [`${pct}`], `Packing ZIP ${pct}%`));
      });
    } catch (workerErr) {
      try {
        const fallbackZip = new JSZip();
        staged.forEach(({ filename, buffer }) => fallbackZip.file(filename, buffer));
        zipBuffer = await fallbackZip.generateAsync({ type: 'arraybuffer' });
      } catch {
        finishProgress(t("label_progress_cancelled", "Cancelled"));
        const msg = t("hint_zip_failed", "ZIP creation failed.");
        recordUserNotice("error", msg);
        stagedItems.forEach((item) => setDownloadStatusForItem(item, "error", "ZIP creation failed."));
        renderGrid();
        return;
      }
    }
    if (isProgressCancelled()) {
      finishProgress(t("label_progress_cancelled", "Cancelled"));
      setHintMessage("hint_progress_cancelled", "Operation cancelled.");
      recordUserNotice("warn", t("hint_progress_cancelled", "Operation cancelled."));
      // Note: Not revoking blob URLs here - they are still displayed in the grid
      renderGrid();
      return;
    }
    updateProgress(PACKING_END, PROGRESS_TOTAL, t("label_zip_finalizing", "Finalizing ZIP..."));
    const blob = new Blob([zipBuffer], { type: 'application/zip' });
    const url = trackBlobUrl(URL.createObjectURL(blob));
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'downloadBlob', blobUrl: url, filename: zipFilename, saveAs: saveAsFlag });
      if (!resp || resp.ok === false) throw new Error(resp?.error || "download failed");
      // Note: Not revoking blob URLs here - they remain valid for display
      stagedItems.forEach((item) => setDownloadStatusForItem(item, "success"));
      const msg = t("hint_zip_success", [staged.length], `ZIP file created with ${staged.length} item(s)`);
      recordUserNotice("info", msg);
      showToast(t("toast_zip", [staged.length], `ZIP queued with ${staged.length} item(s).`), {
        action: { label: t("toast_downloads_link", "Open Downloads"), handler: openDownloads }
      });
      // Note: Download attempts already counted at the start
    } catch (err) {
      const msg = String(err?.message || err || "");
      stagedItems.forEach((item) => setDownloadStatusForItem(item, "error", msg || "ZIP download failed."));
      const fb = t("hint_zip_download_failed", "ZIP download request failed.");
      recordUserNotice("error", fb);
    } finally {
      revokeTracked(url);
      updateProgress(PROGRESS_TOTAL, PROGRESS_TOTAL, t("label_progress_done", "Done"));
      finishProgress(t("label_progress_done", "Done"));
      // Note: Not revoking blob URLs here - they remain valid for display
      renderGrid();
    }
  }

  function bindDownloadButtons() {
    $("#downloadSelected").addEventListener("click", downloadSelected);
    $("#zipSelected").addEventListener("click", zipSelectedItems);
    const deleteBtn = $("#deleteSelected");
    if (deleteBtn) deleteBtn.addEventListener("click", deleteSelectedItems);
  }

  function deleteSelectedItems() {
    stopActiveScan("Scan stopped to delete items.");
    const selected = selectedItems({ visibleOnly: true });
    if (!selected.length) {
      setHintMessage("hint_select_items", "Select some items first.");
      return;
    }
    const urlsToDelete = new Set(selected.map(item => item.url || item.src).filter(Boolean));
    // Remove from CACHE
    for (let i = CACHE.length - 1; i >= 0; i--) {
      const item = CACHE[i];
      const key = item?.url || item?.src;
      if (key && urlsToDelete.has(key)) {
        CACHE.splice(i, 1);
      }
    }
    // Remove from DISCOVERY_REGISTRY
    for (const key of urlsToDelete) {
      DISCOVERY_REGISTRY.delete(key);
    }
    renderGrid();
    setHintMessage("hint_deleted", `Deleted ${urlsToDelete.size} item(s) from the list.`);
    recordUserNotice("info", `Deleted ${urlsToDelete.size} item(s).`);
  }

  // Rename items serially in detection order
  function renameSerially() {
    stopActiveScan("Scan stopped to rename files.");
    const visible = filteredItems();
    if (!visible.length) {
      setHintMessage("hint_nothing_to_rename", "Nothing to rename.");
      recordUserNotice("warn", t("hint_nothing_to_rename", "Nothing to rename."));
      return;
    }
    const startStr = prompt(t("prompt_rename_start", "Start numbering from:"), t("prompt_rename_default", "1"));
    let start = parseInt((startStr || "").trim(), 10);
    if (!Number.isFinite(start) || start < 0) start = 1;
    const ordered = visible.slice().sort(compareByDetection);
    const maxNum = start + ordered.length - 1;
    const pad = Math.max(2, String(maxNum).length);
    let idx = start;
    for (const it of ordered) {
      const e = sanitizeExtension(inferFormat(it) || ext(it.url) || "png");
      const num = String(idx++).padStart(pad, "0");
      it.filename = `${num}.${e}`;
    }
    renderGrid();
    const msg = t("hint_rename_success", [ordered.length, start], `Renamed ${ordered.length} item(s) starting at ${start}.`);
    setHintMessage("hint_rename_success", `Renamed ${ordered.length} item(s) starting at ${start}.`, [ordered.length, start]);
    recordUserNotice("info", msg);
  }
  function bindRenameButton() {
    const btn = $("#renameSerial");
    if (btn) btn.addEventListener('click', renameSerially);
  }

  // Selection helpers
  function updateSelectionToggleButton(visibleItems = null) {
    const toggleBtn = document.querySelector("#selectionToggle");
    if (!toggleBtn) return;
    const items = Array.isArray(visibleItems) ? visibleItems : filteredItems();
    const visibleCount = items.length;
    let allSelected = visibleCount > 0;
    if (allSelected) {
      for (const it of items) {
        if (!SELECTED.has(it.url)) {
          allSelected = false;
          break;
        }
      }
    }
    const labelKey = allSelected ? "button_select_none" : "button_select_all";
    const fallback = allSelected ? "Unselect All" : "Select All";
    toggleBtn.textContent = t(labelKey, fallback);
    toggleBtn.dataset.mode = allSelected ? "none" : "all";
    toggleBtn.disabled = visibleCount === 0;
  }

  function bindSelectionButtons() {
    const toggleBtn = document.querySelector('#selectionToggle');
    const invertBtn = document.querySelector('#invertSelection');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      const items = filteredItems();
      if (!items.length) return;
      const shouldSelectAll = toggleBtn.dataset.mode !== "none";
      if (shouldSelectAll) {
        for (const it of items) SELECTED.add(it.url);
      } else {
        for (const it of items) SELECTED.delete(it.url);
      }
      renderGrid();
    });
    if (invertBtn) invertBtn.addEventListener('click', () => {
      for (const it of filteredItems()) {
        if (SELECTED.has(it.url)) {
          SELECTED.delete(it.url);
        } else {
          SELECTED.add(it.url);
        }
      }
      renderGrid();
    });
    updateSelectionToggleButton();
  }

  function bindAdvancedToggle() {
    const advBtn = document.querySelector('#advancedToggle');
    const advSection = document.querySelector('#advanced');
    if (!advBtn || !advSection) return;
    const setLabel = () => {
      const expanded = !advSection.classList.contains('hidden');
      advBtn.textContent = expanded ? t("button_advanced_collapse", "Advanced [v]") : t("button_advanced_expand", "Advanced [>]");
    };
    advBtn.addEventListener('click', () => {
      const hidden = advSection.classList.contains('hidden');
      if (hidden) {
        advSection.classList.remove('hidden');
      } else {
        advSection.classList.add('hidden');
      }
      setLabel();
    });
    setLabel();
  }

  function bindFilterControls() {
    const formatSel = $("#formatFilter");
    if (formatSel) {
      FILTER_STATE.format = formatSel.value || "";
      formatSel.addEventListener("change", (e) => {
        FILTER_STATE.format = e.target.value || "";
        renderGrid();
      });
    }
    const kindSel = $("#kindFilter");
    if (kindSel) {
      FILTER_STATE.kind = kindSel.value || "all";
      kindSel.addEventListener("change", (e) => {
        FILTER_STATE.kind = e.target.value || "all";
        renderGrid();
      });
    }
    const sortSel = $("#sortSelect");
    if (sortSel) {
      FILTER_STATE.sort = sortSel.value || "detected";
      sortSel.addEventListener("change", (e) => {
        const value = e.target.value || "detected";
        FILTER_STATE.sort = value;
        renderGrid();
      });
    }
    const discoverySel = $("#discoveryFilter");
    if (discoverySel) {
      FILTER_STATE.discovery = discoverySel.value || "all";
      discoverySel.addEventListener("change", (e) => {
        FILTER_STATE.discovery = e.target.value || "all";
        renderGrid();
      });
    }
    const searchInput = $("#searchInput");
    if (searchInput) {
      FILTER_STATE.search = String(searchInput.value || "").trim().toLowerCase();
      searchInput.addEventListener("input", (e) => {
        FILTER_STATE.search = String(e.target.value || "").trim().toLowerCase();
        renderGrid();
      });
    }
  }

  window.addEventListener("beforeunload", () => {
    revokeAllTracked();
    terminateZipWorker();
    RAW_BLOB_CACHE.clear();
    stopAutoScanLoop();
    GV_INJECTED_STATE.clear();
    if (autoRestartTimer) {
      clearTimeout(autoRestartTimer);
      autoRestartTimer = null;
    }
  });

  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (!message || !message.action) return;
      if (message.action === "HK_PAGE_CHANGED") {
        handleHKExternalPageChange(message);
      } else if (message.action === "SCAN_PROGRESS") {
        handleScanProgressMessage(message, sender).catch(() => { });
      }
    });
  }

  // Initialization
  document.addEventListener("DOMContentLoaded", async () => {
    await loadThemePreference();
    await loadLocalePreference();
    applyI18n();
    await initHKModeSection();
    const prog = $("#progressText");
    if (prog) prog.textContent = t("label_progress_preparing", "Preparing...");
    toastHost = $("#toastHost");
    bindProgressControls();
    bindDimensionFilters();
    runInitGuard(bindScanButtons, "scan buttons");
    bindGVControls();
    bindAutoToggles();
    bindModuleControls();
    bindOverlayActions();
    bindUIPreference();
    bindLocalePreference();
    bindShowOnboardingButton();
    bindPermissionPromptPreference();
    bindDownloadPathPreference();
    bindDownloadButtons();
    bindRenameButton();
    bindSelectionButtons();
    bindAdvancedToggle();
    bindFilterControls();
    bindFilterToggle();
    bindThemePreference();
    bindSettingsMenu();
    bindHelpButton();
    bindFirstRunNotice();
    bindFooterMessageToggle();
    renderFooterLog();
    await loadUIPreference();
    await loadPermissionPromptPreference();
    await loadDownloadPathPreference();
    await loadOverlayTags();
    await loadLinks();
    await initDonationTracking();
    await loadStats();
    await maybeShowFirstRun();
    await maybeShowOnboarding();
    renderGrid();
  });

  function applyHKDetectedConnector(record) {
    const canonicalId = canonicalizeConnectorId(record?.connectorId || "");
    hkDetectedConnectorId = canonicalId || null;
    hkDetectedFamilyKey = normalizeHKFamilyKey(record?.family);
    hkDetectedConnectorSource = record?.source || "";

    hkDebugLog(`[HK Detect] Applied connector: "${hkDetectedConnectorId}", Family: "${hkDetectedFamilyKey}", Source: "${hkDetectedConnectorSource}"`);

    const detectedTitle = record?.seriesTitle || record?.title || "";
    if (detectedTitle) {
      setHKSeriesTitle(detectedTitle);
    }
    updateHKDetectedConnectorLabel();
    updateHKBookmarkButtonState();
  }

  function resetHKDetectedConnectorLabel() {
    hkDetectedConnectorId = null;
    hkDetectedFamilyKey = null;
    hkDetectedConnectorSource = "";
    setHKSeriesTitle("");
    updateHKDetectedConnectorLabel();
    updateHKBookmarkButtonState();
  }

  function updateHKDetectedConnectorLabel() {
    if (!hkDetectedConnectorLabelEl) return;
    if (!hkDetectedConnectorId) {
      hkDetectedConnectorLabelEl.textContent = "Not detected";
      hkDetectedConnectorLabelEl.dataset.state = "idle";
      return;
    }
    const parts = [hkDetectedConnectorId];
    if (hkDetectedConnectorSource) {
      parts.push(`via ${hkDetectedConnectorSource}`);
    }
    hkDetectedConnectorLabelEl.textContent = parts.join(" ");
    hkDetectedConnectorLabelEl.dataset.state = "detected";
    if (hkConnectorSelectEl && hkConnectorSelectEl.value !== hkDetectedConnectorId) {
      hkConnectorSelectEl.value = hkDetectedConnectorId;
    }
  }

  // === MANUAL ADD CHAPTER FUNCTIONALITY ===
  (() => {
    const addChapterBtn = document.getElementById('hkAddChapterBtn');
    const addChapterContainer = document.getElementById('hkAddChapterContainer');
    const modal = document.getElementById('hkAddChapterModal');
    const modalClose = document.getElementById('hkAddChapterModalClose');
    const addChapterForm = document.getElementById('hkAddChapterForm');
    const cancelBtn = document.getElementById('hkAddChapterCancel');
    const urlInput = document.getElementById('hkManualChapterUrl');
    const titleInput = document.getElementById('hkManualChapterTitle');

    // Global state to store manually added chapters
    window.__UNSHACKLE_MANUAL_CHAPTERS__ = window.__UNSHACKLE_MANUAL_CHAPTERS__ || [];

    // Show/hide add chapter button when chapters are listed
    const observer = new MutationObserver(() => {
      const chapterList = document.getElementById('hkChapterList');
      if (chapterList && chapterList.children.length > 0 && addChapterContainer) {
        addChapterContainer.style.display = 'block';
      }
    });

    const chapterListElement = document.getElementById('hkChapterList');
    if (chapterListElement) {
      observer.observe(chapterListElement, { childList: true });
    }

    // Open modal
    if (addChapterBtn) {
      addChapterBtn.addEventListener('click', () => {
        if (modal) modal.style.display = 'flex';
        // Clear previous inputs
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
      });
    }

    // Close modal handlers
    const closeModal = () => {
      if (modal) modal.style.display = 'none';
    };

    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // Close on overlay click
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // Handle form submission
    if (addChapterForm) {
      addChapterForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const url = urlInput?.value?.trim();
        const title = titleInput?.value?.trim();

        if (!url || !title) return;

        try {
          // Just use the provided text as the chapter ID
          // No validation - accept any format (path, URL, encoded text, etc.)
          const id = url;

          // Add to manual chapters list
          const chapter = { id, title, _manual: true };
          window.__UNSHACKLE_MANUAL_CHAPTERS__.push(chapter);

          // Add to existing chapter cache
          if (Array.isArray(hkChapterCache)) {
            hkChapterCache.push(chapter);
          }

          // Re-render the full chapter list to get proper structure
          renderHKChapters(hkChapterCache);

          // Show success message
          hkDebugLog('[Yanmaga] Manually added chapter:', chapter);

          // Close modal
          closeModal();

          // Show toast
          if (typeof showToast === 'function') {
            showToast(`Added chapter: ${title}`);
          }
        } catch (error) {
          console.error('[Yanmaga] Error adding manual chapter:', error);
          alert('Error adding chapter. Please try again.');
        }
      });
    }
  })();

  // === NETWORK IMAGE CAPTURE ===
  (() => {
    const networkCaptureSwitch = document.getElementById('networkCaptureSwitch');
    const SEEN_NETWORK_HASHES = new Set();
    const SEEN_BLOB_URLS = new Set();
    const NETWORK_BLOB_URLS = new Set(); // Track blob URLs we create for revocation
    const NETWORK_CAPTURE_PREF_KEY = 'networkCaptureAllowed';
    let networkCaptureAllowed = false; // user preference (switch)
    let networkCaptureEnabled = false; // active during scans only

    // Cleanup function to revoke blob URLs and prevent memory leaks
    function cleanupNetworkBlobUrls() {
      for (const url of NETWORK_BLOB_URLS) {
        try {
          URL.revokeObjectURL(url);
        } catch { }
      }
      NETWORK_BLOB_URLS.clear();
      SEEN_NETWORK_HASHES.clear();
      SEEN_BLOB_URLS.clear();
      console.log('[Network] Cleaned up blob URLs');
    }

    // Expose cleanup function for grid clearing
    window.__cleanupNetworkBlobUrls = cleanupNetworkBlobUrls;

    // Helper to track blob URLs we create
    function trackBlobUrl(url) {
      if (url && url.startsWith('blob:')) {
        NETWORK_BLOB_URLS.add(url);
      }
      return url;
    }

    const isImageScanActive = () => !!(autoImagesEnabled || networkOnlyScanActive);

    async function persistNetworkCapturePreference(enabled) {
      try {
        await chrome.storage.local.set({ [NETWORK_CAPTURE_PREF_KEY]: !!enabled });
      } catch (error) {
        console.warn('[Network] Failed to persist capture preference:', error);
      }
    }

    async function setNetworkCaptureState(enabled, tabOverride = null, { silent = false } = {}) {
      const desired = !!enabled;
      if (networkCaptureEnabled === desired) return true;

      let tabId = null;
      if (desired) {
        const tab = tabOverride || await getActiveTab().catch(() => null);
        tabId = tab?.id || null;
        if (isInstagramLikeUrl(tab?.url)) {
          const cdnGranted = await ensureInstagramCdnPermissions();
          if (!cdnGranted) {
            if (typeof showToast === 'function' && !silent) {
              showToast('Allow Instagram CDN access to capture profile pictures.');
            }
            return false;
          }
        }
      }

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'setNetworkCaptureEnabled',
          enabled: desired,
          tabId: tabId
        });
        if (response?.ok) {
          networkCaptureEnabled = response.enabled;
          return true;
        }
      } catch (error) {
        console.warn('[Network] Failed to toggle capture:', error);
      }

      if (!silent && typeof showToast === 'function') {
        showToast(desired ? 'Network capture failed to start' : 'Network capture failed to stop');
      }
      return false;
    }

    async function syncNetworkCaptureWithScan(scanActive, options = {}) {
      const { tabOverride = null, silent = false } = options;
      if (scanActive && networkCaptureAllowed) {
        return await setNetworkCaptureState(true, tabOverride, { silent });
      }
      if (networkCaptureEnabled) {
        await setNetworkCaptureState(false, null, { silent: true });
      }
      return true;
    }

    // Expose to other modules that manage scanning state
    window.__syncNetworkCaptureWithScan = syncNetworkCaptureWithScan;

    // Initialize network capture toggle state
    async function initNetworkCapture() {
      try {
        const stored = await chrome.storage.local.get({ [NETWORK_CAPTURE_PREF_KEY]: false });
        networkCaptureAllowed = Boolean(stored[NETWORK_CAPTURE_PREF_KEY]);
        if (!networkCaptureAllowed) {
          const response = await chrome.runtime.sendMessage({ action: 'getNetworkCaptureEnabled' }).catch(() => null);
          if (response?.ok && response.enabled) {
            networkCaptureAllowed = true;
          }
        }
        if (networkCaptureSwitch) {
          networkCaptureSwitch.checked = networkCaptureAllowed;
        }
        // Ensure background capture is off until a scan actually runs
        await setNetworkCaptureState(false, null, { silent: true });
      } catch (error) {
        console.warn('[Network] Failed to get capture state:', error);
      }
    }

    // Toggle network capture
    if (networkCaptureSwitch) {
      networkCaptureSwitch.addEventListener('change', async () => {
        networkCaptureAllowed = networkCaptureSwitch.checked;
        await persistNetworkCapturePreference(networkCaptureAllowed);

        if (!networkCaptureAllowed) {
          await syncNetworkCaptureWithScan(false, { silent: true });
          if (networkOnlyScanActive || autoImagesEnabled) {
            await handleAutoImagesToggle(false, { silent: true }).catch(() => { });
          }
          if (typeof showToast === 'function') showToast('Network capture disabled');
          return;
        }

        if (typeof showToast === 'function') showToast('Network capture armed for scans');
        if (isImageScanActive()) {
          await syncNetworkCaptureWithScan(true, { silent: true });
        } else {
          await syncNetworkCaptureWithScan(false, { silent: true });
        }
      });
    }

    // Handle captured image notifications from background
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === 'NETWORK_IMAGE_CAPTURED' && networkCaptureEnabled && isImageScanActive()) {
        handleCapturedImage(msg.image).catch(() => { });
      }
    });

    // Keep network-only scans alive across tab reloads
    let networkReloadTimer = null;
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!networkOnlyScanActive || !window.__UNSHACKLE_NETWORK_ONLY_MODE__) return;
      if (changeInfo.status !== "complete") return;
      if (!tab?.active) return;
      if (networkReloadTimer) clearTimeout(networkReloadTimer);
      networkReloadTimer = setTimeout(() => {
        syncNetworkCaptureWithScan(true, { tabOverride: tab, silent: true }).catch(() => { });
        window.performNetworkOnlyScan({ keepButtonActive: true }).catch(() => { });
      }, 350);
    });

    // Process a captured image and add to grid if not duplicate
    async function handleCapturedImage(imageInfo) {
      if (!imageInfo?.hash) return;

      // Dedup by hash
      if (SEEN_NETWORK_HASHES.has(imageInfo.hash)) return;
      SEEN_NETWORK_HASHES.add(imageInfo.hash);

      // Check if URL already exists in grid
      const gridEl = document.getElementById('grid');
      if (gridEl) {
        const existing = gridEl.querySelector(`[data-raw-url="${CSS.escape(imageInfo.url)}"]`);
        if (existing) return;
      }

      try {
        // Get the active tab ID
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        if (!tabId || tabId < 0) return;

        // Get image bytes
        const response = await chrome.runtime.sendMessage({
          action: 'getCapturedImageBytes',
          tabId,
          hash: imageInfo.hash
        });

        if (!response?.ok || !response.data) return;

        // Create blob URL and track for cleanup
        const bytes = new Uint8Array(response.data);
        const blob = new Blob([bytes], { type: response.mime || 'image/jpeg' });
        const blobUrl = trackBlobUrl(URL.createObjectURL(blob));

        // Create image item for grid
        const item = {
          kind: 'img',
          type: 'networkCapture',
          url: blobUrl,
          rawUrl: imageInfo.url,
          normalizedUrl: imageInfo.normalizedUrl || imageInfo.url,
          filename: filenameFromUrl(imageInfo.url) || 'captured_image.jpg',
          mime: response.mime || 'image/jpeg',
          size: bytes.byteLength,
          width: imageInfo.width || 0,
          height: imageInfo.height || 0,
          contentHash: imageInfo.hash,
          sourceId: `network:${imageInfo.hash}`,
          _networkCapture: true
        };

        // Add to grid (using existing addImage function if available)
        if (typeof addImageItem === 'function') {
          if (addImageItem(item)) {
            await incrementStat("imagesScanned", 1);
          }
        }

      } catch (error) {
        console.warn('[Network] Failed to handle captured image:', error);
      }
    }

    // Helper to extract filename from URL
    function filenameFromUrl(url) {
      try {
        const pathname = new URL(url).pathname;
        const base = pathname.split('/').pop() || 'image';
        return base.split('?')[0].split('#')[0];
      } catch {
        return 'image';
      }
    }

    // Initialize on load
    initNetworkCapture();

    // Network Only Mode handler
    const networkOnlyModeSwitch = document.getElementById('networkOnlyModeSwitch');
    const networkCaptureStatus = document.getElementById('networkCaptureStatus');
    const NETWORK_ONLY_MODE_KEY = 'networkOnlyModeEnabled';

    // Global state for network-only mode
    window.__UNSHACKLE_NETWORK_ONLY_MODE__ = false;
    let networkOnlyScanActive = false;

    // Keep scan button in sync with network-only state
    function updateNetworkScanButton(active) {
      const btnScan = $("#btnScan");
      if (!btnScan) return;
      if (active) {
        btnScan.textContent = "Scanning...";
        btnScan.classList.add("scanning", "network-scanning");
        btnScan.dataset.scanning = "true";
      } else {
        btnScan.textContent = "Scan";
        btnScan.classList.remove("scanning", "network-scanning");
        delete btnScan.dataset.scanning;
      }
      btnScan.style.background = "";
      btnScan.style.borderColor = "";
      btnScan.style.color = "";
    }

    // Initialize Network Only Mode from storage
    async function initNetworkOnlyMode() {
      try {
        const result = await chrome.storage.local.get({ [NETWORK_ONLY_MODE_KEY]: false });
        window.__UNSHACKLE_NETWORK_ONLY_MODE__ = Boolean(result[NETWORK_ONLY_MODE_KEY]);
        if (networkOnlyModeSwitch) {
          networkOnlyModeSwitch.checked = window.__UNSHACKLE_NETWORK_ONLY_MODE__;
        }
        if (window.__UNSHACKLE_NETWORK_ONLY_MODE__ && networkCaptureStatus) {
          networkCaptureStatus.textContent = 'Network Only Mode ON - Scan will only show captured images';
          networkCaptureStatus.dataset.state = 'active';
        }
      } catch (error) {
        console.warn('[Network] Failed to load network-only mode:', error);
      }
    }

    // Save Network Only Mode to storage
    async function setNetworkOnlyMode(enabled) {
      window.__UNSHACKLE_NETWORK_ONLY_MODE__ = Boolean(enabled);
      try {
        await chrome.storage.local.set({ [NETWORK_ONLY_MODE_KEY]: window.__UNSHACKLE_NETWORK_ONLY_MODE__ });
      } catch (error) {
        console.warn('[Network] Failed to save network-only mode:', error);
      }
    }

    // Toggle handler for network-only mode
    if (networkOnlyModeSwitch) {
      networkOnlyModeSwitch.addEventListener('change', async () => {
        await setNetworkOnlyMode(networkOnlyModeSwitch.checked);

        if (!networkOnlyModeSwitch.checked && networkOnlyScanActive) {
          networkOnlyScanActive = false;
          autoImagesEnabled = false;
          updateNetworkScanButton(false);
          await syncNetworkCaptureWithScan(false, { silent: true });
        }

        if (networkCaptureStatus) {
          networkCaptureStatus.textContent = networkOnlyModeSwitch.checked
            ? 'Network Only Mode ON - Scan will only show captured images'
            : '';
          networkCaptureStatus.dataset.state = networkOnlyModeSwitch.checked ? 'active' : '';
        }

        if (typeof showToast === 'function') {
          showToast(networkOnlyModeSwitch.checked ? 'Network Only Mode enabled' : 'Network Only Mode disabled');
        }
      });
    }

    // Initialize network-only mode on load
    initNetworkOnlyMode();

    // Toggle network-only scan on/off via the Scan button
    window.toggleNetworkOnlyScan = async function (on, options = {}) {
      const { silent = false, tabOverride = null } = options;
      if (!window.__UNSHACKLE_NETWORK_ONLY_MODE__) return;

      if (on) {
        if (!networkCaptureAllowed) {
          updateNetworkScanButton(false);
          if (typeof showToast === 'function' && !silent) {
            showToast('Turn on Network capture to use network-only scan.');
          }
          return;
        }

        networkOnlyScanActive = true;
        autoImagesEnabled = true;
        updateNetworkScanButton(true);
        CURRENT_SCAN_ID = ++SCAN_SEQUENCE;
        await incrementStat("scans", 1);

        if (autoCanvasEnabled) {
          try {
            await handleAutoCanvasToggle(false, { silent: true, tabOverride });
          } catch (err) {
            console.warn('[Network] Failed to disable canvas auto-scan before network scan:', err);
          }
        }

        // Ensure bridge is injected for blob capture
        if (tabOverride?.id) {
          await ensureBridgeInjected(tabOverride.id);
        }

        const captureOk = await syncNetworkCaptureWithScan(true, { tabOverride, silent });
        if (!captureOk) {
          networkOnlyScanActive = false;
          autoImagesEnabled = false;
          updateNetworkScanButton(false);
          if (!silent && typeof showToast === 'function') showToast('Failed to enable network capture');
          return;
        }

        const result = await window.performNetworkOnlyScan({ keepButtonActive: true });
        if (result?.error && !silent && typeof showToast === 'function') {
          showToast(result.error === 'No images captured' ? 'No images captured yet. Browse the page first.' : result.error);
        }
      } else {
        networkOnlyScanActive = false;
        autoImagesEnabled = false;
        updateNetworkScanButton(false);
        await syncNetworkCaptureWithScan(false, { silent: true });
        if (!silent) setHintMessage(null);
      }
    };

    // Global function to perform network-only scan (called by scan button when mode is ON)
    window.performNetworkOnlyScan = async function (options = {}) {
      const { keepButtonActive = false } = options || {};

      const shouldStayActive = () => networkOnlyScanActive || (keepButtonActive && autoImagesEnabled);

      const dataUrlToBlob = async (dataUrl) => {
        try {
          const res = await fetch(dataUrl);
          if (!res.ok) return null;
          return await res.blob();
        } catch {
          return null;
        }
      };

      try {
        updateNetworkScanButton(true);

        // Reset SEEN caches and clear background process state to ensure fresh capture
        SEEN_NETWORK_HASHES.clear();
        SEEN_BLOB_URLS.clear();

        if (!networkCaptureAllowed) {
          updateNetworkScanButton(false);
          if (typeof showToast === 'function') showToast('Turn on Network capture to use network-only scan.');
          return { added: 0, error: 'Network capture disabled' };
        }

        // Get current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs?.[0]?.id;
        const tab = tabs?.[0] || null;
        if (!tabId || tabId < 0) {
          updateNetworkScanButton(shouldStayActive());
          if (typeof showToast === 'function') showToast('No active tab found');
          return { added: 0, error: 'No active tab' };
        }

        // Clean up stale background images from previous idle periods
        chrome.runtime.sendMessage({ action: 'clearCapturedImages', tabId }).catch(() => { });

        // Ensure bridge is injected for blob capture
        try {
          await ensureBridgeInjected(tabId);
        } catch (e) {
          console.warn('[Network] Bridge injection failed, blob capture may be incomplete:', e);
          if (typeof showToast === 'function') showToast('Warning: partial scan only (bridge failed)');
        }

        const captureOk = await syncNetworkCaptureWithScan(true, { tabOverride: tab, silent: true });
        if (!captureOk) {
          updateNetworkScanButton(false);
          if (typeof showToast === 'function') showToast('Failed to enable network capture');
          return { added: 0, error: 'Failed to enable network capture' };
        }

        // Get all cached images for this tab (CDP-captured)
        const response = await chrome.runtime.sendMessage({
          action: 'getCapturedImages',
          tabId
        });

        // Note: We continue even if CDP returned no images - blob collection may still work
        const images = (response?.ok && Array.isArray(response.images)) ? response.images : [];

        // Process captured images using batch retrieval for efficiency
        let added = 0;
        const newHashes = images.filter(img => !SEEN_NETWORK_HASHES.has(img.hash)).map(img => img.hash);

        if (newHashes.length) {
          // Batch fetch all image bytes at once (reduces N messages to 1)
          const batchResp = await chrome.runtime.sendMessage({
            action: 'getCapturedImagesBytesBatch',
            tabId,
            hashes: newHashes
          });

          if (batchResp?.ok && batchResp.results) {
            for (const img of images) {
              if (SEEN_NETWORK_HASHES.has(img.hash)) continue;

              const result = batchResp.results[img.hash];
              if (!result || !result.data) continue;

              try {
                SEEN_NETWORK_HASHES.add(img.hash);
                const bytes = new Uint8Array(result.data);
                const blob = new Blob([bytes], { type: result.mime || 'image/jpeg' });
                const blobUrl = trackBlobUrl(URL.createObjectURL(blob));

                const item = {
                  kind: 'img',
                  type: 'networkCapture',
                  url: blobUrl,
                  rawUrl: img.url,
                  normalizedUrl: img.normalizedUrl || img.url,
                  filename: filenameFromUrl(img.url) || 'captured_image.jpg',
                  mime: result.mime || 'image/jpeg',
                  size: bytes.byteLength,
                  width: 0,
                  height: 0,
                  contentHash: img.hash,
                  sourceId: `network:${img.hash}`,
                  _networkCapture: true
                };

                if (typeof addImageItem === 'function') {
                  if (addImageItem(item)) {
                    added++;
                  }
                }
              } catch (e) {
                console.warn('[Network] Failed to add image:', e);
              }
            }
          }
        }

        updateNetworkScanButton(shouldStayActive());


        // Also pull in blob: URLs directly from the page if available
        try {
          const blobList = await sendToContent(tabId, { action: "listBlobs" }).catch(() => null);
          const blobUrls = Array.isArray(blobList?.blobs) ? blobList.blobs.map((b) => b.url).filter((u) => typeof u === "string") : [];
          const freshBlobUrls = blobUrls.filter((u) => !SEEN_BLOB_URLS.has(u));
          if (freshBlobUrls.length) {
            const serialized = await sendToContent(tabId, { action: "serializeBlobUrls", urls: freshBlobUrls }).catch(() => null);
            const payloadMap = serialized?.data || {};
            for (const url of freshBlobUrls) {
              const payload = payloadMap[url];
              if (!payload || payload.missing || payload.tooLarge || !payload.dataUrl) continue;
              const blobObj = await dataUrlToBlob(payload.dataUrl);
              if (!blobObj) continue;
              const objectUrl = trackBlobUrl(URL.createObjectURL(blobObj));
              const item = {
                kind: 'img',
                type: 'networkCapture',
                url: objectUrl,
                rawUrl: url,
                normalizedUrl: url,
                filename: filenameFromUrl(url) || 'blob_image',
                mime: payload.mime || blobObj.type || 'application/octet-stream',
                size: payload.size || blobObj.size || 0,
                width: 0,
                height: 0,
                sourceId: `blob:${url}`,
                contentHash: payload.dataUrl.length > 64 ? payload.dataUrl.slice(0, 64) : payload.dataUrl
              };
              if (addImageItem(item)) {
                SEEN_BLOB_URLS.add(url);
                added++;
              }
            }
          }
        } catch (err) {
          console.warn('[Network] Failed to collect blob captures:', err);
        }

        // Also collect DOM-based visual assets (SVGs, canvases, background images)
        try {
          const domAssets = await sendToContent(tabId, { action: "collectAllVisualAssets" }).catch(() => null);
          if (domAssets?.ok && Array.isArray(domAssets.assets)) {
            for (const asset of domAssets.assets) {
              if (!asset.url || SEEN_BLOB_URLS.has(asset.url)) continue;
              if (SEEN_NETWORK_HASHES.has(asset.url)) continue;

              // Hydrate blob URLs: create extension-owned blob URL from base64 data
              // Hydrate blob URLs: create extension-owned blob URL from base64 data
              let displayUrl = asset.url;
              if (asset.url.startsWith('blob:')) {
                if (asset.base64) {
                  try {
                    // Decode base64 to bytes
                    const binary = atob(asset.base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                      bytes[i] = binary.charCodeAt(i);
                    }
                    // Create extension-owned blob URL
                    const blob = new Blob([bytes], { type: asset.mime || 'image/png' });
                    displayUrl = URL.createObjectURL(blob);
                    trackBlobUrl(displayUrl); // Track for cleanup
                  } catch (e) {
                    console.warn('[Network] Failed to hydrate blob URL:', e);
                    continue; // Skip this asset if hydration fails
                  }
                } else {
                  // Blob URL without data - unsafe to use page-bound URL in panel as it won't load
                  continue;
                }
              }

              const item = {
                kind: 'img',
                type: asset.source || 'domAsset',
                url: displayUrl,
                rawUrl: asset.url, // Keep original for deduplication
                normalizedUrl: asset.url,
                filename: `${asset.kind}_${Date.now()}.${asset.mime?.split('/')[1] || 'png'}`,
                mime: asset.mime || 'image/png',
                size: asset.size || 0,
                width: asset.width || 0,
                height: asset.height || 0,
                sourceId: `dom:${asset.kind}:${asset.url.slice(-20)}`,
                _networkCapture: true,
                _domAsset: true
              };

              if (addImageItem(item)) {
                SEEN_BLOB_URLS.add(asset.url);
                added++;
              }
            }
            console.log(`[Network] Collected ${domAssets.assets.length} DOM assets`);
          }
        } catch (err) {
          console.warn('[Network] Failed to collect DOM assets:', err);
        }

        if (added > 0) {
          await incrementStat("imagesScanned", added);
        }

        if (typeof showToast === 'function') {
          showToast(`Network scan: ${added} image${added !== 1 ? 's' : ''} added`);
        }

        return { added, error: null };

      } catch (error) {
        console.error('[Network] Network only scan failed:', error);
        if (typeof showToast === 'function') showToast('Network scan failed');
        updateNetworkScanButton(shouldStayActive());
        return { added: 0, error: error?.message || String(error) };
      }
    };
  })();
})();
