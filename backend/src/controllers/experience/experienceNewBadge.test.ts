/**
 * The chip answers "a reader could first see this recently", not "a run found it
 * recently" — #529 moved the anchor to `published_at`, because under a gate those
 * are different moments and the old one failed in the ordinary case.
 *
 * These pin the shape of the expression; the behaviour it produces on real rows is
 * checked against the database, because a SQL predicate is exactly the kind of
 * thing that reads correctly and evaluates otherwise.
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
  it('keys off becoming visible, not off the run that found the row', () => {
    const sql = isNewSql();
    expect(sql).toContain('e.published_at IS NOT NULL');
    // The whole of #529: a gated arrival is invisible until a curator answers, so
    // the run that found it is the wrong clock. Two clauses went with the old
    // anchor and must not come back — the `created` changeset proof (which existed
    // only because migration 009 backfilled `first_seen_sync_log_id`) and the
    // latest-completed-run bound (which the window already provides).
    expect(sql).not.toContain('first_seen_sync_log_id');
    expect(sql).not.toContain('change_type');
    expect(sql).not.toContain('completed_at');
  });

  it('lights for an arrival published after a later run of the same category', () => {
    // The case the old predicate could not pass, and the one #529 names as its
    // acceptance: a museum arrives Monday, the category runs again Wednesday, a
    // curator publishes Thursday. Nothing in this expression mentions a run, so
    // the later one cannot switch the chip off.
    const sql = isNewSql();
    expect(sql).not.toMatch(/experience_sync_logs/);
    expect(sql).toMatch(/published_at > NOW\(\) - \(c\.new_badge_days/);
  });

  it('takes the window from the category, since sources have different cadences', () => {
    expect(isNewSql()).toContain("(c.new_badge_days || ' days')::interval");
  });

  it('lets a reader keep it a week from their own first sighting', () => {
    expect(isNewSql()).toContain(`INTERVAL '${NEW_BADGE_PERSONAL_DAYS} days'`);
  });

  it('reads the two windows as alternatives, so neither can shorten the other', () => {
    const sql = isNewSql();
    // A maximum, not a choice: the category window is the floor everyone gets, and
    // a reader who arrives near its end keeps the chip a week from their own first
    // sighting rather than losing it the next day.
    expect(sql).toMatch(/new_badge_days[\s\S]*\)\s*OR\s*EXISTS/);
  });

  it('leaves the anonymous reader with the category window alone', () => {
    // `NULL` for the reader means the personal clause can never match, rather
    // than the whole predicate collapsing: an anonymous reader still gets the
    // category's window.
    expect(isNewSql('e', 'NULL')).toContain('v.user_id = NULL');
  });

  it('takes the user as a placeholder, so the caller keeps parameter numbering', () => {
    expect(isNewSql('e', '$3')).toContain('v.user_id = $3');
  });

  it('qualifies every column it reads off the experience', () => {
    // Interpolated into queries that join several tables, so an unqualified
    // column is an ambiguity error at best and the wrong table's column at worst.
    const sql = isNewSql('x');
    expect(sql).toContain('x.published_at IS NOT NULL');
    expect(sql).toContain('c.id = x.category_id');
    expect(sql).toContain('v.experience_id = x.id');
    expect(sql).not.toMatch(/(?<![.\w])published_at/);
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
