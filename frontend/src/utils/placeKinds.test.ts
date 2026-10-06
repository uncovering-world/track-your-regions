import { describe, expect, it } from 'vitest';
import { kindToOpenIn, placeHasExtent, placeKindNames, shownInKind } from './placeKinds';

/** The Capitoline Museums once merged: one place, offered in Art Museums and Archaeology. */
const CAPITOLINE = {
  id: 6214,
  name: 'Capitoline Museums',
  kind_id: 2,
  kind_name: 'Art Museums',
  kind_priority: 2,
  type: null,
  kinds: [
    { kind_id: 2, kind_name: 'Art Museums', kind_priority: 2, type: null },
    { kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, type: 'museum' },
  ],
};

describe('a place in one of its kinds', () => {
  it('shows the place in a kind other than the one its first source brought', () => {
    const shown = shownInKind(CAPITOLINE, 5);

    expect(shown).toMatchObject({ id: 6214, kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, type: 'museum' });
    // Every kind is still carried: showing it in one does not drop the others.
    expect(shown?.kinds).toHaveLength(2);
  });

  it('answers null for a kind the place is not offered in', () => {
    expect(shownInKind(CAPITOLINE, 4)).toBeNull();
  });
});

describe('the kind a card opens under when the address names none', () => {
  it('is the row\'s own kind where the place is offered in it', () => {
    expect(kindToOpenIn(CAPITOLINE)).toBe(2);
  });

  it('is another kind the place is offered in where its own is not', () => {
    // Art Museums refused it; Archaeology still offers it.
    expect(kindToOpenIn({ ...CAPITOLINE, kinds: CAPITOLINE.kinds.slice(1) })).toBe(5);
  });

  it('is none where the place is offered in no kind', () => {
    expect(kindToOpenIn({ ...CAPITOLINE, kinds: [] })).toBeNull();
  });
});

describe('the names a hover card gives a place (#1262)', () => {
  it('names every kind it is offered in, in display order', () => {
    expect(placeKindNames(CAPITOLINE)).toBe('Art Museums · Archaeology');
  });

  it('names its own kind where it carries no kinds', () => {
    expect(placeKindNames({ kind_name: 'Art Museums', kinds: [] })).toBe('Art Museums');
    expect(placeKindNames({ kind_name: 'Art Museums' })).toBe('Art Museums');
  });

  it('names nothing where there is no name at all', () => {
    expect(placeKindNames({ kind_name: '', kinds: [] })).toBeNull();
  });
});

describe("whether a place's card reads a site's finds (#1262)", () => {
  // The Pantheon once merged: a church first, and a site in Archaeology.
  const PANTHEON = {
    kind_id: 4, type: 'church',
    kinds: [
      { kind_id: 4, kind_name: 'Places of worship', kind_priority: 4, type: 'church' },
      { kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, type: 'site' },
    ],
  };

  it('reads them above the groups, where the card stands over every kind', () => {
    expect(placeHasExtent(PANTHEON, true)).toBe(true);
  });

  it("reads only the row's own kind in a kind's row", () => {
    expect(placeHasExtent(PANTHEON, false)).toBe(false);
    expect(placeHasExtent({ ...PANTHEON, kind_id: 5, type: 'site' }, false)).toBe(true);
  });
});
