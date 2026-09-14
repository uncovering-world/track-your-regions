/**
 * The world the archaeology pipeline's test runs against, and the fake door that
 * answers it.
 *
 * A file of its own for the reason `museum/pipelineFixture.ts` is one: a world
 * of museums and the finds they hold, with a stub that answers on the *shape* of
 * the query rather than on the order the calls arrive in. This pipeline sends
 * the public-art pool questions, the museum works questions and this kind's own
 * find facts, interleaved, and a positional stub cannot survive that. English
 * Wikipedia is a function the run is handed (`deps.categories`), so no category
 * is fetched here either.
 *
 * OpenStreetMap is handed over the same way (`deps.osm`): the fixture's `osm`
 * map is the measurement of 2026-09-14 for the four items it names — Troy's
 * excavation polygon (way/423938794), Athens' city node (node/441183),
 * Pompeii's locality node (node/4753980853) and Hadrian's Villa's outline
 * (way/152327656) — each with the object id and the tags recorded that day in
 * `data/cache/osm-sites/osm-tags.json`. The site rows' own facts were checked
 * against `wbgetentities` on 2026-09-14, the same day the site door was built.
 *
 * **Pompeii is in both doors and is one row.** Its article is filed under
 * `Archaeological museums in Italy`, so the category walk names it and the
 * museum door refuses it for carrying no museum class; its own classes are
 * `archaeological site, ancient city`, so the site door admits it. That is the
 * case the run has to get right: one entity, one answer, admitted as a site and
 * not reported as a refusal beside itself. Hadrian's Villa is the same shape
 * through the other rule — the park veto turns it away as "a site, not a
 * museum", and this is the door that was meant.
 *
 * The QIDs are real and were verified with `wbgetentities` on 2026-09-13 — the
 * classes, the sitelink counts, the coordinates, the enwiki titles and the
 * statements each find carries (the Rosetta Stone is the British Museum's; the
 * Venus de' Medici the Uffizi's; the Charioteer the Delphi museum's; the
 * Laocoön belongs to the Pio-Clementino museum, which is `P361` the Vatican
 * Museums 86 m away and has no English article at all). The rows the category
 * walk alone names — the Bardo, the Zeugma Mosaic Museum, Pompeii and the Gold
 * Museum — were checked the same day against the Action API as well: all four
 * articles are filed under `Archaeological museums in <country>`, Wikidata
 * types the three museums `museum` and nothing more, and Pompeii
 * `archaeological site, ancient city` and no museum at all.
 *
 * Five things are this fixture's own, and each is a case the rule needs:
 *   - **Hadrian's Villa's place on the editorial shelf**. Its classes, count and
 *     coordinates are real (`archaeological site, archaeological park`, 52
 *     languages, Tivoli), and the park class is what matters: Wikidata files it
 *     under `archaeological museum` and so under `museum`, so this row *passes*
 *     the museum-class gate and only the park veto turns it away. A park no
 *     category named would never reach that gate at all (#887);
 *   - the **Venus of Buret'** is raised from 9 sitelinks to 25 and given a
 *     `P195` on the Hermitage. The Mal'ta–Buret' figurines are in the
 *     Hermitage's Paleolithic collection, but the item states no collection and
 *     at 9 sitelinks it is under the pool's own floor — and this kind judges the
 *     Hermitage only as the holder of a find above the line;
 *   - the **Louvre's categories** are its art ones alone. Its article carries
 *     `Archaeological museums in France` too, which would answer the nature
 *     question before its class ever did; left out, the Louvre is what the class
 *     door admits on its own;
 *   - the **Gold Museum's row** answers without the English sitelink its
 *     article plainly has, which is the shape of a `wikibase_item` the two
 *     reads disagree about: the walk finds an article, and the row the by-id
 *     question answers with carries none;
 *   - the **Pompeii Lakshmi's `P276`** names Pompeii, where the statuette is
 *     really in the Naples museum. It stands for a find the source places on
 *     the dig itself, which is what puts a classless site into the venue graph
 *     — and being in that graph must not excuse it from the museum-class gate.
 *
 * The **Vatican Museums** carry what their article carries — `Museums of ancient
 * Greece` and `Museums of ancient Rome`, department categories both — and they
 * are the survivor of a real fold, so two of the tests replace those categories
 * to ask what the fold filter does with the other answers a nature can give.
 */

