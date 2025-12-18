(() => {
  const root = typeof self !== "undefined" ? self : window;
  const REGISTRY_KEY = "__UnshackleSiteRegistry__";

  const CONNECTOR_MAP = [
    { id: "gigaviewer", modules: ["gigaviewer"] },
    // CoreView/GigaViewer single-site connectors frequently regress to scrambled output
    // if they bypass the gigaviewer site module. Keep them hard-mapped here so they
    // always hit the descrambler even if future changes shuffle connector metadata.
    { id: "comicaction", modules: ["gigaviewer"] },
    { id: "coreview.comicaction", modules: ["gigaviewer"] },
    { id: "comicdays", modules: ["gigaviewer"] },
    { id: "coreview.comicdays", modules: ["gigaviewer"] },
    { id: "comicearthstar", modules: ["gigaviewer"] },
    { id: "coreview.comicearthstar", modules: ["gigaviewer"] },
    { id: "speedbinb", modules: ["speedbinb"] },
    { id: "madara", modules: ["madara"] },
    { id: "mangastream", modules: ["mangastream"] },
    { id: "foolslide", modules: ["foolslide"] }
  ];

  function getRegistry() {
    const registry = root[REGISTRY_KEY] || root.UnshackleSites || null;
    if (registry && (typeof registry.get === "function" || registry.modules)) {
      return registry;
    }
    return null;
  }

  function getRegistryModule(id) {
    if (!id) return null;
    const registry = getRegistry();
    if (!registry) {
      return null;
    }
    if (typeof registry.get === "function") {
      return registry.get(id);
    }
    if (registry.modules && registry.modules[id]) {
      return registry.modules[id];
    }
    return null;
  }

  function ensureModuleRegistered(id) {
    const mod = getRegistryModule(id);
    if (!mod) {
      throw new Error(`Registry module '${id}' is not available.`);
    }
    return mod;
  }

  function getConnectorModules(connectorId) {
    const entry = CONNECTOR_MAP.find((item) => item.id === connectorId);
    if (!entry) {
      return [];
    }
    return entry.modules.map(ensureModuleRegistered);
  }

  root.HKRegistryBridge = {
    getConnectorModules
  };
})();
