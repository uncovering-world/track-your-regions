import { describe, expect, it } from 'vitest';
import type { SourcedDate, SourcedPeriod } from '../../db/placePeriodsWriter.js';
import { decideLifetime, withLifetimeChanges, type HeldPeriods, type LifetimeGate } from './lifetimeWrites.js';

/**
 * #2578: the gate over a place's periods (ADR-0217 decision 3), on the
 * Cathedral of Christ the Saviour in Moscow, which stood from 1883 until
 * 5 December 1931 and stands again since 2000, on Nelson's Pillar in Dublin,
 * which stood from 1809 until 8 March 1966, and on Göbekli Tepe's use.
 */

const on = (year: number, rest: Partial<SourcedDate> = {}): SourcedDate => ({
  year, month: null, day: null, span: null, circa: false, property: 'P571', statement: null, ...rest,
});
const open = (from: SourcedDate | null): SourcedPeriod => ({ from, ended: false, until: null, ending: null, what: null });
const until = (from: SourcedDate | null, end: SourcedDate | null, ending: SourcedPeriod['ending'] = null): SourcedPeriod =>
  ({ from, ended: true, until: end, ending, what: null });
const held = (periods: SourcedPeriod[], sourceId = 5, decidedBy: number | null = null): HeldPeriods => ({ periods, sourceId, decidedBy });
const gate = (over: Partial<LifetimeGate> = {}): LifetimeGate =>
  ({ sourceId: 5, gated: true, held: true, claimed: [], pinned: false, ...over });

const BLOWN_UP = on(1931, { month: 12, day: 5, property: 'P576' });
const SINCE_1883 = [open(on(1883))];
const CATHEDRAL = [until(on(1883), BLOWN_UP), open(on(2000))];
const PILLAR = [until(on(1809), on(1966, { month: 3, day: 8, property: 'P576' }), 'destroyed')];
const IN_USE = [until(null, on(-7000, { span: 'millennium', property: 'P576' }))];

