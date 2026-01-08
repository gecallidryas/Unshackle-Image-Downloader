/**
 * Message type definitions and routing for deduplication pipeline
 * 
 * Message flow:
 * - Content Script → Service Worker: DEDUPE_CANDIDATES, BLOB_BYTES
 * - Service Worker → UI: HASH_RESULT, PIXEL_HASH_RESULT, PERCEPTUAL_RESULT, HASH_ERROR, SCAN_STATS
 */

// ==================== MESSAGE TYPES ====================

const DedupeMessageTypes = {
    // Content Script → Service Worker
    DEDUPE_CANDIDATES: "DEDUPE_CANDIDATES",
    DEDUPE_BLOB_BYTES: "DEDUPE_BLOB_BYTES",
    DEDUPE_SCAN_START: "DEDUPE_SCAN_START",
    DEDUPE_SCAN_STOP: "DEDUPE_SCAN_STOP",
    DEDUPE_SCAN_FINISH: "DEDUPE_SCAN_FINISH",

    // Service Worker → UI
    HASH_RESULT: "DEDUPE_HASH_RESULT",
    PIXEL_HASH_RESULT: "DEDUPE_PIXEL_HASH_RESULT",
    PERCEPTUAL_RESULT: "DEDUPE_PERCEPTUAL_RESULT",
    HASH_ERROR: "DEDUPE_HASH_ERROR",
    SCAN_STATS: "DEDUPE_SCAN_STATS",
    GROUP_UPDATE: "DEDUPE_GROUP_UPDATE",

    // UI → Service Worker
    QUERY_GROUPS: "DEDUPE_QUERY_GROUPS",
    QUERY_SCAN: "DEDUPE_QUERY_SCAN",
    CLEAR_DATA: "DEDUPE_CLEAR_DATA"
};

// ==================== MESSAGE STRUCTURES ====================

/**
 * Create DEDUPE_CANDIDATES message
 * @param {Object} params
 * @param {string} params.scanId
 * @param {number} params.tabId
 * @param {string} params.pageUrl
 * @param {Array<{url: string, context: object}>} params.candidates
 * @returns {Object}
 */
function createCandidatesMessage({ scanId, tabId, pageUrl, candidates }) {
    return {
        type: DedupeMessageTypes.DEDUPE_CANDIDATES,
        scanId,
        tabId,
        pageUrl,
        candidates
    };
}

/**
 * Create DEDUPE_BLOB_BYTES message (for blob: URLs fetched in content script)
 * @param {Object} params
 * @param {string} params.scanId
 * @param {string} params.url - Original blob: URL
 * @param {ArrayBuffer} params.bytes - Raw image bytes
 * @param {object} params.context
 * @returns {Object}
 */
function createBlobBytesMessage({ scanId, url, bytes, context }) {
    return {
        type: DedupeMessageTypes.DEDUPE_BLOB_BYTES,
        scanId,
        url,
        bytes,
        context
    };
}

/**
 * Create HASH_RESULT message (L1 byte hash result)
 * @param {Object} params
 * @param {string} params.scanId
 * @param {string} params.url
 * @param {string} params.sha256
 * @param {"NEW"|"DUP"} params.status
 * @param {string} params.canonicalId
 * @param {number} [params.byteLength]
 * @returns {Object}
 */
function createHashResultMessage({ scanId, url, sha256, status, canonicalId, byteLength }) {
    return {
        type: DedupeMessageTypes.HASH_RESULT,
        scanId,
        url,
        sha256,
        status,
        canonicalId,
        byteLength
    };
}

/**
 * Create PIXEL_HASH_RESULT message (L2 pixel hash result)
 * @param {Object} params
 * @param {string} params.scanId
 * @param {string} params.url
 * @param {string} params.pixelHash
 * @param {number} params.width
 * @param {number} params.height
 * @param {"NEW"|"DUP"|"SKIPPED"} params.status
 * @param {string} [params.canonicalId]
 * @returns {Object}
 */
