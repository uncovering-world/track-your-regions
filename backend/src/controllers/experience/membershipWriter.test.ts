/**
 * The curator's writes to a place's membership (#1148): each names the
 * membership the handler read under the place's lock, a confirmed refusal
 * clears the must-see flag the way a rule's refusal does, and the manual
 * create's membership is written for the place whose token it spends.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { CLEAR_ICONIC } from '../../services/sync/admission.js';
import {
  answerAdmissionOnMembership, clearHeldPointer, insertManualMembership, publishMembership, refuseOnMembership,
} from './membershipWriter.js';

/** The Kunsthalle Bremen, as the token a lock of it would hand out, and its one membership. */
const KUNSTHALLE = { id: 412 } as LockedExperience;
const MEMBERSHIP = 9031;

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

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('answering a refusal', () => {
  it('confirms unpinned: marks the answer, keeps the reason, clears the flag, publishes nothing', async () => {
    const { client, queries } = fakeClient();
    await answerAdmissionOnMembership(client, KUNSTHALLE, MEMBERSHIP, {
      admitted: false, pin: false, publishes: false, reason: 'no works of its own', curated: [],
    });
    const sql = collapse(queries[0].sql);
    expect(sql).toContain('UPDATE experience_kind_memberships m');
    expect(sql).toContain('admission_answered_at = NOW()');
    expect(sql).toContain(collapse(CLEAR_ICONIC));
    expect(sql).not.toContain('published_at');
    expect(queries[0].params).toEqual([MEMBERSHIP, 'refused', 'no works of its own', '[]', KUNSTHALLE.id]);
  });

  it('overrides an arrival: admits, publishes, and leaves the flag alone', async () => {
    const { client, queries } = fakeClient();
    await answerAdmissionOnMembership(client, KUNSTHALLE, MEMBERSHIP, {
      admitted: true, pin: true, publishes: true, reason: null, curated: ['admission'],
    });
    const sql = collapse(queries[0].sql);
    expect(sql).toContain('admission_answered_at = NULL');
    expect(sql).toContain("curation_state = 'verified', published_at = COALESCE(published_at, NOW())");
    expect(sql).not.toContain('is_iconic');
    expect(queries[0].params).toEqual([MEMBERSHIP, 'admitted', null, '["admission"]', KUNSTHALLE.id]);
  });
});

describe('the other curator writes', () => {
  it('refuses an arrival with the pin and the flag cleared', async () => {
    const { client, queries } = fakeClient();
    await refuseOnMembership(client, KUNSTHALLE, MEMBERSHIP, 'kept out by a curator', ['admission']);
    expect(collapse(queries[0].sql)).toContain(collapse(CLEAR_ICONIC));
    expect(queries[0].params).toEqual([MEMBERSHIP, 'kept out by a curator', '["admission"]', KUNSTHALLE.id]);
  });

  it('publishes with the assignments it was handed, the timestamp last', async () => {
    const { client, queries } = fakeClient();
    await publishMembership(client, KUNSTHALLE, MEMBERSHIP, ["curation_state = 'verified'"]);
    expect(collapse(queries[0].sql)).toContain("SET curation_state = 'verified', updated_at = NOW() WHERE id = $1 AND experience_id = $2");
    expect(queries[0].params).toEqual([MEMBERSHIP, KUNSTHALLE.id]);
  });

  it('clears the held pointer of the membership named', async () => {
    const { client, queries } = fakeClient();
    await clearHeldPointer(client, KUNSTHALLE, MEMBERSHIP);
    expect(collapse(queries[0].sql)).toContain('SET pending_change_sync_log_id = NULL');
    expect(collapse(queries[0].sql)).toContain('WHERE id = $1 AND experience_id = $2');
    expect(queries[0].params).toEqual([MEMBERSHIP, KUNSTHALLE.id]);
  });

  it('inserts the manual create\'s membership for the place whose token it spends', async () => {
    const { client, queries } = fakeClient();
    await insertManualMembership(client, KUNSTHALLE, 2, null);
    expect(collapse(queries[0].sql)).toContain('INSERT INTO experience_kind_memberships');
    expect(queries[0].params).toEqual([412, 2, null]);
  });
});
