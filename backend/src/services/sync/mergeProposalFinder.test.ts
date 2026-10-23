/**
 * The rule that proposes two near places with similar names as one place
 * (#1249, ADR-0046 decisions 2 to 4), pinned clause by clause against the
 * fragments it composes rather than against a second spelling of them.
 */
import { describe, it, expect } from 'vitest';
import { placeOfferedSql } from '../../db/membership.js';
import { offeredLocationSql, publishedContentSql } from '../../db/readerPredicates.js';
import { BASE_REACH_M, EXACT_DISTANCE_M, MIN_SIMILARITY, PROPOSAL_ROWS_SQL, WIDEST_REACH_M, candidatePairsSql, foldedNamesSql, reachSql, GENERIC_NAME_WORDS, MIN_WORD_LENGTH } from './mergeProposalFinder.js';

const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the pairs the rule finds', () => {
  const sql = collapse(candidatePairsSql());

  it('is made of places readers see, not folded, neither a whole of parts nor a part', () => {
    expect(sql).toContain('e.merged_into_id IS NULL');
    expect(sql).toContain(collapse(placeOfferedSql('e')));
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM experience_parts prt WHERE prt.whole_id = e.id OR prt.part_id = e.id)');
  });

  it('measures between the places\' offered, published points', () => {
    expect(sql).toContain(collapse(offeredLocationSql('el')));
    expect(sql).toContain(collapse(publishedContentSql('el')));
    expect(sql).toContain('min(round(ST_Distance(pa.location::geography, pb.location::geography)))::int AS distance_m');
  });

  it('prefilters in degrees for the index, widening with the latitude, over the world by a pole and across the antimeridian, then tests the geography at the pair\'s reach', () => {
    // Both arms read the inner point's own column, so its spatial index answers either.
    expect(sql).toContain('(ST_DWithin(pb.location, pa.location, pa.degrees) OR ST_DWithin(pb.location, pa.twin, pa.degrees))');
    expect(sql).toContain('ST_Translate(el.location, CASE WHEN ST_X(el.location) >= 0 THEN -360 ELSE 360 END, 0) AS twin');
    expect(sql).toContain('cos(radians(ST_Y(el.location)))');
    expect(sql).toContain('>= 84 THEN 360');
    expect(sql).toContain('ST_DWithin(pa.location::geography, pb.location::geography, GREATEST(pa.reach_m, pb.reach_m))');
  });

  it('inlines the points, since a CTE read twice is materialized and the self-join loses the index', () => {
    expect(sql).toContain('points AS NOT MATERIALIZED (');
  });

  it('keeps a pair in id order, once', () => {
    expect(sql).toContain('pa.place_id < pb.place_id');
    expect(sql).toContain('GROUP BY pa.place_id, pb.place_id');
  });

  it('asks the best similarity over every folded name of each, at the threshold ADR-0046 fixes', () => {
    expect(MIN_SIMILARITY).toBe(0.5);
    expect(sql).toContain('(SELECT max(similarity(an, bn)) FROM unnest(a.names) AS an, unnest(b.names) AS bn)::real AS name_similarity');
    expect(sql).toContain(`WHERE (m.name_similarity >= ${MIN_SIMILARITY} OR EXISTS`);
    expect(sql).toContain(`CASE WHEN m.name_similarity >= ${MIN_SIMILARITY} THEN 'similar' ELSE 'words' END AS found_by`);
  });

  it('never proposes two places a curator separated (ADR-0144)', () => {
    expect(sql).toContain('AND NOT EXISTS (SELECT 1 FROM experience_separations sep');
    expect(sql).toContain('WHERE sep.undone_at IS NULL');
    expect(sql).toContain('(sep.original_id = m.place_a AND sep.separated_id = m.place_b)');
    expect(sql).toContain('(sep.original_id = m.place_b AND sep.separated_id = m.place_a)');
  });

  it('finds a pair too where every word of one name stands in the other, its generic words left out (#1652)', () => {
    expect(sql).toContain('(words.wa <@ words.wb OR words.wb <@ words.wa)');
    expect(sql).toContain('cardinality(words.wa) > 0 AND cardinality(words.wb) > 0');
    expect(sql).toContain(`length(w) >= ${MIN_WORD_LENGTH}`);
    for (const word of ['monastery', 'historic', 'centre', 'saint', 'and']) expect(GENERIC_NAME_WORDS).toContain(word);
    // A word list is fixed literals: none carries a quote that would end the SQL string.
    expect(GENERIC_NAME_WORDS.every(word => /^[a-z]+$/.test(word))).toBe(true);
  });

  it('calls a pair exact only on one and the same folded name within fifty metres', () => {
    expect(EXACT_DISTANCE_M).toBe(50);
    expect(sql).toContain(`n.distance_m <= ${EXACT_DISTANCE_M} AND EXISTS (SELECT 1 FROM unnest(a.names) AS an JOIN unnest(b.names) AS bn ON an = bn)`);
  });

  it('says whether the two share a kind, over every membership, so the pass can leave such a pair apart', () => {
    expect(sql).toContain('a.kind_ids && b.kind_ids AS shared_kind');
    expect(sql).toContain('ARRAY(SELECT DISTINCT km.kind_id FROM experience_kind_memberships km WHERE km.experience_id = e.id) AS kind_ids');
  });
});

describe('a place\'s reach', () => {
  it('is 300 m, or the radius of a property\'s inscribed area up to 3 km', () => {
    expect(BASE_REACH_M).toBe(300);
    expect(WIDEST_REACH_M).toBe(3000);
    const sql = collapse(reachSql('e'));
    expect(sql).toContain(`GREATEST(${BASE_REACH_M}, LEAST(${WIDEST_REACH_M}, sqrt(COALESCE((e.metadata->>'areaHectares')::numeric, 0) * 10000 / pi())))::int`);
  });
});

describe('a place\'s folded names', () => {
  const sql = collapse(foldedNamesSql('e'));

  it('are its own name, each source\'s view of it and its names in other languages, unaccented and lower-cased', () => {
    expect(sql).toContain('unaccent(lower(btrim(named.n)))');
    expect(sql).toContain('SELECT e.name AS n');
    expect(sql).toContain('SELECT rn.reported_name FROM experience_kind_memberships rn WHERE rn.experience_id = e.id');
    expect(sql).toContain("jsonb_typeof(e.name_local) = 'object'");
  });

  it('leave out a missing or blank name rather than matching on it', () => {
    expect(sql).toContain("named.n IS NOT NULL AND btrim(named.n) <> ''");
  });
});

describe('the rows the pass and the check read', () => {
  it('name both places with their kinds in display order', () => {
    const sql = collapse(PROPOSAL_ROWS_SQL);
    expect(sql).toContain('JOIN experiences a ON a.id = p.place_a');
    expect(sql).toContain('JOIN experiences b ON b.id = p.place_b');
    expect(sql).toContain('ORDER BY k.display_priority, k.id');
  });
});
