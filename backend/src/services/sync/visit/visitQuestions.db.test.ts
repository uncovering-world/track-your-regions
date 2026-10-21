import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A run's questions about offered places with nothing to see (#1770),
 * against PostgreSQL, with Wikidata, the map, Commons, the guide and Jev stood
 * in for: Eboracum, Roman York, offered by Archaeology with no witness and
 * read as not a place.
 */

vi.mock('../../jev/jevClient.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../jev/jevClient.js')>()),
  jevConfigured: () => true,
}));

import { pool } from '../../../db/index.js';
import type { SyncProgress } from '../types.js';
import { askVisitQuestions, type VisitQuestionDoors } from './visitQuestions.js';

const EBORACUM = 9770;
let logId = 0;

const doors = (): VisitQuestionDoors => ({
  sparql: vi.fn(async () => []),
  guide: vi.fn(async () => new Set<string>()),
  osm: vi.fn(async (qids: string[]) => new Map(qids.map((qid) => [qid, []]))),
  photos: vi.fn(async () => []),
  read: vi.fn(async () => ({ reading: 'not-a-place' as const, confidence: 0.9 })),
});

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [EBORACUM]);
  if (logId) await pool.query('DELETE FROM experience_sync_logs WHERE id = $1', [logId]);
}

function progressOf(dryRun = false): SyncProgress {
  return {
    cancel: false, kind: 'sync', status: 'processing', statusMessage: '', progress: 0, total: 0, created: 0,
    updated: 0, unchanged: 0, missing: 0, curatedConflicts: 0, held: 0, filtered: 0, errors: 0, currentItem: '',
    logId, dryRun,
  };
}

const questions = async () => (await pool.query<{ reading: string; witnesses: string[]; answer: string | null }>(
  `SELECT q.reading, q.witnesses, q.answer FROM experience_visit_questions q
     JOIN experience_kind_memberships m ON m.id = q.membership_id WHERE m.experience_id = $1`, [EBORACUM],
)).rows;

beforeEach(async () => {
  await clear();
  logId = (await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status) SELECT id, 'success' FROM experience_sources
      WHERE name = 'Archaeology' RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, 'Q958954', 'Eboracum', ST_SetSRID(ST_MakePoint(-1.0803, 53.9623), 4326)
       FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [EBORACUM],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, curation_state, published_at)
     SELECT $1, s.kind_id, s.id, 'Q958954', 'auto', NOW() FROM experience_sources s WHERE s.name = 'Archaeology'`,
    [EBORACUM],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a run asks a curator about an offered place with nothing to see (#1770)', () => {
  it('raises one question, with the witnesses and the reading, and never asks again', async () => {
    const progress = progressOf();
    await askVisitQuestions(5, progress, { doors: doors() });

    expect(await questions()).toEqual([{ reading: 'not-a-place', witnesses: [], answer: null }]);
    expect(progress.visitQuestions?.asked).toBe(1);

    const again = doors();
    await askVisitQuestions(5, progressOf(), { doors: again });
    expect(again.read).not.toHaveBeenCalled();
    expect(await questions()).toHaveLength(1);
  });

  it('stops on a Cancel without cancelling the run, and asks what it read by then', async () => {
    const progress = progressOf();
    const cancelling = doors();
    cancelling.read = vi.fn(async () => {
      progress.cancel = true;
      return { reading: 'not-a-place' as const, confidence: 0.9 };
    });

    await askVisitQuestions(5, progress, { doors: cancelling });

    expect(progress.cancel).toBe(false);
    expect(progress.askingVisitQuestions).toBe(false);
    expect(progress.visitQuestions).toEqual({ read: 1, short: 1, asked: 1, stopped: true });
    expect(await questions()).toHaveLength(1);
  });

  it('says a Cancel during the witnesses stopped the asking before any place was read, and throws nothing', async () => {
    const progress = progressOf();
    const cancelling = doors();
    cancelling.osm = vi.fn(async () => {
      progress.cancel = true;
      throw new Error('Sync cancelled');
    });

    await askVisitQuestions(5, progress, { doors: cancelling });

    expect(progress.cancel).toBe(false);
    expect(progress.visitQuestions).toEqual({ read: 0, short: 0, asked: 0, stopped: true });
    expect(await questions()).toEqual([]);
  });

  it('writes no question on a preview, and says what it would ask', async () => {
    const progress = progressOf(true);
    await askVisitQuestions(5, progress, { doors: doors() });

    expect(await questions()).toEqual([]);
    expect(progress.visitQuestions).toEqual({ read: 1, short: 1, asked: 1 });
  });

  it('asks nothing of a place whose admission a curator pinned, nor of World Heritage', async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET curated_fields = '["admission"]'::jsonb,
              admission_pin_verdict = 'admitted' WHERE experience_id = $1`,
      [EBORACUM],
    );
    const pinned = doors();
    await askVisitQuestions(5, progressOf(), { doors: pinned });
    expect(pinned.read).not.toHaveBeenCalled();

    const heritage = doors();
    await askVisitQuestions(1, progressOf(), { doors: heritage });
    expect(heritage.sparql).not.toHaveBeenCalled();
    expect(await questions()).toEqual([]);
  });
});
