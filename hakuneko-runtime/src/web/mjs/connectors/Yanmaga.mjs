import SpeedBinb from './templates/SpeedBinb.mjs';
import Manga from '../engine/Manga.mjs';

export default class Yanmaga extends SpeedBinb {
    constructor() {
        super();
        super.id = 'yanmaga';
        super.label = 'Yanmaga';
        this.tags = ['manga', 'japanese'];
        this.url = 'https://yanmaga.jp';
        this.links = {
            login: 'https://yanmaga.jp/customers/sign-in'
        };
    }

    async _getMangaFromURI(uri) {
        const request = new Request(uri);
        const [data] = await this.fetchDOM(request, '.detailv2-outline-title');
        const id = uri.pathname;
        const title = data.textContent.trim();
        return new Manga(this, id, title);
    }

    async _getMangas() {
        const request = new Request(new URL('comics', this.url));
        const data = await this.fetchDOM(request, '.ga-comics-book-item');
        return data.map(element => {
            return {
                id: this.getRootRelativeOrAbsoluteLink(element, this.url),
                title: element.querySelector('.mod-book-title').textContent.trim(),
            };
        });
    }

    async _getChapters(manga) {
        try {
            // ATTEMPT 1: Try to read from currently open page (if user has it open with dropdown expanded)
            const currentPageChapters = await this._tryGetChaptersFromCurrentPage(manga.id);
            if (currentPageChapters && currentPageChapters.length > 0) {
                console.log('[Yanmaga] Using current page chapters:', currentPageChapters.length);
                return currentPageChapters;
            }

            // ATTEMPT 2: Fallback to fetching fresh page (will only get initially visible)
            const uri = new URL(manga.id, this.url);
            const request = new Request(uri, this.requestOptions);
            const links = await this.fetchDOM(request, 'a.mod-episode-link');

            console.log('[Yanmaga] Using fetched chapters (may be incomplete):', links.length);

            const chapters = [];
            for (const link of links) {
                const href = link.href || link.getAttribute('href');
                if (!href) continue;

                const id = this.getRootRelativeOrAbsoluteLink(link, uri.href);
                const titleElement = link.querySelector('.mod-episode-title');
                const title = titleElement?.textContent?.trim() || 'Untitled Episode';

                chapters.push({ id, title });
            }

            return chapters;
        } catch (error) {
            console.error('[Yanmaga] Chapter extraction failed:', error);
            return [];
        }
    }

    /**
     * Helper: Try to get chapters from user's currently open page
     * Returns null if page not open or timeout
     */
    async _tryGetChaptersFromCurrentPage(mangaPath) {
        const tabsApi = typeof chrome !== 'undefined' ? chrome.tabs : null;
        if (!tabsApi || typeof tabsApi.query !== 'function' || typeof tabsApi.sendMessage !== 'function') {
            return null;
        }

        const isYanmagaHost = (host) => {
            if (!host) return false;
            const normalized = String(host).toLowerCase();
            if (normalized === 'yanmaga.jp' || normalized.endsWith('.yanmaga.jp')) {
                return true;
            }
            return normalized === 'viewer-yanmaga.comici.jp';
        };

        const getTabHost = (tab) => {
            const value = tab?.url || tab?.pendingUrl || '';
            if (!value) return '';
            try {
                return new URL(value).hostname;
            } catch {
                return '';
            }
        };

        const candidateTabs = await new Promise((resolve) => {
            try {
                tabsApi.query({ url: ['*://*.yanmaga.jp/*', 'https://yanmaga.jp/*', '*://*.comici.jp/*'] }, resolve);
            } catch {
                resolve([]);
            }
        });

        const targetTab = Array.isArray(candidateTabs)
            ? candidateTabs.find((tab) => isYanmagaHost(getTabHost(tab)))
            : null;

        if (!targetTab?.id || !Number.isInteger(targetTab.id)) {
            return null;
        }

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                resolve(null);
            }, 2500);

            try {
                tabsApi.sendMessage(
                    targetTab.id,
                    { action: 'GET_YANMAGA_CHAPTERS_FROM_CURRENT_PAGE', url: mangaPath },
                    (response) => {
                        clearTimeout(timer);
                        if (chrome.runtime?.lastError) {
                            resolve(null);
                            return;
                        }
                        if (response?.ok && Array.isArray(response.chapters) && response.chapters.length) {
                            console.log('[Yanmaga] Got chapters from current page:', response.chapters.length);
                            resolve(response.chapters);
                            return;
                        }
                        resolve(null);
                    }
                );
            } catch {
                clearTimeout(timer);
                resolve(null);
            }
        });
    }

    _getPageList(manga, chapter, callback) {
        const uri = new URL(chapter.id, this.url);
        fetch(uri)
            .then(response => {
                if (response.redirected) {
                    const newurl = new URL(response.url);
                    return super._getPageList(manga, { id: newurl.pathname + newurl.search }, callback);
                }
                if (!uri.searchParams.get('cid')) {
                    throw new Error(`You need to login to see ${chapter.title}`);
                }
                return super._getPageList(manga, chapter, callback);
            })
            .catch(error => {
                console.error(error, chapter);
                callback(error, undefined);
            });
    }
}
