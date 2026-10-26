/**
 * The fields of a source's view are the words the schema lets a curator's
 * choice and Jev's suggestion be recorded under — held by a type, as
 * `curationLogActions.test.ts` holds the shared vocabularies. A field added to
 * `VIEW_FIELDS` and not to the two CHECKs would be asked about and could never
 * be answered: every choice of it would fail the CHECK.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { VIEW_FIELDS, type ViewField } from './sourceViews.js';
import { CHECK_VALUES, type CheckValue } from './schema.generated.js';

describe('the fields of a source view', () => {
  it('are exactly the fields a choice and a suggestion are recorded under (#1975)', () => {
    expectTypeOf<ViewField>().toEqualTypeOf<CheckValue<'experience_view_choices', 'field'>>();
    expectTypeOf<ViewField>().toEqualTypeOf<CheckValue<'experience_view_suggestions', 'field'>>();
    expect([...VIEW_FIELDS]).toEqual([...CHECK_VALUES.experience_view_choices.field]);
    expect([...VIEW_FIELDS]).toEqual([...CHECK_VALUES.experience_view_suggestions.field]);
  });
});
