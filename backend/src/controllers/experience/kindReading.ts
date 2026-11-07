/**
 * Jev's reading of which kind an arriving place belongs to (#2342, ADR-0087):
 * the question, as data. A place often arrives in a kind it does not belong
 * to — Michelangelo's David came to Monuments & memorials through English
 * Wikipedia's monuments categories, the Cellular Jail is a historical site —
 * and the kind it does belong to may be one the catalogue has not built yet.
 *
 * One `choice` over the catalogue's live kinds, the place kinds the coverage
 * register plans (`coverage_kinds`, `status = 'proposed'`, ADR-0081), and
 * none of them, each given with the register's definition: the definitions
 * are what a curator files by, so they are what Jev reads. World Heritage
 * Sites is not offered: a place is one by UNESCO's inscription alone, which
 * the UNESCO run reads and no curator can add (`INSCRIBED_KIND_ID`).
 *
 * The place goes without the kind it is arriving in or the kinds it is
 * offered in. On 66 places labelled by hand for #2342 (2026-11-07: the
 * monuments-category entrance's candidates, the latest runs' arrivals, the
 * places Public art and Monuments & memorials both admit, and the entrance's
 * refusals), the question told the arriving kind and asked to keep it where
 * it fits agreed with the labels on 56; told nothing of the catalogue's
 * filing, on 61, and on 48 of the 49 it answered at confidence 0.7 or more.
 * Told the kind, Jev read ValuJet Flight 592, the USS Indianapolis and the
 * Last Address plaques as monuments; told nothing, as no kind.
 */

import type { JevChoiceQuestion } from '../../services/jev/jevClient.js';

/** The option for a place no kind, live or planned, holds. */
export const NO_KIND = 'none';

/** One kind Jev may name: a live kind by its id, a planned one by the register's slug. */
export type KindOption =
  | { live: true; kindId: number; name: string; definition: string }
  | { live: false; slug: string; name: string; definition: string; issue: number | null };

/** The option key a kind goes to Jev under, and comes back by. */
export function optionKey(option: KindOption): string {
  return option.live ? `kind-${option.kindId}` : `planned-${option.slug}`;
}

/** A place as the question is built from it: what `askedSql` records. */
export interface KindReadingAsked {
  name: string;
  countries: string[];
  /** The place's one-line description, or null. */
  description: string | null;
  /** The OpenStreetMap tag the run read the place by, or null. */
  map: string | null;
  /** The place's Wikipedia article, or null. */
  article: string | null;
}

const NONE_CRITERION = 'None of these kinds: not one place a visitor goes to, or a place no kind above describes — '
  + 'a work of art or an object kept inside a museum or a church, a type of object of which there are many '
  + '(a khachkar, a cairn, a series of plaques), an event, a ship or wreck on the sea floor, a road or highway, an '
  + 'airport, a school, an organisation, or a place that is not there any more.';

const INSTRUCTIONS = 'A travel catalogue files every place under the kinds a traveller browses by. Which one kind '
  + 'does a traveller look for `name` under? Choose the kind whose definition says what the place is for a visitor '
  + 'today and what they go there for: its purpose, not its shape. A statue raised to commemorate someone is a '
  + 'monument, a sculpture made to be looked at is public art, a fort is a castle or fortress whatever it commemorates '
  + 'now, a prison or battlefield remembered for what happened there is a historical site. Use what you know of it and '
  + "the article's lead; the OpenStreetMap tag says how mappers drew it and may be missing or loose.";

/** The question for one place: the place as data, its lead where one was read, and one option per kind and none. */
export function kindReadingQuestion(
  place: KindReadingAsked, options: readonly KindOption[], lead: string | null,
): JevChoiceQuestion {
  const criteria: Record<string, string> = {};
  for (const option of options) criteria[optionKey(option)] = `${option.name}: ${option.definition}`;
  criteria[NO_KIND] = NONE_CRITERION;
  return {
    state: {
      name: place.name,
      countries: place.countries,
      ...(place.description ? { description: place.description } : {}),
      ...(place.map ? { openstreetmap_tag: place.map } : {}),
      ...(lead ? { wikipedia_lead: lead } : {}),
    },
    instructions: INSTRUCTIONS,
    criteria,
  };
}
