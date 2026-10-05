import { describe, expect, it } from 'vitest';
import { kindToOpenIn, shownInKind } from './placeKinds';

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
