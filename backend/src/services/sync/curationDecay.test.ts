/**
 * The statement that retires a container's pass when new content arrives.
 *
 * A mocked runner can only pin the statement's text. That it actually moves a
 * `verified` row under a trusted source and leaves one under a gated source was
 * proved by executing this statement against a real database, both ways, in the
 * commit that introduced it.
 */

import { describe, it, expect, vi } from 'vitest';

import { retirePassAfterNewContent } from './curationDecay.js';

function fakeRunner() {
  const calls: Array<[string, unknown[]]> = [];
  return {
    calls,
    runner: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push([sql, params]);
        return { rows: [] };
      }),
    },
  };
}

describe('retirePassAfterNewContent', () => {
  it('moves only a verified row, and only for a source nobody gated', async () => {
    const { calls, runner } = fakeRunner();

    await retirePassAfterNewContent(runner, 501);

    const [sql, params] = calls[0];
    expect(sql).toContain("SET curation_state = 'auto'");
    // Scoped to `verified`, so the statement can only ever move a row one way.
    // A `pending` row is not published and has nothing to decay; an `auto` row
    // is already there.
    expect(sql).toContain("e.curation_state = 'verified'");
    // The gate is read through the experience, because these writers have an
    // experience id and no category id. Under a gated source the new content was
    // written `pending` — nothing a reader sees changed, so the pass still holds.
    expect(sql).toContain('c.id = e.category_id AND c.requires_curation');
    expect(sql).toContain('NOT EXISTS');
    expect(params).toEqual([501]);
  });

  it('never writes any state but auto', async () => {
    const { calls, runner } = fakeRunner();

    await retirePassAfterNewContent(runner, 501);

    // A run may retire a pass; it may not award one, and it may not hide a row
    // that is already published.
    const [sql] = calls[0];
    expect(sql).not.toContain("SET curation_state = 'pending'");
    expect(sql).not.toContain("SET curation_state = 'verified'");
  });
});
