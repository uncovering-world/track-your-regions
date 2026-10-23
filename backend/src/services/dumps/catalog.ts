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
 *
 * OpenStreetMap's planet is the one dump on another host (ADR-0134). Its
 * server's `robots.txt` keeps every agent but `wget` off its listings, so the
 * planet is found without one: its weekly files are named by the Monday they
 * start (`planet-261012.osm.pbf`), and the newest is the most recent Monday
 * whose `.md5` the host serves.
 */

export const WIKIMEDIA_DUMPS = 'https://dumps.wikimedia.org';
export const OSM_PLANET = 'https://planet.openstreetmap.org';

/** Every dump the catalog knows, by key: what a route accepts and a build is named by. */
export const DUMP_KEYS = [
  'wikidata-entities', 'wikidata-lexemes', 'enwiki-page', 'enwiki-page-props', 'enwiki-linktarget', 'enwiki-categorylinks',
  'enwiki-langlinks', 'pageviews-user', 'wikipedia-redirects', 'wikidata-redirects', 'wikivoyage-usage', 'osm-planet',
] as const;
export type DumpKey = typeof DUMP_KEYS[number];

/** One dated file of a dump, as its host lists it. */
export interface DumpFile {
  key: DumpKey;
  fileName: string;
  url: string;
  /** The dump's own date, `YYYY-MM-DD`. */
  date: string;
  checksum: { kind: 'sha1' | 'md5'; value: string } | null;
  expectedBytes: number | null;
  /**
   * How the file's text is decoded to lines, or `none` for a binary file a
   * tool reads whole (the planet's PBF): that one is kept as a verified local
   * copy and never read by lines (`holdVerifiedCopy` in `read.ts`).
   */
  compression: 'gzip' | 'bzip2' | 'none';
}

/**
 * The host has no such file: it answered 404. A resolver passes over a file
 * the host does not have yet, and fails on any other error, since a host
 * that is down or limiting is no answer about which file is newest.
 */
export class NotOnHost extends Error {}

/** Reads a host's page as text: `fetchText` in `fetch.ts`, a fake in the specs. It throws `NotOnHost` on a 404. */
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

