/**
 * Deduplication Pipeline Orchestrator
 * 
 * Coordinates the 3-layer deduplication process:
 * L1: Exact byte hash (SHA-256)
 * L2: Canonical pixel hash
 * L3: Perceptual hash + SSIM confirmation
 */

// ==================== PIPELINE ORCHESTRATION ====================

/**
 * Process a single image URL through the full deduplication pipeline
 * @param {Object} params
 * @param {string} params.url
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {object} params.context
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
async function processImage(params) {
    const { url, scanId, tabId, pageUrl, context, signal } = params;
    const results = { url, layers: {} };

    try {
        // ===== LAYER 1: Byte Hash =====
        const l1Result = await globalThis.DedupeByteHash.processL1({
            url, scanId, tabId, pageUrl, context, signal
        });

        results.layers.l1 = l1Result;

        // Handle blob: URL case (needs content script fetch)
        if (l1Result.status === "NEEDS_CONTENT_SCRIPT") {
            return {
                ...results,
                status: "NEEDS_CONTENT_SCRIPT",
                needsBlobFetch: true
            };
        }

        // Handle errors
        if (l1Result.status === "ERROR") {
            return {
                ...results,
                status: "ERROR",
                errorCode: l1Result.errorCode,
                error: l1Result.error
            };
        }

        // If L1 found a duplicate, we're done (exact match)
        if (l1Result.status === "DUP") {
            // Send result message
            globalThis.DedupeMessages?.sendToUI(tabId,
                globalThis.DedupeMessages.createHashResultMessage({
                    scanId,
                    url,
                    sha256: l1Result.sha256,
                    status: "DUP",
                    canonicalId: l1Result.canonicalId,
                    byteLength: l1Result.byteLength
                })
            );

            return {
                ...results,
                status: "DUP",
                detectedBy: "L1",
                sha256: l1Result.sha256
            };
        }

        // ===== LAYER 2: Pixel Hash =====
        if (l1Result.bytes) {
            const l2Result = await globalThis.DedupePixelHash.processL2({
                bytes: l1Result.bytes,
                sha256: l1Result.sha256,
                url, scanId, tabId, pageUrl, context
            });

            results.layers.l2 = l2Result;

            // If L2 was skipped (large image), continue to L3
            if (l2Result.status === "SKIPPED") {
                // Continue with bitmap from L2 for L3
            } else if (l2Result.status === "DUP") {
                // Send result message
                globalThis.DedupeMessages?.sendToUI(tabId,
                    globalThis.DedupeMessages.createPixelHashResultMessage({
                        scanId,
                        url,
                        pixelHash: l2Result.pixelHash,
                        width: l2Result.width,
                        height: l2Result.height,
                        status: "DUP",
                        canonicalId: l2Result.canonicalId
                    })
                );

                return {
                    ...results,
                    status: "DUP",
                    detectedBy: "L2",
                    sha256: l1Result.sha256,
                    pixelHash: l2Result.pixelHash
                };
            } else if (l2Result.status === "ERROR") {
                // L2 failed but we have L1 result, continue to L3 if possible
                console.warn("[Pipeline] L2 failed, attempting L3 fallback");
            }

            // ===== LAYER 3: Perceptual Hash =====
            if (l2Result.bitmap) {
                const l3Result = await globalThis.DedupePerceptual.processL3({
                    bitmap: l2Result.bitmap,
                    pixelHash: l2Result.pixelHash || null,
                    sha256: l1Result.sha256,
                    url, scanId, tabId, pageUrl, context
                });

                results.layers.l3 = l3Result;

                // Send result message
                globalThis.DedupeMessages?.sendToUI(tabId,
                    globalThis.DedupeMessages.createPerceptualResultMessage({
                        scanId,
                        url,
                        imageId: l3Result.imageId,
                        dhash64: l3Result.dhash64,
                        status: l3Result.status,
                        groupId: null
                    })
                );

                // If candidates found, they need SSIM confirmation
                // (handled separately due to async bitmap loading requirements)
                if (l3Result.status === "CANDIDATE" && l3Result.candidates?.length > 0) {
                    return {
                        ...results,
                        status: "CANDIDATE",
                        detectedBy: "L3",
                        imageId: l3Result.imageId,
                        candidates: l3Result.candidates
                    };
                }

                return {
                    ...results,
                    status: "NEW",
                    sha256: l1Result.sha256,
                    pixelHash: l2Result.pixelHash,
                    imageId: l3Result.imageId
                };
            }
        }

        // Fallback: only L1 completed
        globalThis.DedupeMessages?.sendToUI(tabId,
            globalThis.DedupeMessages.createHashResultMessage({
                scanId,
                url,
                sha256: l1Result.sha256,
                status: "NEW",
                canonicalId: l1Result.canonicalId,
                byteLength: l1Result.byteLength
            })
        );

        return {
            ...results,
            status: "NEW",
            sha256: l1Result.sha256
        };

    } catch (error) {
        console.error("[Pipeline] Unexpected error:", error);
        return {
            ...results,
            status: "ERROR",
            errorCode: "PIPELINE_FAILED",
            error: error.message
        };
    }
}

/**
 * Process blob bytes through the pipeline (for blob: URLs fetched by content script)
 * @param {Object} params
 * @param {ArrayBuffer} params.bytes
 * @param {string} params.url
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {object} params.context
 * @returns {Promise<Object>}
 */
