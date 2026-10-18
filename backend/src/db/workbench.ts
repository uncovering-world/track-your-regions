/**
 * The schema the tables built from public dumps live in (ADR-0124): the
 * Wikidata subset, readership, English Wikipedia's structure, the redirects and
 * the dump builds' ledger. The database's search path is `public, workbench`,
 * so a reader names them bare; what creates a table there, or asks the catalog
 * about one, names the schema, since a bare `CREATE TABLE` lands in `public`.
 */
export const WORKBENCH_SCHEMA = 'workbench';

/** A table's name in the workbench schema, for a statement that creates it or asks the catalog about it. */
export const inWorkbench = (table: string) => `${WORKBENCH_SCHEMA}.${table}`;
