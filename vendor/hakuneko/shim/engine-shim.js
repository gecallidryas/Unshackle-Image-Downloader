(function initHakuNekoEngineShim(root) {
  if (!root) {
    return;
  }

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function ensureUint8Array(value) {
    if (!value && value !== 0) {
      return new Uint8Array(0);
    }
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value && typeof value === "object" && value._bytes instanceof Uint8Array) {
      return value._bytes;
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (typeof value === "string") {
      return textEncoder.encode(value);
    }
    return new Uint8Array(0);
  }

  function wrapBytes(bytes) {
    const arr = ensureUint8Array(bytes);
    return {
      _bytes: arr,
      toString(encoder) {
        if (encoder && encoder === cryptoShim.enc.Base64) {
          return cryptoShim.enc.Base64.stringify(this);
        }
        return cryptoShim.enc.Utf8.stringify(this);
      }
    };
  }

  const cryptoShim = root.CryptoJS || {
    enc: {
      Utf8: {
        parse(str) {
          return wrapBytes(textEncoder.encode(String(str ?? "")));
        },
        stringify(wordArray) {
          return textDecoder.decode(ensureUint8Array(wordArray));
        }
      },
      Base64: {
        stringify(wordArray) {
          const bytes = ensureUint8Array(wordArray);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return btoa(binary);
        },
        parse(encoded) {
          const binary = atob(String(encoded ?? ""));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return wrapBytes(bytes);
        }
      }
    }
  };

  if (!root.CryptoJS) {
    root.CryptoJS = cryptoShim;
  }

  if (typeof root.Buffer === "undefined") {
    root.Buffer = {
      from(input) {
        if (typeof input === "string") {
          return textEncoder.encode(input);
        }
        return ensureUint8Array(input);
      }
    };
  }

  const engine = root.Engine || {};

  function withTimeout(promise, timeout, controller) {
    if (!timeout || timeout <= 0) {
      return promise;
    }
    let timer;
    const wrapped = Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (controller) {
            controller.abort();
          }
          reject(new Error("Engine.Request.fetchUI timeout"));
        }, timeout);
      })
    ]);
    return wrapped.finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  engine.Request = engine.Request || {};
  engine.Request.fetchUI = async function fetchUI(request, selector = "", timeout = 60000) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const init = ctrl ? { signal: ctrl.signal } : undefined;
    const exec = (async () => {
      let finalRequest;
      if (request instanceof Request) {
        finalRequest = request;
      } else if (request instanceof URL) {
        finalRequest = new Request(request.href);
      } else {
        finalRequest = new Request(String(request));
      }
      const response = await fetch(finalRequest, init);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text")) {
        return null;
      }
      const text = await response.text();
      if (!selector) {
        return text;
      }
      const doc = new DOMParser().parseFromString(text, "text/html");
      if (selector === "*") {
        return doc;
      }
      return Array.from(doc.querySelectorAll(selector));
    })();
    return withTimeout(exec, timeout, ctrl);
  };

  engine.Settings = engine.Settings || {
    recompressionFormat: { value: "image/jpeg" },
    recompressionQuality: { value: "92" }
  };

  function resolvedPromise(value) {
    return Promise.resolve(value);
  }

  engine.Storage = engine.Storage || {
    loadMangaList: () => resolvedPromise([]),
    saveMangaList: () => resolvedPromise(undefined),
    getExistingMangaTitles: () => resolvedPromise([]),
    getExistingChapterTitles: () => resolvedPromise([])
  };

  engine.Blacklist = engine.Blacklist || {
    isBlacklisted: () => false
  };

  root.Engine = engine;
})(typeof self !== "undefined" ? self : globalThis);
