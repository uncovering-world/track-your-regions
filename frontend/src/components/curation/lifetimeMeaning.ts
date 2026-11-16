/**
 * What each date of a place's lifetime means on a review card (#1719).
 *
 * A gated run asks a curator before it changes a date readers see, and before
 * it ends a place readers see. The card shows the date the place holds and the
 * one the source reports, each as `placeDateLabel` writes it, and an end with
 * how the place ended. An end is an event: publishing it takes the place off
 * today's lists, and the card says so.
 */

import type { LifetimeSlot, PlaceDate } from '@tyr/shared/lifetime';
import { isEmptyValue } from '@tyr/shared/equality';
import { placeDateLabel } from '../../utils/placeDateLabel';
import type { FieldMeaning } from './fieldMeaning';

/** A date as the changeset files it: the date, and on an end how the place ended. */
type FiledDate = PlaceDate & { ending?: string | null };

function filedDate(value: unknown): FiledDate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const date = value as Partial<FiledDate>;
  const year = date.year;
  if (year !== null && typeof year !== 'number') return null;
  return {
    year, month: date.month ?? null, day: date.day ?? null, span: date.span ?? null,
    circa: date.circa === true, ending: date.ending ?? null,
  };
}

/** The date as a person reads it; a value that is not one, as itself. */
function dateLabel(value: unknown): string {
  const date = filedDate(value);
  return date ? placeDateLabel(date) ?? 'date unknown' : String(value ?? '');
}

/** An end with how it came: "demolished 5 Dec 1931", "demolished, date unknown", or the date alone. */
function endLabel(value: unknown): string {
  const date = filedDate(value);
  if (!date) return String(value ?? '');
  const when = placeDateLabel(date);
  if (!date.ending) return when ?? 'date unknown';
  return when ? `${date.ending} ${when}` : `${date.ending}, date unknown`;
}

/** Two starts a century or more apart may be two buildings, one rebuilt on the other. */
function describeStart(before: unknown, after: unknown): string | null {
  const [was, is] = [filedDate(before)?.year, filedDate(after)?.year];
  if (typeof was !== 'number' || typeof is !== 'number' || Math.abs(is - was) < 100) return null;
  return 'A century or more apart. Check whether the place was rebuilt.';
}

export const LIFETIME_MEANINGS: Readonly<Record<LifetimeSlot, FieldMeaning>> = {
  began: {
    label: 'began',
    what: 'When the place first stood or was founded, from Wikidata’s inception or opening date. Göbekli Tepe began about 10,000 BC.',
    whenItChanges: 'Dates get corrected on Wikidata. A few years is routine. Centuries may mean another building.',
    render: dateLabel,
    describeChange: describeStart,
  },
  rebuilt: {
    label: 'rebuilt',
    what: 'When what stands now was built again after an end. The Cathedral of Christ the Saviour in Moscow was rebuilt by 2000.',
    whenItChanges: 'Dates get corrected on Wikidata. A few years is routine. Centuries may mean another building.',
    render: dateLabel,
    describeChange: describeStart,
  },
  use_ended: {
    label: 'in use until',
    what: 'When what the place housed or was used for ended: an abbey dissolved, a settlement abandoned. The place still stands.',
    whenItChanges: 'Dates get corrected on Wikidata. The place stays on today’s lists either way.',
    render: dateLabel,
  },
  ended: {
    label: 'no longer stands',
    what: 'When the place itself stopped standing, and how: destroyed, demolished, removed or collapsed.',
    whenItChanges: 'Wikidata says the place is gone. Check the article before publishing.',
    render: endLabel,
    event: true,
    describeChange: (_before, after) => (isEmptyValue(after)
      ? 'Publishing puts the place back on today’s lists.'
      : 'Publishing takes the place off today’s lists and the map. It stays for past trips and among the gone places.'),
  },
};
