import { describe, it, expect } from 'vitest';
import { computeLevelProgress } from './wvPocLevels';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';

function unit(over: Partial<DashboardUnit>): DashboardUnit {
  return {
    regionId: 1, name: 'X', continent: 'Europe', ancestorPath: ['Europe'],
    signoffStatus: 'not_started', signedOffAt: null, hierarchyConfirmed: false,
    hasReference: true, referenceDivisionIds: [1], sourceUrl: null,
    leafTotal: 0, leafResolved: 0, warningCount: 0,
    ...over,
  };
}

describe('computeLevelProgress', () => {
  it('reports empty levels for no units', () => {
    const p = computeLevelProgress([]);
    expect(p.l1.status).toBe('empty');
    expect(p.l2.status).toBe('empty');
    expect(p.l3.status).toBe('empty');
  });

  it('counts countries and signed-off at L2', () => {
    const p = computeLevelProgress([
      unit({ regionId: 1, signoffStatus: 'signed_off' }),
      unit({ regionId: 2, signoffStatus: 'in_progress' }),
    ]);
    expect(p.l2.total).toBe(2);
    expect(p.l2.signedOff).toBe(1);
    expect(p.l2.status).toBe('in_progress');
  });

  it('marks L2 done when all signed off', () => {
    const p = computeLevelProgress([unit({ signoffStatus: 'signed_off' })]);
    expect(p.l2.status).toBe('done');
  });

  it('counts distinct continents at L1 and is done when all grouped', () => {
    const p = computeLevelProgress([
      unit({ regionId: 1, continent: 'Europe' }),
      unit({ regionId: 2, continent: 'Asia' }),
    ]);
    expect(p.l1.continents).toBe(2);
    expect(p.l1.countries).toBe(2);
    expect(p.l1.status).toBe('done');
  });

  it('marks L1 in_progress when a country has no continent', () => {
    const p = computeLevelProgress([unit({ continent: null, ancestorPath: [] })]);
    expect(p.l1.status).toBe('in_progress');
  });

  it('aggregates leaf resolution at L3', () => {
    const p = computeLevelProgress([
      unit({ leafTotal: 4, leafResolved: 4 }),
      unit({ leafTotal: 6, leafResolved: 3 }),
    ]);
    expect(p.l3.leafTotal).toBe(10);
    expect(p.l3.leafResolved).toBe(7);
    expect(p.l3.status).toBe('in_progress');
  });
});