import { LOST_WORK_ROOT } from '../museum/worksCollector.js';
import { POOL_MIN_SITELINKS } from '../publicArt/queries.js';
import {
  ARCHAEOLOGICAL_PARK,
  ARTEFACT_ROOT,
  NATURAL_HISTORY_ROOT,
} from './classes.js';
import type { OsmObject } from '../osm/types.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#NormalRank';
const uri = (qid: string) => ({ value: `${ENTITY}${qid}` });

// Classes: real, labels verified with wbgetentities on 2026-09-13.
export const MUSEUM = 'Q33506'; // museum
export const ART_MUSEUM = 'Q207694'; // art museum
export const NATIONAL_MUSEUM = 'Q17431399'; // national museum
export const ARCHAEOLOGICAL_MUSEUM = 'Q3329412'; // archaeological museum
const EGYPTOLOGICAL_MUSEUM = 'Q3330834'; // egyptological museum
export const PALACE = 'Q16560'; // palace
export const ARCHAEOLOGICAL_SITE = 'Q839954'; // archaeological site
const ANCIENT_CITY = 'Q15661340'; // ancient city
const SETTLEMENT_SITE = 'Q1708422'; // settlement site — under both roots
const CITY_STATE = 'Q133442'; // city-state
const FREE_CITY = 'Q5500203'; // free city — how Athens reaches the site tree
const SHIPWRECK = 'Q852190'; // shipwreck
const HUMAN_SETTLEMENT = 'Q486972'; // human settlement
const STEAMSHIP = 'Q12859788'; // steamship — the Titanic's other class
const SCULPTURE = 'Q860861'; // sculpture
const STATUE = 'Q179700'; // statue
const GROUP_OF_SCULPTURES = 'Q2293362'; // group of sculptures
const STELE = 'Q178743'; // stele
const BILINGUAL_INSCRIPTION = 'Q861809'; // bilingual inscription
const VENUS_FIGURINE = 'Q248726'; // Venus figurine

interface FixtureMuseum {
  label: string;
  /** Every `P31` it carries. */
  classes: string[];
  sitelinks: number;
  lat: number;
  lon: number;
  description?: string;
  imageUrl?: string;
  countryLabel?: string;
  website?: string;
  articleUrl?: string;
  /** What English Wikipedia's categories say about it, as `deps.categories` answers. */
  categories?: string[];
  /**
   * Whether the walk down `Archaeological museums by country` names its
   * article, as `deps.categoryMembers` answers: true of every museum whose
   * article is filed under the tree, whatever else already knows it.
   */
  inNatureCategories?: boolean;
  /**
   * Whether Wikidata answers about it *without* the English sitelink, though
   * the walk found the article: the row comes back with no `article` binding
   * and the museum is left unjudged (`readMembers`).
   */
  articleGoneFromWikidata?: boolean;
  /** `P361`: what it is part of. */
  parents?: string[];
}

interface FixtureFind {
  label: string;
  sitelinks: number;
  /** The narrow class a `VALUES ?cls` batch matches it under, with the label that batch returns. */
  cls: string;
  clsLabel: string;
  /** The broad root whose fame bands answer with it. Those rows bind no class. */
  broadRoot?: string;
  year?: number;
  /** Every `P31` the item carries, as the find facts answer. */
  classes?: string[];
  /** `P189`, with the name a reader sees. */
  discovery?: { qid: string; label: string };
  statements: { property: 'P195' | 'P276'; venue: string }[];
}

/** A site candidate: what the pool answers, and what the item says about itself. */
interface FixtureSite {
  label: string;
  /** Every `P31` it carries. */
  classes: string[];
  sitelinks: number;
  lat: number;
  lon: number;
  description?: string;
  countryLabel?: string;
  articleUrl?: string;
  imageUrl?: string;
  /** `P757`, or `P1435` naming World Heritage. */
  worldHeritage?: boolean;
  /** `P1082` — any number, 0 included. */
  statesPopulation?: boolean;
}

/** One OSM object carrying `wikidata=<item>`, as the reader hands it over. */
interface FixtureOsmObject {
  ref: string;
  tags: Record<string, string>;
  wkt?: string;
}

export interface World {
  museums: Record<string, FixtureMuseum>;
  finds: Record<string, FixtureFind>;
  sites: Record<string, FixtureSite>;
  /** What OpenStreetMap maps at each item, by QID. */
  osm: Record<string, FixtureOsmObject[]>;
  /** What `?c wdt:P279* wd:<root>` answers. A root not named here answers with itself alone. */
  trees: Record<string, string[]>;
  /** Direct `P279` children, for the finds closure. */
  children: Record<string, string[]>;
}

