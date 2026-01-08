/**
 * Deduplication Module Index
 * 
 * Loads all dedupe modules in the correct order.
 * Import this file in background.js via importScripts.
 */

// Note: In service worker context, modules are loaded via importScripts
// This file serves as documentation of the load order

/*
Load order for service worker (add to background.js importScripts):

importScripts(
  "src/dedupe/db.js",
  "src/dedupe/queue.js", 
  "src/dedupe/messages.js",
  "src/dedupe/byte-hash.js",
  "src/dedupe/pixel-hash.js",
  "src/dedupe/perceptual.js",
  "src/dedupe/ssim.js",
  "src/dedupe/pipeline.js"
);

After loading, the following globals are available:
- DedupeDB: IndexedDB operations
- AsyncQueue, DedupeQueues: Job queue management
- DedupeMessageTypes, DedupeMessages: Message definitions
- DedupeByteHash: L1 byte hashing
- DedupePixelHash: L2 pixel hashing
- DedupePerceptual: L3 perceptual hashing
- DedupeSSIM: SSIM confirmation
- DedupePipeline: Main orchestrator

Message handling:
Add to your message listener:

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Check if it's a dedupe message
  if (message.type?.startsWith("DEDUPE_")) {
    DedupePipeline.handleDedupeMessage(message, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // Async response
  }
  // ... other handlers
});
*/

console.log("[Dedupe] Module index loaded. Use importScripts to load individual modules.");
