import { describe, expect, it } from 'vitest';
import { TEXT_CREDITS } from '@tyr/shared/textCredits';
import { transformRecord } from './unescoSyncService.js';
import { UNESCO_FACT_FIELDS, UNESCO_TEXT_FIELDS } from './unescoProvenance.js';
import { FAMILY_FIELDS } from './fieldFamilies.js';
import type { UnescoApiRecord } from './types.js';

/**
 * What a row the UNESCO run writes says about where its fields came from
 * (ADR-0149): the dataset, the property, the day it was read, the licence, and
 * the facts kept apart from the text.
 */

const ROME: UnescoApiRecord = {
  id_no: '91', name_en: 'Historic Centre of Rome', category: 'Cultural',
  geo_point_2d: { lat: 41.89, lon: 12.49 },
  short_description_en: 'Founded, according to legend, by Romulus and Remus in 753 BC…',
};

describe("the UNESCO run's mark on a row", () => {
  it('names the dataset, the property, the day it was read and the licence', () => {
    const mark = transformRecord(ROME, undefined, undefined, '2026-10-25')?.metadata.unesco;

    expect(mark).toEqual({
      dataset: 'whc001', id: '91', readAt: '2026-10-25', licence: TEXT_CREDITS.unesco.licence,
      facts: UNESCO_FACT_FIELDS, text: ['description'],
    });
  });

  it('lists no text where the dataset gave the property no description', () => {
    const mark = transformRecord({ ...ROME, short_description_en: undefined }, undefined, undefined, '2026-10-25')?.metadata.unesco;

    expect(mark).toMatchObject({ text: [] });
  });

  it('names as facts only metadata keys the run writes, and the text apart from them', () => {
    const written = Object.keys(transformRecord(ROME)?.metadata ?? {});
    const factKeys = UNESCO_FACT_FIELDS.filter(field => field.startsWith('metadata.')).map(field => field.slice('metadata.'.length));

    expect(written).toEqual(expect.arrayContaining(factKeys));
    expect(UNESCO_FACT_FIELDS).not.toContain('description');
    expect(UNESCO_TEXT_FIELDS).toEqual(['description']);
  });

  it('is kept by the other family\'s runs while the UNESCO membership stands', () => {
    expect(FAMILY_FIELDS.unesco.metadata).toContain('unesco');
  });
});
