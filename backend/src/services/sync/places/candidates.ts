/**
 * What a place kind with one point reads of its candidates beside its rule
 * (#1854, #1860): a year's readers for the world bars (`worldBars.ts`) and for
 * the regional tier's pool (`regionalPool.ts`), and the landmark a run writes
 * for a candidate it admits. Every place kind with one point shares them; each
 * kind's rule stays its own.
 */

import type { WikidataLandmark } from '../types.js';
import type { PoolEntity } from '../publicArt/queries.js';
import { editionShares, readershipYear, readWorks } from '../../dumps/readership/workReadership.js';
import { chunk } from '../wikidataQueries.js';

/**
 * A year's readers of each candidate, or null when no year is folded with the
 * redirects in place. The world bars say what a run does then; `logPrefix`
 * names the kind in the log.
 */
export async function yearlyReaders(qids: string[], logPrefix: string): Promise<Map<string, number> | null> {
  const year = await readershipYear();
  if (!year) {
    console.log(`${logPrefix} No year of readership is folded with the redirects in place`);
    return null;
  }
  return (await readWorks(year, qids)).views;
}

const MANY_BATCH = 5_000;

/**
 * A year's readers of many items, by the counter `yearlyReaders` reads with,
 * the year and its editions' phone shares read once rather than once a batch:
 * the regional pool asks about hundreds of thousands of items, and the shares
 * are a pass over the whole year. Null when no year is folded. `step` runs
 * before every batch, where the run can be stopped.
 */
export async function yearlyReadersOfMany(
  qids: readonly string[], logPrefix: string, step?: () => Promise<void>,
): Promise<Map<string, number> | null> {
  const year = await readershipYear();
  if (!year) {
    console.log(`${logPrefix} No year of readership is folded with the redirects in place`);
    return null;
  }
  const shares = await editionShares(year);
  const readers = new Map<string, number>();
  for (const batch of chunk([...qids], MANY_BATCH)) {
    await step?.();
    for (const [qid, n] of (await readWorks(year, batch, shares)).views) readers.set(qid, n);
  }
  return readers;
}

/** The landmark a run writes for a candidate its kind admits, filed under `type`. */
export const placeLandmark = (entity: PoolEntity, classes: string[], type: WikidataLandmark['type']): WikidataLandmark => ({
  qid: entity.qid,
  label: entity.label,
  description: entity.description,
  lat: entity.lat!,
  lon: entity.lon!,
  imageUrl: entity.imageUrl,
  itemPictures: entity.itemPictures,
  creators: [],
  year: entity.year,
  sitelinks: entity.sitelinks,
  countryLabel: entity.countryLabel,
  type,
  classes,
  artwork: false,
  articleUrl: entity.articleUrl,
  website: entity.website,
});
