/**
 * Layer 3: Perceptual Hash
 * 
 * Computes dHash (difference hash) for perceptual similarity detection.
 * Uses multi-rotation hashing for rotation-invariant matching.
 * Candidates found by Hamming distance are confirmed with SSIM.
 */

// ==================== CONSTANTS ====================

// dHash thumbnail size (produces 64-bit hash from 9x8 image)
const DHASH_WIDTH = 9;
const DHASH_HEIGHT = 8;

// Conservative Hamming distance thresholds
const DHASH_THRESHOLD = 4;
const PHASH_THRESHOLD = 6; // If implementing pHash later

// Bucket prefix bits for LSH-style lookup
const BUCKET_PREFIX_BITS = 16;

// ==================== IMAGE PROCESSING ====================

/**
 * Convert RGBA pixels to grayscale
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} Grayscale pixels (1 byte per pixel)
 */
function toGrayscale(rgba, width, height) {
    const gray = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        // Luminance formula: 0.299*R + 0.587*G + 0.114*B
        gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }
    return gray;
}

/**
 * Resize grayscale image using bilinear interpolation
 * @param {Uint8Array} pixels
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @returns {Uint8Array}
 */
function resizeGray(pixels, srcW, srcH, dstW, dstH) {
    const dst = new Uint8Array(dstW * dstH);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
        for (let x = 0; x < dstW; x++) {
            const srcX = x * xRatio;
            const srcY = y * yRatio;

            const x0 = Math.floor(srcX);
            const y0 = Math.floor(srcY);
            const x1 = Math.min(x0 + 1, srcW - 1);
            const y1 = Math.min(y0 + 1, srcH - 1);

            const xFrac = srcX - x0;
            const yFrac = srcY - y0;

            // Bilinear interpolation
            const p00 = pixels[y0 * srcW + x0];
            const p10 = pixels[y0 * srcW + x1];
            const p01 = pixels[y1 * srcW + x0];
            const p11 = pixels[y1 * srcW + x1];

            const top = p00 + xFrac * (p10 - p00);
            const bottom = p01 + xFrac * (p11 - p01);
            const value = top + yFrac * (bottom - top);

            dst[y * dstW + x] = Math.round(value);
        }
    }

    return dst;
}

/**
 * Rotate grayscale pixels by 90 degrees clockwise
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @returns {{pixels: Uint8Array, width: number, height: number}}
 */
function rotateGray90CW(pixels, width, height) {
    const rotated = new Uint8Array(width * height);
    const newW = height;
    const newH = width;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = y * width + x;
            const dstIdx = x * newW + (height - 1 - y);
            rotated[dstIdx] = pixels[srcIdx];
        }
    }

    return { pixels: rotated, width: newW, height: newH };
}

// ==================== DHASH COMPUTATION ====================

/**
 * Compute 64-bit dHash from grayscale pixels
 * Input should be 9x8 pixels
 * @param {Uint8Array} gray9x8
 * @returns {{hi: number, lo: number}} 64-bit hash as two 32-bit integers
 */
function computeDHash(gray9x8) {
    let hi = 0;
    let lo = 0;
    let bit = 0;

    for (let y = 0; y < DHASH_HEIGHT; y++) {
        for (let x = 0; x < DHASH_HEIGHT; x++) { // 8 comparisons per row
            const left = gray9x8[y * DHASH_WIDTH + x];
            const right = gray9x8[y * DHASH_WIDTH + x + 1];

            if (left > right) {
                if (bit < 32) {
                    hi |= (1 << (31 - bit));
                } else {
                    lo |= (1 << (63 - bit));
                }
            }
            bit++;
        }
    }

    return { hi: hi >>> 0, lo: lo >>> 0 }; // Ensure unsigned
}

/**
 * Prepare image for dHash: grayscale and resize to 9x8
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array} 9x8 grayscale pixels
 */
function prepareDHashInput(rgba, width, height) {
    const gray = toGrayscale(rgba, width, height);
    return resizeGray(gray, width, height, DHASH_WIDTH, DHASH_HEIGHT);
}

/**
 * Compute dHash from RGBA pixels
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {{hi: number, lo: number}}
 */
function dHashFromRgba(rgba, width, height) {
    const gray9x8 = prepareDHashInput(rgba, width, height);
    return computeDHash(gray9x8);
}

/**
 * Compute dHash for all 4 rotations (for rotation-invariant matching)
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Array<{hi: number, lo: number, rotation: number}>}
 */
function multiRotationDHash(rgba, width, height) {
    const gray = toGrayscale(rgba, width, height);
    const hashes = [];

    let current = { pixels: gray, width, height };

    for (let rotation = 0; rotation < 360; rotation += 90) {
        // Resize current orientation to 9x8
        const resized = resizeGray(current.pixels, current.width, current.height, DHASH_WIDTH, DHASH_HEIGHT);
        const hash = computeDHash(resized);
        hashes.push({ ...hash, rotation });

        // Rotate for next iteration
        if (rotation < 270) {
            current = rotateGray90CW(current.pixels, current.width, current.height);
        }
    }

    return hashes;
}

// ==================== HAMMING DISTANCE ====================

/**
 * Count bits set in a 32-bit integer
 * @param {number} x
 * @returns {number}
 */