const WORLD: World = {
  museums: {
    Q19675: {
      label: 'Louvre Museum', classes: [ART_MUSEUM, ARCHAEOLOGICAL_MUSEUM], sitelinks: 169,
      lat: 48.86111, lon: 2.33583, description: 'art and archeology museum in Paris, France',
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Louvre.jpg',
      countryLabel: 'France', website: 'https://www.louvre.fr',
      articleUrl: 'https://en.wikipedia.org/wiki/Louvre',
      categories: ['Art museums and galleries in Paris'],
    },
    // The canon the class misses: `art museum, national museum` on Wikidata,
    // and `Archaeological museums in London` on its article.
    Q6373: {
      label: 'British Museum', classes: [ART_MUSEUM, NATIONAL_MUSEUM, MUSEUM], sitelinks: 109,
      lat: 51.51944, lon: -0.12694, description: 'national museum in London, United Kingdom',
      countryLabel: 'United Kingdom',
      articleUrl: 'https://en.wikipedia.org/wiki/British_Museum',
      categories: ['Archaeological museums in London', 'Art museums and galleries in London'],
      inNatureCategories: true,
    },
    // The canon the class misses *and* no find carries: `museum` on Wikidata
    // at 35 sitelinks, `Archaeological museums in Tunisia` on its article, and
    // not one of its mosaics is famous enough to be a find. Nothing but the
    // walk down the categories brings it into this run at all.
    Q1429003: {
      label: 'Bardo National Museum', classes: [MUSEUM], sitelinks: 35,
      lat: 36.80944, lon: 10.13444, countryLabel: 'Tunisia',
      articleUrl: 'https://en.wikipedia.org/wiki/Bardo_National_Museum_(Tunis)',
      categories: [
        'Archaeological museums in Tunisia', 'Museums of ancient Greece', 'Museums of ancient Rome',
      ],
      inNatureCategories: true,
    },
    // What else the editors file under those categories: the dig itself.
    // Pompeii carries `Archaeological museums in Italy` beside its own
    // `Archaeological sites in Italy`, is known in 122 languages, and Wikidata
    // types it `archaeological site, ancient city` — no museum class at all.
    // Admitted, it would be a museum pin on an ancient city; it belongs to the
    // site door (ADR-0058 decision 4), and until that door exists the run says
    // so by name. Its `Archaeological parks` category vetoes nothing: the park
    // veto reads Wikidata's class tree, and no class of Pompeii is in it.
    Q43332: {
      label: 'Pompeii', classes: [ARCHAEOLOGICAL_SITE, ANCIENT_CITY], sitelinks: 122,
      lat: 40.750556, lon: 14.489722, countryLabel: 'Italy',
      description: 'ancient Roman city near modern Naples, Italy',
      articleUrl: 'https://en.wikipedia.org/wiki/Pompeii',
      categories: [
        'Archaeological museums in Italy', 'Archaeological parks',
        'Archaeological sites in Italy', 'Museums of ancient Rome in Italy',
      ],
      inNatureCategories: true,
    },
    // The same shelf, the same kind of row, and nobody has heard of it: the
    // Tunisia category holds Mactaris beside the Bardo, an archaeological site
    // known in 7 languages. Above the line a site is worth naming, because the
    // site door will want the list; down here naming every one of them is the
    // long tail that buries a curator's real refusals, so it is simply out.
    Q3485394: {
      label: 'Mactaris', classes: [ARCHAEOLOGICAL_SITE], sitelinks: 7,
      lat: 35.8556, lon: 9.20639, countryLabel: 'Tunisia',
      description: 'archaeological site in Tunisia',
      articleUrl: 'https://en.wikipedia.org/wiki/Makthar_(archaeological_site)',
      categories: [
        'Archaeological museums in Tunisia', 'Phoenician colonies in Tunisia',
        'Roman towns and cities in Tunisia',
      ],
      inNatureCategories: true,
    },
    // The third of the canon the class misses, here for the oddity rather than
    // for the canon: the walk finds its article and Wikidata answers about the
    // item without the English sitelink (this fixture's own). With no article
    // there are no categories to read, and its bare `museum` class would have
    // it refused by name for a fact nobody stated — so it is not judged at all.
    Q1109031: {
      label: 'Gold Museum', classes: [MUSEUM], sitelinks: 28,
      lat: 4.60192, lon: -74.072, countryLabel: 'Colombia',
      description: 'pre-Columbian archaeology museum in Bogota, Colombia',
      articleUrl: 'https://en.wikipedia.org/wiki/Gold_Museum,_Bogot%C3%A1',
      categories: ['Archaeological museums in Colombia'],
      inNatureCategories: true,
      articleGoneFromWikidata: true,
    },
    // The same shape below the place line: the walk names it, and 20 articles
    // against a line of 22 leave it out — with no rule to report, since the
    // source has never admitted it.
    Q196982: {
      label: 'Zeugma Mosaic Museum', classes: [MUSEUM], sitelinks: 20,
      lat: 37.074881, lon: 37.386158, countryLabel: 'Turkey',
      articleUrl: 'https://en.wikipedia.org/wiki/Zeugma_Mosaic_Museum',
      categories: ['Archaeological museums in Turkey', 'Art museums and galleries in Turkey'],
      inNatureCategories: true,
    },
    // An art museum with one ancient statue: the row ADR-0058 decision 2 exists
    // to refuse.
    Q51252: {
      label: 'Uffizi Gallery', classes: [ART_MUSEUM, PALACE], sitelinks: 73,
      lat: 43.76833, lon: 11.25528, articleUrl: 'https://en.wikipedia.org/wiki/Uffizi',
      categories: ['Art museums and galleries in Florence'],
    },
    // A department, not a nature: among the world's best antiquities, and
    // visited as an art museum. A curator answers this one.
    Q132783: {
      label: 'Hermitage Museum', classes: [ART_MUSEUM, MUSEUM], sitelinks: 86,
      lat: 59.94056, lon: 30.31361, countryLabel: 'Russia',
      articleUrl: 'https://en.wikipedia.org/wiki/Hermitage_Museum',
      categories: ['Egyptological collections in Russia'],
    },
    // 15 sitelinks, under the place line: what admits it is the Charioteer.
    Q636928: {
      label: 'Delphi Archaeological Museum', classes: [ARCHAEOLOGICAL_MUSEUM], sitelinks: 15,
      lat: 38.48029, lon: 22.49984, countryLabel: 'Greece',
      articleUrl: 'https://en.wikipedia.org/wiki/Delphi_Archaeological_Museum',
      categories: ['Archaeological museums in Greece'],
      inNatureCategories: true,
    },
    // An archaeological museum by class with no English article at all, housed
    // in the Vatican Museums 86 m away and known to a tenth as many languages:
    // the fold rule hands its Laocoön to the museum around it.
    Q1439912: {
      label: 'Pio-Clementino museum', classes: [ART_MUSEUM, ARCHAEOLOGICAL_MUSEUM], sitelinks: 10,
      lat: 41.90673, lon: 12.45351, parents: ['Q182955'],
    },
    // The row the park veto exists for, and the one case the class door and the
    // category door both have to be asked about. Hadrian's Villa is
    // `archaeological site, archaeological park` on Wikidata (verified with
    // wbgetentities on 2026-09-14, 52 sitelinks, Tivoli), and Wikidata files
    // `archaeological park` under `archaeological museum` and so under `museum`
    // — so the museum-class gate *passes* it and only the park veto turns it
    // away. Its place on the editorial shelf is this fixture's own, standing for
    // the parks the editors really do file there (Pompeii above is the measured
    // case): a park no category named would be refused by the veto without the
    // gate ever being reached, which is not the question this row asks.
    Q272777: {
      label: 'Hadrian\'s Villa', classes: [ARCHAEOLOGICAL_SITE, ARCHAEOLOGICAL_PARK],
      sitelinks: 52, lat: 41.941944, lon: 12.775278, countryLabel: 'Italy',
      description: 'archaeological complex in Tivoli, Italy',
      articleUrl: 'https://en.wikipedia.org/wiki/Hadrian%27s_Villa',
      categories: ['Archaeological museums in Italy', 'Archaeological parks'],
      inNatureCategories: true,
    },
    Q182955: {
      label: 'Vatican Museums', classes: [ART_MUSEUM, NATIONAL_MUSEUM], sitelinks: 64,
      lat: 41.90639, lon: 12.45444,
      articleUrl: 'https://en.wikipedia.org/wiki/Vatican_Museums',
      categories: ['Museums of ancient Greece', 'Museums of ancient Rome'],
    },
  },
  finds: {
    Q48584: {
      label: 'Rosetta Stone', sitelinks: 101, cls: STELE, clsLabel: 'stele',
      classes: [STELE, BILINGUAL_INSCRIPTION],
      discovery: { qid: 'Q3077898', label: 'Fort Julien' },
      statements: [{ property: 'P195', venue: 'Q6373' }, { property: 'P276', venue: 'Q6373' }],
    },
    Q774967: {
      label: "Venus de' Medici", sitelinks: 25, cls: STATUE, clsLabel: 'statue', broadRoot: STATUE,
      year: -100, classes: [STATUE],
      statements: [{ property: 'P195', venue: 'Q51252' }, { property: 'P276', venue: 'Q51252' }],
    },
    Q2513086: {
      label: "Venus of Buret'", sitelinks: 25, cls: VENUS_FIGURINE, clsLabel: 'Venus figurine',
      classes: [VENUS_FIGURINE, GROUP_OF_SCULPTURES],
      discovery: { qid: 'Q6585', label: 'Irkutsk Oblast' },
      statements: [{ property: 'P195', venue: 'Q132783' }],
    },
    Q1230882: {
      label: 'Charioteer of Delphi', sitelinks: 26, cls: STATUE, clsLabel: 'statue',
      broadRoot: STATUE, year: -470, classes: [STATUE],
      discovery: { qid: 'Q75459', label: 'Delphi' },
      statements: [{ property: 'P195', venue: 'Q636928' }, { property: 'P276', venue: 'Q636928' }],
    },
    // A real find of Pompeii, standing in the fixture for one the source places
    // *in situ*: its `P276` names the dig itself (this fixture's own — the
    // statuette is in Naples), which is how a classless site gets into the
    // venue graph at all. It is kept as a find by its discovery place, and the
    // venue rule refuses Pompeii, so it is placed nowhere.
    Q24269542: {
      label: 'Pompeii Lakshmi', sitelinks: 19, cls: SCULPTURE, clsLabel: 'sculpture',
      broadRoot: SCULPTURE, classes: [SCULPTURE],
      discovery: { qid: 'Q43332', label: 'Pompeii' },
      statements: [{ property: 'P276', venue: 'Q43332' }],
    },
    Q465762: {
      label: 'Laocoön and His Sons', sitelinks: 47, cls: SCULPTURE, clsLabel: 'sculpture',
      broadRoot: SCULPTURE, year: -40, classes: [SCULPTURE, GROUP_OF_SCULPTURES],
      discovery: { qid: 'Q220', label: 'Rome' },
      statements: [
        { property: 'P195', venue: 'Q1439912' }, { property: 'P276', venue: 'Q1439912' },
      ],
    },
  },
  sites: {
    // Wikidata types Troy a settlement four times over and never a dig; OSM
    // has the excavations as a polygon. The row the site door exists for.
    Q22647: {
      label: 'Troy', classes: [CITY_STATE, SETTLEMENT_SITE], sitelinks: 121,
      lat: 39.9575, lon: 26.238889, countryLabel: 'Turkey',
      description: 'ancient city in Anatolia',
      articleUrl: 'https://en.wikipedia.org/wiki/Troy',
      worldHeritage: true,
    },
    // 288 languages, no site class, 643,452 people, and a place=city node.
    Q1524: {
      label: 'Athens', classes: [FREE_CITY], sitelinks: 288,
      lat: 37.984167, lon: 23.728056, countryLabel: 'Greece',
      articleUrl: 'https://en.wikipedia.org/wiki/Athens',
      statesPopulation: true,
    },
    // In the tree, 160 languages, and not a place anybody stands in.
    Q25173: {
      label: 'Titanic', classes: [STEAMSHIP, SHIPWRECK], sitelinks: 160,
      lat: 41.7325, lon: -49.946944,
      articleUrl: 'https://en.wikipedia.org/wiki/Titanic',
    },
  },
  osm: {
    Q22647: [{
      ref: 'way/423938794',
      tags: {
        historic: 'archaeological_site', archaeological_site: 'city',
        heritage: '1', tourism: 'attraction', boundary: 'protected_area',
      },
      wkt: 'POLYGON((26.23 39.95,26.24 39.95,26.24 39.96,26.23 39.96,26.23 39.95))',
    }],
    Q1524: [{ ref: 'node/441183', tags: { place: 'city', name: 'Αθήνα' } }],
    // The measured object of Pompeii, whose row lives under `museums` because
    // the category walk names it: a named spot, not a town.
    Q43332: [{ ref: 'node/4753980853', tags: { place: 'locality', name: 'Pompei Antica' } }],
    // Hadrian's Villa as OSM really maps it: one way carrying the excavation's
    // outline, two ruin signals at once (`historic` and `ruins=yes`) and the
    // secondary key naming what kind of dig it is. The row matters here because
    // it is the museum door's refusal *and* the site door's admission in one
    // entity, and with no object it entered as a site by class alone — so the
    // fixture never exercised a second extent beside Troy's, nor a ruin verdict
    // on a row the other door had just turned away.
    Q272777: [{
      ref: 'way/152327656',
      tags: {
        historic: 'archaeological_site',
        archaeological_site: 'roman_villa',
        ruins: 'yes',
        tourism: 'attraction',
        name: 'Villa Adriana',
      },
      wkt: 'POLYGON((12.77 41.94,12.78 41.94,12.78 41.95,12.77 41.95,12.77 41.94))',
    }],
  },
  trees: {
    // Wikidata files `archaeological park` under `archaeological museum`, which
    // is why the park tree is walked and subtracted (`buildArchaeologyTrees`).
    [ARCHAEOLOGICAL_MUSEUM]: [ARCHAEOLOGICAL_MUSEUM, ARCHAEOLOGICAL_PARK],
    [EGYPTOLOGICAL_MUSEUM]: [EGYPTOLOGICAL_MUSEUM],
    [ARCHAEOLOGICAL_PARK]: [ARCHAEOLOGICAL_PARK],
    [NATURAL_HISTORY_ROOT]: [NATURAL_HISTORY_ROOT],
    [ARTEFACT_ROOT]: [ARTEFACT_ROOT],
    // What a venue may be, for the shared collector's rule. The park is in it
    // because Wikidata really files `archaeological park` under `archaeological
    // museum` and so under `museum` (which is why `buildArchaeologyTrees` walks
    // the park tree and subtracts it): without it here, a park reaching the
    // category door would be refused for carrying no museum class, and the park
    // veto — the rule that actually turns it away — would never be asked (#887).
    [MUSEUM]: [
      MUSEUM, ART_MUSEUM, NATIONAL_MUSEUM, ARCHAEOLOGICAL_MUSEUM, EGYPTOLOGICAL_MUSEUM,
      ARCHAEOLOGICAL_PARK,
    ],
    // The site door's three trees. Real edges, each asked of Wikidata on
    // 2026-09-14: `settlement site`, `free city`, `ancient city` and
    // `archaeological park` are under `archaeological site`; `settlement site`,
    // `free city`, `ancient city` and `city-state` are under `human
    // settlement` — which is precisely why the map is asked, since the two
    // trees overlap on the classes Troy carries. `city-state` is under the
    // settlement root alone, and `shipwreck` under the site root alone.
    [ARCHAEOLOGICAL_SITE]: [
      ARCHAEOLOGICAL_SITE, SETTLEMENT_SITE, FREE_CITY, ANCIENT_CITY, ARCHAEOLOGICAL_PARK, SHIPWRECK,
    ],
    [HUMAN_SETTLEMENT]: [HUMAN_SETTLEMENT, SETTLEMENT_SITE, CITY_STATE, FREE_CITY, ANCIENT_CITY],
    [SHIPWRECK]: [SHIPWRECK],
    // The lost tree (#868): nothing here is under it.
    [LOST_WORK_ROOT]: [LOST_WORK_ROOT, 'Q21745157'],
  },
  children: {},
};

