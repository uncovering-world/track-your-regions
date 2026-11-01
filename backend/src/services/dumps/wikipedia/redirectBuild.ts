/**
 * A keeping build of the redirects readership folds under an article (#1650,
 * ADR-0055 decision 2): for every Wikipedia edition a door counts, each
 * namespace-0 redirect and the article it points to, kept where that article
 * is a sitelink of the local subset.
 *
 * Readers keep arriving through an article's old titles and its redirects.
 * Wanderer Above the Sea of Fog is read 3,738 times a year in English under
 * its title and 388,094 times under the redirect *Wanderer above the Sea of
 * Fog*, which differs from it by one capital letter. The pageview files count each title on its own, and joining them by
 * page id is unsound (page ids pass between articles after a deletion), so the
 * redirects come from each edition's own tables of one dump date:
 *
 * 1. `redirect`: each redirect page's id and the namespace-0 title it points
 *    to, an interwiki redirect left out;
 * 2. `page`: each namespace-0 redirect page's id and title.
 *
 * Both are staged, joined in the database and kept where the target is an
 * article of the subset (`redirectTables.ts`), one edition at a time. The
 * build starts from English Wikipedia's redirect file, which is the dump's
 * own and is kept in the local copy. A build is swapped in only whole: where
 * an edition's run has not finished the two tables of that date, as in the
 * first days of a run, the build fails, names the editions, and leaves the
 * redirects in place, so a partial set never stands in for a full one. Every other file is read from the host
 * as a stream and verified by the checksum and size its edition's status file
 * gives. A file that fails, or a cancel, drops what was staged and leaves the
 * redirects in place as they were.
 */

import { pool } from '../../../db/index.js';
import { wikipediaTableFile, type DumpFile } from '../catalog.js';
import { fetchText } from '../fetch.js';
import { numberOf, textOf } from './sqlInsert.js';
import { createNextTable, dropNextTable, indexNextTable, keepEdition, stagePages, stageTargets, swapIn } from './redirectTables.js';
import { Batches, readTable, type TableBuildOptions } from './tableRead.js';

const ARTICLE = 0;

/**
 * An edition a door counts: over 15 million views a year in the months
 * readership keeps (ADR-0055). A redirect of an edition no door counts
 * changes nothing a door reads, and the 83 editions over the line held 99.3 %
 * of the year's views on 2026-10-18.
 */
export const COUNTED_EDITION_VIEWS = 15_000_000;

/** The columns each table is read by, which the file's `CREATE TABLE` must name there (`InsertReader`). */
export const REDIRECT_COLUMNS = { 0: 'rd_from', 1: 'rd_namespace', 2: 'rd_title', 3: 'rd_interwiki' } as const;
export const PAGE_COLUMNS = { 0: 'page_id', 1: 'page_namespace', 2: 'page_title', 3: 'page_is_redirect' } as const;

/**
 * The editions a door counts, by their sitelink site code, the most read first:
 * those over the line in the current year's months. A month of an earlier year
 * kept beside it (`window_end` set, #2230) is no run's to read, and summed in
 * it would carry an edition over the line on two years' views.
 */
export async function countedEditions(): Promise<string[]> {
  const result = await pool.query<{ site: string }>(
    `SELECT e.key AS site FROM readership_month_files f, jsonb_each_text(f.editions) e
      WHERE f.window_end IS NULL
      GROUP BY e.key HAVING sum(e.value::bigint) >= $1 ORDER BY sum(e.value::bigint) DESC, e.key`,
    [COUNTED_EDITION_VIEWS],
  );
  return result.rows.map(row => row.site).filter(site => /^[a-z_]+wiki$/.test(site));
}

/** A title as Wikidata's sitelinks write it: spaces where the dump writes underscores. */
const spaced = (title: string) => title.replaceAll('_', ' ');

/** The dated directory a dump file of `wiki` is in: `enwiki-20261001-redirect.sql.gz` gives `20261001`. */
const directoryOf = (file: DumpFile) => file.fileName.slice('enwiki-'.length, 'enwiki-'.length + 8);

type TableRead = { bytes: number; lines: number; checksumActual: string | null };

/** Stage an edition's redirect table: each redirect page's id and the namespace-0 title it points to, an interwiki one left out. */
function stageRedirects(file: DumpFile, options: TableBuildOptions, ownRead: boolean): Promise<TableRead> {
  const targets = new Batches<{ id: number; target: string }>(stageTargets);
  return readTable(file, 'redirect', REDIRECT_COLUMNS, options, ownRead, async row => {
    const [id, namespace, title, interwiki] = [numberOf(row[0]), numberOf(row[1]), textOf(row[2]), textOf(row[3])];
    if (id === null || namespace !== ARTICLE || !title || interwiki) return;
    await targets.add({ id, target: spaced(title) });
  }, () => targets.flush());
}

