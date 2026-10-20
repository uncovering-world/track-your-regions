"""A sample load: one continent of GADM instead of the whole world (#610).

A full load reads all 356 508 rows of GADM 4.1 and takes about half an hour;
a contributor prototyping on the map, or a lane that only needs a real-shaped
database, can take one continent instead, from Antarctica's 8 rows to Asia's
160 688. The continent is the one GADM writes in its own `CONTINENT` column,
so the sample is GADM's rows unchanged, only fewer of them.

What is decided here needs no database and no GDAL, so the loader's test lane
reads it: which continents a GeoPackage holds, which one a name asks for, and
the filter each reader of the file applies.
"""


def continents(sqlite_cursor, table_name):
    """The continents the GeoPackage's rows name, in order.

    `table_name` reaches SQL as an identifier, so it is the one the loader has
    already checked against its plain-identifier rule.
    """
    # nosemgrep: python.lang.security.audit.formatted-sql-query.formatted-sql-query,python.sqlalchemy.security.sqlalchemy-execute-raw-query.sqlalchemy-execute-raw-query -- sqlite3, not SQLAlchemy; table_name is an identifier (unbindable) the caller validated against TABLE_NAME_RE
    sqlite_cursor.execute(f'SELECT DISTINCT "CONTINENT" FROM "{table_name}" WHERE "CONTINENT" <> \'\' ORDER BY 1')  # noqa: S608  # nosec B608 -- see the nosemgrep line above
    return [row[0] for row in sqlite_cursor.fetchall()]


def resolve_continent(requested, available):
    """The continent `requested` names, as the file spells it.

    Case does not matter (`oceania` is Oceania). A name the file does not hold
    is refused with the ones it does, so a typo costs a line rather than a
    sample that loaded nothing and an empty map.
    """
    wanted = requested.strip().casefold()
    for name in available:
        if name.casefold() == wanted:
            return name
    raise ValueError(f"GADM names no continent {requested!r}; it names {', '.join(available)}")


def sql_filter(continent):
    """The WHERE clause and its parameters for the GeoPackage's own rows."""
    if continent is None:
        return "", ()
    return ' WHERE "CONTINENT" = ?', (continent,)


def ogr_filter(continent):
    """The same filter as an OGR attribute filter, for the geometry pass.

    OGR's filter takes no parameters, so the name is quoted as OGR SQL quotes a
    string literal. The name is one `resolve_continent` returned, a value the
    file itself holds, and the quoting keeps even such a value a literal.
    """
    if continent is None:
        return None
    return "CONTINENT = '" + continent.replace("'", "''") + "'"
