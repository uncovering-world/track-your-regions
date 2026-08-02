/**
 * Tests for the provenance-aware experience upsert.
 *
 * The upsert has to answer two questions in one round trip: what the row looked
 * like before, and what it looks like now. These tests pin the shape of that
 * answer and the promise that a dry run writes nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { upsertExperienceRecord, type ExperienceUpsertParams } from './syncUtils.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const PARAMS: ExperienceUpsertParams = {
  categoryId: 1,
  externalId: '156',
  name: 'Serengeti National Park',
  nameLocal: { en: 'Serengeti National Park' },
  description: null,
  shortDescription: 'Vast plains.',
  category: 'natural',
  tags: ['natural'],
  lon: 34.8333,
  lat: -2.3333,
  countryCodes: ['TZ'],
  countryNames: ['Tanzania'],
  imageUrl: 'https://example.org/serengeti.jpg',
  metadata: { inDanger: false, dateInscribed: 1981 },
};

/** The row shape the CTE returns: new values, plus `old_*` for the prior row. */
function returnedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    inserted: false,
    curated_fields: [],
    name: PARAMS.name,
    name_local: PARAMS.nameLocal,
    description: PARAMS.description,
    short_description: PARAMS.shortDescription,
    category: PARAMS.category,
    tags: PARAMS.tags,
    lon: PARAMS.lon,
    lat: PARAMS.lat,
    country_codes: PARAMS.countryCodes,
    country_names: PARAMS.countryNames,
    image_url: PARAMS.imageUrl,
    metadata: PARAMS.metadata,
    old_name: PARAMS.name,
    old_name_local: PARAMS.nameLocal,
    old_description: PARAMS.description,
    old_short_description: PARAMS.shortDescription,
    old_category: PARAMS.category,
    old_tags: PARAMS.tags,
    old_lon: PARAMS.lon,
    old_lat: PARAMS.lat,
    old_country_codes: PARAMS.countryCodes,
    old_country_names: PARAMS.countryNames,
    old_image_url: PARAMS.imageUrl,
    old_metadata: PARAMS.metadata,
    old_missing_since: null,
    ...overrides,
  };
}

describe('upsertExperienceRecord', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('reports a created row when the insert did not conflict', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow({ inserted: true, old_name: null })] });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.experienceId).toBe(501);
    expect(result.changeSet.changeType).toBe('created');
    expect(result.nameSnapshot).toBe('Serengeti National Park');
  });

  it('reports unchanged when the stored row already matched', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.changedFields).toEqual([]);
  });

  it('reports the fields that differ from the stored row', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_short_description: 'An older summary.' })],
    });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('surfaces a curated field as a conflict, using the stored curated_fields', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ curated_fields: ['short_description'], old_short_description: 'Curator wording.' })],
    });

    const result = await upsertExperienceRecord(PARAMS);

    expect(result.changeSet.changeType).toBe('unchanged');
    expect(result.changeSet.curatedConflicts.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reads without writing in dry-run mode', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: [],
        name: 'Serengeti National Park',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: 'An older summary.',
        category: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('SELECT');
    expect(sql).not.toContain('INSERT');
    expect(result.changeSet.changeType).toBe('updated');
    expect(result.changeSet.changedFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reports created in dry-run mode when no row exists yet', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(result.changeSet.changeType).toBe('created');
    expect(result.experienceId).toBe(0);
  });

  it('stamps provenance on the written row', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('last_seen_sync_log_id');
    expect(sql).toContain('first_seen_sync_log_id');
    expect(mockedQuery.mock.calls[0][1]).toContain(9);
  });

  it('clears a stale missing flag when the source produces the row again', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(String(mockedQuery.mock.calls[0][0])).toContain('missing_since = NULL');
  });

  it('labels the change with the stored name, not a rejected proposal', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({
        curated_fields: ['name'],
        name: 'Curator wording for Serengeti',
        old_name: 'Curator wording for Serengeti',
      })],
    });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    // The source proposed PARAMS.name and was refused; labelling the row with
    // the refused name would name an experience the curator has never seen
    expect(result.nameSnapshot).toBe('Curator wording for Serengeti');
  });

  it('previews a rename with the name the real run would store', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: [],
        missing_since: null,
        name: 'Serengeti National Park (old name)',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: PARAMS.shortDescription,
        category: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    // The live path reads the post-update name out of RETURNING; a preview that
    // reported the old one would stop standing in for the run it previews
    expect(result.nameSnapshot).toBe(PARAMS.name);
  });

  it('previews a curated name as the curator wrote it', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 501,
        curated_fields: ['name'],
        missing_since: null,
        name: 'Curator wording',
        name_local: PARAMS.nameLocal,
        description: null,
        short_description: PARAMS.shortDescription,
        category: 'natural',
        tags: ['natural'],
        lon: PARAMS.lon,
        lat: PARAMS.lat,
        country_codes: ['TZ'],
        country_names: ['Tanzania'],
        image_url: PARAMS.imageUrl,
        metadata: PARAMS.metadata,
      }],
    });

    const result = await upsertExperienceRecord(PARAMS, { dryRun: true });

    expect(result.nameSnapshot).toBe('Curator wording');
  });

  it('reports that a row had been missing, so the run can call it a return', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [returnedRow({ old_missing_since: '2026-07-01T00:00:00Z' })],
    });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(true);
  });

  it('reports no return for a row that was never missing', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [returnedRow()] });

    const result = await upsertExperienceRecord(PARAMS, { syncLogId: 9 });

    expect(result.returnedFromMissing).toBe(false);
  });
});
