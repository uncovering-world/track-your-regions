/**
 * A crowded city's tail in the windowed region list (ADR-0172, #2201): a row
 * at the end of its kind's group, folded or open, and its places apart from the
 * group's own rows.
 */

import { describe, expect, it } from 'vitest';
import type { Experience } from '../../api/experiences';
import { flattenGroups, rowIndexByExperienceId, rowKey } from './utils';
import { tailSections, withTailCard, withTailGroups, type TailSection } from './tailRows';
import type { KindGroup } from './kindRows';

const WORSHIP = 4;
const place = (id: number, name: string, type = 'church') =>
  ({ id, name, type, kind_id: WORSHIP, kind_name: 'Places of worship', kind_priority: 4 }) as Experience;

const ST_PETER = place(1, "St. Peter's Basilica", 'cathedral');
const PANTHEON = place(2, 'Pantheon');
const SANTA_SABINA = place(3, 'Santa Sabina');
const SAN_CLEMENTE = place(4, 'San Clemente');
const TEMPLE = place(5, 'Temple of Hercules Victor', 'temple');

const worship: KindGroup = { kindName: 'Places of worship', kindPriority: 4, experiences: [ST_PETER, PANTHEON] };
const counts = [{ kindId: WORSHIP, type: 'church', count: 2 }, { kindId: WORSHIP, type: 'temple', count: 1 }];
const kindIdOf = new Map([['Places of worship', WORSHIP]]);

function sectionFor(open: boolean, opts: { type?: string; keepId?: number | null } = {}): TailSection | undefined {
  return tailSections({
    groupNames: ['Places of worship'],
    kindIdOf,
    counts,
    kindTypes: opts.type ? new Map([['Places of worship', opts.type]]) : new Map(),
    open: open ? new Set([WORSHIP]) : new Set(),
    places: new Map([[WORSHIP, [SANTA_SABINA, SAN_CLEMENTE, TEMPLE]]]),
    keepId: opts.keepId ?? null,
  }).get('Places of worship');
}

const shape = (rows: ReturnType<typeof flattenGroups>) => rows.map(row => {
  if (row.kind === 'header') return `H ${row.group.kindName}`;
  if (row.kind === 'tail') return `T ${row.section.label}`;
  return `${row.kind === 'tail-place' ? 'p' : 'e'} ${row.exp.name}`;
});

describe('the tail in the region list', () => {
  it('ends an open group with its folded row, after the group\'s own places', () => {
    const tails = new Map([['Places of worship', sectionFor(false)!]]);
    expect(shape(flattenGroups([worship], new Set(['Places of worship']), null, tails))).toEqual([
      'H Places of worship',
      "e St. Peter's Basilica",
      'e Pantheon',
      'T 3 shadowed places of worship: 2 churches, 1 temple',
    ]);
  });

  it('lists the open tail\'s places under its row, apart from the group\'s', () => {
    const tails = new Map([['Places of worship', sectionFor(true)!]]);
    expect(shape(flattenGroups([worship], new Set(['Places of worship']), null, tails))).toEqual([
      'H Places of worship',
      "e St. Peter's Basilica",
      'e Pantheon',
      'T 3 shadowed places of worship: 2 churches, 1 temple',
      'p Santa Sabina',
      'p San Clemente',
      'p Temple of Hercules Victor',
    ]);
  });

  it('offers nothing of a collapsed group\'s tail', () => {
    const tails = new Map([['Places of worship', sectionFor(true)!]]);
    expect(shape(flattenGroups([worship], new Set(), null, tails))).toEqual(['H Places of worship']);
  });

  it('counts and lists only the type the group is narrowed to', () => {
    const section = sectionFor(true, { type: 'church' })!;
    expect(section.label).toBe('2 shadowed churches');
    expect(section.places).toEqual([SANTA_SABINA, SAN_CLEMENTE]);
  });

  it('keeps the open card in its tail whatever the type', () => {
    expect(sectionFor(true, { type: 'church', keepId: TEMPLE.id })!.places).toContain(TEMPLE);
  });

  it('says it is loading while an open tail has not arrived', () => {
    const section = tailSections({
      groupNames: ['Places of worship'], kindIdOf, counts, kindTypes: new Map(),
      open: new Set([WORSHIP]), places: new Map(), keepId: null,
    }).get('Places of worship');
    expect(section).toMatchObject({ open: true, places: undefined });
  });

  it('aims at a tail\'s place, and at a shown row before a tail\'s row of the same place', () => {
    const tails = new Map([['Places of worship', sectionFor(true)!]]);
    const shownElsewhere: KindGroup = { kindName: 'Towers', kindPriority: 7, experiences: [{ ...SANTA_SABINA, kind_id: 7 }] };
    const rows = flattenGroups([worship, shownElsewhere], new Set(['Places of worship', 'Towers']), null, tails);
    const index = rowIndexByExperienceId(rows);
    expect(index.get(SAN_CLEMENTE.id)).toBe(5);
    expect(rows[index.get(SANTA_SABINA.id)!].kind).toBe('experience');
  });

  it('keys a tail\'s rows apart from the group\'s', () => {
    const tails = new Map([['Places of worship', sectionFor(true)!]]);
    const keys = flattenGroups([worship], new Set(['Places of worship']), null, tails).map(rowKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('t:Places of worship');
    expect(keys).toContain(`p:${SANTA_SABINA.id}:${WORSHIP}`);
  });
});

describe('withTailGroups', () => {
  const kinds = [{ id: WORSHIP, name: 'Places of worship', priority: 4 }, { id: 2, name: 'Art Museums', priority: 2 }];
  const museums: KindGroup = { kindName: 'Art Museums', kindPriority: 2, experiences: [place(9, 'Galleria Borghese')] };

  it('adds a group for a crowded kind the region holds no shown place of', () => {
    const groups = withTailGroups([museums], counts, new Set(['Art Museums']), kinds, null);
    expect(groups.map(group => group.kindName)).toEqual(['Art Museums', 'Places of worship']);
    expect(groups[1].experiences).toEqual([]);
  });

  it('leaves out a kind the map\'s view filtered away', () => {
    const groups = withTailGroups([museums], counts, new Set(['Art Museums', 'Places of worship']), kinds, null);
    expect(groups.map(group => group.kindName)).toEqual(['Art Museums']);
  });

  it('adds the group of a selected place only a tail holds', () => {
    const groups = withTailGroups([museums], counts, new Set(['Art Museums', 'Places of worship']), [], SANTA_SABINA);
    expect(groups.map(group => group.kindName)).toEqual(['Art Museums', 'Places of worship']);
  });
});

describe('withTailCard', () => {
  it('counts a place only a tail holds in its kind\'s group, for the group to open for it', () => {
    const [group] = withTailCard([worship], SANTA_SABINA);
    expect(group.experiences).toContain(SANTA_SABINA);
    expect(worship.experiences).not.toContain(SANTA_SABINA);
  });
});
