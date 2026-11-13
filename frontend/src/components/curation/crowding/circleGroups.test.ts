/**
 * A place's circle as one list by fame (#2486), on Berlin's squares: the
 * order, the open place at its own rank, the note each row carries where its
 * rank does not say what the rule does with it, and the order two circles
 * share, which never depends on the place open.
 */

import { describe, it, expect } from 'vitest';
import type { CrowdingPlaceView } from '../../../api/crowding';
import { byFame, circleRows, rowNote, type CircleRow } from './circleGroups';
import {
  ALEXANDERPLATZ, berlinCircle, FRANKFURTER_TOR, GENDARMENMARKT, HACKESCHER_MARKT, KULTURFORUM, NOLLENDORFPLATZ, POTSDAMER_PLATZ,
  SCHLOSSPLATZ,
} from './crowdingFixtures';

const idOf = (row: CircleRow) => (row.own ? row.place.membershipId : row.entry.membershipId);
const nameOf = (row: CircleRow) => (row.own ? row.place.name : row.entry.name);
const ids = (view: CrowdingPlaceView) => circleRows(view).map(idOf);

/** A circle with one of its neighbours changed. */
function withNeighbour(view: CrowdingPlaceView, membershipId: number, over: Partial<CrowdingPlaceView['around'][number]>): CrowdingPlaceView {
  return { ...view, around: view.around.map(entry => (entry.membershipId === membershipId ? { ...entry, ...over } : entry)) };
}

/** The note on a neighbour's row in a circle. */
function noteOf(view: CrowdingPlaceView, membershipId: number): string | null {
  return rowNote(view.around.find(entry => entry.membershipId === membershipId)!, view);
}

describe('the order of a circle (#2486)', () => {
  it('lists the best known first, a tie by its id, and the places not measured yet last, by id', () => {
    const rows = [
      { membershipId: 7, score: 0.5 },
      { membershipId: 30, score: null },
      { membershipId: 4, score: 0.9 },
      { membershipId: 9, score: 0.5 },
      { membershipId: 2, score: null },
      { membershipId: 6, score: 0.5 },
    ];
    expect([...rows].sort(byFame).map(row => row.membershipId)).toEqual([4, 6, 7, 9, 2, 30]);
  });

  it('is a pure function of fame: the order the neighbours arrive in changes nothing', () => {
    const circle = berlinCircle(SCHLOSSPLATZ);
    const reversed = { ...circle, around: [...circle.around].reverse() };
    expect(ids(reversed)).toEqual(ids(circle));
  });

  it('sets the open place at its own rank, not at the top: Schloßplatz 14th among Berlin’s squares', () => {
    const rows = circleRows(berlinCircle(SCHLOSSPLATZ));
    expect(rows.map(nameOf)).toEqual([
      'Alexanderplatz', 'Potsdamer Platz', 'Gendarmenmarkt', 'Pariser Platz', 'Bebelplatz', 'Lustgarten', 'Breitscheidplatz',
      'Platz der Republik', 'Nollendorfplatz', 'Hackescher Markt', 'Frankfurter Tor', 'Leipziger Platz', 'Rosa-Luxemburg-Platz',
      'Schloßplatz', 'Kulturforum',
    ]);
    const own = rows.filter(row => row.own);
    expect(own).toHaveLength(1);
    expect(own[0].rank).toBe(14);
    expect(rows.map(row => row.rank)).toEqual(rows.map((_, index) => index + 1));
  });

  it('gives no rank to a place not measured yet, the open place included', () => {
    const circle = berlinCircle(GENDARMENMARKT);
    const view = withNeighbour({ ...circle, place: { ...circle.place, score: null } }, KULTURFORUM, { score: null });
    const rows = circleRows(view);
    expect(rows.slice(-2).map(nameOf)).toEqual(['Gendarmenmarkt', 'Kulturforum']);
    expect(rows.slice(-2).map(row => row.rank)).toEqual([null, null]);
    expect(rows[0].rank).toBe(1);
  });
});

