/**
 * What a screen makes of the trail `experience_curation_log` holds.
 *
 * The table records twenty distinct actions, and two screens name one as a chip: an
 * object's own History, which is the only place a verdict's note is readable at all, and
 * the admin's curator-activity table, which asks what one curator has done. Both take an
 * act's words from here. The History adds a line under the chip saying what the row
 * carries that the chip cannot — the note a curator typed, the fields a publication
 * applied, the value taken from the source; the admin table shows the payload itself,
 * being an audit.
 *
 * `ProvenanceTrail` is the deliberate exception, and stays one. It reads the same two
 * source verdicts off the same table and puts them in a sentence — the curator's name,
 * then "refused the source's value on 14 August" — where a chip's noun phrase cannot go:
 * "Kept ours" names an act on its own, and a clause needs a verb with the person in
 * front of it. What must not diverge is which answer a row records, and that is the
 * action itself, which both read straight.
 *
 * Both halves used to fall short of the table. Nine actions reached the chip's fallback
 * and printed the column value itself, so the History said `admission_overridden` on a
 * screen a person reads, and twelve carried details nothing rendered — including the
 * six that hold a curator's note, which the cards that ask for one promise "in this
 * object's curation history" and which reached no screen at all (#691).
 *
 * Its own module rather than a block inside `CurationDialog`, because the presentation
 * is not the dialog's — the admin table proves it, and the cross-curator feed (#611) is
 * to render these rows as well. A second rendering of a curator's act is how the two
 * that existed came to disagree.
 */

import { fieldLabel } from '../curation/fieldMeaning';
import { plural } from '../../utils/plural';
import { creators } from '../../utils/creatorList';
import { creditSentence } from './ImageCreditLine';
import type { CurationLogEntry, ImageCredit } from '../../api/experiences';

// Six hues, and the sense each carries. The colour is the reader's first cue down a
// column of chips, so two acts that mean opposite things must not share one.
/** The object is out: refused, kept out, or gone from the world. */
const RED = '#EF4444';
/** Something was withheld or dropped — a region, the source's word, the source's listing. */
const AMBER = '#F59E0B';
/** It is in, or back in. */
const GREEN = '#22C55E';
/** Values moved. */
const BLUE = '#3B82F6';
/** It entered the catalogue: made, or made visible. */
const VIOLET = '#8B5CF6';
/** Its regions changed. */
const TEAL = '#0D9488';

export const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  rejected: { label: 'Rejected', color: RED },
  unrejected: { label: 'Unrejected', color: GREEN },
  edited: { label: 'Edited', color: BLUE },
  created: { label: 'Created', color: VIOLET },
  added_to_region: { label: 'Added to region', color: TEAL },
  removed_from_region: { label: 'Removed from region', color: AMBER },
  // The verdicts on one point (ADR-0026). Unlabelled, the row printed the raw
  // `location_marked_former` through the fallback below, which is machine noise on a
  // screen a person reads — and this is the only screen that has a point's verdict at
  // all, since answering one takes it off every list (#544).
  location_marked_former: { label: 'Place: source dropped it', color: AMBER },
  location_marked_lost: { label: 'Place: no longer exists', color: RED },
  location_state_restored: { label: 'Place: verdict taken back', color: GREEN },
  location_missing_dismissed: { label: 'Place: false alarm', color: GREEN },
  // The fifth member of the same family (ADR-0029) and the one that lands in this list
  // beside the four above, so leaving it out would have the History read "Place: source
  // dropped it" on one row and `location_edited` on the next.
  location_edited: { label: 'Place corrected', color: BLUE },
  // The same correction to a work rather than to a point (#720). Its own words and
  // not "Place corrected" widened: a work is shared by every museum holding it and a
  // point is not, so a trail that said one for both would hide how far the act reached.
  work_edited: { label: 'Work corrected', color: BLUE },
  // The same four verdicts about the whole object, and deliberately the same words
  // without the prefix: the prefix is the entire difference between a component's
  // departure and the whole site's (ADR-0026), and two sentences that differ in more
  // than that would hide it rather than show it.
  marked_former: { label: 'Source dropped it', color: AMBER },
  marked_lost: { label: 'No longer exists', color: RED },
  state_restored: { label: 'Verdict taken back', color: GREEN },
  missing_dismissed: { label: 'False alarm', color: GREEN },
  // The catalogue's own acts, in the words their cards use: the queue's buttons say
  // "take the source’s" and "keep this" about a source's proposal, and "keep it out" /
  // "put it back" about a refusal.
  published: { label: 'Published', color: VIOLET },
  accepted_source: { label: 'Took the source’s', color: BLUE },
  declined_source: { label: 'Kept ours', color: AMBER },
  // The gate's own refusal, and a different act from the one above it: that one
  // stands by a curator's claim, this one says "not this value" where nobody
  // claimed anything (#722). One word apart on purpose — a reader scanning a
  // history has to be able to tell which question was answered.
  declined_held: { label: 'Not this', color: AMBER },
  admission_confirmed: { label: 'Kept out', color: RED },
  admission_overridden: { label: 'Put back', color: GREEN },
};

