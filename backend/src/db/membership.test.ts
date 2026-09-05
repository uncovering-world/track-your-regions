/**
 * The one spelling of the two questions a membership answers (ADR-0045
 * decision 4, #822): does a kind accept the place, has anyone looked at it.
 * Pinned as text, like the lifecycle fragments they feed: there is no database
 * in this suite, and the shape of an `EXISTS` is what the other tests compose.
 */
import { describe, it, expect } from 'vitest';
import {
  MEMBERSHIPS,
  admissionPinnedSql,
  iconicPinnedSql,
  membershipAdmittedSql,
  membershipOfferedSql,
  membershipVisibleSql,
  placeAdmittedSql,
  placeOfferedSql,
  placeVisibleSql,
} from './membership.js';

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the membership-level predicates', () => {
  it('ask one column each, of the membership alias they are given', () => {
    expect(membershipAdmittedSql()).toBe("m.admission <> 'refused'");
    expect(membershipAdmittedSql('x')).toBe("x.admission <> 'refused'");
    expect(membershipVisibleSql()).toBe("m.curation_state <> 'pending'");
    expect(membershipVisibleSql('x')).toBe("x.curation_state <> 'pending'");
  });

  it('compose the offered one from the two, on the same alias', () => {
    expect(membershipOfferedSql('x')).toBe(`${membershipAdmittedSql('x')} AND ${membershipVisibleSql('x')}`);
  });
});

describe('the place-level predicates', () => {
  it('ask "some membership of this place" with one EXISTS over the membership table', () => {
    for (const fragment of [placeAdmittedSql('e'), placeVisibleSql('e'), placeOfferedSql('e')]) {
      const sql = collapse(fragment);
      expect(sql).toMatch(/^EXISTS \(SELECT 1 FROM experience_kind_memberships km WHERE km\.experience_id = e\.id AND /);
      expect(sql.match(/EXISTS/g)).toHaveLength(1);
    }
    expect(MEMBERSHIPS).toBe('experience_kind_memberships');
  });

  it('take the experiences alias, and give the membership one of its own', () => {
    // `km`, not `m`: the review queue and the waiting counts join the table as
    // `m` and carry a place-level fragment beside it, and an inner `m` would
    // shadow theirs without any error.
    expect(collapse(placeAdmittedSql('experiences'))).toContain('km.experience_id = experiences.id');
    expect(collapse(placeAdmittedSql('experiences'))).toContain("km.admission <> 'refused'");
    expect(placeAdmittedSql()).toContain('= e.id');
  });

  it('ask each question on its own, so one can be relaxed without the other', () => {
    // ADR-0025's negative consequence: a predicate that answered two questions
    // could not be relaxed for one of them. The curator's by-id reads relax the
    // gate alone.
    expect(placeAdmittedSql()).not.toContain('curation_state');
    expect(placeVisibleSql()).not.toContain('admission');
  });

  it('ask both of one membership when a place is offered, not each of any', () => {
    // A place with one membership admitted and another passed satisfies each
    // fragment alone and is offered by no single kind (#755). One EXISTS with
    // both terms inside it is what keeps that place off a reader's screen.
    const sql = collapse(placeOfferedSql());
    expect(sql).toContain(`${membershipAdmittedSql('km')} AND ${membershipVisibleSql('km')}`);
    expect(sql.match(/EXISTS/g)).toHaveLength(1);
    expect(sql).not.toBe(`${placeAdmittedSql()} AND ${placeVisibleSql()}`);
  });
});

describe('the curator\'s pins', () => {
  it('read the membership\'s curated_fields, which is never null', () => {
    // No COALESCE, unlike the place's pins: the column is NOT NULL DEFAULT '[]',
    // so `?` answers false rather than NULL on a row nobody has curated.
    expect(admissionPinnedSql('m')).toBe("m.curated_fields ? 'admission'");
    expect(iconicPinnedSql('m')).toBe("m.curated_fields ? 'is_iconic'");
    expect(admissionPinnedSql()).not.toContain('COALESCE');
  });
});
