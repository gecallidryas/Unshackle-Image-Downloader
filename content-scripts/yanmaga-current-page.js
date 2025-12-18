// Yanmaga content script - injects into page to read current DOM
// This runs in the page context and can see chapters after dropdown clicks

(() => {
    'use strict';

    // Listen for requests from extension
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;

        if (event.data?.type === 'UNSHACKLE_GET_YANMAGA_CHAPTERS') {
            try {
                // Read from CURRENT page DOM (after user clicked dropdown)
                const links = document.querySelectorAll('a.mod-episode-link');
                const chapters = [];

                for (const link of links) {
                    const href = link.href || link.getAttribute('href');
                    if (!href) continue;

                    const titleElement = link.querySelector('.mod-episode-title');
                    const title = titleElement?.textContent?.trim() || 'Untitled Episode';

                    // Extract pathname
                    const url = new URL(href);
                    const id = url.pathname;

                    chapters.push({ id, title });
                }

                console.log('[Yanmaga Content] Found chapters in current page:', chapters.length);

                // Send back to extension
                window.postMessage({
                    type: 'UNSHACKLE_YANMAGA_CHAPTERS_RESPONSE',
                    chapters,
                    timestamp: Date.now()
                }, '*');
            } catch (error) {
                console.error('[Yanmaga Content] Error:', error);
                window.postMessage({
                    type: 'UNSHACKLE_YANMAGA_CHAPTERS_RESPONSE',
                    chapters: [],
                    error: error.message
                }, '*');
            }
        }
    });

    console.log('[Yanmaga Content Script] Loaded and ready');
})();
