/**
 * IndexedDB wrapper for image deduplication storage
 * Database: img_dedupe_db
 * 
 * Stores:
 * - byte_canonicals: SHA-256 byte hash → canonical record
 * - pixel_canonicals: Pixel hash → canonical record  
 * - images: imageId → full image metadata including perceptual hashes
 * - groups: groupId → duplicate group with members
 * - occurrences: Auto-increment → where each image was found
 * - hash_buckets: bucketKey → imageIds for fast perceptual lookup
 * - pair_confirms: pairKey → confirmation result cache
 * - thumbnails: imageId → stored grayscale thumbnails for SSIM confirmation
 * - scan_runs: scanId → scan metadata and stats
 */

const DB_NAME = "img_dedupe_db";
const DB_VERSION = 2;

/** @type {IDBDatabase|null} */
let dbInstance = null;

/**
 * Open or get the database connection
 * @returns {Promise<IDBDatabase>}
 */
async function openDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // byte_canonicals: keyed by sha256
            if (!db.objectStoreNames.contains("byte_canonicals")) {
                db.createObjectStore("byte_canonicals", { keyPath: "sha256" });
            }

            // pixel_canonicals: keyed by pixelHash
            if (!db.objectStoreNames.contains("pixel_canonicals")) {
                db.createObjectStore("pixel_canonicals", { keyPath: "pixelHash" });
            }

            // images: keyed by imageId
            if (!db.objectStoreNames.contains("images")) {
                const store = db.createObjectStore("images", { keyPath: "imageId" });
                store.createIndex("byGroupId", "groupId", { unique: false });
                store.createIndex("byByteSha256", "byteSha256", { unique: false });
                store.createIndex("byPixelHash", "pixelHash", { unique: false });
            }

            // groups: keyed by groupId
            if (!db.objectStoreNames.contains("groups")) {
                const store = db.createObjectStore("groups", { keyPath: "groupId" });
                store.createIndex("byDetectedBy", "detectedBy", { unique: false });
            }

            // occurrences: auto-increment
            if (!db.objectStoreNames.contains("occurrences")) {
                const store = db.createObjectStore("occurrences", { keyPath: "id", autoIncrement: true });
                store.createIndex("bySha256", "sha256", { unique: false });
                store.createIndex("byPixelHash", "pixelHash", { unique: false });
                store.createIndex("byScanId", "scanId", { unique: false });
                store.createIndex("byPageUrl", "pageUrl", { unique: false });
            }

            // hash_buckets: keyed by bucketKey
            if (!db.objectStoreNames.contains("hash_buckets")) {
                db.createObjectStore("hash_buckets", { keyPath: "bucketKey" });
            }

            // pair_confirms: keyed by pairKey
            if (!db.objectStoreNames.contains("pair_confirms")) {
                db.createObjectStore("pair_confirms", { keyPath: "pairKey" });
            }

            // thumbnails: keyed by imageId
            if (!db.objectStoreNames.contains("thumbnails")) {
                db.createObjectStore("thumbnails", { keyPath: "imageId" });
            }

            // scan_runs: keyed by scanId
            if (!db.objectStoreNames.contains("scan_runs")) {
                const store = db.createObjectStore("scan_runs", { keyPath: "scanId" });
                store.createIndex("byTabId", "tabId", { unique: false });
            }
        };

        request.onsuccess = () => {
            dbInstance = request.result;

            // Handle connection close
            dbInstance.onclose = () => { dbInstance = null; };
            dbInstance.onerror = (e) => console.error("[DedupeDB] Error:", e);

            resolve(dbInstance);
        };
    });
}

/**
 * Close the database connection
 */
function closeDB() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}

// ==================== BYTE CANONICALS ====================

/**
 * Get byte canonical by SHA-256 hash
 * @param {string} sha256 
 * @returns {Promise<object|null>}
 */
async function getByteCanonical(sha256) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("byte_canonicals", "readonly");
        const store = tx.objectStore("byte_canonicals");
        const request = store.get(sha256);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store byte canonical
 * @param {object} canonical 
 * @returns {Promise<void>}
 */
