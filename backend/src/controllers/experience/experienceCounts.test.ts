/**
 * The two counts of ADR-0046 decision 8, pinned as text: a kind counts its
 * memberships, a region counts its places. There is no database in this suite;
 * the semantics — a place with two memberships once in each kind and once in
 * its region — were checked live by adding a second membership inside a
 * transaction and rolling it back (#822).
 */
import { describe, it, expect } from 'vitest';
import { membershipOfferedSql } from '../../db/membership.js';
import { hideLostSql } from './experienceLifecycle.js';
import {
  countedMembershipSql, countedMembershipsSql, countedPlacesSql, kindCountSql,
} from './experienceCounts.js';

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('a kind counts its memberships', () => {
  it('counts each membership once, by its own id', () => {
    expect(countedMembershipsSql('m')).toBe('COUNT(DISTINCT m.id)');
    expect(countedMembershipsSql()).toBe('COUNT(DISTINCT m.id)');
  });

  it('counts the memberships the kind offers, of places still standing', () => {
    // The three questions every list under a kind's header asks, so the
    // number labels the list it sits above: the membership's admission and
    // gate, and the place's existence.
    expect(countedMembershipSql('m', 'e')).toBe(`${membershipOfferedSql('m')} AND ${hideLostSql('e')}`);
    expect(countedMembershipSql('x', 'y')).toContain("x.admission <> 'refused'");
    expect(countedMembershipSql('x', 'y')).toContain("y.existence <> 'lost'");
  });

  it('spells the whole count as one subquery over the membership table', () => {
    const sql = collapse(kindCountSql('s.kind_id'));
    expect(sql).toMatch(/^\(SELECT COUNT\(DISTINCT km\.id\) FROM experience_kind_memberships km JOIN experiences ke ON ke\.id = km\.experience_id WHERE km\.kind_id = s\.kind_id AND /);
    expect(sql).toContain(collapse(countedMembershipSql('km', 'ke')));
    // Not off the place's source column: the count is of memberships in the
    // kind, which is what a place in two kinds counts once in each of.
    expect(sql).not.toContain('source_id');
    // Uncast: COUNT is a bigint the driver hands over as a string, and the
    // readers of experience_count have parsed it that way since the column
    // existed.
    expect(sql).not.toContain('::int');
  });
});

describe('a region counts its places', () => {
  it('counts each place once, whatever kinds it belongs to', () => {
    // The first merge (#755) makes the Statue of Liberty one place with two
    // memberships: once in each kind's count, and once in New York's.
    expect(countedPlacesSql('e')).toBe('COUNT(DISTINCT e.id)');
    expect(countedPlacesSql()).toBe('COUNT(DISTINCT e.id)');
    expect(countedPlacesSql('e')).not.toContain('membership');
  });
});
