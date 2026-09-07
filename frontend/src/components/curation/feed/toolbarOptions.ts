/**
 * What the review feed's chips offer: the rows of each menu, built from the
 * server's facets and the address's own words.
 *
 * Separated from `ReviewToolbar.tsx` because it is data and arithmetic rather
 * than layout — the questions a curator may filter by, in the order they are
 * worked down, and the two rules that make a facet row readable: a region root
 * needs its world view where the name repeats, and the unplaced bucket goes
 * last. None of it counts anything: every number here is the facet the server
 * computed under the other filters.
 */

import type { QueueFacets } from '../../../api/experiences';
import type { ReviewAddress } from '../../../utils/appUrl';
import type { FilterOption } from './FilterChip';
import { KIND_COLOR } from '../queueRows';

/**
 * The questions the kind chip offers, in the order a curator works down them.
 *
 * The three sub-kinds `waiting` groups are rows of their own, because "waiting
 * to be published" is three different pieces of work: an arrival nobody has
 * looked at, a change held off a published row, and contents that arrived after
 * it. `label` is the question as the page states it, `short` is what the chip
 * says once it is picked, and the swatch is the question's own colour — never
 * the object's (`KIND_COLOR`).
 */
const KIND_OPTIONS: Array<{ key: string; label: string; short: string; swatch: string }> = [
  {
    key: 'conflict',
    label: 'The source disagrees with an edit',
    short: 'disagreements',
    swatch: KIND_COLOR.conflicts,
  },
  {
    key: 'arrival',
    label: 'New arrivals, nobody has looked',
    short: 'new arrivals',
    swatch: KIND_COLOR.arrival,
  },
  {
    key: 'held',
    label: 'A visible row holds a change',
    short: 'holding a change',
    swatch: KIND_COLOR.waiting,
  },
  {
    key: 'contents',
    label: 'A visible row holds unread places or works',
    short: 'unread contents',
    swatch: KIND_COLOR.contents,
  },
  {
    key: 'withdrawn',
    label: 'Places these objects are made of are gone',
    short: 'lost places',
    swatch: KIND_COLOR.withdrawn,
  },
  {
    key: 'refused',
    label: 'Our own rule for this list turned these down',
    short: 'refused',
    swatch: KIND_COLOR.refused,
  },
  {
    key: 'missing',
    label: 'Gone from the source',
    short: 'gone from the source',
    swatch: KIND_COLOR.missing,
  },
];

/** What the question chip says once a kind is picked: its short word, never the API's. */
export function kindShort(key: string): string {
  return KIND_OPTIONS.find(o => o.key === key)?.short ?? key;
}

/** The address's `regionId` as a menu key, and back. `'none'` is the unplaced bucket. */
function regionKey(id: number | null): string {
  return id === null ? 'none' : String(id);
}

/** The sources, each with what picking it would leave. */
export function sourceOptions(facets: QueueFacets | undefined, picked: number[]): FilterOption[] {
  return (facets?.source ?? []).map(s => ({
    key: String(s.id),
    label: s.name,
    count: s.count,
    checked: picked.includes(s.id),
  }));
}

/**
 * The seven questions, counted. Empty until the facets arrive: a chip that
 * showed zeros before the first answer would be claiming a number nobody gave
 * it.
 */
export function kindOptions(facets: QueueFacets | undefined, picked: string[]): FilterOption[] {
  if (!facets) return [];
  const counts = new Map(facets.kind.map(k => [k.kind as string, k.count]));
  return KIND_OPTIONS.map(k => ({
    key: k.key,
    label: k.label,
    count: counts.get(k.key) ?? 0,
    checked: picked.includes(k.key),
    swatch: k.swatch,
  }));
}

/**
 * A root's name, plus the world view it is a root of where the name alone does
 * not identify it: two roots are called Europe (world views 2 and 5), and seven
 * of the eight continents repeat that way. Where a name is unique the world
 * view is noise, so it is not printed.
 */
function regionLabel(row: QueueFacets['region'][number], repeated: Set<string>): string {
  if (row.id === null) return 'Unplaced — in no region';
  return repeated.has(row.name) && row.worldView ? `${row.name} · ${row.worldView}` : row.name;
}

/** The offered roots in the facet's own order, unplaced last because it is not a place. */
export function regionOptions(
  facets: QueueFacets | undefined,
  picked: ReviewAddress['regionId'],
): FilterOption[] {
  if (!facets) return [];
  const seen = new Map<string, number>();
  facets.region.forEach(r => seen.set(r.name, (seen.get(r.name) ?? 0) + 1));
  const repeated = new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  const pickedKey = picked === null ? '' : String(picked);
  const placed = facets.region.filter(r => r.id !== null);
  const unplaced = facets.region.filter(r => r.id === null);
  return [...placed, ...unplaced].map(r => ({
    key: regionKey(r.id),
    label: regionLabel(r, repeated),
    count: r.count,
    checked: regionKey(r.id) === pickedKey,
  }));
}
