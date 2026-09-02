/**
 * Tests for the two arms that act on a museum's links after its works are
 * written (ADR-0044).
 *
 * Both are one UPDATE each, and everything they promise lives in the WHERE: the
 * restore must reach only marked links of offered works, and the mark must
 * reach only unmarked links of unoffered works — and must pass over the one
 * shape a gated source makes dangerous, a visible link whose work this run
 * places somewhere no reader can see yet. A mocked pool cannot see which rows
 * Postgres picks; what it can pin is that every term is in the statement, that
 * the numbers bind where the terms expect them, and that the two arms share one
 * transaction. The statements themselves were run against the dev database in
 * a rolled-back transaction when they were written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  pool: { connect: vi.fn() },
  rollbackQuietly: vi.fn().mockResolvedValue(undefined),
  db: {},
}));

import { pool, rollbackQuietly } from '../../../db/index.js';
import { reconcileLinks } from './linkWithdrawal.js';

const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;
const mockedRollback = rollbackQuietly as unknown as ReturnType<typeof vi.fn>;
const EXPERIENCE_ID = 77;

/** One client per call, its statements recorded in order. */
function makeClient(answers: Record<string, { rows?: unknown[] } | Error> = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    const key = Object.keys(answers).find(k => sql.includes(k));
    const answer = key ? answers[key] : { rows: [] };
    if (answer instanceof Error) throw answer;
    return { rows: [], ...answer };
  });
  const client = { query, release: vi.fn() };
  mockedConnect.mockResolvedValue(client);
  return client;
}

/** Every statement the call sent, whitespace collapsed so indentation cannot break a match. */
function sent(client: { query: ReturnType<typeof vi.fn> }): string[] {
  return client.query.mock.calls.map(call => String(call[0]).replace(/\s+/g, ' '));
}

const RESTORE = 'SET missing_since = NULL';
const MARK = 'SET missing_since = NOW()';

beforeEach(() => {
  mockedConnect.mockReset();
  mockedRollback.mockReset();
  mockedRollback.mockResolvedValue(undefined);
});

