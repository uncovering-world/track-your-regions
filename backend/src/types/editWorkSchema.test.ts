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

  it('takes every year the catalogue already holds', () => {
    // The floor is a bound the stored rows had to clear, not a guess about art
    // history: the museum run had written nine works older than the previous
    // −4000, and refusing a curator the value the screen is showing them is the
    // screen broken on nine rows.
    expect(parse({ year: -38000 }).success).toBe(true);   // Lion man, Museum Ulm
    expect(parse({ year: -9500 }).success).toBe(true);    // Shigir Idol
    // Still a typo guard: a year nothing a museum hangs could carry.
    expect(parse({ year: -400000 }).success).toBe(false);
    expect(parse({ year: 2300 }).success).toBe(false);
  });

  it('takes a picture from the hosts a picture may come from, and nowhere else', () => {
    const commons = 'https://commons.wikimedia.org/wiki/Special:FilePath/Visitation.jpg';
    expect(parse({ imageUrl: commons }).success).toBe(true);
    expect(parse({ imageUrl: '/images/works/7.jpg' }).success).toBe(true);
    // The licence rule before the technical one (ADR-0043): a picture the
    // catalogue may not show must not reach the column by way of a curator.
    expect(parse({ imageUrl: 'https://example.com/painting.jpg' }).success).toBe(false);
    expect(parse({ imageUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('reads an empty picture as one being taken off, not as nothing to do', () => {
    const out = parse({ imageUrl: '' });
    expect(out.success).toBe(true);
    // Present and empty: the controller turns this into NULL and drops the
    // credit with it. Absent is what "leave the picture alone" looks like, and
    // a body that is only that changes nothing and is refused.
    expect(out.success && out.data.imageUrl).toBe('');
    expect(parse({}).success).toBe(false);
  });
});