export const world = (): World => structuredClone(WORLD);

const askedFor = (query: string): string[] => [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);

function bandOf(query: string): { min: number; max: number | null } {
  const bounded = /FILTER\(\?sl >= (\d+) && \?sl < (\d+)\)/.exec(query);
  if (bounded) return { min: Number(bounded[1]), max: Number(bounded[2]) };
  const open = /FILTER\(\?sl >= (\d+)\)/.exec(query);
  if (!open) throw new Error(`pool query with no band: ${query}`);
  return { min: Number(open[1]), max: null };
}

const inBand = (sitelinks: number, band: { min: number; max: number | null }): boolean =>
  sitelinks >= band.min && (band.max === null || sitelinks < band.max);

/** Everything the two pools may answer with, museums and sites in one map. */
function poolEntities(w: World): [string, FixtureMuseum | FixtureSite][] {
  return [...Object.entries(w.museums), ...Object.entries(w.sites)];
}

function entityRow(qid: string, entity: FixtureMuseum | FixtureSite): SparqlBinding {
  const row: SparqlBinding = {
    e: uri(qid),
    eLabel: { value: entity.label },
    sl: { value: String(entity.sitelinks) },
    coord: { value: `Point(${entity.lon} ${entity.lat})` },
  };
  if (entity.description) row.eDescription = { value: entity.description };
  if (entity.imageUrl) row.img = { value: entity.imageUrl };
  if (entity.countryLabel) row.countryLabel = { value: entity.countryLabel };
  if ('website' in entity && entity.website) row.site = { value: entity.website };
  // The walk knows the article; Wikidata's row may not carry the sitelink.
  const gone = 'articleGoneFromWikidata' in entity && entity.articleGoneFromWikidata;
  if (entity.articleUrl && !gone) row.article = { value: entity.articleUrl };
  return row;
}

