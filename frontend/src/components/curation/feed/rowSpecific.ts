/**
 * The words a row prints once it is drawn: the colour and short label a question kind
 * takes wherever a curator sees it collapsed to one line (a chip, a heading), and the
 * text after that word — which field, how many places, why refused.
 *
 * Split out of `queueRows.ts` to keep that file under the size the development guide asks
 * for — this is the field-name humaniser and the parts/contents arithmetic, none of it
 * about walking `order`. `queueRows.ts` re-exports everything here, so a consumer still
 * writes `import { KIND_COLOR, KIND_SHORT, rowSpecific } from './queueRows'`.
 */

import type { HeldPart, ReviewQueueItem } from '../../../api/experiences';
import type { GatedGroup } from '../WaitingToPublish';
import type { RowKind } from '../queueRowTypes';

/**
 * The colour a *question* is drawn in — never an object's own colour.
 *
 * `kindColors.ts` answers what an object *is* (a museum's blue, a monument's teal,
 * refined by World Heritage's own type); this map answers what is being *asked* about it,
 * and the two vocabularies are deliberately unrelated. A museum holding a change is
 * `waiting`'s blue here whatever the museum palette calls its own blue, and a UNESCO
 * conflict is this map's red whether the site itself draws cultural purple or natural
 * green. `arrival` and `contents` are two of `waiting`'s own sub-questions, coloured on
 * their own because a `waiting` row's specific text names which of its sub-kinds it is
 * actually about.
 */
export const KIND_COLOR: Record<RowKind | 'arrival' | 'contents', string> = {
  conflicts: '#C62828',
  waiting: '#1565C0',
  arrival: '#2E7D32',
  contents: '#00838F',
  withdrawn: '#EF6C00',
  refused: '#6A1B9A',
  missing: '#757575',
};

/** The question word a row prints in bold, ahead of its specific text. */
export const KIND_SHORT: Record<RowKind | 'arrival' | 'contents', string> = {
  conflicts: 'disagrees on',
  waiting: 'holds a change',
  arrival: 'new arrival',
  contents: 'unread',
  withdrawn: 'lost places',
  refused: 'refused',
  missing: 'gone from the source',
};

/**
 * A held or proposed field's own name, in the words a curator reads rather than the ones
 * the sync writer stores it under. `nameLocal.<code>` is a family rather than one key —
 * handled as a pattern below, never entered here — and a field this map does not name at
 * all keeps its bare key with a `metadata.` prefix dropped, which still reads better than
 * the raw key for a field nobody has met yet.
 */
const FIELD_LABEL: Record<string, string> = {
  'metadata.criteria': 'criteria',
  'metadata.wikipediaUrl': 'Wikipedia link',
  'metadata.imageCredit': 'picture credit',
  imageUrl: 'picture',
  'metadata.creators': 'makers',
  shortDescription: 'short description',
  countryNames: 'countries',
  'metadata.dateInscribed': 'year inscribed',
};

function humaniseField(field: string): string {
  if (field.startsWith('nameLocal.')) return `name (${field.slice('nameLocal.'.length)})`;
  if (field in FIELD_LABEL) return FIELD_LABEL[field];
  return field.startsWith('metadata.') ? field.slice('metadata.'.length) : field;
}

function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** `proposed_parts`, as `N work(s)` / `N place(s)` — a work per `'treasures'`, a place per `'locations'`. */
function partsLabels(parts: HeldPart[]): string[] {
  const works = parts.filter(p => p.kind === 'treasures').length;
  const places = parts.filter(p => p.kind === 'locations').length;
  const labels: string[] = [];
  if (works > 0) labels.push(countLabel(works, 'work', 'works'));
  if (places > 0) labels.push(countLabel(places, 'place', 'places'));
  return labels;
}

/**
 * A `waiting` group's specific: the held fields, then its parts, then its unread contents
 * — every piece of it that is actually open, comma-joined. An arrival is always alone
 * (`groupGated`'s own comment: `held` fires only off a non-`pending` row and `contents`
 * hides a `pending` container outright), so nothing else on the group can be open when it
 * is present, and the row reads *new arrival* with nothing after it.
 */
function waitingSpecific(group: GatedGroup): string {
  if (group.arrival) return '';
  const pieces: string[] = [];
  pieces.push(...(group.held?.proposed ?? []).map(f => humaniseField(f.field)));
  pieces.push(...partsLabels(group.held?.proposed_parts ?? []));
  if (group.contents) {
    const works = group.contents.pending_treasures ?? 0;
    const places = group.contents.pending_locations ?? 0;
    pieces.push(`unread: ${countLabel(works, 'work', 'works')}, ${countLabel(places, 'place', 'places')}`);
  }
  return pieces.join(', ');
}

/**
 * The text after a row's question word — the word already says what kind of question this
 * is, so this says which one: which fields, how many places, why refused. `''` for a kind
 * whose question needs nothing after it (`missing`), or whose group has nothing open beyond
 * the word itself (a bare arrival).
 */
export function rowSpecific(row: { kind: RowKind; item?: ReviewQueueItem; group?: GatedGroup }): string {
  switch (row.kind) {
    case 'missing':
      return '';
    case 'refused':
      return row.item?.admission_reason ?? '';
    case 'conflicts':
      return (row.item?.proposed ?? []).map(f => humaniseField(f.field)).join(', ');
    case 'withdrawn':
      return countLabel(row.item?.withdrawn_points?.length ?? 0, 'place', 'places');
    case 'waiting':
      return row.group ? waitingSpecific(row.group) : '';
    default:
      return '';
  }
}

/**
 * The bold word a row prints ahead of its specific — `KIND_SHORT[row.kind]`, except a
 * `waiting` row grouping an arrival, which asks the arrival's own question rather than
 * `waiting`'s (an arrival is always alone, so there is never a second sub-kind competing
 * with it). Kept here so the list that draws the row does not repeat this one rule itself.
 */
export function rowQuestionWord(row: { kind: RowKind; subs?: readonly string[] }): string {
  if (row.kind === 'waiting' && row.subs?.includes('arrival')) return KIND_SHORT.arrival;
  return KIND_SHORT[row.kind];
}