/** Stage an edition's page table: each namespace-0 redirect page's id and title. */
function stageRedirectPages(file: DumpFile, options: TableBuildOptions): Promise<TableRead> {
  const pages = new Batches<{ id: number; title: string }>(stagePages);
  return readTable(file, 'page', PAGE_COLUMNS, options, false, async row => {
    const [id, namespace, title, isRedirect] = [numberOf(row[0]), numberOf(row[1]), textOf(row[2]), numberOf(row[3])];
    if (id === null || namespace !== ARTICLE || !title || isRedirect !== 1) return;
    await pages.add({ id, title: spaced(title) });
  }, () => pages.flush());
}

/**
 * Every counted edition's redirect and page file of the date of `redirect`
 * (the build's own for English Wikipedia's redirects), found before any is
 * read. A build is swapped in only whole, so where an edition's run has not
 * finished the two tables, as in the first days of a run when English
 * Wikipedia's are done before most, the build fails and names them all, and
 * the redirects in place stay.
 */
async function editionFiles(
  redirect: DumpFile, editions: readonly string[], signal: AbortSignal,
): Promise<Array<{ site: string; redirectFile: DumpFile; pageFile: DumpFile }>> {
  const dir = directoryOf(redirect);
  const read = (url: string) => fetchText(url, signal);
  const files: Array<{ site: string; redirectFile: DumpFile; pageFile: DumpFile }> = [];
  const unfinished: string[] = [];
  for (const site of editions) {
    const redirectFile = site === 'enwiki' ? redirect : await wikipediaTableFile(read, 'wikipedia-redirects', site, dir, 'redirecttable', 'redirect');
    const pageFile = await wikipediaTableFile(read, 'wikipedia-redirects', site, dir, 'pagetable', 'page');
    if (redirectFile && pageFile) files.push({ site, redirectFile, pageFile });
    else unfinished.push(site);
  }
  if (unfinished.length > 0) {
    throw new Error(`The ${redirect.date} run has not finished the redirect and page tables of ${unfinished.length} counted `
      + `editions (${unfinished.join(', ')}), so the redirects in place stay; build again once it has`);
  }
  return files;
}

/**
 * Keep the redirects of every counted edition from the dump date of `redirect`
 * (English Wikipedia's redirect table's file), and swap them in once every
 * edition's two files are read and verified.
 */
export async function buildRedirects(redirect: DumpFile, options: TableBuildOptions): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('The redirects have no trial build: an edition is kept from its whole files');
  const editions = await countedEditions();
  if (editions.length === 0) throw new Error('Readership keeps no month yet, so no edition is counted and no redirect is needed');
  options.onPhase(`Finding the redirect and page tables of ${editions.length} editions...`);
  const files = await editionFiles(redirect, editions, options.signal);
  const kept: Record<string, number> = {};
  const totals = { bytes: 0, lines: 0, files: 0 };
  let own: TableRead | null = null;
  const fromHost: TableBuildOptions = { ...options, dumpsDir: undefined };

  await createNextTable();
  try {
    for (const [at, { site, redirectFile, pageFile }] of files.entries()) {
      const step = (file: DumpFile) => options.onPhase(`Reading ${file.fileName} (edition ${at + 1} of ${files.length})...`);
      const isOwn = redirectFile === redirect;
      step(redirectFile);
      const redirectRead = await stageRedirects(redirectFile, isOwn ? options : fromHost, isOwn);
      if (isOwn) own = redirectRead;
      step(pageFile);
      const pageRead = await stageRedirectPages(pageFile, fromHost);

      for (const read of [redirectRead, pageRead]) {
        totals.bytes += read.bytes;
        totals.lines += read.lines;
        totals.files += 1;
      }
      options.onPhase(`Keeping the redirects of ${site} (edition ${at + 1} of ${files.length})...`);
      kept[site] = await keepEdition(site, options.signal);
    }
    options.signal.throwIfAborted();
    const all = Object.values(kept).reduce((sum, n) => sum + n, 0);
    if (all === 0) throw new Error('The build kept no redirect of any edition, so the redirects in place stay');
    options.onPhase('Indexing the redirects...');
    await indexNextTable(options.signal);
    await swapIn(options.buildId, redirect.date, kept, options.signal);
    // The build's row records its own file, English Wikipedia's redirects; the editions' totals are the summary's.
    const read = own ?? { bytes: 0, lines: 0, checksumActual: null };
    return {
      ...read,
      summary: `kept ${all.toLocaleString('en')} redirects to articles with a Wikidata item in ${editions.length} editions `
        + `(English ${(kept.enwiki ?? 0).toLocaleString('en')}), from the ${redirect.date} dumps; `
        + `read ${totals.files} files, ${totals.lines.toLocaleString('en')} lines and ${totals.bytes.toLocaleString('en')} bytes`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  }
}
