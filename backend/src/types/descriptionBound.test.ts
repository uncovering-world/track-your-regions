/**
 * A curator's description is bounded at least as generously as the paragraph
 * a source writes into the same column (#2028): the UNESCO run stores the
 * World Heritage Centre's text unbounded, and Colonies of Benevolence's runs
 * to 1,943 characters, so an edit of it has to fit.
 */

import { describe, it, expect } from 'vitest';
import { createManualExperienceBodySchema, editExperienceBodySchema } from './index.js';

const paragraph = 'a'.repeat(1943);

describe("a curator's description", () => {
  it('takes an edit as long as the longest source paragraph', () => {
    expect(editExperienceBodySchema.safeParse({ description: paragraph }).success).toBe(true);
  });

  it('takes a created place\'s description of the same length', () => {
    expect(createManualExperienceBodySchema.safeParse({
      name: 'Colonies of Benevolence', description: paragraph, longitude: 6.18, latitude: 52.83, regionId: 1, kindId: 1,
    }).success).toBe(true);
  });

  it('still refuses one past the bound', () => {
    expect(editExperienceBodySchema.safeParse({ description: 'a'.repeat(10001) }).success).toBe(false);
  });
});
