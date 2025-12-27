(function initHKConnectorAliases(global) {
  if (global && global.canonicalHKConnectorId) {
    return;
  }

  const HK_CANONICAL_CONNECTORS = Object.freeze({
    booklive: {
      label: "BookLive",
      nativeId: "booklive",
      delegateId: "speedbinb.booklive",
      aliases: ["speedbinb.booklive"]
    },
    comicaction: {
      label: "Comic Action",
      nativeId: "comicaction",
      delegateId: "coreview.comicaction",
      aliases: ["coreview.comicaction"]
    }
  });

  const HK_CONNECTOR_ALIAS_LOOKUP = Object.create(null);
  Object.entries(HK_CANONICAL_CONNECTORS).forEach(([canonicalId, meta]) => {
    if (!canonicalId) {
      return;
    }
    HK_CONNECTOR_ALIAS_LOOKUP[canonicalId] = canonicalId;
    const variants = new Set([canonicalId, meta.nativeId, meta.delegateId, ...(meta.aliases || [])].filter(Boolean));
    variants.forEach((alias) => {
      HK_CONNECTOR_ALIAS_LOOKUP[alias] = canonicalId;
    });
  });

  function canonicalHKConnectorId(value) {
    if (typeof value !== "string") {
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }
    return HK_CONNECTOR_ALIAS_LOOKUP[trimmed] || trimmed;
  }

  function getHKConnectorMeta(value) {
    const canonical = canonicalHKConnectorId(value);
    if (!canonical) {
      return null;
    }
    return HK_CANONICAL_CONNECTORS[canonical] || null;
  }

  function getPreferredHKConnectorId(value, preference = "native") {
    const meta = getHKConnectorMeta(value);
    if (!meta) {
      return canonicalHKConnectorId(value);
    }
    if (preference === "delegate" && meta.delegateId) {
      return meta.delegateId;
    }
    return meta.nativeId || canonicalHKConnectorId(value);
  }

  global.HK_CANONICAL_CONNECTORS = HK_CANONICAL_CONNECTORS;
  global.HK_CONNECTOR_ALIAS_LOOKUP = HK_CONNECTOR_ALIAS_LOOKUP;
  global.canonicalHKConnectorId = canonicalHKConnectorId;
  global.getHKConnectorMeta = getHKConnectorMeta;
  global.getPreferredHKConnectorId = getPreferredHKConnectorId;
})(typeof self !== "undefined" ? self : globalThis);
