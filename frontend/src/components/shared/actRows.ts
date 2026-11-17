/**
 * An act of the curation log as rows of an audit table (#956): which fact it
 * changed, what it was before and what it is after, so an admin auditing a
 * curator and a curator reading a place's history read one act the same way.
 *
 * A value the log never recorded is `null` and reads "not recorded", never a
 * dash: a dash says the fact was empty. An act that changes no fact it can lay
 * out (a merge, a pair answered, a part moved) keeps its one sentence from the
 * History in `note`, across the two value columns.
 */

import { CURATOR_REFUSAL_REASON } from '@tyr/shared/lifecycle';
import { AGAINST_THE_RULE_ACTIONS, type CurationLogAction } from '@tyr/shared/curationLog';
import { fieldLabel as fieldWord } from '../curation/fieldMeaning';
import { refusalSummary } from '../curation/refusalReason';
import { typeLabelFor } from '../../utils/experienceTypes';
import { plural } from '../../utils/plural';
import { formatLogDetails, logValue as clippedValue, releasedContents } from './curationLog';

/** A value whole: an audit table compares two values, and a clipped pair can read the same. */
const logValue = (value: unknown) => clippedValue(value, Number.POSITIVE_INFINITY);

/** One act as the table reads it: its action, what it wrote, and the kind its membership names. */
export interface Act {
  action: CurationLogAction;
  details: Record<string, unknown> | null;
  kind_name: string | null;
}

/** One row of an act: the fact and its two values, or a sentence where it lays out none. */
export interface ActRow {
  fact: string | null;
  /** The value before; null where the log did not record it. */
  before?: string | null;
  after?: string | null;
  /** The act's sentence, across the two value columns, where it changes no fact it can lay out. */
  note?: string;
}

/** The acts a curator takes against what the rule decided: the list the trail's count reads too. */
const AGAINST_THE_RULE = new Set<CurationLogAction>(AGAINST_THE_RULE_ACTIONS);

export function againstTheRule(act: Pick<Act, 'action'>): boolean {
  return AGAINST_THE_RULE.has(act.action);
}

const IN_BY_THE_RULE = 'In, by the rule';
const OUT_BY_THE_RULE = 'Out, by the rule';
/** Keys an edit writes beside its changes, which are not facts of the place. */
const NOT_FACTS = new Set(['heldSettled', 'locationId', 'treasureId', 'anchorMoved']);

