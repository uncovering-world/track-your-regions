import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import { buildCoveringSet, refineCoveringSet, type CandidateInfo } from './geoshapeCoverage.js';

const query = vi.mocked(pool.query);

// Lower Egypt (Q463871) as GADM holds it: Africa > Egypt > governorates.
const AFRICA = 827;
const EGYPT = 57437;
const CAIRO = 57583;
const SUEZ = 57649;
const SHARQIYAH = 57657;
const UNORGANIZED_SHARQIYAH = 57675;

const PARENT_OF = new Map<number, number | null>([
  [AFRICA, null],
  [EGYPT, AFRICA],
  [CAIRO, EGYPT],
  [SUEZ, EGYPT],
  [SHARQIYAH, EGYPT],
  [UNORGANIZED_SHARQIYAH, SHARQIYAH],
]);

function candidate(id: number, name: string, gadmDepth: number, coverage: number): CandidateInfo {
  return {
    id,
    name,
    path: name,
    parentId: PARENT_OF.get(id) ?? null,
    gadmDepth,
    coverage,
    intersectionArea: coverage * 1000,
    gadmArea: 1_000_000,
  };
}

function infoMap(...entries: CandidateInfo[]): Map<number, CandidateInfo> {
  return new Map(entries.map(e => [e.id, e]));
}

describe('buildCoveringSet', () => {
  it('keeps the shallowest division and none beneath it', () => {
    const set = buildCoveringSet(
      infoMap(
        candidate(EGYPT, 'Egypt', 1, 1),
        candidate(AFRICA, 'Africa', 0, 1),
        candidate(CAIRO, 'Al Qahirah', 2, 0.6),
      ),
      new Set(),
      PARENT_OF,
    );
    expect(set.map(c => c.id)).toEqual([AFRICA]);
  });

  it('sees an ancestor through a parent that is not a candidate itself', () => {
    // Ash Sharqiyah is already suggested, so it is out of the info map, but its
    // child still sits under Egypt.
    const set = buildCoveringSet(
      infoMap(
        candidate(EGYPT, 'Egypt', 1, 1),
        candidate(UNORGANIZED_SHARQIYAH, 'Unorganized in Ash Sharqiyah', 3, 0.05),
      ),
      new Set(),
      PARENT_OF,
    );
    expect(set.map(c => c.id)).toEqual([EGYPT]);
  });
});

describe('refineCoveringSet', () => {
  beforeEach(() => {
    query.mockReset();
  });

  function childrenOf(rows: Record<number, Array<[number, string, number, number]>>): void {
    query.mockImplementation(((_sql: string, params: unknown[]) => {
      const parentId = params[1] as number;
      const children = rows[parentId] ?? [];
      return Promise.resolve({
        rows: children.map(([id, name, intersection, gadm]) => ({
          id, name, parent_id: parentId, intersection_area: intersection, gadm_area: gadm, path: name,
        })),
      });
    }) as unknown as typeof pool.query);
  }

  it('replaces an imprecise division by its children, leaving out the excluded ones', async () => {
    childrenOf({
      [EGYPT]: [
        [CAIRO, 'Al Qahirah', 600, 700],
        [SUEZ, 'As Suways', 300, 400],
        [SHARQIYAH, 'Ash Sharqiyah', 100, 150],
      ],
    });
    const refined = await refineCoveringSet(
      [candidate(EGYPT, 'Egypt', 1, 1)],
      'Q463871',
      1000,
      new Set([SUEZ]),
    );
    expect(refined.map(c => c.id)).toEqual([CAIRO, SHARQIYAH]);
  });

  it('counts an excluded child towards replacing its parent', async () => {
    // Without Al Qahirah the other two cover 40% of Egypt's overlap, under the
    // 80% a replacement needs; with it they cover all of it.
    childrenOf({
      [EGYPT]: [
        [CAIRO, 'Al Qahirah', 600, 700],
        [SUEZ, 'As Suways', 300, 400],
        [SHARQIYAH, 'Ash Sharqiyah', 100, 150],
      ],
    });
    const refined = await refineCoveringSet(
      [candidate(EGYPT, 'Egypt', 1, 1)],
      'Q463871',
      1000,
      new Set([CAIRO]),
    );
    expect(refined.map(c => c.id)).toEqual([SUEZ, SHARQIYAH]);
  });
});
