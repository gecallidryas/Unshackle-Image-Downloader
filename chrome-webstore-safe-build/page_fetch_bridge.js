// Injected into the page world to proxy fetch requests with page credentials.
(function () {
  try {
    if (window.__UNSHACKLE_PAGE_FETCH_BRIDGE__) return;
    window.__UNSHACKLE_PAGE_FETCH_BRIDGE__ = true;
  } catch (err) {
    return;
  }

  const REQUEST_TOKEN = "__UNSHACKLE_PAGE_FETCH_REQUEST__";
  const RESPONSE_TOKEN = "__UNSHACKLE_PAGE_FETCH_RESPONSE__";
  const ALLOWED_INIT_KEYS = [
    "method",
    "mode",
    "cache",
    "credentials",
    "redirect",
    "referrer",
    "referrerPolicy",
    "integrity",
    "keepalive"
  ];

  function rebuildInit(serialized) {
    if (!serialized || typeof serialized !== "object") return {};
    const init = {};
    for (const key of ALLOWED_INIT_KEYS) {
      if (key in serialized) {
        init[key] = serialized[key];
      }
    }
    if (serialized.headers && typeof serialized.headers === "object") {
      const headers = new Headers();
      for (const [name, value] of Object.entries(serialized.headers)) {
        if (typeof name === "string" && value != null) {
          headers.append(name, String(value));
        }
      }
      if ([...headers.keys()].length) {
        init.headers = headers;
      }
    }
    if (serialized.body != null) {
      if (typeof serialized.body === "string") {
        init.body = serialized.body;
      } else if (serialized.body instanceof ArrayBuffer) {
        init.body = serialized.body;
      } else if (ArrayBuffer.isView(serialized.body)) {
        const view = serialized.body;
        init.body = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      }
    }
    return init;
  }

  function postResponse(payload, transfer) {
    try {
      window.postMessage(payload, "*", transfer || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Unshackle page fetch bridge failed to post response:", err);
    }
  }

  async function handleFetchRequest(event) {
    const data = event?.data;
    if (!data || data.__unshackleFetch !== REQUEST_TOKEN) return;
    if (event.source !== window) return;
    const requestId = data.requestId;
    const url = typeof data.url === "string" ? data.url : "";
    if (!requestId || !url) return;

    const responseBase = {
      __unshackleFetch: RESPONSE_TOKEN,
      requestId
    };

    try {
      const init = rebuildInit(data.init);
      const res = await fetch(url, init);
      const buffer = await res.arrayBuffer();
      const headers = [];
      res.headers.forEach((value, key) => {
        headers.push([key, value]);
      });
      const payload = {
        ...responseBase,
        ok: true,
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        headers,
        body: buffer
      };
      postResponse(payload, [buffer]);
    } catch (error) {
      postResponse({
        ...responseBase,
        ok: false,
        error: String(error?.message || error)
      });
    }
  }

  window.addEventListener("message", handleFetchRequest, false);
  try {
    const readyTarget = document.documentElement || document.body || document.head;
    if (readyTarget) {
      readyTarget.setAttribute("data-unshackle-page-fetch-ready", "1");
    }
  } catch {}
  try {
    window.postMessage({ __unshackleFetch: "__UNSHACKLE_PAGE_FETCH_READY__", ready: true }, "*");
  } catch {}
})();
