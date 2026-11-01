/**
 * A region's tail (ADR-0172): the statements read the region's offered places
 * a crowded city crowds out, by the reader's own placement and less what a
 * curator rejected from the region, the best known first, each under the kind
 * it is crowded out of.
 */

import { describe, expect, it } from 'vitest';
import { membershipCrowdedSql, membershipOfferedSql, placeShownSql } from '../../db/membership.js';
import { experienceOfferedToReaderSql, readerRegionMembershipSql } from '../../db/readerPredicates.js';
import { buildRegionTailQueries, regionTailCountsQuery } from './experienceTailQuery.js';

const tail = (over: Partial<Parameters<typeof buildRegionTailQueries>[0]> = {}) =>
  buildRegionTailQueries({ regionId: 6967, includeChildren: true, kindId: 4, limit: 100, offset: 0, ...over });

describe('the tail of a crowded city', () => {
  it('reads the region\'s offered places a crowded membership names, as the list places them', () => {
    const { query, countQuery } = tail();
    for (const sql of [query, countQuery, regionTailCountsQuery(true)]) {
      expect(sql).toContain(experienceOfferedToReaderSql());
      expect(sql).toContain(readerRegionMembershipSql());
      expect(sql).toContain('rej.id IS NULL');
    }
    expect(query).toContain(membershipCrowdedSql('tm'));
    expect(query).toContain(membershipOfferedSql('tm'));
    // Never the shown set: those are the list's.
    expect(query).not.toContain(placeShownSql('e'));
  });

  it('ranks the best known first within each kind, across its types', () => {
    expect(tail().query).toMatch(/ORDER BY k\.display_priority, m\.kind_id, f\.score DESC NULLS LAST, e\.name, e\.id/);
  });

  it('binds the kind after the reader, so the New chip and a curator\'s column read the reader as $4', () => {
    const anonymous = tail();
    expect(anonymous.params).toEqual([6967, 100, 0, 4]);
    expect(anonymous.query).toContain('$4::int IS NULL OR tm.kind_id = $4');
    const reader = tail({ userId: 77, curateAs: 'curator' });
    expect(reader.params).toEqual([6967, 100, 0, 77, 4]);
    expect(reader.query).toContain('$5::int IS NULL OR tm.kind_id = $5');
    expect(reader.countParams).toEqual([6967, 4]);
    expect(reader.countQuery).toContain('$2::int IS NULL OR tm.kind_id = $2');
  });

  it('reads the region alone where the caller leaves its subregions out', () => {
    expect(tail({ includeChildren: false }).query).toContain('scope_regions AS (SELECT $1::int AS id)');
    expect(tail().query).toContain('JOIN scope_regions s ON r.parent_region_id = s.id');
  });
});