function popcnt32(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

/**
 * Compute Hamming distance between two 64-bit hashes
 * @param {{hi: number, lo: number}} a
 * @param {{hi: number, lo: number}} b
 * @returns {number}
 */
function hammingDistance(a, b) {
    return popcnt32(a.hi ^ b.hi) + popcnt32(a.lo ^ b.lo);
}

/**
 * Check if two hashes are within threshold (any rotation)
 * @param {Array<{hi: number, lo: number}>} hashesA - Multi-rotation hashes
 * @param {Array<{hi: number, lo: number}>} hashesB - Multi-rotation hashes
 * @param {number} threshold
 * @returns {{match: boolean, distance: number, rotationA: number, rotationB: number}|null}
 */
function findBestMatch(hashesA, hashesB, threshold = DHASH_THRESHOLD) {
    let bestMatch = null;
    let bestDistance = Infinity;

    for (const a of hashesA) {
        for (const b of hashesB) {
            const distance = hammingDistance(a, b);
            if (distance < bestDistance) {
                bestDistance = distance;
                if (distance <= threshold) {
                    bestMatch = {
                        match: true,
                        distance,
                        rotationA: a.rotation,
                        rotationB: b.rotation
                    };
                }
            }
        }
    }

    return bestMatch || { match: false, distance: bestDistance, rotationA: 0, rotationB: 0 };
}

// ==================== BUCKETING (LSH-STYLE) ====================

/**
 * Get bucket key from hash (prefix-based)
 * @param {{hi: number, lo: number}} hash
 * @returns {string}
 */
function getBucketKey(hash) {
    // Use top 16 bits of hi as bucket key
    const prefix = hash.hi >>> (32 - BUCKET_PREFIX_BITS);
    return `dhash:${prefix.toString(16).padStart(4, "0")}`;
}

/**
 * Get all bucket keys for multi-rotation hashes
 * @param {Array<{hi: number, lo: number}>} hashes
 * @returns {string[]}
 */
function getAllBucketKeys(hashes) {
    const keys = new Set();
    for (const hash of hashes) {
        keys.add(getBucketKey(hash));
    }
    return [...keys];
}

// ==================== L3 PIPELINE ====================

/**
 * Process image through Layer 3 (perceptual hash)
 * @param {Object} params
 * @param {ImageBitmap} params.bitmap
 * @param {string} params.pixelHash - L2 hash (for linking)
 * @param {string} params.sha256 - L1 hash (for linking)
 * @param {string} params.url
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {object} params.context
 * @returns {Promise<Object>}
 */
async function processL3(params) {
    const { bitmap, pixelHash, sha256, url, scanId, tabId, pageUrl, context } = params;

    try {
        // Extract RGBA from bitmap (no orientation needed, L2 handled it if available)
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

        // Compute multi-rotation dHash
        const dhashes = multiRotationDHash(imageData.data, bitmap.width, bitmap.height);
        const primaryHash = dhashes[0]; // 0° rotation

        // Generate image ID
        const imageId = globalThis.DedupeDB.generateImageId(url, scanId);

        // Store image record
        const imageRecord = {
            imageId,
            url,
            pageUrl,
            tabId,
            foundAt: Date.now(),
            width: bitmap.width,
            height: bitmap.height,
            byteSha256: sha256,
            pixelHash: pixelHash || null,
            dhash64: primaryHash,
            dhashRotations: dhashes,
            groupId: null
        };

        await globalThis.DedupeDB.putImage(imageRecord);

        // Add to buckets for all rotation hashes
        const bucketKeys = getAllBucketKeys(dhashes);
        for (const key of bucketKeys) {
            await globalThis.DedupeDB.addToBucket(key, imageId);
        }

        // Find candidate matches in buckets
        const candidateIds = new Set();
        for (const key of bucketKeys) {
            const bucket = await globalThis.DedupeDB.getBucket(key);
            if (bucket) {
                for (const id of bucket.imageIds) {
                    if (id !== imageId) {
                        candidateIds.add(id);
                    }
                }
            }
        }

        // Check candidates with Hamming distance
        const candidates = [];
        for (const candidateId of candidateIds) {
            const candidate = await globalThis.DedupeDB.getImage(candidateId);
            if (!candidate || !candidate.dhashRotations) continue;

            const match = findBestMatch(dhashes, candidate.dhashRotations, DHASH_THRESHOLD);
            if (match.match) {
                candidates.push({
                    imageId: candidateId,
                    distance: match.distance,
                    rotationA: match.rotationA,
                    rotationB: match.rotationB
                });
            }
        }

        await globalThis.DedupeDB.updateScanStats(scanId, { l3New: 1 });

        return {
            status: candidates.length > 0 ? "CANDIDATE" : "NEW",
            imageId,
            dhash64: primaryHash,
            candidates,
            width: bitmap.width,
            height: bitmap.height
        };

    } catch (error) {
        console.warn("[Perceptual] L3 processing failed:", error.message);
        await globalThis.DedupeDB.updateScanStats(scanId, { errors: 1 });

        return {
            status: "ERROR",
            errorCode: "PERCEPTUAL_FAILED",
            error: error.message
        };
    }
}

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupePerceptual = {
        DHASH_THRESHOLD,
        toGrayscale,
        resizeGray,
        rotateGray90CW,
        computeDHash,
        dHashFromRgba,
        multiRotationDHash,
        popcnt32,
        hammingDistance,
        findBestMatch,
        getBucketKey,
        getAllBucketKeys,
        processL3
    };
}
