/**
 * A keeping build of the items Wikidata redirected to another (ADR-0143
 * decision 3, #1895): every redirect page in Wikidata's main namespace and the
 * item it points to, kept whole in `workbench.wikidata_redirects`.
 *
 * When two items are merged on Wikidata, one becomes a redirect to the other.
 * A place registered under the old item and a run reading the new one would
 * not meet, and the resolver would create a second place; with the redirects
 * kept, `withRedirects` (`db/experienceWriter.ts`) widens a lookup to both.
 * The JSON dump the subset is cut from carries no redirect, so they come from
 * two tables of the same run of `wikidatawiki`:
 *
 * 1. `redirect`: each redirect page's id and the item it points to, an
 *    interwiki redirect left out — the build's own file, 37 MB;
 * 2. `page`: each main-namespace redirect page's id and the item it is titled —
 *    the run's page table, read from the host as a stream.
 *
 * Both are staged and joined in the database (`redirectTables.ts`). A build is
 * swapped in only whole: where the run has not finished the page table, the
 * build fails, names it, and leaves the redirects in place.
 */

import type { DumpFile } from '../catalog.js';
import { wikipediaTableFile } from '../catalog.js';
import { fetchText } from '../fetch.js';
import { PAGE_COLUMNS, REDIRECT_COLUMNS } from '../wikipedia/redirectBuild.js';
import { numberOf, textOf } from '../wikipedia/sqlInsert.js';
import { Batches, readTable, type TableBuildOptions } from '../wikipedia/tableRead.js';
import {
  createNextTable, dropNextTable, indexNextTable, keepRedirects, stagePages, stageTargets, swapIn,
} from './redirectTables.js';

const ITEM = /^Q\d+$/;
const MAIN_NAMESPACE = 0;
const PREFIX = 'wikidatawiki-';

type TableRead = { bytes: number; lines: number; checksumActual: string | null };

/** Stage the redirect table: each redirect page's id and the item it points to; an interwiki one, or a target that is no item, left out. */
function stageRedirects(file: DumpFile, options: TableBuildOptions): Promise<TableRead> {
  const targets = new Batches<{ id: number; target: string }>(stageTargets);
  return readTable(file, 'redirect', REDIRECT_COLUMNS, options, true, async row => {
    const [id, namespace, title, interwiki] = [numberOf(row[0]), numberOf(row[1]), textOf(row[2]), textOf(row[3])];
    if (id === null || namespace !== MAIN_NAMESPACE || !title || interwiki || !ITEM.test(title)) return;
    await targets.add({ id, target: title });
  }, () => targets.flush());
}

/** Stage the page table: each main-namespace redirect page's id and the item it is titled. */
function stageRedirectPages(file: DumpFile, options: TableBuildOptions): Promise<TableRead> {
  const pages = new Batches<{ id: number; item: string }>(stagePages);
  return readTable(file, 'page', PAGE_COLUMNS, options, false, async row => {
    const [id, namespace, title, isRedirect] = [numberOf(row[0]), numberOf(row[1]), textOf(row[2]), numberOf(row[3])];
    if (id === null || namespace !== MAIN_NAMESPACE || !title || isRedirect !== 1 || !ITEM.test(title)) return;
    await pages.add({ id, item: title });
  }, () => pages.flush());
}

/**
 * Keep the item redirects of the run `redirect` (the redirect table's file)
 * belongs to, and swap them in once both files are read and verified.
 */
export async function buildWikidataRedirects(
  redirect: DumpFile, options: TableBuildOptions,
): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('The item redirects have no trial build: they are kept from the whole tables');
  const dir = redirect.fileName.slice(PREFIX.length, PREFIX.length + 8);
  const pageFile = await wikipediaTableFile(url => fetchText(url, options.signal), 'wikidata-redirects', 'wikidatawiki', dir, 'pagetable', 'page');
  if (!pageFile) {
    throw new Error(`The ${redirect.date} run has not finished the page table, so the item redirects in place stay; build again once it has`);
  }

  await createNextTable();
  try {
    options.onPhase(`Reading ${redirect.fileName}...`);
    const redirectRead = await stageRedirects(redirect, options);
    options.onPhase(`Reading ${pageFile.fileName}...`);
    const pageRead = await stageRedirectPages(pageFile, { ...options, dumpsDir: undefined });
    options.onPhase('Keeping the item redirects...');
    const kept = await keepRedirects(options.signal);
    if (kept === 0) throw new Error('The build kept no item redirect, so the redirects in place stay');
    options.onPhase('Indexing the item redirects...');
    await indexNextTable(options.signal);
    await swapIn(options.buildId, redirect.date, kept, options.signal);
    // The build's row records its own file, the redirect table; both files' totals are the summary's.
    return {
      ...redirectRead,
      summary: `kept ${kept.toLocaleString('en')} items Wikidata redirected to another, from the ${redirect.date} dump; `
        + `read 2 files, ${(redirectRead.lines + pageRead.lines).toLocaleString('en')} lines and `
        + `${(redirectRead.bytes + pageRead.bytes).toLocaleString('en')} bytes`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  }
}
