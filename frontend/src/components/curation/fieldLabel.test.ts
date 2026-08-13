/**
 * Tests for naming a field the way a person says it.
 *
 * The queue names fields as the changeset does, because that is what the accept call
 * takes. Printing `shortDescription` on a card asks a curator to read our schema, and
 * `imageUrl` is not what anyone calls a picture.
 */

import { describe, it, expect } from 'vitest';
import { fieldLabel } from './fieldLabel';

describe('fieldLabel', () => {
  it('says what the field is, not what the column is called', () => {
    expect(fieldLabel('shortDescription')).toBe('short description');
    expect(fieldLabel('imageUrl')).toBe('picture');
    expect(fieldLabel('nameLocal')).toBe('local name');
    expect(fieldLabel('location')).toBe('coordinates');
  });

  it('marks a key that lives in the source’s extra data, since those land later', () => {
    // The `metadata.*` fields are exactly the ones `accept-source` cannot write now, so a
    // curator seeing where the value lives is seeing why the button says "at next sync".
    expect(fieldLabel('metadata.dateInscribed')).toBe('date inscribed (source data)');
    expect(fieldLabel('metadata.inDanger')).toBe('in danger (source data)');
  });

  it('falls back to spaced words for a field nobody has named yet', () => {
    // A new changeset field must not render as camelCase just because this map is behind.
    expect(fieldLabel('someNewField')).toBe('some new field');
  });
});