async function processBlobBytes(params) {
    const { bytes, url, scanId, tabId, pageUrl, context } = params;
    const results = { url, layers: {} };

    try {
        // L1 with bytes directly
        const l1Result = await globalThis.DedupeByteHash.processL1Bytes({
            bytes, url, scanId, tabId, pageUrl, context
        });

        results.layers.l1 = l1Result;

        if (l1Result.status === "ERROR") {
            return {
                ...results,
                status: "ERROR",
                errorCode: l1Result.errorCode,
                error: l1Result.error
            };
        }

        if (l1Result.status === "DUP") {
            globalThis.DedupeMessages?.sendToUI(tabId,
                globalThis.DedupeMessages.createHashResultMessage({
                    scanId,
                    url,
                    sha256: l1Result.sha256,
                    status: "DUP",
                    canonicalId: l1Result.canonicalId,
                    byteLength: l1Result.byteLength
                })
            );

            return {
                ...results,
                status: "DUP",
                detectedBy: "L1",
                sha256: l1Result.sha256
            };
        }

        // Continue to L2/L3 with the bytes
        const l2Result = await globalThis.DedupePixelHash.processL2({
            bytes: l1Result.bytes,
            sha256: l1Result.sha256,
            url, scanId, tabId, pageUrl, context
        });

        results.layers.l2 = l2Result;

        if (l2Result.status === "DUP") {
            globalThis.DedupeMessages?.sendToUI(tabId,
                globalThis.DedupeMessages.createPixelHashResultMessage({
                    scanId,
                    url,
                    pixelHash: l2Result.pixelHash,
                    width: l2Result.width,
                    height: l2Result.height,
                    status: "DUP",
                    canonicalId: l2Result.canonicalId
                })
            );

            return {
                ...results,
                status: "DUP",
                detectedBy: "L2",
                sha256: l1Result.sha256,
                pixelHash: l2Result.pixelHash
            };
        }

        // L3
        if (l2Result.bitmap) {
            const l3Result = await globalThis.DedupePerceptual.processL3({
                bitmap: l2Result.bitmap,
                pixelHash: l2Result.pixelHash || null,
                sha256: l1Result.sha256,
                url, scanId, tabId, pageUrl, context
            });

            results.layers.l3 = l3Result;

            globalThis.DedupeMessages?.sendToUI(tabId,
                globalThis.DedupeMessages.createPerceptualResultMessage({
                    scanId,
                    url,
                    imageId: l3Result.imageId,
                    dhash64: l3Result.dhash64,
                    status: l3Result.status,
                    groupId: null
                })
            );

            return {
                ...results,
                status: l3Result.candidates?.length > 0 ? "CANDIDATE" : "NEW",
                detectedBy: l3Result.candidates?.length > 0 ? "L3" : null,
                sha256: l1Result.sha256,
                pixelHash: l2Result.pixelHash,
                imageId: l3Result.imageId,
                candidates: l3Result.candidates
            };
        }

        return {
            ...results,
            status: "NEW",
            sha256: l1Result.sha256
        };

    } catch (error) {
        console.error("[Pipeline] Blob processing error:", error);
        return {
            ...results,
            status: "ERROR",
            errorCode: "PIPELINE_FAILED",
            error: error.message
        };
    }
}

