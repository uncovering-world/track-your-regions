import { describe, expect, it } from 'vitest';
import type { Experience } from '../../api/experiences';
import { echoRows, groupByEveryKind, homeKindOf, rowsByKindName } from './kindRows';

/** The Capitoline Museums once merged, beside a museum in one kind. */
const CAPITOLINE = {
  id: 6214, name: 'Capitoline Museums', kind_id: 2, kind_name: 'Art Museums', kind_priority: 2, type: null,
  kinds: [
    { kind_id: 2, kind_name: 'Art Museums', kind_priority: 2, type: null, source_id: 2, external_id: 'Q333906' },
    { kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, type: 'museum', source_id: 5, external_id: 'Q333906' },
  ],
} as Experience;
const DORIA = {
  id: 6229, name: 'Galleria Doria Pamphilj', kind_id: 2, kind_name: 'Art Museums', kind_priority: 2, type: null,
  kinds: [{ kind_id: 2, kind_name: 'Art Museums', kind_priority: 2, type: null, source_id: 2, external_id: 'Q1203458' }],
} as Experience;

const names = (rows: Experience[]) => rows.map(row => `${row.name}:${row.kind_id}`);

describe('a place in the group of every kind it is offered in', () => {
  it('lists the place under each of its kinds, as that kind shows it, and counts it in each', () => {
    const groups = groupByEveryKind([CAPITOLINE, DORIA]);

    expect(groups.map(group => group.kindName)).toEqual(['Art Museums', 'Archaeology']);
    expect(names(groups[0].experiences)).toEqual(['Capitoline Museums:2', 'Galleria Doria Pamphilj:2']);
    expect(groups[1].experiences).toEqual([expect.objectContaining({ id: 6214, kind_id: 5, type: 'museum' })]);
    expect(rowsByKindName([CAPITOLINE, DORIA])).toEqual(new Map([['Art Museums', 2], ['Archaeology', 1]]));
  });

  it('opens the card in the first kind, and keeps the other row folded', () => {
    const groups = groupByEveryKind([CAPITOLINE]);
    const echoes = echoRows(groups, 6214, null);

    expect(echoes.has(groups[0].experiences[0])).toBe(false);
    expect(echoes.has(groups[1].experiences[0])).toBe(true);
  });

  it('moves the card to the kind the reader opened it from, for the open place only', () => {
    const groups = groupByEveryKind([CAPITOLINE]);
    const opened = echoRows(groups, 6214, 5);
    expect(opened.has(groups[1].experiences[0])).toBe(false);
    expect(opened.has(groups[0].experiences[0])).toBe(true);

    // Another place is open: the Capitoline Museums keep their first kind as home.
    expect(echoRows(groups, 6229, 5).has(groups[0].experiences[0])).toBe(false);
  });

  it('opens in the first kind where the place is not offered in the one asked for', () => {
    expect(homeKindOf(CAPITOLINE, 4)).toBe(2);
    expect(homeKindOf(CAPITOLINE, 5)).toBe(5);
  });

  it('lists a row that carries no kinds under its own, as before the field', () => {
    const cached = { ...DORIA, kinds: undefined } as unknown as Experience;
    const groups = groupByEveryKind([cached]);
    expect(names(groups[0].experiences)).toEqual(['Galleria Doria Pamphilj:2']);
    expect(echoRows(groups, null, null).size).toBe(0);
  });

  it('keeps every row the same object across rebuilds, the place\'s own where the kind is its own', () => {
    // ExperienceListItem is memoised on its row and the groups are rebuilt on every pan.
    const first = groupByEveryKind([CAPITOLINE, DORIA]);
    const again = groupByEveryKind([CAPITOLINE, DORIA]);

    expect(first[0].experiences[0]).toBe(CAPITOLINE);
    expect(first[0].experiences[1]).toBe(DORIA);
    expect(again[1].experiences[0]).toBe(first[1].experiences[0]);
  });
});