describe('reconcileLinks', () => {
  it('locks the object first, then runs the restore and the mark, in one transaction', async () => {
    const client = makeClient();

    await reconcileLinks(EXPERIENCE_ID, { offered: [900], placedElsewhere: [], withdraw: true });

    const statements = sent(client);
    expect(statements[0]).toBe('BEGIN');
    // The rule every contents transaction follows (`db/locks.ts`): a curator
    // publishing this museum's works holds the object and wants these link
    // rows, so both take the object first and neither can be half of a cycle.
    expect(statements[1]).toBe('SELECT id FROM experiences WHERE id = $1 FOR NO KEY UPDATE');
    expect(client.query.mock.calls[1][1]).toEqual([EXPERIENCE_ID]);
    expect(statements[2]).toContain(RESTORE);
    expect(statements[3]).toContain(MARK);
    expect(statements[4]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('rolls both back when the mark fails, so a restore never lands without its record', async () => {
    // A restore that committed while the mark threw would be a return the
    // run's record never carries — the museum is recorded as failed — and a
    // retry could not tell it had happened, since missing_since is already null.
    const client = makeClient({ [MARK]: new Error('deadlock') });

    await expect(reconcileLinks(EXPERIENCE_ID, {
      offered: [900], placedElsewhere: [], withdraw: true,
    })).rejects.toThrow('deadlock');

    expect(sent(client)).not.toContain('COMMIT');
    expect(mockedRollback).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalled();
  });

  it('destroys the client when the rollback fails too', async () => {
    const client = makeClient({ [MARK]: new Error('deadlock') });
    const dead = new Error('connection lost');
    mockedRollback.mockResolvedValueOnce(dead);

    await expect(reconcileLinks(EXPERIENCE_ID, {
      offered: [900], placedElsewhere: [], withdraw: true,
    })).rejects.toThrow('deadlock');

    expect(client.release).toHaveBeenCalledWith(dead);
  });

  it('restores without marking while the floor stands', async () => {
    // Floor first, withdrawal second: restoring is never what a short run gets
    // wrong, so it is not gated.
    const client = makeClient();

    const delta = await reconcileLinks(EXPERIENCE_ID, {
      offered: [900], placedElsewhere: [], withdraw: false,
    });

    const statements = sent(client);
    expect(statements.some(s => s.includes(RESTORE))).toBe(true);
    expect(statements.some(s => s.includes(MARK))).toBe(false);
    expect(delta.withdrawn).toEqual([]);
  });

  it('sends nothing for a museum with no works, rather than an empty ANY', async () => {
    // Not a shape the pipeline produces — a museum is admitted for a work it
    // holds — and the one reading that is never destructive.
    expect(await reconcileLinks(EXPERIENCE_ID, {
      offered: [], placedElsewhere: ['Q12418'], withdraw: true,
    })).toEqual({ returned: [], withdrawn: [] });
    expect(mockedConnect).not.toHaveBeenCalled();
  });
});

describe('the restore', () => {
  it('clears the mark on the offered works only, among the marked links only', async () => {
    const client = makeClient();

    await reconcileLinks(EXPERIENCE_ID, { offered: [900, 901], placedElsewhere: [], withdraw: true });

    const sql = sent(client).find(s => s.includes(RESTORE))!;
    expect(sql).toContain('et.experience_id = $1');
    expect(sql).toContain('et.missing_since IS NOT NULL');
    expect(sql).toContain('et.treasure_id = ANY($2::int[])');
    expect(sql).not.toContain('NOT (et.treasure_id = ANY');
    const call = client.query.mock.calls.find(c => String(c[0]).includes(RESTORE))!;
    expect(call[1]).toEqual([EXPERIENCE_ID, [900, 901]]);
  });

  it('leaves the state a curator gave the link alone', async () => {
    // A link passed before it was marked is on show again at once, like a
    // returned point; a link never passed stays waiting on its card.
    const client = makeClient();

    await reconcileLinks(EXPERIENCE_ID, { offered: [900], placedElsewhere: [], withdraw: true });

    expect(sent(client).find(s => s.includes(RESTORE))).not.toMatch(/curation_state\s*=/);
  });

  it('names each work it gave a place back to, from the stored row', async () => {
    const client = makeClient({ [RESTORE]: { rows: [
      { name: 'The Night Watch', external_id: 'Q219831' },
    ] } });

    const delta = await reconcileLinks(EXPERIENCE_ID, { offered: [900], placedElsewhere: [], withdraw: true });

    expect(delta.returned).toEqual([{ name: 'The Night Watch', ref: 'Q219831' }]);
    expect(sent(client).find(s => s.includes(RESTORE))).toContain('RETURNING t.name, t.external_id');
  });
});

describe('the mark', () => {
  async function markSql(placedElsewhere: string[] = ['Q12418']) {
    const client = makeClient();
    await reconcileLinks(EXPERIENCE_ID, { offered: [900, 901], placedElsewhere, withdraw: true });
    const call = client.query.mock.calls.find(c => String(c[0]).includes(MARK))!;
    return { sql: String(call[0]).replace(/\s+/g, ' '), params: call[1] as unknown[] };
  }

  it('marks the links of works the run did not offer, among the unmarked links only', async () => {
    const { sql, params } = await markSql();

    expect(sql).toContain('et.experience_id = $1');
    // Going missing *now*: a link unoffered for the fifth run running was first
    // observed missing once, and restamping it would churn the table.
    expect(sql).toContain('et.missing_since IS NULL');
    expect(sql).toContain('NOT (et.treasure_id = ANY($2::int[]))');
    expect(params).toEqual([EXPERIENCE_ID, [900, 901], ['Q12418']]);
  });

  it('marks, never deletes', async () => {
    const { sql } = await markSql();

    expect(sql).toMatch(/^UPDATE experience_treasures/);
    expect(sql).not.toContain('DELETE');
  });

  it('holds a visible link of a work this run places elsewhere, while no readable link of it stands', async () => {
    const { sql } = await markSql();
    const hold = sql.slice(sql.indexOf('AND NOT ('), sql.indexOf('RETURNING'));

    // Visible: the link, the work, and the museum all past the gate — the
    // same three `getExperienceTreasures` asks, plus the museum's admission.
    expect(hold).toContain("et.curation_state <> 'pending'");
    expect(hold).toContain("t.curation_state <> 'pending'");
    expect(hold).toContain("e.curation_state <> 'pending'");
    expect(hold).toContain("e.admission <> 'refused'");
    // Placed elsewhere *this run*, from the proposal rather than the table:
    // the new museum may be written after this one, so at this museum's turn
    // its link is not there to be found.
    expect(hold).toContain('t.external_id = ANY($3::text[])');
    // ...and no readable twin yet: offered, past the gate, at a museum past the
    // gate and not refused. A museum still pending under a switched-off gate
    // holds `auto` links no reader can see, which is why the museum's own
    // state is asked and not only the link's.
    expect(hold).toContain('NOT EXISTS');
    expect(hold).toContain('twin.treasure_id = et.treasure_id');
    expect(hold).toContain('twin.id <> et.id');
    expect(hold).toContain('twin.missing_since IS NULL');
    expect(hold).toContain("twin.curation_state <> 'pending'");
    expect(hold).toContain("te.curation_state <> 'pending'");
    expect(hold).toContain("te.admission <> 'refused'");
  });

  it('holds nothing that a reader cannot see, and nothing the run places nowhere', async () => {
    // The hold is one conjunction, negated whole: an unread link, a link of an
    // unread work or at an unread museum, and a link of a work the run has
    // dropped altogether are all marked at once — the first three cost a
    // reader nothing, and the last has no new place to wait for.
    const { sql } = await markSql();
    const hold = sql.slice(sql.indexOf('AND NOT ('), sql.indexOf('RETURNING'));

    expect(hold.indexOf("et.curation_state <> 'pending'")).toBeLessThan(hold.indexOf('$3'));
    expect(hold.indexOf('$3')).toBeLessThan(hold.indexOf('NOT EXISTS'));
  });

  it('names each work it marked, from the stored row', async () => {
    makeClient({ [MARK]: { rows: [
      { name: 'Ophelia', external_id: 'Q1246930' },
      { name: 'The Syndics', external_id: 'Q2379280' },
    ] } });

    const delta = await reconcileLinks(EXPERIENCE_ID, { offered: [900], placedElsewhere: [], withdraw: true });

    expect(delta.withdrawn).toEqual([
      { name: 'Ophelia', ref: 'Q1246930' },
      { name: 'The Syndics', ref: 'Q2379280' },
    ]);
  });
});
