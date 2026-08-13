/**
 * Tests for a refusal in two sizes.
 *
 * A curator reads nineteen of these at a sitting, so the card's line has to say what was
 * found in one breath, and the reasoning — the threshold, where the counts come from, the
 * rule's own wording — belongs behind the question mark.
 *
 * Every reason below is one the live database actually holds. The property that matters
 * most is coverage: a shape nobody explained leaves a card that shows only the machine's
 * sentence, and those are the ones a curator cannot answer.
 */

import { describe, it, expect } from 'vitest';
import { refusalSummary, refusalHelp } from './refusalReason';

/** Every distinct shape on the dev database, verbatim. */
const REAL = {
  noPaintings: 'not an art museum — painting-share: 0 painting(s) vs 5 sculptural work(s)',
  somePaintings: 'not an art museum — painting-share: 2 painting(s) vs 9 sculptural work(s)',
  nothingToJudge: 'not an art museum — no famous holding to judge by',
  church: 'site, not a venue: church building; Catholic cathedral — named by The Elevation of the Cross (24 sitelinks)',
  byHand: 'editorial exclusion: British Museum — typed art museum on Wikidata; out by the strict-art '
    + 'boundary of 2026-08-05, returns with the archaeology import',
  // Every venue-test verdict is recorded through `nameFiltered`, which appends the work
  // that named the place — so this is the shape a stored kill-list refusal really has.
  killList: 'kill-list: curatorial department of the Louvre — named by The Elevation of the Cross (24 sitelinks)',
  // Four of the six kill-list classes explain themselves after a dash of their own, and
  // two killed classes are joined with a semicolon — the shape that gets truncated.
  killListDashed: 'kill-list: art collection — a holding, not a place; museum network — an umbrella, '
    + 'not a visit — named by The Elevation of the Cross (24 sitelinks)',
  dissolved: 'dissolved 1937-06-01 (P576)',
  notMuseum: 'not a museum class',
  noCoords: 'no coordinates of its own (P625)',
};

