(() => {
  const globalKey = "__UnshackleSiteRegistry__";
  const root = typeof self !== "undefined" ? self : window;
  if (root[globalKey]) {
    if (Array.isArray(root.__UnshacklePendingSiteModules__)) {
      const existing = root[globalKey];
      while (root.__UnshacklePendingSiteModules__.length) {
        const mod = root.__UnshacklePendingSiteModules__.shift();
        try {
          existing.register(mod);
        } catch (error) {
          console.warn("[Sites] Failed to register pending module", mod?.id, error);
        }
      }
    }
    return;
  }

  const registry = {
    modules: {},
    register(mod) {
      if (!mod || !mod.id) return;
      this.modules[mod.id] = mod;
      return mod;
    },
    get(id) {
      return id ? this.modules[id] || null : null;
    },
    list() {
      return Object.values(this.modules);
    }
  };

  Object.defineProperty(root, globalKey, { value: registry, writable: false });
  root.UnshackleSites = registry;
  const pending = root.__UnshacklePendingSiteModules__;
  if (Array.isArray(pending) && pending.length) {
    while (pending.length) {
      const mod = pending.shift();
      try {
        registry.register(mod);
      } catch (error) {
        console.warn("[Sites] Failed to register pending module", mod?.id, error);
      }
    }
  }
  delete root.__UnshacklePendingSiteModules__;
})();
