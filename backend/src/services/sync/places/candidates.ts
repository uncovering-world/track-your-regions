/**
 * What a place kind with one point reads of its candidates beside its rule
 * (#1854, #1860): a year's readers for its line, and the landmark a run
 * writes for a candidate it admits. Every place kind with one point and a
 * readers' line shares them; each kind's line and rule stay its own.
 */

import type { WikidataLandmark } from '../types.js';
import type { PoolEntity } from '../publicArt/queries.js';
import { readershipYear, readWorks } from '../../dumps/readership/workReadership.js';

/**
 * A year's readers of each candidate, or null when no year is folded with the
 * redirects in place. The kind says what its line does then; `logPrefix` names
 * it in the log.
 */
export async function yearlyReaders(qids: string[], logPrefix: string): Promise<Map<string, number> | null> {
  const year = await readershipYear();
  if (!year) {
    console.log(`${logPrefix} No year of readership is folded with the redirects in place`);
    return null;
  }
  return (await readWorks(year, qids)).views;
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
