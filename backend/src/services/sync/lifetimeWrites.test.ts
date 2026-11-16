import { describe, expect, it } from 'vitest';
import type { SourcedDate } from '../../db/placeDatesWriter.js';
import { decideLifetime, withLifetimeChanges, type HeldDate, type LifetimeGate } from './lifetimeWrites.js';

/**
 * #1719: the gate over a place's dates (ADR-0214 decision 4), on Göbekli Tepe's
 * dates as a run reads them and the cases the gate tells apart.
 */

const date = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, ending: null, property: 'P571', statement: null, ...rest,
});
const held = (d: SourcedDate, sourceId = 5, decidedBy: number | null = null): HeldDate => ({ ...d, sourceId, decidedBy });
const gate = (over: Partial<LifetimeGate> = {}): LifetimeGate =>
  ({ sourceId: 5, gated: true, held: true, claimed: [], pinned: false, ...over });

const BEGAN = date(-9999, { span: 'millennium', circa: true });
const USE_ENDED = date(-7000, { span: 'millennium', property: 'P576' });
const ENDED = date(2024, { month: 1, property: 'P576', ending: 'destroyed' });

describe('the gate over a place\'s dates (#1719)', () => {
  it('writes a date filled where the place held none, under any source, filed as passed', () => {
    const decision = decideLifetime({}, { began: BEGAN, use_ended: USE_ENDED }, gate());
    expect(decision.write).toEqual({ began: BEGAN, use_ended: USE_ENDED });
    expect(decision.changes.map((c) => [c.field, c.passedTheGate, c.old])).toEqual([
      ['began', 'first-date', null], ['use_ended', 'first-date', null],
    ]);
    expect(decision.heldBack).toEqual([]);
  });

  it('holds a change to a date a reader sees under a gated source, and writes it elsewhere', () => {
    const stored = { began: held(BEGAN) };
    const view = { began: date(-9600, { span: 'century' }) };
    expect(decideLifetime(stored, view, gate())).toMatchObject({ write: {}, heldBack: ['began'], changes: [] });
    const trusted = decideLifetime(stored, view, gate({ gated: false, held: false }));
    expect(trusted.write).toEqual(view);
    expect(trusted.changes.map((c) => [c.field, c.passedTheGate])).toEqual([['began', undefined]]);
    expect(decideLifetime(stored, view, gate({ held: false })).write).toEqual(view);
  });

  it('holds every end a reader would lose the place to under a gated source, and writes one under a trusted source', () => {
    expect(decideLifetime({}, { ended: ENDED }, gate()).heldBack).toEqual(['ended']);
    expect(decideLifetime({ ended: held(ENDED) }, { ended: { ...ENDED, year: 1967 } }, gate()).heldBack).toEqual(['ended']);
    expect(decideLifetime({}, { ended: ENDED }, gate({ gated: false })).write).toEqual({ ended: ENDED });
  });

  it('writes an end on a place no reader sees under a gated source: it takes nothing off any list', () => {
    const decision = decideLifetime({}, { ended: ENDED }, gate({ held: false }));
    expect(decision.write).toEqual({ ended: ENDED });
    expect(decision.heldBack).toEqual([]);
  });

  it('writes no end of a place a curator\'s pin keeps', () => {
    expect(decideLifetime({}, { began: BEGAN, ended: ENDED }, gate({ gated: false, held: false, pinned: true })).write)
      .toEqual({ began: BEGAN });
  });

  it('leaves a date a curator claimed, set, or another source wrote', () => {
    const view = { began: date(-9600) };
    expect(decideLifetime({}, view, gate({ claimed: ['began'] })).write).toEqual({});
    expect(decideLifetime({ began: held(BEGAN, 11, 7) }, view, gate({ gated: false })).write).toEqual({});
    expect(decideLifetime({ began: held(BEGAN, 1) }, view, gate({ gated: false })).write).toEqual({});
  });

  it('takes off a date the source wrote and no longer reports, through the same gate', () => {
    const stored = { use_ended: held(USE_ENDED) };
    expect(decideLifetime(stored, {}, gate({ held: false }))).toMatchObject({ clear: ['use_ended'], heldBack: [] });
    expect(decideLifetime(stored, {}, gate())).toMatchObject({ clear: [], heldBack: ['use_ended'] });
  });

  it('writes an end whose date stands and whose telling of how the place ended changed', () => {
    const stored = { ended: held({ ...ENDED, ending: null }) };
    const trusted = decideLifetime(stored, { ended: ENDED }, gate({ gated: false, held: false }));
    expect(trusted.write).toEqual({ ended: ENDED });
    expect(trusted.changes.map((c) => [c.field, c.passedTheGate])).toEqual([['ended', undefined]]);
    expect(decideLifetime(stored, { ended: ENDED }, gate()).heldBack).toEqual(['ended']);
  });

  it('writes nothing for a date the place holds as the source reports it', () => {
    expect(decideLifetime({ began: held(BEGAN) }, { began: BEGAN }, gate({ gated: false }))).toEqual({
      write: {}, clear: [], changes: [], heldBack: [],
    });
  });

  it('counts an object whose only write is a date as updated', () => {
    const unchanged = { changeType: 'unchanged' as const, changedFields: [], significance: null, curatedConflicts: [], heldFields: [] };
    const decision = decideLifetime({}, { began: BEGAN }, gate());
    expect(withLifetimeChanges(unchanged, decision)).toMatchObject({ changeType: 'updated', significance: 'minor' });
    expect(withLifetimeChanges({ ...unchanged, changeType: 'created' }, decision).changeType).toBe('created');
  });
});
