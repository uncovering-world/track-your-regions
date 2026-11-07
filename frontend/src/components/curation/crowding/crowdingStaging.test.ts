/**
 * The crowded-city window's answers before Apply (#2282), on Berlin's squares
 * around Schloßplatz: what each row may take, what a press stages, how a row
 * is drawn with it, what the footer counts and what the report says.
 */

import { describe, it, expect } from 'vitest';
import {
  answerRows, answersOffered, chosenAnswer, drawnStanding, outcomeLines, ruleLineAt, stageAnswer, stagingSummary,
  type Staging,
} from './crowdingStaging';
import { pinChip, standingChip } from './rowWords';
import {
  berlinSquares, FRANKFURTER_TOR, KULTURFORUM, LEIPZIGER_PLATZ, NOLLENDORFPLATZ, SCHLOSSPLATZ,
  squareRow,
} from './crowdingFixtures';

const row = (id: number) => berlinSquares.find(r => r.membershipId === id)!;
const none: Staging = new Map();

describe('which answers a row takes', () => {
  it('offers List, Shadow and Don’t take on a place with no pin, and no Clear', () => {
    expect(answersOffered(row(NOLLENDORFPLATZ))).toEqual({ list: true, shadow: true, publish: false, refuse: true, clear: false });
  });

  it('offers Clear on a pinned place', () => {
    expect(answersOffered(squareRow({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list' })).clear).toBe(true);
  });

  it('takes no pin on a place holding works, which is always shown, but may still be refused', () => {
    expect(answersOffered(row(KULTURFORUM))).toEqual({ list: false, shadow: false, publish: false, refuse: true, clear: false });
  });

  it('takes nothing outside the curator’s scope', () => {
    const outside = squareRow({ membershipId: 31, name: 'Mehringplatz', canAnswer: false, pin: 'shadow' });
    expect(answersOffered(outside)).toEqual({ list: false, shadow: false, publish: false, refuse: false, clear: false });
  });
});

describe('staging an answer', () => {
  it('stages a new arrival kept in the list, and a second press takes it back', () => {
    const staged = stageAnswer(none, row(SCHLOSSPLATZ), 'list');
    expect(staged.get(SCHLOSSPLATZ)).toEqual({ answer: 'list', name: 'Schloßplatz', arriving: true });
    expect(stageAnswer(staged, row(SCHLOSSPLATZ), 'list').size).toBe(0);
  });

  it('replaces one answer with another on the same row', () => {
    const staged = stageAnswer(stageAnswer(none, row(FRANKFURTER_TOR), 'list'), row(FRANKFURTER_TOR), 'refuse');
    expect(staged.get(FRANKFURTER_TOR)?.answer).toBe('refuse');
  });

  it('stages nothing for what a place already holds: its own pin, or Clear without one', () => {
    const kept = squareRow({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list' });
    expect(stageAnswer(none, kept, 'list').size).toBe(0);
    expect(stageAnswer(none, row(NOLLENDORFPLATZ), 'clear').size).toBe(0);
  });

  it('stages nothing a row does not take', () => {
    expect(stageAnswer(none, row(KULTURFORUM), 'shadow').size).toBe(0);
  });

  it('shows the staged answer pressed, else the pin the place holds', () => {
    const kept = squareRow({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list' });
    expect(chosenAnswer(kept, none)).toBe('list');
    expect(chosenAnswer(kept, stageAnswer(none, kept, 'shadow'))).toBe('shadow');
    expect(chosenAnswer(row(SCHLOSSPLATZ), none)).toBeNull();
  });
});

describe('how a row is drawn', () => {
  it('draws a row where its staged answer puts it', () => {
    expect(drawnStanding(row(SCHLOSSPLATZ), none)).toBe('new');
    expect(drawnStanding(row(SCHLOSSPLATZ), stageAnswer(none, row(SCHLOSSPLATZ), 'list'))).toBe('listed');
    expect(drawnStanding(row(NOLLENDORFPLATZ), stageAnswer(none, row(NOLLENDORFPLATZ), 'shadow'))).toBe('shadowed');
    expect(drawnStanding(row(LEIPZIGER_PLATZ), stageAnswer(none, row(LEIPZIGER_PLATZ), 'refuse'))).toBe('refused');
  });

  it('draws a pin handed back where the rule would put the place', () => {
    const keptListed = squareRow({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list', ruleCrowded: true });
    expect(drawnStanding(keptListed, stageAnswer(none, keptListed, 'clear'))).toBe('shadowed');
  });

  it('marks where the rule’s ten end: before Frankfurter Tor, the first the rule shadows', () => {
    expect(ruleLineAt(berlinSquares)).toBe(10);
    expect(berlinSquares[10].name).toBe('Frankfurter Tor');
    expect(ruleLineAt(berlinSquares.slice(0, 10))).toBe(-1);
  });

  it('names a new arrival’s standing with where the rule would put it, and a pin with the rule beside it', () => {
    expect(standingChip(row(SCHLOSSPLATZ))).toBe('new · the rule shadows it');
    expect(standingChip(row(NOLLENDORFPLATZ))).toBe('in the list');
    expect(pinChip(squareRow({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list', ruleCrowded: true })))
      .toBe('kept in the list · the rule would shadow it');
    expect(pinChip(squareRow({ membershipId: 32, name: 'Nollendorfplatz', pin: 'shadow' })))
      .toBe('kept in the shadow · the rule would list it');
    expect(pinChip(row(NOLLENDORFPLATZ))).toBeNull();
  });
});

describe('the footer and the body', () => {
  it('counts the new arrivals answered and the changes to places already in', () => {
    let staged = stageAnswer(none, row(SCHLOSSPLATZ), 'list');
    staged = stageAnswer(staged, row(NOLLENDORFPLATZ), 'shadow');
    expect(stagingSummary(berlinSquares, staged)).toEqual({ arrivals: 2, arrivalsAnswered: 1, admittedChanged: 1, staged: 2 });
    expect(answerRows(staged)).toEqual([
      { membershipId: SCHLOSSPLATZ, answer: 'list' },
      { membershipId: NOLLENDORFPLATZ, answer: 'shadow' },
    ]);
  });
});

describe('the report of an Apply', () => {
  it('names what each answer did, what the server refused and why, and what was out of scope', () => {
    const lines = outcomeLines({
      answered: [
        { membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false },
        { membershipId: NOLLENDORFPLATZ, experienceId: 1009, name: 'Nollendorfplatz', answer: 'shadow', pin: 'shadow', published: false, refused: false },
      ],
      refused: [{
        membershipId: KULTURFORUM, experienceId: 1015, name: 'Kulturforum', status: 409,
        error: 'This place holds a work a reader is shown, so it is always shown and takes no pin (ADR-0173)',
      }],
      outOfScope: 1,
      placementFailed: [],
    });
    expect(lines).toEqual([
      '1 place kept in the list (1 new, published): Schloßplatz.',
      '1 place kept in the shadow: Nollendorfplatz.',
      'Kulturforum refused — This place holds a work a reader is shown, so it is always shown and takes no pin (ADR-0173).',
      '1 object outside your scope, left alone.',
    ]);
  });
});