/** The md5 a `.md5` file gives for `fileName` (`<hash>  <name>`), or null where it names another file. */
export function md5Of(text: string, fileName: string): string | null {
  const [hash, name] = text.trim().split(/\s+/);
  return name === fileName && /^[0-9a-f]{32}$/.test(hash ?? '') ? hash : null;
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

/**
 * One file of a wiki's dated dump run, where its status file says the job that
 * wrote it is done and gives its sha1: `wiki` is the edition's database name
 * (`enwiki`, `zh_min_nanwiki`, `enwikivoyage`), `dir` the run's date
 * (`20261001`), `suffix` what follows the date in the file's name. Null where
 * the run has not finished it.
 */
export async function wikiRunFile(
  read: TextReader, key: DumpKey, wiki: string, dir: string, job: string, suffix: string, compression: DumpFile['compression'],
): Promise<DumpFile | null> {
  if (!/^[a-z_]+wiki(voyage)?$/.test(wiki) || !DIGITS.test(dir)) throw new Error(`Refusing a wiki dump directory that is not one: ${wiki}/${dir}`);
  const base = `${WIKIMEDIA_DUMPS}/${wiki}/${dir}`;
  let status: DumpStatus;
  try {
    status = JSON.parse(await read(`${base}/dumpstatus.json`)) as DumpStatus;
  } catch {
    return null;
  }
  const entry = status.jobs?.[job];
  const fileName = `${wiki}-${dir}-${suffix}`;
  const file = entry?.files?.[fileName];
  if (entry?.status !== 'done' || !file?.sha1 || !/^[0-9a-f]{40}$/.test(file.sha1)) return null;
  return {
    key, fileName: safeFileName(fileName), url: `${base}/${fileName}`, date: isoDate(dir),
    checksum: { kind: 'sha1', value: file.sha1 }, expectedBytes: file.size ?? null, compression,
  };
}

/** The file of one table in a Wikipedia edition's dump directory, as `wikiRunFile` finds it. */
export async function wikipediaTableFile(
  read: TextReader, key: DumpKey, wiki: string, dir: string, job: string, table: string,
): Promise<DumpFile | null> {
  if (!/^[a-z_]+wiki$/.test(wiki)) throw new Error(`Refusing a Wikipedia dump directory that is not one: ${wiki}/${dir}`);
  return wikiRunFile(read, key, wiki, dir, job, `${table}.sql.gz`, 'gzip');
}

/** The job of a wiki's run that writes which Wikidata items each page uses, and the file it writes. */
export const USAGE_JOB = 'wbcentityusagetable';
export const USAGE_SUFFIX = 'wbc_entity_usage.sql.gz';

/**
 * English Wikivoyage's item usage, the build's own file: a build reads every
 * edition's usage table of the same date (#1768).
 */
const wikivoyageUsage: DumpDescriptor = {
  key: 'wikivoyage-usage',
  source: 'Wikivoyage editions',
  title: 'Item usage',
  datedBy: 'day',
  about: 'The wbc_entity_usage table: which Wikidata items each page uses. A build reads this and the same date\'s usage and '
    + 'page tables of every edition, and keeps each item an edition\'s guide articles use: the travel-guide witness of '
    + 'whether a place is one a visitor goes to (#1768, decided on #1718).',
  isFileName: datedName('enwikivoyage-', 8, `-${USAGE_SUFFIX}`),
  async resolve(read, _size, only) {
    const base = `${WIKIMEDIA_DUMPS}/enwikivoyage`;
    for (const dir of datedDirectories(await read(`${base}/`)).slice(0, DIRECTORIES_TRIED)) {
      if (only && !only(`enwikivoyage-${dir}-${USAGE_SUFFIX}`)) continue;
      const file = await wikiRunFile(read, 'wikivoyage-usage', 'enwikivoyage', dir, USAGE_JOB, USAGE_SUFFIX, 'gzip');
      if (file) return file;
    }
    return null;
  },
};

/** One table of a wiki's run, found in the newest run that has written it. */
function wikiTable(wiki: string, key: DumpKey, job: string, table: string, title: string, about: string, source: string): DumpDescriptor {
  const base = `${WIKIMEDIA_DUMPS}/${wiki}`;
  return {
    key, source, title, datedBy: 'day', about: `The ${table} table: ${about}`,
    isFileName: datedName(`${wiki}-`, 8, `-${table}.sql.gz`),
    async resolve(read, _size, only) {
      for (const dir of datedDirectories(await read(`${base}/`)).slice(0, DIRECTORIES_TRIED)) {
        if (only && !only(`${wiki}-${dir}-${table}.sql.gz`)) continue;
        const file = await wikipediaTableFile(read, key, wiki, dir, job, table);
        if (file) return file;
      }
      return null;
    },
  };
}

function enwikiTable(key: DumpKey, job: string, table: string, title: string, about: string, source = 'English Wikipedia'): DumpDescriptor {
  return wikiTable('enwiki', key, job, table, title, about, source);
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

/** How many weeks before this one the planet's resolver looks: the host keeps its weekly files far longer. */
const PLANET_WEEKS_BACK = 6;

/** `YYMMDD` of the Monday on or before `day`, `weeksBack` weeks earlier, in UTC. */
function mondayCode(day: Date, weeksBack: number): string {
  const monday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7 * weeksBack);
  return monday.toISOString().slice(2, 10).replaceAll('-', '');
}

const planet: DumpDescriptor = {
  key: 'osm-planet',
  source: 'OpenStreetMap',
  title: 'Planet',
  datedBy: 'day',
  about: 'The whole OpenStreetMap database as one PBF file, released weekly and verified by its md5. It is kept as a local '
    + 'copy, which the OpenStreetMap layer is cut from (ADR-0134); it is never read by lines.',
  isFileName: datedName('planet-', 6, '.osm.pbf'),
  async resolve(read, size, only) {
    const base = `${OSM_PLANET}/pbf`;
    for (let weeks = 0; weeks <= PLANET_WEEKS_BACK; weeks += 1) {
      const code = mondayCode(new Date(), weeks);
      const fileName = safeFileName(`planet-${code}.osm.pbf`);
      if (only && !only(fileName)) continue;
      // A week whose file is not out yet answers 404 for its checksum. Any
      // other failure ends the resolve: passing over it could pick an older
      // planet, a download of some 95 GB for nothing.
      const text = await read(`${base}/${fileName}.md5`).catch((error: unknown) => {
        if (error instanceof NotOnHost) return null;
        throw error;
      });
      if (text === null) continue;
      // A checksum the host serves but that names no md5 for this file is no
      // answer either: an older planet is not taken in its place.
      const md5 = md5Of(text, fileName);
      if (!md5) throw new Error(`${base}/${fileName}.md5 gives no md5 for ${fileName}`);
      const url = `${base}/${fileName}`;
      return { key: 'osm-planet', fileName, url, date: isoDate(`20${code}`), checksum: { kind: 'md5', value: md5 }, expectedBytes: await size(url), compression: 'none' };
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
  enwikiTable('enwiki-linktarget', 'linktargettable', 'linktarget', 'Link targets', 'the namespace and title each category link names by id (#1440).'),
  enwikiTable('enwiki-categorylinks', 'categorylinkstable', 'categorylinks', 'Category links', 'which category each page is in, named by its link target (#1440).'),
  enwikiTable('enwiki-langlinks', 'langlinkstable', 'langlinks', 'Language links', 'each article\'s articles in other editions.'),
  enwikiTable('wikipedia-redirects', 'redirecttable', 'redirect', 'Redirects',
    'each redirect page and the title it points to. A build reads this and the page table of the same date in every edition readership counts, and keeps the redirects to an article with a Wikidata item, so their views count under it (#1650, ADR-0055 decision 2).',
    'Wikipedia editions'),
  wikiTable('wikidatawiki', 'wikidata-redirects', 'redirecttable', 'redirect', 'Item redirects',
    'each redirect page of Wikidata and the item it points to. A build reads this and the page table of the same run, and keeps every item redirected to another, so a place registered under an item Wikidata has since merged away is still found (ADR-0143 decision 3, #1895).',
    'Wikidata'),
  pageviews,
  wikivoyageUsage,
  planet,
];

export function dumpNamed(key: string): DumpDescriptor | undefined {
  return DUMPS.find(dump => dump.key === key);
}