/**
 * A pool of entities: by id, by a batch of narrow classes, or one fame band of
 * a broad root.
 *
 * One function for both doors, because both send the public-art pool's own
 * questions and the classes they ask for are what tells the answers apart —
 * which is exactly how the real endpoint tells them apart.
 */
function entityPoolRows(w: World, query: string, asked: string[]): SparqlBinding[] {
  const entities = poolEntities(w);
  if (query.includes('VALUES ?e')) {
    return entities.filter(([qid]) => asked.includes(qid)).map(([qid, e]) => entityRow(qid, e));
  }
  const root = /\?e wdt:P31 wd:(Q\d+)/.exec(query);
  if (root) {
    const band = bandOf(query);
    return entities
      .filter(([, e]) => e.classes.includes(root[1]) && inBand(e.sitelinks, band))
      .map(([qid, e]) => entityRow(qid, e));
  }
  if (!query.includes('VALUES ?cls')) throw new Error(`unexpected pool: ${query}`);
  return entities
    .filter(([, e]) => e.sitelinks >= POOL_MIN_SITELINKS && e.classes.some((c) => asked.includes(c)))
    .map(([qid, e]) => entityRow(qid, e));
}

function findRow(qid: string, find: FixtureFind, withClass: boolean): SparqlBinding {
  const row: SparqlBinding = {
    w: uri(qid), wLabel: { value: find.label }, sl: { value: String(find.sitelinks) },
  };
  if (withClass) {
    row.cls = uri(find.cls);
    row.clsLabel = { value: find.clsLabel };
  }
  if (find.year !== undefined) row.year = { value: String(find.year) };
  return row;
}

