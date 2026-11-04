/**
 * The crowded-city window's answers before Apply (#2282, #2358), on Berlin's
 * squares as Berlin's page holds them: which answers a place takes by where it
 * stands, what a press stages, how a place is drawn with it, what the Apply
 * bar says, what a hover and a place's card say, and what the report says.
 */

import { describe, it, expect } from 'vitest';
import {
  answerRows, answersOffered, applySummary, chosenAnswer, drawnStanding, listPart, outcomeLines, shownAfter,
  stageAnswer, type Answerable, type Staging,
} from './crowdingStaging';
import { groupTitle, placeNote, ruleReading, whyWords, type RuleWords } from './rowWords';
import {
  berlinSquares, FRANKFURTER_TOR, KULTURFORUM, LEIPZIGER_PLATZ, NOLLENDORFPLATZ, ROSA_LUXEMBURG_PLATZ, SCHLOSSPLATZ,
  squarePlace,
} from './crowdingFixtures';

const place = (id: number) => berlinSquares.find(p => p.membershipId === id)!;
const none: Staging = new Map();
const labels = (p: Answerable) => answersOffered(p).map(offer => offer.label);
const SQUARES: RuleWords = { kindId: 9, kindName: 'Squares & streets', type: 'square', limit: 10, radiusKm: 10 };

