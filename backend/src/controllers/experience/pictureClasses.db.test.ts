import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { picturesOfPlace } from './pictureClassesController.js';

/**
 * Which pictures a review card about a place shows, and so which the picture
 * class asks Commons about (#2192), against PostgreSQL: the place's own, each
 * source's, the pictures its open proposals bring for the place and for its
 * works, and its works' own — each with what it is of, the works with their
 * type. The fixture is a made-up museum in Art Museums with sixty works that
 * have a picture, more than one Commons request holds, and a held change set
 * that proposes a picture for the museum and an engraving for one work: the
 * proposals must come before the works' own pictures, so the cap never cuts
 * the two sides of a picture question. Deleted before and after.
 */

const PLACE = 9466;
const WORKS = 60;
const workIds = (): string[] => Array.from({ length: WORKS }, (_, i) => `Q-work-9466-${String(i).padStart(2, '0')}`);
const commons = (name: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${name}`;
const syncLogs: number[] = [];
let membership = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [workIds()]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, image_url)
     VALUES ($1, 2, 'Q-museum-9466', 'Fixture Museum', ST_SetSRID(ST_MakePoint(12.47, 41.9), 4326), $2)`,
    [PLACE, commons('Museum.jpg')],
  );
  membership = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at,
                                              reported_image_url)
     SELECT $1, s.kind_id, s.id, 'Q-museum-9466', 'admitted', 'verified', NOW(), $2 FROM experience_sources s WHERE s.id = 2
     RETURNING id`,
    [PLACE, commons('Museum%20by%20the%20source.jpg')],
  )).rows[0].id;
  for (const id of workIds()) {
    // The last work's picture is the museum's own too: a shared picture is the place's.
    const picture = id.endsWith('59') ? commons('Museum.jpg') : commons(`${id}.jpg`);
    const work = await pool.query<{ id: number }>(
      `INSERT INTO treasures (external_id, name, treasure_type, curation_state, image_url)
       VALUES ($1, $1, $2, 'verified', $3) RETURNING id`,
      [id, id.endsWith('00') ? 'inscription' : 'painting', picture],
    );
    await pool.query(
      `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, 'verified')`,
      [PLACE, work.rows[0].id],
    );
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("the pictures a place's review card shows (#2192)", () => {
  it("reads the place's own, the source's, the proposals' for the place and its works, then the works', each with what it is of", async () => {
    const log = await pool.query<{ id: number }>(
      `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run) VALUES (2, 'success', NOW(), false) RETURNING id`,
    );
    syncLogs.push(log.rows[0].id);
    await pool.query(
      `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields, contents)
       VALUES ($1, $2, 'Q-museum-9466', 'held', $3, $4)`,
      [log.rows[0].id, PLACE,
        JSON.stringify([{ field: 'imageUrl', new: commons('Museum%20proposed.jpg'), held: true }]),
        JSON.stringify({ treasures: { changed: [{
          item: { name: 'Q-work-9466-00', ref: 'Q-work-9466-00' },
          fields: [{ field: 'imageUrl', old: commons('Q-work-9466-00.jpg'), new: commons('Tablet%20engraving%201865.jpg'), held: true }],
        }] } })],
    );
    await pool.query('UPDATE experience_kind_memberships SET pending_change_sync_log_id = $2 WHERE id = $1', [membership, log.rows[0].id]);

    const pictures = await picturesOfPlace(PLACE);

    expect(pictures.slice(0, 4)).toEqual([
      { url: commons('Museum.jpg'), subject: { kind: 'place' } },
      { url: commons('Museum%20by%20the%20source.jpg'), subject: { kind: 'place' } },
      { url: commons('Museum%20proposed.jpg'), subject: { kind: 'place' } },
      // The engraving proposed for the inscription, with the work's type, before every work's own picture.
      { url: commons('Tablet%20engraving%201865.jpg'), subject: { kind: 'work', type: 'inscription' } },
    ]);
    // One Commons request's worth: the last works' thumbnails lose the mark, never a question's side.
    expect(pictures).toHaveLength(50);
    expect(pictures.slice(4).every(picture => picture.subject.kind === 'work')).toBe(true);
    expect(pictures.find(picture => picture.url === commons('Q-work-9466-00.jpg'))?.subject).toEqual({ kind: 'work', type: 'inscription' });
    expect(pictures.find(picture => picture.url === commons('Q-work-9466-01.jpg'))?.subject).toEqual({ kind: 'work', type: 'painting' });
    // The picture the museum and its last work share is listed once, as the place's.
    expect(pictures.filter(picture => picture.url === commons('Museum.jpg'))).toEqual([{ url: commons('Museum.jpg'), subject: { kind: 'place' } }]);
  });

  it("reads the place's and its works' pictures alone where nothing is proposed", async () => {
    const pictures = await picturesOfPlace(PLACE);
    expect(pictures[0]).toEqual({ url: commons('Museum.jpg'), subject: { kind: 'place' } });
    expect(pictures).toHaveLength(50);
    expect(pictures.filter(picture => picture.subject.kind === 'work')).toHaveLength(48);
    expect(pictures.filter(picture => picture.url === commons('Museum.jpg'))).toEqual([{ url: commons('Museum.jpg'), subject: { kind: 'place' } }]);
  });
});