describe('opening a neighbour keeps the table where it is (#2486)', () => {
  it('lists Alexanderplatz, Gendarmenmarkt and Potsdamer Platz in one order, only the open place moving', () => {
    // On dev on 2026-11-12 the three circles held the same squares, themselves included.
    const orders = [ALEXANDERPLATZ, GENDARMENMARKT, POTSDAMER_PLATZ].map(id => ids(berlinCircle(id)));
    expect(orders[1]).toEqual(orders[0]);
    expect(orders[2]).toEqual(orders[0]);
    const marked = [ALEXANDERPLATZ, GENDARMENMARKT, POTSDAMER_PLATZ]
      .map(id => circleRows(berlinCircle(id)).findIndex(row => row.own));
    expect(marked).toEqual([0, 2, 1]);
  });

  it('keeps the rows two circles share in the same order where a row at the edge of one is outside the other', () => {
    // Frankfurter Tor at the edge of Gendarmenmarkt's radius: in Alexanderplatz's circle and not in its.
    const alexanderplatz = ids(berlinCircle(ALEXANDERPLATZ));
    const gendarmenmarkt = ids(berlinCircle(GENDARMENMARKT, [FRANKFURTER_TOR]));
    const shared = (order: number[], other: number[]) => order.filter(id => other.includes(id));
    expect(shared(alexanderplatz, gendarmenmarkt)).toEqual(shared(gendarmenmarkt, alexanderplatz));
    expect(alexanderplatz.filter(id => id !== FRANKFURTER_TOR)).toEqual(gendarmenmarkt);
  });
});

describe('what each row says the rule does with it (#2420, #2486)', () => {
  const schlossplatz = berlinCircle(SCHLOSSPLATZ);

  it('says nothing where the rank says it: a better-known square it is compared with, and a less-known one', () => {
    expect(noteOf(schlossplatz, ALEXANDERPLATZ)).toBeNull();
    expect(noteOf(schlossplatz, KULTURFORUM)).toBeNull();
  });

  it('says why a better-known square is not counted against it', () => {
    const shadowed = withNeighbour(schlossplatz, NOLLENDORFPLATZ, { compared: false, pin: 'shadow' });
    expect(noteOf(shadowed, NOLLENDORFPLATZ)).toBe('Not counted against it. A curator keeps it in the shadow.');
    const works = withNeighbour(schlossplatz, NOLLENDORFPLATZ, { compared: false, holdsWorks: true });
    expect(noteOf(works, NOLLENDORFPLATZ)).toBe('Not counted against it. It holds works readers are shown.');
  });

  it('says a less-known square a curator keeps on the list counts against it, from below', () => {
    const kept = withNeighbour(berlinCircle(ALEXANDERPLATZ), HACKESCHER_MARKT, { compared: true, pin: 'list' });
    expect(noteOf(kept, HACKESCHER_MARKT)).toBe('Counted against it. A curator keeps it on the list.');
  });

  it('says a square as well known as the place is not counted, wherever the tie sets it', () => {
    const tie = withNeighbour(schlossplatz, ALEXANDERPLATZ, { score: 0.7, compared: false });
    expect(noteOf(tie, ALEXANDERPLATZ)).toBe('As well known as it, and not counted against it.');
    expect(circleRows(tie).map(nameOf).indexOf('Alexanderplatz')).toBe(circleRows(tie).findIndex(row => row.own) - 1);
  });

  it('says a square is not compared while the place is not measured, never measured, or of an exempt type', () => {
    const unmeasured = { ...schlossplatz, place: { ...schlossplatz.place, score: null } };
    const compared = { ...unmeasured, around: unmeasured.around.map(entry => ({ ...entry, compared: false })) };
    expect(noteOf(compared, ALEXANDERPLATZ)).toBe('Not compared until Schloßplatz is measured.');
    expect(noteOf({ ...compared, measurable: false }, ALEXANDERPLATZ)).toBe('Not compared. Schloßplatz is never measured.');
    const exempt = { ...schlossplatz, typeExempt: true, around: compared.around };
    expect(noteOf(exempt, ALEXANDERPLATZ)).toBe('Not compared. Squares & streets never hides a place of this type.');
  });

  it('says a square not measured yet is not measured, below the place by no fame of its own', () => {
    const view = withNeighbour(schlossplatz, FRANKFURTER_TOR, { score: null, compared: false });
    expect(noteOf(view, FRANKFURTER_TOR)).toBe('Not measured yet.');
    expect(circleRows(view).map(nameOf).at(-1)).toBe('Frankfurter Tor');
  });
});
