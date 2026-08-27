/**
 * The geometry assertions have to ask a question *other* than the one the
 * trigger answers, and the cheap question rather than the slow one.
 *
 * The first rule exists to catch the trigger being wrong, so a rule composed of
 * the trigger's own arithmetic would agree with it on every row it got wrong;
 * the others read the stored columns the metadata trigger maintains, where the
 * on-the-fly measurement costs fifty seconds a run. Each term is pinned here so
 * a rewrite that quietly composes the wrong thing fails.
 */
import { describe, it, expect } from 'vitest';
import { regionGeometryAssertions } from './regionGeometryAssertions.js';

const byId = (id: string) => {
  const assertion = regionGeometryAssertions.find(a => a.id === id);
  if (!assertion) throw new Error(`no assertion ${id}`);
  return assertion;
};
const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the five geometry assertions', () => {
  it('all live in the regions area, with a title and a meaning', () => {
    for (const a of regionGeometryAssertions) {
      expect(a.area).toBe('regions');
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe('framed-as-the-world', () => {
  const sql = collapse(byId('framed-as-the-world').sql);

  it('asks about a stored box that is global, the way the schema files one', () => {
    expect(sql).toContain('r.focus_bbox[1] <= r.focus_bbox[3]');
    // The threshold is the schema's, stated once (#674): restating 350 here
    // would let this rule and geometry_focus() drift apart silently.
    expect(sql).toContain('r.focus_bbox[3] - r.focus_bbox[1] > near_global_deg()');
    expect(sql).not.toContain('350');
  });

  it('measures the geometry by the bands its parts occupy, not by the trigger arithmetic', () => {
    // The whole point: a second copy of geometry_focus() would agree with the
    // trigger on every row the trigger got wrong.
    expect(sql).not.toContain('geometry_focus');
    expect(sql).not.toContain('ST_ShiftLongitude');
    expect(sql).not.toContain('ST_SnapToGrid');
    // The shape the trigger measured, hull included: a hull bridges the gaps
    // between the parts it wraps, so sweeping geom alone would report a hull
    // region whose global box is right. Sharing the input is not sharing the
    // arithmetic.
    expect(sql).toContain('ST_Dump(COALESCE(g.hull_geom, g.geom))');
    expect(sql).toContain('generate_series(');
    expect(sql).toContain('LEAD(b) OVER (ORDER BY b)');
    // The closing run round the circle, from the last band back to the first.
    expect(sql).toContain('(o.bs[1] + 36) - o.bs[array_length(o.bs, 1)] - 1');
  });

  it('reports only a stretch of at least two empty bands: 20° with no part of the region', () => {
    expect(sql).toContain('WHERE e.widest >= 2');
    expect(sql).toContain('e.widest * 10 AS empty_degrees');
  });

  it('says the row as a frame, in degrees', () => {
    expect(byId('framed-as-the-world').describe({
      region_id: 5767, region_name: 'Far Eastern Federal District', world_view_name: 'Administrative', empty_degrees: 270,
    })).toBe('Far Eastern Federal District (Administrative): framed as the whole world, though 270° of longitude hold no part of it (region 5767)');
  });
});

describe('anchor-far-from-its-region', () => {
  const rule = byId('anchor-far-from-its-region');
  const sql = collapse(rule.sql);

  it('is a watch: a scattered territory has its box centre in open water, legitimately', () => {
    expect(rule.kind).toBe('watch');
  });

  it('measures on the low rung in 3857 with the tolerance scaled by latitude, not on geography', () => {
    // Sixteen seconds a run on geography over full-resolution polygons; a quarter
    // of one here. Mercator stretches a metre by 1/cos(lat), so the tolerance is.
    expect(sql).toContain('r.geom_simplified_low');
    expect(sql).toContain('ST_Transform(r.anchor_point, 3857)');
    expect(sql).toContain('500000 / cos(radians(ST_Y(r.anchor_point)))');
    expect(sql).not.toContain('::geography');
    // Web Mercator has no answer past 85°; a pole-side anchor is not asked.
    expect(sql).toContain('abs(ST_Y(r.anchor_point)) < 85');
  });

  it('says the distance in kilometres', () => {
    expect(rule.describe({ region_id: 6052, region_name: 'United Kingdom', world_view_name: 'Administrative', about_km: 2987 }))
      .toBe('United Kingdom (Administrative): anchored about 2987 km from its nearest edge (region 6052)');
  });
});

describe('parent-short-of-its-children', () => {
  const rule = byId('parent-short-of-its-children');
  const sql = collapse(rule.sql);

  it('compares the stored areas, which are stale exactly when the geometry is', () => {
    expect(sql).toContain('p.geom_area_km2 < 0.9 * ch.km2');
    expect(sql).toContain('sum(c.geom_area_km2) AS km2');
    expect(sql).toContain('c.parent_region_id = p.id');
    // Fifty seconds a run on the fly; fifty milliseconds from the column.
    expect(sql).not.toContain('ST_Area(');
  });

  it('says the row with the percentage and both areas', () => {
    expect(rule.describe({
      region_id: 7394, region_name: 'North America', world_view_name: 'Administrative',
      percent: '18.3', parent_km2: 2632641, children_km2: 14416862,
    })).toBe('North America (Administrative): 18.3 % of its children — 2,632,641 km² against 14,416,862 km² (region 7394)');
  });
});

describe('region-without-geometry', () => {
  const rule = byId('region-without-geometry');
  const sql = collapse(rule.sql);

  it('asks only of a world view whose geometry has been computed', () => {
    // An import that never ran is not a hole.
    // Most of the world view, not the existence of one computed region:
    // geometryComputeSingle computes one on demand, so a curator's first click
    // on the in-flight Wikivoyage import would otherwise turn this rule into
    // every region of it at once.
    expect(sql).toContain('HAVING count(geom) > 0.9 * count(*)');
    expect(sql).not.toContain('DISTINCT world_view_id');
    expect(sql).toContain('JOIN computed c ON c.world_view_id = r.world_view_id');
    expect(sql).toContain('WHERE r.geom IS NULL');
  });

  it('says the row with the parent it leaves a hole in, where there is one', () => {
    expect(rule.describe({ region_id: 7456, region_name: 'Canada', world_view_name: 'Administrative', parent_name: 'North America' }))
      .toBe('Canada (Administrative): no geometry at all, under North America (region 7456)');
    expect(rule.describe({ region_id: 5201, region_name: 'Antarctica', world_view_name: 'Administrative', parent_name: null }))
      .toBe('Antarctica (Administrative): no geometry at all (region 5201)');
  });
});

describe('rung-unlike-its-source', () => {
  const rule = byId('rung-unlike-its-source');
  const sql = collapse(rule.sql);

  it('is exact rather than a threshold, in both directions', () => {
    // Simplification makes an outline coarser: it cannot add a ring, and the
    // rungs at 5 km and finer cannot lose a part (rule 12). So there is no
    // proportion to tolerate here, unlike the parent/children rule above.
    expect(rule.kind).toBe('invariant');
    expect(sql).toContain("WHERE (v.counted = 'holes' AND v.drawn > v.held)");
    expect(sql).toContain("OR (v.counted = 'pieces' AND v.drawn < v.held)");
    expect(sql).not.toContain('0.9');
  });

  it('counts rings and parts rather than re-deriving the rung', () => {
    // A second copy of the pass would agree with a broken writer on every row
    // it got wrong.
    expect(sql).toContain('ST_NRings(');
    expect(sql).toContain('ST_NumGeometries(');
    expect(sql).not.toContain('simplify_for_zoom');
    expect(sql).not.toContain('ST_CoverageSimplify');
    expect(sql).not.toContain('ST_SimplifyVW');
  });

  it('compares each rung against the shape that rung is made from', () => {
    // A hull region's low and medium rungs come from its hull, and a concave
    // hull can enclose a lagoon the geometry leaves open — so comparing them
    // against geom_3857 would report every hull region whose rungs are right.
    expect(sql).toContain('THEN COALESCE(r.hull_geom_3857, r.geom_3857)');
    expect(sql).toContain('ELSE r.geom_3857 END AS g');
    // The island source is always made from the real geometry, hull or no hull.
    expect(sql).toContain("('1 km island rung', 'holes', s.medium_real_rings, s.real_rings)");
    expect(sql).toContain("('5 km island rung', 'pieces', s.low_real_parts, s.real_parts)");
  });

  it('asks every rendered rung for its holes, the two cheap ones included', () => {
    // The count and the comparison, not just the count: reading a column proves
    // nothing if the rung it belongs to was dropped from the VALUES list below.
    for (const [label, column, rings, source] of [
      ['1 km rung', 'geom_simplified_medium', 'medium_rings', 'own_rings'],
      ['5 km rung', 'geom_simplified_low', 'low_rings', 'own_rings'],
      ['10 km rung', 'geom_simplified_coarse', 'coarse_rings', 'own_rings'],
      ['50 km rung', 'geom_overview', 'overview_rings', 'own_rings'],
      ['1 km island rung', 'geom_simplified_medium_real', 'medium_real_rings', 'real_rings'],
      ['5 km island rung', 'geom_simplified_low_real', 'low_real_rings', 'real_rings'],
    ]) {
      expect(sql, `no rung counts ${column}`).toContain(`ST_NRings(r.${column})`);
      expect(sql, `${label} is not compared for holes`)
        .toContain(`('${label}', 'holes', s.${rings}, s.${source})`);
    }
  });

  it('asks only the rungs at 5 km and finer for their pieces', () => {
    // Dropping a piece below its own scale is what the two cheap rungs are for
    // (ADR-0031 decision 1), so asking them would report the decision as a bug.
    for (const rung of ['1 km rung', '5 km rung', '1 km island rung', '5 km island rung']) {
      expect(sql, `${rung} is not asked for its pieces`).toContain(`('${rung}', 'pieces'`);
    }
    for (const rung of ['10 km rung', '50 km rung']) {
      expect(sql, `${rung} must not be asked for its pieces`).not.toContain(`('${rung}', 'pieces'`);
    }
  });

  it('reads each geometry once, which is the difference between 8 and 20 seconds', () => {
    // Without MATERIALIZED the planner inlines the CTE and re-reads the
    // full-resolution column for every rung the comparison below names.
    expect(sql).toContain('WITH shape AS MATERIALIZED (');
    // The comparison is over integers: no geometry column reaches the VALUES list.
    const from = sql.indexOf('CROSS JOIN LATERAL (VALUES');
    const to = sql.indexOf('AS v(label');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(sql.slice(from, to)).not.toContain('geom');
  });

  it('reports one row per region, the worst of its rungs', () => {
    // Ten questions off one bad pass are one defect, not ten lines of a report.
    expect(sql).toContain('DISTINCT ON (x.id)');
    expect(sql).toContain('ORDER BY x.id, abs(x.drawn - x.held) DESC');
  });

  it('says the row as what is drawn against what the source holds', () => {
    expect(rule.describe({
      region_id: 5212, region_name: 'Asia', world_view_name: 'Administrative',
      rung: '1 km rung', counted: 'holes', drawn: 555, held: 35,
    })).toBe('Asia (Administrative): the 1 km rung draws 555 holes where the shape it is made from has 35 (region 5212)');
    expect(rule.describe({
      region_id: 5212, region_name: 'Asia', world_view_name: 'Administrative',
      rung: '1 km rung', counted: 'pieces', drawn: 25715, held: 26151,
    })).toBe('Asia (Administrative): the 1 km rung draws 25715 pieces where the shape it is made from has 26151 (region 5212)');
  });

  it('says one of a thing as one, which is the size a regression arrives in', () => {
    expect(rule.describe({
      region_id: 5648, region_name: 'Mongolia', world_view_name: 'Administrative',
      rung: '1 km rung', counted: 'holes', drawn: 1, held: 0,
    })).toBe('Mongolia (Administrative): the 1 km rung draws 1 hole where the shape it is made from has 0 (region 5648)');
    expect(rule.describe({
      region_id: 7100, region_name: 'Malta', world_view_name: 'Administrative',
      rung: '5 km rung', counted: 'pieces', drawn: 1, held: 2,
    })).toBe('Malta (Administrative): the 5 km rung draws 1 piece where the shape it is made from has 2 (region 7100)');
  });
});
