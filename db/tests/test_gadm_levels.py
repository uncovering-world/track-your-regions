"""What one GADM row says about the divisions it names.

Every record here is a real row of `gadm_410.gpkg`, trimmed to the columns the
rule reads. The Thai ones are the shapes #665 was measured on: an unnamed tambon
whose district already holds named siblings, an unnamed tambon whose district
holds a sibling *named after the district*, and an unnamed one that is its
district's only row.
"""

from gadm_levels import REMAINDER_SUFFIX, remainder_label, row_divisions, row_levels


def record(**fields):
    """A GADM row: the named columns, and every other one empty."""
    row = {
        "CONTINENT": "", "SUBCONT": "", "SOVEREIGN": "", "GOVERNEDBY": "",
        "COUNTRY": "", "REGION": "", "UID": 1,
    }
    row.update({f"NAME_{i}": "" for i in range(6)})
    row.update({f"GID_{i}": "" for i in range(6)})
    row.update(fields)
    return row


THAI_DISTRICT = {
    "CONTINENT": "Asia",
    "COUNTRY": "Thailand",
    "NAME_0": "Thailand",
    "GID_0": "THA",
    "NAME_1": "Nakhon Ratchasima",
    "GID_1": "THA.29_1",
    "NAME_2": "Muang Nakhon Ratchasima",
    "GID_2": "THA.29.20_1",
}


def test_an_unnamed_level_is_a_division_of_its_own():
    """The row #665 was found on: an empty NAME_3 beside a valid GID_3.

    Read by its names alone the row ends at the district, which then holds one
    tambon's polygon while its other tambons arrive as children — the hole in
    Thailand.
    """
    levels = row_levels(record(**THAI_DISTRICT, NAME_3="", GID_3="THA.29.20.1_1", UID=317553))

    assert [level.level for level in levels] == ["CONTINENT", "COUNTRY", "NAME_1", "NAME_2", "NAME_3"]
    assert levels[-1].name is None
    assert levels[-1].key == "THA.29.20.1_1"


def test_a_named_level_is_unchanged():
    """A tambon GADM does name reads exactly as it did before the fix."""
    levels = row_levels(record(**THAI_DISTRICT, NAME_3="Nai Mueang", GID_3="THA.29.20.9_1"))

    assert levels[-1].name == "Nai Mueang"
    assert levels[-1].key == "Nai Mueang"


def test_an_unnamed_level_does_not_collide_with_a_sibling_named_after_the_parent():
    """Hang Dong in Chiang Mai, and 22 other Thai districts like it.

    The district holds both an unnamed tambon and a real one named after the
    district. The unnamed one is *called* after its parent, so a single child
    still collapses back into it — but it is keyed by its GID, so the two do not
    fold into one division and lose a polygon.
    """
    district = {
        "CONTINENT": "Asia", "COUNTRY": "Thailand", "NAME_0": "Thailand", "GID_0": "THA",
        "NAME_1": "Chiang Mai", "GID_1": "THA.10_1",
        "NAME_2": "Hang Dong", "GID_2": "THA.10.7_1",
    }
    unnamed = row_levels(record(**district, NAME_3="", GID_3="THA.10.7.1_1", UID=316016))
    named = row_levels(record(**district, NAME_3="Hang Dong", GID_3="THA.10.7.5_1", UID=316020))

    assert unnamed[-1].name is None
    assert named[-1].name == "Hang Dong"
    assert unnamed[-1].key != named[-1].key


def test_an_unnamed_level_that_is_its_parents_only_row_is_still_a_division():
    """All 2435 Russian rows, and 128 of Thailand's districts.

    Materialising it changes nothing on the map: it is called after its parent,
    so `merge_single_children` collapses the redundant pair and the polygon
    surfaces under the parent's name exactly as it does today. Keeping the rule
    the same for both shapes is what makes that true.
    """
    levels = row_levels(record(
        CONTINENT="Europe", COUNTRY="Russia", NAME_0="Russia", GID_0="RUS",
        NAME_1="Adygey", GID_1="RUS.1_1",
        NAME_2="Giaginskiy rayon", GID_2="RUS.1.1_1",
        NAME_3="", GID_3="RUS.1.1.1_1", UID=272378,
    ))

    assert levels[-1].level == "NAME_3"
    assert levels[-1].name is None
    assert levels[-1].key == "RUS.1.1.1_1"


