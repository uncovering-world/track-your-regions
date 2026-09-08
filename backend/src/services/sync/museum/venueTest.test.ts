import { describe, it, expect } from 'vitest';
import { venueVerdict, museumRule, type VenueFacts, type VenueRule } from './venueTest.js';

const MUSEUM_CLASSES = new Set(['Q33506', 'Q207694']); // museum, art museum
const facts = (over: Partial<VenueFacts>): VenueFacts =>
  ({ qid: 'Q1', classes: ['Q207694'], lat: 48.8, lon: 2.3, dissolved: null, ...over });

describe('venueVerdict', () => {
  it('admits a museum class with its own coordinates', () => {
    expect(venueVerdict(facts({}), museumRule(MUSEUM_CLASSES))).toEqual({ pass: true });
  });

  it('rejects a curatorial department even though it has coordinates', () => {
    // Q3044768, Department of Paintings of the Louvre: typed art collection (Q7328910) and
    // curatorial department of the Louvre (Q11681271), and it has its own P625, which is why
    // the old "resolve only when coordinates are missing" rule never touched it.
    const v = venueVerdict(facts({ classes: ['Q7328910', 'Q11681271'] }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('curatorial department');
  });

  it('rejects a dissolved collection', () => {
    // Frans Buffa & sons, dissolved 1951
    const v = venueVerdict(facts({ dissolved: '1951-01-01' }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('dissolved');
  });

  it('rejects an entity with no coordinates of its own', () => {
    const v = venueVerdict(facts({ lat: null, lon: null }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('coordinates');
  });

  it('treats a coordinate of zero as a position, not an absence', () => {
    expect(venueVerdict(facts({ lat: 0, lon: 0 }), museumRule(MUSEUM_CLASSES))).toEqual({ pass: true });
  });

  it('rejects an entity with no museum class at all', () => {
    const v = venueVerdict(facts({ classes: ['Q515'] }), museumRule(MUSEUM_CLASSES)); // city
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('not a museum class');
  });

  it('admits a museum class mixed with unrelated classes', () => {
    // Regression: museum-class check must use .some(), not .every().
    // Real museums carry several P31 classes; one being Q207694 (art museum) should suffice.
    expect(venueVerdict(facts({ classes: ['Q207694', 'Q515'] }), museumRule(MUSEUM_CLASSES))).toEqual({
      pass: true,
    });
  });

  it('rejects the Führermuseum: a real museum that never opened', () => {
    // Regression: kill-list check must trigger if *any* class is on the veto list.
    // The Führermuseum (Q587968 in real Wikidata) is typed both museum (Q33506) and
    // proposed building (Q811683, a kill class). Kill-list should take precedence.
    const v = venueVerdict(facts({ classes: ['Q207694', 'Q811683'] }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('proposed building');
  });

  it('rejects an entity with only latitude, missing longitude', () => {
    // Regression: coordinates check must require *both* lat and lon, not just one.
    const v = venueVerdict(facts({ lat: 48.8, lon: null }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('coordinates');
  });

  it('rejects a site class with no art class present', () => {
    // The Villa Farnesina: typed villa plus several non-art museum classes, no art class.
    const v = venueVerdict(facts({ classes: ['Q33506', 'Q3950'] }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('villa');
  });

  it('does not veto a site class when an art class is also present', () => {
    // Mutation target: the site veto must not fire regardless of art class. The Uffizi is typed
    // palace + art museum; Q3950 (villa) stands in for the shape of the problem, since the
    // Uffizi's own place class (palace) is deliberately not on the site-class list.
    expect(venueVerdict(facts({ classes: ['Q3950', 'Q207694'] }), museumRule(MUSEUM_CLASSES))).toEqual({
      pass: true,
    });
  });

  it('does not veto a non-art museum class that is not a site class either', () => {
    // An archaeological museum is a real institution — just not art and not a place — so the
    // site veto must leave it alone (the art test, not this one, is what excludes it).
    expect(venueVerdict(facts({ classes: ['Q33506'] }), museumRule(MUSEUM_CLASSES))).toEqual({ pass: true });
  });
});

const WORSHIP_RULE: VenueRule = { classes: new Set(['Q16970', 'Q56242215']), siteVeto: false, noun: 'place of worship' };

describe('venueVerdict with a rule', () => {
  it('the museum rule still vetoes a church building without an art class', () => {
    const v = venueVerdict(facts({ classes: ['Q33506', 'Q16970'] }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toBe('site, not a venue: church building');
  });

  it('a worship rule admits the same church building', () => {
    expect(venueVerdict(facts({ classes: ['Q16970'] }), WORSHIP_RULE)).toEqual({ pass: true });
  });

  it('names the rule\'s noun when no class matches', () => {
    const v = venueVerdict(facts({ classes: ['Q999'] }), WORSHIP_RULE);
    expect((v as { reason: string }).reason).toBe('not a place of worship class');
  });
});
