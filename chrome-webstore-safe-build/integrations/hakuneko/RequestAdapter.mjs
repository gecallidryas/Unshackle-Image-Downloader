const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_BACKOFF_MS = 1200;
const MAX_RETRIES = 2;
const PAGE_FETCH_ACTION = "HK_PAGE_FETCH";
const PAGE_FETCH_TIMEOUT_MS = 20000;

function toRequest(input, init) {
  if (input instanceof Request) {
    return input;
  }
  if (input instanceof URL) {
    return new Request(input.href, init);
  }
  if (typeof input === "string") {
    return new Request(input, init);
  }
  throw new Error("Unsupported request input for RequestAdapter.fetch()");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseUrl(value) {
  if (!value) {
    return null;
  }
  try {
    const url = value instanceof URL ? value : new URL(String(value));
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }
  } catch {
    return null;
  }
  return null;
}

function extractOrigin(value) {
  const parsed = tryParseUrl(value);
  return parsed ? parsed.origin : null;
}

function shouldUsePageBridge(urlString, context) {
  if (!context || !context.tabId || !context.origin) {
    return false;
  }
  const target = tryParseUrl(urlString);
  if (!target) {
    return false;
  }
  return target.origin === context.origin;
}

function serializeHeaders(headers) {
  const map = {};
  if (!headers) {
    return map;
  }
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      map[key] = value;
    });
    return map;
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!entry) continue;
      const [key, value] = entry;
      if (typeof key === "string" && value != null) {
        map[key] = value;
      }
    }
    return map;
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (value != null) {
        map[key] = value;
      }
    }
  }
  return map;
}

function cloneBodyBuffer(buffer) {
  if (!buffer) {
    return null;
  }
  if (buffer instanceof ArrayBuffer) {
    return buffer.slice(0);
  }
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return null;
}

async function captureRequestSnapshot(request) {
  if (!(request instanceof Request)) {
    throw new Error("Expected a Request instance.");
  }
  const method = (request.method || "GET").toUpperCase();
  const headers = serializeHeaders(request.headers);
  let body = null;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.arrayBuffer();
  }
  return {
    url: request.url,
    method,
    headers,
    mode: request.mode,
    cache: request.cache,
    redirect: request.redirect,
    credentials: request.credentials,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    body
  };
}

function buildRequestFromSnapshot(snapshot) {
  const body = cloneBodyBuffer(snapshot.body);
  const init = {
    method: snapshot.method,
    headers: snapshot.headers,
    mode: snapshot.mode,
    cache: snapshot.cache,
    redirect: snapshot.redirect,
    credentials: snapshot.credentials,
    referrer: snapshot.referrer,
    referrerPolicy: snapshot.referrerPolicy,
    integrity: snapshot.integrity,
    keepalive: snapshot.keepalive
  };
  if (body) {
    init.body = body;
  }
  return new Request(snapshot.url, init);
}

function normalizeContext(context = {}) {
  const tabId = Number.isInteger(context.tabId) ? context.tabId : null;
  const origin = extractOrigin(context.origin || context.url || null);
  const cookies = context?.cookies && typeof context.cookies === "object" ? context.cookies : null;
  return { tabId, origin, cookies };
}

function normalizeHost(value) {
  return String(value || "").trim().replace(/^\.+/, "").toLowerCase();
}

function isAbortError(error) {
  return error && (error.name === "AbortError" || error.code === DOMException.ABORT_ERR);
}

function createAbortError(signal) {
  if (signal?.reason) {
    return signal.reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}

function sendRuntimeMessage(message, signal) {
  if (!chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("chrome.runtime is not available."));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };
    const onAbort = () => {
      settled = true;
      cleanup();
      reject(createAbortError(signal));
    };
    if (signal) {
      if (signal.aborted) {
        reject(createAbortError(signal));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    chrome.runtime.sendMessage(message, (response) => {
      cleanup();
      if (settled) {
        return;
      }
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      if (!response) {
        reject(new Error("Page fetch bridge returned no response."));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error || "Page fetch bridge failed."));
        return;
      }
      resolve(response);
    });
  });
}

async function pageWorldFetchFromSnapshot(snapshot, context, signal) {
  let attempt = 0;
  const maxAttempts = 3;
  const backoffMs = 600;
  const payload = {
    action: PAGE_FETCH_ACTION,
    tabId: context?.tabId,
    url: snapshot.url,
    init: {
      method: snapshot.method,
      headers: snapshot.headers,
      mode: snapshot.mode,
      cache: snapshot.cache,
      redirect: snapshot.redirect,
      credentials: "include",
      referrer: snapshot.referrer,
      referrerPolicy: snapshot.referrerPolicy,
      integrity: snapshot.integrity,
      keepalive: snapshot.keepalive
    },
    body: snapshot.body,
    timeout: PAGE_FETCH_TIMEOUT_MS
  };
  while (attempt < maxAttempts) {
    try {
      let response;
      // If we are running in the background script, we can't use sendMessage to self.
      // Use the exposed global handler instead.
      if (typeof globalThis.hkHandlePageFetchRequest === "function") {
        response = await globalThis.hkHandlePageFetchRequest(payload);
      } else {
        response = await sendRuntimeMessage(payload, signal);
      }
      const normalizedHeaders = new Headers(response.headers || []);
      return new Response(response.body ? response.body : null, {
        status: response.status || 0,
        statusText: response.statusText || "",
        headers: normalizedHeaders
      });
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || isAbortError(error)) {
        throw error;
      }
      await wait(backoffMs * attempt);
    }
  }
}

