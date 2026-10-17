"""Which rows a sample load reads (#610).

The continents are GADM 4.1's own: the eight its `CONTINENT` column holds, with
the row counts measured on `gadm_410.gpkg` — Antarctica's 8 and Asia's 160 688
are why a sample is a continent rather than a fraction of the file.
"""

import sqlite3

import pytest

from gadm_sample import continents, ogr_filter, resolve_continent, sql_filter

GADM_CONTINENTS = [
    "Africa", "Antarctica", "Asia", "Australia", "Europe", "North America", "Oceania", "South America",
]


@pytest.fixture
def gadm():
    """A GeoPackage's table, cut to the column a sample reads."""
    conn = sqlite3.connect(":memory:")
    conn.execute('CREATE TABLE gadm_410 ("CONTINENT" TEXT, "COUNTRY" TEXT)')
    conn.executemany(
        "INSERT INTO gadm_410 VALUES (?, ?)",
        [("Oceania", "Fiji"), ("Antarctica", "Antarctica"), ("Oceania", "Samoa"), ("", "")],
    )
    yield conn.cursor()
    conn.close()


def test_continents_are_the_ones_the_rows_name_once_each(gadm):
    assert continents(gadm, "gadm_410") == ["Antarctica", "Oceania"]


def test_a_continent_is_found_whatever_its_case():
    assert resolve_continent("oceania", GADM_CONTINENTS) == "Oceania"
    assert resolve_continent(" North America ", GADM_CONTINENTS) == "North America"


def test_a_continent_the_file_does_not_hold_is_refused_with_the_ones_it_does():
    # Europe is the continent; the European Union is not one GADM names.
    with pytest.raises(ValueError, match="no continent 'European Union'.*Africa, Antarctica"):
        resolve_continent("European Union", GADM_CONTINENTS)


def test_the_filter_reads_one_continent_and_a_full_load_reads_all(gadm):
    where, params = sql_filter("Oceania")
    # nosemgrep: python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- sqlite3, not SQLAlchemy; where is sql_filter's constant clause, whose value is bound, which is what this test reads
    gadm.execute(f'SELECT "COUNTRY" FROM gadm_410{where} ORDER BY 1', params)
    assert [row[0] for row in gadm.fetchall()] == ["Fiji", "Samoa"]
    assert sql_filter(None) == ("", ())


def test_the_geometry_filter_keeps_the_name_a_literal():
    assert ogr_filter("Oceania") == "CONTINENT = 'Oceania'"
    assert ogr_filter("Queen Maud's Land") == "CONTINENT = 'Queen Maud''s Land'"
    assert ogr_filter(None) is None
