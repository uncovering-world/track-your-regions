/**
 * A place in the group of every kind it is offered in (ADR-0084, #1245).
 *
 * A place belongs to no kind, so the region's list shows it under each of its
 * kinds as an equal: the Capitoline Museums under Art Museums and under
 * Archaeology, each row in that kind's colour and with that kind's type
 * (`shownInKind`), and each group's count is the rows it holds, which is what the
 * kind's count says.
 *
 * One of a place's rows is its **home**: the row its card opens in, the one the
 * list scrolls to and keeps a reference to. It is the row of the kind the reader
 * opened the card from, and otherwise the place's first kind in display order.
 * Its other rows are **echoes**: they stay folded, and a click on one moves the
 * card there. A place in one kind, every place until a merge (#1247), has a home
 * row and no echo, so the list reads exactly as it did.
 *
 * **Rows keep their identity.** `ExperienceListItem` is memoised on its row, and
 * the groups are rebuilt on every pan, so a row is the place's own object where
 * the kind is its own kind, and otherwise one object per place and kind, kept
 * for as long as the place's own object lives. Which rows are echoes is a set
 * apart from the groups, so opening a card rebuilds no row.
 */

import type { Experience } from '../../api/experiences';
import { formerIn, shownInKind } from '../../utils/placeKinds';

export interface KindGroup {
  kindName: string;
  kindPriority: number;
  experiences: Experience[];
}

/**
 * The kinds a row is listed under: its offered kinds, or its own where it
 * carries none — a row cached from an answer older than the field has none.
 */
function kindsOf(exp: Experience): Array<{ kind_id: number; kind_name: string; kind_priority: number }> {
  return exp.kinds?.length
    ? exp.kinds
    : [{ kind_id: exp.kind_id, kind_name: exp.kind_name, kind_priority: exp.kind_priority }];
}

/** Each place's rows in its other kinds, kept for as long as the place's own object lives. */
const shownRows = new WeakMap<Experience, Map<number, Experience>>();

/** The place as one of its kinds shows it, the same object every time it is asked. */
function rowIn(exp: Experience, kindId: number): Experience {
  const kind = exp.kinds?.find(entry => entry.kind_id === kindId);
  // A kind former while the place is still listed elsewhere draws its own row,
  // with the mark the place's own fields do not carry (#1289).
  const isOwn = kind !== undefined && kind.kind_id === exp.kind_id && kind.kind_name === exp.kind_name
    && kind.kind_priority === exp.kind_priority && kind.type === exp.type
    && (!formerIn(kind) || exp.source_membership === 'former');
  if (kind === undefined || isOwn) return exp;
  let rows = shownRows.get(exp);
  if (!rows) {
    rows = new Map();
    shownRows.set(exp, rows);
  }
  let row = rows.get(kindId);
  if (!row) {
    row = shownInKind(exp, kindId) ?? exp;
    rows.set(kindId, row);
  }
  return row;
}

/**
 * The kind a place's card opens in: the one the reader opened it from where the
 * place is offered in it, otherwise its first kind.
 */
export function homeKindOf(exp: Experience, openedKindId: number | null): number {
  const kinds = kindsOf(exp);
  if (openedKindId !== null && kinds.some(kind => kind.kind_id === openedKindId)) return openedKindId;
  return kinds[0].kind_id;
}

/** The groups, in the kinds' display order, with every place under each of its kinds. */
export function groupByEveryKind(listed: Experience[]): KindGroup[] {
  const byName = new Map<string, KindGroup>();
  for (const exp of listed) {
    for (const kind of kindsOf(exp)) {
      const row = rowIn(exp, kind.kind_id);
      const name = row.kind_name || 'Experiences';
      if (!byName.has(name)) {
        byName.set(name, { kindName: name, kindPriority: row.kind_priority ?? 100, experiences: [] });
      }
      byName.get(name)!.experiences.push(row);
    }
  }
  return [...byName.values()].sort((a, b) => a.kindPriority - b.kindPriority);
}

/**
 * The selected place's card when it opens above the groups (#1262): a place in
 * several kinds whose card was not opened from one of its rows — a click on its
 * pin, or an address naming it. No kind of it is the primary one, so its card
 * stands over all of them, and each group's row of it says it is selected. A
 * click on one of those rows moves the card into that kind (`openFrom`). Null
 * for a place in one kind, whose card opens in its row as it always has, and
 * for a card opened from a row.
 */
export function cardAboveGroups(
  listed: Experience[],
  selectedExperienceId: number | null,
  openedKindId: number | null,
): Experience | null {
  if (selectedExperienceId === null || openedKindId !== null) return null;
  const place = listed.find(exp => exp.id === selectedExperienceId);
  return place && (place.kinds?.length ?? 0) >= 2 ? place : null;
}

/**
 * The rows that are echoes rather than homes. `openedKindId` is the kind the
 * selected place was opened from, and moves only that place's home; with its
 * card above the groups (`cardAbove`), every row of it is an echo.
 */
export function echoRows(
  groups: KindGroup[],
  selectedExperienceId: number | null,
  openedKindId: number | null,
  cardAbove = false,
): Set<Experience> {
  const echoes = new Set<Experience>();
  for (const group of groups) {
    for (const row of group.experiences) {
      if (isEcho(row, row.id === selectedExperienceId, openedKindId, cardAbove)) echoes.add(row);
    }
  }
  return echoes;
}

/** Whether one row of a place is an echo rather than its home; see `echoRows`. */
function isEcho(row: Experience, selected: boolean, openedKindId: number | null, cardAbove: boolean): boolean {
  if (!row.kinds?.length || row.kinds.length < 2) return false;
  if (selected && cardAbove) return true;
  return row.kind_id !== homeKindOf(row, selected ? openedKindId : null);
}

/** How many rows each kind holds, by its name: a place counts once in each of its kinds. */
export function rowsByKindName(experiences: Experience[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const exp of experiences) {
    for (const kind of kindsOf(exp)) {
      const name = kind.kind_name || 'Experiences';
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
  }
  return totals;
}
