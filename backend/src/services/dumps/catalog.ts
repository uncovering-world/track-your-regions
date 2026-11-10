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
 * `sha1sums.txt`, a Wikipedia run's `dumpstatus.json`, a content export's
 * `SHA256SUMS`); the monthly pageview
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
  'wikidata-entities', 'enwiki-page', 'enwiki-page-props', 'enwiki-linktarget', 'enwiki-categorylinks',
  'pageviews-user', 'wikipedia-redirects', 'wikidata-redirects', 'wikivoyage-usage', 'wikivoyage-pages',
  'osm-planet',
] as const;
export type DumpKey = typeof DUMP_KEYS[number];

/** One dated file of a dump, as its host lists it. */
export interface DumpFile {
  key: DumpKey;
  fileName: string;
  url: string;
  /** The dump's own date, `YYYY-MM-DD`. */
  date: string;
  checksum: { kind: 'sha1' | 'md5' | 'sha256'; value: string } | null;
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
  /** What the dump holds, for the admin panel, in a plain sentence or two (`DUMP_WORDS`). */
  about: string;
  /** How a file of it is read and verified, which the panel shows behind an info mark (`DUMP_WORDS`). */
  how: string;
  /**
   * The copy whose build reads this dump's file as one of its inputs, where it
   * keeps nothing of its own: English Wikipedia's page properties, link targets
   * and category links are read by the structure build of `enwiki-page`. The
   * panel names it under that copy, not as a row that was never built (#2415).
   */
  inputOf?: DumpKey;
  /** Whether a name is one of the dump's dated files, which a local copy keeps (#1456). */
  isFileName: (name: string) => boolean;
  /**
   * Whether a name is one of the other files a build of the dump reads beside
   * its own, each kept in the local copy too: every counted edition's redirect
   * and page tables, Wikidata's page table, every Wikivoyage edition's usage
   * and page tables, English Wikivoyage's page properties (#2419). A newer one
   * replaces the older copy as the dump's own file does.
   */
  readsAlso?: (name: string) => boolean;
  /**
   * False where a build the network cut is never tried again: the planet,
   * whose failed update waits for the next one (ADR-0134 decision 1,
   * ADR-0136 decision 3). Every other dump's build is (#2419).
   */
  retriesACut?: false;
  /**
   * The newest complete file the host lists, or, with `only`, the newest of
   * those whose name it accepts: a build from the local copy resolves the
   * copy's own file, so its checksum and size are still the host's.
   */
  resolve(read: TextReader, size: SizeReader, only?: (fileName: string) => boolean): Promise<DumpFile | null>;
}

/** A dump as its resolver knows it, before the panel's words are put to it (`DUMP_WORDS`). */
type DumpSource = Omit<DumpDescriptor, 'about' | 'how' | 'inputOf'>;

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