/** A fact's name as a column reads it: the card's word for the field, capitalised ("commemorates" reads "Commemorates"). */
function fieldLabel(field: string): string {
  const word = fieldWord(field);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const changeOf = (value: unknown) => value as { old?: unknown; new?: unknown } | null;
const entriesOf = (value: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(value) ? value.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object') : []);

/** The kind a verdict was about: the membership's, or the name the act wrote. */
function kindOf(act: Act): string | null {
  return act.kind_name ?? text(act.details?.kind);
}

/**
 * An edit's changed facts, each with its two values, and what it turned down of
 * a run's proposal. A point's or a work's edit names which one, since a serial
 * site's points and a museum's works share the place's row ("Place #14700 ·
 * Location", as the History has always said it).
 */
function editRows(d: Record<string, unknown>, part = ''): ActRow[] {
  const rows: ActRow[] = Object.entries(d)
    .filter(([key, value]) => !NOT_FACTS.has(key) && changeOf(value)?.old !== undefined && changeOf(value)?.new !== undefined)
    .map(([key, value]) => ({ fact: part + fieldLabel(key), before: logValue(changeOf(value)!.old), after: logValue(changeOf(value)!.new) }));
  for (const settled of entriesOf(d.heldSettled)) {
    if (settled.answer === 'refused' && typeof settled.field === 'string') {
      rows.push({ fact: fieldLabel(settled.field), note: `Turned down the run's: ${logValue(settled.proposed)}` });
    }
  }
  return rows;
}

/** A verdict on the place's standing in its kind; an act logged before the log named the membership says "Its kind". */
function verdictRows(act: Act, before: string, after: string): ActRow[] {
  const rows: ActRow[] = [{ fact: kindOf(act) ?? 'Its kind', before, after }];
  // Whether later runs keep the answer (#1368): a card's answer chooses, a batch's never pins.
  const pinned = act.details?.pinned;
  if (pinned === true) rows.push({ fact: null, note: 'Remembered on later runs' });
  if (pinned === false) rows.push({ fact: null, note: 'For now: the next run applies the rule again' });
  return rows;
}

const partOf = (noun: string, id: unknown) => (id === undefined || id === null ? '' : `${noun} #${String(id)} · `);
const notes = (lines: readonly string[]): ActRow[] => lines.map((line) => ({ fact: null, note: line }));

type RowsOf = (act: Act, d: Record<string, unknown>) => ActRow[] | null;

function sourceTaken(_act: Act, d: Record<string, unknown>): ActRow[] {
  const rows: ActRow[] = entriesOf(d.fields).map((e) => (e.appliesAtNextSync
    ? { fact: fieldLabel(String(e.field)), note: 'The source’s value, at the next sync' }
    : { fact: fieldLabel(String(e.field)), before: null, after: logValue(e.applied) }));
  // What taking it did beside the field: a pin handed back with a coordinate, a credit dropped with a picture.
  const moved = Array.isArray(d.movedPoints) ? d.movedPoints.length : 0;
  const handed = Array.isArray(d.releasedPoints) ? d.releasedPoints.length : 0;
  if (moved > 0) rows.push({ fact: null, note: `${plural(moved, 'point')} moved back to the source’s coordinate` });
  else if (handed > 0) rows.push({ fact: null, note: `${plural(handed, 'point')} handed back to the source` });
  if (d.releasedCredit) rows.push({ fact: null, note: 'Picture credit dropped with it' });
  return rows;
}

/**
 * A source's or a gated run's proposal turned down, per field, and for a run's
 * the fields of a serial site's parts and a museum's works ("Torre del Oro ·
 * Picture"), the moved point turned down with a coordinate (ADR-0083) and what
 * the card still holds open: nothing else in the history records those.
 */
function turnedDown(act: Act, d: Record<string, unknown>): ActRow[] {
  const whose = act.action === 'declined_source' ? 'source’s' : 'run’s';
  const rows: ActRow[] = entriesOf(d.fields).map((e) => ({ fact: fieldLabel(String(e.field)), note: `Turned down the ${whose}: ${logValue(e.declined)}` }));
  for (const part of entriesOf(d.parts)) {
    if (part.field === undefined) continue;
    rows.push({ fact: `${text(part.name) ?? 'A part'} · ${fieldLabel(String(part.field))}`, note: `Turned down the ${whose}: ${logValue(part.declined)}` });
  }
  if (typeof d.movedPointRefused === 'number') rows.push({ fact: null, note: 'The moved point turned down with it' });
  if (typeof d.heldLeftOpen === 'number' && d.heldLeftOpen > 0) rows.push({ fact: null, note: `${d.heldLeftOpen} still waiting on this card` });
  return rows;
}

const stringsOf = (value: unknown) => (Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string') : []);

/**
 * A publication: the run's fields it let through, the ones it left as the
 * curator wrote them, and the points and works it released. A whole arrival
 * published under its kind reads as the place itself going from waiting to
 * shown; a publication of contents alone moves no place, so it says only
 * what it released.
 */
function published(act: Act, d: Record<string, unknown>): ActRow[] {
  const rows: ActRow[] = stringsOf(d.fields).map((field) => ({ fact: fieldLabel(field), before: 'Waiting', after: 'Shown to readers' }));
  rows.push(...stringsOf(d.claimedFieldsSkipped).map((field) => ({ fact: fieldLabel(field), note: 'Kept as the curator wrote it' })));
  // A part's fields the publication applied, named with the part ("The Surrender of Breda · Name").
  for (const part of entriesOf(d.parts)) {
    const name = text(part.name) ?? 'A part';
    rows.push(...stringsOf(part.fields).map((field) => ({ fact: `${name} · ${fieldLabel(field)}`, before: 'Waiting', after: 'Shown to readers' })));
    rows.push(...stringsOf(part.claimedFieldsSkipped).map((field) => ({ fact: `${name} · ${fieldLabel(field)}`, note: 'Kept as the curator wrote it' })));
  }
  if (!rows.length && d.scope !== 'contents' && !entriesOf(d.parts).length) {
    rows.push({ fact: kindOf(act) ?? 'The place', before: 'Waiting', after: 'Shown to readers' });
  }
  rows.push(...notes(releasedContents(d)));
  if (typeof d.heldLeftOpen === 'number' && d.heldLeftOpen > 0) rows.push({ fact: null, note: `Left waiting: ${d.heldLeftOpen}` });
  return rows;
}

function arrivalRefused(act: Act, d: Record<string, unknown>): ActRow[] {
  const moved = text((d.movedTo as { kind?: unknown } | undefined)?.kind);
  return verdictRows(act, IN_BY_THE_RULE, moved ? `Out, into ${moved}` : 'Out');
}

function kindAdded(act: Act, d: Record<string, unknown>): ActRow[] {
  const type = text(d.type) && typeof d.kindId === 'number' ? typeLabelFor(d.kindId, String(d.type)) : null;
  return [{ fact: kindOf(act), before: 'Out', after: type ? `In, as ${type.toLowerCase()}` : 'In' }];
}

/** A curator's word on a place in a whole (#2118): whether the place is a part of it, before and after. */
function partWord(act: Act, d: Record<string, unknown>): ActRow[] | null {
  const whole = text(d.wholeName);
  if (!whole) return null;
  const part = text(d.partName) ?? 'Yes';
  if (act.action === 'part_taken_out') return [{ fact: `Part of ${whole}`, before: part, after: d.keptOut === true ? 'No, kept out' : 'No' }];
  const rows: ActRow[] = [{ fact: `Part of ${whole}`, before: 'No', after: part }];
  if (d.becameWhole === true) rows.push({ fact: whole, before: 'One place', after: 'A place made of parts' });
  return rows;
}

/** A list line of a whole moved from one place to another (#2118). */
function lineMoved(_act: Act, d: Record<string, unknown>): ActRow[] | null {
  const whole = text(d.wholeName);
  if (!whole) return null;
  const line = text(d.lineName) ? `${d.lineName} (${String(d.reference)})` : String(d.reference);
  const rows: ActRow[] = [{ fact: `${line} in ${whole}`, before: text(d.fromName), after: text(d.toName) }];
  // A curator overriding a source: the place the line left stays out while a source still names it.
  if (d.keptOut === true) rows.push({ fact: null, note: `${text(d.fromName) ?? 'The place it left'} kept out while a source still names it` });
  return rows;
}

/** Each action that lays a fact out, and how; every other keeps its History sentence. */
const ROWS: Partial<Record<CurationLogAction, RowsOf>> = {
  edited: (_act, d) => editRows(d),
  location_edited: (_act, d) => editRows(d, partOf('Place', d.locationId)),
  work_edited: (_act, d) => editRows(d, partOf('Work', d.treasureId)),
  accepted_source: sourceTaken,
  declined_source: turnedDown,
  declined_held: turnedDown,
  published,
  admission_overridden: (act) => verdictRows(act, OUT_BY_THE_RULE, 'In'),
  admission_confirmed: (act) => verdictRows(act, OUT_BY_THE_RULE, 'Out'),
  admission_pin_released: (act) => verdictRows(act, 'Pinned', 'The rule decides'),
  arrival_refused: arrivalRefused,
  kept_out: (act) => verdictRows(act, 'In', 'Out'),
  kind_added: kindAdded,
  part_added: partWord,
  part_put_back: partWord,
  part_taken_out: partWord,
  part_replaced: lineMoved,
};

/** An act's sentence in the History's words, from the details given. */
const sentenceOf = (action: CurationLogAction, details: Record<string, unknown> | null) =>
  formatLogDetails({ action, details } as unknown as Parameters<typeof formatLogDetails>[0]);

/** The act's rows: the facts it changed, or its sentence where it changed none it can lay out. */
export function actRows(act: Act): ActRow[] {
  const d = act.details ?? {};
  const rows = ROWS[act.action]?.(act, d) ?? null;
  if (rows && rows.length) return rows;
  // Without the note: `actNote` shows it once, beside the row.
  const details = act.details ? Object.fromEntries(Object.entries(act.details).filter(([key]) => key !== 'note')) : null;
  const sentence = sentenceOf(act.action, details);
  return [{ fact: null, note: sentence ?? '' }];
}

const systemNoteOf = (d: Record<string, unknown>) =>
  (text(d.systemNote) ? [`Recorded by the system: ${String(d.systemNote)}`] : []);

/** A verdict that published the place: said, with the contents it released (ADR-0025 § 4.5). */
const publishedWith = (d: Record<string, unknown>) => (d.published ? ['Published', ...releasedContents(d)] : []);

/**
 * What an act recorded beyond its rows, *Why* and its note, per action that
 * has rows: a script's own note on how an answer came about, what a verdict
 * published with it, the kind an arrival came from before it was added to
 * another. Each is said here and nowhere else, so nothing is said twice.
 */
const BEYOND_ROWS: Partial<Record<CurationLogAction, (d: Record<string, unknown>) => string[]>> = {
  admission_overridden: (d) => [...systemNoteOf(d), ...publishedWith(d)],
  admission_confirmed: (d) => [...systemNoteOf(d), ...publishedWith(d)],
  admission_pin_released: (d) => systemNoteOf(d),
  kind_added: (d) => {
    const from = d.fromArrival as { kind?: unknown; stays?: unknown } | undefined;
    if (!from || typeof from.kind !== 'string') return [];
    return [`From its arrival in ${from.kind}, ${from.stays === true ? 'asked to be published there too' : 'kept out there'}`];
  },
};

/**
 * What the act recorded beyond what its rows, *Why* and the note show, in the
 * History's words. Shown under the row on demand, so no field the log holds
 * goes unshown now the raw record is gone; null where the rows say it all.
 */
export function actRecord(act: Act): string | null {
  const lines = BEYOND_ROWS[act.action]?.(act.details ?? {}) ?? [];
  return lines.length ? lines.join('\n') : null;
}

/** The curator's own words on the act, where they wrote some. */
export function actNote(act: Act): string | null {
  return text(act.details?.note)?.trim() || null;
}

/**
 * Why the rule decided as it did, for a verdict on it: the rule's reason in
 * words (`refusalSummary`). A curator's own no has none; nor has an act no rule
 * decided.
 */
export function actWhy(act: Act): string | null {
  if (!['admission_overridden', 'admission_confirmed', 'admission_pin_released'].includes(act.action)) return null;
  const reason = text(act.details?.reason);
  if (!reason || reason === CURATOR_REFUSAL_REASON) return null;
  return refusalSummary(reason).text;
}
