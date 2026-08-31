/**
 * What a curator's correction to a work may say.
 *
 * The body is the one place a maker list arrives from outside the importer, and
 * the importer's own guarantees have to hold on it too: it dedupes by entity and
 * by folded label, so a stored list never names one person twice, and an edit
 * that could would put "Edward Savage and Edward Savage" on a card (#720).
 *
 * The bounds are here rather than in the controller because `validate()` is what
 * the route runs, and a value that reaches the controller has already passed.
 */

import { describe, it, expect } from 'vitest';
import { editWorkBodySchema } from './index.js';

const parse = (body: unknown) => editWorkBodySchema.safeParse(body);

describe('editWorkBodySchema', () => {
  it('takes the makers a curator gives, in their order', () => {
    const out = parse({ artists: ['Ivan Shishkin', 'Konstantin Savitsky'] });
    expect(out.success).toBe(true);
    expect(out.success && out.data.artists).toEqual(['Ivan Shishkin', 'Konstantin Savitsky']);
  });

  it('takes an empty list, which is a curator saying nobody is known', () => {
    // *Salvator Mundi* reading "Leonardeschi" tells a traveller less than no name
    // at all, so this has to be sayable and distinct from leaving the field alone.
    const out = parse({ artists: [] });
    expect(out.success).toBe(true);
    expect(out.success && out.data.artists).toEqual([]);
  });

  it('refuses the same maker twice, however it is typed', () => {
    expect(parse({ artists: ['Edward Savage', 'Edward Savage'] }).success).toBe(false);
    // Folded, because that is the question the importer asks of the source.
    expect(parse({ artists: ['Antonio del Pollaiuolo', 'antonio  DEL Pollaiuolo'] }).success)
      .toBe(false);
  });

  it('refuses a request that changes nothing', () => {
    expect(parse({}).success).toBe(false);
  });

  it('refuses a maker name that is empty, or wider than the column', () => {
    expect(parse({ artists: ['   '] }).success).toBe(false);
    expect(parse({ artists: ['x'.repeat(501)] }).success).toBe(false);
  });

  it('refuses more makers than any work has ever named', () => {
    // Twenty is a bound rather than a judgement: the most any stored work names
    // is six, and the most any monument names is seven.
    expect(parse({ artists: Array.from({ length: 21 }, (_, i) => `Maker ${i}`) }).success)
      .toBe(false);
  });

  it('takes a year back, since a date withdrawn is an answer', () => {
    expect(parse({ year: null }).success).toBe(true);
    expect(parse({ year: 1503 }).success).toBe(true);
  });
});
