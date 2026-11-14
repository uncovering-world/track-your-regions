/**
 * How a curator's edit answers a held line of subjects (#2293, #2485): by the
 * items it names and the form each is shown in, never by a reading that leaves
 * the curator's role out.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { sameAsProposed } from './heldSettledByEdit.js';

// The Lady Godiva equestrian statue (Q17540305) depicts Lady Godiva (Q106077),
// whom its statement names as an equestrian (Q2730732).
const GODIVA = { item: 'Q106077', label: 'Lady Godiva', articleUrl: 'https://en.wikipedia.org/wiki/Lady_Godiva' };

describe('a held line of subjects answered by an edit', () => {
  it("refuses the run's reading without the role the curator gave a figure", () => {
    const stored = { via: 'curator', subjects: [{ ...GODIVA, role: 'equestrian' }] };
    expect(sameAsProposed('metadata.depicts', { via: 'depicts', subjects: [GODIVA] }, stored)).toBe(false);
    expect(sameAsProposed('metadata.commemorates', { via: 'depicts', subjects: [GODIVA] }, stored)).toBe(false);
  });

  it('publishes a reading that names the same figure in the same role', () => {
    const stored = { via: 'curator', subjects: [{ ...GODIVA, role: 'equestrian' }] };
    expect(sameAsProposed('metadata.depicts', { via: 'depicts', subjects: [{ ...GODIVA, role: 'equestrian' }] }, stored)).toBe(true);
    // A line with no role on either side is answered as it always was.
    expect(sameAsProposed('metadata.depicts', { via: 'depicts', subjects: [GODIVA] }, { via: 'curator', subjects: [GODIVA] })).toBe(true);
  });
});