function createPixelHashResultMessage({ scanId, url, pixelHash, width, height, status, canonicalId }) {
    return {
        type: DedupeMessageTypes.PIXEL_HASH_RESULT,
        scanId,
        url,
        pixelHash,
        width,
        height,
        status,
        canonicalId
    };
}

/**
 * Create PERCEPTUAL_RESULT message (L3 perceptual hash result)
 * @param {Object} params
 * @param {string} params.scanId
 * @param {string} params.url
 * @param {string} params.imageId
 * @param {{hi: number, lo: number}} params.dhash64
 * @param {"NEW"|"CANDIDATE"|"CONFIRMED"} params.status
 * @param {string} [params.groupId]
 * @param {number} [params.ssimScore]
 * @returns {Object}
 */
function createPerceptualResultMessage({ scanId, url, imageId, dhash64, status, groupId, ssimScore }) {
    return {
        type: DedupeMessageTypes.PERCEPTUAL_RESULT,
        scanId,
        url,
        imageId,
        dhash64,
        status,
        groupId,
        ssimScore
    };
}

/**
 * Create HASH_ERROR message
 * @param {Object} params
 * @param {string} params.scanId
 * @param {string} params.url
 * @param {"FETCH_FAILED"|"HTTP_ERROR"|"TIMEOUT"|"DECODE_FAILED"|"CANVAS_FAILED"} params.errorCode
 * @param {string} [params.details]
 * @returns {Object}
 */
function createHashErrorMessage({ scanId, url, errorCode, details }) {
    return {
        type: DedupeMessageTypes.HASH_ERROR,
        scanId,
        url,
        errorCode,
        details
    };
}

/**
 * Create SCAN_STATS message
 * @param {Object} params
 * @param {string} params.scanId
 * @param {Object} params.stats
 * @returns {Object}
 */
function createScanStatsMessage({ scanId, stats }) {
    return {
        type: DedupeMessageTypes.SCAN_STATS,
        scanId,
        stats
    };
}

/**
 * Create GROUP_UPDATE message
 * @param {Object} params
 * @param {string} params.groupId
 * @param {string} params.representativeImageId
 * @param {string[]} params.memberImageIds
 * @param {"L1"|"L2"|"L3"} params.detectedBy
 * @returns {Object}
 */
function createGroupUpdateMessage({ groupId, representativeImageId, memberImageIds, detectedBy }) {
    return {
        type: DedupeMessageTypes.GROUP_UPDATE,
        groupId,
        representativeImageId,
        memberImageIds,
        detectedBy
    };
}

// ==================== MESSAGE SENDING HELPERS ====================

/**
 * Send message to UI (panel/popup)
 * @param {number} tabId
 * @param {Object} message
 */
async function sendToUI(tabId, message) {
    try {
        // Send to runtime (popup/panel listening)
        await chrome.runtime.sendMessage(message);
    } catch (e) {
        // Popup may not be open - that's okay
        if (!e.message?.includes("Receiving end does not exist")) {
            console.warn("[DedupeMessages] Failed to send to UI:", e.message);
        }
    }
}

/**
 * Send message to content script
 * @param {number} tabId
 * @param {Object} message
 * @returns {Promise<any>}
 */
async function sendToContentScript(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
        console.warn("[DedupeMessages] Failed to send to content script:", e.message);
        return null;
    }
}

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupeMessageTypes = DedupeMessageTypes;
    globalThis.DedupeMessages = {
        types: DedupeMessageTypes,
        // Creators
        createCandidatesMessage,
        createBlobBytesMessage,
        createHashResultMessage,
        createPixelHashResultMessage,
        createPerceptualResultMessage,
        createHashErrorMessage,
        createScanStatsMessage,
        createGroupUpdateMessage,
        // Senders
        sendToUI,
        sendToContentScript
    };
}
