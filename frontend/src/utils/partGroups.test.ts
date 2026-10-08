import { describe, expect, it } from 'vitest';
import { filterParts, groupParts, UNPLACED_GROUP } from './partGroups';

const part = (regionPath: string | null, hasPicture = false, name = '') => ({ regionPath, hasPicture, name });

describe('grouping an object\'s parts', () => {
  it('groups by country where the parts span several, largest first', () => {
    const groups = groupParts([
      part('Europe > Switzerland > Aargau', true), part('Europe > Italy > Lombardia'),
      part('Europe > Switzerland > Genève', true), part('Europe > Switzerland > Zürich'),
      part('Europe > Slovenia > Ljubljana'),
    ]);
    expect(groups.map(g => [g.label, g.parts.length, g.withPicture])).toEqual([
      ['Switzerland', 3, 2], ['Italy', 1, 0], ['Slovenia', 1, 0],
    ]);
  });

  it('groups by the first-level region where every part is in one country', () => {
    const groups = groupParts([
      part('Europe > Spain > Aragón'), part('Europe > Spain > Comunidad Valenciana'),
      part('Europe > Spain > Comunidad Valenciana', true),
    ]);
    expect(groups.map(g => [g.label, g.parts.length])).toEqual([['Comunidad Valenciana', 2], ['Aragón', 1]]);
  });

  it('lists the unplaced last, and makes one group of parts that never part ways', () => {
    expect(groupParts([part(null), part('Europe > Spain > Aragón'), part('Europe > Spain > Aragón')])
      .map(g => g.label)).toEqual(['Aragón', UNPLACED_GROUP]);
  });
});

describe('filtering an object\'s parts', () => {
  const fold = (text: string) => text.toLowerCase();
  const parts = [part(null, true, 'Cova dels Cavalls'), part(null, false, 'Pinós'), part(null, true, 'Coves de la Saltadora')];

  it('keeps a part whose name holds the search, and only parts with a picture where asked', () => {
    expect(filterParts(parts, 'cov', false, fold, p => p.name).map(p => p.name)).toEqual(['Cova dels Cavalls', 'Coves de la Saltadora']);
    expect(filterParts(parts, '', true, fold, p => p.name).map(p => p.name)).toEqual(['Cova dels Cavalls', 'Coves de la Saltadora']);
    expect(filterParts(parts, 'pin', true, fold, p => p.name)).toEqual([]);
  });
});