def test_the_country_is_named_once():
    """`NAME_0` repeats `COUNTRY` on all but 63 of GADM's 356 508 rows.

    The two name one division, so the row that carries a country's own outline
    and nothing below it ends at `COUNTRY` — which is then the leaf the polygon
    hangs on, rather than a child of itself.
    """
    levels = row_levels(record(
        CONTINENT="South America", COUNTRY="Aruba", NAME_0="Aruba", GID_0="ABW", UID=3379,
    ))

    assert [level.level for level in levels] == ["CONTINENT", "COUNTRY"]
    assert levels[-1].name == "Aruba"


def test_a_disputed_area_named_differently_from_its_country_is_kept():
    """Aksai Chin, filed under China and named at level zero only.

    63 of GADM's rows name something at `NAME_0` other than their country, and
    dropping the level because it *usually* repeats would lose them.
    """
    levels = row_levels(record(
        CONTINENT="Asia", SOVEREIGN="China", COUNTRY="China",
        NAME_0="Aksai Chin", GID_0="Z03", UID=331,
    ))

    assert [level.name for level in levels] == ["Asia", "China", "Aksai Chin"]


def test_a_governed_territory_is_named_at_the_level_that_carries_it():
    """The Falklands: a sovereign that is not the country, and no governor."""
    levels = row_levels(record(
        CONTINENT="South America", SOVEREIGN="United Kingdom",
        COUNTRY="Falkland Islands", NAME_0="Falkland Islands", GID_0="FLK",
    ))

    assert [level.level for level in levels] == ["CONTINENT", "SOVEREIGN", "COUNTRY"]


def test_a_country_that_governs_itself_names_no_subcountry_level():
    """Djibouti, which fills both columns with its own name."""
    levels = row_levels(record(
        CONTINENT="Africa", SOVEREIGN="Djibouti", GOVERNEDBY="Djibouti",
        COUNTRY="Djibouti", NAME_0="Djibouti", GID_0="DJI",
    ))

    assert [level.level for level in levels] == ["CONTINENT", "COUNTRY"]


def test_a_level_with_neither_a_name_nor_a_gid_is_not_a_division():
    """The columns below a row's own depth are empty, and name nothing.

    Only a level GADM left unnamed *while giving it a GID* is a division, which
    is what separates Thailand's 197 unnamed units from the four empty columns
    every row of the file carries below its own depth.
    """
    levels = row_levels(record(**THAI_DISTRICT, UID=317552))

    assert [level.level for level in levels] == ["CONTINENT", "COUNTRY", "NAME_1", "NAME_2"]


def paths(records):
    """The tree a sequence of rows builds: path -> (name, carries a polygon).

    The loader's own walk, with the cursors taken out: get or create each
    division a row names, under the one above it.
    """
    tree = {}
    for row in records:
        for division in row_divisions(row):
            tree.setdefault(division.path, (division.name, division.is_leaf))
    return tree


def test_a_district_whose_unnamed_remainder_comes_first_is_not_left_a_leaf():
    """#665's shape exactly, in the order the file has it.

    Muang Nakhon Ratchasima's unnamed remainder (UID 317553) is the first row of its
    district in gadm_410.gpkg, and its named tambons follow. Reading the names
    alone made the district a leaf carrying that polygon, and the tambons
    that followed became children of a row nothing would ever union.
    """
    tree = paths([
        record(**THAI_DISTRICT, NAME_3="", GID_3="THA.29.20.1_1", UID=317553),
        record(**THAI_DISTRICT, NAME_3="Nai Mueang", GID_3="THA.29.20.9_1", UID=317561),
        record(**THAI_DISTRICT, NAME_3="Ban Ko", GID_3="THA.29.20.2_1", UID=317554),
    ])

    district = "Asia_Thailand_Nakhon Ratchasima_Muang Nakhon Ratchasima"
    assert tree[district] == ("Muang Nakhon Ratchasima", False)
    assert tree[f"{district}_THA.29.20.1_1"] == ("Muang Nakhon Ratchasima", True)
    assert tree[f"{district}_Nai Mueang"] == ("Nai Mueang", True)
    assert tree[f"{district}_Ban Ko"] == ("Ban Ko", True)


