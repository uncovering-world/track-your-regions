"""Which divisions one GADM row names.

A row of `gadm_410.gpkg` is a single polygon plus the names of every level above
it, so the loader has to decide which of those levels are divisions of their own
and which are repetitions of a level it has already seen. That decision is pure
— it reads one row and nothing else — so it lives here, away from the cursors
and the geometry, where a test can put a row in front of it.

Two things it is answering, and both were wrong before #665:

**An unnamed level is still a division.** GADM 4.1 leaves the deepest `NAME_n`
empty on 2831 rows that carry a valid `GID_n` and a polygon — 2435 in Russia,
197 in Thailand, 183 in the United Arab Emirates, 16 in Uruguay. What such a row
holds is the part of its parent the source's *named* units do not cover, and
that is a different thing in each country. In Russia it is a level the country
does not populate at all: the row carries no type either and stands for the whole
of its parent, which is why folding it back under the parent's name loses
nothing. Elsewhere it is a real place — the countryside of a Uruguayan
department, which belongs to no *municipio*; the tambon of a Thai district whose
names GADM does not carry; all of a Bangkok *khet*; two of the United Arab
Emirates' municipalities; or, twice, a half of Songkhla Lake.
`docs/tech/gadm-mapping.md` has the count per country and what each one is. Reading only the names
ends such a row one level early and hands its polygon to the district above it,
which is then a leaf carrying one tambon while its named siblings arrive
afterwards as its children. Nothing unions them into any ancestor again, so the
province, the country and the continent each hold a hole where that district's
other tambons are: 54 interior rings in Thailand's polygon, 20 742 km² of them.

**What identifies a division is not always its name.** The obvious way to name
an unnamed level is after its parent, which is what the parent already surfaces
as today wherever the unnamed row is the only row of its parent (all 2435
Russian ones, 128 of Thailand's districts) — and naming it anything else would
stop `merge_single_children` from collapsing that redundant pair, restructuring
those rows for no reason. But 23 Thai districts hold *both* an unnamed tambon
and a real one named after the district — Hang Dong in Chiang Mai, Ban Phai in
Khon Kaen — so a division keyed by its name would fold the two into one and drop
a polygon that reaches the database today. An unnamed level is therefore keyed
by its GID, which is what GADM identifies it by, while still being *called*
after its parent.

Keying every level by its GID would remove the whole class rather than this one
case, and the issue says so. It is deliberately not done here: GADM also carries
95 name paths that resolve to more than one GID — 88 of them in the United
Kingdom, both of Belarus's "Minsk" — and re-keying folds them differently, which
is a second defect with its own measurements and its own repair (#681), not a
detail of this one.
"""

from typing import NamedTuple

#: The two levels GADM uses for a territory governed by another country. A row
#: carries at most one of them meaningfully; the first non-empty one is the one
#: that names a division.
SUBCOUNTRY_LEVELS = ["SOVEREIGN", "GOVERNEDBY"]

#: The levels that carry a GID beside their name, outermost first.
NAME_LEVELS = [f"NAME_{i}" for i in range(6)]

#: Every level a GADM row can name a division at, outermost first.
GEO_LEVELS = (
    ["CONTINENT", "SUBCONT"]
    + SUBCOUNTRY_LEVELS
    + ["COUNTRY", "REGION"]
    + NAME_LEVELS
)

#: The columns `row_levels` reads, so the loader can select exactly them.
GID_LEVELS = [f"GID_{i}" for i in range(6)]
PROPERTIES = GEO_LEVELS + GID_LEVELS + ["UID"]


class RowLevel(NamedTuple):
    """One division a GADM row names."""

    #: The column the division came from, e.g. `COUNTRY` or `NAME_3`.
    level: str
    #: What GADM calls it, or `None` where GADM left the level unnamed. The
    #: caller names an unnamed division after its parent.
    name: str | None
    #: What identifies the division among its siblings across rows: its name,
    #: or its GID where it has no name.
    key: str


def _gid(record: dict, level: str) -> str | None:
    """The GID beside a `NAME_n` level, where the level has one."""
    if not level.startswith("NAME_"):
        return None
    value = record.get(f"GID_{level[len('NAME_'):]}")
    return value or None