describe('the gate over a place\'s periods (#2578)', () => {
  it('writes periods filled where the place held none, under any source, filed as passed', () => {
    const decision = decideLifetime({}, { stood: CATHEDRAL, used: IN_USE }, gate());
    expect(decision.write).toEqual({ stood: CATHEDRAL, used: IN_USE });
    expect(decision.changes.map((c) => [c.field, c.passedTheGate, c.old])).toEqual([
      ['stood', 'first-date', null], ['used', 'first-date', null],
    ]);
    expect(decision.heldBack).toEqual([]);
  });

  it('passes a gap filled into a period the place holds: every date kept, and the place still standing', () => {
    const decision = decideLifetime({ stood: held(SINCE_1883) }, { stood: CATHEDRAL }, gate());
    expect(decision.write).toEqual({ stood: CATHEDRAL });
    expect(decision.changes).toMatchObject([{ field: 'stood', old: SINCE_1883, new: CATHEDRAL, passedTheGate: 'first-date' }]);
  });

  it('passes an end date filled where the place was gone with none, and how it ended where the place did not say', () => {
    const gone = [until(on(1809), null)];
    expect(decideLifetime({ stood: held(gone) }, { stood: PILLAR }, gate()).changes)
      .toMatchObject([{ field: 'stood', passedTheGate: 'first-date' }]);
    const dated = [until(on(1809), on(1966, { month: 3, day: 8 }))];
    expect(decideLifetime({ stood: held(dated) }, { stood: PILLAR }, gate()).write).toEqual({ stood: PILLAR });
  });

  it('passes every gap a run reads where the place held fewer: Ponte Santa Trinita\'s two, the Old Bridge\'s one', () => {
    const trinita = [until(on(1252), on(1557, { property: 'P576' })), until(on(1569, { property: 'P1619' }), on(1944, { property: 'P576' })), open(on(1958, { month: 3, day: 16, property: 'P1619' }))];
    // Held as it began, and held with the one gap an earlier run read.
    for (const stored of [[open(on(1252))], [until(on(1252), on(1944, { property: 'P576' })), trinita[2]]]) {
      const decision = decideLifetime({ stood: held(stored) }, { stood: trinita }, gate());
      expect(decision.write).toEqual({ stood: trinita });
      expect(decision.changes).toMatchObject([{ field: 'stood', old: stored, new: trinita, passedTheGate: 'first-date' }]);
    }
    // A gap told as a destruction fills a period that did not say how it would end.
    const mostar = [until(on(1566), on(1993, { month: 11, day: 9, property: 'P793' }), 'destroyed'), open(on(2004, { month: 7, day: 23, property: 'P793' }))];
    expect(decideLifetime({ stood: held([open(on(1566))]) }, { stood: mostar }, gate()).changes)
      .toMatchObject([{ field: 'stood', passedTheGate: 'first-date' }]);
  });

  it('asks about a list of gaps that takes one away, moves one, or leaves the place gone', () => {
    const trinita = [until(on(1252), on(1557)), until(on(1569), on(1944)), open(on(1958))];
    const stored = { stood: held(trinita) };
    // One gap fewer, though every start it keeps is one the place holds.
    expect(decideLifetime(stored, { stood: [until(on(1252), on(1944)), open(on(1958))] }, gate()).heldBack).toEqual(['stood']);
    // As many periods, with the first gap at another year.
    expect(decideLifetime(stored, { stood: [until(on(1252), on(1333)), until(on(1345), on(1944)), open(on(1958))] }, gate()).heldBack).toEqual(['stood']);
    // A gap more, and the last period closed: the place would leave today's lists.
    const gone = [...trinita.slice(0, 2), until(on(1958), on(2020)), until(on(2021), on(2024))];
    expect(decideLifetime(stored, { stood: gone }, gate()).heldBack).toEqual(['stood']);
    expect(decideLifetime({ stood: held([open(on(1252))]) }, { stood: gone }, gate()).heldBack).toEqual(['stood']);
  });

  it('asks about the end of a use a run no longer reports once the item says the place was rebuilt after it', () => {
    // The Frauenkirche in Dresden: its end of 1945 was read as the end of a use, and is now the end of a standing period.
    const stored = { stood: held([open(on(1726))]), used: held([until(null, on(1945, { month: 2, day: 15, property: 'P576' }))]) };
    const view = { stood: [until(on(1726), on(1945, { month: 2, day: 15, property: 'P576' })), open(on(2005, { month: 10, day: 30, property: 'P793' }))] };
    const decision = decideLifetime(stored, view, gate());
    expect(decision.write).toEqual(view);
    expect(decision.heldBack).toEqual(['used']);
  });

  it('holds a view that moves a date a reader sees, under a gated source, and writes it elsewhere', () => {
    const stored = { stood: held(SINCE_1883) };
    const view = { stood: [open(on(1881))] };
    expect(decideLifetime(stored, view, gate())).toEqual({ write: {}, heldBack: ['stood'], changes: [] });
    const trusted = decideLifetime(stored, view, gate({ gated: false, held: false }));
    expect(trusted.write).toEqual(view);
    expect(trusted.changes.map((c) => [c.field, c.passedTheGate])).toEqual([['stood', undefined]]);
    expect(decideLifetime(stored, view, gate({ held: false })).write).toEqual(view);
  });

  it('holds a view that drops a date the place holds, a period of it, or tells its end another way', () => {
    const stored = { stood: held(CATHEDRAL) };
    // The gap withdrawn: 1931 and 2000 are gone from the view.
    expect(decideLifetime(stored, { stood: SINCE_1883 }, gate()).heldBack).toEqual(['stood']);
    // The start of the second period no longer stated.
    expect(decideLifetime(stored, { stood: [CATHEDRAL[0], open(null)] }, gate()).heldBack).toEqual(['stood']);
    // An end the place holds as a destruction, reported as a removal.
    expect(decideLifetime({ stood: held(PILLAR) }, { stood: [{ ...PILLAR[0], ending: 'removed' }] }, gate()).heldBack).toEqual(['stood']);
    // Gone with no date, and destroyed: a view that dates the end and no longer says how drops "destroyed".
    const destroyed = { stood: held([until(on(1809), null, 'destroyed')]) };
    expect(decideLifetime(destroyed, { stood: [until(on(1809), on(1966, { property: 'P576' }))] }, gate()).heldBack).toEqual(['stood']);
    expect(decideLifetime(destroyed, { stood: PILLAR }, gate()).changes).toMatchObject([{ field: 'stood', passedTheGate: 'first-date' }]);
    // A use the place holds, with no date of its own, no longer reported.
    expect(decideLifetime({ used: held([until(null, null)]) }, {}, gate()).heldBack).toEqual(['used']);
  });

  it('never passes the end of the last standing period as a fill: asked on a place readers see, written with an arrival', () => {
    // A reader sees the pillar: its end takes it off today's lists, whatever the place held.
    expect(decideLifetime({}, { stood: PILLAR }, gate())).toEqual({ write: {}, heldBack: ['stood'], changes: [] });
    expect(decideLifetime({ stood: held([open(on(1809))]) }, { stood: PILLAR }, gate()).heldBack).toEqual(['stood']);
    // Nelson's Pillar arrives already gone: its end is written with it, and is no fill.
    const arrival = decideLifetime({}, { stood: PILLAR }, gate({ held: false }));
    expect(arrival.write).toEqual({ stood: PILLAR });
    expect(arrival.changes.map((c) => [c.field, c.passedTheGate])).toEqual([['stood', undefined]]);
    expect(decideLifetime({}, { stood: PILLAR }, gate({ gated: false })).write).toEqual({ stood: PILLAR });
  });

  it('holds a view that says a gone place stands again', () => {
    const rebuilt = [PILLAR[0], open(on(2026))];
    expect(decideLifetime({ stood: held(PILLAR) }, { stood: rebuilt }, gate()).heldBack).toEqual(['stood']);
  });

  it('reads the last standing period of a place a curator\'s pin keeps as open', () => {
    const pinned = gate({ gated: false, held: false, pinned: true });
    expect(decideLifetime({}, { stood: PILLAR }, pinned).write).toEqual({ stood: [open(on(1809))] });
    // The gap before it stays as the source states it.
    const twice = [until(on(1883), BLOWN_UP), until(on(2000), on(2020, { property: 'P576' }), 'destroyed')];
    expect(decideLifetime({}, { stood: twice }, pinned).write).toEqual({ stood: CATHEDRAL });
    // Gone with nothing else known: no period is left to write.
    expect(decideLifetime({}, { stood: [until(null, null)] }, pinned)).toEqual({ write: {}, heldBack: [], changes: [] });
    // A pin says nothing of a use.
    expect(decideLifetime({}, { used: IN_USE }, pinned).write).toEqual({ used: IN_USE });
  });

  it('leaves periods a curator claimed, set, or another source wrote', () => {
    const view = { stood: [open(on(1881))] };
    expect(decideLifetime({}, view, gate({ claimed: ['stood'] })).write).toEqual({});
    expect(decideLifetime({ stood: held(SINCE_1883, 11, 7) }, view, gate({ gated: false })).write).toEqual({});
    expect(decideLifetime({ stood: held(SINCE_1883, 1) }, view, gate({ gated: false })).write).toEqual({});
    // A claim on the standing periods is no claim on the use.
    expect(decideLifetime({}, { ...view, used: IN_USE }, gate({ claimed: ['stood'] })).write).toEqual({ used: IN_USE });
  });

  it('takes off periods the source wrote and no longer reports, through the same gate', () => {
    const stored = { used: held(IN_USE) };
    const unseen = decideLifetime(stored, {}, gate({ held: false }));
    expect(unseen).toMatchObject({ write: { used: [] }, heldBack: [] });
    expect(unseen.changes).toMatchObject([{ field: 'used', old: IN_USE, new: null }]);
    expect(decideLifetime(stored, {}, gate())).toEqual({ write: {}, heldBack: ['used'], changes: [] });
  });

  it('writes nothing for periods the place holds as the source reports them, wherever each was read', () => {
    const elsewhere = [until(on(1883, { property: 'P1619', statement: 'Q194474$903BF5EC-F2AC-49AD-9037-EFFF5E0E42D8' }), BLOWN_UP), open(on(2000))];
    expect(decideLifetime({ stood: held(CATHEDRAL) }, { stood: elsewhere }, gate({ gated: false }))).toEqual({
      write: {}, changes: [], heldBack: [],
    });
  });

  it('counts an object whose only write is a period as updated', () => {
    const unchanged = { changeType: 'unchanged' as const, changedFields: [], significance: null, curatedConflicts: [], heldFields: [] };
    const decision = decideLifetime({}, { stood: SINCE_1883 }, gate());
    expect(withLifetimeChanges(unchanged, decision)).toMatchObject({ changeType: 'updated', significance: 'minor' });
    expect(withLifetimeChanges({ ...unchanged, changeType: 'created' }, decision).changeType).toBe('created');
  });
});