describe('which answers a place takes, by where it stands', () => {
  it('offers Shadow on a place the region page shows', () => {
    expect(labels(place(NOLLENDORFPLATZ))).toEqual(['Shadow']);
  });

  it('offers Show anyway and Keep shadowed on a shadowed place', () => {
    expect(labels(place(LEIPZIGER_PLATZ))).toEqual(['Show anyway', 'Keep shadowed']);
  });

  it('offers Publish, Shadow and Don’t take on a new place the rule would show', () => {
    expect(answersOffered(place(ROSA_LUXEMBURG_PLATZ))).toEqual([
      { answer: 'publish', label: 'Publish' }, { answer: 'shadow', label: 'Shadow' }, { answer: 'refuse', label: 'Don’t take' },
    ]);
  });

  it('offers Show anyway, Keep shadowed and Don’t take on a new place the rule would shadow', () => {
    expect(answersOffered(place(SCHLOSSPLATZ)).map(offer => offer.answer)).toEqual(['list', 'shadow', 'refuse']);
  });

  it('hands a pin back to the rule only where one is held', () => {
    expect(labels(squarePlace({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list' }))).toEqual(['Shadow', 'Back to the rule']);
  });

  it('takes no pin on a place holding works, which is always shown, and nothing outside the curator’s scope', () => {
    expect(answersOffered(place(KULTURFORUM))).toEqual([]);
    expect(answersOffered(squarePlace({ membershipId: 31, name: 'Mehringplatz', canAnswer: false, pin: 'shadow' }))).toEqual([]);
  });
});

describe('staging an answer', () => {
  it('stages a new arrival shown anyway, and a second press takes it back', () => {
    const staged = stageAnswer(none, place(SCHLOSSPLATZ), 'list');
    expect(staged.get(SCHLOSSPLATZ)).toEqual({ answer: 'list', name: 'Schloßplatz', standing: 'new', crowded: true });
    expect(stageAnswer(staged, place(SCHLOSSPLATZ), 'list').size).toBe(0);
  });

  it('replaces one answer with another on the same place', () => {
    const staged = stageAnswer(stageAnswer(none, place(FRANKFURTER_TOR), 'list'), place(FRANKFURTER_TOR), 'refuse');
    expect(staged.get(FRANKFURTER_TOR)?.answer).toBe('refuse');
  });

  it('stages nothing for what a place already holds, nor an answer its standing does not take', () => {
    const kept = squarePlace({ membershipId: 30, name: 'Kottbusser Tor', pin: 'shadow', standing: 'shadowed', crowded: true });
    expect(stageAnswer(none, kept, 'shadow').size).toBe(0);
    expect(stageAnswer(none, place(NOLLENDORFPLATZ), 'list').size).toBe(0);
    expect(stageAnswer(none, place(KULTURFORUM), 'shadow').size).toBe(0);
  });

  it('shows the staged answer pressed, else the pin the place holds', () => {
    const kept = squarePlace({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list' });
    expect(chosenAnswer(kept, none)).toBe('list');
    expect(chosenAnswer(kept, stageAnswer(none, kept, 'shadow'))).toBe('shadow');
    expect(chosenAnswer(place(SCHLOSSPLATZ), none)).toBeNull();
  });
});

describe('how a place is drawn and listed', () => {
  it('draws a place where its staged answer puts it', () => {
    expect(drawnStanding(place(SCHLOSSPLATZ), none)).toBe('new');
    expect(drawnStanding(place(SCHLOSSPLATZ), stageAnswer(none, place(SCHLOSSPLATZ), 'list'))).toBe('shown');
    expect(drawnStanding(place(NOLLENDORFPLATZ), stageAnswer(none, place(NOLLENDORFPLATZ), 'shadow'))).toBe('shadowed');
    expect(drawnStanding(place(SCHLOSSPLATZ), stageAnswer(none, place(SCHLOSSPLATZ), 'refuse'))).toBe('refused');
    // Published and left to the rule, a new place stands where the rule puts it.
    expect(drawnStanding(place(ROSA_LUXEMBURG_PLATZ), stageAnswer(none, place(ROSA_LUXEMBURG_PLATZ), 'publish'))).toBe('shown');
  });

  it('draws a pin handed back where the rule would put the place', () => {
    const kept = squarePlace({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list', ruleCrowded: true });
    expect(drawnStanding(kept, stageAnswer(none, kept, 'clear'))).toBe('shadowed');
  });

  it('lists a new place where the rule would put it: Rosa-Luxemburg-Platz on the page, Schloßplatz in the tail', () => {
    expect(listPart(place(ROSA_LUXEMBURG_PLATZ))).toBe('page');
    expect(listPart(place(SCHLOSSPLATZ))).toBe('tail');
    expect(listPart(place(LEIPZIGER_PLATZ))).toBe('tail');
    expect(listPart(place(NOLLENDORFPLATZ))).toBe('page');
  });
});

describe('the Apply bar', () => {
  it('names what the staged answers do and how many squares the region page will show', () => {
    expect(shownAfter(berlinSquares, none)).toBe(11);
    let staged = stageAnswer(none, place(SCHLOSSPLATZ), 'list');
    staged = stageAnswer(staged, place(ROSA_LUXEMBURG_PLATZ), 'publish');
    staged = stageAnswer(staged, place(NOLLENDORFPLATZ), 'shadow');
    expect(applySummary(staged, berlinSquares, SQUARES)).toBe(
      '3 answers staged: show Schloßplatz anyway, publish Rosa-Luxemburg-Platz, shadow Nollendorfplatz. '
        + 'The region page will show 12 squares, before the rule recounts their neighbours.',
    );
    expect(answerRows(staged)).toEqual([
      { membershipId: SCHLOSSPLATZ, answer: 'list' },
      { membershipId: ROSA_LUXEMBURG_PLATZ, answer: 'publish' },
      { membershipId: NOLLENDORFPLATZ, answer: 'shadow' },
    ]);
  });
});

describe('what a hover and a card say', () => {
  it('names the group by its region, kind and type', () => {
    expect(groupTitle('Berlin', SQUARES)).toBe('Berlin · Squares & streets · square');
  });

  it('says why a shadowed place is shadowed, naming the best known above it', () => {
    expect(whyWords(place(LEIPZIGER_PLATZ), SQUARES, false)).toBe(
      'Shadowed: 11 better-known squares stand within 10 km of it: Alexanderplatz, Potsdamer Platz, Gendarmenmarkt, …',
    );
    expect(whyWords(place(SCHLOSSPLATZ), SQUARES, false)).toBe(
      'New, waiting for a curator; the rule would shadow it: 13 better-known squares stand within 10 km of it: '
        + 'Alexanderplatz, Potsdamer Platz, Gendarmenmarkt, …',
    );
  });

  it('says why a shown place is shown, and a pin before the rule’s own reading', () => {
    expect(whyWords(place(NOLLENDORFPLATZ), SQUARES, false))
      .toBe('On the region page: fewer than 10 better-known squares stand within 10 km of it.');
    expect(whyWords(place(KULTURFORUM), SQUARES, false)).toBe('Always shown: it holds works a reader is shown.');
    const kept = squarePlace({ membershipId: 30, name: 'Kottbusser Tor', pin: 'list', ruleCrowded: true, outrankedBy: 14 });
    expect(whyWords(kept, SQUARES, false))
      .toBe('Kept on the region page by a curator; the rule would shadow it, as 14 better-known squares stand within 10 km of it.');
  });

  it('reads the rule on a place’s card with its exact count', () => {
    expect(ruleReading(place(SCHLOSSPLATZ), SQUARES, false)).toBe(
      'The rule shadows it: 13 better-known squares stand within 10 km of it. '
        + 'Once published it would sit in the region page’s shadowed tail.',
    );
    expect(ruleReading(squarePlace({ membershipId: 1, name: 'Alexanderplatz', outrankedBy: 0 }), SQUARES, false))
      .toBe('The rule shows it: no better-known squares stand within 10 km of it, fewer than 10.');
  });

  it('notes the best known and the count under a name', () => {
    expect(placeNote(berlinSquares[0], SQUARES, true)).toBe('the best known here');
    expect(placeNote(place(LEIPZIGER_PLATZ), SQUARES, false)).toBe('11 better known within 10 km');
    expect(placeNote(place(ROSA_LUXEMBURG_PLATZ), SQUARES, false)).toBe('the rule would show it');
  });
});

describe('the report of an Apply', () => {
  it('names what each answer did, what the server refused and why, and what was out of scope', () => {
    const lines = outcomeLines({
      answered: [
        { membershipId: SCHLOSSPLATZ, experienceId: 1014, name: 'Schloßplatz', answer: 'list', pin: 'list', published: true, refused: false },
        { membershipId: ROSA_LUXEMBURG_PLATZ, experienceId: 1013, name: 'Rosa-Luxemburg-Platz', answer: 'publish', pin: null, published: true, refused: false },
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
      '1 place shown anyway (1 new, published): Schloßplatz.',
      '1 place kept in the shadow: Nollendorfplatz.',
      '1 place published and left to the rule: Rosa-Luxemburg-Platz.',
      'Kulturforum refused — This place holds a work a reader is shown, so it is always shown and takes no pin (ADR-0173).',
      '1 object outside your scope, left alone.',
    ]);
  });
});
