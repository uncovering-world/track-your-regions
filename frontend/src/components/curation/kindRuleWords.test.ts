import { describe, expect, it } from 'vitest';
import type { KindRule } from '../../api/kindRule';
import { kindRuleWords } from './kindRuleWords';

const NEAR = {
  radiusKm: 150, best: 10, minLanguages: 2, minReaders: 3000,
  guideShare: 0.25, guideGroupFloor: 5, editionsShare: 1, editionsGroupFloor: 25, readersShare: 1.5, readersGroupFloor: 25,
  guideOnlyTypes: [], heritageTypes: [], venues: null, mapped: null,
};

/** Towers' rule as the read answers it on dev after the run of 2026-11-16, its refusals cut to a sample. */
const TOWERS: KindRule = {
  keptOut: [
    { reason: 'destroyed or demolished', unless: null, unlessTypes: [] },
    { reason: 'a lighthouse, not a tower', unless: null, unlessTypes: [] },
    { reason: 'a skyscraper, not a tower', unless: 'types', unlessTypes: ['observation-tower'] },
    { reason: 'a sea fort, not a tower', unless: 'anotherClass', unlessTypes: [] },
    { reason: 'an archaeological site, not a tower', unless: 'anyType', unlessTypes: [] },
    { reason: 'a canal: a long object, offered once long objects have a model of their own (#1948)', unless: 'ownClass', unlessTypes: [] },
  ],
  world: {
    pool: 3103, editions: 19, editionsQuantile: 0.97, readers: 65076, readersQuantile: 0.98,
    guidedReaders: 12863, guidedQuantile: 0.9, year: '2025-11 to 2026-10', stayShare: 0.8, marks: ['wikivoyage', 'atlasObscura'],
  },
  surroundings: NEAR,
};

describe("a kind's rule in plain words (#2185)", () => {
  it("says the kind's types, what it keeps out and its fame lines, from the read", () => {
    const text = kindRuleWords(TOWERS, 7, 'Towers')!;
    expect(text).toMatch(/^Towers files a place as one of: .*bell tower/);
    expect(text).toContain('• a lighthouse, not a tower\n');
    expect(text).toContain('Wikipedia articles in 19 languages or more (the top 3 %)');
    expect(text).toContain('65,076 readers a year or more (the top 2 %)');
    expect(text).toContain('12,863 readers a year when a travel guide or Atlas Obscura names it (the top 10 %)');
    expect(text).toContain('among the 3,103 places the last run read');
    expect(text).toContain('Readers are counted from November 2025 to October 2026.');
    expect(text).toContain('stays while it reaches 80 % of a line');
  });

  it('says when a refusal does not hold, so a skyscraper with an observation deck is not read as kept out', () => {
    const text = kindRuleWords(TOWERS, 7, 'Towers')!;
    expect(text).toContain('• a skyscraper, not a tower — unless it is also an observation tower');
    expect(text).toContain('• a sea fort, not a tower — unless Wikidata also calls it another kind of tower');
    expect(text).toContain('• an archaeological site, not a tower — unless it is also one of the types above');
    expect(text).toContain('• a canal: a long object, offered once long objects have a model of their own — unless Wikidata also calls it a tower');
  });

  it("says the surroundings tier's reference and its three tests at their shares", () => {
    const text = kindRuleWords(TOWERS, 7, 'Towers')!;
    expect(text).toContain('measured against the median of the 10 best places within 150 km');
    expect(text).toContain('travel guides that use it reach a quarter of that median, among 5 places or more');
    expect(text).toContain('its Wikipedia languages reach that median, among 25 places or more');
    expect(text).toContain('its readers reach 1.5 times that median, among 25 places or more');
  });

  it("says Bridges' types that need a guide, Squares' venue test and Archaeology's listing and map", () => {
    const bridges = kindRuleWords({ ...TOWERS, keptOut: null, surroundings: { ...NEAR, guideOnlyTypes: ['tunnel', 'dam', 'lock', 'bridge'], heritageTypes: ['bridge'] } }, 8, 'Bridges & engineering marvels')!;
    expect(bridges).toMatch(/\nA tunnel, dam, lock or bridge gets in only when a travel guide uses it\./);
    expect(bridges).toMatch(/\nA bridge also gets in when a heritage designation still holds\./);
    const squares = kindRuleWords({ ...TOWERS, surroundings: { ...NEAR, venues: { radiusM: 200, share: 0.5, groupFloor: 25 } } }, 9, 'Squares & streets')!;
    expect(squares).toContain('the cafés, bars and restaurants within 200 m reach half the median of the liveliest places around it, among 25');
    const archaeology = kindRuleWords({
      keptOut: null, world: { ...TOWERS.world!, marks: ['wikivoyage', 'atlasObscura', 'worldHeritageList'] }, surroundings: { ...NEAR, mapped: { listedStands: true, namedRuinWithinM: 2000 } },
    }, 5, 'Archaeology')!;
    expect(archaeology).toContain('when a travel guide, Atlas Obscura or the World Heritage List names it');
    expect(archaeology).toContain('an OpenStreetMap object that marks it as the place, unless the World Heritage List inscribes it or a ruin under its name is mapped within 2 km.');
  });

  it('leaves out the issue a declaration cites', () => {
    expect(kindRuleWords(TOWERS, 7, 'Towers')).not.toMatch(/#\d/);
  });

  it('says only the editions line where no readership year was ever read', () => {
    const text = kindRuleWords({ ...TOWERS, world: { ...TOWERS.world!, readers: null, guidedReaders: null, year: null } }, 7, 'Towers')!;
    expect(text).toContain('19 languages or more');
    expect(text).not.toContain('readers a year or more');
    expect(text).not.toContain('Readers are counted');
  });

  it("says a kind's types alone where its rule is code of its own and no run read its bars", () => {
    expect(kindRuleWords({ keptOut: null, world: null, surroundings: null }, 4, 'Places of worship'))
      .toMatch(/^Places of worship files a place as one of: [^\n]+\.$/);
  });

  it('says nothing for a kind with no types, no declaration and no bars', () => {
    expect(kindRuleWords({ keptOut: null, world: null, surroundings: null }, 2, 'Art Museums')).toBeNull();
    expect(kindRuleWords(undefined, 2, 'Art Museums')).toBeNull();
  });
});