/** The sha256 a `SHA256SUMS` gives a file, or null where it lists none. */
export function sha256Of(sums: string, fileName: string): string | null {
  for (const line of sums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === fileName && /^[0-9a-f]{64}$/.test(hash ?? '')) return hash;
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

function wikidataJson(key: DumpKey, part: 'all', title: string): DumpSource {
  const base = `${WIKIMEDIA_DUMPS}/wikidatawiki/entities`;
  return {
    key, source: 'Wikidata', title, datedBy: 'day', isFileName: datedName('wikidata-', 8, `-${part}.json.gz`),
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
const wikivoyageUsage: DumpSource = {
  key: 'wikivoyage-usage',
  source: 'Wikivoyage editions',
  title: 'Item usage',
  datedBy: 'day',
  isFileName: datedName('enwikivoyage-', 8, `-${USAGE_SUFFIX}`),
  readsAlso: name => /^[a-z_]+wikivoyage-\d{8}-(wbc_entity_usage|page)\.sql\.gz$/.test(name),
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

/** The job that writes a wiki's page properties, among them each page's Wikidata item. */
export const PAGE_PROPS_JOB = 'pagepropstable';

/**
 * Where MediaWiki Content File Exports publish every wiki's current revisions
 * (#2355): one dated directory a month, `<wiki>/<YYYY-MM-DD>/xml/bzip2/`, as of
 * 00:00 UTC on the 1st and published about a week later, with a `SHA256SUMS`
 * that appears only once the whole export is written. dumps.wikimedia.org calls
 * the XML dumps of a wiki's own run deprecated and names these their
 * replacement (https://wikitech.wikimedia.org/wiki/MediaWiki_Content_File_Exports).
 */
export const CONTENT_CURRENT = `${WIKIMEDIA_DUMPS}/other/mediawiki_content_current`;

/** An export's part: the wiki, the export's date, and the page ids it holds, both ends inclusive. */
const CONTENT_PART = /^enwikivoyage-(\d{4}-\d{2}-\d{2})-p\d+p\d+\.xml\.bz2$/;

/** The dated directories an exports listing names (`2026-10-01/`), newest first. */
export function contentDirectories(html: string): string[] {
  const dates = [...html.matchAll(/href="(\d{4}-\d{2}-\d{2})\/"/g)].map(m => m[1]);
  return [...new Set(dates)].sort().reverse();
}

/**
 * English Wikivoyage's articles, the build's own file: a build reads it and
 * the same date's page properties of the wiki's own run, and keeps every
 * article's text and item, which the world-view extraction reads instead of
 * the live wiki (#2089). Read from the content exports since #2355; a wiki this
 * size is one part, and an export the host splits into more is refused by name
 * rather than read in part.
 */
const wikivoyagePages: DumpSource = {
  key: 'wikivoyage-pages',
  source: 'Wikivoyage editions',
  title: 'English Wikivoyage\'s articles',
  datedBy: 'day',
  isFileName: name => CONTENT_PART.test(name),
  readsAlso: datedName('enwikivoyage-', 8, '-page_props.sql.gz'),
  async resolve(read, size, only) {
    const base = `${CONTENT_CURRENT}/enwikivoyage`;
    for (const date of contentDirectories(await read(`${base}/`)).slice(0, DIRECTORIES_TRIED)) {
      const dir = `${base}/${date}/xml/bzip2`;
      let sums: string;
      try {
        sums = await read(`${dir}/SHA256SUMS`);
      } catch (error) {
        if (error instanceof NotOnHost) continue;
        throw error;
      }
      const parts = sums.split('\n').map(line => line.trim().split(/\s+/)[1] ?? '')
        .filter(name => CONTENT_PART.exec(name)?.[1] === date);
      if (parts.length === 0) continue;
      if (parts.length > 1) {
        throw new Error(`English Wikivoyage's ${date} export is in ${parts.length} parts, and this build reads one`);
      }
      const fileName = safeFileName(parts[0]);
      if (only && !only(fileName)) continue;
      const sha256 = sha256Of(sums, fileName);
      if (!sha256) continue;
      const url = `${dir}/${fileName}`;
      return { key: 'wikivoyage-pages', fileName, url, date, checksum: { kind: 'sha256', value: sha256 }, expectedBytes: await size(url), compression: 'bzip2' };
    }
    return null;
  },
};

/** One table of a wiki's run, found in the newest run that has written it. */
function wikiTable(
  wiki: string, key: DumpKey, job: string, table: string, title: string, source: string,
  readsAlso?: (name: string) => boolean,
): DumpSource {
  const base = `${WIKIMEDIA_DUMPS}/${wiki}`;
  return {
    key, source, title, datedBy: 'day',
    isFileName: datedName(`${wiki}-`, 8, `-${table}.sql.gz`),
    ...(readsAlso ? { readsAlso } : {}),
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

function enwikiTable(
  key: DumpKey, job: string, table: string, title: string, source = 'English Wikipedia',
  readsAlso?: (name: string) => boolean,
): DumpSource {
  return wikiTable('enwiki', key, job, table, title, source, readsAlso);
}

/**
 * The file of a month's pageviews, from the month's first day: `2026-09-01` is
 * `pageviews-202609-user.bz2`. Readership's twelve are found by it (#1436), and
 * so is the last month of a year an admin asks for by its end (#2230).
 */
export const pageviewsFileName = (month: string) => `pageviews-${month.slice(0, 4)}${month.slice(5, 7)}-user.bz2`;

const pageviews: DumpSource = {
  key: 'pageviews-user',
  source: 'Wikimedia pageviews',
  title: 'Readers per article, by month',
  datedBy: 'month',
  isFileName: datedName('pageviews-', 6, '-user.bz2'),
  async resolve(read, size, only) {
    const years = [...(await read(`${PAGEVIEWS_MONTHLY}/`)).matchAll(/href="(\d{4})\/"/g)].map(m => m[1]).sort().reverse();
    return only ? pageviewsNamed(years, size, only) : newestPageviews(years, read, size);
  },
};

const PAGEVIEWS_MONTHLY = `${WIKIMEDIA_DUMPS}/other/pageview_complete/monthly`;

/** The month's file as the host lists it, if it does: `month` is `YYYY-MM`. */
async function pageviewsFile(year: string, month: string, size: SizeReader): Promise<DumpFile | null> {
  const fileName = safeFileName(pageviewsFileName(`${month}-01`));
  const bytes = await size(`${PAGEVIEWS_MONTHLY}/${year}/${month}/${fileName}`);
  return bytes === null ? null : { key: 'pageviews-user', fileName, url: `${PAGEVIEWS_MONTHLY}/${year}/${month}/${fileName}`, date: `${month}-01`, checksum: null, expectedBytes: bytes, compression: 'bzip2' };
}

/**
 * A month asked for by name (readership's twelve, #1436; the last month of a
 * year asked for by its end, #2230) is looked for in its own directory, which
 * its name says, in whatever year the host still lists: no year's listing is
 * read, only the file's size asked.
 */
async function pageviewsNamed(years: readonly string[], size: SizeReader, only: (fileName: string) => boolean): Promise<DumpFile | null> {
  for (const year of years) {
    for (let m = 12; m >= 1; m--) {
      const month = `${year}-${String(m).padStart(2, '0')}`;
      if (!only(safeFileName(pageviewsFileName(`${month}-01`)))) continue;
      const file = await pageviewsFile(year, month, size);
      if (file) return file;
    }
  }
  return null;
}

/** The newest month the host has finished: among the last three months of the last two years listed. */
async function newestPageviews(years: readonly string[], read: TextReader, size: SizeReader): Promise<DumpFile | null> {
  for (const year of years.slice(0, 2)) {
    const months = [...(await read(`${PAGEVIEWS_MONTHLY}/${year}/`)).matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]).sort().reverse();
    for (const month of months.slice(0, 3)) {
      const file = await pageviewsFile(year, month, size);
      if (file) return file;
    }
  }
  return null;
}

/** How many weeks before this one the planet's resolver looks: the host keeps its weekly files far longer. */
const PLANET_WEEKS_BACK = 6;

/** `YYMMDD` of the Monday on or before `day`, `weeksBack` weeks earlier, in UTC. */
function mondayCode(day: Date, weeksBack: number): string {
  const monday = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7 * weeksBack);
  return monday.toISOString().slice(2, 10).replaceAll('-', '');
}

const planet: DumpSource = {
  key: 'osm-planet',
  source: 'OpenStreetMap',
  title: 'Planet',
  datedBy: 'day',
  retriesACut: false,
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

/**
 * What the panel says of each dump (#2415, `docs/tech/interface-writing.md`):
 * what it holds in plain words, and how a file of it is read and verified,
 * shown behind an info mark. One place for the words, so a reader of the
 * descriptors above sees the mechanics and the admin sees the sentence.
 */
const DUMP_WORDS: Record<DumpKey, Pick<DumpDescriptor, 'about' | 'how' | 'inputOf'>> = {
  'wikidata-entities': {
    about: 'Every Wikidata item, with all its statements. The Wikidata copy is cut from it.',
    how: 'One entity a line, verified against the sha1 Wikidata publishes beside the file.',
  },
  'enwiki-page': {
    about: 'Every page of English Wikipedia, with its title and whether it is a redirect.',
    how: 'The page table of the wiki\'s run, verified by the sha1 its status file gives. The structure build reads it with the page properties, link targets and category links of the same date.',
  },
  'enwiki-page-props': {
    about: 'The Wikidata item of each English Wikipedia article.',
    how: 'The page_props table of the wiki\'s run, verified by the sha1 its status file gives.',
    inputOf: 'enwiki-page',
  },
  'enwiki-linktarget': {
    about: 'The title each category link of English Wikipedia names.',
    how: 'The linktarget table of the wiki\'s run, verified by the sha1 its status file gives.',
    inputOf: 'enwiki-page',
  },
  'enwiki-categorylinks': {
    about: 'Which category each page of English Wikipedia is in.',
    how: 'The categorylinks table of the wiki\'s run, verified by the sha1 its status file gives.',
    inputOf: 'enwiki-page',
  },
  'wikipedia-redirects': {
    about: 'Each redirect of the Wikipedia editions readership counts, and the article it points to.',
    how: 'English Wikipedia\'s redirect table, and the redirect and page tables of the same date in every counted edition, each verified by the sha1 its status file gives.',
  },
  'wikidata-redirects': {
    about: 'Each Wikidata item merged into another, and the item it now points to.',
    how: 'Wikidata\'s redirect table and the page table of the same run, each verified by the sha1 its status file gives.',
  },
  'pageviews-user': {
    about: 'How many people read each article of every edition, month by month.',
    how: 'One file a month, people only. No checksum is published: the host\'s size and a clean end of the bzip2 stream verify it.',
  },
  'wikivoyage-usage': {
    about: 'Which Wikidata items each Wikivoyage edition\'s pages use.',
    how: 'English Wikivoyage\'s usage table, and the usage and page tables of the same date in every edition, each verified by the sha1 its status file gives.',
  },
  'wikivoyage-pages': {
    about: 'Every page of English Wikivoyage, with its text and its Wikidata item.',
    how: 'The monthly content export, verified by its sha256, and the page properties of the same date, verified by their sha1.',
  },
  'osm-planet': {
    about: 'The whole OpenStreetMap map, released weekly. The OpenStreetMap layer is cut from it.',
    how: 'One file read whole by the layer\'s tools, verified by its md5 and kept on disk, then brought forward with the daily diffs.',
  },
};

const DESCRIPTORS: readonly DumpSource[] = [
  wikidataJson('wikidata-entities', 'all', 'All entities'),
  enwikiTable('enwiki-page', 'pagetable', 'page', 'Pages'),
  enwikiTable('enwiki-page-props', PAGE_PROPS_JOB, 'page_props', 'Page properties'),
  enwikiTable('enwiki-linktarget', 'linktargettable', 'linktarget', 'Link targets'),
  enwikiTable('enwiki-categorylinks', 'categorylinkstable', 'categorylinks', 'Category links'),
  enwikiTable('wikipedia-redirects', 'redirecttable', 'redirect', 'Redirects',
    'Wikipedia editions', name => /^[a-z_]+wiki-\d{8}-(redirect|page)\.sql\.gz$/.test(name)),
  wikiTable('wikidatawiki', 'wikidata-redirects', 'redirecttable', 'redirect', 'Item redirects',
    'Wikidata', datedName('wikidatawiki-', 8, '-page.sql.gz')),
  pageviews,
  wikivoyageUsage,
  wikivoyagePages,
  planet,
];

export const DUMPS: readonly DumpDescriptor[] = DESCRIPTORS.map(dump => ({ ...dump, ...DUMP_WORDS[dump.key] }));

export function dumpNamed(key: string): DumpDescriptor | undefined {
  return DUMPS.find(dump => dump.key === key);
}