def test_the_order_of_the_rows_does_not_change_the_tree():
    """The remainder last is the same tree as the remainder first.

    It was not: whichever row came first decided whether the district was a
    parent, and nothing revisited it.
    """
    remainder = record(**THAI_DISTRICT, NAME_3="", GID_3="THA.29.20.1_1", UID=317553)
    named = record(**THAI_DISTRICT, NAME_3="Nai Mueang", GID_3="THA.29.20.9_1", UID=317561)

    assert paths([remainder, named]) == paths([named, remainder])


def test_an_unnamed_remainder_and_a_sibling_named_after_the_district_stay_apart():
    """Hang Dong: two rows, two divisions, both called Hang Dong.

    Keyed by the name they are displayed under, the second row would find the
    first already there and its polygon would never be stored.
    """
    district = {
        "CONTINENT": "Asia", "COUNTRY": "Thailand", "NAME_0": "Thailand", "GID_0": "THA",
        "NAME_1": "Chiang Mai", "GID_1": "THA.10_1",
        "NAME_2": "Hang Dong", "GID_2": "THA.10.7_1",
    }
    tree = paths([
        record(**district, NAME_3="", GID_3="THA.10.7.1_1", UID=316016),
        record(**district, NAME_3="Hang Dong", GID_3="THA.10.7.5_1", UID=316020),
    ])

    leaves = [path for path, (_, is_leaf) in tree.items() if is_leaf]
    assert len(leaves) == 2
    assert all(tree[path][0] == "Hang Dong" for path in leaves)


def test_a_row_says_which_of_its_divisions_the_source_named():
    """The loader has to know which name it borrowed, to relabel it later."""
    divisions = row_divisions(record(**THAI_DISTRICT, NAME_3="", GID_3="THA.29.20.1_1", UID=317553))

    assert [d.named for d in divisions] == [True, True, True, True, False]
    assert divisions[-1].name == "Muang Nakhon Ratchasima"


def test_a_named_level_is_marked_as_named():
    divisions = row_divisions(record(**THAI_DISTRICT, NAME_3="Nai Mueang", GID_3="THA.29.20.9_1"))

    assert divisions[-1].named is True


def test_a_remainder_is_labelled_next_to_the_sibling_it_would_be_confused_with():
    """A suffix, so a list sorted by name keeps the two together.

    Hang Dong district holds a tambon GADM names Hang Dong and one it does not.
    Both are called Hang Dong until this label separates them, and a prefix would
    file them apart.
    """
    label = remainder_label("Hang Dong")

    assert label == "Hang Dong (rest)"
    assert sorted(["Han Kaeo", "Hang Dong", label, "Khun Khong"]) == [
        "Han Kaeo", "Hang Dong", "Hang Dong (rest)", "Khun Khong",
    ]


def test_the_label_is_built_from_one_suffix():
    """So the migration and the loader cannot drift apart on the wording."""
    assert remainder_label("Artigas") == "Artigas" + REMAINDER_SUFFIX


def test_a_row_can_leave_two_levels_unnamed():
    """Sharjah and Ras Al-Khaimah: an unnamed district inside an unnamed emirate row.

    Both levels borrow the emirate's name, so the inner one is the outer one's
    only child and `merge_single_children` collapses the pair -- which is why the
    loader carries where a name came from rather than reading it off the tree
    afterwards. These two rows are also why the file's 2831 unnamed *rows* are
    2833 unnamed divisions.
    """
    divisions = row_divisions(record(
        CONTINENT="Asia", COUNTRY="United Arab Emirates", NAME_0="United Arab Emirates",
        GID_0="ARE", NAME_1="Sharjah", GID_1="ARE.6_1",
        NAME_2="", GID_2="ARE.6.1_1", NAME_3="", GID_3="ARE.6.1.1_1", UID=329863,
    ))

    assert [d.named for d in divisions] == [True, True, True, False, False]
    assert [d.name for d in divisions[-2:]] == ["Sharjah", "Sharjah"]
    assert divisions[-1].path.endswith("_ARE.6.1_1_ARE.6.1.1_1")
