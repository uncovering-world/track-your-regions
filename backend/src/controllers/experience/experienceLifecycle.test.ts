/**
 * Tests for the lifecycle fragments the read paths share.
 *
 * The behaviour worth pinning is the asymmetry: `former` changes nothing about
 * who sees what, `lost` leaves everywhere except a visit, and neither happens
 * to an object a run merely flagged.
 */

import { describe, it, expect } from 'vitest';
import {
  hideLostSql,
  hideRefusedSql,
  lifecycleSelectSql,
  includeLost,
  offeredLocationSql,
} from './experienceLifecycle.js';

describe('offeredLocationSql', () => {
  it('hides a point the source stopped offering', () => {
    expect(offeredLocationSql()).toContain('missing_since IS NULL');
  });

  it('defaults to the alias the location queries use', () => {
    expect(offeredLocationSql()).toContain('el.missing_since');
    expect(offeredLocationSql('loc')).toContain('loc.missing_since');
  });

  it('comes bare, like its neighbour, since callers append it either way', () => {
    expect(offeredLocationSql().trimStart()).not.toMatch(/^AND/);
  });
});

describe('hideLostSql', () => {
  it('hides only what no longer exists', () => {
    const sql = hideLostSql();

    expect(sql).toContain("existence <> 'lost'");
    // `former` is a claim about the source's catalogue, not about the world:
    // the place is still there and still worth going to
    expect(sql).not.toContain('source_membership');
    // A run's flag is an observation, not a verdict — nothing public may hang
    // on it, or a source outage would empty the map
    expect(sql).not.toContain('missing_since');
  });

  it('qualifies the column, so it can join a query with more than one table', () => {
    expect(hideLostSql('ex')).toContain("ex.existence <> 'lost'");
  });

  it('comes bare, since some callers push it into a conditions array', () => {
    expect(hideLostSql().trimStart()).not.toMatch(/^AND/);
  });
});

describe('hideRefusedSql', () => {
  it('hides only what this category turned down', () => {
    const sql = hideRefusedSql();

    expect(sql).toContain("admission <> 'refused'");
    // Not a claim about the world. The British Museum stands open and Wikidata
    // still lists it; what changed is which of our categories claims it.
    expect(sql).not.toContain('existence');
    expect(sql).not.toContain('source_membership');
    // A refusal is a decision with a reason, and the reason is for the curator
    // to read — the predicate must not depend on the run's flag (ADR-0024).
    expect(sql).not.toContain('missing_since');
  });

  it('qualifies the column, so it can join a query with more than one table', () => {
    expect(hideRefusedSql('ex')).toContain("ex.admission <> 'refused'");
  });

  it('comes bare, since some callers push it into a conditions array', () => {
    expect(hideRefusedSql().trimStart()).not.toMatch(/^AND/);
  });

  it('is a separate predicate from the lost one, not the same rule renamed', () => {
    // The two are toggled independently: the curation queue asks for refused
    // rows and the "show what is gone" affordance asks for lost ones.
    expect(hideRefusedSql()).not.toEqual(hideLostSql());
  });
});

describe('lifecycleSelectSql', () => {
  it('carries both axes, since a card labels one and history needs the other', () => {
    const sql = lifecycleSelectSql();

    expect(sql).toContain('source_membership');
    expect(sql).toContain('existence');
  });

  it('carries the flag, so a correction can send the row as it was seen', () => {
    // `POST /:id/state` compares `expected` against the locked row, flag
    // included. Inferring it from the verdict would be an assumption where the
    // truth is one column away.
    expect(lifecycleSelectSql()).toContain('missing_since');
  });
});

describe('includeLost', () => {
  it('is off unless the caller asks', () => {
    expect(includeLost({})).toBe(false);
    expect(includeLost({ includeLost: 'false' })).toBe(false);
    // A truthy-looking string is not the ask: only the explicit value counts,
    // or a stray `?includeLost=0` would put demolished sites back on the map
    expect(includeLost({ includeLost: '0' })).toBe(false);
    expect(includeLost({ includeLost: 'yes' })).toBe(false);
  });

  it('accepts the query-string and the parsed form', () => {
    expect(includeLost({ includeLost: 'true' })).toBe(true);
    expect(includeLost({ includeLost: true })).toBe(true);
  });
});