/**
 * The verdict actions, in the two families the prefix keeps apart (ADR-0026).
 *
 * One formatter serves both — an object's verdict is a point's without the place — but
 * the sets stay separate because everything else about them does: they are written by
 * different endpoints, answered on different cards, and mean different things.
 */
const POINT_VERDICT_ACTIONS = new Set([
  'location_marked_former', 'location_marked_lost',
  'location_state_restored', 'location_missing_dismissed',
]);

const OBJECT_VERDICT_ACTIONS = new Set([
  'marked_former', 'marked_lost', 'state_restored', 'missing_dismissed',
]);

const ADMISSION_ACTIONS = new Set(['admission_confirmed', 'admission_overridden']);

/**
 * Whether a recorded value is a picture's credit.
 *
 * Known by its shape, because `details` is untyped JSON: the two fields
 * `creditForOneImage` always writes, either of which may be null. A coordinate
 * pair has neither, and a creator list is an array.
 */
function isImageCredit(value: unknown): value is ImageCredit {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && ('author' in value || 'license' in value);
}

/**
 * A value as text, and the shapes `String()` cannot render: a coordinate pair, a
 * creator list, a picture's credit.
 *
 * The object-level `edited` action records scalar column updates, so nearly every
 * value it carries stringifies. A *point* edit does not: `location_edited` writes a move as
 * `{ old: { lon, lat }, new: { lon, lat } }` (ADR-0029), and without this branch the row
 * whose whole purpose is saying what moved reads
 * `location: "[object Object]" → "[object Object]"`.
 *
 * Latitude first, as every other coordinate in the product is written — and **unrounded**,
 * unlike `coordinateLabel` on the queue's own cards, which cuts at four decimals because
 * that is finer than naming a place needs. Here it would be wrong: a correction inside the
 * writer's ten-metre tolerance is exactly what this row exists to show, and four decimals
 * would print both sides of it identically — the failure the withdrawal card documents at
 * 1.2 cm (#543).
 */
