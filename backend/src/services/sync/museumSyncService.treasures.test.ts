/**
 * Tests for the works a museum puts on show.
 *
 * Two promises on this path live in a parameter number and a `RETURNING` clause,
 * and neither announces itself when it breaks. A treasure is globally shared, so
 * its `curation_state` cannot be reached through an experience and reads the gate
 * from the museum category, bound positionally as the last of twelve parameters
 * whose other members are mostly numbers — swap it with a sitelink threshold and
 * the statement still runs, still type-checks, and stamps by whether `140`
 * happens to be a gated category id. And the link's `ON CONFLICT DO NOTHING ...
 * RETURNING treasure_id` is the only thing telling "the museum gained a work"
 * from "the run listed one it already had", which is what decides whether a
 * curator's pass over the whole museum is retired.
 *
 * The stamps themselves were proved against a real database in the commit that
 * added them: a gated category writing `pending`, a trusted one writing `auto`,
 * and a stored work keeping the state a curator gave it. What a live run cannot
 * tell apart from luck is which value the gate was reading, and whether a link
 * that was already there counted as an arrival — which is what these pin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn() },
  db: {},
}));

vi.mock('./curationDecay.js', () => ({
  retirePassAfterNewContent: vi.fn(),
}));

import { pool } from '../../db/index.js';
import { retirePassAfterNewContent } from './curationDecay.js';
import { upsertMuseumTreasures } from './museumSyncService.js';
import type { ProcessedContent } from './types.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockedRetire = retirePassAfterNewContent as unknown as ReturnType<typeof vi.fn>;

/** `Top Art Museums` — the category a treasure's gate is read from. */
const MUSEUM_CATEGORY_ID = 2;
const EXPERIENCE_ID = 77;

function artwork(overrides: Partial<ProcessedContent> = {}): ProcessedContent {
  return {
    externalId: 'Q12418',
    name: 'Mona Lisa',
    treasureType: 'painting',
    artist: 'Leonardo da Vinci',
    year: 1503,
    imageUrl: 'https://upload.wikimedia.org/mona-lisa.jpg',
    sitelinksCount: 140,
    ...overrides,
  };
}

/**
 * Answer the two statements each work sends, in order: the treasure upsert always
 * returns an id, and the link returns a row only when it was really inserted —
 * `DO NOTHING` returns none.
 */
function scriptWorks(...links: Array<'new' | 'already linked'>) {
  links.forEach((kind, index) => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 900 + index }] });
    mockedQuery.mockResolvedValueOnce({
      rows: kind === 'new' ? [{ treasure_id: 900 + index }] : [],
    });
  });
}

const treasureCall = () => mockedQuery.mock.calls[0];
const linkCall = () => mockedQuery.mock.calls[1];

describe('a work arrives marked as unread', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  it('reads the gate from the museum category, whatever number that parameter takes', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Resolved through the statement rather than asserted as `$12`: the position
    // is not the promise, the value reaching it is. Renumber the list and this
    // still passes; bind the gate to `ICONIC_RELEASE` and it fails.
    const sql = String(treasureCall()[0]);
    const gate = /requires_curation FROM experience_categories WHERE id = \$(\d+)\)/.exec(sql);
    expect(gate, 'the treasure insert no longer reads the gate at all').not.toBeNull();

    const params = treasureCall()[1] as unknown[];
    expect(params[Number(gate![1]) - 1]).toBe(MUSEUM_CATEGORY_ID);
  });

  it('stamps a work on arrival only, so a pass on a stored work survives the run', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // A treasure is shared by every museum holding it, and a run that found it
    // again has learnt nothing about whether a person has looked at it.
    const sql = String(treasureCall()[0]);
    const onUpdate = sql.slice(sql.indexOf('DO UPDATE SET'));
    expect(sql.slice(0, sql.indexOf('DO UPDATE SET'))).toContain('curation_state');
    expect(onUpdate).not.toContain('curation_state');
  });

  it('reads a link\'s gate through the experience the work is shown in', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    // Unlike the treasure, a link belongs to one museum, so it can reach the
    // category the way every other content row does.
    const sql = String(linkCall()[0]);
    expect(sql).toMatch(/FROM experiences e JOIN experience_categories c ON c\.id = e\.category_id/);
    expect(sql).toMatch(/WHERE e\.id = \$1/);
    expect(linkCall()[1]).toEqual([EXPERIENCE_ID, 900]);
  });
});

describe('new works retire the pass that covered the museum', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedRetire.mockReset();
  });

  it('retires the pass when the museum gained a work', async () => {
    scriptWorks('new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork()]);

    expect(mockedRetire).toHaveBeenCalledTimes(1);
    expect(mockedRetire).toHaveBeenCalledWith(pool, EXPERIENCE_ID);
  });

  it('retires nothing when every work was already on show', async () => {
    scriptWorks('already linked', 'already linked');

    await upsertMuseumTreasures(EXPERIENCE_ID, [artwork(), artwork({ externalId: 'Q45585' })]);

    // The whole point of `RETURNING treasure_id` on a `DO NOTHING`: a run that
    // re-lists the same twelve paintings has not changed what is on show, and
    // retiring a curator's pass over it every night would leave the queue saying
    // nothing. Without the returned row this is indistinguishable from an insert.
    expect(mockedRetire).not.toHaveBeenCalled();
  });

  it('retires once for a museum that gained two works, not once per work', async () => {
    scriptWorks('new', 'already linked', 'new');

    await upsertMuseumTreasures(EXPERIENCE_ID, [
      artwork(),
      artwork({ externalId: 'Q45585' }),
      artwork({ externalId: 'Q19911' }),
    ]);

    // The fact is that the pass no longer covers everything on show, and it is
    // one fact whether one work arrived or twelve.
    expect(mockedRetire).toHaveBeenCalledTimes(1);
  });
});
