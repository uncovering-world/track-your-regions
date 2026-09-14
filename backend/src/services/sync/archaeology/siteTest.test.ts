/**
 * The site door on the places the measurement of 2026-09-14 recorded.
 *
 * Every QID, class, tag and object id below is real and was read off
 * `data/cache/osm-sites/` (`wd-sites.json`, `osm-tags.json`,
 * `living-facts.json`) and confirmed with `wbgetentities` the same day. That is
 * the point of the file: the rule was written from these rows, and a rule that
 * stops agreeing with them has changed what the catalogue admits.
 */
import { describe, it, expect } from 'vitest';
import { buildArchaeologyTrees, SHIPWRECK_ROOT } from './classes.js';
import { siteExtent, siteSignal, siteVerdict, type SiteFacts } from './siteTest.js';
import type { OsmObject } from '../osm/types.js';

const LINE = { enterSitelinks: 22, staySitelinks: 18 };

/** The trees a run fetches, as far as these rows need them. */
const TREES = buildArchaeologyTrees({
  museum: [], park: [], naturalHistory: [], artefact: [],
  // Real edges, checked on 2026-09-14: `polis`, `ancient city`, `settlement
  // site`, `free city` and `Bronze Age settlement` are all under
  // `archaeological site`, and every one of them is under `human settlement`
  // too — which is the whole reason OSM is asked. `lost city`, `necropolis`
  // and `shipwreck` are under it as well; `lake`, `mountain range` and `ruins`
  // are not, and the rows carrying those reach the pool by carrying
  // `archaeological site` itself.
  site: ['Q839954', 'Q148837', 'Q15661340', 'Q1708422', 'Q5500203', 'Q65064889',
    'Q200141', 'Q852190', 'Q2974842', 'Q755017', 'Q3363945'],
  settlement: ['Q486972', 'Q133442', 'Q148837', 'Q1134686', 'Q1549591', 'Q15661340',
    'Q1708422', 'Q200250', 'Q2974842', 'Q515', 'Q51929311', 'Q532', 'Q5500203', 'Q65064889'],
  shipwreck: [SHIPWRECK_ROOT],
});

const object = (ref: string, tags: Record<string, string>, wkt: string | null = null): OsmObject => ({
  ref,
  kind: ref.split('/')[0] as OsmObject['kind'],
  tags,
  geometryType: wkt ? wkt.slice(0, wkt.indexOf('(')) : null,
  wkt,
});

// No `settlementBranch` here, and that is the point of it having gone: the
// branch is a question about the class tree, and the rule holds the tree, so
// the rule asks it. A helper that computed it was a second copy of a rule the
// verdict already applies — and a caller that forgot it admitted Athens.
const facts = (over: Partial<SiteFacts> & Pick<SiteFacts, 'qid' | 'classes' | 'sitelinks'>): SiteFacts => ({
  worldHeritage: false,
  statesPopulation: false,
  ...over,
});

const verdictOf = (f: SiteFacts, objects: OsmObject[] = []) =>
  siteVerdict({ facts: f, objects, trees: TREES, admitted: new Set<string>(), line: LINE });

const POLYGON = 'POLYGON((26.23 39.95,26.24 39.95,26.24 39.96,26.23 39.95))';

