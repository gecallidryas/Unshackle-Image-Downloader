(() => {
  const THEME_KEY = "__unshackle_theme";
  const DEFAULT_THEME = "contrast";
  const HK_FAMILY_DEFAULTS = Object.freeze({
    speedbinb: true,
    coreview: true,
    madara: false,
    mangastream: false,
    foolslide: false
  });

  const $ = (selector) => document.querySelector(selector);

  let settingsSnapshot = null;
  let bookmarks = [];
  let listRoot = null;
  let emptyState = null;
  let updatesPanel = null;
  let updatesStatus = null;
  let updatesList = null;
  let updatesTitle = null;

  function getLocalStorage(keys) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function getSyncStorage(keys) {
    return new Promise((resolve, reject) => {
      if (!chrome?.storage?.sync) {
        resolve({});
        return;
      }
      chrome.storage.sync.get(keys, (result) => {
        const err = chrome.runtime?.lastError;
        if (err) {
          reject(err);
        } else {
          resolve(result || {});
        }
      });
    });
  }

  function setLocalStorage(values) {
    return new Promise((resolve, reject) => {
      if (!chrome?.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.set(values, () => {
        const err = chrome.runtime?.lastError;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  function normalizeThemeKey(themeKey) {
    const normalized = typeof themeKey === "string" ? themeKey.trim().toLowerCase() : "";
    if (normalized === "dark" || normalized === "lightdark") return normalized;
    return DEFAULT_THEME;
  }

  function normalizeUrl(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    try {
      return new URL(trimmed).href;
    } catch {
      return trimmed;
    }
  }

  function normalizeBookmark(entry) {
    if (!entry || typeof entry !== "object") return null;
    const connectorId = typeof entry.connectorId === "string"
      ? entry.connectorId
      : (typeof entry.id === "string" ? entry.id : "");
    const url = normalizeUrl(entry.url || entry.href || "");
    if (!connectorId || !url) return null;
    const title = typeof entry.title === "string" && entry.title.trim()
      ? entry.title.trim()
      : (typeof entry.seriesTitle === "string" ? entry.seriesTitle.trim() : "");
    const addedAt = Number(entry.addedAt);
    return {
      id: `${connectorId}::${url}`,
      connectorId,
      url,
      title,
      family: entry.family || null,
      addedAt: Number.isFinite(addedAt) ? addedAt : Date.now()
    };
  }

  function normalizeBookmarkList(list = []) {
    const seen = new Map();
    for (const entry of Array.isArray(list) ? list : []) {
      const normalized = normalizeBookmark(entry);
      if (!normalized) continue;
      const existing = seen.get(normalized.id);
      if (!existing || (existing.addedAt || 0) < (normalized.addedAt || 0)) {
        seen.set(normalized.id, normalized);
      }
    }
    return Array.from(seen.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  async function applyTheme() {
    let theme = DEFAULT_THEME;
    let fromSync = false;
    try {
      const prefs = await getSyncStorage({ panelTheme: DEFAULT_THEME });
      if (prefs && typeof prefs.panelTheme === "string") {
        theme = normalizeThemeKey(prefs.panelTheme);
        fromSync = true;
      }
    } catch (error) {
      console.warn("[Bookmarks] Failed to read sync theme", error);
    }
    if (!fromSync) {
      try {
        const stored = await getLocalStorage({ [THEME_KEY]: DEFAULT_THEME });
        if (stored && typeof stored[THEME_KEY] === "string") {
          theme = normalizeThemeKey(stored[THEME_KEY]);
        }
      } catch {
        theme = DEFAULT_THEME;
      }
    }
    document.body.dataset.theme = theme;
  }

  function buildFamiliesSnapshot() {
    const base = { ...HK_FAMILY_DEFAULTS };
    const families = settingsSnapshot?.manga?.families;
    if (families && typeof families === "object") {
      Object.keys(families).forEach((key) => {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey in base) {
          base[normalizedKey] = families[key] !== false;
        } else {
          base[normalizedKey] = families[key] !== false;
        }
      });
    }
    return base;
  }

  async function loadSettings() {
    const stored = await getLocalStorage({ settings: null });
    settingsSnapshot = stored.settings && typeof stored.settings === "object"
      ? stored.settings
      : {};
    const storedBookmarks = settingsSnapshot?.manga?.bookmarks || [];
    bookmarks = normalizeBookmarkList(storedBookmarks);
    renderBookmarkList();
  }

  async function persistBookmarks() {
    const nextBookmarks = bookmarks.map((entry) => ({
      connectorId: entry.connectorId,
      url: entry.url,
      title: entry.title,
      family: entry.family,
      addedAt: entry.addedAt
    }));
    const current = settingsSnapshot && typeof settingsSnapshot === "object"
      ? JSON.parse(JSON.stringify(settingsSnapshot))
      : {};
    if (!current.manga || typeof current.manga !== "object") {
      current.manga = {};
    }
    current.manga.bookmarks = nextBookmarks;
    settingsSnapshot = current;
    await setLocalStorage({ settings: current });
  }

  function renderBookmarkList() {
    if (!listRoot || !emptyState) return;
    listRoot.innerHTML = "";
    if (!bookmarks.length) {
      emptyState.hidden = false;
      if (updatesPanel) updatesPanel.hidden = true;
      return;
    }
    emptyState.hidden = true;
    for (const bookmark of bookmarks) {
      listRoot.appendChild(renderBookmarkItem(bookmark));
    }
  }

  function renderBookmarkItem(bookmark) {
    const item = document.createElement("li");
    item.className = "bookmark-item";

    const header = document.createElement("div");
    header.className = "bookmark-header";
    const title = document.createElement("h2");
    title.className = "bookmark-title";
    title.textContent = bookmark.title || bookmark.connectorId;
    header.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "bookmark-meta";
    const connectorBadge = document.createElement("span");
    connectorBadge.className = "badge badge-accent";
    connectorBadge.textContent = bookmark.connectorId;
    meta.appendChild(connectorBadge);
    if (bookmark.family) {
      const familyBadge = document.createElement("span");
      familyBadge.className = "badge";
      familyBadge.textContent = bookmark.family;
      meta.appendChild(familyBadge);
    }
    const addedBadge = document.createElement("span");
    addedBadge.className = "badge";
    const added = bookmark.addedAt ? new Date(bookmark.addedAt) : null;
    addedBadge.textContent = added ? `Saved ${added.toLocaleString()}` : "Saved";
    meta.appendChild(addedBadge);

    header.appendChild(meta);
    item.appendChild(header);

    const actions = document.createElement("div");
    actions.className = "bookmark-actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "primary-btn";
    openBtn.textContent = "Open series";
    openBtn.addEventListener("click", () => openBookmark(bookmark));
    actions.appendChild(openBtn);

    const updatesBtn = document.createElement("button");
    updatesBtn.type = "button";
    updatesBtn.className = "link-btn";
    updatesBtn.textContent = "See recent updates";
    updatesBtn.addEventListener("click", () => showRecentUpdates(bookmark));
    actions.appendChild(updatesBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "link-btn danger-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeBookmark(bookmark.id));
    actions.appendChild(removeBtn);

    item.appendChild(actions);
    return item;
  }

  async function openBookmark(bookmark) {
    if (!chrome?.tabs?.create) return;
    try {
      const created = chrome.tabs.create({ url: bookmark.url });
      if (created && typeof created.catch === "function") {
        created.catch(() => {});
      }
    } catch (error) {
      console.warn("[Bookmarks] Failed to open tab", error);
    }
  }

  async function removeBookmark(bookmarkId) {
    bookmarks = bookmarks.filter((item) => item.id !== bookmarkId);
    await persistBookmarks();
    renderBookmarkList();
  }

  function resetUpdatesPanel() {
    if (!updatesPanel || !updatesStatus || !updatesList) return;
    updatesPanel.hidden = true;
    updatesStatus.textContent = "";
    updatesList.innerHTML = "";
  }

  async function showRecentUpdates(bookmark) {
    if (!updatesPanel || !updatesStatus || !updatesList || !updatesTitle) return;
    updatesPanel.hidden = false;
    updatesTitle.textContent = `Recent updates • ${bookmark.title || bookmark.connectorId}`;
    updatesStatus.textContent = "Loading latest chapters...";
    updatesList.innerHTML = "";

    try {
      if (!hkProxy?.fetchManga) {
        throw new Error("Connector service unavailable.");
      }
      const families = buildFamiliesSnapshot();
      const loader = settingsSnapshot?.manga?.loader || "auto";
      const request = {
        connectorId: bookmark.connectorId,
        url: bookmark.url,
        loader,
        families
      };
      const result = await hkProxy.fetchManga(request);
      const chapters = Array.isArray(result?.chapters) ? result.chapters.slice(0, 2) : [];
      if (!chapters.length) {
        updatesStatus.textContent = "No recent chapters available.";
        return;
      }
      updatesStatus.textContent = "";
      updatesList.innerHTML = "";
      chapters.forEach((chapter) => {
        const li = document.createElement("li");
        li.className = "update-item";
        const title = document.createElement("h3");
        title.className = "update-title";
        title.textContent = chapter.title || chapter.id || "Chapter";
        li.appendChild(title);
        const meta = document.createElement("div");
        meta.className = "update-meta";
        const accessible = chapter.accessible !== false;
        meta.textContent = accessible ? "Accessible" : "Locked";
        li.appendChild(meta);
        const actionRow = document.createElement("div");
        actionRow.className = "bookmark-actions";
        if (chapter.url) {
          const openChapterBtn = document.createElement("button");
          openChapterBtn.type = "button";
          openChapterBtn.className = "link-btn";
          openChapterBtn.textContent = "Open chapter";
          openChapterBtn.addEventListener("click", () => openBookmark({ url: chapter.url }));
          actionRow.appendChild(openChapterBtn);
        }
        li.appendChild(actionRow);
        updatesList.appendChild(li);
      });
    } catch (error) {
      updatesStatus.textContent = error?.message || "Unable to load updates.";
    }
  }

  function attachEvents() {
    const closeUpdates = $("#closeUpdates");
    if (closeUpdates) {
      closeUpdates.addEventListener("click", () => {
        resetUpdatesPanel();
      });
    }
    const refreshBtn = $("#refreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        resetUpdatesPanel();
        loadSettings().catch(() => {});
      });
    }
  }

  async function init() {
    listRoot = $("#bookmarkList");
    emptyState = $("#emptyState");
    updatesPanel = $("#updatesPanel");
    updatesStatus = $("#updatesStatus");
    updatesList = $("#updatesList");
    updatesTitle = $("#updatesTitle");
    attachEvents();
    await applyTheme().catch(() => {});
    await loadSettings().catch((error) => {
      console.warn("[Bookmarks] Failed to load settings", error);
    });
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
