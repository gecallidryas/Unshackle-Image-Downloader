import { sendRuntimeRequest } from "./runtimeMessaging.mjs";

const NAMESPACE_PREFIX = "hk.";
const STORAGE_ACTION = "HK_STORAGE_OP";
const STORAGE_TIMEOUT_MS = 12000;

function scoped(key) {
  const suffix = String(key ?? "").trim();
  if (!suffix) {
    throw new Error("StorageAdapter requires a non-empty key.");
  }
  return `${NAMESPACE_PREFIX}${suffix}`;
}

async function dispatchStorage(message) {
  const response = await sendRuntimeRequest(
    { action: STORAGE_ACTION, ...message },
    { timeout: STORAGE_TIMEOUT_MS, requireOk: true }
  );
  return response?.data;
}

export default class StorageAdapter {
  static #platform = String(globalThis?.navigator?.platform || "").toLowerCase();

  static sanatizePath(path) {
    let value = String(path ?? "");
    value = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
    const platform = StorageAdapter.#platform;
    if (platform.startsWith("win")) {
      value = value.replace(/[\\/:*?"<>|]/g, "");
    } else if (platform.startsWith("linux")) {
      value = value.replace(/\//g, "");
    } else if (platform.startsWith("mac") || platform.startsWith("darwin")) {
      value = value.replace(/[/:]/g, "");
    }
    return value.replace(/[.\s]+$/g, "").trim();
  }

  static async get(key, fallback = null) {
    const scopedKey = scoped(key);
    const value = await dispatchStorage({ op: "get", key: scopedKey, fallback });
    return value ?? fallback;
  }

  static async set(key, value) {
    const scopedKey = scoped(key);
    await dispatchStorage({ op: "set", key: scopedKey, value });
    return value;
  }

  static async remove(key) {
    const scopedKey = scoped(key);
    await dispatchStorage({ op: "remove", key: scopedKey });
  }

  static async list(prefix = "") {
    const data = await dispatchStorage({ op: "list" }) || {};
    const entries = Object.entries(data).filter(([key]) => key.startsWith(NAMESPACE_PREFIX));
    if (!prefix) {
      return entries.map(([key, value]) => ({ key: key.slice(NAMESPACE_PREFIX.length), value }));
    }
    const scopedPrefix = `${NAMESPACE_PREFIX}${prefix}`;
    return entries
      .filter(([key]) => key.startsWith(scopedPrefix))
      .map(([key, value]) => ({ key: key.slice(NAMESPACE_PREFIX.length), value }));
  }
}
