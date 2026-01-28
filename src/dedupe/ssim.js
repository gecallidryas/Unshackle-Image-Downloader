/**
 * SSIM (Structural Similarity Index) computation for L3 confirmation
 * 
 * Computes SSIM between two grayscale thumbnails to confirm perceptual matches.
 * Threshold: SSIM >= 0.995 for confirmed duplicates
 */

// ==================== CONSTANTS ====================

const SSIM_THRESHOLD = 0.995;
const THUMBNAIL_MAX_SIZE = 256;

// SSIM constants
const K1 = 0.01;
const K2 = 0.03;
const L = 255; // Dynamic range
const C1 = (K1 * L) ** 2;
const C2 = (K2 * L) ** 2;

function ensureNotAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
}

// ==================== THUMBNAIL GENERATION ====================

/**
 * Create a grayscale thumbnail from ImageBitmap
 * @param {ImageBitmap} bitmap
 * @param {number} maxSize - Maximum dimension
 * @returns {{pixels: Uint8Array, width: number, height: number}}
 */
function createThumbnail(bitmap, maxSize = THUMBNAIL_MAX_SIZE) {
    const srcW = bitmap.width;
    const srcH = bitmap.height;

    // Calculate thumbnail dimensions (maintain aspect ratio)
    let dstW, dstH;
    if (srcW > srcH) {
        dstW = Math.min(srcW, maxSize);
        dstH = Math.round(srcH * (dstW / srcW));
    } else {
        dstH = Math.min(srcH, maxSize);
        dstW = Math.round(srcW * (dstH / srcH));
    }

    // Ensure minimum size
    dstW = Math.max(dstW, 8);
    dstH = Math.max(dstH, 8);

    // Draw to canvas
    const canvas = new OffscreenCanvas(dstW, dstH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, dstW, dstH);

    // Get pixels
    const imageData = ctx.getImageData(0, 0, dstW, dstH);
    const rgba = imageData.data;

    // Convert to grayscale
    const gray = new Uint8Array(dstW * dstH);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }

    return { pixels: gray, width: dstW, height: dstH };
}

/**
 * Resize grayscale pixels to target dimensions
 * @param {Uint8Array} pixels
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} dstW
 * @param {number} dstH
 * @returns {Uint8Array}
 */
function resizeGray(pixels, srcW, srcH, dstW, dstH) {
    if (srcW === dstW && srcH === dstH) return pixels;

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

            const p00 = pixels[y0 * srcW + x0];
            const p10 = pixels[y0 * srcW + x1];
            const p01 = pixels[y1 * srcW + x0];
            const p11 = pixels[y1 * srcW + x1];

            const top = p00 + xFrac * (p10 - p00);
            const bottom = p01 + xFrac * (p11 - p01);
            dst[y * dstW + x] = Math.round(top + yFrac * (bottom - top));
        }
    }

    return dst;
}

// ==================== TRANSFORM APPLICATION ====================

/**
 * Apply rotation to grayscale pixels
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} degrees - 0, 90, 180, or 270
 * @returns {{pixels: Uint8Array, width: number, height: number}}
 */
function rotateGray(pixels, width, height, degrees) {
    if (degrees === 0) return { pixels, width, height };

    switch (degrees) {
        case 90: {
            const rotated = new Uint8Array(width * height);
            const newW = height;
            const newH = width;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    rotated[x * newW + (height - 1 - y)] = pixels[y * width + x];
                }
            }
            return { pixels: rotated, width: newW, height: newH };
        }
        case 180: {
            const rotated = new Uint8Array(width * height);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    rotated[(height - 1 - y) * width + (width - 1 - x)] = pixels[y * width + x];
                }
            }
            return { pixels: rotated, width, height };
        }
        case 270: {
            const rotated = new Uint8Array(width * height);
            const newW = height;
            const newH = width;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    rotated[(width - 1 - x) * newW + y] = pixels[y * width + x];
                }
            }
            return { pixels: rotated, width: newW, height: newH };
        }
        default:
            return { pixels, width, height };
    }
}

/**
 * Mirror grayscale pixels horizontally
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function mirrorGray(pixels, width, height) {
    const mirrored = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            mirrored[y * width + (width - 1 - x)] = pixels[y * width + x];
        }
    }
    return mirrored;
}

// ==================== SSIM COMPUTATION ====================

/**
 * Compute mean of grayscale pixels
 * @param {Uint8Array} pixels
 * @returns {number}
 */
