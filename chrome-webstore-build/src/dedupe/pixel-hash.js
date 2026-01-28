/**
 * Layer 2: Canonical Pixel Hash
 * 
 * Decodes image to pixels, applies canonicalization (EXIF orientation, alpha),
 * and hashes the pixel buffer. Catches same-pixels-different-encoding duplicates.
 * 
 * Zero false positives when canonicalization is consistent.
 */

// ==================== CONSTANTS ====================

// Skip L2 for images with pixel count above this threshold (memory safety)
const MAX_PIXEL_COUNT = 8000 * 8000; // 64 megapixels

// EXIF orientation transformations
// Orientation values 1-8 per EXIF spec
const EXIF_TRANSFORMS = {
    1: { rotate: 0, flip: false },      // Normal
    2: { rotate: 0, flip: true },       // Flipped horizontally
    3: { rotate: 180, flip: false },    // Rotated 180
    4: { rotate: 180, flip: true },     // Flipped vertically
    5: { rotate: 90, flip: true },      // Rotated 90 CCW + flipped
    6: { rotate: 90, flip: false },     // Rotated 90 CW
    7: { rotate: 270, flip: true },     // Rotated 90 CW + flipped
    8: { rotate: 270, flip: false }     // Rotated 90 CCW
};

function ensureNotAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
}

// ==================== EXIF PARSING ====================

/**
 * Parse EXIF orientation from JPEG bytes
 * @param {ArrayBuffer} bytes
 * @returns {number} Orientation 1-8 (1 = normal)
 */
function parseExifOrientation(bytes) {
    try {
        const view = new DataView(bytes);

        // Check for JPEG SOI marker
        if (view.getUint16(0) !== 0xFFD8) return 1;

        let offset = 2;
        const length = bytes.byteLength;

        while (offset < length - 4) {
            const marker = view.getUint16(offset);

            // APP1 marker (EXIF)
            if (marker === 0xFFE1) {
                const segmentLength = view.getUint16(offset + 2);

                // Check for "Exif\0\0" signature
                if (view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0x0000) {
                    const tiffStart = offset + 10;

                    // Check byte order
                    const byteOrder = view.getUint16(tiffStart);
                    const littleEndian = byteOrder === 0x4949; // "II"

                    // Get IFD0 offset
                    const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
                    const ifdStart = tiffStart + ifdOffset;

                    // Number of directory entries
                    const numEntries = view.getUint16(ifdStart, littleEndian);

                    // Search for orientation tag (0x0112)
                    for (let i = 0; i < numEntries; i++) {
                        const entryOffset = ifdStart + 2 + (i * 12);
                        const tag = view.getUint16(entryOffset, littleEndian);

                        if (tag === 0x0112) {
                            const orientation = view.getUint16(entryOffset + 8, littleEndian);
                            return orientation >= 1 && orientation <= 8 ? orientation : 1;
                        }
                    }
                }

                offset += 2 + segmentLength;
            } else if ((marker & 0xFF00) === 0xFF00) {
                // Other marker - skip
                if (marker === 0xFFD9 || marker === 0xFFDA) break; // EOI or SOS
                const segmentLength = view.getUint16(offset + 2);
                offset += 2 + segmentLength;
            } else {
                break;
            }
        }

        return 1; // Default: no rotation
    } catch (e) {
        return 1;
    }
}

// ==================== IMAGE DECODING ====================

/**
 * Decode ArrayBuffer to ImageBitmap
 * @param {ArrayBuffer} bytes
 * @param {string} [contentType]
 * @returns {Promise<ImageBitmap>}
 */
async function decodeToBitmap(bytes, contentType = "") {
    const blob = new Blob([bytes], { type: contentType || "application/octet-stream" });

    // Decode without auto-orientation - we'll handle it manually
    const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: "none",
        colorSpaceConversion: "default"
    });

    return bitmap;
}

/**
 * Apply EXIF orientation transform to canvas context
 * @param {OffscreenCanvasRenderingContext2D} ctx
 * @param {number} orientation
 * @param {number} width - Original image width
 * @param {number} height - Original image height
 */
function applyOrientationTransform(ctx, orientation, width, height) {
    const transform = EXIF_TRANSFORMS[orientation] || EXIF_TRANSFORMS[1];

    switch (transform.rotate) {
        case 90:
            ctx.translate(height, 0);
            ctx.rotate(Math.PI / 2);
            break;
        case 180:
            ctx.translate(width, height);
            ctx.rotate(Math.PI);
            break;
        case 270:
            ctx.translate(0, width);
            ctx.rotate(-Math.PI / 2);
            break;
    }

    if (transform.flip) {
        if (transform.rotate === 90 || transform.rotate === 270) {
            ctx.scale(1, -1);
            ctx.translate(0, -height);
        } else {
            ctx.scale(-1, 1);
            ctx.translate(-width, 0);
        }
    }
}

/**
 * Get output dimensions after orientation transform
 * @param {number} orientation
 * @param {number} width
 * @param {number} height
 * @returns {{width: number, height: number}}
 */
function getOrientedDimensions(orientation, width, height) {
    // Orientations 5-8 swap width/height
    if (orientation >= 5 && orientation <= 8) {
        return { width: height, height: width };
    }
    return { width, height };
}

/**
 * Extract RGBA pixels from bitmap with EXIF orientation applied
 * @param {ImageBitmap} bitmap
 * @param {number} orientation - EXIF orientation 1-8
 * @returns {{rgba: Uint8ClampedArray, width: number, height: number}}
 */