describe('the site door, on the rows it was written from', () => {
  it('admits Troy: a settlement to Wikidata, an excavation on the map', () => {
    // Q22647, 121 sitelinks, classes city-state / polis / Bronze Age settlement
    // / settlement site — not one of them says "site" on its own — and
    // way/423938794 tagged historic=archaeological_site.
    const verdict = verdictOf(
      facts({ qid: 'Q22647', classes: ['Q133442', 'Q148837', 'Q65064889', 'Q1708422'], sitelinks: 121, worldHeritage: true }),
      [object('way/423938794', {
        historic: 'archaeological_site', archaeological_site: 'city',
        heritage: '1', tourism: 'attraction', boundary: 'protected_area',
      }, POLYGON)],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('ruin');
    expect(verdict.osm.object).toBe('way/423938794');
    expect(verdict.osm.tag).toBe('historic=archaeological_site');
  });

  it('refuses Athens: OSM maps a city and Wikidata counts its people', () => {
    // Q1524, 288 sitelinks, classes big city / largest city / metropolis / free
    // city — no site class — population 643,452, node/441183 place=city.
    const verdict = verdictOf(
      facts({ qid: 'Q1524', classes: ['Q1549591', 'Q51929311', 'Q200250', 'Q5500203'], sitelinks: 288, statesPopulation: true }),
      [object('node/441183', { place: 'city', name: 'Αθήνα' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Athens must be refused by name');
    expect(verdict.reason).toBe(
      'a living place — OSM maps a town here and Wikidata counts its people '
      + '(place=city on node/441183)',
    );
  });

  it('refuses Populonia without claiming Wikidata counted anybody', () => {
    // Q1231948, 22 sitelinks, classes frazione / ancient city — no site class —
    // with node/2813463723 place=hamlet and **no population statement at all**.
    // Baia (32), Tindari (28), Tus (43) and Halki (38) are the same shape above
    // the line: the refusal stands, and the sentence says what was read.
    const verdict = verdictOf(
      facts({ qid: 'Q1231948', classes: ['Q1134686', 'Q15661340'], sitelinks: 22 }),
      [object('node/2813463723', { place: 'hamlet', name: 'Populonia' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Populonia must be refused by name');
    expect(verdict.reason).toBe(
      'a living place — OSM maps a town here and Wikidata gives it no class of a site '
      + '(place=hamlet on node/2813463723)',
    );
  });

  it('admits Pompeii: a named spot is not a living place, and the class says site', () => {
    // Q43332, 122 sitelinks, classes archaeological site / ancient city, and
    // node/4753980853 place=locality — which the measurement found on Pompeii,
    // Sounion and Capernaum and which names a spot, not a town.
    const verdict = verdictOf(
      facts({ qid: 'Q43332', classes: ['Q839954', 'Q15661340'], sitelinks: 122, statesPopulation: true }),
      [object('node/4753980853', { place: 'locality', name: 'Pompei Antica' })],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('none');
    expect(verdict.osm.extentFrom).toBeNull();
  });

  it('admits Bagan: OSM maps a town, and the site is World Heritage itself', () => {
    // Q29317, 79 sitelinks, P757 1588 and P1435 Q9259, population 22,000,
    // node/597205381 place=town.
    const verdict = verdictOf(
      facts({ qid: 'Q29317', classes: ['Q7830262', 'Q839954', 'Q15661340'], sitelinks: 79, worldHeritage: true, statesPopulation: true }),
      [object('node/597205381', { place: 'town' })],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('living');
  });

  it('admits Saqqara: a site class, and Wikidata counts nobody there', () => {
    // Q192134, 65 sitelinks, classes village / necropolis / archaeological site,
    // no population statement, node/331877485 place=village.
    const verdict = verdictOf(
      facts({ qid: 'Q192134', classes: ['Q532', 'Q200141', 'Q839954'], sitelinks: 65 }),
      [object('node/331877485', { place: 'village' })],
    );
    expect(verdict.pass).toBe(true);
  });

  it('refuses Asyut: the same site class, and half a million people', () => {
    // Q29962, 74 sitelinks, classes city / big city / archaeological site,
    // population 562,061, a node and a way both place=city.
    const verdict = verdictOf(
      facts({ qid: 'Q29962', classes: ['Q515', 'Q1549591', 'Q839954'], sitelinks: 74, statesPopulation: true }),
      [object('node/6379231716', { place: 'city' }), object('way/94168759', { place: 'city' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Asyut must be refused by name');
    expect(verdict.reason).toContain('a living place');
    expect(verdict.reason).toContain('node/6379231716');
  });

  it('refuses the Aysén Region by name: a region of Chile mis-typed as a site', () => {
    // Q2181, 67 sitelinks, classes region of Chile / archaeological site /
    // pene-enclave, and relation/305693 boundary=administrative. Nothing else
    // in the rule catches it: the class says site and OSM says nothing.
    const verdict = verdictOf(
      facts({ qid: 'Q2181', classes: ['Q590080', 'Q8273909', 'Q839954'], sitelinks: 67 }),
      [object('relation/305693', { boundary: 'administrative' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Aysén must be refused by name');
    expect(verdict.reason).toMatch(/Aysén Region of Chile/);
  });

  it('refuses the Titanic: Wikidata types it a shipwreck', () => {
    // Q25173, 160 sitelinks, classes four funnel liner / steamship /
    // shipwreck. 58 shipwrecks sit in the site tree.
    const verdict = verdictOf(
      facts({ qid: 'Q25173', classes: ['Q3362987', 'Q12859788', 'Q852190'], sitelinks: 160 }),
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('the Titanic must be refused by name');
    expect(verdict.reason).toBe('Wikidata types it a shipwreck');
  });

  it('admits Angkor on its class where OSM says only "heritage"', () => {
    // Q163607, 91 sitelinks, classes city / ancient city / ruins /
    // archaeological site, relation/8160590 carrying heritage=1 and nothing
    // else of interest.
    const verdict = verdictOf(
      facts({ qid: 'Q163607', classes: ['Q515', 'Q15661340', 'Q109607', 'Q839954'], sitelinks: 91, worldHeritage: true }),
      [object('relation/8160590', { heritage: '1', name: 'Angkor' })],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('none');
  });

  it('refuses Rhodes as an island, which is what the map calls it', () => {
    // Q43048, 116 sitelinks, classes polis / island — no site class — with
    // relation/452614 place=island and relation/5321592 boundary=administrative.
    // 17 of the 60 rows this sentence refuses are mapped place=island (Samos,
    // Chios, Ithaca, Zakynthos, Milos …), and calling Ithaca a city is telling
    // a curator something false about the island in the photograph.
    const verdict = verdictOf(
      facts({ qid: 'Q43048', classes: ['Q148837', 'Q23442'], sitelinks: 116 }),
      [object('relation/452614', { place: 'island' }), object('relation/5321592', { boundary: 'administrative' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Rhodes must be refused by name');
    expect(verdict.reason).toBe(
      'an island Wikidata files under archaeological sites, with no ruin on the map '
      + '(2 OSM objects carry it, none of them a ruin)',
    );
    expect(verdict.group).toBe('no-ruin');
  });

  it('refuses Sabratha, and says OSM has nothing to say about it', () => {
    // Q192918, 57 sitelinks, classes city / ancient city / municipality of
    // Libya — no site class, no P757 on the item — and no OSM object at all.
    // Its World Heritage row stands on its own, from source 1.
    const verdict = verdictOf(
      facts({ qid: 'Q192918', classes: ['Q515', 'Q16124843', 'Q1549591', 'Q15661340'], sitelinks: 57, statesPopulation: true }),
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Sabratha must be refused by name');
    expect(verdict.reason).toBe(
      'a city Wikidata files under archaeological sites, with no ruin on the map '
      + '(no OSM object carries this item)',
    );
    // A city, because nothing on the map says island: the two sentences are
    // told apart by the map's own tags and by nothing else.
    expect(verdict.group).toBe('no-ruin');
  });

  it('refuses Constantinople, and counts the one object OSM does carry', () => {
    // Q16869, 127 sitelinks, classes city / administrative territorial entity /
    // ancient city — no site class — and one OSM object, relation/20353798,
    // a walking tour named "Sultanahmet Historic Tour" carrying no tag this
    // kind reads. 16 rows of the pool take this branch, Samos and Chios among
    // them, so the singular has to read as a sentence.
    const verdict = verdictOf(
      facts({ qid: 'Q16869', classes: ['Q515', 'Q56061', 'Q15661340'], sitelinks: 127 }),
      [object('relation/20353798', { name: 'Sultanahmet Historic Tour' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Constantinople must be refused by name');
    expect(verdict.reason).toBe(
      'a city Wikidata files under archaeological sites, with no ruin on the map '
      + '(one OSM object carries it, and it is not a ruin)',
    );
  });

  it('refuses Lake Bled, which is a lake with no ruin mapped on it', () => {
    // Q648902, 55 sitelinks, classes lake / archaeological site / glacial lake
    // / tectonic lake, P1435 Q18519893 (not World Heritage), relation/646
    // natural=water.
    const verdict = verdictOf(
      facts({ qid: 'Q648902', classes: ['Q23397', 'Q839954', 'Q211302', 'Q3511952'], sitelinks: 55 }),
      [object('relation/646', { natural: 'water' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Lake Bled must be refused by name');
    expect(verdict.reason).toMatch(/^a lake/);
  });

  it('keeps Tassili n\'Ajjer, a mountain range that is a World Heritage site itself', () => {
    // Q190048, 69 sitelinks, classes mountain range / archaeological site,
    // P757 179 — the rock art is the reason to go — with no ruin object:
    // way/464707583 carries place=region, heritage=1 and natural=mountain_range.
    const verdict = verdictOf(
      facts({ qid: 'Q190048', classes: ['Q46831', 'Q839954'], sitelinks: 69, worldHeritage: true }),
      [object('way/464707583', { place: 'region', heritage: '1', natural: 'mountain_range' })],
    );
    expect(verdict.pass).toBe(true);
  });

  it('keeps Tadrart Acacus, a mountain range with a ruin mapped in it', () => {
    // Q308807, 55 sitelinks, classes mountain range / archaeological site, and
    // node/7702655158 historic=archaeological_site beside relation/16911758
    // natural=mountain_range.
    const verdict = verdictOf(
      facts({ qid: 'Q308807', classes: ['Q46831', 'Q839954'], sitelinks: 55, worldHeritage: true }),
      [object('node/7702655158', { historic: 'archaeological_site' }),
        object('relation/16911758', { natural: 'mountain_range' })],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('ruin');
  });

  it('refuses Pripyat and Thinis: a town people left, and a city nobody can find', () => {
    // Q170456, 86 sitelinks, typed `lost city` and nothing this kind admits,
    // with node/127835001 place=town. Q1153959 Thinis, 39 sitelinks, typed
    // `lost city` alone with no OSM object — its site has never been located.
    const pripyat = verdictOf(
      facts({ qid: 'Q170456', classes: ['Q2974842', 'Q2514025'], sitelinks: 86, statesPopulation: true }),
      [object('node/127835001', { place: 'town' })],
    );
    expect(pripyat.pass).toBe(false);
    const thinis = verdictOf(facts({ qid: 'Q1153959', classes: ['Q2974842'], sitelinks: 39 }));
    expect(thinis.pass).toBe(false);
    if (thinis.pass || 'out' in thinis) throw new Error('Thinis must be refused by name');
    // The sentence names the class and stops there: which of the two kinds of
    // lost city this one is, the row's own description says.
    expect(thinis.reason).toBe('Wikidata files it as a lost city');
  });

  it('keeps Al-Hirah, the lost city Wikidata also calls a dig', () => {
    // Q310799, 35 sitelinks, typed `lost city` **and** `archaeological site` —
    // the Lakhmid capital — with node/2485464979 place=town over the village
    // that carries the name and way/1155256213 historic=archaeological_site
    // over the dig. The ring below stands in for that way's: the measurement
    // kept only the type word and its first characters, `POLYGON((44.`.
    const objects = [
      object('node/2485464979', { place: 'town', name: 'الحيرة' }),
      object('way/1155256213', { historic: 'archaeological_site', archaeological_site: 'city' },
        'POLYGON((44.48 31.90,44.49 31.90,44.49 31.91,44.48 31.90))'),
    ];
    const verdict = verdictOf(
      facts({ qid: 'Q310799', classes: ['Q2974842', 'Q839954'], sitelinks: 35 }), objects,
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('ruin');
    expect(verdict.osm.extentFrom).toBe('way/1155256213');

    // And the order of the steps: what the item is *not* is asked before the
    // map is read. The same mapped dig, on an item that does not carry the site
    // class, gets Pripyat's answer rather than Troy's.
    const withoutTheSiteClass = verdictOf(
      facts({ qid: 'Q310799', classes: ['Q2974842'], sitelinks: 35 }), objects,
    );
    expect(withoutTheSiteClass.pass).toBe(false);
    if (withoutTheSiteClass.pass || 'out' in withoutTheSiteClass) {
      throw new Error('the kill list is asked before the map');
    }
    expect(withoutTheSiteClass.reason).toBe('Wikidata files it as a lost city');
  });

  it('admits Petra, where the ruin beats the village beside it', () => {
    // Q5788, 117 sitelinks, node/7549551054 place=village for the modern town
    // and way/424506592 historic=archaeological_site with the polygon.
    const verdict = verdictOf(
      facts({ qid: 'Q5788', classes: ['Q15661340', 'Q515', 'Q839954'], sitelinks: 117, worldHeritage: true }),
      [object('node/7549551054', { place: 'village' }),
        object('way/424506592', {
          historic: 'archaeological_site', archaeological_site: 'city', boundary: 'protected_area',
        }, POLYGON)],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('ruin');
    expect(verdict.osm.extentFrom).toBe('way/424506592');
  });
});

describe('the line, asked last', () => {
  it('says nothing about a row nobody has heard of that the source never admitted', () => {
    const verdict = verdictOf(facts({ qid: 'Q43332', classes: ['Q839954'], sitelinks: 16 }));
    expect(verdict.pass).toBe(false);
    if (verdict.pass) return;
    expect('out' in verdict && verdict.out).toBe(true);
  });

  it('refuses an admitted row that has slipped, by name and with its number', () => {
    const verdict = siteVerdict({
      facts: facts({ qid: 'Q43332', classes: ['Q839954'], sitelinks: 16 }),
      objects: [], trees: TREES, admitted: new Set(['Q43332']), line: LINE,
    });
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('a fallen row is refused by name');
    expect(verdict.reason).toBe('16 sitelinks: below the world tier\'s line (22 to enter, 18 to stay)');
  });

  it('keeps an admitted row inside the band', () => {
    const verdict = siteVerdict({
      facts: facts({ qid: 'Q43332', classes: ['Q839954'], sitelinks: 19 }),
      objects: [], trees: TREES, admitted: new Set(['Q43332']), line: LINE,
    });
    expect(verdict.pass).toBe(true);
  });

  it('leaves a rule refusal unnamed below the line, so a curator reads the ones that matter', () => {
    // 830 rows sit between 15 and 21 sitelinks in this pool. A living place
    // down there is not a decision anybody has to read.
    const verdict = verdictOf(
      facts({ qid: 'Q1524', classes: ['Q1549591'], sitelinks: 16, statesPopulation: true }),
      [object('node/441183', { place: 'city' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass) return;
    expect('out' in verdict && verdict.out).toBe(true);
  });
});

describe('siteSignal and siteExtent', () => {
  it('names the object and the tag the verdict was read off', () => {
    expect(siteSignal([object('way/1', { ruins: 'yes' })])).toEqual({
      verdict: 'ruin', object: 'way/1', tag: 'ruins=yes',
    });
    expect(siteSignal([object('node/1', { place: 'town' })])).toEqual({
      verdict: 'living', object: 'node/1', tag: 'place=town',
    });
    expect(siteSignal([object('relation/1', { boundary: 'administrative' })])).toEqual({
      verdict: 'none', object: null, tag: null,
    });
    expect(siteSignal([])).toEqual({ verdict: 'none', object: null, tag: null });
  });

  it('reads a mound, a tell and a geoglyph as ruins', () => {
    expect(siteSignal([object('way/1', { man_made: 'tell' })]).verdict).toBe('ruin');
    expect(siteSignal([object('way/2', { man_made: 'mound' })]).verdict).toBe('ruin');
    expect(siteSignal([object('way/3', { man_made: 'geoglyph' })]).verdict).toBe('ruin');
    expect(siteSignal([object('way/4', { man_made: 'pier' })]).verdict).toBe('none');
  });

  it('reads an island and a named spot as neither living nor ruin', () => {
    expect(siteSignal([object('relation/1', { place: 'island' })]).verdict).toBe('none');
    expect(siteSignal([object('node/1', { place: 'locality' })]).verdict).toBe('none');
  });

  it('takes the ruin polygon, the largest where there are several', () => {
    const small = 'POLYGON((0 0,1 0,1 1,0 0))';
    const large = 'POLYGON((0 0,1 0,1 1,0 1,0.5 0.5,0.25 0.25,0 0))';
    expect(siteExtent([
      object('way/1', { historic: 'archaeological_site' }, small),
      object('way/2', { historic: 'ruins' }, large),
    ])).toEqual({ ref: 'way/2', wkt: large });
  });

  it('takes the protected area over a ruin object that is a speck: the Nazca Lines', () => {
    // Q2620036's two real objects (`osm-tags.json`): relation/17435522 carries
    // historic=archaeological_site over one group of geoglyphs and measures
    // 0.0015 km², and relation/2729059 is the World Heritage protected zone
    // over the whole desert of lines at 774 km² (both areas measured on the dev
    // database on 2026-09-14 with the writer's own expression). A ruin-first
    // rule drew the speck. The rings below stand in for the tracings, ordered
    // as the real WKT lengths are — 9,055 characters against 41,913.
    const speck = 'POLYGON((-75.13 -14.72,-75.12 -14.72,-75.12 -14.71,-75.13 -14.72))';
    const zone = 'POLYGON((-75.31 -14.87,-75.05 -14.87,-75.05 -14.53,-75.31 -14.53,'
      + '-75.20 -14.60,-75.15 -14.70,-75.31 -14.87))';
    expect(siteExtent([
      object('relation/17435522', { historic: 'archaeological_site', man_made: 'geoglyph' }, speck),
      object('relation/2729059', { boundary: 'protected_area', heritage: '1' }, zone),
    ])).toEqual({ ref: 'relation/2729059', wkt: zone });
  });

  it('takes the designated zone over a larger box nobody designated: the Nazca reserve', () => {
    // The third real object at Nazca (the dev cache, 2026-09-14):
    // relation/12530031 is the outer archaeological reserve, four corners and
    // 5,638 km² by the writer's own expression, carrying no heritage
    // designation. By ground alone it would beat the 774 km² World Heritage
    // zone; the designation keeps the zone.
    const zone = 'POLYGON((-75.31 -14.87,-75.05 -14.87,-75.05 -14.53,-75.31 -14.53,-75.31 -14.87))';
    const reserve = 'POLYGON((-76.0 -15.5,-74.5 -15.5,-74.5 -14.0,-76.0 -14.0,-76.0 -15.5))';
    expect(siteExtent([
      object('relation/12530031', { boundary: 'protected_area' }, reserve),
      object('relation/2729059', { boundary: 'protected_area', heritage: '1' }, zone),
    ])).toEqual({ ref: 'relation/2729059', wkt: zone });
  });

  it('takes the most ground, not the most vertices: Sarmizegetusa Regia', () => {
    // Q739802's two objects (the dev cache, 2026-09-14): way/266554383 is a
    // castle traced in 3,217 characters over 0.006 km², way/258689243 the
    // archaeological site in 267 characters over 1 km². The length of the
    // text chose the speck.
    const speck = 'POLYGON((23.310 45.622,23.311 45.622,23.311 45.6225,23.3105 45.6228,'
      + '23.3102 45.6227,23.3101 45.6224,23.310 45.622))';
    const site = 'POLYGON((23.30 45.61,23.32 45.61,23.32 45.63,23.30 45.63,23.30 45.61))';
    expect(siteExtent([
      object('way/266554383', { historic: 'castle' }, speck),
      object('way/258689243', { historic: 'archaeological_site', ruins: 'yes' }, site),
    ])).toEqual({ ref: 'way/258689243', wkt: site });
  });

  it('draws a protected area, and never a city or an administrative outline', () => {
    const wkt = 'POLYGON((0 0,1 0,1 1,0 0))';
    expect(siteExtent([object('relation/1', { boundary: 'protected_area' }, wkt)]))
      .toEqual({ ref: 'relation/1', wkt });
    expect(siteExtent([object('relation/2', { boundary: 'administrative' }, wkt)])).toBeNull();
    expect(siteExtent([object('relation/3', { place: 'city' }, wkt)])).toBeNull();
  });

  it('takes no extent from a line or a point, whatever the tags say', () => {
    expect(siteExtent([
      object('way/1', { historic: 'archaeological_site' }, 'LINESTRING(0 0,1 1)'),
      object('node/1', { historic: 'ruins' }, 'POINT(0 0)'),
    ])).toBeNull();
  });
});

describe('what the final pass of #581 changed', () => {
  it('refuses Qiandao Lake: the dig is thirty metres under a reservoir', () => {
    // Q2470528, 22 sitelinks, P31 reservoir / archaeological site / Q6838244
    // (checked with wbgetentities on 2026-09-14), no World Heritage listing and
    // no population. Shi Cheng, the drowned city, is under the water a dam put
    // there in 1959; relation/162908 is tagged natural=water.
    const verdict = verdictOf(
      facts({ qid: 'Q2470528', classes: ['Q131681', 'Q839954', 'Q6838244'], sitelinks: 22 }),
      [object('relation/162908', { natural: 'water' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Qiandao Lake must be refused by name');
    expect(verdict.reason).toMatch(/^a reservoir/);
    expect(verdict.group).toBe('class-or-name');
  });

  it('refuses the Lop Desert, whose one mapped object is a memorial', () => {
    // Q620724, 22 sitelinks, P31 desert / archaeological site. Its only OSM
    // object is node/3640081430, historic=memorial — the one item in the whole
    // pool that tag decides, which is why `memorial` left RUIN_HISTORIC: a
    // memorial is a modern marker, and reading it as a ruin lifted the kill.
    const verdict = verdictOf(
      facts({ qid: 'Q620724', classes: ['Q8514', 'Q839954'], sitelinks: 22 }),
      [object('node/3640081430', { historic: 'memorial' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('the Lop Desert must be refused by name');
    expect(verdict.reason).toMatch(/^a desert/);
  });

  it('keeps both lifts on the widened natural kill: a ruin on it, or the Committee', () => {
    // Tadrart Acacus (Q308807) is the ruin lift and **is asked without its
    // World Heritage flag**, so the ruin object on it is the only thing that
    // can keep it: with the flag passed, the test could not tell the two lifts
    // apart. Tassili n'Ajjer (Q190048) is the other lift, a mountain range with
    // no ruin object that stays because the Committee listed it (World Heritage
    // 179 — the rock art is the reason to go). Without both, the widened list
    // would take the rock art along with the reservoirs.
    const acacus = verdictOf(
      facts({ qid: 'Q308807', classes: ['Q46831', 'Q839954'], sitelinks: 55 }),
      [object('node/7702655158', { historic: 'archaeological_site' })],
    );
    expect(acacus.pass).toBe(true);
    const listed = verdictOf(
      facts({ qid: 'Q190048', classes: ['Q46831', 'Q839954'], sitelinks: 69, worldHeritage: true }),
      [object('way/464707583', { natural: 'mountain_range' })],
    );
    expect(listed.pass).toBe(true);
  });

  it('refuses Acomita Lake: a census boundary is a counted population', () => {
    // Q342064, 25 sitelinks, P31 census-designated place (Q498162) /
    // archaeological site, P1082 416 and 339 (wbgetentities, 2026-09-14), with
    // relation/171143 tagged place=locality + boundary=census. North Acomita
    // Village (Q1237840), Skyline-Ganipa (Q2293403) and Sunrise (Q1836972) are
    // the same shape: read as named spots they walked in as digs.
    const verdict = verdictOf(
      facts({ qid: 'Q342064', classes: ['Q498162', 'Q839954'], sitelinks: 25, statesPopulation: true }),
      [object('relation/171143', {
        place: 'locality', boundary: 'census', name: 'Acomita Lake',
      })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Acomita Lake must be refused by name');
    expect(verdict.reason).toBe(
      'a living place — OSM maps a counted population here and Wikidata counts its people '
      + '(boundary=census on relation/171143)',
    );
    expect(verdict.group).toBe('living');
  });

  it('admits Carthage: somebody protects it and nobody is counted there', () => {
    // Q6343, 121 sitelinks, P31 city-state / emporium / ancient city — no site
    // class — and **no P1082 at all** (wbgetentities, 2026-09-14), with its one
    // real object, relation/8305288, carrying heritage=1 and nothing else this
    // kind reads. Demetrias (Q1150349, 25 sitelinks, ancient city,
    // relation/18138696 heritage=2, no population) is the pool's only other row
    // of this shape.
    const verdict = verdictOf(
      facts({ qid: 'Q6343', classes: ['Q133442', 'Q655593', 'Q15661340'], sitelinks: 121 }),
      [object('relation/8305288', { heritage: '1', name: 'موقع قرطاج الأثري' })],
    );
    expect(verdict.pass).toBe(true);
    if (!verdict.pass) return;
    expect(verdict.osm.verdict).toBe('none');
  });

  it('still refuses Syracuse, whose one object is the outline of a comune', () => {
    // Q13670, 120 sitelinks, classes tourist destination / big city / polis /
    // city / comune — no site class — and one OSM object in the measurement,
    // relation/39169, `boundary=administrative`. No weak tag, so the lift never
    // comes into it: the refusal counts the object and says it is not a ruin.
    // Syracuse is the step-4 known miss; Tyre, Sidon, Agrigento and Side are
    // refused a step earlier, as living places.
    const verdict = verdictOf(
      facts({ qid: 'Q13670', classes: ['Q515', 'Q148837'], sitelinks: 120, statesPopulation: true }),
      [object('relation/39169', { boundary: 'administrative', name: 'Siracusa' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Syracuse must be refused by name');
    expect(verdict.reason).toBe(
      'a city Wikidata files under archaeological sites, with no ruin on the map '
      + '(one OSM object carries it, and it is not a ruin)',
    );
  });

  it('refuses Tyre as the living city it is mapped as, not at step 4', () => {
    // Q82070, 103 sitelinks, P31 city / big city / ancient city / city-state —
    // no site class — population 160,000, and node/803018184 place=city beside
    // relation/12196423 boundary=administrative (wbgetentities and
    // `osm-tags.json`, 2026-09-14). Sidon (Q163490), Agrigento (Q13678) and
    // Side (Q152405, whose `archaeological site` statement is deprecated) read
    // the same way. Their card is the living-place sentence, which is what a
    // curator returning them from the kept-out card will be reading.
    const verdict = verdictOf(
      facts({ qid: 'Q82070', classes: ['Q515', 'Q1549591', 'Q15661340', 'Q133442'], sitelinks: 103, statesPopulation: true }),
      [object('node/803018184', { place: 'city', name: 'صور' }),
        object('relation/12196423', { boundary: 'administrative', name: 'صور' })],
    );
    expect(verdict.pass).toBe(false);
    if (verdict.pass || 'out' in verdict) throw new Error('Tyre must be refused by name');
    expect(verdict.reason).toBe(
      'a living place — OSM maps a town here and Wikidata counts its people '
      + '(place=city on node/803018184)',
    );
    expect(verdict.group).toBe('living');
  });

  it('no longer reads a Roman road as a ruin standing somewhere', () => {
    // Watling Street (Q1434239) and the Via Flaminia (Q374149) are the two
    // items `historic=roman_road` decided, and a 430 km road is not a place a
    // traveller stands in. The tag says nothing now: this item is judged by its
    // branch and its class, not by the road.
    expect(siteSignal([object('way/1', { historic: 'roman_road' })]).verdict).toBe('none');
  });
});
