import { describe, expect, it } from 'vitest';
import { currentRules, whatTheCopyNeeds } from './buildRules.js';

describe('what the copy in place needs to match the code (#1583)', () => {
  const current = { scope: '1:{"depth":3}', write: 1, derive: 1 };

  it('needs nothing when it was built under the same rules', () => {
    expect(whatTheCopyNeeds({ ...current }, current)).toBe('nothing');
  });

  it('needs a re-derive when only the derived tables are made differently', () => {
    expect(whatTheCopyNeeds({ ...current, derive: 0 }, current)).toBe('recompute');
  });

  it('needs a build from the dump when what is kept or how a line is written changed, whatever the derivations', () => {
    expect(whatTheCopyNeeds({ ...current, scope: '1:{"depth":2}' }, current)).toBe('rebuild');
    expect(whatTheCopyNeeds({ ...current, write: 0, derive: 0 }, current)).toBe('rebuild');
  });

  it('takes a copy built before the rules were recorded as current', () => {
    expect(whatTheCopyNeeds(null, current)).toBe('nothing');
  });

  it('records the scope by its version and its rules written whole', () => {
    expect(currentRules().scope).toMatch(/^\d+:\{/);
  });
});

describe('what the admin is asked to do about the copy (#1583)', async () => {
  const { whatTheKeptNeeds } = await import('../keepers.js');
  const built = { dumpDate: '2026-10-05', swappedAt: new Date(), needs: 'nothing' as const };

  it('asks for a build where none is in place, or the code needs one, whatever the host lists', () => {
    expect(whatTheKeptNeeds(null, null)).toBe('rebuild');
    expect(whatTheKeptNeeds({ ...built, needs: 'rebuild' }, '2026-10-19')).toBe('rebuild');
  });

  it('asks for the newer dump the host lists, before a re-derive the new build makes anyway', () => {
    expect(whatTheKeptNeeds(built, '2026-10-19')).toBe('newer-dump');
    expect(whatTheKeptNeeds({ ...built, needs: 'recompute' }, '2026-10-19')).toBe('newer-dump');
  });

  it('asks for a re-derive, or nothing, while the copy is of the newest dump or none is known', () => {
    expect(whatTheKeptNeeds({ ...built, needs: 'recompute' }, '2026-10-05')).toBe('recompute');
    expect(whatTheKeptNeeds(built, null)).toBe('nothing');
  });
});