/** A pool of finds: a batch of narrow classes, or one fame band of one broad root. */
function findPoolRows(w: World, query: string, asked: string[]): SparqlBinding[] {
  const finds = Object.entries(w.finds);
  if (query.includes('VALUES ?cls')) {
    return finds.filter(([, f]) => asked.includes(f.cls) && f.sitelinks >= POOL_MIN_SITELINKS)
      .map(([qid, f]) => findRow(qid, f, true));
  }
  const root = /\?w wdt:P31 wd:(Q\d+)/.exec(query);
  if (!root) throw new Error(`unexpected find pool: ${query}`);
  const band = bandOf(query);
  return finds.filter(([, f]) => f.broadRoot === root[1] && inBand(f.sitelinks, band))
    .map(([qid, f]) => findRow(qid, f, false));
}

/** What each find of a batch is, and where it was dug up. */
function findFactRows(w: World, asked: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of asked) {
    const find = w.finds[qid];
    if (!find) continue;
    for (const cls of find.classes ?? []) rows.push({ w: uri(qid), cls: uri(cls) });
    if (find.discovery) {
      rows.push({
        w: uri(qid),
        disc: uri(find.discovery.qid),
        discLabel: { value: find.discovery.label },
      });
    }
  }
  return rows;
}

/** The venue statements of a batch: what each of its finds says about where it is. */
function statementRows(w: World, asked: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of asked) {
    for (const statement of w.finds[qid]?.statements ?? []) {
      rows.push({
        w: uri(qid),
        rel: { value: statement.property },
        venue: uri(statement.venue),
        rank: { value: RANK },
      });
    }
  }
  return rows;
}

