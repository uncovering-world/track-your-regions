import { describe, expect, it } from 'vitest';
import type { Experience } from '../../api/experiences';
import { cardAboveGroups, echoRows, groupByEveryKind, homeKindOf, rowsByKindName } from './kindRows';

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

/**
 * Dresden Elbe Valley, delisted by UNESCO in 2009, as it would read were a
 * second kind also to list it (#1289): former as a World Heritage Site, current
 * in the other kind.
 */
const DRESDEN = {
  id: 1156, name: 'Dresden Elbe Valley', kind_id: 1, kind_name: 'World Heritage Sites', kind_priority: 1,
  type: 'cultural', source_membership: 'present',
  kinds: [
    { kind_id: 1, kind_name: 'World Heritage Sites', kind_priority: 1, type: 'cultural', source_id: 1,
      external_id: '1156', source_membership: 'former' },
    { kind_id: 3, kind_name: 'Public art', kind_priority: 3, type: null, source_id: 3,
      external_id: 'dresden-elbe-valley', source_membership: 'present' },
  ],
} as Experience;

describe('a place in the group of every kind it is offered in', () => {
  it('lists the place under each of its kinds, as that kind shows it, and counts it in each', () => {
    const groups = groupByEveryKind([CAPITOLINE, DORIA]);

    expect(groups.map(group => group.kindName)).toEqual(['Art Museums', 'Archaeology']);
    expect(names(groups[0].experiences)).toEqual(['Capitoline Museums:2', 'Galleria Doria Pamphilj:2']);
    expect(groups[1].experiences).toEqual([expect.objectContaining({ id: 6214, kind_id: 5, type: 'museum' })]);
    expect(rowsByKindName([CAPITOLINE, DORIA])).toEqual(new Map([['Art Museums', 2], ['Archaeology', 1]]));
  });

  it('marks the place former under the kind whose source delisted it, and only there (#1289)', () => {
    const groups = groupByEveryKind([DRESDEN]);

    expect(groups.map(group => [group.kindName, group.experiences[0].source_membership])).toEqual([
      ['World Heritage Sites', 'former'],
      ['Public art', 'present'],
    ]);
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

  it('opens the card above the groups for a place in several kinds opened from its pin (#1262)', () => {
    expect(cardAboveGroups([CAPITOLINE, DORIA], 6214, null)).toBe(CAPITOLINE);
    // Opened from a row: the card is in that kind's row instead.
    expect(cardAboveGroups([CAPITOLINE, DORIA], 6214, 5)).toBeNull();
    // A place in one kind opens in its row, as it always has.
    expect(cardAboveGroups([CAPITOLINE, DORIA], 6229, null)).toBeNull();
    expect(cardAboveGroups([CAPITOLINE, DORIA], null, null)).toBeNull();
  });

  it('makes every row of that place an echo, and leaves the other places alone', () => {
    const groups = groupByEveryKind([CAPITOLINE, DORIA]);
    const echoes = echoRows(groups, 6214, null, true);
    const capitolineRows = groups.flatMap(group => group.experiences).filter(row => row.id === 6214);

    expect(capitolineRows).toHaveLength(2);
    for (const row of capitolineRows) expect(echoes.has(row)).toBe(true);
    expect(echoes.has(groups[0].experiences[1])).toBe(false);
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

describe('a group\'s places, the best known first', () => {
  /** A place of worship in Rome with its fame there, listed by name as the list answers. */
  const church = (id: number, name: string, fame: number | null) => ({
    id, name, kind_id: 4, kind_name: 'Places of worship', kind_priority: 4, type: 'church',
    kinds: [{ kind_id: 4, kind_name: 'Places of worship', kind_priority: 4, type: 'church', source_id: 4,
      external_id: `Q${id}`, fame }],
  }) as Experience;

  it('opens on the best known, a place not measured yet after the measured, and keeps name order among equals', () => {
    const listed = [
      church(1, 'Abbey of Monte Cassino', 0.62),
      church(2, 'Archbasilica of St. John Lateran', 0.9),
      church(3, 'New chapel', null),
      church(4, 'Pantheon', 0.97),
      church(5, "St. Peter's Basilica", 0.99),
      church(6, 'Santa Maria Maggiore', 0.9),
    ];
    expect(groupByEveryKind(listed)[0].experiences.map(row => row.name)).toEqual([
      "St. Peter's Basilica", 'Pantheon', 'Archbasilica of St. John Lateran', 'Santa Maria Maggiore',
      'Abbey of Monte Cassino', 'New chapel',
    ]);
  });

  it('keeps the list\'s name order in a kind that measures no fame', () => {
    expect(names(groupByEveryKind([DORIA, CAPITOLINE])[0].experiences))
      .toEqual(['Galleria Doria Pamphilj:2', 'Capitoline Museums:2']);
  });
});