describe('refusalSummary', () => {
  it('names what the count is of, since "0 of 5" alone asks more than it answers', () => {
    expect(refusalSummary(REAL.noPaintings).text)
      .toBe('None of the 5 famous works listed here is a painting — this reads as sculpture or antiquities.');
  });

  it('says how far off it was when some works are paintings', () => {
    expect(refusalSummary(REAL.somePaintings).text)
      .toBe('Only 2 of the 11 famous works listed here are paintings — the rest is sculpture.');
  });

  it('explains a building that a famous work dragged into the list', () => {
    // The card a curator could make least sense of: the machine said "site, not a venue:
    // church building; Catholic cathedral — named by The Elevation of the Cross".
    const said = refusalSummary(REAL.church).text;
    expect(said).toBe('A church building, not a museum — it reached the list because The Elevation of the Cross is kept there.');
  });

  it('puts every highlighted phrase inside the sentence it belongs to', () => {
    // The card locates the phrase with a case-sensitive `indexOf` and skips the hover when
    // it is not found, so a highlight that reads right but does not match is invisible in
    // any assertion that reads `.text` or `.highlight` alone — and it silently costs the
    // works preview on whichever shape it happens to.
    const shapes = [
      ...Object.values(REAL),
      'not an art museum — painting-share: 0 painting(s) vs 1 sculptural work(s)',
      'not an art museum — painting-share: 1 painting(s) vs 0 sculptural work(s)',
      'not an art museum — painting-share: 1 painting(s) vs 2 sculptural work(s)',
    ];

    for (const reason of shapes) {
      const { text, highlight } = refusalSummary(reason);
      if (highlight) expect(text, reason).toContain(highlight);
    }
  });

  it('bends every count-dependent word, including the commonest one', () => {
    // Twelve of the twenty-two refusals here weigh exactly one work, so "of the 1 famous
    // works" would be the page's most-read sentence rather than an edge case. The single
    // *sculpture* is the whole of that: `artVerdict` admits on `paintings >= sculptures`,
    // so one painting and nothing else is never refused — the second line below is kept
    // because this file reads stored text and cannot assume who wrote it.
    expect(refusalSummary('not an art museum — painting-share: 0 painting(s) vs 1 sculptural work(s)').text)
      .toBe('The one famous work listed here is a sculpture, not a painting.');
    expect(refusalSummary('not an art museum — painting-share: 1 painting(s) vs 0 sculptural work(s)').text)
      .toBe('The one famous work listed here is a painting, and one work is not a collection.');
    expect(refusalSummary('not an art museum — painting-share: 1 painting(s) vs 2 sculptural work(s)').text)
      .toBe('Only 1 of the 3 famous works listed here is a painting — the rest is sculpture.');
  });

  it('separates a phrase that counts works from one that names a single work', () => {
    // The cathedral keeps three famous works and its line names one of them. Hovering that
    // name and getting all three, unlabelled, reads as the card contradicting itself — so
    // the preview is told which one the sentence meant.
    expect(refusalSummary(REAL.church).namedWork).toBe('The Elevation of the Cross');
    expect(refusalSummary(REAL.church).worksTotal).toBeUndefined();

    // A count, on the other hand, is what the preview has to add up to.
    expect(refusalSummary(REAL.somePaintings).worksTotal).toBe(11);
    expect(refusalSummary(REAL.somePaintings).namedWork).toBeUndefined();
    expect(refusalSummary('not an art museum — painting-share: 0 painting(s) vs 1 sculptural work(s)').worksTotal)
      .toBe(1);
  });

  it('marks the phrase the works hang on, and only where there are works', () => {
    // The count raises the doubt, so the count is what answers it — the underline means
    // "there is something to look at here" and must not appear where there is nothing.
    expect(refusalSummary(REAL.noPaintings).highlight).toBe('5 famous works listed here');
    expect(refusalSummary(REAL.church).highlight).toBe('The Elevation of the Cross');
    expect(refusalSummary(REAL.byHand).highlight).toBeUndefined();
    expect(refusalSummary(REAL.notMuseum).highlight).toBeUndefined();
  });

  it('does not repeat the name the card already carries as its heading', () => {
    // Both hand-written exclusions here open by naming the venue, because they were written
    // where nothing else did. On a card the name is the heading two lines up.
    expect(refusalSummary(REAL.byHand, 'British Museum').text)
      .toBe('Kept out by hand: typed art museum on Wikidata; out by the strict-art boundary of '
        + '2026-08-05, returns with the archaeology import.');
    // Without the name, or under a different one, the note is left exactly as written.
    expect(refusalSummary(REAL.byHand).text).toContain('British Museum');
    expect(refusalSummary(REAL.byHand, 'Musée de l’Homme').text).toContain('British Museum');
  });

  it('opens the sentence in English, whichever class the rule named', () => {
    // The six site classes are written for a rule: two of them break "A <class>". Both are
    // live — `venueTest.ts` names the Roman Forum and the Palatine as what they were read
    // off — and the class that leads the sentence is whichever comes first on the entity.
    const site = (kind: string) => refusalSummary(`site, not a venue: ${kind}`).text;

    expect(site('archaeological park')).toBe('An archaeological park, not a museum you buy a ticket to.');
    expect(site('roman ruins')).toBe('Roman ruins, not a museum you buy a ticket to.');
    expect(site('church building')).toBe('A church building, not a museum you buy a ticket to.');
    // Not every trailing "s" is a plural: "Roman archaeological site" keeps its article.
    expect(site('Roman archaeological site'))
      .toBe('A Roman archaeological site, not a museum you buy a ticket to.');
  });

  it('drops the clause naming the work, and keeps everything the verdict itself said', () => {
    // Cutting at the first dash instead of at the marker takes the half that explains why
    // a holding is not a place, and the second class with it.
    expect(refusalSummary(REAL.killListDashed).text)
      .toBe('Not a place you visit: art collection — a holding, not a place; museum network — '
        + 'an umbrella, not a visit.');
    expect(refusalSummary(REAL.killList).text)
      .toBe('Not a place you visit: curatorial department of the Louvre.');
    // The card never carries the appended clause, whichever branch reads the reason.
    for (const [name, reason] of Object.entries(REAL)) {
      expect(refusalSummary(reason).text, name).not.toContain('sitelinks');
      expect(refusalSummary(reason).text, name).not.toContain('named by');
    }
  });

  it('answers every other shape the rules can produce', () => {
    expect(refusalSummary(REAL.nothingToJudge).text).toContain('no famous work here');
    expect(refusalSummary(REAL.byHand).text).toContain('Kept out by hand');
    expect(refusalSummary(REAL.killList).text).toContain('Not a place you visit');
    expect(refusalSummary(REAL.dissolved).text).toContain('Closed on 1937-06-01');
    expect(refusalSummary(REAL.notMuseum).text).toContain('does not call this a museum');
    expect(refusalSummary(REAL.noCoords).text).toContain('cannot be put on the map');
  });

  it('keeps the rule’s own sentence when the shape is one nobody has explained', () => {
    // Better opaque than a confident summary of a rule this file has not read.
    expect(refusalSummary('some rule nobody has written yet').text).toBe('some rule nobody has written yet');
    expect(refusalSummary(null).text).toBe('No reason was recorded.');
  });

  it('leaves no real reason showing the machine’s own words on the card', () => {
    for (const [name, reason] of Object.entries(REAL)) {
      expect(refusalSummary(reason).text, name).not.toBe(reason);
      expect(refusalSummary(reason).text, name).not.toContain('painting(s)');
      expect(refusalSummary(reason).text, name).not.toContain('painting-share');
    }
  });
});