function bitmapToRgba(bitmap, orientation = 1) {
    const srcW = bitmap.width;
    const srcH = bitmap.height;

    const { width: dstW, height: dstH } = getOrientedDimensions(orientation, srcW, srcH);

    const canvas = new OffscreenCanvas(dstW, dstH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Apply orientation transform
    if (orientation !== 1) {
        applyOrientationTransform(ctx, orientation, srcW, srcH);
    }

    // Draw image
    ctx.drawImage(bitmap, 0, 0);

    // Extract pixels
    const imageData = ctx.getImageData(0, 0, dstW, dstH);

    return {
        rgba: imageData.data,
        width: dstW,
        height: dstH
    };
}

// ==================== CANONICAL BUFFER ====================

/**
 * Create 4-byte little-endian representation of uint32
 * @param {number} n
 * @returns {Uint8Array}
 */
function u32le(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
}

/**
 * Create canonical pixel buffer: [width:4][height:4][RGBA pixels]
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function createCanonicalBuffer(rgba, width, height) {
    const header = new Uint8Array(8);
    header.set(u32le(width), 0);
    header.set(u32le(height), 4);

    const buffer = new Uint8Array(8 + rgba.length);
    buffer.set(header, 0);
    buffer.set(rgba, 8);

    return buffer;
}

/**
 * Compute SHA-256 hash of canonical pixel buffer
 * @param {Uint8Array} canonicalBuffer
 * @returns {Promise<string>}
 */
async function pixelHash(canonicalBuffer) {
    const hashBuf = await crypto.subtle.digest("SHA-256", canonicalBuffer);
    const bytes = new Uint8Array(hashBuf);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ==================== L2 PIPELINE ====================

/**
 * Process image bytes through Layer 2 (pixel hash)
 * @param {Object} params
 * @param {ArrayBuffer} params.bytes - Raw image bytes
 * @param {string} params.sha256 - L1 byte hash (for linking)
 * @param {string} params.url
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {object} params.context
 * @param {string} [params.imageId]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
async function processL2(params) {
    const { bytes, sha256, url, scanId, tabId, pageUrl, context, imageId, signal } = params;
    let bitmap = null;

    try {
        ensureNotAborted(signal);
        // Parse EXIF orientation
        const orientation = parseExifOrientation(bytes);

        // Decode to bitmap
        bitmap = await decodeToBitmap(bytes);
        ensureNotAborted(signal);

        // Check pixel count (skip if too large)
        const pixelCount = bitmap.width * bitmap.height;
        if (pixelCount > MAX_PIXEL_COUNT) {
            console.log(`[PixelHash] Skipping L2 for large image: ${pixelCount} pixels`);
            return {
                status: "SKIPPED",
                reason: "HIGH_PIXEL_COUNT",
                width: bitmap.width,
                height: bitmap.height,
                bitmap // Pass for L3
            };
        }

        // Extract RGBA with orientation applied
        const { rgba, width, height } = bitmapToRgba(bitmap, orientation);

        // Create canonical buffer and hash
        const canonicalBuffer = createCanonicalBuffer(rgba, width, height);
        const hash = await pixelHash(canonicalBuffer);

        await globalThis.DedupeDB.addOccurrence({
            scanId,
            sha256,
            pixelHash: hash,
            imageId: imageId || null,
            url,
            pageUrl,
            tabId,
            foundAt: Date.now(),
            context
        });

        // Check if pixel canonical exists
        const existing = await globalThis.DedupeDB.getPixelCanonical(hash);

        if (existing) {
            if (!existing.representativeImageId && imageId) {
                await globalThis.DedupeDB.putPixelCanonical({
                    ...existing,
                    representativeImageId: imageId
                });
            }
            // DUPLICATE by pixel content
            await globalThis.DedupeDB.updateScanStats(scanId, { l2Dup: 1 });

            return {
                status: "DUP",
                pixelHash: hash,
                canonicalId: hash,
                representativeImageId: existing.representativeImageId || imageId || null,
                width,
                height,
                bitmap // Pass for L3 (may still want perceptual grouping)
            };
        }

        // NEW pixel content
        const canonical = {
            pixelHash: hash,
            width,
            height,
            byteSha256: sha256,
            firstSeenAt: Date.now(),
            representative: { url, tabId, pageUrl },
            representativeImageId: imageId || null
        };

        await globalThis.DedupeDB.putPixelCanonical(canonical);
        await globalThis.DedupeDB.updateScanStats(scanId, { l2New: 1 });

        return {
            status: "NEW",
            pixelHash: hash,
            canonicalId: hash,
            representativeImageId: imageId || null,
            width,
            height,
            bitmap // Pass for L3
        };

    } catch (error) {
        try { bitmap?.close?.(); } catch { }
        console.warn("[PixelHash] L2 processing failed:", error.message);
        await globalThis.DedupeDB.updateScanStats(scanId, { errors: 1 });

        return {
            status: "ERROR",
            errorCode: "DECODE_FAILED",
            error: error.message
        };
    }
}

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupePixelHash = {
        MAX_PIXEL_COUNT,
        parseExifOrientation,
        decodeToBitmap,
        applyOrientationTransform,
        getOrientedDimensions,
        bitmapToRgba,
        createCanonicalBuffer,
        pixelHash,
        processL2
    };
}