/**
 * Process a batch of candidates
 * @param {Object} params
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {Array<{url: string, context: object}>} params.candidates
 * @returns {Promise<Object>}
 */
async function processBatch(params) {
    const { scanId, tabId, pageUrl, candidates } = params;

    // Update scan stats
    await globalThis.DedupeDB.updateScanStats(scanId, { candidates: candidates.length });

    const results = {
        total: candidates.length,
        processed: 0,
        duplicates: { l1: 0, l2: 0, l3: 0 },
        errors: 0
    };

    // Process each candidate through the fetch queue
    const queue = globalThis.DedupeQueues.fetch;

    const processOne = async (candidate) => {
        const result = await processImage({
            url: candidate.url,
            scanId,
            tabId,
            pageUrl,
            context: candidate.context
        });

        results.processed++;

        if (result.status === "ERROR") {
            results.errors++;
        } else if (result.status === "DUP") {
            if (result.detectedBy === "L1") results.duplicates.l1++;
            else if (result.detectedBy === "L2") results.duplicates.l2++;
            else if (result.detectedBy === "L3") results.duplicates.l3++;
        }

        return result;
    };

    // Add all to queue
    const promises = candidates.map(c => queue.add(() => processOne(c)));

    // Wait for all
    await Promise.allSettled(promises);

    // Send final stats
    const scanRun = await globalThis.DedupeDB.getScanRun(scanId);
    if (scanRun) {
        globalThis.DedupeMessages?.sendToUI(tabId,
            globalThis.DedupeMessages.createScanStatsMessage({
                scanId,
                stats: scanRun.stats
            })
        );
    }

    return results;
}

// ==================== MESSAGE HANDLER ====================

/**
 * Handle dedupe messages in service worker
 * @param {Object} message
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<any>}
 */
async function handleDedupeMessage(message, sender) {
    const { DedupeMessageTypes } = globalThis;
    if (!DedupeMessageTypes) return null;

    switch (message.type) {
        case DedupeMessageTypes.DEDUPE_SCAN_START: {
            const { tabId, pageUrl, options } = message;
            const scanRun = await globalThis.DedupeDB.createScanRun({ tabId, pageUrl, options });
            return { scanId: scanRun.scanId };
        }

        case DedupeMessageTypes.DEDUPE_CANDIDATES: {
            const { scanId, tabId, pageUrl, candidates } = message;
            // Process in background, return immediately
            processBatch({ scanId, tabId, pageUrl, candidates }).catch(console.error);
            return { acknowledged: true, count: candidates.length };
        }

        case DedupeMessageTypes.DEDUPE_BLOB_BYTES: {
            const { scanId, url, bytes, context } = message;
            const tabId = sender.tab?.id;
            const pageUrl = sender.tab?.url || sender.url;
            return await processBlobBytes({ bytes, url, scanId, tabId, pageUrl, context });
        }

        case DedupeMessageTypes.DEDUPE_SCAN_STOP: {
            const { scanId } = message;
            await globalThis.DedupeDB.finishScanRun(scanId);
            // Cancel any pending jobs
            globalThis.DedupeQueues?.fetch.cancelAll();
            globalThis.DedupeQueues?.decode.cancelAll();
            globalThis.DedupeQueues?.perceptual.cancelAll();
            globalThis.DedupeQueues?.confirm.cancelAll();
            return { stopped: true };
        }

        case DedupeMessageTypes.DEDUPE_SCAN_FINISH: {
            const { scanId } = message;
            await globalThis.DedupeDB.finishScanRun(scanId);
            return { finished: true };
        }

        case DedupeMessageTypes.QUERY_GROUPS: {
            const groups = await globalThis.DedupeDB.getAllGroups();
            return { groups };
        }

        case DedupeMessageTypes.QUERY_SCAN: {
            const { scanId } = message;
            const scanRun = await globalThis.DedupeDB.getScanRun(scanId);
            return { scanRun };
        }

        case DedupeMessageTypes.CLEAR_DATA: {
            await globalThis.DedupeDB.clearAllData();
            return { cleared: true };
        }

        default:
            return null;
    }
}

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupePipeline = {
        processImage,
        processBlobBytes,
        processBatch,
        handleDedupeMessage
    };
}