class RowDivision(NamedTuple):
    """One division a GADM row names, placed in the tree."""

    #: What identifies the division across rows: the keys of every level above
    #: it and its own, joined. Two rows naming the same division agree here.
    path: str
    #: The path of the division above it, or `None` at the top.
    parent_path: str | None
    #: What the division is called. An unnamed level is called after its parent.
    name: str
    #: Whether this row's own polygon belongs to it: true for the last one.
    is_leaf: bool
    #: Whether GADM named the level. `False` means the name above is borrowed
    #: from the parent, and the division wants `remainder_label` if it ends up
    #: standing beside siblings rather than being folded back into the parent.
    named: bool


def row_levels(record: dict) -> list[RowLevel]:
    """The divisions this GADM row names, outermost first.

    The last entry is the leaf that carries the row's own polygon; every entry
    before it has children by construction. `NAME_0` is dropped where it repeats
    `COUNTRY`, since the two name one division rather than two — which is also
    why a row naming nothing below the country ends at `COUNTRY` and is that
    country's own polygon.
    """
    subcountry = next((level for level in SUBCOUNTRY_LEVELS if record.get(level)), None)
    country = record.get("COUNTRY")

    levels: list[RowLevel] = []
    for level in GEO_LEVELS:
        name = record.get(level) or None
        gid = _gid(record, level)

        if level in SUBCOUNTRY_LEVELS:
            # A territory is named at one of the two levels, and a country that
            # governs itself repeats its own name rather than naming a level.
            if level != subcountry or name == country:
                continue

        if level == "NAME_0" and name == country:
            continue

        if name is None and gid is None:
            continue

        levels.append(RowLevel(level=level, name=name, key=name or gid or ""))

    return levels


def row_divisions(record: dict) -> list[RowDivision]:
    """The divisions this GADM row names, placed in the tree, outermost first.

    Everything the loader decides from a record alone: which divisions it names,
    what each is called, what identifies it, and which of them the row's polygon
    belongs to. Reading a file is then a walk over this — get or create each
    division under the one above it — which is what makes the ordering the rows
    happen to arrive in stop mattering.

    It used to matter, and that was #665: a district whose unnamed remainder came
    first in the file was created as a leaf, and the named tambons that followed
    became its children without the flag or the geometry ever being revisited.
    """
    keys: list[str] = []
    divisions: list[RowDivision] = []
    parent_path: str | None = None
    parent_name: str | None = None

    levels = row_levels(record)
    for index, level in enumerate(levels):
        keys.append(level.key)
        path = "_".join(keys)
        # An unnamed level is called after its parent -- the name that division
        # already surfaces under wherever it is its parent's only row.
        name = level.name or parent_name or level.key
        divisions.append(RowDivision(
            path=path,
            parent_path=parent_path,
            name=name,
            is_leaf=index == len(levels) - 1,
            named=level.name is not None,
        ))
        parent_path = path
        parent_name = name

    return divisions


#: What is appended to a remainder that stands beside named siblings.
REMAINDER_SUFFIX = " (rest)"


def remainder_label(parent_name: str) -> str:
    """What to call an unnamed division that ends up beside named siblings.

    Borrowing the parent's name is right while the division is its parent's only
    row: `merge_single_children` then collapses the redundant pair and the
    polygon surfaces under that name, which is what it has always done. Where the
    parent has other children the pair is not collapsed, and two things called
    the same thing are left standing one inside the other -- and in 23 Thai
    districts a *named* sibling carries it as well, so the tree offers "Hang
    Dong" three times under Hang Dong.

    What the row actually holds is the part of its parent the named units leave
    over, so that is what it is called. A suffix rather than a prefix, because a
    tree sorted by name keeps it next to the sibling it would otherwise be
    confused with:

        Han Kaeo
        Hang Dong          <- the tambon GADM names
        Hang Dong (rest)   <- everything in the district the named ones miss

    The name is only ever borrowed, so this is a label rather than a fact about
    the place: GADM offers no name for these rows at all.
    """
    return f"{parent_name}{REMAINDER_SUFFIX}"
