/**
 * The public dumps the catalogue reads (ADR-0101), and how the newest complete
 * file of each is found. Every URL the pipeline fetches is built here from a
 * fixed host and a name the host's own listing gave: nothing a caller sends
 * becomes a URL.
 *
 * A dated directory, never a `latest-` link: a `latest-` link can be repointed
 * while a 100 GB download is in flight, and on 2026-10-13 Wikidata's
 * `latest-all.json.gz` was a 38-byte stub while the new dump was written. A
 * file counts as complete when its host has published its checksum (Wikidata's
 * `sha1sums.txt`, a Wikipedia run's `dumpstatus.json`); the monthly pageview
 * files have none, so their size and a clean end of the compressed stream are
 * what verifies them (`read.ts`).
 */

export const WIKIMEDIA_DUMPS = 'https://dumps.wikimedia.org';

/** Every dump the catalog knows, by key: what a route accepts and a build is named by. */
export const DUMP_KEYS = [
  'wikidata-entities', 'wikidata-lexemes', 'enwiki-page', 'enwiki-page-props', 'enwiki-categorylinks',
  'enwiki-langlinks', 'pageviews-user',
] as const;
export type DumpKey = typeof DUMP_KEYS[number];

/** One dated file of a dump, as its host lists it. */
export interface DumpFile {
  key: DumpKey;
  fileName: string;
  url: string;
  /** The dump's own date, `YYYY-MM-DD`. */
  date: string;
  checksum: { kind: 'sha1'; value: string } | null;
  expectedBytes: number | null;
  compression: 'gzip' | 'bzip2';
}

/** Reads a host's page as text: `fetchText` in `fetch.ts`, a fake in the specs. */
export type TextReader = (url: string) => Promise<string>;
/** The size a host answers for a file (`Content-Length`), or null. */
export type SizeReader = (url: string) => Promise<number | null>;

export interface DumpDescriptor {
  key: DumpKey;
  /** Who publishes the dump, which the admin panel groups by. */
  source: string;
  title: string;
  /** Whether a file is a day's dump or a month's counts, which its date stands for. */
  datedBy: 'day' | 'month';
  /** What the dump holds, for the admin panel. */
  about: string;
  /** Whether a name is one of the dump's dated files, which a local copy keeps (#1456). */
  isFileName: (name: string) => boolean;
  /**
   * The newest complete file the host lists, or, with `only`, the newest of
   * those whose name it accepts: a build from the local copy resolves the
   * copy's own file, so its checksum and size are still the host's.
   */
  resolve(read: TextReader, size: SizeReader, only?: (fileName: string) => boolean): Promise<DumpFile | null>;
}

const DIGITS = /^\d+$/;

/** `prefix`, then a date of `digits` digits, then `suffix`: the name of one of a dump's dated files. */
function datedName(prefix: string, digits: number, suffix: string): (name: string) => boolean {
  return name => name.length === prefix.length + digits + suffix.length
    && name.startsWith(prefix) && name.endsWith(suffix)
    && DIGITS.test(name.slice(prefix.length, prefix.length + digits));
}

/** A name the pipeline will write to disk or put in a URL: one path segment, nothing else. */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function safeFileName(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`Refusing a dump file name that is not one plain segment: ${name}`);
  return name;
}

const isoDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/** The dated directories a listing names (`20261012/`), newest first. */
export function datedDirectories(html: string): string[] {
  const dates = [...html.matchAll(/href="(\d{8})\/"/g)].map(m => m[1]);
  return [...new Set(dates)].sort().reverse();
}

/** The sha1 a `sha1sums.txt` gives a file, or null where it lists none. */
export function sha1Of(sums: string, fileName: string): string | null {
  for (const line of sums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === fileName && /^[0-9a-f]{40}$/.test(hash ?? '')) return hash;
  }
  return null;
}

/** How many dated directories back a resolver looks before it says there is none. */
const DIRECTORIES_TRIED = 6;

function wikidataJson(key: DumpKey, part: 'all' | 'lexemes', title: string, about: string): DumpDescriptor {
  const base = `${WIKIMEDIA_DUMPS}/wikidatawiki/entities`;
  return {
    key, source: 'Wikidata', title, datedBy: 'day', about, isFileName: datedName('wikidata-', 8, `-${part}.json.gz`),
    async resolve(read, size, only) {
      for (const dir of datedDirectories(await read(`${base}/`)).slice(0, DIRECTORIES_TRIED)) {
        const fileName = safeFileName(`wikidata-${dir}-${part}.json.gz`);
        if (only && !only(fileName)) continue;
        const sha1 = sha1Of(await read(`${base}/${dir}/wikidata-${dir}-sha1sums.txt`).catch(() => ''), fileName);
        if (!sha1) continue;
        const url = `${base}/${dir}/${fileName}`;
        return { key, fileName, url, date: isoDate(dir), checksum: { kind: 'sha1', value: sha1 }, expectedBytes: await size(url), compression: 'gzip' };
      }
      return null;
    },
  };
}

