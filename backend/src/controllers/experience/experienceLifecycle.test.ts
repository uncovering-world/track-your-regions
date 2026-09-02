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
  offeredLinkSql,
  linkedForReaderSql,
  experienceOfferedToReaderSql,
  hidePendingSql,
  publishedContentSql,
  readerPositionSql,
  readerRegionMembershipSql,
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

describe('hidePendingSql', () => {
  it('hides an unread row, and says nothing about the other three questions', () => {
    expect(hidePendingSql()).toBe("e.curation_state <> 'pending'");
    expect(hidePendingSql('x')).toBe("x.curation_state <> 'pending'");
    // The gate must not mention existence, admission or missing_since: a
    // predicate that answered two questions could not be relaxed for one of
    // them alone (ADR-0025's Negative consequences).
    expect(hidePendingSql()).not.toMatch(/existence|admission|missing_since/);
  });

  it('qualifies the column, so it can join a query with more than one table', () => {
    expect(hidePendingSql('ex')).toContain("ex.curation_state <> 'pending'");
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
    expect(sql).toContain("x.admission <> 'refused'");
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
    expect(readerPositionSql('x')).toContain('el.experience_id = x.id');
    expect(readerPositionSql('x')).toContain('ORDER BY el.location::geography <-> x.location::geography');
  });
});

describe('readerRegionMembershipSql', () => {
  // #521. `experience_regions` is placement's roll-up of where an object's
  // *points* are, and placement deliberately places `pending` ones (ADR-0025
  // decision 5), so the roll-up alone answers "is this object here" with rows
  // no reader is shown.
  it('asks the region for a point this reader may see', () => {
    const sql = readerRegionMembershipSql();

    expect(sql).toContain('FROM experience_location_regions mem_elr');
    expect(sql).toContain('JOIN experience_locations mem_el ON mem_el.id = mem_elr.location_id');
    // The point has to be placed in *this* region and belong to *this* object:
    // dropping either correlation turns the predicate into "somebody has a
    // visible point somewhere", which is true of nearly every row.
    expect(sql).toContain('mem_elr.region_id = er.region_id');
    expect(sql).toContain('mem_el.experience_id = e.id');
  });

  it('spells the whole of what a reader may see, not half of it', () => {
    // The same pair every other reader-facing read of a point carries —
    // `location_count`, the map feed, `readerPositionSql`. A membership that
    // gated only `curation_state` would keep an object in a region on the
    // strength of a point the source withdrew, which is the same list-entry
    // with no pin arriving through the other door.
    const sql = readerRegionMembershipSql();

    expect(sql).toContain('mem_el.missing_since IS NULL');
    expect(sql).toContain("mem_el.existence <> 'lost'");
    expect(sql).toContain("mem_el.curation_state <> 'pending'");
  });

  it('exempts a curator who put the object here by hand', () => {
    // A manual assignment is not derived from a point and carries no
    // `experience_location_regions` row to find (`assignExperienceToRegion`
    // writes one table). It is how an object whose only point falls just
    // outside the boundary (#469) or lies offshore (#470) is in the region's
    // list at all, so gating it would delete a curator's decision.
    expect(readerRegionMembershipSql()).toContain("er.assignment_type = 'manual'");
  });

  it('reads a row that names no type as placement, not as a curator', () => {
    // `assignment_type` is nullable with a default of `auto`. Written as
    // `<> 'auto'` the exemption would still be NULL for such a row and gate it
    // — the same answer by accident — but a row inserted with no type is
    // placement's, and the predicate should say so rather than land there
    // through three-valued logic.
    expect(readerRegionMembershipSql()).not.toContain("<> 'auto'");
  });

  it('takes the expression and alias it is given, since not every caller has an `e`', () => {
    // The membership subquery in `listExperiences` and the batch feed's
    // `IN (SELECT …)` have no experiences alias in scope at all — they
    // correlate on `er.experience_id` — and a fragment that hard-coded `e.id`
    // would fail there rather than being quietly wrong, which is the better
    // half of this argument existing.
    const sql = readerRegionMembershipSql('er.experience_id', 'er');
    expect(sql).toContain('mem_el.experience_id = er.experience_id');

    const aliased = readerRegionMembershipSql('x.id', 'm');
    expect(aliased).toContain('mem_elr.region_id = m.region_id');
    expect(aliased).toContain("m.assignment_type = 'manual'");
    expect(aliased).toContain('mem_el.experience_id = x.id');
  });

  it('never shadows the caller\'s own location aliases', () => {
    // Both call sites in `experienceLocationController` already have `el` in
    // scope for the rows they return, and the batch feed's WHERE sits beside
    // `offeredLocationSql('el')` — an inner `el` would resolve to this
    // fragment's table and gate the wrong rows.
    const sql = readerRegionMembershipSql();
    expect(sql).not.toMatch(/\bexperience_locations el\b/);
    expect(sql).not.toMatch(/\bexperience_location_regions elr\b/);
  });
});
