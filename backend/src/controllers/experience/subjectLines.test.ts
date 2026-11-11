/**
 * Publishing a run's line beside a curator's (#2421): a subject stands on one
 * line, and the line the publication leaves is the place's.
 */

import { describe, expect, it } from 'vitest';
import { keepSubjectsOnOneLine } from './subjectLines.js';

// Big Vishnu (Q12498977): a curator listed Vishnu (Q11380) under Depicts; a
// later run reads Vishnu and Garuda (Q188676) as whom it commemorates.
const VISHNU = { item: 'Q11380', label: 'Vishnu', articleUrl: null };
const GARUDA = { item: 'Q188676', label: 'Garuda', articleUrl: null };
const CURATORS_DEPICTS = { via: 'curator', subjects: [VISHNU] };

describe('a published line beside the other line', () => {
  it('leaves out of the run\'s Commemorates whom the curator listed under Depicts', () => {
    const metadata = { depicts: CURATORS_DEPICTS, commemorates: { via: 'commemorates', subjects: [VISHNU, GARUDA] } };
    expect(keepSubjectsOnOneLine(metadata, ['metadata.commemorates'])).toEqual({
      depicts: CURATORS_DEPICTS, commemorates: { via: 'commemorates', subjects: [GARUDA] },
    });
  });

  it('drops a published line left naming nobody', () => {
    const metadata = { depicts: CURATORS_DEPICTS, commemorates: { via: 'commemorates', subjects: [VISHNU] }, website: 'https://gwkbali.com' };
    expect(keepSubjectsOnOneLine(metadata, ['metadata.commemorates'])).toEqual({ depicts: CURATORS_DEPICTS, website: 'https://gwkbali.com' });
  });

  it('changes nothing where no subject stands on both, or where both lines are published together', () => {
    const apart = { depicts: CURATORS_DEPICTS, commemorates: { via: 'commemorates', subjects: [GARUDA] } };
    expect(keepSubjectsOnOneLine(apart, ['metadata.commemorates'])).toBe(apart);
    const both = { depicts: { via: 'depicts', subjects: [VISHNU] }, commemorates: { via: 'commemorates', subjects: [VISHNU] } };
    expect(keepSubjectsOnOneLine(both, ['metadata.commemorates', 'metadata.depicts'])).toBe(both);
  });
});
