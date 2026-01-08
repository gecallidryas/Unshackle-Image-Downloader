// Injected into the page context (not the content script world).
// Captures blob bytes when URL.createObjectURL is called and reports via
// window.postMessage using structured clone of the ArrayBuffer.
// Also hooks canvas methods for comprehensive image capture.
(function () {
  try { if (window.__blobPatchInstalled) return; window.__blobPatchInstalled = true; } catch (_) { return; }

  const post = (p, tr) => {
    try {
      window.postMessage(Object.assign({ __blobBridge: true }, p), '*', tr);
    } catch (_) { }
  };

  // Safely copy buffer before transfer to avoid detachment issues
  // Returns null if copy fails to prevent page breakage from buffer detachment
  const copyBuffer = (buf) => {
    if (!buf || !(buf instanceof ArrayBuffer)) return null;
    try {
      return buf.slice(0);
    } catch (e) {
      // Cannot copy - don't return original as it would get detached on transfer
      return null;
    }
  };

  // Hook URL.createObjectURL
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    const url = origCreate.apply(this, arguments);
    try {
      const mime = (blob && blob.type) || 'application/octet-stream';
      const size = (blob && blob.size) || 0;
      if (blob && blob.arrayBuffer) {
        blob.arrayBuffer().then((buf) => {
          const copy = copyBuffer(buf);
          if (copy) {
            post({ kind: 'createObjectURL', url, mime, size, buffer: copy }, [copy]);
          }
        }).catch(() => { });
      }
    } catch { }
    return url;
  };

  // Hook URL.revokeObjectURL
  const origRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = function (url) {
    try { post({ kind: 'revokeObjectURL', url: String(url || '') }); } catch { }
    return origRevoke.apply(this, arguments);
  };

  // Hook HTMLCanvasElement.toBlob - capture canvas as blob
  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    const canvas = this;
    const wrappedCallback = function (blob) {
      try {
        if (blob && blob.arrayBuffer) {
          const mime = blob.type || type || 'image/png';
          const url = origCreate(blob);
          blob.arrayBuffer().then((buf) => {
            const copy = copyBuffer(buf);
            if (copy) {
              post({ kind: 'canvasBlob', url, mime, size: copy.byteLength, buffer: copy, source: 'toBlob' }, [copy]);
            }
          }).catch(() => { });
        }
      } catch { }
      if (callback) callback(blob);
    };
    try {
      return origToBlob.call(canvas, wrappedCallback, type, quality);
    } catch (err) {
      // Canvas may be tainted (cross-origin) - try calling original with plain callback
      try {
        return origToBlob.call(canvas, callback, type, quality);
      } catch {
        // Still failed - call callback with null
        if (callback) callback(null);
        return undefined;
      }
    }
  };

  // Hook HTMLCanvasElement.toDataURL - capture canvas as data URL
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
    try {
      const result = origToDataURL.call(this, type, quality);
      try {
        if (result && result.startsWith('data:image/')) {
          post({ kind: 'canvasDataURL', dataUrl: result, mime: type || 'image/png', source: 'toDataURL' });
        }
      } catch { }
      return result;
    } catch (err) {
      // Canvas may be tainted (cross-origin) - call original and let it throw naturally
      return origToDataURL.call(this, type, quality);
    }
  };

  // Hook fetch for blob responses (when fetching images as blob)
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      const ct = response.headers?.get?.('content-type') || '';
      if (ct.startsWith('image/') && response.ok) {
        // Clone response to not consume the body
        const clone = response.clone();
        clone.blob().then(blob => {
          if (blob && blob.arrayBuffer) {
            blob.arrayBuffer().then(buf => {
              const copy = copyBuffer(buf);
              if (copy) {
                post({ kind: 'fetchBlob', url, mime: blob.type || ct, size: copy.byteLength, buffer: copy }, [copy]);
              }
            }).catch(() => { });
          }
        }).catch(() => { });
      }
    } catch { }
    return response;
  };

})();

