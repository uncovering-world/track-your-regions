/**
 * The curator's writes to a venue's works and their links (#1072): every one
 * spends the venue's token and names the venue, so a token for one museum
 * cannot write another museum's link, or a work that museum does not hold.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import {
  correctWork, lockWork, markUnreadLinksRefused, publishUnreadLinks, publishUnreadWorks, restoreRefusedLinks,
  writeHeldWorkFields,
} from './workWriter.js';

/** The Rijksmuseum, as the token a lock of it would hand out. */
const RIJKSMUSEUM = { id: 5 } as LockedExperience;
const NIGHT_WATCH = 3122;

function fakeClient() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
  return { client, queries };
}

describe('a link write', () => {
  it.each([
    ['the publish', publishUnreadLinks, 'experience_id = $1'],
    ['the refusal', markUnreadLinksRefused, 'et.experience_id = $1'],
    ['the take-back', restoreRefusedLinks, 'et.experience_id = $1'],
  ] as const)('%s names the venue whose token it spends', async (_, write, venue) => {
    const { client, queries } = fakeClient();
    await write(client, RIJKSMUSEUM, [NIGHT_WATCH]);
    expect(queries[0].sql).toContain(venue);
    expect(queries[0].params).toEqual([5, [NIGHT_WATCH]]);
  });

  it('covers every link of the venue where the caller named none', async () => {
    const { client, queries } = fakeClient();
    await restoreRefusedLinks(client, RIJKSMUSEUM);
    expect(queries[0].sql).not.toContain('ANY(');
    expect(queries[0].params).toEqual([5]);
  });
});

describe('a work write', () => {
  it('publishes a work only through a link of the venue', async () => {
    const { client, queries } = fakeClient();
    await publishUnreadWorks(client, RIJKSMUSEUM);
    expect(queries[0].sql).toContain('et.experience_id = $1');
    expect(queries[0].params).toEqual([5]);
  });

  it('locks the work row itself, and only one the venue offers', async () => {
    const { client, queries } = fakeClient();
    expect(await lockWork(client, RIJKSMUSEUM, NIGHT_WATCH)).toBeNull();
    expect(queries[0].sql).toContain('FOR UPDATE');
    expect(queries[0].sql).toContain('et.experience_id = $2');
    expect(queries[0].params).toEqual([NIGHT_WATCH, 5]);
  });

  it('writes a correction only through a link of the venue', async () => {
    const { client, queries } = fakeClient();
    await correctWork(client, RIJKSMUSEUM, NIGHT_WATCH, { name: 'The Night Watch', credit: null, curatedFields: ['name'] });
    expect(queries[0].sql).toContain('et.experience_id = $11');
    expect(queries[0].params[10]).toBe(5);
  });
});

describe('a held work\'s fields', () => {
  it('are written as data through a link of the venue, the credit merged into metadata', async () => {
    const { client, queries } = fakeClient();
    await writeHeldWorkFields(client, RIJKSMUSEUM, NIGHT_WATCH, [
      { field: 'year', value: 1642 },
      { field: 'metadata.imageCredit', value: { author: 'Rembrandt' } },
    ]);
    expect(queries[0].sql).toContain('year = $3');
    expect(queries[0].sql).toContain("jsonb_build_object('imageCredit', $4::jsonb)");
    expect(queries[0].sql).toContain('et.experience_id = $2');
    expect(queries[0].params).toEqual([NIGHT_WATCH, 5, 1642, JSON.stringify({ author: 'Rembrandt' })]);
  });

  it('drop the credit key rather than write a null', async () => {
    const { client, queries } = fakeClient();
    await writeHeldWorkFields(client, RIJKSMUSEUM, NIGHT_WATCH, [{ field: 'metadata.imageCredit', value: null }]);
    expect(queries[0].sql).toContain("- 'imageCredit'");
  });

  it('write nothing where nothing is left to write', async () => {
    const { client, queries } = fakeClient();
    await writeHeldWorkFields(client, RIJKSMUSEUM, NIGHT_WATCH, []);
    expect(queries).toEqual([]);
  });

  it('refuse a field the writer does not know, rather than put it into the statement', async () => {
    const { client, queries } = fakeClient();
    await expect(writeHeldWorkFields(client, RIJKSMUSEUM, NIGHT_WATCH, [
      { field: 'curation_state' as never, value: 'verified' },
    ])).rejects.toThrow('A held work field this writer does not know: curation_state');
    expect(queries).toEqual([]);
  });
});
