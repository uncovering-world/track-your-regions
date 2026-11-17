/**
 * What a list of a place's periods means on a review card (#2578).
 *
 * A gated run asks a curator before it changes when a place readers see stood
 * or was in use. The card shows the list the place holds beside the one its
 * source reports, each period a line of `periodLines`, and one sentence about
 * what taking the proposed list does: it says the place is gone, or that it
 * was not there for the years of a gap. The source cannot tell a gap from a
 * ruin that stood all along, as the Odeon of Herodes Atticus in Athens did
 * from 267 to 1953, so the sentence says when to keep the current list.
 */

import { standsBy, type PlaceDate } from '@tyr/shared/lifetime';
import { placeDateLabel } from '../../utils/placeDateLabel';
import { filedPeriods, periodLines, yearsBetween, type FiledPeriod } from '../../utils/placePeriodsLabel';
import type { FieldMeaning } from './fieldMeaning';

type Says = 'stood' | 'used';

/** The list in words, a line a period; a value that is no list, as itself. */
const render = (says: Says) => (value: unknown): string => {
  const periods = filedPeriods(value);
  if (!periods) return JSON.stringify(value);
  return periods.length > 0 ? periodLines(says, periods).join('\n') : 'no dates';
};

interface Gap { until: PlaceDate; from: PlaceDate; years: number }

/** The gaps of a list whose two dates are known, each with its length in years. */
function gapsOf(periods: readonly FiledPeriod[]): Gap[] {
  return periods.flatMap((period, index) => {
    const [until, from] = [period.until, periods[index + 1]?.from];
    return until && from ? [{ until, from, years: yearsBetween(until, from) }] : [];
  });
}

const gapWords = (gap: Gap): string => `${placeDateLabel(gap.until)} to ${placeDateLabel(gap.from)}`;

/** The longest gap the proposed list has and the current one lacks. */
function newGap(was: readonly FiledPeriod[], is: readonly FiledPeriod[]): Gap | null {
  const held = gapsOf(was).map(gapWords);
  return gapsOf(is).filter(gap => !held.includes(gapWords(gap))).sort((a, b) => b.years - a.years)[0] ?? null;
}

/** What taking the proposed standing periods says of the place. */
function describeStood(before: unknown, after: unknown): string | null {
  const [was, is] = [filedPeriods(before), filedPeriods(after)];
  if (!was || !is) return null;
  if (standsBy(was) && !standsBy(is)) {
    return 'Taking the proposed list says the place is gone. It leaves today’s lists and stays among what is no longer there, and for past trips.';
  }
  if (!standsBy(was) && standsBy(is)) return 'Taking the proposed list says the place stands again, and puts it back on today’s lists.';
  const gap = newGap(was, is);
  if (!gap) return null;
  const years = gap.years.toLocaleString();
  return `Taking the proposed list says the place was not there from ${gapWords(gap)}, ${years} years. `
    + 'Keep the current one if something stood here to visit, a ruin included.';
}

export const LIFETIME_MEANINGS: Readonly<Record<Says, FieldMeaning>> = {
  stood: {
    label: 'when it stood',
    what: 'The periods in which the place itself stood: built, destroyed, rebuilt. Read from Wikidata’s inception, its end, and its dated destructions and reconstructions.',
    whenItChanges: 'Wikidata dates a destruction or a rebuilding. It cannot tell a place that was gone from a ruin that stood all along. Check the article before taking a long gap or an end.',
    render: render('stood'),
    event: true,
    describeChange: describeStood,
  },
  used: {
    label: 'in use until',
    what: 'When what the place housed or was used for ended: an abbey dissolved, a settlement abandoned. The place itself still stands.',
    whenItChanges: 'Dates get corrected on Wikidata. The place stays on today’s lists either way.',
    render: render('used'),
  },
};
