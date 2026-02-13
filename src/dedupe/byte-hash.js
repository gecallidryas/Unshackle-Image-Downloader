/**
 * Layer 1: Exact Byte Hash
 * 
 * Computes SHA-256 hash of raw image bytes for exact-match deduplication.
 * Zero false positives - only marks duplicates when bytes are identical.
 */

// ==================== SHA-256 HASHING ====================

function ensureNotAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
}

/**
 * Compute SHA-256 hash of an ArrayBuffer
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>} Hex string
 */
async function sha256Hex(arrayBuffer) {
    const hashBuf = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const bytes = new Uint8Array(hashBuf);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ==================== URL HANDLING ====================

/**
 * Decode data: URL to bytes
 * Handles both base64 and URL-encoded forms
 * @param {string} dataUrl
 * @returns {{bytes: ArrayBuffer, contentType: string}|null}
 */
function decodeDataUrl(dataUrl) {
    try {
        // Parse data URL: data:[<mediatype>][;base64],<data>
        const match = dataUrl.match(/^data:([^;,]*)(;base64)?,(.*)$/);
        if (!match) return null;

        const [, contentType = "application/octet-stream", isBase64, data] = match;

        let bytes;
        if (isBase64) {
            // Base64 encoded
            const binaryStr = atob(data);
            const len = binaryStr.length;
            const arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                arr[i] = binaryStr.charCodeAt(i);
            }
            bytes = arr.buffer;
        } else {
            // URL encoded
            const decoded = decodeURIComponent(data);
            const encoder = new TextEncoder();
            bytes = encoder.encode(decoded).buffer;
        }

        return { bytes, contentType };
    } catch (e) {
        console.warn("[ByteHash] Failed to decode data URL:", e.message);
        return null;
    }
}

/**
 * Check if URL is a data: URL
 * @param {string} url
 * @returns {boolean}
 */
function isDataUrl(url) {
    return typeof url === "string" && url.startsWith("data:");
}

/**
 * Check if URL is a blob: URL
 * @param {string} url
 * @returns {boolean}
 */
function isBlobUrl(url) {
    return typeof url === "string" && url.startsWith("blob:");
}

function createTaggedError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
}

function isImageContentType(contentType = "") {
    const mime = String(contentType || "").toLowerCase().split(";")[0].trim();
    return mime.startsWith("image/") || mime.includes("svg+xml");
}

