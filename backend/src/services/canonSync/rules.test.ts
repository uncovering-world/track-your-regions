import { describe, it, expect } from 'vitest';
import { deriveCanon, slugify } from './rules.js';
import type { NeDisputedFeature, WikidataCountryRow } from './types.js';

function wd(over: Partial<WikidataCountryRow>): WikidataCountryRow {
  return {
    qid: 'Q0', label: 'X', iso2: null, iso3: null, isoNumeric: null,
    isUnMember: false, hasLimitedRecognition: false, sovereignQid: null, claimedByQids: [],
    ...over,
  };
}
const GEO = { type: 'MultiPolygon', coordinates: [] };
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
  wikidata?: WikidataCountryRow[]; neDisputed?: NeDisputedFeature[];
} = {}) {
  return deriveCanon({
    wikidata: extra.wikidata ?? [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA],
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

  it('dedupes rows sharing an iso2, keeping the first and warning', () => {
    const first = wd({ qid: 'Q1', label: 'First Land', iso2: 'ZZ', iso3: 'ZZZ' });
    const second = wd({ qid: 'Q2', label: 'Second Land', iso2: 'ZZ', iso3: 'ZZY' });
    const d = deriveCanon({ wikidata: [first, second], neDisputed: [], exceptions: [] });
    const zz = d.countries.filter((c) => c.iso2 === 'ZZ');
    expect(zz).toHaveLength(1);
    expect(zz[0]?.name).toBe('First Land');
    expect(d.warnings.some((w) => w.includes('ZZ'))).toBe(true);
  });

  it('excludes rows that fail the membership rule entirely', () => {
    const nowhere = wd({ qid: 'Q1', label: 'Nowhere' }); // no iso2, no UN membership, no limited recognition
    const d = deriveCanon({ wikidata: [nowhere], neDisputed: [], exceptions: [] });
    expect(d.countries).toHaveLength(0);
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

  it('builds an existence dispute with a un_observer subject (Palestine)', () => {
    const palestine = wd({ qid: 'Q219060', label: 'Palestine', iso2: 'PS', iso3: 'PSE', claimedByQids: ['Q801'] });
    const israel = wd({ qid: 'Q801', label: 'Israel', iso2: 'IL', iso3: 'ISR', isUnMember: true });
    const d = derive({
      wikidata: [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA, palestine, israel],
      neDisputed: [ned({ name: 'West Bank', sovIso3: 'PSE', wikidataQid: 'Q219060' })],
    });
    const ps = d.countries.find((c) => c.slug === 'ps');
    expect(ps?.class).toBe('un_observer');
    const wb = d.disputes.find((x) => x.slug === 'west-bank');
    expect(wb?.kind).toBe('existence');
    expect(wb?.subjectCountrySlug).toBe('ps');
    const unChoice = d.presets.find((p) => p.slug === 'un_widely_recognized')?.choices.find((c) => c.disputeSlug === 'west-bank');
    expect(unChoice).toMatchObject({ countsAs: 'independent' });
  });

  it('drops a zero-claimant NE disputed feature and warns', () => {
    const d = derive({
      neDisputed: [ned({ name: 'Nowhereland', sovIso3: 'ZZZ', wikidataQid: 'Q999999' })],
    });
    expect(d.disputes.find((x) => x.slug === 'nowhereland')).toBeUndefined();
    expect(d.warnings.some((w) => w.includes('nowhereland'))).toBe(true);
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

  it('derives preset choices for the Crimea attribution dispute (de_facto -> ru, un -> ua)', () => {
    const crimeaWd = wd({ qid: 'Q7835', label: 'Crimea', claimedByQids: ['Q212'] });
    const d = derive({
      wikidata: [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA, crimeaWd],
      neDisputed: [ned({ name: 'Crimea', sovIso3: 'RUS', wikidataQid: 'Q7835' })],
    });
    const presets = new Map(d.presets.map((p) => [p.slug, p]));
    const defactoCrimea = presets.get('de_facto')?.choices.find((c) => c.disputeSlug === 'crimea');
    expect(defactoCrimea).toMatchObject({ countsAs: 'country', countrySlug: 'ru' });
    const unCrimea = presets.get('un_widely_recognized')?.choices.find((c) => c.disputeSlug === 'crimea');
    expect(unCrimea).toMatchObject({ countsAs: 'country', countrySlug: 'ua' });
  });
});

describe('deriveCanon — exceptions (rule 7)', () => {
  it('applies a class override and stamps provenance', () => {
    const d = deriveCanon({
      wikidata: [FRANCE, GREENLAND, DENMARK],
      neDisputed: [],
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
      wikidata: [wsah, sadr], neDisputed: [],
      exceptions: [{ target: 'sahrawi-arab-democratic-republic', action: { mergeInto: 'eh' }, justification: 'same territory', source: 'test' }],
    });
    expect(d.countries.find((c) => c.slug === 'sahrawi-arab-democratic-republic')).toBeUndefined();
    expect(d.countries.find((c) => c.slug === 'eh')).toBeDefined();
  });

  it('mergeInto redirects every reference to the survivor, leaving no dangling slug', () => {
    const subjectRow = wd({ qid: 'Q9001', label: 'Testland', iso2: 'ZZ', hasLimitedRecognition: true });
    const survivorRow = wd({ qid: 'Q9002', label: 'Bigland', iso2: 'ZY', isUnMember: true });
    const dependentRow = wd({ qid: 'Q9003', label: 'Depland', iso2: 'ZX', sovereignQid: 'Q9001' });
    const d = deriveCanon({
      wikidata: [subjectRow, survivorRow, dependentRow],
      neDisputed: [ned({ name: 'Testland', wikidataQid: 'Q9001' })],
      exceptions: [{ target: 'zz', action: { mergeInto: 'zy' }, justification: 'test merge', source: 'test' }],
    });
    expect(d.countries.find((c) => c.slug === 'zz')).toBeUndefined();
    const dispute = d.disputes.find((x) => x.slug === 'testland');
    expect(dispute?.subjectCountrySlug).toBe('zy');
    expect(dispute?.claims).toContainEqual({ countrySlug: 'zy', role: 'controls', note: null });
    const unChoice = d.presets.find((p) => p.slug === 'un_widely_recognized')?.choices.find((c) => c.disputeSlug === 'testland');
    expect(unChoice).toMatchObject({ countsAs: 'country', countrySlug: 'zy' });
    expect(d.countries.find((c) => c.slug === 'zx')?.sovereignSlug).toBe('zy');

    // no dangling slug anywhere: every referenced slug resolves to a surviving country
    const slugs = new Set(d.countries.map((c) => c.slug));
    const referenced = [
      ...d.disputes.map((x) => x.subjectCountrySlug),
      ...d.disputes.flatMap((x) => x.claims.map((c) => c.countrySlug)),
      ...d.presets.flatMap((p) => p.choices.map((c) => c.countrySlug)),
      ...d.countries.map((c) => c.sovereignSlug),
    ].filter((s): s is string => s !== null);
    for (const slug of referenced) expect(slugs.has(slug)).toBe(true);
  });

  it('dropCountry cascades: neutralizes dangling preset choices and drops orphaned disputes', () => {
    const crimeaWd = wd({ qid: 'Q7835', label: 'Crimea', claimedByQids: ['Q212'] });
    const a = deriveCanon({
      wikidata: [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA, crimeaWd],
      neDisputed: [ned({ name: 'Crimea', sovIso3: 'RUS', wikidataQid: 'Q7835' })],
      exceptions: [{ target: 'ua', action: { dropCountry: true }, justification: 'test', source: 'test' }],
    });
    expect(a.countries.find((c) => c.slug === 'ua')).toBeUndefined();
    // dispute survives: the controller claim (ru) is untouched, and ua wasn't the subject
    expect(a.disputes.find((x) => x.slug === 'crimea')).toBeDefined();
    const unChoice = a.presets.find((p) => p.slug === 'un_widely_recognized')?.choices.find((c) => c.disputeSlug === 'crimea');
    expect(unChoice).toMatchObject({ countsAs: 'not_counted', countrySlug: null });
    expect(a.warnings.some((w) => w.includes('ua'))).toBe(true);

    const b = deriveCanon({
      wikidata: [FRANCE, DENMARK, GREENLAND, VATICAN, ANTARCTICA, SERBIA, KOSOVO, UKRAINE, RUSSIA],
      neDisputed: [ned({ name: 'Kosovo', sovIso3: 'KOS', wikidataQid: 'Q1246' })],
      exceptions: [{ target: 'xk', action: { dropCountry: true }, justification: 'test', source: 'test' }],
    });
    expect(b.countries.find((c) => c.slug === 'xk')).toBeUndefined();
    // dispute removed: xk was the subject, not just a claimant
    expect(b.disputes.find((x) => x.slug === 'kosovo')).toBeUndefined();
    for (const p of b.presets) expect(p.choices.some((c) => c.disputeSlug === 'kosovo')).toBe(false);
    expect(b.warnings.some((w) => w.includes('kosovo'))).toBe(true);
  });

  it('warns and makes no change on a self-referential mergeInto', () => {
    const d = deriveCanon({
      wikidata: [FRANCE, GREENLAND, DENMARK],
      neDisputed: [],
      exceptions: [{ target: 'gl', action: { mergeInto: 'gl' }, justification: 'test', source: 'test' }],
    });
    expect(d.countries.find((c) => c.slug === 'gl')).toBeDefined();
    expect(d.warnings.some((w) => w.includes('gl'))).toBe(true);
  });
});

describe('slugify', () => {
  it('lowercases, strips diacritics, hyphenates', () => {
    expect(slugify('São Tomé and Príncipe')).toBe('sao-tome-and-principe');
    expect(slugify('--Åland Islands--')).toBe('aland-islands'); // leading/trailing runs trimmed
  });
});
