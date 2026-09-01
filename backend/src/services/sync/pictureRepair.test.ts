/**
 * Tests for the write the two picture repairs share.
 *
 * What a repair puts on a row is a picture a person did not choose, so the
 * three things that can go wrong are all about somebody else's work: a file
 * Wikidata calls an image and is not one, a photograph a curator chose being
 * replaced, and a photographer's name outliving the photograph it was under.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { clearUnshowablePicture, writeFoundPicture } from './pictureRepair.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

const COMMONS = 'http://commons.wikimedia.org/wiki/Special:FilePath/K%C3%B6lner%20Dom.jpg';
const CREDIT = { author: 'Thomas Wolf', license: 'CC BY-SA 3.0 de', licenseUrl: null, detailsUrl: null };

describe('writeFoundPicture', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('writes a Commons picture and its credit in one statement', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });

    const wrote = await writeFoundPicture(126, COMMONS, CREDIT);

    expect(wrote).toBe('written');
    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('image_url = $1');
    expect(params[0]).toBe(COMMONS);
    expect(JSON.parse(String(params[1]))).toEqual({ imageCredit: CREDIT });
  });

  it('takes the credit that was there off before putting the new picture on', async () => {
    // A repair puts a different picture on the row than the one the stored
    // credit described. Merged over rather than replaced, the old photographer's
    // name would stand under the new photograph wherever Commons could not
    // answer for it.
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });

    await writeFoundPicture(126, COMMONS, undefined);

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/- 'imageCredit'\)\s*\|\|\s*\$2::jsonb/);
    expect(JSON.parse(String(params[1]))).toEqual({});
  });

  it('refuses a file the product may not show, without asking the database', async () => {
    // Wikidata's "image file" rule on P18 is a constraint report, not an
    // enforcement: an item can carry a PDF. Written, that row would be
    // re-selected on every run and counted fixed again, for good.
    const wrote = await writeFoundPicture(
      126, 'https://commons.wikimedia.org/wiki/Special:FilePath/Nomination.pdf', undefined,
    );

    expect(wrote).toBe('refused');
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('refuses a picture from a host whose terms do not let us show it', async () => {
    expect(await writeFoundPicture(126, 'https://whc.unesco.org/document/141884', undefined))
      .toBe('refused');
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('leaves a picture a curator owns alone, and says so', async () => {
    // The statement's own guard refuses a claimed row; the answer is read off
    // the row count rather than off a column read beforehand.
    mockedQuery.mockResolvedValueOnce({ rowCount: 0 });

    expect(await writeFoundPicture(126, COMMONS, CREDIT)).toBe('kept');
    expect(String(mockedQuery.mock.calls[0][0])).toContain("curated_fields ? 'image_url'");
  });
});

describe('clearUnshowablePicture', () => {
  beforeEach(() => mockedQuery.mockReset());

  it('takes the picture and its credit off together, unless a curator owns the picture', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });

    expect(await clearUnshowablePicture(311)).toBe(true);
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('image_url = NULL');
    expect(sql).toContain("- 'imageCredit'");
    expect(sql).toContain("curated_fields ? 'image_url'");
  });
});
