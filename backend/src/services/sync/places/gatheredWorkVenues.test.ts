/**
 * Where the pass keeps each famous work lying (#1821): every venue a work at
 * the line names, once per property, and nothing of a work under it, a lost
 * one, or a statement of unknown whereabouts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({ pool: { connect: vi.fn() } }));

import { GATHERED_WORK_FLOOR, gatheredWorkVenues } from './gatheredWorkVenues.js';
import type { GatheredWorks } from '../museum/worksGather.js';
import type { PoolWork, RawStatement } from '../museum/queries.js';

const work = (qid: string, label: string, sitelinks: number): PoolWork => ({
  qid, label, sitelinks, imageUrl: null, creators: [], year: null, type: 'manuscript', typeQid: null,
});
const at = (work: string, venue: string | null, property: 'P195' | 'P276' = 'P195'): RawStatement =>
  ({ work, venue, property, rank: 'normal' });

const gathered = (works: PoolWork[], statements: RawStatement[], lost: string[] = []): GatheredWorks => ({
  closures: new Map(), asked: new Set(), byClass: new Map(),
  pool: new Map(works.map((w) => [w.qid, w])),
  statements: new Map(works.map((w) => [w.qid, statements.filter((s) => s.work === w.qid)])),
  lostPool: new Map(lost.map((qid) => [qid, 'lost manuscript'])),
  lostClasses: new Set(),
});

describe('gatheredWorkVenues', () => {
  it('names every venue of a famous work, once per property', () => {
    const rows = gatheredWorkVenues(gathered(
      [work('Q179492', 'Voynich manuscript', 67)],
      [at('Q179492', 'Q814779'), at('Q179492', 'Q814779'), at('Q179492', 'Q814779', 'P276')],
    ));
    expect(rows).toEqual([
      { workQid: 'Q179492', workLabel: 'Voynich manuscript', sitelinks: 67, venueQid: 'Q814779', property: 'P195' },
      { workQid: 'Q179492', workLabel: 'Voynich manuscript', sitelinks: 67, venueQid: 'Q814779', property: 'P276' },
    ]);
  });

  it('reads each property\'s current values: a preferred one drops a residue normal-rank one', () => {
    const rows = gatheredWorkVenues(gathered(
      [work('Q2', 'Las Meninas', 90)],
      [at('Q2', 'Q160112'), { work: 'Q2', venue: 'Q160112-old', property: 'P195', rank: 'normal' },
        { work: 'Q2', venue: 'Q160112', property: 'P195', rank: 'preferred' }],
    ));
    expect(rows.map((r) => r.venueQid)).toEqual(['Q160112']);
  });

  it('keeps nothing of a work whose current whereabouts are unknown (#868)', () => {
    // The Concert: stolen in 1990, its location an unknown value, the Gardner still named.
    expect(gatheredWorkVenues(gathered(
      [work('Q3', 'The Concert', 40)],
      [at('Q3', 'Q49133', 'P195'), at('Q3', null, 'P276')],
    ))).toEqual([]);
  });

  it('keeps nothing of a work under the line, or of one that no longer exists', () => {
    expect(gatheredWorkVenues(gathered(
      [work('Q1', 'A minor codex', GATHERED_WORK_FLOOR - 1), work('Q41553', 'Colossus of Rhodes', 92)],
      [at('Q1', 'Q2'), at('Q41553', 'Q3')],
      ['Q41553'],
    ))).toEqual([]);
  });
});
