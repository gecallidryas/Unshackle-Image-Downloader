#!/usr/bin/env node
/**
 * Lightweight sanity checks for HK connectors and mappings.
 * Intended for CI/pre-push to catch regressions like missing domains or dropped gigaviewer mappings.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "vendor/hakuneko/index.json");
const REGISTRY_PATH = path.join(ROOT, "adapters/hakuneko/registry.js");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRegistry() {
  const text = fs.readFileSync(REGISTRY_PATH, "utf8");
  return text;
}

function ensureDomains(entries) {
  const missing = entries.filter((entry) => !Array.isArray(entry.domains) || entry.domains.length === 0);
  if (missing.length) {
    throw new Error(`Connectors missing domains: ${missing.map((e) => e.id).join(", ")}`);
  }
}

function ensureGigaviewerMappings(registryText) {
  const requiredIds = ["comicaction", "coreview.comicaction", "comicdays", "coreview.comicdays", "comicearthstar", "coreview.comicearthstar"];
  const missing = requiredIds.filter((id) => !registryText.includes(`id: "${id}"`) && !registryText.includes(`"${id}"`));
  if (missing.length) {
    throw new Error(`Missing gigaviewer mappings for: ${missing.join(", ")}`);
  }
}

function ensureFamilies(entries) {
  const missing = entries.filter((entry) => !entry.family);
  if (missing.length) {
    throw new Error(`Connectors missing family: ${missing.map((e) => e.id).join(", ")}`);
  }
}

function main() {
  const index = loadJson(INDEX_PATH);
  ensureDomains(index);
  ensureFamilies(index);
  ensureGigaviewerMappings(readRegistry());
  console.log("HK smoke checks passed.");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
