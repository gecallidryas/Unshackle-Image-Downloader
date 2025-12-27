import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class NHentaiCom extends Connector {

    constructor() {
        super();
        super.id = 'nhentaicom';
        super.label = 'NHentai.Com';
        this.tags = [ 'hentai' ];
        this.url = 'https://nhentai.com';
        // Preserve session + referer for API and image fetches
        this.requestOptions.credentials = 'include';
        this.requestOptions.headers.set('referer', `${this.url}/`);
    }

    async _getMangas() {
        let msg = 'This website provides a manga list that is to large to scrape, please copy and paste the URL containing the images directly from your browser into HakuNeko.';
        throw new Error(msg);
    }

    async _getChapters(manga) {
        return [ Object.assign({language: '' }, manga) ];
    }

    async _getPages(chapter) {
        const uri = new URL(`/api/comics/${chapter.id}/images`, this.url);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request);
        return data.images.map(el => {
            const src = el.source_url || '';
            return src.startsWith('//') ? `https:${src}` : src;
        });
    }

    async _getMangaFromURI(uri) {
        const slug = uri.pathname.split('/').pop();
        const request = new Request(new URL(`/api/comics/${slug}`, this.url), this.requestOptions);
        const data = await this.fetchJSON(request);
        return new Manga(this, data.slug, data.title);
    }
}
