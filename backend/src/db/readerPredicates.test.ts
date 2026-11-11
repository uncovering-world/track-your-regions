/**
 * Tests for the lifecycle fragments the read paths share.
 *
 * The behaviour worth pinning is the asymmetry: `former` changes nothing about
 * who sees what, `lost` leaves everywhere except a visit, and neither happens
 * to an object a run merely flagged.
 */

import { describe, it, expect } from 'vitest';
import { placeAdmittedSql, placeOfferedSql, placeVisibleSql } from './membership.js';
import {
  claimablePlaceSql,
  hideLostSql,
  lifecycleSelectSql,
  offeredLocationSql,
  offeredLinkSql,
  linkedForReaderSql,
  experienceOfferedToReaderSql,
  partOfferedSql,
  publishedContentSql,
  readerPositionSql,
  readerRegionMembershipSql,
  readableByIdSql,
} from './readerPredicates.js';

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

  it('hides a point a curator declared gone from the world, whatever the source now lists', () => {
    // Without this the run's `returned` arm — which clears `missing_since` when the
    // source offers the point again — would put a demolished component back on the
    // map. Not hypothetical: the flapping point of #543 is the catalogue's only
    // withdrawal, and it left and came back.
    expect(offeredLocationSql()).toContain("el.existence <> 'lost'");
    expect(offeredLocationSql('loc')).toContain("loc.existence <> 'lost'");
  });

  it('does not hide a point on the membership axis, only the world one', () => {
    // `former` says the source stopped listing it, and a curator's reading of a list
    // must not remove a place that is still standing — what keeps such a point off the
    // map is its `missing_since`, which the verdict leaves standing. Same split an
    // experience has: `hideLostSql` exists, and there is no `hideFormerSql`.
    expect(offeredLocationSql()).not.toContain('source_membership');
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

describe('publishedContentSql', () => {
  it('gates a content row on its own state, not on its container', () => {
    expect(publishedContentSql('el')).toBe("el.curation_state <> 'pending'");
    expect(publishedContentSql('et')).toBe("et.curation_state <> 'pending'");
    expect(publishedContentSql('t')).toBe("t.curation_state <> 'pending'");
  });
});

describe('offeredLinkSql', () => {
  it('hides a link the source stopped placing here, and asks nothing else', () => {
    // A link has the one axis a point's first term is: the mark a run leaves
    // (ADR-0044). No existence term, because nobody declares a work gone from
    // the world through its link — the work is global, the link says "here".
    expect(offeredLinkSql('et')).toBe('et.missing_since IS NULL');
  });

  it('defaults to the alias the link queries use', () => {
    expect(offeredLinkSql()).toBe('et.missing_since IS NULL');
  });
});

describe('linkedForReaderSql', () => {
  it('asks the experience, the link, and whether the source still places the work here', () => {
    // Three things, and the third is new: a link a run has marked is one no
    // reader is shown, so a reader may not claim to have looked at the work
    // *here* through it, exactly as a visit is not offered on a withdrawn point.
    const sql = linkedForReaderSql();
    expect(sql).toContain(experienceOfferedToReaderSql());
    expect(sql).toContain(publishedContentSql('et'));
    expect(sql).toContain(offeredLinkSql('et'));
  });

  it('takes the aliases it is given', () => {
    const sql = linkedForReaderSql('x', 'link');
    expect(sql).toContain('link.missing_since IS NULL');
    expect(sql).toContain("link.curation_state <> 'pending'");
    expect(sql).toContain(placeOfferedSql('x'));
  });
});

describe('experienceOfferedToReaderSql', () => {
  it('asks both questions of one membership, not each of any', () => {
    // A place with one membership admitted and another passed satisfies
    // placeAdmittedSql and placeVisibleSql on their own and is offered by no
    // single kind (#755); the writers that record a reader's claim compose
    // this one, which asks both of the same row.
    expect(experienceOfferedToReaderSql('x')).toBe(placeOfferedSql('x'));
    expect(experienceOfferedToReaderSql('x'))
      .not.toBe(`${placeAdmittedSql('x')} AND ${placeVisibleSql('x')}`);
  });
});

describe('readableByIdSql', () => {
  it('serves a curator an admitted place unread or not, and a reader only an offered one (#1275)', () => {
    const sql = readableByIdSql('$2::boolean', 'x');
    expect(sql).toContain(`(($2::boolean AND (${placeAdmittedSql('x')} OR `);
    // The reader's arm is the lists' rule, one membership both admitted and
    // passed, never the two one-sided fragments side by side, or a part
    // offered where its whole is (ADR-0100).
    expect(sql).toContain(`OR (${experienceOfferedToReaderSql('x')} OR ${partOfferedSql('x')}))`);
    expect(sql).not.toContain(placeVisibleSql('x'));
  });
});

describe('partOfferedSql', () => {
  it('offers a part where its whole is offered and its own point may be shown, as a place readers claim', () => {
    const sql = partOfferedSql('x');
    expect(sql).toContain('WHERE po.part_id = x.id');
    expect(sql).toContain(placeOfferedSql('pw'));
    expect(sql).toContain(`${offeredLocationSql('pel')} AND ${publishedContentSql('pel')}`);
    expect(claimablePlaceSql('x')).toBe(`(${placeOfferedSql('x')} OR ${sql})`);
  });

  it('is no part of the set every list composes: a part is reached through its whole', () => {
    expect(experienceOfferedToReaderSql('x')).not.toContain('experience_parts');
  });
});

describe('readerPositionSql', () => {
  // ADR-0028 decision 2. The rule is one line of SQL and five ways to get it
  // wrong, and each of them shows a reader a place that is not there.
  it('positions an object at the place nearest its own published coordinate', () => {
    const sql = readerPositionSql('e');
    // Nearest, by the object's own coordinate — not the first place, not a
    // centroid, and not a rule with a tolerance in it: a tolerance made the
    // answer discontinuous, moving Mountain Railways of India 2068 km because
    // UNESCO's point misses the Nilgiri line by 454 m.
    expect(sql).toContain('ORDER BY el.location::geography <-> e.location::geography');
    expect(sql).toContain('LIMIT 1');
  });

  it('measures nearest in metres, never in degrees', () => {
    // `<->` on `geometry(Point,4326)` is planar: it counts a degree of longitude
    // the same as a degree of latitude, and 42 multi-place objects in this
    // catalogue sit above 60°, Struve Geodetic Arc's 34 points reaching 70.7°N.
    // Measured against the live catalogue, degree ordering picks a different
    // place for six objects and sends the reader *further* in every one — 13.6 km
    // rather than 12.7 for the Pico Island vineyards. The cast is also what keeps
    // a site spanning 180° from measuring 358° wide.
    const orderBy = readerPositionSql('e').split('ORDER BY')[1].split('LIMIT')[0];
    // Both operands, because a cast on one side only reverts to degrees quietly.
    expect(orderBy.match(/::geography/g)).toHaveLength(2);
  });

  it('breaks a distance tie by id, so one place answers both axes', () => {
    // The fragment is interpolated once per axis and each is its own SubPlan, so
    // without a total order a tie can answer with one place's longitude and
    // another's latitude — a coordinate at neither of them, which is the failure
    // this rule exists to remove. Seven objects tie today, the Pico Island
    // vineyards' two places 12719.095 m from their anchor and Iwami Ginzan's six
    // at 657.137 m among them; in all seven the tied places share a coordinate, so
    // the key is what keeps a source that ties two *different* points from
    // answering with neither, and what keeps a position still between two reads.
    expect(readerPositionSql('e')).toContain('<-> e.location::geography, el.id');
  });

  it('considers only the places the same reader may see', () => {
    // An object positioned at a point its source withdrew, at one a curator
    // recorded as gone, or at one nobody has passed yet would be positioned
    // where that reader is not allowed to be shown anything at all.
    const sql = readerPositionSql('e');
    expect(sql).toContain("el.missing_since IS NULL");
    expect(sql).toContain("el.existence <> 'lost'");
    expect(sql).toContain("el.curation_state <> 'pending'");
  });

  it('lets a caller that relaxes pending for a curator relax it here too', () => {
    // `getExperience` shows a curator whose scope reaches the row an object the
    // queue has not passed yet (ADR-0025). A curator deciding that object's
    // coordinate has to preview where publishing will put the pin; with the gate
    // hard-coded every place is filtered out and the preview falls back to the
    // anchor — the one value they are deciding against. Withdrawn and lost points
    // stay excluded for everyone, curator or not.
    const relaxed = readerPositionSql('e', '$2');
    expect(relaxed).toContain("($2::boolean OR el.curation_state <> 'pending')");
    expect(relaxed).toContain("el.missing_since IS NULL");
    expect(relaxed).toContain("el.existence <> 'lost'");
    // And unrelaxed by default: every other caller gates pending at the
    // experience level, so the places must be gated the same way.
    expect(readerPositionSql('e')).not.toContain('::boolean');
  });

  it('leaves an object with no visible place where its source put it', () => {
    // The fallback is the object's own coordinate rather than null: losing a
    // position outright would drop the row off the map, which is a heavier
    // answer than "where the source said" for a question nobody can answer
    // better. Argument order is the assertion — reversed, `COALESCE` would
    // always answer with the anchor and turn the rule off silently.
    expect(readerPositionSql('e')).toMatch(/COALESCE\(\(SELECT[\s\S]*?LIMIT 1\), e\.location\)/);
  });

  it('takes the alias it is given, so a query with another name for the table is not silently wrong', () => {
    expect(readerPositionSql('x')).toContain('WHERE el_own.experience_id = x.id');
    expect(readerPositionSql('x')).toContain('WHERE el_prt.whole_id = x.id');
    expect(readerPositionSql('x')).toContain('ORDER BY el.location::geography <-> x.location::geography');
  });
});

describe('readerRegionMembershipSql', () => {
  // #521, ADR-0197. Placement writes a place's rows from its unread points too
  // (ADR-0025 decision 5), so a row alone answers "is this place here" with
  // rows no reader is shown; the refresh marks each with whether a point a
  // reader may see is what put the place there.
  it('asks the row whether a point a reader may see put the place here', () => {
    expect(readerRegionMembershipSql()).toBe("er.listing = 'offered'");
  });

  it('takes the alias it is given', () => {
    expect(readerRegionMembershipSql('m')).toBe("m.listing = 'offered'");
  });

  it('never lets a row only curators see through, whichever of the two it is', () => {
    // `fallback`: the place shows no point a reader may see anywhere (an
    // arrival); `scope`: only an unread point puts it here (a move). Equality
    // with `offered`, not inequality with one of them, so neither leaks.
    expect(readerRegionMembershipSql()).not.toMatch(/<>/);
  });
});
