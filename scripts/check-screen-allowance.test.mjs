import { describe, expect, it } from 'vitest';
import { namedRises, raisedAllowances } from './check-screen-allowance.mjs';

const entry = (breaches) => ({ breaches, slice: '#2445' });

/** The screen-text allowances only go down (#2433): what the gate lets through and what it stops. */
describe('a screen-text allowance that rose', () => {
  const base = { 'src/components/admin/PassCard.tsx': entry(1), 'src/components/admin/SyncHistoryPanel.tsx': entry(4) };

  it('stops a count that rose and a file the base did not list', () => {
    const now = { 'src/components/admin/PassCard.tsx': entry(2), 'src/components/admin/NewCard.tsx': entry(1) };
    expect(raisedAllowances(base, now, 'frontend')).toEqual([
      { path: 'frontend/src/components/admin/PassCard.tsx', before: 1, after: 2 },
      { path: 'frontend/src/components/admin/NewCard.tsx', before: null, after: 1 },
    ]);
  });

  it('lets through a count that held or fell, and a file that left the list', () => {
    expect(raisedAllowances(base, { 'src/components/admin/SyncHistoryPanel.tsx': entry(3) }, 'frontend')).toEqual([]);
  });

  it('lets through a rise a commit body names, with a reason', () => {
    const named = namedRises([
      'front: Read a fragment\'s text.',
      '',
      'Screen-text-allowance: frontend/src/components/admin/PassCard.tsx -- the rule now reads a fragment',
      'Screen-text-allowance: frontend/src/components/admin/NewCard.tsx --',
    ].join('\n'));
    const now = { 'src/components/admin/PassCard.tsx': entry(2), 'src/components/admin/NewCard.tsx': entry(1) };
    expect(raisedAllowances(base, now, 'frontend', named).map(({ path }) => path)).toEqual(['frontend/src/components/admin/NewCard.tsx']);
  });
});