function truncate40(value: unknown): string {
  const pair = value as { lat?: unknown; lon?: unknown } | null;
  if (pair && typeof pair === 'object'
    && typeof pair.lat === 'number' && typeof pair.lon === 'number') {
    return `${pair.lat}, ${pair.lon}`;
  }
  // A work's makers are a list (#720), and `String(['a', 'b'])` is "a,b" — a shape
  // no other line in the product uses for the same fact. Through the shared
  // sentence, so a corrected attribution reads here as it reads on the card it
  // was corrected from. Empty is a value a curator can mean, and says so.
  if (Array.isArray(value)) return creators(value.map(String)) ?? '(nobody recorded)';
  // A picture's credit is an object too: an edit that replaces or removes the
  // picture records `metadata.imageCredit` beside `image_url` (the photographer
  // whose name went with it, ADR-0043), and through `String()` the row read
  // `"[object Object]" → "(empty)"` — everything but the name. The same sentence
  // the line under the picture renders, whole rather than cut at forty: an
  // author string is often that long on its own, and the licence, which is the
  // half that binds, would be the part to go. Naming nobody is the same absence
  // as no credit at all, and is called what that is called.
  if (isImageCredit(value)) return creditSentence(value) ?? '(empty)';
  // Absent rather than falsy. `metadata.inDanger` is a boolean and the counters are
  // numbers, so a source proposal this catalogue really receives — `inDanger: false`,
  // `artworkCount: 0` — read as "(empty)" under `value || …`, which is not what the row
  // says. Only a value that is genuinely missing is called empty; an empty string is,
  // since a field cleared and a field never set look the same to a reader.
  const str = value === null || value === undefined || value === '' ? '(empty)' : String(value);
  return str.length > 40 ? str.slice(0, 40) + '...' : str;
}

function formatEditedChanges(d: Record<string, unknown>): string | null {
  const changes: string[] = [];
  for (const [field, val] of Object.entries(d)) {
    const change = val as { old?: unknown; new?: unknown } | undefined;
    if (change?.old === undefined || change?.new === undefined) continue;
    changes.push(`${field}: "${truncate40(change.old)}" → "${truncate40(change.new)}"`);
  }
  return changes.length > 0 ? changes.join('\n') : null;
}

/**
 * A verdict, in the two facts the label cannot carry.
 *
 * Which place — where the act was about one — and what the curator wrote about it. The
 * transition is not repeated: the chip beside this already names it, and `details`
 * carries both axes whether or not the act moved them, so printing them would say
 * `existence: extant → extant` beside a membership verdict.
 *
 * This is the note's **only** screen, which is what makes it worth a branch of its own.
 * The row's `state_note` holds the standing answer, and taking a verdict back moves
 * `state_decided_by` and `state_decided_at` to whoever took it — so the note goes with
 * the answer it explained rather than being reattributed, and the wording survives here
 * or nowhere (#544). The card that asks for the note says as much on the field: "Kept
 * with your answer in this object's curation history."
 *
 * The place is a bare id because the log has no name to give: the audit row hangs off the
 * experience and names the point in `details.locationId`, which is what stops a serial
 * site's seven components recording seven indistinguishable verdicts. Printed as an id
 * and said to be one, rather than as a number a reader has to guess the meaning of. An
 * object's own verdict names none, and prints the note alone.
 */
function formatVerdict(d: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (d.locationId !== undefined && d.locationId !== null) parts.push(`Place #${d.locationId}`);
  if (d.note) parts.push(`“${d.note}”`);
  return parts.length > 0 ? parts.join(' — ') : null;
}

/** A count the details carry, or zero — `details` is untyped JSON and an old row may lack it. */
function countOf(value: unknown): number {
  if (typeof value === 'number') return value;
  return Array.isArray(value) ? value.length : 0;
}

/** The field names an action applied, refused or left alone, as the changeset names them. */
function fieldNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string') : [];
}

/** The per-field records `accept-source` and `decline-source` write, each with its value. */
function fieldEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> =>
    !!entry && typeof entry === 'object' && typeof (entry as { field?: unknown }).field === 'string');
}

/**
 * What a publication released, in the numbers the queue's own sentence uses.
 *
 * The two work counts are the same works from two sides — the link says a work has been
 * passed *here*, the work says it has been passed at all — so this is one number for a
 * curator, not two, exactly as `publishOutcomeFor` renders it on the card that published.
 * `withdrawalsReleased` is the one fact nothing else records: a point the source replaced
 * stops being shown at this moment, and the run that proposed the replacement says
 * nothing about when it took effect.
 */