const detailRows = (w: World, asked: string[]): SparqlBinding[] =>
  asked.filter((qid) => w.museums[qid]).map((qid) => entityRow(qid, w.museums[qid]));

/** What the site rule reads off each item: classes, the listing, the population. */
function siteFactRows(w: World, asked: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of asked) {
    const entity = w.sites[qid] ?? w.museums[qid];
    if (!entity) continue;
    for (const cls of entity.classes) rows.push({ e: uri(qid), cls: uri(cls) });
    if ('worldHeritage' in entity && entity.worldHeritage) {
      rows.push({ e: uri(qid), whc: { value: '849' } });
    }
    if ('statesPopulation' in entity && entity.statesPopulation) {
      rows.push({ e: uri(qid), pop: { value: '643452' } });
    }
  }
  return rows;
}

/**
 * What an entity is and is part of. One answer serves both questions that ask
 * it — the museum import's edges and the public-art facts — since both bind the
 * same columns (`?cls`, `?parent`) to the same entity.
 */
const edgeRows = (w: World, asked: string[]): SparqlBinding[] =>
  asked.flatMap((qid) => {
    const museum = w.museums[qid];
    if (!museum) return [];
    return [
      ...museum.classes.map((c) => ({ e: uri(qid), cls: uri(c) })),
      ...(museum.parents ?? []).map((p) => ({ e: uri(qid), parent: uri(p) })),
    ];
  });

