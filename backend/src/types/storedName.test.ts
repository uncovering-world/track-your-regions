/**
 * A name a curator sends is stored as a person would type it (#835).
 *
 * Four schemas take a name that lands in a `name` column — a work's title and
 * its makers, a place's, a point's, and the one a created place starts with —
 * and each used to take the string as typed, edges trimmed at best. Every
 * importer's writer tidies by `tidyLabel`; the schemas are the other door to
 * the same columns, and what `validate()` puts back on the request is what the
 * controller writes.
 */

import { describe, it, expect } from 'vitest';
import {
  createManualExperienceBodySchema,
  editExperienceBodySchema,
  editLocationBodySchema,
  editWorkBodySchema,
} from './index.js';

const manual = (name: string) => createManualExperienceBodySchema.safeParse({
  name, longitude: 2.1744, latitude: 41.4036, regionId: 1, kindId: 1,
});

describe('a name a curator sends', () => {
  it('is stored with its edges trimmed and its inner runs collapsed', () => {
    const work = editWorkBodySchema.safeParse({ name: ' St. John  on Patmos ' });
    expect(work.success && work.data.name).toBe('St. John on Patmos');
    const place = editExperienceBodySchema.safeParse({ name: '  Louvre ' });
    expect(place.success && place.data.name).toBe('Louvre');
    const point = editLocationBodySchema.safeParse({ name: 'Geoagiu  / Drumul Romanilor' });
    expect(point.success && point.data.name).toBe('Geoagiu / Drumul Romanilor');
    const created = manual('Sagrada  Família');
    expect(created.success && created.data.name).toBe('Sagrada Família');
  });

  it('keeps the spelling that is the curator\'s own', () => {
    // A store rule, not the fold: case, dashes and accents pass untouched.
    const work = editWorkBodySchema.safeParse({ name: 'Boma–Badingilo', artists: ['Edward SAVAGE'] });
    expect(work.success && work.data.name).toBe('Boma–Badingilo');
    expect(work.success && work.data.artists).toEqual(['Edward SAVAGE']);
  });

  it('tidies every maker of a work', () => {
    const work = editWorkBodySchema.safeParse({ artists: [' Ivan  Shishkin', 'Konstantin Savitsky '] });
    expect(work.success && work.data.artists).toEqual(['Ivan Shishkin', 'Konstantin Savitsky']);
  });

  it('refuses a name that is nothing but whitespace, at every door', () => {
    // Tidied before it is judged, so the emptiness rule sees what would be stored.
    expect(editWorkBodySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(editExperienceBodySchema.safeParse({ name: ' \n ' }).success).toBe(false);
    expect(editLocationBodySchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(manual('  ').success).toBe(false);
  });

  it('measures the width on the stored form', () => {
    // 500 characters of name plus whitespace that will not be stored fits the
    // column; 501 characters of name does not, however it is padded.
    const fits = 'x'.repeat(500);
    expect(editExperienceBodySchema.safeParse({ name: `  ${fits}  ` }).success).toBe(true);
    expect(editExperienceBodySchema.safeParse({ name: `${fits}x` }).success).toBe(false);
  });
});
