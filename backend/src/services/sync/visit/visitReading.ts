/**
 * Jev's reading of what a visitor finds at a place (#1768): the fifth signal
 * beside the four witnesses (`witnesses.ts`), and the only one that tells a
 * part of a larger place, an object kept elsewhere or a culture from a place
 * one goes to. ADR-0087 keeps it a suggestion a curator applies.
 *
 * One `choice` over six readings, asked with the place's name, countries and
 * kinds, the map's tag and the lead of its English Wikipedia article. The
 * lead is what Jev reads a place by: over the 150 places judged by a person
 * for #1718 and dry run 178 (2026-10-21, #1768), Jev asked as this module
 * asks reads 14 of the 21 places with nothing to see as nothing or not a
 * place, where a five-way question without the lead read 5. It names 5 of
 * the door's 6 parts (the Lupanar at 0.93, the Propylaea of Athens, Saint
 * Peter's tomb), and reads 10 of the 28 places with nothing to see, not a
 * place or a city's predecessor as nothing, not a place or an object at
 * confidence 0.7 or more, against 3 of the 112 worth a visit, all three of
 * them groups of sites or a route.
 */

import { askWikipediaOnce, enwikiTitleOf, pagesOf, type CategoryPage } from '../wikipediaCategories.js';
import { WaitBudget } from '../sourceRetry.js';
import { userAgent } from '../../../config/userAgent.js';
import type { JevChoiceQuestion } from '../../jev/jevClient.js';

/** What Jev can read a place as, in the options it is given. */
export const VISIT_READINGS = ['visit', 'part', 'object', 'nothing', 'not-a-place', 'other-kind'] as const;
export type VisitReading = (typeof VISIT_READINGS)[number];

/** Each reading, in the words Jev reads. */
const CRITERIA: Record<VisitReading, string> = {
  visit: 'A place a visitor goes to and finds something to see or enter today: a building, a monument, a sculpture, '
    + 'a shrine in use, standing ruins, a cave or site open to visitors.',
  part: 'A part of a larger place a visitor goes to as a whole, and sees only by going there: one building inside '
    + 'Pompeii, a gate of the Acropolis, a tomb under a basilica, a temple inside a forum, a carving on a temple wall, '
    + 'a hill or layer of a site with its own name.',
  object: 'An object kept in a museum or a church rather than a place: a statue, a stele, an inscription, a relic.',
  nothing: 'Little or nothing is visible today: buried, built over, under water, demolished, removed, closed or off '
    + 'limits, or only foundations nobody would go to see.',
  'not-a-place': "Not one place: a culture, a kingdom, a period, an institution, a city's ancient name under a living "
    + 'city, or a group of many sites.',
  'other-kind': 'A place a visitor does go to, but not for what the kinds listed offer: a temple still in worship '
    + 'listed as ruins, a castle, an observatory, a memorial or a monument in a street listed as an ancient site.',
};

const INSTRUCTIONS = 'A travel catalogue offers `name` as a place to visit in the kinds listed. Decide what it is for '
  + "a visitor today. Use what you know of it and the article's lead; the OpenStreetMap tag says how mappers drew it "
  + 'and may be missing or loose.';

/** How much of a lead Jev is sent: the measurement's cut, enough for what a place is and what is left of it. */
export const LEAD_CHARS = 1500;

/** A place as the question is built from it: what `askedSql` records. */
export interface VisitAsked {
  name: string;
  countries: string[];
  kinds: string[];
  /** The OpenStreetMap tag the run read the place by, or null. */
  map: string | null;
  /** The place's Wikipedia article, or null. */
  article: string | null;
}

/** The question for one place: the place as data, its lead where one was read, and the six readings. */
export function visitQuestion(place: VisitAsked, lead: string | null): JevChoiceQuestion {
  return {
    state: {
      name: place.name,
      countries: place.countries,
      kinds: place.kinds,
      ...(place.map ? { openstreetmap_tag: place.map } : {}),
      ...(lead ? { wikipedia_lead: lead } : {}),
    },
    instructions: INSTRUCTIONS,
    criteria: CRITERIA,
  };
}

/**
 * How long a curator's card waits for the lead: one ask, never retried, since
 * the reading is optional and a lead that does not come in time is a question
 * not asked this time.
 */
const LEAD_WAIT_MS = 5_000;

type ExtractPage = CategoryPage & { extract?: string };

/**
 * The lead of a place's English Wikipedia article, cut to `LEAD_CHARS`, or
 * null where the place has no English Wikipedia article or its page is
 * missing. Throws where English Wikipedia could not be read in time, which
 * is not an answer: a reading asked without the lead would be kept for the
 * place without it. Only the title is taken from the URL; the question goes
 * to English Wikipedia's API under the project's User-Agent.
 */
export async function articleLead(articleUrl: string | null, fetchImpl?: typeof fetch): Promise<string | null> {
  const title = enwikiTitleOf(articleUrl);
  if (!title) return null;
  const answer = await askWikipediaOnce({
    action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', redirects: '1', titles: title,
    format: 'json', formatversion: '2',
  }, { userAgent: userAgent(), fetchImpl, timeoutMs: LEAD_WAIT_MS }, new WaitBudget(0), `the lead of ${title}`);
  const page = (pagesOf(answer) as ExtractPage[]).find((one) => !one.missing);
  const lead = page?.extract?.trim();
  return lead ? lead.slice(0, LEAD_CHARS) : null;
}
