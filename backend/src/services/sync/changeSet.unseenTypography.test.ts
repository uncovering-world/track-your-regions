import { describe, expect, it } from 'vitest';
import { computeChangeSet, passingColumns, type ExperienceSnapshot } from './changeSet.js';

/**
 * A field no reader is shown, and a text rewritten only in its typesetting,
 * pass the gate (#1834, ADR-0139), on the held cards of the development
 * catalogue on 2026-10-22.
 */

const HELD = true;
const GONDWANA = 'situated predominantly along the Great Escarpment on Australia’s east coast.';

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Gondwana Rainforests of Australia',
    nameLocal: { fr: 'Forêts humides Gondwana de l’Australie' },
    subtitle: null,
    description: GONDWANA,
    type: null,
    tags: [],
    lon: 153.1,
    lat: -28.2,
    countryCodes: ['AU'],
    countryNames: ['Australia'],
    imageUrl: null,
    metadata: {},
    ...overrides,
  };
}

const filed = (result: ReturnType<typeof computeChangeSet>) => ({
  written: result.changedFields.map(f => [f.field, f.passedTheGate]),
  held: result.heldFields.map(f => f.field),
});

describe('a text rewritten only in its typesetting', () => {
  it('is written past the gate on a held row, and says why', () => {
    const result = computeChangeSet(snapshot(), snapshot({ description: GONDWANA.replace('’', "'") }), [], HELD);
    expect(filed(result)).toEqual({ written: [['description', 'typography']], held: [] });
  });

  it('passes a name too, and holds a space put inside a word', () => {
    const renamed = computeChangeSet(snapshot(), snapshot({ name: 'Gondwana  Rainforests of Australia ' }), [], HELD);
    expect(filed(renamed)).toEqual({ written: [['name', 'typography']], held: [] });
    // Old Village of Hollókő's held description turns *Hollokö* into *Hollok ö*.
    const corrupted = computeChangeSet(
      snapshot({ description: 'Hollokö is an outstanding example' }),
      snapshot({ description: 'Hollok ö is an outstanding example' }), [], HELD,
    );
    expect(filed(corrupted)).toEqual({ written: [], held: ['description'] });
  });

  it('is filed as any change on a row the gate does not hold', () => {
    const result = computeChangeSet(snapshot(), snapshot({ description: GONDWANA.replace('’', "'") }), [], false);
    expect(filed(result)).toEqual({ written: [['description', undefined]], held: [] });
  });
});

describe('a field no reader is shown', () => {
  it('passes a local name, a country and an area on a held row', () => {
    // Mount Pelée's stored Arabic name is Ha Long Bay's; the held proposal is the correction.
    const result = computeChangeSet(
      snapshot({ nameLocal: { ar: 'خليج ها لونغ' }, metadata: { areaHectares: 1000 } }),
      snapshot({ nameLocal: { ar: 'جبل بيليه' }, countryNames: ['Commonwealth of Australia'], metadata: { areaHectares: 3700 } }),
      [], HELD,
    );
    expect(filed(result)).toEqual({
      written: [['nameLocal.ar', 'unseen'], ['countryNames', 'unseen'], ['metadata.areaHectares', 'unseen']],
      held: [],
    });
  });

  it('is still a curator\'s claim where one holds it', () => {
    const result = computeChangeSet(
      snapshot({ nameLocal: { ar: 'خليج ها لونغ' } }), snapshot({ nameLocal: { ar: 'جبل بيليه' } }), ['name_local'], HELD,
    );
    expect(result.curatedConflicts.map(f => f.field)).toEqual(['nameLocal.ar']);
    expect(filed(result)).toEqual({ written: [], held: [] });
  });
});

describe('the columns a held row takes all the same', () => {
  it('names each passing column once, the local names whole', () => {
    expect(passingColumns(
      snapshot({ nameLocal: { ar: 'a', ru: 'b' } }),
      snapshot({ nameLocal: { ar: 'c', ru: 'd' }, description: GONDWANA.replace('’', "'"), subtitle: 'A line' }),
      [],
    ).sort()).toEqual(['description', 'name_local', 'subtitle']);
  });

  it('leaves out a column with any held change, and a claimed one', () => {
    expect(passingColumns(snapshot(), snapshot({ description: 'Another paragraph.' }), [])).toEqual([]);
    expect(passingColumns(snapshot(), snapshot({ name: 'Gondwana Rainforests of Australia ' }), ['name'])).toEqual([]);
    // The extent, the picture and the coordinate are written by arms of their own.
    expect(passingColumns(snapshot(), snapshot({ lon: 150 }), [])).toEqual([]);
  });
});
