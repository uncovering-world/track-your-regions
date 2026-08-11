/**
 * The chip answers "arrived in the latest run", not "created recently".
 *
 * These pin the shape of the expression; the behaviour it produces on real
 * rows is checked against the database, because a SQL predicate is exactly the
 * kind of thing that reads correctly and evaluates otherwise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../../db/index.js';
import { isNewSql, NEW_BADGE_PERSONAL_DAYS, markNewBadgesSeen } from './experienceNewBadge.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

describe('isNewSql', () => {
  it('keys off the run the row arrived in, not when the row was created', () => {
    const sql = isNewSql();

    expect(sql).toContain('first_seen_sync_log_id');
    // `created_at` is what the client-side heuristic used, and it measures
    // something else: a row created last week may have been in the source for
    // a decade. (The converse does not hold — `first_seen_sync_log_id` is
    // INSERT-only, so an old row's first sighting is old. The one case where
    // an old row points at a recent run is 009's backfill, which the next test
    // covers and the predicate rejects.)
    expect(sql).not.toContain('created_at');
  });

  it('wants the arrival observed, not merely attributed to a run', () => {
    // Migration 009 backfilled `first_seen_sync_log_id` to the newest run of
    // each category for every pre-existing row. Trusting that attribution puts
    // the chip on the entire catalogue the day this ships — 1547 of 1547 rows,
    // measured — until each category next runs. A changeset row of type
    // `created` is the difference between a sighting and a guess.
    const sql = isNewSql().replace(/\s+/g, ' ');

    expect(sql).toContain('experience_sync_changes');
    expect(sql).toContain("change_type = 'created'");
  });

  it('asks about first arrival, which a return does not reset', () => {
    // `first_seen_sync_log_id` is written on INSERT and never on update, so a
    // row that went missing and came back keeps the run it arrived in. The
    // predicate must not reach for anything that a return would move —
    // `last_seen_sync_log_id` is exactly that.
    const sql = isNewSql();

    expect(sql).toContain('first_seen_sync_log_id');
    expect(sql).not.toContain('last_seen_sync_log_id');
  });

  it('ignores previews, which write a changeset but change nothing', () => {
    expect(isNewSql()).toContain('is_dry_run = FALSE');
  });

  it('ignores a run still in progress, whose arrivals are not all in yet', () => {
    expect(isNewSql()).toContain('completed_at IS NOT NULL');
  });

  it('finds the latest run by when it finished, not by its id', () => {
    // id order is creation order. A run that started earlier can finish later,
    // and taking the highest id then names a run from months ago as "latest",
    // which switches every chip in the category off at once.
    const sql = isNewSql().replace(/\s+/g, ' ');

    expect(sql).toContain('ORDER BY l.completed_at DESC, l.id DESC');
  });

  it('takes the window from the category, since sources have different cadences', () => {
    expect(isNewSql()).toContain('new_badge_days');
  });

  it('lets a reader keep it a week from their own first sighting', () => {
    expect(isNewSql()).toContain(`INTERVAL '${NEW_BADGE_PERSONAL_DAYS} days'`);
    expect(isNewSql()).toContain('user_new_badge_views');
  });

  it('reads the two windows as alternatives, so neither can shorten the other', () => {
    // The category window is a floor, not a competing rule: a reader arriving
    // near its end keeps the chip a week longer, and one who never sees it
    // still had the whole category window to.
    const sql = isNewSql().replace(/\s+/g, ' ');

    expect(sql).toMatch(/new_badge_days.*\) OR EXISTS/);
  });

  it('leaves the anonymous reader with the category window alone', () => {
    // `v.user_id = NULL` is never true, so the personal clause drops out
    // rather than needing a separate query for logged-out readers.
    expect(isNewSql('e')).toContain('v.user_id = NULL');
  });

  it('takes the user as a placeholder, so the caller keeps parameter numbering', () => {
    expect(isNewSql('e', '$3')).toContain('v.user_id = $3');
  });

  it('qualifies every column it reads off the experience', () => {
    const sql = isNewSql('ex');

    expect(sql).toContain('ex.first_seen_sync_log_id');
    expect(sql).toContain('ex.category_id');
    expect(sql).toContain('v.experience_id = ex.id');
  });
});

describe('markNewBadgesSeen', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [{ experience_id: 4 }] });
  });

  it('keeps the first impression and ignores later ones', async () => {
    await markNewBadgesSeen(
      { user: { id: 9 }, body: { experienceIds: [4] } } as never, makeRes() as never);

    // DO UPDATE would restart the week on every later view, and the chip would
    // follow a returning reader around indefinitely
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('DO NOTHING');
    expect(sql).not.toContain('DO UPDATE');
  });

  it('survives an id the reader no longer has', async () => {
    await markNewBadgesSeen(
      { user: { id: 9 }, body: { experienceIds: [4, 999] } } as never, makeRes() as never);

    // Inserting the ids directly would let the foreign key reject the whole
    // statement for one stale id, and a client a moment out of date is normal
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain('SELECT $1, id FROM experiences');
    expect(sql).toContain('id = ANY($2::int[])');
  });

  it('records a sighting only for a row this reader could have been shown', async () => {
    await markNewBadgesSeen(
      { user: { id: 9 }, body: { experienceIds: [4] } } as never, makeRes() as never);

    // This writes a claim ("they saw its chip") and answers with the ids it
    // accepted, so without these it confirms an unread row exists and records a
    // sighting of a chip that was never on screen. A chip cannot legitimately be
    // seen on an unread row: the only read that renders one carries the gate.
    // `existence` stays out, matching the by-id reads — a chip seen on something
    // since lost was still seen.
    const sql = String(mockedQuery.mock.calls[0][0]);
    expect(sql).toContain("experiences.admission <> 'refused'");
    expect(sql).toContain("experiences.curation_state <> 'pending'");
    expect(sql).not.toContain('existence');
  });

  it('reports what it actually recorded, not what it was asked to', async () => {
    const res = makeRes();

    await markNewBadgesSeen(
      { user: { id: 9 }, body: { experienceIds: [4, 5] } } as never, res as never);

    expect(res.json).toHaveBeenCalledWith({ recorded: [4] });
  });

  it('writes for the caller, never for an id in the body', async () => {
    await markNewBadgesSeen(
      { user: { id: 9 }, body: { experienceIds: [4] } } as never, makeRes() as never);

    expect(mockedQuery.mock.calls[0][1]).toEqual([9, [4]]);
  });
});