function mean(pixels) {
    let sum = 0;
    for (let i = 0; i < pixels.length; i++) {
        sum += pixels[i];
    }
    return sum / pixels.length;
}

/**
 * Compute variance of grayscale pixels
 * @param {Uint8Array} pixels
 * @param {number} pixelMean
 * @returns {number}
 */
function variance(pixels, pixelMean) {
    let sum = 0;
    for (let i = 0; i < pixels.length; i++) {
        const diff = pixels[i] - pixelMean;
        sum += diff * diff;
    }
    return sum / pixels.length;
}

/**
 * Compute covariance of two grayscale images
 * @param {Uint8Array} pixelsA
 * @param {Uint8Array} pixelsB
 * @param {number} meanA
 * @param {number} meanB
 * @returns {number}
 */
function covariance(pixelsA, pixelsB, meanA, meanB) {
    let sum = 0;
    for (let i = 0; i < pixelsA.length; i++) {
        sum += (pixelsA[i] - meanA) * (pixelsB[i] - meanB);
    }
    return sum / pixelsA.length;
}

/**
 * Compute SSIM between two grayscale images
 * Images must have the same dimensions
 * @param {Uint8Array} pixelsA
 * @param {Uint8Array} pixelsB
 * @returns {number} SSIM value between 0 and 1
 */
function computeSSIM(pixelsA, pixelsB) {
    if (pixelsA.length !== pixelsB.length) {
        throw new Error("Images must have same dimensions");
    }

    const muA = mean(pixelsA);
    const muB = mean(pixelsB);
    const sigmaA2 = variance(pixelsA, muA);
    const sigmaB2 = variance(pixelsB, muB);
    const sigmaAB = covariance(pixelsA, pixelsB, muA, muB);

    const numerator = (2 * muA * muB + C1) * (2 * sigmaAB + C2);
    const denominator = (muA * muA + muB * muB + C1) * (sigmaA2 + sigmaB2 + C2);

    return numerator / denominator;
}

// ==================== CONFIRMATION PIPELINE ====================

/**
 * All transforms to try for confirmation
 */
const TRANSFORMS = [
    { rotation: 0, mirror: false },
    { rotation: 90, mirror: false },
    { rotation: 180, mirror: false },
    { rotation: 270, mirror: false },
    { rotation: 0, mirror: true },
    { rotation: 90, mirror: true },
    { rotation: 180, mirror: true },
    { rotation: 270, mirror: true }
];

/**
 * Confirm a pair of images using SSIM
 * @param {ImageBitmap} bitmapA
 * @param {ImageBitmap} bitmapB
 * @param {number} threshold
 * @returns {Promise<{confirmed: boolean, score: number, transform: object}|null>}
 */
async function confirmPair(bitmapA, bitmapB, threshold = SSIM_THRESHOLD) {
    try {
        // Create thumbnails
        const thumbA = createThumbnail(bitmapA, THUMBNAIL_MAX_SIZE);
        const thumbB = createThumbnail(bitmapB, THUMBNAIL_MAX_SIZE);

        // Try each transform on B
        for (const transform of TRANSFORMS) {
            // Apply rotation
            let { pixels, width, height } = rotateGray(thumbB.pixels, thumbB.width, thumbB.height, transform.rotation);

            // Apply mirror if needed
            if (transform.mirror) {
                pixels = mirrorGray(pixels, width, height);
            }

            // Resize to match A's dimensions
            const resizedB = resizeGray(pixels, width, height, thumbA.width, thumbA.height);

            // Compute SSIM
            const score = computeSSIM(thumbA.pixels, resizedB);

            if (score >= threshold) {
                return {
                    confirmed: true,
                    score,
                    transform
                };
            }
        }

        // No transform passed threshold
        return {
            confirmed: false,
            score: 0,
            transform: null
        };

    } catch (error) {
        console.warn("[SSIM] Confirmation failed:", error.message);
        return null;
    }
}