async function putByteCanonical(canonical) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("byte_canonicals", "readwrite");
        const store = tx.objectStore("byte_canonicals");
        const request = store.put(canonical);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Atomically ensure a byte canonical exists.
 * Returns NEW when inserted, DUP when already present.
 * @param {object} params
 * @param {string} params.sha256
 * @param {object} params.canonical
 * @param {string|null} [params.representativeImageId]
 * @returns {Promise<{status:"NEW"|"DUP", record:object}>}
 */
async function ensureByteCanonical({ sha256, canonical, representativeImageId = null }) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("byte_canonicals", "readwrite");
        const store = tx.objectStore("byte_canonicals");
        const request = store.get(sha256);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const existing = request.result || null;
            if (existing) {
                if (!existing.representativeImageId && representativeImageId) {
                    const updated = { ...existing, representativeImageId };
                    const putReq = store.put(updated);
                    putReq.onerror = () => reject(putReq.error);
                    putReq.onsuccess = () => resolve({ status: "DUP", record: updated });
                    return;
                }
                resolve({ status: "DUP", record: existing });
                return;
            }
            const toInsert = canonical || { sha256 };
            const addReq = store.add(toInsert);
            addReq.onerror = () => reject(addReq.error);
            addReq.onsuccess = () => resolve({ status: "NEW", record: toInsert });
        };
    });
}

// ==================== PIXEL CANONICALS ====================

/**
 * Get pixel canonical by pixel hash
 * @param {string} pixelHash 
 * @returns {Promise<object|null>}
 */
async function getPixelCanonical(pixelHash) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("pixel_canonicals", "readonly");
        const store = tx.objectStore("pixel_canonicals");
        const request = store.get(pixelHash);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store pixel canonical
 * @param {object} canonical 
 * @returns {Promise<void>}
 */
async function putPixelCanonical(canonical) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("pixel_canonicals", "readwrite");
        const store = tx.objectStore("pixel_canonicals");
        const request = store.put(canonical);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Atomically ensure a pixel canonical exists.
 * Returns NEW when inserted, DUP when already present.
 * @param {object} params
 * @param {string} params.pixelHash
 * @param {object} params.canonical
 * @param {string|null} [params.representativeImageId]
 * @returns {Promise<{status:"NEW"|"DUP", record:object}>}
 */
async function ensurePixelCanonical({ pixelHash, canonical, representativeImageId = null }) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("pixel_canonicals", "readwrite");
        const store = tx.objectStore("pixel_canonicals");
        const request = store.get(pixelHash);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const existing = request.result || null;
            if (existing) {
                if (!existing.representativeImageId && representativeImageId) {
                    const updated = { ...existing, representativeImageId };
                    const putReq = store.put(updated);
                    putReq.onerror = () => reject(putReq.error);
                    putReq.onsuccess = () => resolve({ status: "DUP", record: updated });
                    return;
                }
                resolve({ status: "DUP", record: existing });
                return;
            }
            const toInsert = canonical || { pixelHash };
            const addReq = store.add(toInsert);
            addReq.onerror = () => reject(addReq.error);
            addReq.onsuccess = () => resolve({ status: "NEW", record: toInsert });
        };
    });
}

// ==================== IMAGES ====================

/**
 * Get image by ID
 * @param {string} imageId 
 * @returns {Promise<object|null>}
 */
