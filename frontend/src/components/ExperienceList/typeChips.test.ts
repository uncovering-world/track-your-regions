/**
 * The type chips of an open card (#1915): the card above the groups names each
 * kind beside its type, the card inside a group the type alone.
 */

import { describe, expect, it } from 'vitest';
import type { Experience } from '../../api/experiences';
import { experienceColors } from '../../utils/kindColors';
import { typeChipsFor } from './typeChips';

type Row = Pick<Experience, 'kind_id' | 'type' | 'kinds'>;

const kind = (kind_id: number, kind_name: string, type: string | null) => ({ kind_id, kind_name, kind_priority: kind_id, type });

/** The Serapeum of Alexandria: a temple to Places of worship, a site to Archaeology. */
const serapeum = {
  kind_id: 4, type: 'temple',
  kinds: [kind(4, 'Places of worship', 'temple'), kind(5, 'Archaeology', 'site')],
} as unknown as Row;

describe('typeChipsFor', () => {
  it('names each kind beside its type on the card above the groups, in the kind\'s colour', () => {
    expect(typeChipsFor(serapeum, true)).toEqual([
      { key: 4, label: 'Places of worship · Temple', style: experienceColors(4, 'temple') },
      { key: 5, label: 'Archaeology · Site', style: experienceColors(5, 'site') },
    ]);
  });

  it('words the type as the kind\'s own chips do, and names a kind with no type alone', () => {
    // A World Heritage site that is also listed as an art museum, a kind with no types.
    const heritageMuseum = {
      kind_id: 1, type: 'cultural',
      kinds: [kind(1, 'World Heritage Sites', 'cultural'), kind(2, 'Art Museums', null)],
    } as unknown as Row;
    expect(typeChipsFor(heritageMuseum, true).map(chip => chip.label))
      .toEqual(['World Heritage Sites · Cultural', 'Art Museums']);
  });

  it('shows the type alone inside a group, and nothing where the row has none', () => {
    expect(typeChipsFor(serapeum, false)).toEqual([{ key: 4, label: 'Temple', style: experienceColors(4, 'temple') }]);
    expect(typeChipsFor({ kind_id: 1, type: 'cultural', kinds: [] } as unknown as Row, false)
      .map(chip => chip.label)).toEqual(['Cultural']);
    expect(typeChipsFor({ kind_id: 2, type: null, kinds: [] } as unknown as Row, false)).toEqual([]);
  });
});
