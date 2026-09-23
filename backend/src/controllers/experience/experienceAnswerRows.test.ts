import { describe, expect, it } from 'vitest';
import { Experience, ExperienceDetail } from '../../api/responses/experiences.js';
import {
  experienceDetailOf, experienceOf, treasureOf, type ExperienceDetailRow, type ExperienceListRow, type TreasureRow,
} from './experienceAnswerRows.js';

/** The Acropolis of Athens as the by-id read's driver hands it over. */
const ACROPOLIS: ExperienceDetailRow = {
  id: 14723, source_id: 5, external_id: 'Q131013', name: 'Acropolis of Athens', name_local: { el: 'Ακρόπολη Αθηνών' },
  description: null, short_description: 'citadel on a rocky outcrop above Athens', type: 'site',
  country_codes: ['GR'], country_names: ['Greece'], image_url: null, metadata: { sitelinks: 120 },
  created_at: new Date('2026-09-13T10:00:00.000Z'), updated_at: new Date('2026-09-14T11:30:00.000Z'),
  source_membership: 'present', existence: 'extant', missing_since: null, longitude: 23.7263, latitude: 37.9715,
  boundary_geojson: { type: 'MultiPolygon', coordinates: [[[[23.72, 37.97], [23.73, 37.97], [23.73, 37.98], [23.72, 37.97]]]] },
  area_km2: 0.03, kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, source_name: 'Archaeology',
  source_description: null,
};

describe('experienceDetailOf', () => {
  it('answers an object the schema accepts, its timestamps as ISO strings', () => {
    const detail = experienceDetailOf(ACROPOLIS, []);
    expect(detail.created_at).toBe('2026-09-13T10:00:00.000Z');
    expect(ExperienceDetail.safeParse(JSON.parse(JSON.stringify(detail))).success).toBe(true);
  });

  it('does not serve a column the schema does not name', () => {
    const detail = experienceDetailOf({ ...ACROPOLIS, tags: ['acropolis'] } as ExperienceDetailRow, []);
    expect(detail).not.toHaveProperty('tags');
  });
});

describe('experienceOf', () => {
  it('writes the curator-only rejection keys as absent for a reader', () => {
    const row: ExperienceListRow = {
      id: 14723, external_id: 'Q131013', name: 'Acropolis of Athens', short_description: null, type: 'site',
      kind_id: 5, kind_name: 'Archaeology', kind_priority: 5, country_codes: ['GR'], country_names: ['Greece'],
      image_url: null, image_credit: null, created_at: null, latitude: 37.9715, longitude: 23.7263,
      in_danger: false, danger_since: null, location_count: 1, treasure_count: 0,
      source_membership: 'present', existence: 'extant', missing_since: null, is_new: false,
    };
    const wire = JSON.parse(JSON.stringify(experienceOf(row)));
    expect(wire).not.toHaveProperty('is_rejected');
    expect(wire).not.toHaveProperty('created_at');
    expect(Experience.safeParse(wire).success).toBe(true);
  });
});

describe('treasureOf', () => {
  it('serves a stored credit and find spot by their declared keys only', () => {
    const work = treasureOf({
      id: 3452, external_id: 'Q1126741', name: 'Mask of Agamemnon', treasure_type: 'funerary mask', artists: [],
      artists_curated: false, year: -1600, curated_fields: [], venue_count: 1, image_url: null, sitelinks_count: 40,
      is_iconic: true,
      image_credit: { author: 'A photographer', license: 'CC BY 2.0', licenseUrl: null, detailsUrl: null, fetchedAt: '2026-09-13' },
      found_at: { qid: 'Q131594', label: 'Mycenae', source: 'P189' },
      found_at_site: null,
    } as TreasureRow);
    expect(work.image_credit).toEqual({ author: 'A photographer', license: 'CC BY 2.0', licenseUrl: null, detailsUrl: null });
    expect(work.found_at).toEqual({ qid: 'Q131594', label: 'Mycenae' });
  });
});
