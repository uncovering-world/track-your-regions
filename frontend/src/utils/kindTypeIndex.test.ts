/**
 * What each kind of a region offers to narrow by type, and the choices that still
 * hold against it (#589).
 */

import { describe, expect, it } from 'vitest';
import { effectiveKindTypes, kindTypeIndex } from './kindTypeIndex';

/** Three of Lazio's places: two World Heritage sites, and the Capitoline Museums in two kinds. */
const places = [
  { kind_id: 1, kind_name: 'World Heritage Sites', type: 'cultural' },
  { kind_id: 1, kind_name: 'World Heritage Sites', type: 'natural' },
  {
    kind_id: 2, kind_name: 'Art Museums', type: null,
    kinds: [
      { kind_id: 2, kind_name: 'Art Museums', type: null },
      { kind_id: 5, kind_name: 'Archaeology', type: 'museum' },
    ],
  },
];

describe('kindTypeIndex', () => {
  it("counts each place once under each of its kinds, as that kind's type", () => {
    const index = kindTypeIndex(places);
    expect(index.get('World Heritage Sites')).toEqual({
      kindId: 1, size: 2, choices: [{ type: 'cultural', count: 1 }, { type: 'natural', count: 1 }],
    });
    // One type only: no choice to offer.
    expect(index.get('Archaeology')).toEqual({ kindId: 5, size: 1, choices: [] });
  });
});

describe('effectiveKindTypes', () => {
  it('keeps a choice the kind still offers', () => {
    expect(effectiveKindTypes(kindTypeIndex(places), new Map([['World Heritage Sites', 'natural']])))
      .toEqual(new Map([['World Heritage Sites', 'natural']]));
  });

  it('drops a choice the kind no longer offers, so nothing stays narrowed with no chip to undo it', () => {
    // The natural site was the region's only one, and hiding it left a single type.
    const cultural = kindTypeIndex(places.slice(0, 1));
    expect(effectiveKindTypes(cultural, new Map([['World Heritage Sites', 'natural']]))).toEqual(new Map());
  });
});
