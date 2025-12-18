(function createHKModeManager(root) {
  const STORAGE_KEY = "hk.mode";
  const DEFAULT_MODE = "image";
  const EVENT_KIND = "MODE:changed";
  const listeners = new Set();

  function isValidMode(mode) {
    return mode === "image" || mode === "manga";
  }

  function emit(mode) {
    const payload = { kind: EVENT_KIND, mode };
    listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.warn("[HK Modes] Listener failed", error);
      }
    });
    if (typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
      try {
        root.dispatchEvent(new CustomEvent(EVENT_KIND, { detail: payload }));
      } catch {}
    }
  }

  async function getMode() {
    if (!chrome?.storage?.local) {
      return DEFAULT_MODE;
    }
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_MODE });
    const mode = result[STORAGE_KEY];
    return isValidMode(mode) ? mode : DEFAULT_MODE;
  }

  async function setMode(nextMode) {
    const mode = isValidMode(nextMode) ? nextMode : DEFAULT_MODE;
    if (!chrome?.storage?.local) {
      emit(mode);
      return mode;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: mode });
    emit(mode);
    return mode;
  }

  function onChanged(listener) {
    if (typeof listener === "function") {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    return () => {};
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORAGE_KEY]) return;
      const value = changes[STORAGE_KEY].newValue;
      const mode = isValidMode(value) ? value : DEFAULT_MODE;
      emit(mode);
    });
  }

  root.HKModes = {
    DEFAULT_MODE,
    getMode,
    setMode,
    onChanged
  };
})(typeof self !== "undefined" ? self : globalThis);