function releasedContents(d: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const released: string[] = [];
  const points = countOf(d.locations);
  const works = Math.max(countOf(d.treasureLinks), countOf(d.treasures));
  if (points > 0) released.push(plural(points, 'point'));
  if (works > 0) released.push(plural(works, 'work'));
  if (released.length > 0) lines.push(`${released.join(' and ')} now visible`);
  if (countOf(d.withdrawalsReleased) > 0) {
    lines.push(`${plural(countOf(d.withdrawalsReleased), 'replaced point')} no longer shown`);
  }
  return lines;
}

/**
 * A publication, in what it wrote and what it made visible.
 *
 * Field names through `fieldLabel` for the reason the cards' are: the queue names them
 * the way the changeset does — `shortDescription`, `metadata.dateInscribed` — and that is
 * our word for a column, not a curator's for a thing. The skipped list is not decoration:
 * it is the difference between a publication that overwrote a curator's text and one that
 * left it standing, which the entry would otherwise be read as having done either way.
 */
function formatPublished(d: Record<string, unknown>): string | null {
  const lines: string[] = [];
  const applied = fieldNames(d.fields);
  const kept = fieldNames(d.claimedFieldsSkipped);
  if (applied.length > 0) lines.push(`Applied: ${applied.map(fieldLabel).join(', ')}`);
  if (kept.length > 0) lines.push(`Kept as curated: ${kept.map(fieldLabel).join(', ')}`);
  lines.push(...releasedContents(d));
  // What the click did not reach, which is the difference between publishing a
  // proposal and publishing one row of six (#722). The audit row carries the
  // number for exactly this reader; without the line, the two publications read
  // the same on the screen a person reconstructs a decision from. Said as a
  // count here rather than as the card's "the rest is still waiting": the log's
  // vocabulary is the record's, and the record counts the fields the run held.
  if (typeof d.heldLeftOpen === 'number' && d.heldLeftOpen > 0) {
    lines.push(`Left waiting: ${d.heldLeftOpen}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * A source value taken, per field, with what landed.
 *
 * Two kinds of acceptance, because the endpoint has two: five fields are written on the
 * spot and the rest are handed back for the next run to apply, which is a promise about
 * the future rather than a value in the row — so an entry that printed a value for them
 * would claim something that has not happened yet.
 *
 * The pin and the credit are side effects on things the card never mentioned: accepting a
 * coordinate hands back a pin the curator moved, and accepting a picture deletes the
 * credit their own edit wrote. A history that leaves them out is where a curator goes
 * looking when the map or the line under the picture changed and nothing says why.
 */
function formatAcceptedSource(d: Record<string, unknown>): string | null {
  const lines = fieldEntries(d.fields).map(entry => (entry.appliesAtNextSync
    ? `${fieldLabel(entry.field as string)}: at the next sync`
    : `${fieldLabel(entry.field as string)}: "${truncate40(entry.applied)}"`));
  // Either array, not only the second, and moved first: the server derives one from the
  // other today, and a line that goes silent about a pin that moved is what this exists
  // to prevent — not something to make conditional on that relationship holding.
  const moved = countOf(d.movedPoints);
  const handed = countOf(d.releasedPoints);
  if (moved > 0) lines.push(`${plural(moved, 'point')} moved back to the source’s coordinate`);
  else if (handed > 0) lines.push(`${plural(handed, 'point')} handed back to the source`);
  if (d.releasedCredit) lines.push('Picture credit dropped with it');
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * A source value refused, per field, with the value that was refused.
 *
 * The stored value already wins every time — `curated_fields` decides that — so what this
 * records is that somebody stood by it, and against what. Without the proposal the entry
 * says only that a field was discussed.
 */
function formatDeclinedSource(d: Record<string, unknown>): string | null {
  const lines = fieldEntries(d.fields).map(entry =>
    `${fieldLabel(entry.field as string)}: source proposed "${truncate40(entry.declined)}"`);
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * What a curator refused of a gated run's proposal, and what it left standing (#722).
 *
 * The value goes in, as it does for the refusal one card over: the decision row is the
 * standing answer and is overwritten by the next one, so this is where "what did we
 * refuse in August" survives. A part's fields are named with the part, because
 * "attribution" on a museum of two hundred works names nothing.
 *
 * What is still open is said, since it is the difference between "that was the last of
 * it" and "the card is still standing" — and nothing else in the history records it.
 */
function formatDeclinedHeld(d: Record<string, unknown>): string | null {
  const lines = fieldEntries(d.fields).map(entry =>
    `${fieldLabel(entry.field as string)}: run proposed "${truncate40(entry.declined)}"`);
  for (const part of Array.isArray(d.parts) ? d.parts : []) {
    const named = part as { name?: unknown; field?: unknown; declined?: unknown };
    if (named.field === undefined) continue;
    lines.push(`${String(named.name ?? 'a part')} — ${fieldLabel(String(named.field))}: `
      + `run proposed "${truncate40(named.declined)}"`);
  }
  if (typeof d.heldLeftOpen === 'number' && d.heldLeftOpen > 0) {
    lines.push(`${d.heldLeftOpen} still waiting on this card`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * A verdict on a rule's refusal: what the rule objected to, and what the curator made of it.
 *
 * The reason is the whole point of the card this answers, and it stays the point
 * afterwards — a run of near-identical objections in a category's history is how a bad
 * rule is found. It reads correctly under either chip: the rule said this, and it was
 * either upheld or overruled.
 *
 * An override is also a publication (ADR-0025 § 4.5) — the object becomes visible in the
 * same transaction — and that is not something to leave a reader to infer from a category
 * of act. It is said, with the contents it released beside it.
 */
function formatAdmission(d: Record<string, unknown>): string | null {
  const lines: string[] = [];
  if (d.reason) lines.push(`The rule said: ${d.reason}`);
  if (d.note) lines.push(`“${d.note}”`);
  if (d.published) lines.push('Published');
  lines.push(...releasedContents(d));
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * A correction to one part of an object, as against a verdict about its standing.
 *
 * A correction has values to show, and `details` carries only the keys the edit actually
 * changed — which is what lets the shared formatter run over it without inventing a
 * coordinate move out of a rename, or an attribution out of one.
 *
 * The part is a bare id said to be one, for the reason `formatVerdict` gives: the audit
 * row hangs off the experience and names the part in `details`, which is what stops a
 * serial site's seven components recording seven indistinguishable rows. One function for
 * a place and a work because the two differ in the key and the noun and in nothing else.
 */
function formatPartEdit(
  d: Record<string, unknown>, idKey: string, noun: string,
): string | null {
  const id = d[idKey];
  return [
    id === undefined || id === null ? null : `${noun} #${id}`,
    formatEditedChanges(d),
  ].filter(Boolean).join(' — ') || null;
}

export function formatLogDetails(entry: CurationLogEntry): string | null {
  if (!entry.details) return null;
  const d = entry.details as Record<string, unknown>;

  if (entry.action === 'rejected' && d.reason) return `Reason: ${d.reason}`;
  if (entry.action === 'edited') return formatEditedChanges(d);
  if (entry.action === 'created' && d.name) return `Name: ${d.name}`;
  if (POINT_VERDICT_ACTIONS.has(entry.action) || OBJECT_VERDICT_ACTIONS.has(entry.action)) {
    return formatVerdict(d);
  }
  if (entry.action === 'location_edited') return formatPartEdit(d, 'locationId', 'Place');
  if (entry.action === 'work_edited') return formatPartEdit(d, 'treasureId', 'Work');
  if (entry.action === 'published') return formatPublished(d);
  if (entry.action === 'accepted_source') return formatAcceptedSource(d);
  if (entry.action === 'declined_source') return formatDeclinedSource(d);
  if (entry.action === 'declined_held') return formatDeclinedHeld(d);
  if (ADMISSION_ACTIONS.has(entry.action)) return formatAdmission(d);
  // `unrejected`, `added_to_region` and `removed_from_region` never reach this line:
  // their writers insert no `details` at all, and the region their act was about is
  // already rendered beside the curator's name from the entry's own `region_name`.
  return null;
}