function sniffImageMime(arrayBuffer) {
    try {
        const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
        if (!bytes.length) return "";
        const head = bytes.slice(0, Math.min(bytes.length, 512));
        const startsWith = (...sig) => sig.every((v, i) => head[i] === v);
        if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
        if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
        if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
        if (startsWith(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
        if (startsWith(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
        if (startsWith(0x42, 0x4d)) return "image/bmp";
        const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
        if (/<svg[\s>]/i.test(text)) return "image/svg+xml";
    } catch { }
    return "";
}

function resolveImageMime(contentType, bytes, url = "") {
    const type = String(contentType || "").split(";")[0].trim().toLowerCase();
    if (isImageContentType(type)) {
        return type || sniffImageMime(bytes);
    }
    if (typeof url === "string" && url.startsWith("data:image/")) {
        return type || sniffImageMime(bytes);
    }
    const sniffed = sniffImageMime(bytes);
    return isImageContentType(sniffed) ? sniffed : "";
}

async function canDecodeAsImage(bytes, mimeHint = "") {
    if (typeof createImageBitmap !== "function") {
        // In environments without createImageBitmap, avoid false negatives.
        return true;
    }
    let bitmap = null;
    try {
        const blob = new Blob([bytes], { type: mimeHint || "application/octet-stream" });
        bitmap = await createImageBitmap(blob);
        return true;
    } catch {
        return false;
    } finally {
        try { bitmap?.close?.(); } catch { }
    }
}

// ==================== BYTE FETCHING ====================

/**
 * Fetch image bytes from URL
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.referrer] - Page URL for hotlink protection
 * @param {string} [options.cacheMode="force-cache"]
 * @param {number} [options.timeoutMs=20000]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{bytes: ArrayBuffer, contentType: string}>}
 */
async function fetchBytes(url, { referrer, cacheMode = "force-cache", timeoutMs = 20000, signal } = {}) {
    // Handle data: URLs directly
    if (isDataUrl(url)) {
        const result = decodeDataUrl(url);
        if (!result) throw new Error("Invalid data URL");
        return result;
    }

    // blob: URLs must be handled in content script context
    if (isBlobUrl(url)) {
        throw new Error("BLOB_URL_REQUIRES_CONTENT_SCRIPT");
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Link to external signal if provided
    if (signal) {
        signal.addEventListener("abort", () => controller.abort());
    }

    try {
        const fetchOptions = {
            cache: cacheMode,
            credentials: "include",
            signal: controller.signal
        };

        // Add referrer if provided (helps with hotlink protection)
        if (referrer) {
            fetchOptions.referrer = referrer;
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            throw new Error(`HTTP_${response.status}`);
        }

        const bytes = await response.arrayBuffer();
        const contentType = response.headers.get("content-type") || "application/octet-stream";

        return { bytes, contentType };

    } finally {
        clearTimeout(timeoutId);
    }
}

// ==================== L1 PIPELINE ====================

/**
 * Process a single URL through Layer 1 (byte hash)
 * @param {Object} params
 * @param {string} params.url
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {object} params.context
 * @param {string} [params.imageId]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>} Result with status, sha256, etc.
 */
async function processL1(params) {
    const { url, scanId, tabId, pageUrl, context, signal, imageId } = params;

    try {
        ensureNotAborted(signal);
        // Fetch bytes
        const { bytes, contentType } = await fetchBytes(url, {
            referrer: pageUrl,
            signal
        });
        ensureNotAborted(signal);

        const imageMime = resolveImageMime(contentType, bytes, url);
        if (!imageMime) {
            throw createTaggedError("NON_IMAGE_RESOURCE", "Fetched resource is not an image");
        }

        // Compute SHA-256
        const sha256 = await sha256Hex(bytes);

        const canonical = {
            sha256,
            byteLength: bytes.byteLength,
            contentType: imageMime || contentType || "application/octet-stream",
            firstSeenAt: Date.now(),
            representative: { url, tabId, pageUrl },
            representativeImageId: imageId || null
        };
        let canonicalState = null;
        if (typeof globalThis.DedupeDB.ensureByteCanonical === "function") {
            canonicalState = await globalThis.DedupeDB.ensureByteCanonical({
                sha256,
                canonical,
                representativeImageId: imageId || null
            });
        } else {
            const existing = await globalThis.DedupeDB.getByteCanonical(sha256);
            if (existing) {
                if (!existing.representativeImageId && imageId) {
                    await globalThis.DedupeDB.putByteCanonical({
                        ...existing,
                        representativeImageId: imageId
                    });
                }
                canonicalState = { status: "DUP", record: existing };
            } else {
                await globalThis.DedupeDB.putByteCanonical(canonical);
                canonicalState = { status: "NEW", record: canonical };
            }
        }

        await globalThis.DedupeDB.addOccurrence({
            scanId,
            sha256,
            pixelHash: null,
            imageId: imageId || null,
            url,
            pageUrl,
            tabId,
            foundAt: Date.now(),
            context
        });

        const isDup = canonicalState?.status === "DUP";
        await globalThis.DedupeDB.updateScanStats(scanId, isDup ? { l1Dup: 1 } : { l1New: 1 });

        return {
            status: isDup ? "DUP" : "NEW",
            sha256,
            canonicalId: sha256,
            representativeImageId: canonicalState?.record?.representativeImageId || imageId || null,
            byteLength: bytes.byteLength,
            contentType: imageMime || contentType,
            bytes // Pass bytes for L2 processing
        };
    } catch (error) {
        // Handle specific error types
        if (error.message === "BLOB_URL_REQUIRES_CONTENT_SCRIPT") {
            return {
                status: "NEEDS_CONTENT_SCRIPT",
                url,
                error: error.message
            };
        }

        await globalThis.DedupeDB.updateScanStats(scanId, { errors: 1 });

        let errorCode = "FETCH_FAILED";
        if (error.message?.startsWith("HTTP_")) {
            errorCode = "HTTP_ERROR";
        } else if (error.name === "AbortError") {
            errorCode = "TIMEOUT";
        } else if (error?.code === "NON_IMAGE_RESOURCE") {
            errorCode = "NON_IMAGE_RESOURCE";
        }

        return {
            status: "ERROR",
            url,
            errorCode,
            error: error.message
        };
    }
}

/**
 * Process bytes directly (for blob: URLs fetched by content script)
 * @param {Object} params
 * @param {ArrayBuffer} params.bytes
 * @param {string} params.url - Original blob: URL
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {object} params.context
 * @param {string} [params.imageId]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
async function processL1Bytes(params) {
    const { bytes, url, scanId, tabId, pageUrl, context, imageId, signal } = params;

    try {
        ensureNotAborted(signal);
        let imageMime = resolveImageMime("", bytes, url);
        if (!imageMime) {
            const decodable = await canDecodeAsImage(bytes, "");
            if (!decodable) {
                throw createTaggedError("NON_IMAGE_RESOURCE", "Fetched blob bytes are not an image");
            }
            // Keep a generic image type when decode succeeds but signature sniffing is unknown.
            imageMime = "image/*";
        }
        // Compute SHA-256
        const sha256 = await sha256Hex(bytes);

        const canonical = {
            sha256,
            byteLength: bytes.byteLength,
            contentType: imageMime || "application/octet-stream",
            firstSeenAt: Date.now(),
            representative: { url, tabId, pageUrl },
            representativeImageId: imageId || null
        };
        let canonicalState = null;
        if (typeof globalThis.DedupeDB.ensureByteCanonical === "function") {
            canonicalState = await globalThis.DedupeDB.ensureByteCanonical({
                sha256,
                canonical,
                representativeImageId: imageId || null
            });
        } else {
            const existing = await globalThis.DedupeDB.getByteCanonical(sha256);
            if (existing) {
                if (!existing.representativeImageId && imageId) {
                    await globalThis.DedupeDB.putByteCanonical({
                        ...existing,
                        representativeImageId: imageId
                    });
                }
                canonicalState = { status: "DUP", record: existing };
            } else {
                await globalThis.DedupeDB.putByteCanonical(canonical);
                canonicalState = { status: "NEW", record: canonical };
            }
        }

        await globalThis.DedupeDB.addOccurrence({
            scanId,
            sha256,
            pixelHash: null,
            imageId: imageId || null,
            url,
            pageUrl,
            tabId,
            foundAt: Date.now(),
            context
        });

        const isDup = canonicalState?.status === "DUP";
        await globalThis.DedupeDB.updateScanStats(scanId, isDup ? { l1Dup: 1 } : { l1New: 1 });

        return {
            status: isDup ? "DUP" : "NEW",
            sha256,
            canonicalId: sha256,
            representativeImageId: canonicalState?.record?.representativeImageId || imageId || null,
            byteLength: bytes.byteLength,
            bytes
        };

    } catch (error) {
        await globalThis.DedupeDB.updateScanStats(scanId, { errors: 1 });

        return {
            status: "ERROR",
            url,
            errorCode: error?.code === "NON_IMAGE_RESOURCE" ? "NON_IMAGE_RESOURCE" : "HASH_FAILED",
            error: error.message
        };
    }
}

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupeByteHash = {
        sha256Hex,
        decodeDataUrl,
        isDataUrl,
        isBlobUrl,
        fetchBytes,
        processL1,
        processL1Bytes
    };
}
