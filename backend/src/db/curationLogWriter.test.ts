import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { logCurationAct, logCurationActs, membershipRead } from './curationLogWriter.js';

/** A client that records what it is sent and answers one row. */
function fakeClient() {
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      sent.push({ sql, params });
      return { rows: [{ id: 1, experience_id: params[0] }] };
    }),
  } as unknown as PoolClient;
  return { client, sent };
}

const detailsSent = (params: unknown[]) => JSON.parse(String(params[4]));

describe('the curation log writer (#863)', () => {
  it('names the membership and its kind on an act about one', async () => {
    const { client, sent } = fakeClient();
    await logCurationAct(client, {
      experienceId: 5, curatorId: 7, action: 'kept_out', regionId: 12,
      membership: { id: 40, kindId: 4 }, reasonCode: 'not-worth-a-visit', details: { note: 'a road bridge' },
    });

    expect(sent[0].params.slice(0, 4)).toEqual([5, 7, 'kept_out', 12]);
    expect(detailsSent(sent[0].params)).toEqual({
      note: 'a road bridge', membershipId: 40, kindId: 4, reasonCode: 'not-worth-a-visit',
    });
  });

  it('marks a bulk publish, with its run where it has one', async () => {
    const { client, sent } = fakeClient();
    await logCurationAct(client, { experienceId: 5, curatorId: 7, action: 'published', bulk: { syncLogId: 105 } });
    await logCurationAct(client, { experienceId: 6, curatorId: 7, action: 'published', bulk: { syncLogId: null } });

    expect(detailsSent(sent[0].params)).toEqual({ bulk: true, syncLogId: 105 });
    expect(detailsSent(sent[1].params)).toEqual({ bulk: true });
  });

  it('keeps details null on an act with nothing to say beyond its columns', async () => {
    const { client, sent } = fakeClient();
    await logCurationAct(client, { experienceId: 5, curatorId: null, action: 'merged' });

    expect(sent[0].params).toEqual([5, null, 'merged', null, null]);
  });

  it('records the region through the regions table, so one deleted since reads as none', async () => {
    const { client, sent } = fakeClient();
    await logCurationAct(client, { experienceId: 5, curatorId: 7, action: 'kept_out', regionId: 12 });
    await logCurationActs(client, [{ experienceId: 5, curatorId: 7, action: 'kept_out', regionId: 12 }]);

    expect(sent[0].sql).toContain('(SELECT r.id FROM regions r WHERE r.id = $4::int)');
    expect(sent[1].sql).toContain('(SELECT r.id FROM regions r WHERE r.id = t.region_id)');
  });

  it('writes several acts in one statement, and nothing for none', async () => {
    const { client, sent } = fakeClient();
    await logCurationActs(client, []);
    expect(sent).toHaveLength(0);

    await logCurationActs(client, [
      { experienceId: 5, curatorId: 7, action: 'part_added', regionId: 12, details: { wholeId: 5 } },
      { experienceId: 6, curatorId: 7, action: 'part_added', details: { wholeId: 5 } },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].sql).toContain('unnest(');
    expect(sent[0].params.slice(0, 4)).toEqual([[5, 6], [7, 7], ['part_added', 'part_added'], [12, null]]);
    expect((sent[0].params[4] as string[]).map(details => JSON.parse(details))).toEqual([{ wholeId: 5 }, { wholeId: 5 }]);
  });

  it('reads a membership off a row only where both its id and its kind are there', () => {
    expect(membershipRead({ membership_id: 40, kind_id: 4 })).toEqual({ id: 40, kindId: 4 });
    expect(membershipRead({ membership_id: 40, kind_id: null })).toBeUndefined();
    expect(membershipRead(undefined)).toBeUndefined();
  });
});
