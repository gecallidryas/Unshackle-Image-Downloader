(() => {
  const root = typeof self !== "undefined" ? self : window;
  const registryKey = "__UnshackleSiteRegistry__";

  function getRegistry() {
    const registry = root[registryKey] || root.UnshackleSites;
    if (!registry || typeof registry.get !== "function") {
      throw new Error("Site registry is not available.");
    }
    return registry;
  }

  function getModule(moduleId) {
    if (!moduleId) {
      throw new Error("Missing module id.");
    }
    const registry = getRegistry();
    const module = registry.get(moduleId);
    if (!module) {
      throw new Error(`Module '${moduleId}' is not registered.`);
    }
    return module;
  }

  function toPlain(value) {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(toPlain);
    }
    if (value instanceof ArrayBuffer) {
      return null;
    }
    if (ArrayBuffer.isView(value)) {
      return null;
    }
    if (value && typeof value === "object") {
      const plain = {};
      for (const [key, entry] of Object.entries(value)) {
        plain[key] = toPlain(entry);
      }
      return plain;
    }
    return String(value);
  }

  function normalizePages(pages) {
    if (!Array.isArray(pages)) return [];
    return pages.map((page, index) => {
      if (typeof page === "string") {
        return { index, url: page };
      }
      if (page && typeof page === "object") {
        return {
          index,
          url: page.url || page.src || page.href || null,
          filename: page.filename || null,
          kind: page.kind || null,
          mimeType: page.mimeType || null
        };
      }
      return { index, url: null };
    });
  }

  async function callSiteMethod(moduleId, methodName, args = []) {
    const module = getModule(moduleId);
    const target = module && module[methodName];
    if (typeof target !== "function") {
      throw new Error(`Module '${moduleId}' does not expose '${methodName}'.`);
    }
    const result = await target.apply(module, Array.isArray(args) ? args : [args]);
    return toPlain(result);
  }

  async function callListPages(moduleId, args = []) {
    const module = getModule(moduleId);
    if (typeof module.listPages !== "function") {
      throw new Error(`Module '${moduleId}' does not implement listPages().`);
    }
    const raw = await module.listPages.apply(module, Array.isArray(args) ? args : [args]);
    return {
      moduleId,
      pages: normalizePages(raw)
    };
  }

  async function callListChapters(moduleId, args = []) {
    const module = getModule(moduleId);
    if (typeof module.listChapters !== "function") {
      throw new Error(`Module '${moduleId}' does not implement listChapters().`);
    }
    const raw = await module.listChapters.apply(module, Array.isArray(args) ? args : [args]);
    return toPlain(raw);
  }

  root.HKDelegates = {
    callSiteMethod,
    callListPages,
    callListChapters
  };
})();
