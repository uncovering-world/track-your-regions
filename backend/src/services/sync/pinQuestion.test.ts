import { describe, expect, it } from 'vitest';
import { asksAgain, foldedReason } from './pinQuestion.js';

/**
 * The pins on the development catalogue on 2026-10-12, and what a run could
 * say about each next (#1367).
 */

const GARDNER_REASON = 'its famous works cannot be seen — The Storm on the Sea of Galilee (whereabouts unknown)';
/** The Isabella Stewart Gardner Museum, put back into Art Museums over the rule's refusal. */
const GARDNER = { answer: 'admitted', answered: { verdict: 'refused', reason: GARDNER_REASON } } as const;
/** The British Museum, kept out of Art Museums by a confirmation. */
const BRITISH_MUSEUM = {
  answer: 'refused',
  answered: { verdict: 'refused', reason: 'editorial exclusion: British Museum — typed art museum on Wikidata' },
} as const;
/** An arrival a curator refused, which the run had admitted. */
const REFUSED_ARRIVAL = { answer: 'refused', answered: { verdict: 'admitted', reason: null } } as const;

describe('whether a run asks about a pin again', () => {
  it('holds a put-back the run refuses for the reason it answered', () => {
    expect(asksAgain(GARDNER, { verdict: 'refused', reason: GARDNER_REASON })).toBe(false);
  });

  it('asks about a put-back the run refuses for another reason', () => {
    expect(asksAgain(GARDNER, { verdict: 'refused', reason: 'site, not a venue: museum' })).toBe(true);
  });

  it('asks nothing once the rule admits what the curator put back', () => {
    expect(asksAgain(GARDNER, { verdict: 'admitted', reason: null })).toBe(false);
  });

  it('asks about a confirmed refusal the rule would now admit', () => {
    expect(asksAgain(BRITISH_MUSEUM, { verdict: 'admitted', reason: null })).toBe(true);
  });

  it('asks nothing when a confirmed refusal is refused in other words', () => {
    expect(asksAgain(BRITISH_MUSEUM, { verdict: 'refused', reason: 'not an art museum — painting-share: 0 painting(s) vs 4 sculptural work(s)' }))
      .toBe(false);
  });

  it('holds a refused arrival the run still admits, and one the rule now refuses too', () => {
    expect(asksAgain(REFUSED_ARRIVAL, { verdict: 'admitted', reason: null })).toBe(false);
    expect(asksAgain(REFUSED_ARRIVAL, { verdict: 'refused', reason: 'not public art: archaeological site' })).toBe(false);
  });

  it('reads a count that ticked as the same reason', () => {
    const victoryArch = {
      answer: 'admitted',
      answered: { verdict: 'refused', reason: "17 sitelinks: below the world tier's line (22 to enter, 18 to stay)" },
    } as const;
    expect(asksAgain(victoryArch, { verdict: 'refused', reason: "19 sitelinks: below the world tier's line (22 to enter, 18 to stay)" }))
      .toBe(false);
  });

  it('asks nothing about a pin that recorded no view', () => {
    expect(asksAgain({ answer: 'admitted', answered: null }, { verdict: 'refused', reason: 'anything' })).toBe(false);
  });
});

describe("a reason with the rule's own words dropped (#2430)", () => {
  // Aqua Claudia, put back on 2 Nov and asked about again on 10 Nov, as the development stack holds both reasons.
  const answered = "24 Wikipedia editions and 46,234 readers a year, no guide uses it and Atlas Obscura does not list it: under the world tier's bars (34 Wikipedia editions, 150,543 readers a year, or 25,421 where a guide uses it or Atlas Obscura lists it; a place held stays at 0.8 of any)";
  const now = "24 Wikipedia editions and 45,185 readers a year, no guide uses it and Atlas Obscura does not list it: under the world tier's bars (34 Wikipedia editions, 147,764 readers a year, or 24,931 where a guide uses it, Atlas Obscura lists it or the World Heritage List inscribes it; a place held stays at 0.8 of any)";

  it('asks nothing when only the bars the rule spells out changed', () => {
    expect(foldedReason(now)).toBe(foldedReason(answered));
    expect(asksAgain({ answer: 'admitted', answered: { verdict: 'refused', reason: answered } }, { verdict: 'refused', reason: now }))
      .toBe(false);
  });

  it('asks nothing when a signal is only as last read', () => {
    const lastRead = now.replace('45,185 readers a year', '45,185 readers a year as last read')
      .replace('no guide uses it', 'no guide uses it (the guides as last read)');
    expect(foldedReason(lastRead)).toBe(foldedReason(answered));
  });

  it('asks when a fact of the place changed, or the refusal is of another kind', () => {
    const guided = now.replace('no guide uses it', 'a Wikivoyage guide uses it');
    expect(asksAgain({ answer: 'admitted', answered: { verdict: 'refused', reason: answered } }, { verdict: 'refused', reason: guided }))
      .toBe(true);
    // The Flame of Liberty, put back over the fame line and now refused for its class.
    expect(asksAgain(
      { answer: 'admitted', answered: { verdict: 'refused', reason: "17 sitelinks: below the world tier's line (22 to enter, 18 to stay)" } },
      { verdict: 'refused', reason: 'no monument or memorial class' },
    )).toBe(true);
  });

  it('keeps a parenthesis that is the place\'s own fact', () => {
    expect(foldedReason('its famous works cannot be seen — Salvator Mundi (whereabouts unknown)'))
      .toBe('its famous works cannot be seen — Salvator Mundi (whereabouts unknown)');
  });
});

describe('a reason with its numbers folded', () => {
  it('folds every run of digits, and keeps the words', () => {
    expect(foldedReason('not an art museum — painting-share: 3 painting(s) vs 12 sculptural work(s)'))
      .toBe('not an art museum — painting-share: # painting(s) vs # sculptural work(s)');
    expect(foldedReason(null)).toBeNull();
  });

  it('reads the measure the same in either of the words the rule has used for it (#1589)', () => {
    // Warsaw Uprising Monument: put back over the first, and asked about in the second since #1240.
    const answered = "17 sitelinks: below the world tier's line (22 to enter, 18 to stay)";
    const now = "16 Wikipedia editions: below the world tier's line (22 to enter, 18 to stay)";
    expect(foldedReason(now)).toBe(foldedReason(answered));
    expect(foldedReason('1 Wikipedia edition: below the line')).toBe(foldedReason('1 sitelink: below the line'));
    expect(asksAgain({ answer: 'admitted', answered: { verdict: 'refused', reason: answered } }, { verdict: 'refused', reason: now }))
      .toBe(false);
    // A reason that differs in substance is still a question.
    expect(asksAgain({ answer: 'admitted', answered: { verdict: 'refused', reason: answered } }, { verdict: 'refused', reason: 'site, not a venue: museum' }))
      .toBe(true);
  });
});
