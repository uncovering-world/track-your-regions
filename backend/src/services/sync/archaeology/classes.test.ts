import { describe, it, expect } from 'vitest';
import { osmBatchQuery } from '../osm/qleverOsm.js';
import {
  MUSEUM_ROOTS, FIND_CLASSES, NOT_A_FIND, NATURE_CATEGORY, DEPARTMENT_CATEGORIES,
  buildArchaeologyTrees, ANCIENT_CUTOFF_YEAR, NATURAL_HISTORY_ROOT, ARTEFACT_ROOT,
  ARCHAEOLOGICAL_PARK, SITE_ROOT, SETTLEMENT_ROOT, SHIPWRECK_ROOT, RUIN_HISTORIC,
  RUIN_KEYS, LIVING_PLACE, PROTECTED_BOUNDARY, SITE_CLASSES, SITE_KILL_CLASSES,
  SITE_KILL_UNLESS_SITE, SITE_KILL_NATURAL, SITE_KILL_BY_NAME, OSM_KEEP_WKT,
  CENSUS_BOUNDARY, FORTIFICATION_ROOT, PALACE_ROOT, WORSHIP_STRUCTURE_ROOT,
} from './classes.js';

describe('archaeology classes', () => {
  it('names the two museum roots the survey used', () => {
    expect(Object.keys(MUSEUM_ROOTS).sort()).toEqual(['Q3329412', 'Q3330834']);
  });
  it('reads the category that says what a museum is, and the ones that name a department', () => {
    expect(NATURE_CATEGORY.test('Archaeological museums in France')).toBe(true);
    expect(NATURE_CATEGORY.test('Museums of ancient Rome in Russia')).toBe(false);
    expect(DEPARTMENT_CATEGORIES.some((c) => c.test('Egyptological collections in Russia'))).toBe(true);
    expect(DEPARTMENT_CATEGORIES.some((c) => c.test('Art museums and galleries in Paris'))).toBe(false);
  });
  it('keeps fossils and diamonds out of the finds', () => {
    expect(NOT_A_FIND.Q40614).toMatch(/fossil/);
    expect(FIND_CLASSES.Q40614).toBeUndefined();
  });
  it('builds the trees as sets, and floors the six a museum-only caller never states', () => {
    const trees = buildArchaeologyTrees({
      museum: ['Q3329412'], park: [], naturalHistory: ['Q1970365'], artefact: ['Q220659'],
    });
    expect(trees.museum.has('Q3329412')).toBe(true);
    // Optional on the way in, floored on the way out: a museum-only caller
    // states no site tree and still gets one it can ask. Every one of them,
    // because an unfloored set is a rule that cannot name what it reads — an
    // empty `fortification` walks Bodiam under `ruins=yes` in as a dig.
    expect(trees.site.has(SITE_ROOT)).toBe(true);
    expect(trees.settlement.has(SETTLEMENT_ROOT)).toBe(true);
    expect(trees.shipwreck.has(SHIPWRECK_ROOT)).toBe(true);
    expect(trees.fortification.has(FORTIFICATION_ROOT)).toBe(true);
    expect(trees.palace.has(PALACE_ROOT)).toBe(true);
    expect(trees.worship.has(WORSHIP_STRUCTURE_ROOT)).toBe(true);
  });

  it('names the site door\'s signals as the measurement found them', () => {
    // The values 477 items carry, and the two secondary keys.
    expect(RUIN_HISTORIC.has('archaeological_site')).toBe(true);
    expect(RUIN_HISTORIC.has('church')).toBe(false);
    expect(RUIN_KEYS).toEqual(['ruins', 'archaeological_site']);
    // A named spot and an island are not people living somewhere: without this,
    // Pompeii (place=locality) and Rhodes are read as towns.
    expect(LIVING_PLACE.has('town')).toBe(true);
    expect(LIVING_PLACE.has('locality')).toBe(false);
    expect(LIVING_PLACE.has('island')).toBe(false);
    // The extent comes from what protects the dig, never from a municipality.
    expect(PROTECTED_BOUNDARY.has('protected_area')).toBe(true);
    expect(PROTECTED_BOUNDARY.has('administrative')).toBe(false);
    // And the reader is told the same line, once.
    expect(OSM_KEEP_WKT.boundary).toEqual(['protected_area', 'national_park']);
    expect(OSM_KEEP_WKT.historic).toContain('archaeological_site');
    // A census outline is a counted population, which is the only boundary
    // value the living-place rule reads (the four New Mexico rows).
    expect(CENSUS_BOUNDARY).toBe('census');
  });

  it('reads neither a Roman road nor a memorial as a ruin standing somewhere', () => {
    // Both were in the set from the tagging wiki rather than from the counts,
    // and the rows they actually decided say they do not belong: `roman_road`
    // decides Watling Street and the Via Flaminia — a 430 km road is not a
    // place a traveller stands in — and `memorial` decides the Lop Desert
    // alone, on a modern marker in a desert (measured 2026-09-14).
    expect(RUIN_HISTORIC.has('roman_road')).toBe(false);
    expect(RUIN_HISTORIC.has('memorial')).toBe(false);
    expect(OSM_KEEP_WKT.historic).not.toContain('roman_road');
  });

  it('fetches a geometry for every key that says ruin, the reader and the list agreeing', () => {
    // The query spells `BOUND(?ruins) && ?ruins != "no"` and the same for
    // `archaeological_site` by hand (`osm/qleverOsm.ts`), because a key's
    // *presence* is the signal — unless the mapper wrote `no`, the one value
    // `saidOf` reads as the opposite, whose outline nothing downstream can
    // use — and there is no value list to match. A key added to `RUIN_KEYS`
    // and forgotten there would name a ruin whose outline never crosses the
    // wire — the rule would admit the site and the map would draw nothing.
    const query = osmBatchQuery(['Q22647'], OSM_KEEP_WKT);
    for (const key of RUIN_KEYS) {
      expect(query, `${key} decides a ruin but its geometry is never asked for`)
        .toContain(`(BOUND(?${key}) && ?${key} != "no")`);
    }
  });

  it('names the site classes and the three kill lists with their real ids', () => {
    expect(SITE_CLASSES.Q839954).toBe('archaeological site');
    expect(SITE_CLASSES.Q1708422).toBe('settlement site');
    expect(SITE_KILL_CLASSES[SHIPWRECK_ROOT]).toBe('a shipwreck');
    expect(SITE_KILL_UNLESS_SITE.Q2974842).toMatch(/lost city/);
    expect(SITE_KILL_NATURAL.Q23397).toBe('a lake');
    // The two run 121 admitted, each verified with wbgetentities on
    // 2026-09-14: Qiandao Lake is `reservoir` (Q131681) over a drowned city,
    // the Lop Desert is `desert` (Q8514).
    expect(SITE_KILL_NATURAL.Q131681).toBe('a reservoir');
    expect(SITE_KILL_NATURAL.Q8514).toBe('a desert');
    expect(SITE_KILL_BY_NAME.Q2181).toMatch(/Aysén/);
  });
  it('takes the whole park tree out of the museum set, keeps it, and floors the other two', () => {
    const t = buildArchaeologyTrees({
      museum: ['Q3329412', 'Q3363945', 'Q11665453'],
      park: ['Q3363945', 'Q11665453'],
      naturalHistory: [],
      artefact: [],
    });
    expect(t.museum.has('Q3363945')).toBe(false);
    expect(t.museum.has('Q11665453')).toBe(false);
    expect(t.museum.has('Q3329412')).toBe(true);
    // Kept, not discarded: the category door needs something to ask.
    expect(t.park.has('Q11665453')).toBe(true);
    expect(t.park.has(ARCHAEOLOGICAL_PARK)).toBe(true);
    expect(t.naturalHistory.has(NATURAL_HISTORY_ROOT)).toBe(true);
    expect(t.artefact.has(ARTEFACT_ROOT)).toBe(true);
  });
  it('cuts the art pool at AD 500', () => {
    expect(ANCIENT_CUTOFF_YEAR).toBe(500);
  });
});