describe('refusalHelp', () => {
  it('answers "why these five and not the collection"', () => {
    const help = refusalHelp(REAL.noPaintings);

    expect(help).toContain('not the collection');
    expect(help).toContain('famous enough to carry their own page');
    // The threshold the stored sentence never states, and the part that decides.
    expect(help).toContain('at least half are paintings');
    // What was recorded stays reachable, verbatim.
    expect(help).toContain(REAL.noPaintings);
    expect(help).toContain('0 paintings against 5 sculptures and antiquities');
  });

  it('bends both counts in the panel, on the shape that opens it most', () => {
    // The reachable one-work refusal is `0 vs 1` — `artVerdict` admits on
    // `paintings >= sculptures` — and it is the majority of the refusals here, so
    // "0 paintings against 1 sculptures" would be the most-read sentence in this panel.
    expect(refusalHelp('not an art museum — painting-share: 0 painting(s) vs 1 sculptural work(s)'))
      .toContain('0 paintings against 1 sculpture or antiquity.');
    expect(refusalHelp('not an art museum — painting-share: 1 painting(s) vs 2 sculptural work(s)'))
      .toContain('1 painting against 2 sculptures and antiquities.');
  });

  it('explains why a cathedral was in a list of museums at all', () => {
    const help = refusalHelp(REAL.church);

    expect(help).toContain('places you buy a ticket to');
    expect(help).toContain('a famous work kept inside one pulls the building into the list');
    expect(help).toContain(REAL.church);
  });

  it('says outright when a person, not a measurement, made the call', () => {
    expect(refusalHelp(REAL.byHand)).toContain('A person decided this one');
    expect(refusalHelp(REAL.byHand)).toContain('no count');
  });

  it('offers help for every shape the rules produce', () => {
    for (const [name, reason] of Object.entries(REAL)) {
      expect(refusalHelp(reason), name).not.toBeNull();
    }
  });

  it('offers nothing where it would be guessing', () => {
    expect(refusalHelp('some rule nobody has written yet')).toBeNull();
    expect(refusalHelp(null)).toBeNull();
  });
});
