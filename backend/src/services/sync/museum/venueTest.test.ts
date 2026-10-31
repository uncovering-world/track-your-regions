import { describe, it, expect } from 'vitest';
import { DISSOLVED_UNKNOWN, venueVerdict, museumRule, type VenueFacts, type VenueRule } from './venueTest.js';

const MUSEUM_CLASSES = new Set(['Q33506', 'Q207694']); // museum, art museum
// The museum classes as the run reads them, under `museum`: palazzo and historic house museum among them
const HOUSE_RULE = museumRule(new Set([...MUSEUM_CLASSES, 'Q112132542', 'Q2087181']));
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

  it('rejects a collection dissolved on an unknown date, and says so', () => {
    const v = venueVerdict(facts({ dissolved: DISSOLVED_UNKNOWN }), museumRule(MUSEUM_CLASSES));
    expect(v).toEqual({ pass: false, reason: 'dissolved, date unknown (P576)' });
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
    // A villa typed museum and nothing that says the villa is the museum.
    const v = venueVerdict(facts({ classes: ['Q33506', 'Q3950'] }), museumRule(MUSEUM_CLASSES));
    expect(v.pass).toBe(false);
    expect((v as { reason: string }).reason).toContain('villa');
  });

  it('admits a villa Wikidata types the museum of its own building (#1614)', () => {
    // The Villa Farnesina: villa; palazzo museum; religious museum; museum of a public entity
    expect(venueVerdict(facts({ classes: ['Q3950', 'Q112132542', 'Q92755865', 'Q124830213'] }), HOUSE_RULE)).toEqual({
      pass: true,
    });
    // Ainola, Sibelius's home: villa; historic house museum
    expect(venueVerdict(facts({ classes: ['Q3950', 'Q2087181'] }), HOUSE_RULE)).toEqual({ pass: true });
  });

  it('still vetoes a church typed museum alone, and the grounds of a dig whatever museum it is', () => {
    // Antwerp Cathedral: church building; Catholic cathedral; museum
    const cathedral = venueVerdict(facts({ classes: ['Q16970', 'Q56242215', 'Q33506'] }), HOUSE_RULE);
    expect(cathedral).toEqual({ pass: false, reason: 'site, not a venue: church building; Catholic cathedral' });
    // The Blue Grotto: sea cave; archaeological park; historic house museum
    const grotto = venueVerdict(facts({ classes: ['Q3363945', 'Q2087181'] }), HOUSE_RULE);
    expect(grotto).toEqual({ pass: false, reason: 'site, not a venue: archaeological park' });
    // Santa Maria Novella (Q51175): minor basilica; museum; religious museum. Places of worship shows it.
    const basilica = venueVerdict(facts({ classes: ['Q120560', 'Q33506', 'Q92755865'] }), HOUSE_RULE);
    expect(basilica).toEqual({ pass: false, reason: 'site, not a venue: minor basilica' });
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

describe('venueVerdict — a holding that is also a museum (#1617)', () => {
  it('admits a collection Wikidata also types a museum, with coordinates, as one house', () => {
    // The Frick Collection: art museum, art collection, on Fifth Avenue; the Carnegie Museum of
    // Art: art museum, art collection, museum.
    expect(venueVerdict(facts({ classes: ['Q207694', 'Q7328910'], housesApart: false }), museumRule(MUSEUM_CLASSES))).toEqual({ pass: true });
    expect(venueVerdict(facts({ classes: ['Q207694', 'Q7328910', 'Q33506'] }), museumRule(MUSEUM_CLASSES))).toEqual({ pass: true });
  });

  it('still refuses a holding with no museum class, no coordinates, or several houses', () => {
    // The Crozat Collection: an art collection and nothing else.
    expect(venueVerdict(facts({ classes: ['Q7328910'] }), museumRule(MUSEUM_CLASSES)))
      .toEqual({ pass: false, reason: 'kill-list: art collection — a holding, not a place' });
    // A museum-typed collection with no coordinates of its own.
    expect(venueVerdict(facts({ classes: ['Q207694', 'Q7328910'], lat: null, lon: null }), museumRule(MUSEUM_CLASSES)))
      .toEqual({ pass: false, reason: 'kill-list: art collection — a holding, not a place' });
    // The Bavarian State Painting Collections: an art museum by class, twenty houses apart.
    expect(venueVerdict(facts({ classes: ['Q207694', 'Q7328910'], housesApart: true }), museumRule(MUSEUM_CLASSES)))
      .toEqual({ pass: false, reason: 'kill-list: art collection — a holding, not a place' });
  });

  it('refuses a museum network whatever else it carries: the house it stands for is the resolver\'s', () => {
    // The Museo Soumaya: museum network, three houses, coordinates on Plaza Carso.
    expect(venueVerdict(facts({ classes: ['Q88667167'], housesApart: true }), museumRule(MUSEUM_CLASSES)))
      .toEqual({ pass: false, reason: 'kill-list: museum network — an umbrella, not a visit' });
    expect(venueVerdict(facts({ classes: ['Q88667167', 'Q207694'], housesApart: false }), museumRule(MUSEUM_CLASSES)))
      .toEqual({ pass: false, reason: 'kill-list: museum network — an umbrella, not a visit' });
  });
});