async function performRequestFetch(request, context) {
  const signal = request?.signal;
  const snapshot = await captureRequestSnapshot(request);
  if (shouldUsePageBridge(snapshot.url, context)) {
    try {
      return await pageWorldFetchFromSnapshot(snapshot, context, signal);
    } catch (error) {
      console.warn("[HK] Page-world fetch failed, falling back to offscreen fetch", error);
    }
  }
  const fallbackRequest = buildRequestFromSnapshot(snapshot);
  const enriched = applyContextCookies(fallbackRequest, context);
  return fetch(enriched, { credentials: "include", signal });
}

function applyContextCookies(request, context) {
  const cookieValue = context?.cookies?.value;
  const cookieHost = normalizeHost(context?.cookies?.host);
  if (!cookieValue || !cookieHost) {
    return request;
  }
  const target = tryParseUrl(request.url);
  if (!target) {
    return request;
  }
  const targetHost = normalizeHost(target.hostname);
  if (!targetHost || (targetHost !== cookieHost && !targetHost.endsWith(`.${cookieHost}`))) {
    return request;
  }
  const headers = new Headers(request.headers || {});
  if (!headers.has("cookie")) {
    headers.set("cookie", cookieValue);
  }
  // Use the originating page as referer when possible to reduce CORS/cookie issues.
  const origin = extractOrigin(context?.origin || context?.url || null);
  if (origin && !headers.has("referer")) {
    headers.set("referer", origin);
  }
  return new Request(request, { headers });
}

async function fetchWithRetry(request, { retries = MAX_RETRIES, backoff = DEFAULT_RETRY_BACKOFF_MS, fetcher = (req) => fetch(req, { credentials: "include" }) } = {}) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const response = await fetcher(request.clone());
      if (!RETRY_STATUSES.has(response.status) || attempt === retries) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || attempt === retries) {
        throw lastError || error;
      }
    }
    attempt += 1;
    await wait(backoff * attempt);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error("RequestAdapter.fetch failed after retries.");
}

async function readText(response, encoding = "utf-8") {
  if (typeof response.text === "function") {
    return response.text();
  }
  const buffer = await response.arrayBuffer();
  return new TextDecoder(encoding || "utf-8").decode(buffer);
}

function createDOM(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

function evaluateUIScript(doc, script) {
  // Avoid CSP-violating dynamic code execution. Accept callable functions
  // so connectors can still perform DOM processing without eval/new Function.
  if (!script) {
    return doc;
  }
  if (typeof script === "function") {
    return script(doc);
  }
  // Legacy string scripts are skipped to stay CSP-safe.
  console.warn("[HK] RequestAdapter.fetchUI skipped string script (CSP-safe path)", {
    length: typeof script === "string" ? script.length : 0
  });
  return doc;
}

export default class RequestAdapter {
  static #contextStack = [normalizeContext()];

  static runWithContext(context = {}, executor) {
    const normalized = normalizeContext(context);
    RequestAdapter.#contextStack.push(normalized);
    let restored = false;
    const restore = () => {
      if (!restored) {
        restored = true;
        RequestAdapter.#contextStack.pop();
      }
    };
    try {
      const result = executor();
      if (result && typeof result.then === "function") {
        return result.finally(restore);
      }
      restore();
      return result;
    } catch (error) {
      restore();
      throw error;
    }
  }

  static getContext() {
    const stack = RequestAdapter.#contextStack;
    return stack.length ? stack[stack.length - 1] : normalizeContext();
  }

  static async fetch(input, init) {
    const request = toRequest(input, init);
    const context = RequestAdapter.getContext();
    return fetchWithRetry(request, {
      fetcher: (req) => performRequestFetch(req, context)
    });
  }

  static async fetchJSON(input, retries = 0) {
    try {
      const response = await this.fetch(input);
      if (!response.ok) {
        throw new Error(`RequestAdapter.fetchJSON failed (${response.status})`);
      }
      return response.json();
    } catch (error) {
      if (retries > 0) {
        await wait(DEFAULT_RETRY_BACKOFF_MS);
        return this.fetchJSON(input, retries - 1);
      }
      throw error;
    }
  }

  static async fetchDOM(input, selector, retries = 0, encoding = "utf-8") {
    try {
      const response = await this.fetch(input);
      if (!response.ok) {
        throw new Error(`fetchDOM failed with status ${response.status}`);
      }
      const html = await readText(response, encoding);
      const dom = createDOM(html);
      if (!selector) {
        return dom;
      }
      return Array.from(dom.querySelectorAll(selector));
    } catch (error) {
      if (retries > 0) {
        await wait(DEFAULT_RETRY_BACKOFF_MS);
        return this.fetchDOM(input, selector, retries - 1, encoding);
      }
      throw error;
    }
  }

  static async fetchUI(input, script = "", timeout = 60000) {
    let controller;
    let timerId = null;
    if (typeof AbortController === "function" && timeout > 0) {
      controller = new AbortController();
      timerId = setTimeout(() => {
        controller.abort();
      }, timeout);
    }
    try {
      const request = toRequest(input, controller ? { signal: controller.signal } : undefined);
      const context = RequestAdapter.getContext();
      const response = await fetchWithRetry(request, {
        fetcher: (req) => performRequestFetch(req, context)
      });
      if (!response.ok) {
        throw new Error(`fetchUI failed with status ${response.status}`);
      }
      const html = await readText(response);
      const doc = createDOM(html);
      return evaluateUIScript(doc, script);
    } finally {
      if (timerId != null) {
        clearTimeout(timerId);
      }
    }
  }
}