/**
 * Confirm a pair of stored thumbnails using SSIM
 * @param {{pixels: Uint8Array, width: number, height: number}} thumbA
 * @param {{pixels: Uint8Array, width: number, height: number}} thumbB
 * @param {number} threshold
 * @returns {{confirmed: boolean, score: number, transform: object}|null}
 */
function confirmThumbnailPair(thumbA, thumbB, threshold = SSIM_THRESHOLD) {
    try {
        if (!thumbA || !thumbB) return null;

        for (const transform of TRANSFORMS) {
            let { pixels, width, height } = rotateGray(thumbB.pixels, thumbB.width, thumbB.height, transform.rotation);
            if (transform.mirror) {
                pixels = mirrorGray(pixels, width, height);
            }
            const resizedB = resizeGray(pixels, width, height, thumbA.width, thumbA.height);
            const score = computeSSIM(thumbA.pixels, resizedB);
            if (score >= threshold) {
                return {
                    confirmed: true,
                    score,
                    transform
                };
            }
        }

        return {
            confirmed: false,
            score: 0,
            transform: null
        };
    } catch (error) {
        console.warn("[SSIM] Thumbnail confirmation failed:", error.message);
        return null;
    }
}

/**
 * Process candidate confirmations for an image
 * @param {Object} params
 * @param {string} params.imageId
 * @param {ImageBitmap} params.bitmap
 * @param {Array<{imageId: string, distance: number}>} params.candidates
 * @param {string} params.scanId
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
async function confirmCandidates(params) {
    const { imageId, bitmap, candidates, scanId, signal } = params;
    const confirmed = [];
    const thumbA = createThumbnail(bitmap, THUMBNAIL_MAX_SIZE);

    for (const candidate of candidates) {
        ensureNotAborted(signal);
        // Check cache first
        const cached = await globalThis.DedupeDB.getPairConfirm(imageId, candidate.imageId);
        if (cached) {
            if (cached.status === "CONFIRMED") {
                confirmed.push({
                    imageId: candidate.imageId,
                    score: cached.score,
                    transform: cached.transform
                });
            }
            continue;
        }

        const candidateThumb = await globalThis.DedupeDB.getThumbnail(candidate.imageId);
        const candidatePixels = candidateThumb?.pixels instanceof Uint8Array
            ? candidateThumb.pixels
            : (candidateThumb?.pixels instanceof ArrayBuffer
                ? new Uint8Array(candidateThumb.pixels)
                : (ArrayBuffer.isView(candidateThumb?.pixels)
                    ? new Uint8Array(candidateThumb.pixels.buffer.slice(candidateThumb.pixels.byteOffset, candidateThumb.pixels.byteOffset + candidateThumb.pixels.byteLength))
                    : (Array.isArray(candidateThumb?.pixels)
                        ? new Uint8Array(candidateThumb.pixels)
                        : null)));

        if (!candidateThumb || !candidatePixels || !candidateThumb.width || !candidateThumb.height) {
            await globalThis.DedupeDB.putPairConfirm(imageId, candidate.imageId, {
                status: "REJECTED",
                score: 0,
                transform: null,
                confirmedAt: Date.now()
            });
            continue;
        }

        ensureNotAborted(signal);
        const result = confirmThumbnailPair(thumbA, {
            pixels: candidatePixels,
            width: candidateThumb.width,
            height: candidateThumb.height
        }, SSIM_THRESHOLD);

        if (result?.confirmed) {
            confirmed.push({
                imageId: candidate.imageId,
                score: result.score,
                transform: result.transform
            });
            await globalThis.DedupeDB.putPairConfirm(imageId, candidate.imageId, {
                status: "CONFIRMED",
                score: result.score,
                transform: result.transform,
                confirmedAt: Date.now()
            });
        } else {
            await globalThis.DedupeDB.putPairConfirm(imageId, candidate.imageId, {
                status: "REJECTED",
                score: result?.score || 0,
                transform: result?.transform || null,
                confirmedAt: Date.now()
            });
        }
    }

    return {
        imageId,
        confirmed
    };
}

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupeSSIM = {
        SSIM_THRESHOLD,
        THUMBNAIL_MAX_SIZE,
        createThumbnail,
        resizeGray,
        rotateGray,
        mirrorGray,
        mean,
        variance,
        covariance,
        computeSSIM,
        confirmPair,
        confirmThumbnailPair,
        confirmCandidates
    };
}
