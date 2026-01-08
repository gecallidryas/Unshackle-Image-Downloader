/**
 * Async job queue with concurrency control for deduplication pipeline
 * 
 * Features:
 * - Configurable concurrency per queue
 * - Job priority support (higher = runs first)
 * - Retry with exponential backoff
 * - AbortController-based timeout handling
 */

/**
 * @typedef {Object} QueueJob
 * @property {string} id - Unique job ID
 * @property {Function} task - Async function to execute
 * @property {number} priority - Higher = runs first (default: 0)
 * @property {number} retries - Retry attempts remaining
 * @property {AbortController} [abortController] - For cancellation
 */

class AsyncQueue {
    /**
     * @param {Object} options
     * @param {number} [options.concurrency=4] - Max concurrent jobs
     * @param {number} [options.maxRetries=3] - Max retry attempts
     * @param {number} [options.baseDelayMs=500] - Base delay for exponential backoff
     * @param {number} [options.timeoutMs=30000] - Job timeout in ms
     */
    constructor({ concurrency = 4, maxRetries = 3, baseDelayMs = 500, timeoutMs = 30000 } = {}) {
        this.concurrency = concurrency;
        this.maxRetries = maxRetries;
        this.baseDelayMs = baseDelayMs;
        this.timeoutMs = timeoutMs;

        /** @type {QueueJob[]} */
        this.pending = [];

        /** @type {Set<string>} */
        this.running = new Set();

        /** @type {Map<string, AbortController>} */
        this.abortControllers = new Map();

        this.paused = false;
        this.jobCounter = 0;
    }

    /**
     * Add a job to the queue
     * @param {Function} task - Async function to execute
     * @param {Object} [options]
     * @param {number} [options.priority=0] - Higher = runs first
     * @param {string} [options.id] - Custom job ID
     * @returns {Promise<any>} - Resolves with task result
     */
    async add(task, { priority = 0, id = null } = {}) {
        const jobId = id || `job_${++this.jobCounter}`;
        const abortController = new AbortController();

        return new Promise((resolve, reject) => {
            const job = {
                id: jobId,
                task,
                priority,
                retries: this.maxRetries,
                abortController,
                resolve,
                reject
            };

            this.abortControllers.set(jobId, abortController);

            // Insert in priority order (higher priority first)
            const insertIdx = this.pending.findIndex(j => j.priority < priority);
            if (insertIdx === -1) {
                this.pending.push(job);
            } else {
                this.pending.splice(insertIdx, 0, job);
            }

            this._processNext();
        });
    }

    /**
     * Process next job if capacity available
     * @private
     */
    _processNext() {
        if (this.paused) return;
        if (this.running.size >= this.concurrency) return;
        if (this.pending.length === 0) return;

        const job = this.pending.shift();
        if (!job) return;

        this.running.add(job.id);
        this._executeJob(job);

        // Check if we can run more
        this._processNext();
    }

    /**
     * Execute a single job with timeout and retry
     * @private
     * @param {QueueJob} job
     */
    async _executeJob(job) {
        const { id, task, abortController, resolve, reject } = job;

        try {
            // Setup timeout
            const timeoutId = setTimeout(() => {
                abortController.abort();
            }, this.timeoutMs);

            // Execute task
            const result = await task(abortController.signal);

            clearTimeout(timeoutId);
            this._finishJob(id);
            resolve(result);

        } catch (error) {
            // Check if aborted
            if (abortController.signal.aborted) {
                this._finishJob(id);
                reject(new Error(`Job ${id} timed out after ${this.timeoutMs}ms`));
                return;
            }

            // Check if retries remaining
            if (job.retries > 0 && this._shouldRetry(error)) {
                job.retries--;
                const delay = this.baseDelayMs * Math.pow(2, this.maxRetries - job.retries);

                console.log(`[Queue] Retrying job ${id} in ${delay}ms (${job.retries} retries left)`);

                setTimeout(() => {
                    // Re-add with same priority but at front for this priority level
                    this.pending.unshift(job);
                    this._finishJob(id);
                    this._processNext();
                }, delay);

                return;
            }

            this._finishJob(id);
            reject(error);
        }
    }

    /**
     * Determine if an error is retryable
     * @private
     * @param {Error} error
     * @returns {boolean}
     */
    _shouldRetry(error) {
        // Retry on network errors and rate limits
        if (error.message?.includes("429")) return true;
        if (error.message?.includes("503")) return true;
        if (error.message?.includes("network")) return true;
        if (error.name === "TypeError") return true; // fetch failures
        return false;
    }

    /**
     * Mark job as finished and process next
     * @private
     * @param {string} jobId
     */
    _finishJob(jobId) {
        this.running.delete(jobId);
        this.abortControllers.delete(jobId);
        this._processNext();
    }

    /**
     * Cancel a specific job
     * @param {string} jobId
     * @returns {boolean} - True if job was found and cancelled
     */
    cancel(jobId) {
        // Check pending
        const pendingIdx = this.pending.findIndex(j => j.id === jobId);
        if (pendingIdx !== -1) {
            const job = this.pending.splice(pendingIdx, 1)[0];
            job.reject(new Error(`Job ${jobId} cancelled`));
            return true;
        }

        // Check running
        const controller = this.abortControllers.get(jobId);
        if (controller) {
            controller.abort();
            return true;
        }

        return false;
    }

    /**
     * Cancel all jobs
     */
    cancelAll() {
        // Reject all pending
        for (const job of this.pending) {
            job.reject(new Error("Queue cancelled"));
        }
        this.pending = [];

        // Abort all running
        for (const controller of this.abortControllers.values()) {
            controller.abort();
        }
    }

    /**
     * Pause processing (running jobs continue)
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume processing
     */
    resume() {
        this.paused = false;
        this._processNext();
    }

    /**
     * Get queue status
     * @returns {Object}
     */
    getStatus() {
        return {
            pending: this.pending.length,
            running: this.running.size,
            paused: this.paused,
            concurrency: this.concurrency
        };
    }

    /**
     * Wait for all jobs to complete
     * @returns {Promise<void>}
     */
    async drain() {
        return new Promise(resolve => {
            const check = () => {
                if (this.pending.length === 0 && this.running.size === 0) {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }
}

// Pre-configured queues for different operation types
const DedupeQueues = {
    /** Fetch + L1 hash: concurrency 6 */
    fetch: new AsyncQueue({ concurrency: 6, timeoutMs: 20000 }),

    /** L2 decode + hash: concurrency 2 (memory-intensive) */
    decode: new AsyncQueue({ concurrency: 2, timeoutMs: 30000 }),

    /** L3 perceptual hash: concurrency 4 */
    perceptual: new AsyncQueue({ concurrency: 4, timeoutMs: 15000 }),

    /** L3 SSIM confirmation: concurrency 2 (heavy computation) */
    confirm: new AsyncQueue({ concurrency: 2, timeoutMs: 20000 })
};

// Export for service worker
if (typeof globalThis !== "undefined") {
    globalThis.AsyncQueue = AsyncQueue;
    globalThis.DedupeQueues = DedupeQueues;
}
