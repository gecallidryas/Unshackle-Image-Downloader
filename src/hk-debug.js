(function attachHKDebug(root) {
  const DEBUG_PARAM = "unshackleDebug";
  let enabled = false;

  function hasQueryFlag(customSearch) {
    try {
      const search =
        typeof customSearch === "string"
          ? customSearch
          : (root.location && root.location.search) || "";
      if (!search) {
        return false;
      }
      const params = new URLSearchParams(search);
      return params.get(DEBUG_PARAM) === "1";
    } catch (_) {
      return false;
    }
  }

  function setEnabled(flag) {
    enabled = Boolean(flag);
  }

  function syncFromSettings(settings) {
    const devFlag =
      settings &&
      settings.dev &&
      Object.prototype.hasOwnProperty.call(settings.dev, "hkDebug")
        ? Boolean(settings.dev.hkDebug)
        : false;
    setEnabled(devFlag || hasQueryFlag());
  }

  function group(label, logFn) {
    if (!enabled) {
      return;
    }
    const prefix = label && label.startsWith("[HK]")
      ? label
      : `[HK] ${label || "debug"}`;
    console.groupCollapsed(prefix);
    try {
      if (typeof logFn === "function") {
        logFn();
      }
    } finally {
      console.groupEnd();
    }
  }

  function log(...args) {
    if (!enabled) {
      return;
    }
    console.log("[HK]", ...args);
  }

  root.UnshackleHKDebug = {
    isEnabled: () => enabled,
    setEnabled,
    syncFromSettings,
    hasQueryFlag,
    group,
    log
  };
})(typeof self !== "undefined" ? self : globalThis);
