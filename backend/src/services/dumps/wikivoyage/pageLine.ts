/**
 * English Wikivoyage's articles, read from its `pages-articles` XML dump a
 * line at a time (#2089): what the world-view extraction reads instead of
 * asking the Action API page by page.
 *
 * A page is `<page>` … `</page>`: its `<title>`, its namespace `<ns>`, its id
 * (the first `<id>`, before the revision's own), a `<redirect title="…" />`
 * where it is one, and the revision's `<text>`, which runs over as many lines
 * as the wikitext has. The dump escapes every `<` inside a text, so a line of
 * an article never opens or closes an element. Only articles (namespace 0)
 * are handed over, and only theirs is the text kept: a template's or a
 * project page's is passed over as it streams by.
 */

/** One article or redirect of namespace 0, as the dump writes it. */
export interface DumpPage {
  id: number;
  title: string;
  /** The title a redirect points to, without a section; null for an article. */
  redirectTo: string | null;
  /** The wikitext of the page's revision; empty for a redirect's or a text the dump left out. */
  wikitext: string;
}

const TITLE = /<title>([^<]*)<\/title>/;
const NAMESPACE = /<ns>(-?\d+)<\/ns>/;
const ID = /<id>(\d+)<\/id>/;
const REDIRECT = /<redirect title="([^"]*)"\s*\/>/;
/** A text's opening tag, with what follows it on the line: `<text bytes="12" xml:space="preserve">== Regions ==`. */
const TEXT_OPEN = /<text\b[^>]*?(\/)?>/;
const TEXT_CLOSE = '</text>';

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text an XML-escaped string stands for: the five named entities and numeric references. */
export function unescapeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (entity, name: string | undefined, dec: string | undefined, hex: string | undefined) => {
    if (name) return NAMED[name];
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex!, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** A redirect's target without the section it points into (`Foo#Bar` is `Foo`). */
const withoutSection = (title: string) => {
  const at = title.indexOf('#');
  return (at < 0 ? title : title.slice(0, at)).trim();
};

/** Hands over every page of namespace 0 once its `</page>` is read. */
export class PageReader {
  private title: string | null = null;
  private namespace: number | null = null;
  private id: number | null = null;
  private redirectTo: string | null = null;
  /** The text's lines so far, while inside a `<text>` of an article; null outside one. */
  private text: string[] | null = null;
  private inText = false;
  private wikitext = '';

  constructor(private readonly onPage: (page: DumpPage) => void) {}

  line(line: string): void {
    if (this.inText) {
      this.textLine(line);
      return;
    }
    if (line.includes('<page>')) {
      this.reset();
      return;
    }
    if (line.includes('</page>')) {
      if (this.namespace === 0 && this.title !== null && this.id !== null) {
        this.onPage({ id: this.id, title: this.title, redirectTo: this.redirectTo, wikitext: this.wikitext });
      }
      this.reset();
      return;
    }
    const open = TEXT_OPEN.exec(line);
    if (open) {
      this.textOpened(line, open);
      return;
    }
    this.header(line);
  }

  /** Whether the file ended inside a page's text, which a whole dump never does. */
  get open(): boolean {
    return this.inText;
  }

  private header(line: string): void {
    const title = TITLE.exec(line);
    if (title) {
      this.title = unescapeXml(title[1]);
      return;
    }
    const namespace = NAMESPACE.exec(line);
    if (namespace) {
      this.namespace = Number(namespace[1]);
      return;
    }
    const redirect = REDIRECT.exec(line);
    if (redirect) {
      this.redirectTo = withoutSection(unescapeXml(redirect[1])) || null;
      return;
    }
    // The page's own id comes before its revision's and its contributor's.
    const id = this.id === null ? ID.exec(line) : null;
    if (id) this.id = Number(id[1]);
  }

  private textOpened(line: string, open: RegExpExecArray): void {
    if (open[1]) return; // `<text … />`: a text the dump left out.
    const rest = line.slice(open.index + open[0].length);
    this.inText = true;
    this.text = this.namespace === 0 ? [] : null;
    this.textLine(rest);
  }

  private textLine(line: string): void {
    const close = line.indexOf(TEXT_CLOSE);
    const part = close < 0 ? line : line.slice(0, close);
    this.text?.push(part);
    if (close < 0) return;
    this.inText = false;
    this.wikitext = this.text ? unescapeXml(this.text.join('\n')) : '';
    this.text = null;
  }

  private reset(): void {
    this.title = null;
    this.namespace = null;
    this.id = null;
    this.redirectTo = null;
    this.text = null;
    this.inText = false;
    this.wikitext = '';
  }
}
