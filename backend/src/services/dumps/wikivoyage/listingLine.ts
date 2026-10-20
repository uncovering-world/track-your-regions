/**
 * The items a Wikivoyage edition's listings name, read from its
 * `pages-articles` XML dump a line at a time (#1768, ADR-0128).
 *
 * A listing is a template in an article (`{{see | name=Roman Baths |
 * wikidata=Q2540426 }}`, German Wikivoyage's `{{vCard}}`, Italian's
 * `{{listing}}`), and the one thing every edition's templates share is the
 * `wikidata=` parameter. So every `wikidata=` in an article's text counts, in
 * whichever template an edition writes it. That includes an article's own
 * banner or quickbar, which names the article's subject: a guide with an
 * article about a place sends visitors there too. Only articles count
 * (namespace 0): a talk page or a template's documentation names an item
 * without sending anyone to it.
 */

const TITLE = /<title>([^<]*)<\/title>/;
const NAMESPACE = /<ns>(\d+)<\/ns>/;
const ITEM = /wikidata\s*=\s*(Q\d+)/gi;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'" };
const unescaped = (text: string) => text.replace(/&(amp|lt|gt|quot|#039);/g, (entity) => ENTITIES[entity]);

/**
 * Hands over each item an article's listings name, once per article, with the
 * article's title as the edition writes it.
 */
export class ListingReader {
  private title: string | null = null;
  private article = false;
  private readonly named = new Set<string>();
  /** The listings handed over so far, for the build's summary. */
  listings = 0;

  constructor(private readonly onListing: (item: string, title: string) => void) {}

  line(text: string): void {
    if (text.includes('<page>')) {
      this.title = null;
      this.article = false;
      this.named.clear();
      return;
    }
    const title = TITLE.exec(text);
    if (title) {
      this.title = unescaped(title[1]);
      return;
    }
    const namespace = NAMESPACE.exec(text);
    if (namespace) {
      this.article = namespace[1] === '0';
      return;
    }
    if (!this.article || this.title === null || !/wikidata/i.test(text)) return;
    for (const match of text.matchAll(ITEM)) {
      const item = match[1].toUpperCase();
      if (this.named.has(item)) continue;
      this.named.add(item);
      this.listings += 1;
      this.onListing(item, this.title);
    }
  }
}
