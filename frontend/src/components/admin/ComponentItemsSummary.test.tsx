/**
 * A World Heritage run's components and their Wikidata items, read in the run's
 * details (#1269): the count, the ambiguous references, the sites left short.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentItemsSummary } from './ComponentItemsSummary';

describe('the components summary of a run', () => {
  it('says how many resolved, which references were ambiguous, and which sites were left short', () => {
    render(<ComponentItemsSummary items={{
      resolved: 3948,
      total: 6354,
      failedSites: 0,
      ambiguous: [{ site: '1187', ref: '1187-023', items: ['Q64462276', 'Q64462277'] }],
      unresolvedSites: [{ site: '1718', name: 'Frontiers of the Roman Empire – Dacia', resolved: 0, total: 277 }],
    }} />);

    expect(screen.getByText('3,948 of 6,354 components resolved to an item of their own.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Q64462277' }).getAttribute('href')).toBe('https://www.wikidata.org/wiki/Q64462277');
    expect(screen.getByText('Frontiers of the Roman Empire – Dacia: 0 of 277')).toBeTruthy();
  });
});
