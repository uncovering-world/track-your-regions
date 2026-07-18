import { describe, it, expect } from 'vitest';
import { deriveCanon, slugify } from './rules.js';
import type { NeCountryFeature, NeDisputedFeature, WikidataCountryRow } from './types.js';

function wd(over: Partial<WikidataCountryRow>): WikidataCountryRow {
  return {
    qid: 'Q0', label: 'X', iso2: null, iso3: null, isoNumeric: null,
    isUnMember: false, hasLimitedRecognition: false, sovereignQid: null, claimedByQids: [],
    ...over,
  };
}
const GEO = { type: 'MultiPolygon', coordinates: [] };
function nec(over: Partial<NeCountryFeature>): NeCountryFeature {
  return { name: 'X', iso2: null, iso3: null, sovIso3: null, type: 'Country', wikidataQid: null, geometry: GEO, ...over };
}
function ned(over: Partial<NeDisputedFeature>): NeDisputedFeature {
  return { name: 'X', note: null, sovIso3: null, type: 'Disputed', wikidataQid: null, geometry: GEO, ...over };
}

const FRANCE = wd({ qid: 'Q142', label: 'France', iso2: 'FR', iso3: 'FRA', isoNumeric: 250, isUnMember: true });
const DENMARK = wd({ qid: 'Q35', label: 'Denmark', iso2: 'DK', iso3: 'DNK', isUnMember: true });
const GREENLAND = wd({ qid: 'Q223', label: 'Greenland', iso2: 'GL', iso3: 'GRL', sovereignQid: 'Q35' });
const VATICAN = wd({ qid: 'Q237', label: 'Vatican City', iso2: 'VA', iso3: 'VAT' });
const ANTARCTICA = wd({ qid: 'Q51', label: 'Antarctica', iso2: 'AQ', iso3: 'ATA' });
const SERBIA = wd({ qid: 'Q403', label: 'Serbia', iso2: 'RS', iso3: 'SRB', isUnMember: true });
const KOSOVO = wd({ qid: 'Q1246', label: 'Kosovo', iso2: 'XK', hasLimitedRecognition: true, claimedByQids: ['Q403'] });
const UKRAINE = wd({ qid: 'Q212', label: 'Ukraine', iso2: 'UA', iso3: 'UKR', isUnMember: true });
const RUSSIA = wd({ qid: 'Q159', label: 'Russia', iso2: 'RU', iso3: 'RUS', isUnMember: true });

function derive(extra: {
  wikidata?: WikidataCountryRow[]; neCountries?: NeCountryFeature[]; neDisputed?: NeDisputedFeature[];
} = {}) {
  return deriveCanon({
    wikidata: extra.wikidata ?? [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA],
    neCountries: extra.neCountries ?? [nec({ name: 'Kosovo', iso3: 'KOS', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
    neDisputed: extra.neDisputed ?? [],
    exceptions: [],
  });
}

describe('deriveCanon — classes (rule 2)', () => {
  it('classifies by the published class rule, with Antarctica falling out as special', () => {
    const d = derive();
    const byslug = new Map(d.countries.map((c) => [c.slug, c]));
    expect(byslug.get('fr')?.class).toBe('un_member');
    expect(byslug.get('va')?.class).toBe('un_observer');
    expect(byslug.get('xk')?.class).toBe('de_facto');
    expect(byslug.get('gl')?.class).toBe('territory');
    expect(byslug.get('gl')?.sovereignSlug).toBe('dk');
    expect(byslug.get('aq')?.class).toBe('special');
  });

  it('stamps provenance with source and rule on every entry', () => {
    const fr = derive().countries.find((c) => c.slug === 'fr');
    expect(fr?.provenance.some((p) => p.source === 'wikidata' && p.rule.includes('un_member'))).toBe(true);
  });
});

describe('deriveCanon — disputes (rules 4-5)', () => {
  it('builds an existence dispute for a breakaway matched to a de_facto entry', () => {
    const d = derive({
      neDisputed: [ned({ name: 'Kosovo', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
    });
    const k = d.disputes.find((x) => x.slug === 'kosovo');
    expect(k?.kind).toBe('existence');
    expect(k?.subjectCountrySlug).toBe('xk');
    expect(k?.claims).toContainEqual({ countrySlug: 'rs', role: 'claims', note: null });
  });

  it('builds an attribution dispute with the NE sovereign as controller', () => {
    const crimeaWd = wd({ qid: 'Q7835', label: 'Crimea', claimedByQids: ['Q212'] });
    const d = derive({
      wikidata: [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA, crimeaWd],
      neDisputed: [ned({ name: 'Crimea', sovIso3: 'RUS', wikidataQid: 'Q7835' })],
    });
    const c = d.disputes.find((x) => x.slug === 'crimea');
    expect(c?.kind).toBe('attribution');
    expect(c?.claims).toContainEqual({ countrySlug: 'ru', role: 'controls', note: null });
    expect(c?.claims).toContainEqual({ countrySlug: 'ua', role: 'claims', note: null });
  });
});

describe('deriveCanon — presets (rule 6)', () => {
  it('derives de_facto (default), un_widely_recognized and strict_neutral', () => {
    const d = derive({
      neDisputed: [ned({ name: 'Kosovo', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
    });
    const presets = new Map(d.presets.map((p) => [p.slug, p]));
    expect(presets.get('de_facto')?.isDefault).toBe(true);
    const defactoKosovo = presets.get('de_facto')?.choices.find((c) => c.disputeSlug === 'kosovo');
    expect(defactoKosovo?.countsAs).toBe('independent');
    const unKosovo = presets.get('un_widely_recognized')?.choices.find((c) => c.disputeSlug === 'kosovo');
    expect(unKosovo).toMatchObject({ countsAs: 'country', countrySlug: 'rs' });
    const neutral = presets.get('strict_neutral')?.choices.find((c) => c.disputeSlug === 'kosovo');
    expect(neutral?.countsAs).toBe('not_counted');
  });
});

describe('deriveCanon — exceptions (rule 7)', () => {
  it('applies a class override and stamps provenance', () => {
    const d = deriveCanon({
      wikidata: [FRANCE, GREENLAND, DENMARK],
      neCountries: [], neDisputed: [],
      exceptions: [{ target: 'gl', action: { setClass: 'de_facto' }, justification: 'test', source: 'test' }],
    });
    const gl = d.countries.find((c) => c.slug === 'gl');
    expect(gl?.class).toBe('de_facto');
    expect(gl?.provenance.some((p) => p.source === 'exceptions.json')).toBe(true);
  });

  it('merges duplicate entries via mergeInto', () => {
    const sadr = wd({ qid: 'Q40362', label: 'Sahrawi Arab Democratic Republic', hasLimitedRecognition: true });
    const wsah = wd({ qid: 'Q6250', label: 'Western Sahara', iso2: 'EH', iso3: 'ESH' });
    const d = deriveCanon({
      wikidata: [wsah, sadr], neCountries: [], neDisputed: [],
      exceptions: [{ target: 'sahrawi-arab-democratic-republic', action: { mergeInto: 'eh' }, justification: 'same territory', source: 'test' }],
    });
    expect(d.countries.find((c) => c.slug === 'sahrawi-arab-democratic-republic')).toBeUndefined();
    expect(d.countries.find((c) => c.slug === 'eh')).toBeDefined();
  });
});

describe('slugify', () => {
  it('lowercases, strips diacritics, hyphenates', () => {
    expect(slugify('São Tomé and Príncipe')).toBe('sao-tome-and-principe');
  });
});
