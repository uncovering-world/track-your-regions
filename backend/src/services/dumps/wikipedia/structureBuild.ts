/**
 * A keeping build of English Wikipedia's structure (#1440, ADR-0121): its
 * articles and categories, each one's Wikidata item, and which category each
 * is filed under, from the enwiki SQL dumps of one date.
 *
 * The build starts from the page table's file and reads the other three of
 * the same date, in an order that lets each filter the next:
 *
 * 1. `page`: the articles (namespace 0) and categories (14) that are no
 *    redirect, written to `enwiki_pages` and held as bit sets;
 * 2. `page_props`: each kept page's Wikidata item (`wikibase_item`), and which
 *    category pages are hidden (`hiddencat`, the maintenance and tracking ones);
 * 3. `linktarget`: every category a link may name, by the id category links
 *    use, less the hidden ones;
 * 4. `categorylinks`: each article's and each category's link to a category
 *    kept, a file's and any other namespace's left out.
 *
 * Each file is read through `readDump`, so it is verified by the checksum and
 * size its dump's status file gives before the next is read; the rows go to
 * `_next` copies, which are indexed and swapped in whole once all four are
 * verified (`structureTables.ts`). A file that fails, or a cancel, drops the
 * copies and leaves the structure in place as it was.
 */

import type { DumpFile, DumpKey } from '../catalog.js';
import { dumpNamed } from '../catalog.js';
import { fetchText, sizeOf } from '../fetch.js';
import { readDump, type ReadOptions } from '../read.js';
import { IdSet } from '../wikidata/idSets.js';
import { InsertReader, numberOf, textOf, type SqlValue } from './sqlInsert.js';
import {
  createNextTables, dropNextTables, hiddenCategoryTitles, indexNextTables, insertCategories, insertItems, insertLinks, insertPages,
  swapIn,
  type LinkRow, type PageRow,
} from './structureTables.js';

const ARTICLE = 0;
const CATEGORY = 14;
const BATCH = 20_000;

type BuildOptions = ReadOptions & {
  buildId: number; onPhase: (message: string) => void; trial?: boolean;
  onMeasure?: (read: number, total: number) => void;
};

/**
 * The four files a build reads, in its order: the dump key, the table its
 * inserts name, and the columns the build reads by position, which the file's
 * `CREATE TABLE` must name there (`InsertReader`): the move of category links
 * onto link targets is how such a change arrives.
 */
export const STRUCTURE_FILES: ReadonlyArray<{ key: DumpKey; table: string; columns: Readonly<Record<number, string>> }> = [
  { key: 'enwiki-page', table: 'page', columns: { 0: 'page_id', 1: 'page_namespace', 2: 'page_title', 3: 'page_is_redirect' } },
  { key: 'enwiki-page-props', table: 'page_props', columns: { 0: 'pp_page', 1: 'pp_propname', 2: 'pp_value' } },
  { key: 'enwiki-linktarget', table: 'linktarget', columns: { 0: 'lt_id', 1: 'lt_namespace', 2: 'lt_title' } },
  { key: 'enwiki-categorylinks', table: 'categorylinks', columns: { 0: 'cl_from', 4: 'cl_type', 6: 'cl_target_id' } },
];

const columnsOf = (table: string) => STRUCTURE_FILES.find(f => f.table === table)!.columns;

/** The file of `table` in the dump directory `page` comes from: `enwiki-20261001-page.sql.gz` gives `enwiki-20261001-linktarget.sql.gz`. */
export const siblingName = (page: DumpFile, table: string) => page.fileName.replace(/-page\.sql\.gz$/, `-${table}.sql.gz`);

/** The host's file of `key` in the same dump directory as `page`, verified the way the newest one is. */
async function siblingOf(page: DumpFile, key: DumpKey, table: string, signal: AbortSignal): Promise<DumpFile> {
  const name = siblingName(page, table);
  const file = await dumpNamed(key)!.resolve(url => fetchText(url, signal), url => sizeOf(url, signal), candidate => candidate === name);
  if (!file) throw new Error(`The host has not finished ${name}, which the structure of ${page.date} needs`);
  return file;
}

/** Rows gathered and written a batch at a time. */
class Batches<Row> {
  private rows: Row[] = [];
  written = 0;
  constructor(private readonly write: (rows: Row[]) => Promise<void>) {}

  async add(row: Row): Promise<void> {
    this.rows.push(row);
    if (this.rows.length >= BATCH) await this.flush();
  }

  async flush(): Promise<void> {
    const rows = this.rows;
    this.rows = [];
    this.written += rows.length;
    await this.write(rows);
  }
}

/**
 * Read one file's inserts into `table`, handing each row to `onRow` (whose
 * writes it waits on before the next line), and finish once the file is
 * verified. A statement the file leaves open is a damaged file. The page
 * table's file is the build's own and reports as the build's read; each of
 * the other three reports as a step measured against its own size.
 */
async function readTable(
  file: DumpFile, table: string, options: BuildOptions, onRow: (row: SqlValue[]) => Promise<void> | void, finish: () => Promise<void>,
): Promise<{ bytes: number; lines: number; checksumActual: string | null }> {
  const pending: Array<Promise<void> | void> = [];
  const reader = new InsertReader(table, row => { pending.push(onRow(row)); }, columnsOf(table));
  const read: ReadOptions = table === 'page' ? options : {
    ...options,
    onProgress: ({ downloaded, read: done }) => options.onMeasure?.(done > 0 ? done : downloaded, file.expectedBytes ?? 0),
  };
  return readDump(file, {
    line: async text => {
      reader.line(text);
      for (const write of pending.splice(0)) await write;
    },
    commit: async () => {
      if (reader.open) throw new Error(`${file.fileName} ends inside an insert into ${table}`);
      await finish();
    },
    abort: async () => undefined,
  }, read);
}

