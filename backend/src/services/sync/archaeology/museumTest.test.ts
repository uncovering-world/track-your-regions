import { describe, it, expect } from 'vitest';
import { museumNature, museumVerdict } from './museumTest.js';
import { buildArchaeologyTrees } from './classes.js';

const ARCH_MUSEUM = 'Q3329412'; const ART_MUSEUM = 'Q207694'; const NAT_MUSEUM = 'Q17431399';
const NAT_HIST = 'Q1970365'; const PARK = 'Q3363945';
const trees = buildArchaeologyTrees({ museum: [ARCH_MUSEUM, 'Q3330834'], park: [], naturalHistory: [NAT_HIST], artefact: ['Q220659'] });
const line = { enterSitelinks: 22, staySitelinks: 18, find: { enterSitelinks: 18, staySitelinks: 15 } };
const at = (lat: number, lon: number) => ({ lat, lon });

describe('museumNature', () => {
  it('the Louvre is archaeological by class, and says which', () => {
    const n = museumNature({ qid: 'Q19675', classes: [ART_MUSEUM, NAT_MUSEUM, ARCH_MUSEUM], categories: ['Art museums and galleries in Paris'], ...at(48.86, 2.34) }, trees);
    expect(n).toEqual({ nature: 'archaeological', why: 'class: archaeological museum' });
  });
  it('the British Museum is archaeological by category, though Wikidata types it an art museum', () => {
    const n = museumNature({ qid: 'Q6373', classes: [ART_MUSEUM, NAT_MUSEUM], categories: ['Archaeological museums in London', 'Art museums and galleries in London'], ...at(51.52, -0.13) }, trees);
    expect(n).toEqual({ nature: 'archaeological', why: 'category: Archaeological museums in London' });
  });
  it('the Hermitage has a department, not a nature', () => {
    const n = museumNature({ qid: 'Q132783', classes: [ART_MUSEUM], categories: ['Egyptological collections in Russia', 'Museums of ancient Greece in Russia'], ...at(59.94, 30.31) }, trees);
    expect(n).toEqual({ nature: 'department', why: 'category: Egyptological collections in Russia' });
  });
  it('the Uffizi is neither', () => {
    expect(museumNature({ qid: 'Q51252', classes: [ART_MUSEUM], categories: ['Art museums and galleries in Florence'], ...at(43.77, 11.26) }, trees)).toEqual({ nature: 'none' });
  });
  it('a natural history museum is vetoed whatever it holds', () => {
    expect(museumNature({ qid: 'Q688704', classes: [NAT_HIST], categories: ['Archaeological museums in Austria'], ...at(48.2, 16.36) }, trees)).toEqual({ veto: 'a natural history museum, not an archaeology museum' });
  });
  it('an archaeological park is a site, not a museum', () => {
    // The Archaeological Park of Xanten (Q316385), typed `archaeological park`
    // and nothing else, with no English article to carry a category (checked on
    // 2026-09-13): the open-air Roman town a traveller walks around, which the
    // site door admits on its own terms.
    expect(museumNature({ qid: 'Q316385', classes: [PARK], categories: [], ...at(51.667, 6.451) }, trees)).toEqual({ veto: 'an archaeological park: a site, not a museum' });
    // And the veto is read before either signal of the nature, so a park also
    // typed an archaeological museum is still a park. An unnamed row: no real
    // park is asked here to carry a class it does not.
    expect(museumNature({ qid: 'Q1', classes: [PARK, ARCH_MUSEUM], categories: [], ...at(51.667, 6.451) }, trees)).toEqual({ veto: 'an archaeological park: a site, not a museum' });
  });
  it('a park under the root, with an archaeology category, is still a park', () => {
    // `Fudoki no oka` is filed under `archaeological park` and carries no park
    // class of its own, so only the tree refuses it — and the category door
    // would otherwise let it in as a museum.
    const parkTrees = buildArchaeologyTrees({ museum: [ARCH_MUSEUM], park: [PARK, 'Q11665453'], naturalHistory: [NAT_HIST], artefact: [] });
    expect(museumNature({ qid: 'Q11665453', classes: ['Q11665453'], categories: ['Archaeological museums in Japan'], ...at(31.8, 130.7) }, parkTrees))
      .toEqual({ veto: 'an archaeological park: a site, not a museum' });
  });
});

describe('museumVerdict', () => {
  const nature = { nature: 'archaeological' as const, why: 'class: archaeological museum' };
  const facts = { qid: 'Q636928', classes: [ARCH_MUSEUM], categories: [], ...at(38.48, 22.5) };
  it('admits an archaeology museum at the place line', () => {
    expect(museumVerdict({ facts, sitelinks: 39, findsForTheDoor: 0, nature, admitted: new Set(), line })).toEqual({ pass: true, held: false, type: 'museum' });
  });
  it('admits Delphi below the place line for the Charioteer', () => {
    expect(museumVerdict({ facts, sitelinks: 15, findsForTheDoor: 1, nature, admitted: new Set(), line })).toEqual({ pass: true, held: false, type: 'museum' });
  });
  it('leaves an unknown archaeology museum with no find out, unreported', () => {
    expect(museumVerdict({ facts, sitelinks: 15, findsForTheDoor: 0, nature, admitted: new Set(), line })).toEqual({ pass: false, out: true });
  });
  it('keeps a museum the source holds that has slipped only to the stay line', () => {
    expect(museumVerdict({ facts, sitelinks: 18, findsForTheDoor: 0, nature, admitted: new Set(['Q636928']), line })).toEqual({ pass: true, held: false, type: 'museum' });
  });
  it('refuses by name a museum the source held that fell below the stay line', () => {
    const v = museumVerdict({ facts, sitelinks: 17, findsForTheDoor: 0, nature, admitted: new Set(['Q636928']), line });
    expect(v).toEqual({ pass: false, reason: '17 sitelinks: below the world tier\'s line (22 to enter, 18 to stay)' });
  });
  it('holds a museum with only an antiquities department, with the question for a curator', () => {
    const v = museumVerdict({ facts: { ...facts, qid: 'Q132783' }, sitelinks: 86, findsForTheDoor: 4, nature: { nature: 'department', why: 'category: Egyptological collections in Russia' }, admitted: new Set(), line });
    expect(v).toEqual({ pass: true, held: true, type: 'museum', note: 'an antiquities department (category: Egyptological collections in Russia); is the exposition substantially archaeology?' });
  });
  it('refuses a museum of neither nature, naming the finds it holds', () => {
    const v = museumVerdict({ facts: { ...facts, qid: 'Q51252' }, sitelinks: 73, findsForTheDoor: 1, nature: { nature: 'none' }, admitted: new Set(), line });
    expect(v).toEqual({ pass: false, reason: 'not an archaeology museum by category or class (1 famous find held)' });
  });
  it('refuses a museum of neither nature that holds no find, without counting to zero', () => {
    const v = museumVerdict({ facts: { ...facts, qid: 'Q51252' }, sitelinks: 73, findsForTheDoor: 0, nature: { nature: 'none' }, admitted: new Set(), line });
    expect(v).toEqual({ pass: false, reason: 'not an archaeology museum by category or class (no find above the line)' });
  });
  it('refuses a vetoed museum with the veto', () => {
    expect(museumVerdict({ facts, sitelinks: 43, findsForTheDoor: 1, nature: { veto: 'a natural history museum, not an archaeology museum' }, admitted: new Set(), line }))
      .toEqual({ pass: false, reason: 'a natural history museum, not an archaeology museum' });
  });
});
