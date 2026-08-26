/**
 * The two boundary rules ask the same defect two ways, and each has to keep
 * asking its own half.
 *
 * The first reads the flag, the second reads the geometry. They report the same
 * 86 rows on the dev catalogue today, and a rewrite that quietly makes one a
 * copy of the other would look clean while halving what is watched: a
 * `has_children` corrected in place without moving the polygon leaves the map's
 * hole exactly where it was. Both also have to stay cheap enough for a report
 * that answers in two and a half seconds, which is why neither may reach for
 * `ST_Area`.
 */
import { describe, it, expect } from 'vitest';
import { divisionTreeAssertions } from './divisionTreeAssertions.js';

const byId = (id: string) => {
  const assertion = divisionTreeAssertions.find(a => a.id === id);
  if (!assertion) throw new Error(`no assertion ${id}`);
  return assertion;
};
const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the boundary assertions', () => {
  it('are invariants of the boundary set, each with a title and a meaning', () => {
    for (const a of divisionTreeAssertions) {
      expect(a.area).toBe('boundaries');
      expect(a.kind).toBe('invariant');
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.meaning.length).toBeGreaterThan(0);
    }
  });

  it('name the repair a person is meant to apply', () => {
    for (const a of divisionTreeAssertions) {
      expect(a.meaning).toContain('db/migrations/034-unnamed-gadm-rows.sql');
    }
  });

  it('measure nothing on the fly', () => {
    // geom_area_km2 is declared on administrative_divisions and never written,
    // and ST_Area over 392 112 polygons costs eight seconds. What separates
    // these rows is exact and costs an index lookup.
    for (const a of divisionTreeAssertions) {
      expect(collapse(a.sql)).not.toContain('ST_Area');
      expect(collapse(a.sql)).not.toContain('geom_area_km2');
    }
  });
});

describe('leaf-division-with-children', () => {
  const rule = byId('leaf-division-with-children');
  const sql = collapse(rule.sql);

  it('asks whether the flag disagrees with the tree', () => {
    expect(sql).toContain('d.has_children = false');
    expect(sql).toContain('EXISTS (SELECT 1 FROM administrative_divisions c WHERE c.parent_id = d.id)');
  });

  it('does not ask about the polygon, which is the other rule\'s half', () => {
    expect(sql).not.toContain('gadm_uid');
  });

  it('says the row with the parent it leaves a hole in', () => {
    expect(rule.describe({
      division_id: 354941, division_name: 'Muang Nakhon Ratchasima',
      parent_name: 'Nakhon Ratchasima', children: 17,
    })).toBe('Muang Nakhon Ratchasima, under Nakhon Ratchasima: stored as a leaf while 17 divisions '
      + 'hang beneath it (division 354941)');
  });

  it('says a root division without inventing a parent for it', () => {
    expect(rule.describe({
      division_id: 1, division_name: 'Asia', parent_name: null, children: 51,
    })).toBe('Asia: stored as a leaf while 51 divisions hang beneath it (division 1)');
  });
});

describe('parent-division-holding-one-source-polygon', () => {
  const rule = byId('parent-division-holding-one-source-polygon');
  const sql = collapse(rule.sql);

  it('asks whether the geometry is one row of the source rather than a union', () => {
    expect(sql).toContain('d.gadm_uid IS NOT NULL');
    expect(sql).toContain('EXISTS (SELECT 1 FROM administrative_divisions c WHERE c.parent_id = d.id)');
  });

  it('does not ask about the flag, which is the other rule\'s half', () => {
    // A has_children corrected in place, with the polygon left where it was,
    // clears the first rule and leaves the map's hole untouched. This one has
    // to still report it.
    expect(sql).not.toContain('has_children');
  });

  it('says the row with the polygon it is standing on', () => {
    expect(rule.describe({
      division_id: 354941, division_name: 'Muang Nakhon Ratchasima',
      parent_name: 'Nakhon Ratchasima', children: 17, gadm_uid: 317553,
    })).toBe('Muang Nakhon Ratchasima, under Nakhon Ratchasima: drawn as GADM polygon 317553 alone '
      + 'while 17 divisions hang beneath it (division 354941)');
  });
});
