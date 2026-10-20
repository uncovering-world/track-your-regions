/**
 * A keeping build of the Wikidata items every Wikivoyage edition uses (#1768,
 * decided on #1718): the travel-guide witness of whether a place is one a visitor
 * goes to.
 *
 * A Wikivoyage article uses the item of every place it lists (`{{see |
 * wikidata=Q2540426 }}` pulls the Roman Baths' coordinates and picture), and
 * each wiki records what its pages use in its `wbc_entity_usage` table, which
 * every dump run publishes. So the guide's word is read from structured
 * tables, 58 MB for all the editions with their page tables, rather than from
 * 400 MB of articles. On
 * dry run 178's door arrivals it gives exactly what a parse of the listings
 * gives: 19 of the 20 sites, none of the 9 places with nothing to see
 * (Stapleton International Airport, Rungholt, the circus of Nero).
 *
 * Only an article counts, read from the edition's page table of the same
 * date: a user's draft or a project page names an item without sending a
 * visitor to it. A heritage register is not a guide either (`REGISTER_ROOTS`).
 *
 * The build starts from English Wikivoyage's usage table, the dump's own file,
 * kept in the local copy, and reads every other edition's usage table and
 * every edition's page table of the same date from the host as a stream, each
 * verified by the checksum and size its status file gives. It is swapped in only whole: where an edition's run has not finished
 * its table, the build fails, names the editions, and leaves the usage in
 * place, so a partial guide never stands in for a full one. A file that fails,
 * or a cancel, drops what was kept and leaves the usage in place as it was.
 */

import { USAGE_JOB, USAGE_SUFFIX, wikiRunFile, type DumpFile } from '../catalog.js';
import { PAGE_COLUMNS } from '../wikipedia/redirectBuild.js';
import { fetchText } from '../fetch.js';
import { numberOf, textOf } from '../wikipedia/sqlInsert.js';
import { readTable, type TableBuildOptions } from '../wikipedia/tableRead.js';
import { createNextTable, dropNextTable, indexNextTable, keepUsage, swapIn } from './usageTables.js';

/**
 * Every Wikivoyage edition a dump run publishes, by its database name: the 28
 * of Wikimedia's site matrix on 2026-10-20 less Malayalam Wikivoyage, which has
 * no dumps yet. An edition is added here once the dumps carry it; one missing
 * from a run fails the build rather than quietly shrinking the guide.
 */
export const WIKIVOYAGE_EDITIONS = [
  'enwikivoyage', 'dewikivoyage', 'itwikivoyage', 'frwikivoyage', 'ruwikivoyage', 'eswikivoyage', 'plwikivoyage',
  'zhwikivoyage', 'hewikivoyage', 'ptwikivoyage', 'nlwikivoyage', 'jawikivoyage', 'fawikivoyage', 'ukwikivoyage',
  'viwikivoyage', 'fiwikivoyage', 'svwikivoyage', 'elwikivoyage', 'trwikivoyage', 'bnwikivoyage', 'cswikivoyage',
  'eowikivoyage', 'hiwikivoyage', 'idwikivoyage', 'pswikivoyage', 'rowikivoyage', 'shnwikivoyage',
] as const;

/** The columns a row is read by, which the file's `CREATE TABLE` must name there (`InsertReader`). */
export const USAGE_COLUMNS = { 1: 'eu_entity_id', 3: 'eu_page_id' } as const;

/**
 * The articles of an edition that are a heritage register's lists, not a
 * guide, by the start of their title as the page table writes it. Russian
 * Wikivoyage keeps the heritage registers of Belarus and Russia and the
 * natural-monument lists of Russia and Central Asia as articles: on
 * 2026-10-01, 8,437 of the 26,357 items it used were used by these lists
 * alone.
 */
export const REGISTER_ROOTS: Readonly<Partial<Record<string, readonly string[]>>> = {
  ruwikivoyage: ['Культурное_наследие_', 'Природные_памятники_'],
  ukwikivoyage: ['Культурна_спадщина_'],
};

const ARTICLE = 0;
const PAGE_SUFFIX = 'page.sql.gz';
const PAGE_JOB = 'pagetable';

/** An item: a property (`P1082`) or a lexeme a page uses says nothing of a place. */
const ITEM = /^Q\d+$/;

/** The dated directory of a run's file: `enwikivoyage-20261001-wbc_entity_usage.sql.gz` gives `20261001`. */
const directoryOf = (file: DumpFile) => file.fileName.slice('enwikivoyage-'.length, 'enwikivoyage-'.length + 8);

type TableRead = { bytes: number; lines: number; checksumActual: string | null };

interface EditionFiles { site: string; usage: DumpFile; pages: DumpFile }

/**
 * Every edition's usage table and page table of the date of `own` (English
 * Wikivoyage's usage table), found before any is read. Where a run has not
 * finished either of an edition's tables, the build fails and names them all,
 * and the usage in place stays.
 */