async function getImage(imageId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const store = tx.objectStore("images");
        const request = store.get(imageId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store image
 * @param {object} image 
 * @returns {Promise<void>}
 */
async function putImage(image) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readwrite");
        const store = tx.objectStore("images");
        const request = store.put(image);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Merge and store an image record
 * @param {object} partial
 * @returns {Promise<object>}
 */
async function upsertImage(partial) {
    if (!partial || !partial.imageId) {
        throw new Error("imageId required");
    }
    const existing = await getImage(partial.imageId);
    const merged = { ...(existing || {}), ...partial };
    await putImage(merged);
    return merged;
}

/**
 * Get all images in a group
 * @param {string} groupId 
 * @returns {Promise<object[]>}
 */
async function getImagesByGroup(groupId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("images", "readonly");
        const store = tx.objectStore("images");
        const index = store.index("byGroupId");
        const request = index.getAll(groupId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// ==================== GROUPS ====================

/**
 * Get group by ID
 * @param {string} groupId 
 * @returns {Promise<object|null>}
 */
async function getGroup(groupId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("groups", "readonly");
        const store = tx.objectStore("groups");
        const request = store.get(groupId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store group
 * @param {object} group 
 * @returns {Promise<void>}
 */
async function putGroup(group) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("groups", "readwrite");
        const store = tx.objectStore("groups");
        const request = store.put(group);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete group by ID
 * @param {string} groupId
 * @returns {Promise<void>}
 */
async function deleteGroup(groupId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("groups", "readwrite");
        const store = tx.objectStore("groups");
        const request = store.delete(groupId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all groups
 * @returns {Promise<object[]>}
 */
async function getAllGroups() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("groups", "readonly");
        const store = tx.objectStore("groups");
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// ==================== OCCURRENCES ====================

/**
 * Add occurrence
 * @param {object} occurrence 
 * @returns {Promise<number>} The auto-generated ID
 */
async function addOccurrence(occurrence) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("occurrences", "readwrite");
        const store = tx.objectStore("occurrences");
        const request = store.add(occurrence);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get occurrences by scan ID
 * @param {string} scanId 
 * @returns {Promise<object[]>}
 */
async function getOccurrencesByScan(scanId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("occurrences", "readonly");
        const store = tx.objectStore("occurrences");
        const index = store.index("byScanId");
        const request = index.getAll(scanId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// ==================== HASH BUCKETS ====================

/**
 * Get bucket by key
 * @param {string} bucketKey 
 * @returns {Promise<object|null>}
 */
async function getBucket(bucketKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("hash_buckets", "readonly");
        const store = tx.objectStore("hash_buckets");
        const request = store.get(bucketKey);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store bucket
 * @param {object} bucket 
 * @returns {Promise<void>}
 */
async function putBucket(bucket) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("hash_buckets", "readwrite");
        const store = tx.objectStore("hash_buckets");
        const request = store.put(bucket);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Add image ID to a bucket
 * @param {string} bucketKey 
 * @param {string} imageId 
 * @returns {Promise<void>}
 */
async function addToBucket(bucketKey, imageId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("hash_buckets", "readwrite");
        const store = tx.objectStore("hash_buckets");
        const request = store.get(bucketKey);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const bucket = request.result || { bucketKey, imageIds: [] };
            if (!Array.isArray(bucket.imageIds)) {
                bucket.imageIds = [];
            }
            if (!bucket.imageIds.includes(imageId)) {
                bucket.imageIds.push(imageId);
                const putReq = store.put(bucket);
                putReq.onerror = () => reject(putReq.error);
                putReq.onsuccess = () => resolve();
                return;
            }
            resolve();
        };
    });
}

// ==================== PAIR CONFIRMS ====================

/**
 * Get pair confirmation result
 * @param {string} imageIdA 
 * @param {string} imageIdB 
 * @returns {Promise<object|null>}
 */
async function getPairConfirm(imageIdA, imageIdB) {
    const pairKey = [imageIdA, imageIdB].sort().join("|");
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("pair_confirms", "readonly");
        const store = tx.objectStore("pair_confirms");
        const request = store.get(pairKey);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store pair confirmation result
 * @param {string} imageIdA 
 * @param {string} imageIdB 
 * @param {object} result 
 * @returns {Promise<void>}
 */
async function putPairConfirm(imageIdA, imageIdB, result) {
    const pairKey = [imageIdA, imageIdB].sort().join("|");
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("pair_confirms", "readwrite");
        const store = tx.objectStore("pair_confirms");
        const request = store.put({ pairKey, ...result });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==================== THUMBNAILS ====================

/**
 * Get stored thumbnail by image ID
 * @param {string} imageId
 * @returns {Promise<object|null>}
 */
async function getThumbnail(imageId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("thumbnails", "readonly");
        const store = tx.objectStore("thumbnails");
        const request = store.get(imageId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store thumbnail
 * @param {object} thumbnail
 * @returns {Promise<void>}
 */
async function putThumbnail(thumbnail) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("thumbnails", "readwrite");
        const store = tx.objectStore("thumbnails");
        const request = store.put(thumbnail);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==================== SCAN RUNS ====================

/**
 * Get scan run by ID
 * @param {string} scanId 
 * @returns {Promise<object|null>}
 */
async function getScanRun(scanId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("scan_runs", "readonly");
        const store = tx.objectStore("scan_runs");
        const request = store.get(scanId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Store scan run
 * @param {object} scanRun 
 * @returns {Promise<void>}
 */
async function putScanRun(scanRun) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("scan_runs", "readwrite");
        const store = tx.objectStore("scan_runs");
        const request = store.put(scanRun);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Create a new scan run
 * @param {object} options 
 * @returns {Promise<object>}
 */
async function createScanRun({ tabId, pageUrl, options = {} }) {
    const scanRun = {
        scanId: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        startedAt: Date.now(),
        finishedAt: null,
        tabId,
        pageUrl,
        options,
        stats: {
            candidates: 0,
            fetched: 0,
            l1New: 0,
            l1Dup: 0,
            l2New: 0,
            l2Dup: 0,
            l3New: 0,
            l3Dup: 0,
            errors: 0
        }
    };
    await putScanRun(scanRun);
    return scanRun;
}

/**
 * Update scan stats
 * @param {string} scanId 
 * @param {object} statsDelta 
 * @returns {Promise<void>}
 */
async function updateScanStats(scanId, statsDelta) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("scan_runs", "readwrite");
        const store = tx.objectStore("scan_runs");
        const request = store.get(scanId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const scanRun = request.result || null;
            if (!scanRun) {
                resolve();
                return;
            }
            const next = { ...scanRun, stats: { ...(scanRun.stats || {}) } };
            for (const [key, delta] of Object.entries(statsDelta || {})) {
                if (key in next.stats && Number.isFinite(delta)) {
                    next.stats[key] += delta;
                }
            }
            const putReq = store.put(next);
            putReq.onerror = () => reject(putReq.error);
            putReq.onsuccess = () => resolve();
        };
    });
}

/**
 * Mark scan as finished
 * @param {string} scanId 
 * @returns {Promise<void>}
 */
async function finishScanRun(scanId) {
    const scanRun = await getScanRun(scanId);
    if (!scanRun) return;

    scanRun.finishedAt = Date.now();
    await putScanRun(scanRun);
}

// ==================== UTILITIES ====================

/**
 * Clear all dedupe data
 * @returns {Promise<void>}
 */
async function clearAllData() {
    const db = await openDB();
    const storeNames = [
        "byte_canonicals", "pixel_canonicals", "images", "groups",
        "occurrences", "hash_buckets", "pair_confirms", "thumbnails", "scan_runs"
    ];

    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

        for (const name of storeNames) {
            tx.objectStore(name).clear();
        }
    });
}

/**
 * Generate a unique image ID
 * @param {string} url 
 * @param {string} scanId 
 * @returns {string}
 */
function generateImageId(url, scanId) {
    const hash = url.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    return `img_${scanId}_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

// Export for use in service worker
if (typeof globalThis !== "undefined") {
    globalThis.DedupeDB = {
        openDB,
        closeDB,
        // Byte canonicals
        getByteCanonical,
        putByteCanonical,
        ensureByteCanonical,
        // Pixel canonicals
        getPixelCanonical,
        putPixelCanonical,
        ensurePixelCanonical,
        // Images
        getImage,
        putImage,
        upsertImage,
        getImagesByGroup,
        // Groups
        getGroup,
        putGroup,
        deleteGroup,
        getAllGroups,
        // Occurrences
        addOccurrence,
        getOccurrencesByScan,
        // Buckets
        getBucket,
        putBucket,
        addToBucket,
        // Pair confirms
        getPairConfirm,
        putPairConfirm,
        // Thumbnails
        getThumbnail,
        putThumbnail,
        // Scan runs
        getScanRun,
        putScanRun,
        createScanRun,
        updateScanStats,
        finishScanRun,
        // Utilities
        clearAllData,
        generateImageId
    };
}
