/**
 * A keeping build of English Wikivoyage's articles (#2089): what the
 * world-view extraction reads a region's page from, instead of the live
 * Action API, whose answers changed between two runs.
 *
 * The build reads the run's `pages-articles` XML, the build's own file, and
 * the same run's `page_props` table, each verified by the checksum and size
 * its status file gives. It keeps every page of namespace 0, an article with
 * its wikitext or a redirect with its target, and the Wikidata item its page
 * properties name (`wikibase_item`). It is swapped in only whole: a file that
 * fails, a run that has not finished its page properties, or a cancel, drops
 * what was kept and leaves the pages in place as they were.
 */

import { PAGE_PROPS_JOB, wikiRunFile, type DumpFile } from '../catalog.js';
import { fetchText } from '../fetch.js';
import { readDump } from '../read.js';
import { numberOf, textOf } from '../wikipedia/sqlInsert.js';
import { Batches, readTable, type TableBuildOptions } from '../wikipedia/tableRead.js';
import { PageReader } from './pageLine.js';
import { createNextTable, dropNextTable, indexNextTable, keepPages, swapIn, type KeptPage } from './pageTables.js';

/** The columns a page property is read by, which the file's `CREATE TABLE` must name there (`InsertReader`). */
export const PAGE_PROPS_COLUMNS = { 0: 'pp_page', 1: 'pp_propname', 2: 'pp_value' } as const;

const PAGE_PROPS_SUFFIX = 'page_props.sql.gz';
/** Pages to an insert: an article's text runs to some hundred kilobytes. */
const PAGES_PER_WRITE = 500;
const ITEM = /^Q[1-9]\d*$/;

/** The dated directory of the run `own` comes from: `enwikivoyage-20261001-pages-articles.xml.bz2` gives `20261001`. */
const directoryOf = (own: DumpFile) => own.fileName.slice('enwikivoyage-'.length, 'enwikivoyage-'.length + 8);

/** The Wikidata item of every page that names one, by page id, from the run's page properties. */
async function itemsByPage(own: DumpFile, options: TableBuildOptions): Promise<{ items: Map<number, string>; bytes: number; lines: number }> {
  const read = (url: string) => fetchText(url, options.signal);
  const props = await wikiRunFile(read, own.key, 'enwikivoyage', directoryOf(own), PAGE_PROPS_JOB, PAGE_PROPS_SUFFIX, 'gzip');
  options.signal.throwIfAborted();
  if (!props) {
    throw new Error(`The ${own.date} run has not finished English Wikivoyage's page properties, so the pages in place stay; build again once it has`);
  }
  options.onPhase(`Reading ${props.fileName}...`);
  const items = new Map<number, string>();
  const result = await readTable(props, 'page_props', PAGE_PROPS_COLUMNS, { ...options, dumpsDir: undefined }, false, (row) => {
    const [page, name, value] = [numberOf(row[0]), textOf(row[1]), textOf(row[2])];
    if (page !== null && name === 'wikibase_item' && value && ITEM.test(value)) items.set(page, value);
  }, async () => undefined);
  return { items, bytes: result.bytes, lines: result.lines };
}

/** Keep English Wikivoyage's pages from `own`, its `pages-articles` file, and swap them in once both files are read and verified. */
export async function buildPages(own: DumpFile, options: TableBuildOptions): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('English Wikivoyage\'s pages have no trial build: they are kept from the whole file');
  const props = await itemsByPage(own, options);
  const counts = { articles: 0, redirects: 0, items: 0 };

  await createNextTable();
  try {
    options.onPhase(`Reading ${own.fileName}...`);
    const batches = new Batches<KeptPage>(keepPages, PAGES_PER_WRITE);
    const pending: Promise<void>[] = [];
    const reader = new PageReader((page) => {
      const wikidataId = props.items.get(page.id) ?? null;
      if (page.redirectTo === null) counts.articles += 1;
      else counts.redirects += 1;
      if (wikidataId) counts.items += 1;
      pending.push(batches.add({ ...page, wikidataId }));
    });
    const read = await readDump(own, {
      line: async (text) => {
        reader.line(text);
        for (const write of pending.splice(0)) await write;
      },
      commit: async () => {
        if (reader.open) throw new Error(`${own.fileName} ends inside a page's text`);
        await batches.flush();
      },
      abort: async () => undefined,
    }, options);
    options.signal.throwIfAborted();
    if (counts.articles === 0) throw new Error('The build kept no article, so the pages in place stay');
    options.onPhase('Indexing English Wikivoyage\'s pages...');
    await indexNextTable(options.signal);
    await swapIn(options.buildId, own.date, counts, options.signal);
    return {
      ...read,
      summary: `kept ${counts.articles.toLocaleString('en')} articles and ${counts.redirects.toLocaleString('en')} redirects `
        + `of English Wikivoyage, ${counts.items.toLocaleString('en')} with a Wikidata item, from the ${own.date} dump; `
        + `read ${(read.lines + props.lines).toLocaleString('en')} lines and ${(read.bytes + props.bytes).toLocaleString('en')} bytes`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  }
}
