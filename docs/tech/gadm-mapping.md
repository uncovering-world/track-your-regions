# GADM Mapping

This document describes how GADM data is imported and mapped into the current schema.

## Source Format

The import pipeline expects GADM GeoPackage input (for example `gadm_410.gpkg`), loaded by:

- `db/init-db.py`

The script reads hierarchical columns (`GID_0..GID_n`, `NAME_0..NAME_n`) and materializes explicit parent-child rows.

## Target Schema

Imported rows land in `administrative_divisions`:

- `id`
- `name`
- `parent_id`
- `has_children`
- `gadm_uid`
- `geom` (4326)
- simplified/display/derived geometry columns maintained by DB functions/triggers

This table is the authoritative administrative boundary dataset used by:

- division browsing/search APIs (`/api/divisions/*`)
- region member composition (`region_members.division_id`)
- geometry merges for user-defined regions

## Hierarchy Strategy

GADM’s denormalized level columns are converted into a normalized tree:

- one row per administrative division
- explicit `parent_id` relation
- deterministic `has_children` flag

This enables fast recursive queries for:

- descendants/ancestors
- subdivision listing
- split tools in the World View editor

### What one row names

Which of a row's levels are divisions is decided in `db/gadm_levels.py`, by
`row_levels()` — one row in, the divisions it names out, outermost first, the
last of them being the leaf its polygon belongs to. It reads a row and nothing
else, which is why it sits apart from the cursors and has tests of its own
(`db/tests/`, run by `npm run test:py` and by CI's Python job).

Three things it settles, and the first two used to be settled wrongly (#665):

- **An unnamed level is still a division.** GADM 4.1 leaves the deepest `NAME_n`
  empty on 2831 of its 356 508 rows while giving them a valid `GID_n` and a
  polygon — 2435 in Russia, 197 in Thailand, 183 in the United Arab Emirates, 16
  in Uruguay. Reading the names alone ended such a row one level early and handed
  its polygon to the division above it. What the row holds is the part of its
  parent the source's *named* units leave over, and that is a different thing per
  country — see **What an unnamed row is** below. An unnamed level takes its
  parent's name, which is what the parent already surfaces as wherever that row
  is its only row, and is what lets `merge_single_children` collapse the
  redundant pair afterwards so those rows land exactly where they always did.
- **A remainder that survives the merge is labelled as one.** Where the parent
  has other children the pair is not collapsed, and the tree would otherwise
  offer the same name twice, one inside the other — and in 23 Thai districts
  three times, since a tambon GADM *does* name carries it too. So after the
  merge, when it is known which survived, each one takes
  `remainder_label(parent)`: the parent's name with `" (rest)"` on the end. A
  suffix rather than a prefix, so a list sorted by name keeps it beside the
  sibling it would be confused with. It applies to 89 divisions of 2833 across
  the file, and takes the sibling groups that share one name from 23 to nought:

  ```text
  Han Kaeo             10.6 km²      Artigas (rest)     9909 km²
  Hang Dong             7.3 km²      Baltasar Brum       773 km²
  Hang Dong (rest)     71.2 km²      Bella Unión         564 km²
  Khun Khong            9.0 km²      Tomás Gomensoro     773 km²
  ```

  The name is borrowed either way — GADM offers none — so this is a label, not a
  claim about what anyone calls the place.
- **What identifies a division is its name, except where it has none**, and then
  it is the GID. 23 Thai districts hold both an unnamed tambon and a real one
  named after the district — Hang Dong in Chiang Mai, Ban Phai in Khon Kaen — so
  keying the unnamed one by the name it is displayed under would fold the two
  into one division and drop a polygon.
- **`COUNTRY` and `NAME_0` are one division** wherever they agree, which is all
  but 63 rows (Aksai Chin, filed under China, is one of the 63). A row naming
  nothing below the country therefore ends at `COUNTRY`, and that is the division
  its outline hangs on.

Keying *every* level by its GID would retire the whole class rather than this
case, and is deliberately not done: GADM also carries 95 name paths that resolve
to more than one GID — 88 of them in the United Kingdom, both of Belarus's
"Minsk" — and re-keying folds those differently. That is a second defect with its
own repair.

#### What an unnamed row is

Measured against `gadm_410.gpkg`, the 2831 rows are four unrelated things. The
count is per **row**, taken at the deepest level its GID reaches — a row that
leaves two levels unnamed (Sharjah does) is one row, not two — and the five lines
below sum to 2831:

| Where | Rows | What the row is |
|---|---|---|
| Russia | 2435 | A level the country does not populate. The row carries **no type either**, and its polygon is the whole of its parent — which is why merging it back under the parent's name loses nothing. |
| United Arab Emirates | 183 | 181 of them the same, at level 3; the other two are typed `Municipality`. Four made holes: the Abu Dhabi and Al Gharbia municipalities inside Abu Dhabi, and the nameless districts of Ras Al-Khaimah and Sharjah, where *both* levels below the emirate are unnamed. |
| Uruguay | 16 | The rest of a department. GADM's level 2 there is the *municipio*, and Uruguay's municipios cover the populated localities only, so the countryside belongs to none of them. Artigas is Baltasar Brum, Bella Unión, Tomás Gomensoro — and this. |
| Thailand | 195 `Tambon` | The part of a district its named tambon do not cover. 126 of those districts carry no other row at all, Bangkok's 50 *khet* among them, since GADM holds no *khwaeng* names. |
| Thailand | 2 `Lake` | The two halves of **Songkhla Lake**, on the Phatthalung and Songkhla sides, each filed as a `Water body` district holding one nameless `Lake`. |

It is *not* a town centre, which is what the shape of the data says plainly: the
unnamed row is the **largest** child of its parent in every one of the 86 cases
that reached the database, averaging 180 km² in Thailand against named siblings
of 7–17 km², and only one of the 195 Thai districts also holds a tambon called
*Nai Mueang*. A remainder, not a core.

That is also why the repair is worth the trouble in Uruguay: before it, a
department drew only its non-municipal countryside, and the map carried a hole
over every municipio — over the towns.

Not every GADM polygon reaches the database even so. Where two rows resolve to
the same name path, the second one's polygon is dropped: 21 of GADM 4.1's
356 508, in Cambodia (8), Spain (6), South Korea (4), Mexico (2) and Côte
d'Ivoire (1) — mostly names the source truncates to a common prefix, which is
[#540](https://github.com/uncovering-world/track-your-regions/issues/540)'s
subject seen from the other side. Before #665 it was 24: the three extra were
districts whose unnamed remainder was folded in and whose single named child then
triggered `merge_single_children`, which deleted the district and its polygon
together. Those three come back on the next load; the 21 need the second repair, tracked as
[#681](https://github.com/uncovering-world/track-your-regions/issues/681).

`has_children` is reconciled against the tree in one statement at the end of the
load, after `merge_single_children` has done its reparenting. The flag is
otherwise set from the row that first created a division and no later row
revisits it, so a division created by a row that named nothing below it would
stay a leaf however many children arrived afterwards — the shape a catalogue
check now asserts against (`docs/tech/data-assertions.md`, boundaries).

## Geometry Strategy

### Stored forms

- raw `geom` (WGS84 / 4326)
- simplified versions for lower detail levels
- Web Mercator derivatives (`*_3857`) for tile generation

### Why this matters

- API responses can choose detail level without recomputing simplification
- tile rendering avoids on-the-fly reprojection/simplification
- shared borders stay consistent across neighboring divisions

## Operational Notes

- First-time setup uses `db/init/01-schema.sql` + `db/init-db.py`
- Re-importing GADM should be done on a fresh/test DB, then promoted if needed
- Upstream GADM updates require re-import; IDs and parent links are recreated by the import process
