/* eslint-disable no-undef */
importScripts('jszip.min.js');

self.onmessage = async (event) => {
  const { id, files } = event.data || {};
  if (id == null) return;
  try {
    const zip = new JSZip();
    (files || []).forEach((file) => {
      if (!file || !file.filename || !file.buffer) return;
      zip.file(file.filename, file.buffer);
    });
    let lastEmit = -1;
    const out = await zip.generateAsync(
      { type: 'arraybuffer', streamFiles: true },
      (metadata) => {
        if (!metadata) return;
        const pct = typeof metadata.percent === "number" ? metadata.percent : 0;
        if (pct === 100 || pct - lastEmit >= 3) {
          lastEmit = pct;
          self.postMessage({ id, progress: pct, currentFile: metadata.currentFile || null });
        }
      }
    );
    self.postMessage({ id, ok: true, buffer: out }, [out]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err) });
  }
};
