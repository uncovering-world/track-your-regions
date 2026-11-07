import { describe, expect, it } from 'vitest';
import { kindReadingQuestion, NO_KIND, optionKey, type KindOption } from './kindReading.js';

const CELLULAR_JAIL = {
  name: 'Cellular Jail', countries: ['India'], description: 'colonial prison in India',
  map: 'historic=prison', article: 'https://en.wikipedia.org/wiki/Cellular_Jail',
};

const OPTIONS: KindOption[] = [
  { live: true, kindId: 6, name: 'Monuments & memorials', definition: 'What was made to commemorate.' },
  {
    live: false, slug: 'historical-sites', name: 'Historical sites', issue: null,
    definition: 'A place where a significant moment happened, visited for that moment.',
  },
];

describe("Jev's reading of which kind a place belongs to (#2342)", () => {
  it('offers every kind under its own key with its definition, and none', () => {
    const question = kindReadingQuestion(CELLULAR_JAIL, OPTIONS, null);

    expect(question.criteria).toEqual({
      'kind-6': 'Monuments & memorials: What was made to commemorate.',
      'planned-historical-sites': 'Historical sites: A place where a significant moment happened, visited for that moment.',
      [NO_KIND]: expect.stringMatching(/^None of these kinds/),
    });
    expect(OPTIONS.map(optionKey)).toEqual(['kind-6', 'planned-historical-sites']);
  });

  it('sends the place as itself, the lead where one was read, and nothing of how the catalogue files it', () => {
    const question = kindReadingQuestion(CELLULAR_JAIL, OPTIONS, 'The Cellular Jail was a colonial prison.');

    expect(question.state).toEqual({
      name: 'Cellular Jail', countries: ['India'], description: 'colonial prison in India',
      openstreetmap_tag: 'historic=prison', wikipedia_lead: 'The Cellular Jail was a colonial prison.',
    });
    expect(kindReadingQuestion({ ...CELLULAR_JAIL, description: null, map: null }, OPTIONS, null).state)
      .toEqual({ name: 'Cellular Jail', countries: ['India'] });
    expect(question.instructions).not.toMatch(/arriving/);
  });
});
