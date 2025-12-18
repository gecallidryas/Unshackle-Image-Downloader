(function attachHKProxy(root) {
  if (!root || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }

  // Increased from 15000ms to 60000ms to handle manga with hundreds/thousands of chapters
  // Large series like One Piece (800+ chapters) need ~16s+ to fetch all chapters
  // due to MangaDex's 2s throttle between each 100-chapter API page
  const HK_PROXY_TIMEOUT_MS = 60000;

  async function maybeAttachCookies(payload) {
    const base = payload && typeof payload === "object" ? { ...payload } : {};
    if (base.cookies || !base.url || !chrome?.cookies?.getAll) {
      return base;
    }
    let parsed;
    try {
      parsed = new URL(base.url);
    } catch {
      return base;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return base;
    }
    const cookieList = await new Promise((resolve) => {
      chrome.cookies.getAll({ url: base.url }, (cookies) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve(null);
          return;
        }
        resolve(Array.isArray(cookies) ? cookies : []);
      });
    });
    if (!cookieList || !cookieList.length) {
      return base;
    }
    const header = cookieList
      .filter((entry) => typeof entry?.name === "string" && entry.name)
      .map((entry) => `${entry.name}=${typeof entry.value === "string" ? entry.value : ""}`)
      .filter(Boolean)
      .join("; ");
    if (!header) {
      return base;
    }
    return {
      ...base,
      cookies: {
        host: parsed.hostname.toLowerCase(),
        value: header,
        updatedAt: Date.now()
      }
    };
  }

  async function send(command, payload, options = {}) {
    const timeoutMs = Math.max(2000, Number(options.timeout) || HK_PROXY_TIMEOUT_MS);
    const enrichedPayload = await maybeAttachCookies(payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("HK request timed out"));
      }, timeoutMs);
      chrome.runtime.sendMessage(
        {
          type: "HK_RUN",
          command,
          payload: enrichedPayload
        },
        (response) => {
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message || String(err)));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "HK runner request failed."));
            return;
          }
          resolve(response.data);
        }
      );
    });
  }

  function buildProbePayload(input) {
    if (input && typeof input === "object") {
      return { ...input };
    }
    return { url: input };
  }

  const proxy = {
    probe(input, options = {}) {
      const payload = buildProbePayload(input);
      return send("probe", payload, options);
    },
    fetchManga(payload = {}, options = {}) {
      return send("manga", payload, options);
    },
    fetchPages(payload = {}, options = {}) {
      return send("pages", payload, options);
    },
    fetchCatalog(payload = {}, options = {}) {
      return send("catalog", payload, options);
    },
    fetchConnectorPayload(input, options = {}) {
      const payload = typeof input === "string" ? { url: input } : { ...(input || {}) };
      if (!payload.url) {
        return Promise.reject(new Error("Connector payload URL is required."));
      }
      return send("connectorPayload", payload, options);
    }
  };

  root.hkProxy = proxy;
})(typeof window !== "undefined" ? window : self);
