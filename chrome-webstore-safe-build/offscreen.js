(() => {
  const GRID_DIV = 4;
  const PIX_MUL = 8;

  function makeCanvas(width, height) {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      return { canvas, ctx };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    return { canvas, ctx };
  }

  function detectTileGrid(width, height, metadata) {
    const declared = Number.isFinite(metadata?.tileDiv) ? Math.round(metadata.tileDiv) : null;
    if (declared && declared > 0) return declared;
    const tileCount = Array.isArray(metadata?.tiles) ? metadata.tiles.length : null;
    if (Number.isFinite(tileCount) && tileCount > 0) {
      const root = Math.round(Math.sqrt(tileCount));
      if (root > 0 && root * root === tileCount) {
        return root;
      }
    }
    const candidates = [4, 5, 6, 3, 2];
    for (const div of candidates) {
      if (width % (div * PIX_MUL) === 0 && height % (div * PIX_MUL) === 0) {
        return div;
      }
    }
    return GRID_DIV;
  }

  function computeTileGeometry(width, height, div) {
    const clamp = (value) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : 1;
    };
    const quantize = (value) => {
      const safe = clamp(value);
      let q = Math.floor(safe / (div * PIX_MUL)) * PIX_MUL;
      if (q <= 0) {
        q = Math.floor(safe / div);
      }
      if (q <= 0) {
        q = safe;
      }
      return Math.max(1, q);
    };
    const colW = quantize(width);
    const rowH = quantize(height);
    const canvasWidth = Math.max(1, colW * div);
    const canvasHeight = Math.max(1, rowH * div);
    return {
      colW,
      rowH,
      canvasWidth,
      canvasHeight,
      div
    };
  }

  async function normalizeTiledImage(buffer, mime = "image/jpeg", metadata = null) {
    const array = buffer instanceof Uint8Array
      ? buffer
      : new Uint8Array(buffer);
    const blob = new Blob([array], { type: mime });
    const bitmap = await createImageBitmap(blob);

    const scrambleMode = (metadata?.scramble || "").toLowerCase();
    const transposeTiles = scrambleMode === "baku";
    if (!transposeTiles) {
      if (typeof bitmap.close === "function") {
        try { bitmap.close(); } catch (e) { void e; }
      }
      return array;
    }

    const widthHint = Number.isFinite(metadata?.width) ? metadata.width : null;
    const heightHint = Number.isFinite(metadata?.height) ? metadata.height : null;
    const baseWidth = widthHint && widthHint > 0 ? widthHint : bitmap.width;
    const baseHeight = heightHint && heightHint > 0 ? heightHint : bitmap.height;
    const div = detectTileGrid(baseWidth, baseHeight, metadata || {});
    const geometry = computeTileGeometry(baseWidth, baseHeight, div);
    const { canvas, ctx } = makeCanvas(geometry.canvasWidth, geometry.canvasHeight);
    if (!ctx) {
      if (typeof bitmap.close === "function") {
        try { bitmap.close(); } catch (e) { void e; }
      }
      throw new Error("Failed to acquire 2D context");
    }
    ctx.imageSmoothingEnabled = false;

    for (let sy = 0; sy < div; sy++) {
      for (let sx = 0; sx < div; sx++) {
        const srcX = sx * geometry.colW;
        const srcY = sy * geometry.rowH;
        const destRow = transposeTiles ? sx : sy;
        const destCol = transposeTiles ? sy : sx;
        const dstX = destCol * geometry.colW;
        const dstY = destRow * geometry.rowH;
        const drawW = Math.min(geometry.colW, bitmap.width - srcX);
        const drawH = Math.min(geometry.rowH, bitmap.height - srcY);
        const destW = Math.min(geometry.colW, geometry.canvasWidth - dstX);
        const destH = Math.min(geometry.rowH, geometry.canvasHeight - dstY);
        if (drawW <= 0 || drawH <= 0 || destW <= 0 || destH <= 0) continue;
        ctx.drawImage(bitmap, srcX, srcY, drawW, drawH, dstX, dstY, destW, destH);
      }
    }

    if (typeof bitmap.close === "function") {
      try { bitmap.close(); } catch (e) { void e; }
    }

    if (canvas.convertToBlob) {
      const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      const outBuffer = await outBlob.arrayBuffer();
      return new Uint8Array(outBuffer);
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1] || "";
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== "offscreenNormalize") {
      return;
    }
    (async () => {
      try {
        const mimeType = typeof message.mimeType === "string" && message.mimeType
          ? message.mimeType
          : "image/jpeg";
        const result = await normalizeTiledImage(message.buffer, mimeType, message.metadata || null);
        sendResponse({ ok: true, data: result.buffer });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  });
})();
