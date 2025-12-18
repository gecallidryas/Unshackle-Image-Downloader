const DEFAULT_TIMEOUT_MS = 15000;

function createTimeout(timeoutMs, reject) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return null;
  }
  return setTimeout(() => {
    reject(new Error("Runtime request timed out."));
  }, timeoutMs);
}

export function sendRuntimeRequest(message, { timeout = DEFAULT_TIMEOUT_MS, requireOk = true } = {}) {
  if (!chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("chrome.runtime.sendMessage is not available."));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    };
    const timer = createTimeout(timeout, (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    chrome.runtime.sendMessage(message, (response) => {
      if (settled) {
        cleanup(timer);
        return;
      }
      settled = true;
      cleanup(timer);
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      if (requireOk && response && response.ok === false) {
        reject(new Error(response.error || "Runtime request failed."));
        return;
      }
      resolve(response);
    });
  });
}