export function answer(w: World, sent: string): SparqlBinding[] {
  const query = sent.trimStart();
  const asked = askedFor(query);
  const tree = /wdt:P279\* wd:(Q\d+)/.exec(query);
  if (tree) return (w.trees[tree[1]] ?? [tree[1]]).map((c) => ({ c: uri(c) }));
  if (query.includes('?c wdt:P279 ?p')) {
    return asked.flatMap((p) => w.children[p] ?? []).map((c) => ({ c: uri(c) }));
  }
  // The site facts, which are the only question binding `?whc`.
  if (query.includes('?whc')) return siteFactRows(w, asked);
  // Before the statements question: the public-art facts question reads a
  // collection through `p:P195` too, and names `?coll` where the other does not.
  if (query.includes('?coll')) return edgeRows(w, asked);
  if (query.includes('?disc')) return findFactRows(w, asked);
  if (query.includes('p:P195')) return statementRows(w, asked);
  if (query.includes('SELECT ?e ?cls ?parent ?loc')) return edgeRows(w, asked);
  if (query.includes('?dissolved')) return detailRows(w, asked);
  if (query.includes('SELECT ?w')) return findPoolRows(w, query, asked);
  return entityPoolRows(w, query, asked);
}

/** The enwiki title of an article URL, the other side of `enwikiTitleOf`. */
const titleOf = (articleUrl: string): string =>
  decodeURIComponent(articleUrl.split('/wiki/')[1]).replace(/_/g, ' ');

/**
 * English Wikipedia as this run is handed it: both questions, and what was asked
 * of each.
 *
 * `categories` is what an article the run already holds is filed under;
 * `categoryMembers` is the walk down the category tree, which answers with the
 * article titles under it and the Wikidata item each is about — title to QID,
 * the shape `fetchCategoryMembers` returns.
 */
export function categoryDoor(w: World) {
  const byTitle = new Map<string, string[]>();
  const members = new Map<string, string>();
  for (const [qid, museum] of Object.entries(w.museums)) {
    if (!museum.articleUrl) continue;
    byTitle.set(titleOf(museum.articleUrl), museum.categories ?? []);
    if (museum.inNatureCategories) members.set(titleOf(museum.articleUrl), qid);
  }
  const calls: string[][] = [];
  const categories = (titles: string[]): Promise<Map<string, string[]>> => {
    calls.push(titles);
    return Promise.resolve(new Map(titles.map((t) => [t, byTitle.get(t) ?? []])));
  };
  const walks: number[] = [];
  const categoryMembers = (): Promise<Map<string, string>> => {
    walks.push(members.size);
    return Promise.resolve(new Map(members));
  };
  return { categories, calls, categoryMembers, walks };
}

/**
 * OpenStreetMap as this run is handed it: one call, answering for every item it
 * was asked about — an empty list where OSM maps nothing, never a missing key.
 */
export function osmDoor(w: World) {
  const calls: string[][] = [];
  const read = (qids: string[]): Promise<Map<string, OsmObject[]>> => {
    calls.push([...qids]);
    return Promise.resolve(new Map(qids.map((qid) => [qid, (w.osm[qid] ?? []).map((o) => ({
      ref: o.ref,
      kind: o.ref.split('/')[0] as OsmObject['kind'],
      tags: o.tags,
      geometryType: o.wkt ? o.wkt.slice(0, o.wkt.indexOf('(')) : null,
      wkt: o.wkt ?? null,
    }))])));
  };
  return { read, calls };
}
