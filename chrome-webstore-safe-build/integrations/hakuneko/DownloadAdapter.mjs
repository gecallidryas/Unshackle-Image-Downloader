const DOWNLOAD_KIND = "HK:DOWNLOAD";
const DOWNLOAD_CANCEL_KIND = "HK:CANCEL";

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || String(err)));
        return;
      }
      resolve(response);
    });
  });
}

function generateJobId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `hk_dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeContext(context = {}) {
  const tabId = Number.isInteger(context.tabId) ? context.tabId : null;
  let origin = null;
  const source = context.origin || context.url;
  if (typeof source === "string" && source) {
    try {
      origin = new URL(source).origin;
    } catch {
      origin = null;
    }
  }
const cookies = context?.cookies && typeof context.cookies === "object" ? context.cookies : null;
return {
  tabId,
  origin,
  family: typeof context.family === "string" && context.family ? context.family : null,
  connectorId: typeof context.connectorId === "string" && context.connectorId ? context.connectorId : null,
  url: typeof context.url === "string" ? context.url : null,
  referer: typeof context.referer === "string" ? context.referer : null,
  cookies
};
}

function serializePages(pages) {
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages
    .map((page) => {
      if (typeof page === "string") {
        return { url: page };
      }
      if (!page || typeof page !== "object") {
        return null;
      }
      const url = typeof page.url === "string" ? page.url : (typeof page.href === "string" ? page.href : null);
      if (!url) {
        return null;
      }
      const headers = {};
      if (page.headers && typeof page.headers === "object") {
        for (const [key, value] of Object.entries(page.headers)) {
          if (value != null) {
            headers[key] = String(value);
          }
        }
      }
      return {
        url,
        id: page.id ?? null,
        referer: typeof page.referer === "string" ? page.referer : null,
        headers: Object.keys(headers).length ? headers : null,
        timeout: Number(page.timeout) || null,
        filename: typeof page.filename === "string" ? page.filename : null,
        useBridge: page.useBridge === true || page.bridge === true
      };
    })
    .filter(Boolean);
}

export default class DownloadAdapter {
  static async createJob(payload) {
    const pages = Array.isArray(payload?.pages) ? payload.pages : [];
    if (!pages.length) {
      throw new Error("DownloadAdapter requires at least one page.");
    }
    return {
      id: generateJobId(),
      payload: {
        title: payload.title || "manga",
        chapter: payload.chapter || {},
        pages
      }
    };
  }

  static async runJob(job, options = {}, context = {}) {
    if (!job?.id || !job?.payload) {
      throw new Error("DownloadAdapter.runJob requires a job created via createJob.");
    }
    const response = await sendRuntimeMessage({
      kind: DOWNLOAD_KIND,
      jobId: job.id,
      title: job.payload.title,
      chapter: job.payload.chapter,
      pages: serializePages(job.payload.pages),
      options: {
        includeComicInfo: Boolean(options.includeComicInfo),
        includeEPUB: Boolean(options.includeEPUB)
      },
      context: normalizeContext(context)
    });
    if (!response?.ok) {
      const error = new Error(response?.error || "Download job failed.");
      if (response?.code) {
        error.code = response.code;
      }
      if (response?.cancelled) {
        error.code = error.code || "HK_CANCELLED";
      }
      throw error;
    }
    return {
      jobId: job.id,
      archive: response.archive || null,
      epub: response.epub || null
    };
  }

  static async buildArchive(payload, options = {}, context = {}) {
    const job = await DownloadAdapter.createJob(payload);
    const result = await DownloadAdapter.runJob(job, options, context);
    return result.archive;
  }

  static async cancelJob(jobId) {
    if (!jobId) {
      return false;
    }
    try {
      const response = await sendRuntimeMessage({ kind: DOWNLOAD_CANCEL_KIND, jobId });
      return Boolean(response?.ok);
    } catch (error) {
      console.warn("[HK] Failed to cancel download job:", error);
      return false;
    }
  }
}