interface DumpStatus {
  jobs?: Record<string, { status?: string; files?: Record<string, { size?: number; sha1?: string; url?: string }> }>;
}

function enwikiTable(key: DumpKey, job: string, table: string, title: string, about: string): DumpDescriptor {
  const base = `${WIKIMEDIA_DUMPS}/enwiki`;
  return {
    key, source: 'English Wikipedia', title, datedBy: 'day', about: `The ${table} table: ${about}`,
    isFileName: datedName('enwiki-', 8, `-${table}.sql.gz`),
    async resolve(read, _size, only) {
      for (const dir of datedDirectories(await read(`${base}/`)).slice(0, DIRECTORIES_TRIED)) {
        if (only && !only(`enwiki-${dir}-${table}.sql.gz`)) continue;
        let status: DumpStatus;
        try {
          status = JSON.parse(await read(`${base}/${dir}/dumpstatus.json`)) as DumpStatus;
        } catch {
          continue;
        }
        const entry = status.jobs?.[job];
        const fileName = `enwiki-${dir}-${table}.sql.gz`;
        const file = entry?.files?.[fileName];
        if (entry?.status !== 'done' || !file?.sha1 || !/^[0-9a-f]{40}$/.test(file.sha1)) continue;
        return {
          key, fileName: safeFileName(fileName), url: `${base}/${dir}/${fileName}`, date: isoDate(dir),
          checksum: { kind: 'sha1', value: file.sha1 }, expectedBytes: file.size ?? null, compression: 'gzip',
        };
      }
      return null;
    },
  };
}

const pageviews: DumpDescriptor = {
  key: 'pageviews-user',
  source: 'Wikimedia pageviews',
  title: 'Readers per article, by month',
  datedBy: 'month',
  about: 'Every article of every edition with its month total and daily counts, people only (ADR-0055). No checksum is published: the size and a clean end of the bz2 stream verify it.',
  isFileName: datedName('pageviews-', 6, '-user.bz2'),
  async resolve(read, size, only) {
    const base = `${WIKIMEDIA_DUMPS}/other/pageview_complete/monthly`;
    const years = [...(await read(`${base}/`)).matchAll(/href="(\d{4})\/"/g)].map(m => m[1]).sort().reverse();
    // The newest is among the last three months; a month asked for by name
    // (readership's twelve, #1436) may be any of the last two years'.
    for (const year of years.slice(0, only ? 3 : 2)) {
      const months = [...(await read(`${base}/${year}/`)).matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]).sort().reverse();
      for (const month of only ? months : months.slice(0, 3)) {
        const fileName = safeFileName(`pageviews-${month.replace('-', '')}-user.bz2`);
        if (only && !only(fileName)) continue;
        const url = `${base}/${year}/${month}/${fileName}`;
        const bytes = await size(url);
        if (bytes === null) continue;
        return { key: 'pageviews-user', fileName, url, date: `${month}-01`, checksum: null, expectedBytes: bytes, compression: 'bzip2' };
      }
    }
    return null;
  },
};

export const DUMPS: readonly DumpDescriptor[] = [
  wikidataJson('wikidata-entities', 'all', 'All entities',
    'One entity per line, every statement at every rank: the source of the local Wikidata subset (#1434).'),
  wikidataJson('wikidata-lexemes', 'lexemes', 'Lexemes',
    'The same JSON format at a size that verifies the pipeline in minutes.'),
  enwikiTable('enwiki-page', 'pagetable', 'page', 'Pages', 'every page with its title, namespace, length and redirect flag (#1440).'),
  enwikiTable('enwiki-page-props', 'pagepropstable', 'page_props', 'Page properties', 'among them the Wikidata item of each article.'),
  enwikiTable('enwiki-categorylinks', 'categorylinkstable', 'categorylinks', 'Category links', 'which category each page is in (#1440).'),
  enwikiTable('enwiki-langlinks', 'langlinkstable', 'langlinks', 'Language links', 'each article\'s articles in other editions.'),
  pageviews,
];

export function dumpNamed(key: string): DumpDescriptor | undefined {
  return DUMPS.find(dump => dump.key === key);
}