/**
 * Refuse a structure that kept nothing of a table: a dump that names its
 * columns as the build reads them but holds no row the build keeps is not the
 * structure, and swapping it in would leave every reader with nothing.
 */
export function refuseEmpty(counts: Readonly<Record<string, number>>): void {
  const empty = Object.entries(counts).filter(([table, n]) => table !== 'hidden_categories' && n === 0).map(([table]) => table);
  if (empty.length > 0) throw new Error(`The build kept no row of ${empty.join(', ')}, so the structure in place stays`);
}

/** A category's title as the category table keeps it: without the namespace, with underscores. */
const titleOf = (value: SqlValue | undefined) => textOf(value) ?? '';

/**
 * Keep the structure of the dump `page` (the page table's file) belongs to:
 * read its four files, and swap the tables in once every one is verified.
 */
export async function buildStructure(page: DumpFile, options: BuildOptions): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  if (options.trial) throw new Error('English Wikipedia\'s structure has no trial build: a table is kept from its whole file');
  const files = [page];
  for (const { key, table } of STRUCTURE_FILES.slice(1)) files.push(await siblingOf(page, key, table, options.signal));
  const articles = new IdSet();
  const categoryPages = new IdSet();
  const hiddenPages: number[] = [];
  const categories = new IdSet();
  let hidden = new Set<string>();
  const totals = { bytes: 0, lines: 0 };
  const reading = (i: number) =>
    options.onPhase(`Reading ${files[i].fileName} (file ${i + 1} of ${files.length})${options.dumpsDir ? ' into the local copy' : ' from the host'}...`);

  await createNextTables();
  try {
    reading(0);
    const pages = new Batches<PageRow>(insertPages);
    const pageRead = await readTable(files[0], 'page', options, async row => {
      const [id, namespace, title, redirect] = [numberOf(row[0]), numberOf(row[1]), textOf(row[2]), numberOf(row[3])];
      if (id === null || title === null || redirect !== 0 || (namespace !== ARTICLE && namespace !== CATEGORY)) return;
      (namespace === ARTICLE ? articles : categoryPages).add(id);
      await pages.add({ id, namespace, title });
    }, () => pages.flush());

    reading(1);
    const items = new Batches<{ page: number; item: string }>(insertItems);
    const propsRead = await readTable(files[1], 'page_props', options, async row => {
      const [pageId, name, value] = [numberOf(row[0]), textOf(row[1]), textOf(row[2])];
      if (pageId === null) return;
      if (name === 'hiddencat' && categoryPages.has(pageId)) hiddenPages.push(pageId);
      if (name === 'wikibase_item' && value && /^Q\d+$/.test(value) && (articles.has(pageId) || categoryPages.has(pageId))) {
        await items.add({ page: pageId, item: value });
      }
    }, () => items.flush());
    hidden = await hiddenCategoryTitles(hiddenPages);

    reading(2);
    const kept = new Batches<{ id: number; title: string }>(insertCategories);
    const targetsRead = await readTable(files[2], 'linktarget', options, async row => {
      const [id, namespace, title] = [numberOf(row[0]), numberOf(row[1]), titleOf(row[2])];
      if (id === null || namespace !== CATEGORY || title === '' || hidden.has(title)) return;
      if (id > 0x7fffffff) throw new Error(`A link target id past what the category tables hold: ${id}`);
      categories.add(id);
      await kept.add({ id, title });
    }, () => kept.flush());

    reading(3);
    const links = new Batches<LinkRow>(insertLinks);
    const linksRead = await readTable(files[3], 'categorylinks', options, async row => {
      const [from, type, target] = [numberOf(row[0]), textOf(row[4]), numberOf(row[6])];
      if (from === null || target === null || !categories.has(target)) return;
      if (type === 'page' && articles.has(from)) await links.add({ page: from, category: target, subcat: false });
      else if (type === 'subcat' && categoryPages.has(from)) await links.add({ page: from, category: target, subcat: true });
    }, () => links.flush());

    for (const read of [pageRead, propsRead, targetsRead, linksRead]) {
      totals.bytes += read.bytes;
      totals.lines += read.lines;
    }
    options.signal.throwIfAborted();
    const counts = {
      enwiki_pages: pages.written, enwiki_page_items: items.written, enwiki_categories: kept.written,
      enwiki_category_links: links.written, hidden_categories: hidden.size,
    };
    refuseEmpty(counts);
    options.onPhase('Indexing the structure\'s tables...');
    await indexNextTables(options.signal, which => options.onPhase(`Indexing the structure's tables: ${which}...`));
    await swapIn(options.buildId, page.date, counts, options.signal);
    // The build's row records its own file, the page table's; the four files' totals are the summary's.
    return {
      bytes: pageRead.bytes, lines: pageRead.lines, checksumActual: pageRead.checksumActual,
      summary: `kept ${counts.enwiki_pages.toLocaleString('en')} articles and categories, `
        + `${counts.enwiki_category_links.toLocaleString('en')} category links into ${counts.enwiki_categories.toLocaleString('en')} categories `
        + `(${hidden.size.toLocaleString('en')} hidden ones left out) and ${counts.enwiki_page_items.toLocaleString('en')} Wikidata items, from the ${page.date} dump; `
        + `read ${files.length} files, ${totals.lines.toLocaleString('en')} lines and ${totals.bytes.toLocaleString('en')} bytes`,
    };
  } catch (error) {
    await dropNextTables().catch(() => undefined);
    throw error;
  }
}

