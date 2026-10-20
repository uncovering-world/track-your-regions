/**
 * A keeping build of the Wikivoyage listings (#1768, ADR-0128): for every
 * Wikivoyage edition, each Wikidata item a listing in an article names, with
 * the article.
 *
 * Archaeology's readership door (ADR-0127) opens for a site below the
 * sitelinks line only where a travel guide lists it. Dry run 178's arrivals
 * showed why. The door had opened for Stapleton International Airport,
 * Rungholt and the circus of Nero, read as much as the Roman Baths but with
 * nothing to see. No edition lists any of them, while 19 of its 20 sites are
 * listed.
 *
 * The build starts from English Wikivoyage's articles, the dump's own file,
 * kept in the local copy, and reads every other edition's articles of the
 * same date from the host as a stream, verified by the checksum and size its
 * status file gives. It is swapped in only whole. Where an edition's run has
 * not finished its articles, the build fails, names the editions, and leaves
 * the listings in place, so a partial set never stands in for a full one. A
 * file that fails, or a cancel, drops what was kept and leaves the listings
 * in place as they were.
 */

import { ARTICLES_JOB, ARTICLES_SUFFIX, wikiRunFile, type DumpFile } from '../catalog.js';
import { fetchText } from '../fetch.js';
import { readDump, type ReadResult } from '../read.js';
import { Batches, type TableBuildOptions } from '../wikipedia/tableRead.js';
import { ListingReader } from './listingLine.js';
import { createNextTable, dropNextTable, indexNextTable, keepListings, swapIn } from './listingTables.js';

/**
 * Every Wikivoyage edition, by its database name, as Wikimedia's site matrix
 * listed them on 2026-10-20 (28, none closed). A new edition is added here; one
 * missing from a run fails the build rather than quietly shrinking the guide.
 */
export const WIKIVOYAGE_EDITIONS = [
  'enwikivoyage', 'dewikivoyage', 'itwikivoyage', 'frwikivoyage', 'ruwikivoyage', 'eswikivoyage', 'plwikivoyage',
  'zhwikivoyage', 'hewikivoyage', 'ptwikivoyage', 'nlwikivoyage', 'jawikivoyage', 'fawikivoyage', 'ukwikivoyage',
  'viwikivoyage', 'fiwikivoyage', 'svwikivoyage', 'elwikivoyage', 'trwikivoyage', 'bnwikivoyage', 'cswikivoyage',
  'eowikivoyage', 'hiwikivoyage', 'idwikivoyage', 'mlwikivoyage', 'pswikivoyage', 'rowikivoyage', 'shnwikivoyage',
] as const;

/** The dated directory of a run's file: `enwikivoyage-20261001-pages-articles.xml.bz2` gives `20261001`. */
const directoryOf = (file: DumpFile) => file.fileName.slice('enwikivoyage-'.length, 'enwikivoyage-'.length + 8);

/**
 * Every edition's articles of the date of `own` (English Wikivoyage's), found
 * before any is read. Where a run has not finished an edition's articles, the
 * build fails and names them all, and the listings in place stay.
 */
async function editionFiles(own: DumpFile, signal: AbortSignal): Promise<Array<{ site: string; file: DumpFile }>> {
  const dir = directoryOf(own);
  const read = (url: string) => fetchText(url, signal);
  const files: Array<{ site: string; file: DumpFile }> = [];
  const unfinished: string[] = [];
  for (const site of WIKIVOYAGE_EDITIONS) {
    const file = site === 'enwikivoyage' ? own : await wikiRunFile(read, 'wikivoyage-listings', site, dir, ARTICLES_JOB, ARTICLES_SUFFIX, 'bzip2');
    if (file) files.push({ site, file });
    else unfinished.push(site);
  }
  if (unfinished.length > 0) {
    throw new Error(`The ${own.date} run has not finished the articles of ${unfinished.length} Wikivoyage editions `
      + `(${unfinished.join(', ')}), so the listings in place stay; build again once it has`);
  }
  return files;
}

/** Read one edition's articles and keep the items its listings name. */
async function keepEdition(site: string, file: DumpFile, options: TableBuildOptions, ownRead: boolean): Promise<ReadResult & { kept: number }> {
  const batches = new Batches<{ item: string; title: string }>(rows => keepListings(site, rows));
  const pending: Array<Promise<void>> = [];
  const reader = new ListingReader((item, title) => { pending.push(batches.add({ item, title })); });
  const read = await readDump(file, {
    line: async (text) => {
      reader.line(text);
      for (const write of pending.splice(0)) await write;
    },
    commit: () => batches.flush(),
    abort: async () => undefined,
  }, ownRead ? options : {
    ...options,
    dumpsDir: undefined,
    onProgress: ({ downloaded, read: done }) => options.onMeasure?.(done > 0 ? done : downloaded, file.expectedBytes ?? 0),
  });
  return { ...read, kept: reader.listings };
}

/**
 * Keep the listings of every Wikivoyage edition from the dump date of `own`
 * (English Wikivoyage's articles), and swap them in once every edition's file
 * is read and verified.
 */
export async function buildListings(own: DumpFile, options: TableBuildOptions): Promise<ReadResult & { summary?: string }> {
  if (options.trial) throw new Error('The listings have no trial build: an edition is kept from its whole file');
  options.onPhase(`Finding the articles of ${WIKIVOYAGE_EDITIONS.length} Wikivoyage editions...`);
  const files = await editionFiles(own, options.signal);
  const kept: Record<string, number> = {};
  const totals = { bytes: 0, lines: 0 };
  let ownRead: ReadResult | null = null;

  await createNextTable();
  try {
    for (const [at, { site, file }] of files.entries()) {
      options.onPhase(`Reading ${file.fileName} (edition ${at + 1} of ${files.length})...`);
      const read = await keepEdition(site, file, options, file === own);
      if (file === own) ownRead = read;
      kept[site] = read.kept;
      totals.bytes += read.bytes;
      totals.lines += read.lines;
    }
    options.signal.throwIfAborted();
    const all = Object.values(kept).reduce((sum, n) => sum + n, 0);
    if (all === 0) throw new Error('The build kept no listing of any edition, so the listings in place stay');
    options.onPhase('Indexing the listings...');
    await indexNextTable(options.signal);
    await swapIn(options.buildId, own.date, kept, options.signal);
    // The build's row records its own file, English Wikivoyage's articles; the editions' totals are the summary's.
    const read = ownRead ?? { bytes: 0, lines: 0, checksumActual: null };
    return {
      ...read,
      summary: `kept ${all.toLocaleString('en')} listings that name a Wikidata item in ${files.length} Wikivoyage editions `
        + `(English ${(kept.enwikivoyage ?? 0).toLocaleString('en')}), from the ${own.date} dumps; `
        + `read ${files.length} files, ${totals.lines.toLocaleString('en')} lines and ${totals.bytes.toLocaleString('en')} bytes`,
    };
  } catch (error) {
    await dropNextTable().catch(() => undefined);
    throw error;
  }
}
