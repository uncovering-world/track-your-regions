/**
 * What must be true of the boundary set the whole map is built on.
 *
 * `administrative_divisions` is GADM, loaded once by `db/init-db.py` and read
 * by everything after it: a world view's regions are built from these rows, a
 * region's geometry is the union of the divisions it holds, and the tiles Martin
 * serves are those geometries simplified. A defect here is therefore not one
 * wrong row — it is a hole in every polygon above it, in every world view built
 * on it, at every zoom.
 *
 * Which is what #665 was. GADM 4.1 leaves the deepest name empty on 2831 rows
 * that carry a valid GID and a polygon, the loader read only the names, and 86
 * divisions ended up stored as leaves holding one tambon's polygon while their
 * real children hung beneath them, reaching no ancestor at all. Thailand's
 * country polygon carried 54 interior rings, 20 742 km² of them; the map showed
 * white patches inside the region fill around Nakhon Ratchasima and Surin. Every
 * run had reported success, and it was found by a person looking at the map.
 *
 * Both rules below are that defect asked about two different ways, and today
 * they answer with the same rows. That is deliberate rather than redundant: the
 * first asks whether the *flag* agrees with the tree, the second whether the
 * *geometry* does, and the two come apart the moment something repairs one half
 * without the other — a `has_children` corrected in place leaves a parent still
 * holding one source row where a union belongs, and the map keeps its hole while
 * the first rule reports clear.
 *
 * Neither can be answered by comparing areas, which is how the same question is
 * asked of regions. `administrative_divisions.geom_area_km2` is declared and
 * never written — no trigger fills it — and measuring 392 112 polygons on the
 * fly costs eight seconds against a report that answers in two and a half. It
 * would also not fire: a country is short by its holes, and Thailand's 20 742
 * km² are 4 % of it, far inside the nine tenths that rule allows. What separates
 * these rows is exact and costs an index lookup, so that is what is asked.
 */

import type { CatalogueAssertion } from './assertion.js';
import { count, text } from './assertion.js';

/** Divisions hang beneath this one. Index-backed on `parent_id`. */
const HAS_CHILDREN_BELOW = `EXISTS (SELECT 1 FROM administrative_divisions c WHERE c.parent_id = d.id)`;

/** The columns both rules report, so a row reads the same either way. */
const ROW_COLUMNS = `d.id AS division_id,
               d.name AS division_name,
               parent.name AS parent_name,
               (SELECT count(*) FROM administrative_divisions c WHERE c.parent_id = d.id) AS children`;

const FROM_DIVISION = `FROM administrative_divisions d
          LEFT JOIN administrative_divisions parent ON parent.id = d.parent_id`;

/** "Muang Nakhon Ratchasima, under Nakhon Ratchasima (division 354941)" */
const say = (row: Record<string, unknown>, what: string): string => {
  const parent = text(row, 'parent_name');
  const under = parent ? `, under ${parent}` : '';
  return `${text(row, 'division_name')}${under}: ${what} `
    + `${count(row, 'children').toLocaleString('en')} divisions hang beneath it `
    + `(division ${count(row, 'division_id')})`;
};

/**
 * A division the loader stored as a leaf, with children.
 *
 * The flag is set when a division is first seen and no later row revisits it, so
 * a row that named nothing below the district made the district a leaf however
 * many tambons arrived afterwards. Nothing that walks the tree by the flag can
 * see them: `precalculate-geometries.py` unions the children of rows marked as
 * parents, and a leaf is not one, so the children reach no ancestor and every
 * polygon above them is short by exactly their area.
 */
const leafDivisionWithChildren: CatalogueAssertion = {
  id: 'leaf-division-with-children',
  area: 'boundaries',
  title: 'A division stored as a leaf while divisions hang beneath it',
  kind: 'invariant',
  meaning:
    'The children are invisible to everything that walks the tree by this flag, so they are in '
    + 'no ancestor polygon: the province, the country and the continent above this row each have '
    + 'a hole where they are, and so does every region built on them. Apply '
    + 'db/migrations/034-unnamed-gadm-rows.sql, which gives the folded polygon a division of its '
    + 'own and unions what is missing back into the ancestors (#665).',
  sql: `SELECT ${ROW_COLUMNS}
          ${FROM_DIVISION}
         WHERE d.has_children = false
           AND ${HAS_CHILDREN_BELOW}
         ORDER BY d.name`,
  describe: row => say(row, 'stored as a leaf while'),
};

/**
 * A parent division whose geometry is one row of the source.
 *
 * `gadm_uid` names the single GADM polygon a division was loaded from, and the
 * loader writes it only where the division is the deepest level a row names. A
 * division with children is a union of what is under it and has no source row of
 * its own — so carrying both means one polygon is standing where the union
 * belongs, and it is smaller than what it should cover by every sibling it
 * omits.
 *
 * There is one shape that would be benign, and GADM 4.1 does not contain it: a
 * country whose own outline the source gives directly, in a row naming nothing
 * below it, *and* which other rows fill in from underneath. That polygon does
 * cover its children. No country in the file is both (measured: 0 of them have a
 * country-only row alongside rows naming a level below), so every row this
 * reports today is a folded one. Should a future release carry such a country,
 * this is the row to read before repairing it.
 */
const parentDivisionHoldingOneSourcePolygon: CatalogueAssertion = {
  id: 'parent-division-holding-one-source-polygon',
  area: 'boundaries',
  title: 'A division holding a single source polygon while divisions hang beneath it',
  kind: 'invariant',
  meaning:
    'The division is drawn as one polygon of the source rather than as the union of its '
    + 'children, so it is short by every child that polygon does not cover — and so is every '
    + 'ancestor above it. Apply db/migrations/034-unnamed-gadm-rows.sql, which moves the polygon '
    + 'into a division of its own beneath this row and rebuilds this one from its children '
    + '(#665).',
  sql: `SELECT ${ROW_COLUMNS}, d.gadm_uid
          ${FROM_DIVISION}
         WHERE d.gadm_uid IS NOT NULL
           AND ${HAS_CHILDREN_BELOW}
         ORDER BY d.name`,
  describe: row => say(row, `drawn as GADM polygon ${text(row, 'gadm_uid')} alone while`),
};

export const divisionTreeAssertions: CatalogueAssertion[] = [
  leafDivisionWithChildren,
  parentDivisionHoldingOneSourcePolygon,
];
