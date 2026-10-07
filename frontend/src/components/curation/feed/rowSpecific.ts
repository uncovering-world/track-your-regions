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

import type { HeldPart, ReviewQueueItem } from '../../../api/reviewQueue';
import { sectionKind, type GatedGroup } from '../gatedGroup';
import type { RowKind } from '../queueRowTypes';
import { creditFoldsIntoPicture } from '../factRows';
import { HELD_CREDIT_FIELD } from '@tyr/shared/pictures';

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
  'metadata.foundAt': 'find spot',
  imageUrl: 'picture',
  location: 'coordinates',
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
 * The unread contents in the card's own words, so the line and the card count
 * alike (#524): what arrived, the new points apart from the moved ones, and
 * nothing for a count of nothing. The point the object's held coordinate takes
 * along (`coordinates_move_point_id`) is that coordinate, already named among
 * the fields, so it is not counted twice.
 */
function contentsLabels(contents: ReviewQueueItem): string[] {
  const works = Number(contents.pending_treasures ?? 0);
  const moved = Number(contents.pending_moved_locations ?? 0);
  const newPoints = Number(contents.pending_locations ?? 0) - moved;
  const movedAsked = moved - (contents.coordinates_move_point_id != null ? 1 : 0);
  const labels: string[] = [];
  if (works > 0) labels.push(`${countLabel(works, 'work', 'works')} arrived`);
  if (newPoints > 0) labels.push(countLabel(newPoints, 'new point', 'new points'));
  if (movedAsked > 0) labels.push(`${countLabel(movedAsked, 'point', 'points')} moved`);
  return labels;
}

/**
 * One section's specific: the held fields, then its parts, then its unread contents —
 * every piece of it that is actually open, comma-joined. An arrival is always alone in
 * its section (`groupGated`'s own comment: `held` fires only off a non-`pending`
 * membership), so nothing else in the section can be open when it is present, and it
 * reads *new arrival* with nothing after it.
 */
function sectionSpecific(group: GatedGroup): string {
  if (group.arrival) return '';
  const pieces: string[] = [];
  const proposed = group.held?.proposed ?? [];
  // The facts the card's table draws, so the line and the card count alike: a
  // credit proposed beside its picture is that picture's, not a fact of its own.
  const folded = creditFoldsIntoPicture(proposed);
  pieces.push(...proposed
    .filter(f => !(folded && f.field === HELD_CREDIT_FIELD))
    .map(f => humaniseField(f.field)));
  pieces.push(...partsLabels(group.held?.proposed_parts ?? []));
  if (group.contents) pieces.push(...contentsLabels(group.contents));
  return pieces.join(', ');
}

/**
 * A `waiting` row's specific: its one section's, or — where two kinds ask about the
 * place (#1264) — each kind's, named, since the question word then counts them.
 */
function waitingSpecific(sections: readonly GatedGroup[]): string {
  if (sections.length === 1) return sectionSpecific(sections[0]);
  return sections
    .map(group => `${sectionKind(group)}: ${sectionSpecific(group) || KIND_SHORT.arrival}`)
    .join('; ');
}

/**
 * The text after a row's question word — the word already says what kind of question this
 * is, so this says which one: which fields, how many places, why refused. `''` for a kind
 * whose question needs nothing after it (`missing`), or whose group has nothing open beyond
 * the word itself (a bare arrival).
 */
export function rowSpecific(row: {
  kind: RowKind; item?: ReviewQueueItem; items?: readonly ReviewQueueItem[]; sections?: readonly GatedGroup[];
}): string {
  switch (row.kind) {
    case 'missing': {
      // Where readers still see a place one kind's source stopped listing (#1264) —
      // the row's kind chip already names the kind that lost it; nothing after the
      // word where the place itself is gone.
      const seen = (row.items ?? []).find(item => item.membership_id != null)?.seen_in ?? [];
      return seen.length > 0 ? `still under ${seen.join(', ')}` : '';
    }
    case 'refused':
      // Each kind's reason, named, where two kinds' rules refused the place (#1264).
      if (row.items && row.items.length > 1) {
        return row.items.map(item => `${item.kind_name}: ${item.admission_reason ?? ''}`).join('; ');
      }
      return row.item?.admission_reason ?? '';
    case 'conflicts':
      return (row.item?.proposed ?? []).map(f => humaniseField(f.field)).join(', ');
    case 'withdrawn':
      return countLabel(row.item?.withdrawn_points?.length ?? 0, 'place', 'places');
    case 'waiting':
      return row.sections ? waitingSpecific(row.sections) : '';
    default:
      return '';
  }
}

/**
 * The bold word a row prints ahead of its specific — `KIND_SHORT[row.kind]`, except a
 * `waiting` row grouping an arrival, which asks the arrival's own question rather than
 * `waiting`'s (an arrival is always alone in its section, so there is never a second
 * sub-kind competing with it), and a `waiting` row two kinds ask about (#1264), which
 * counts its questions and lets the specific name each. Kept here so the list that draws
 * the row does not repeat this one rule itself.
 */
export function rowQuestionWord(row: {
  kind: RowKind; subs?: readonly string[]; sections?: readonly GatedGroup[];
}): string {
  if (row.kind === 'waiting' && (row.sections?.length ?? 0) > 1) return `${row.sections!.length} questions`;
  if (row.kind === 'waiting' && row.subs?.includes('arrival')) return KIND_SHORT.arrival;
  return KIND_SHORT[row.kind];
}