async function editionFiles(own: DumpFile, signal: AbortSignal): Promise<EditionFiles[]> {
  const dir = directoryOf(own);
  const read = (url: string) => fetchText(url, signal);
  const files: EditionFiles[] = [];
  const unfinished: string[] = [];
  for (const site of WIKIVOYAGE_EDITIONS) {
    const usage = site === 'enwikivoyage' ? own : await wikiRunFile(read, 'wikivoyage-usage', site, dir, USAGE_JOB, USAGE_SUFFIX, 'gzip');
    const pages = await wikiRunFile(read, 'wikivoyage-usage', site, dir, PAGE_JOB, PAGE_SUFFIX, 'gzip');
    if (usage && pages) files.push({ site, usage, pages });
    else unfinished.push(site);
  }
  // A cancel during the status reads leaves them unanswered: it is a cancel, not an unfinished run.
  signal.throwIfAborted();
  if (unfinished.length > 0) {
    throw new Error(`The ${own.date} run has not finished the item usage and page tables of ${unfinished.length} Wikivoyage editions `
      + `(${unfinished.join(', ')}), so the usage in place stays; build again once it has`);
  }
  return files;
}

/** The ids of an edition's articles that are a guide's: namespace 0, no redirect, no register's list. */
async function guideArticles(site: string, file: DumpFile, options: TableBuildOptions): Promise<TableRead & { ids: Set<number> }> {
  const ids = new Set<number>();
  const roots = REGISTER_ROOTS[site] ?? [];
  const read = await readTable(file, 'page', PAGE_COLUMNS, { ...options, dumpsDir: undefined }, false, (row) => {
    const [id, namespace, title, isRedirect] = [numberOf(row[0]), numberOf(row[1]), textOf(row[2]), numberOf(row[3])];
    if (id === null || namespace !== ARTICLE || !title || isRedirect === 1) return;
    if (roots.some(root => title.startsWith(root))) return;
    ids.add(id);
  }, async () => undefined);
  return { ...read, ids };
}

/** Read one edition's usage table and keep each item its guide articles use, once. */
async function keepEdition(
  site: string, file: DumpFile, articles: ReadonlySet<number>, options: TableBuildOptions, ownRead: boolean,
): Promise<TableRead & { kept: number }> {
  const items = new Set<string>();
  const read = await readTable(file, 'wbc_entity_usage', USAGE_COLUMNS, ownRead ? options : { ...options, dumpsDir: undefined }, ownRead,
    (row) => {
      const [item, page] = [textOf(row[1]), numberOf(row[3])];
      if (item && ITEM.test(item) && page !== null && articles.has(page)) items.add(item);
    },
    () => keepUsage(site, [...items]));
  return { ...read, kept: items.size };
}

/**
 * Keep the items every Wikivoyage edition uses from the dump date of `own`
 * (English Wikivoyage's usage table), and swap them in once every edition's
 * file is read and verified.
 */
export async function buildUsage(own: DumpFile, options: TableBuildOptions): Promise<TableRead & { summary?: string }> {
  if (options.trial) throw new Error('The item usage has no trial build: an edition is kept from its whole file');
  options.onPhase(`Finding the item usage of ${WIKIVOYAGE_EDITIONS.length} Wikivoyage editions...`);
  const files = await editionFiles(own, options.signal);
  const kept: Record<string, number> = {};
  const totals = { bytes: 0, lines: 0 };
  let ownRead: TableRead | null = null;

  await createNextTable();
  try {
    for (const [at, { site, usage, pages }] of files.entries()) {
      options.onPhase(`Reading ${pages.fileName} (edition ${at + 1} of ${files.length})...`);
      const articles = await guideArticles(site, pages, options);
      options.onPhase(`Reading ${usage.fileName} (edition ${at + 1} of ${files.length})...`);
      const read = await keepEdition(site, usage, articles.ids, options, usage === own);
      if (usage === own) ownRead = read;
      kept[site] = read.kept;
      for (const each of [articles, read]) {
        totals.bytes += each.bytes;
        totals.lines += each.lines;
      }
    }
    options.signal.throwIfAborted();
    const all = Object.values(kept).reduce((sum, n) => sum + n, 0);
    if (all === 0) throw new Error('The build kept no item of any edition, so the usage in place stays');
    options.onPhase('Indexing the item usage...');
    await indexNextTable(options.signal);
    await swapIn(options.buildId, own.date, kept, options.signal);
    // The build's row records its own file, English Wikivoyage's table; the editions' totals are the summary's.
    const read = ownRead ?? { bytes: 0, lines: 0, checksumActual: null };
    return {
      ...read,
      summary: `kept ${all.toLocaleString('en')} items that ${files.length} Wikivoyage editions use `
        + `(English ${(kept.enwikivoyage ?? 0).toLocaleString('en')}), from the ${own.date} dumps; `
        + `read ${files.length * 2} files, ${totals.lines.toLocaleString('en')} lines and ${totals.bytes.toLocaleString('en')} bytes`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  }
}
