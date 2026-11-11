/**
 * A run beside a curator's claimed line (#2436): a subject stands on one line.
 */

import { describe, expect, it } from 'vitest';
import { withSubjectsOnOneLine } from './subjectLinesKept.js';

// Big Vishnu (Q12498977): a curator listed Vishnu (Q11380) under Depicts; a run
// reads Vishnu and Garuda (Q188676) as whom it commemorates.
const VISHNU = { item: 'Q11380', label: 'Vishnu', articleUrl: null };
const GARUDA = { item: 'Q188676', label: 'Garuda', articleUrl: null };
const CURATORS_DEPICTS = { via: 'curator', subjects: [VISHNU] };
const stored = { curated_fields: ['metadata.depicts'], metadata: { depicts: CURATORS_DEPICTS } };
const record = (metadata: Record<string, unknown>) => ({ externalId: 'Q12498977', metadata });

describe('a run writing one line beside a curator\'s other', () => {
  it('leaves out of its line whoever the curator\'s claimed line lists', () => {
    const run = record({ commemorates: { via: 'commemorates', subjects: [VISHNU, GARUDA] }, depicts: { via: 'main-subject', subjects: [GARUDA] } });
    expect(withSubjectsOnOneLine(run, stored).metadata).toEqual({
      commemorates: { via: 'commemorates', subjects: [GARUDA] }, depicts: { via: 'main-subject', subjects: [GARUDA] },
    });
  });

  it('writes no line where that leaves it naming nobody', () => {
    const run = record({ commemorates: { via: 'commemorates', subjects: [VISHNU] }, website: 'https://gwkbali.com' });
    expect(withSubjectsOnOneLine(run, stored).metadata).toEqual({ website: 'https://gwkbali.com' });
  });

  it('touches nothing where no line is claimed, or where the run\'s own line is claimed too', () => {
    const run = record({ commemorates: { via: 'commemorates', subjects: [VISHNU] } });
    expect(withSubjectsOnOneLine(run, { curated_fields: [], metadata: { depicts: CURATORS_DEPICTS } })).toBe(run);
    expect(withSubjectsOnOneLine(run, { curated_fields: ['metadata.depicts', 'metadata.commemorates'],
      metadata: { depicts: CURATORS_DEPICTS, commemorates: { via: 'curator', subjects: [] } } })).toBe(run);
    expect(withSubjectsOnOneLine(run, null)).toBe(run);
  });
});
