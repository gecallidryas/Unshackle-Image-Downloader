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

        // Compute SHA-256
        const sha256 = await sha256Hex(bytes);

        // Check if canonical exists
        const existing = await globalThis.DedupeDB.getByteCanonical(sha256);

        if (existing) {
            if (!existing.representativeImageId && imageId) {
                await globalThis.DedupeDB.putByteCanonical({
                    ...existing,
                    representativeImageId: imageId
                });
            }
            // DUPLICATE - add occurrence
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

            await globalThis.DedupeDB.updateScanStats(scanId, { l1Dup: 1 });

            return {
                status: "DUP",
                sha256,
                canonicalId: sha256,
                representativeImageId: existing.representativeImageId || imageId || null,
                byteLength: bytes.byteLength,
                contentType,
                bytes // Pass bytes for L2 processing
            };
        }

        // NEW - create canonical
        const canonical = {
            sha256,
            byteLength: bytes.byteLength,
            contentType,
            firstSeenAt: Date.now(),
            representative: { url, tabId, pageUrl },
            representativeImageId: imageId || null
        };

        await globalThis.DedupeDB.putByteCanonical(canonical);

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

        await globalThis.DedupeDB.updateScanStats(scanId, { l1New: 1 });

        return {
            status: "NEW",
            sha256,
            canonicalId: sha256,
            representativeImageId: imageId || null,
            byteLength: bytes.byteLength,
            contentType,
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
        // Compute SHA-256
        const sha256 = await sha256Hex(bytes);

        // Check if canonical exists
        const existing = await globalThis.DedupeDB.getByteCanonical(sha256);

        if (existing) {
            if (!existing.representativeImageId && imageId) {
                await globalThis.DedupeDB.putByteCanonical({
                    ...existing,
                    representativeImageId: imageId
                });
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

            await globalThis.DedupeDB.updateScanStats(scanId, { l1Dup: 1 });

            return {
                status: "DUP",
                sha256,
                canonicalId: sha256,
                representativeImageId: existing.representativeImageId || imageId || null,
                byteLength: bytes.byteLength,
                bytes
            };
        }

        // NEW
        const canonical = {
            sha256,
            byteLength: bytes.byteLength,
            contentType: "application/octet-stream",
            firstSeenAt: Date.now(),
            representative: { url, tabId, pageUrl },
            representativeImageId: imageId || null
        };

        await globalThis.DedupeDB.putByteCanonical(canonical);

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

        await globalThis.DedupeDB.updateScanStats(scanId, { l1New: 1 });

        return {
            status: "NEW",
            sha256,
            canonicalId: sha256,
            representativeImageId: imageId || null,
            byteLength: bytes.byteLength,
            bytes
        };

    } catch (error) {
        await globalThis.DedupeDB.updateScanStats(scanId, { errors: 1 });

        return {
            status: "ERROR",
            url,
            errorCode: "HASH_FAILED",
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
