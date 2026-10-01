import { resolve } from 'node:path';
import { pool } from '../db/index.js';
import { CoverageFilesError, defaultCoverageDir, readCoverageFiles } from '../services/catalogueCoverage/files.js';
import { CoverageRegisterMismatch, replaceCoverage, type CoverageLoadSummary } from '../services/catalogueCoverage/load.js';

/** Read `dir` and replace the catalogue-coverage tables with it (ADR-0081). */
export async function runLoadCatalogueCoverage(dir = defaultCoverageDir()): Promise<CoverageLoadSummary> {
  return replaceCoverage(readCoverageFiles(dir));
}

/**
 * CLI entrypoint: `--dir <path>` reads another directory than the checkout's. A relative
 * path is taken from where the command was typed: `npm --prefix backend run` moves the
 * working directory to `backend/` and leaves the caller's in `INIT_CWD`.
 */
async function main(): Promise<void> {
  const dirFlag = process.argv.indexOf('--dir');
  const given = dirFlag >= 0 ? process.argv[dirFlag + 1] : undefined;
  if (dirFlag >= 0 && !given) {
    console.error('loadCatalogueCoverage: --dir needs a path');
    process.exit(2);
  }
  const dir = given ? resolve(process.env.INIT_CWD ?? process.cwd(), given) : defaultCoverageDir();
  // db/index.ts falls back to localhost:5432/track_regions when no environment is
  // set, so say where the rows are going before they go.
  console.log(`Loading ${dir} into ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'track_regions'}`);
  try {
    const summary = await runLoadCatalogueCoverage(dir);
    console.log(`Loaded ${summary.kinds} kinds, ${summary.regions} regions, ${summary.expectations} expectations, ${summary.filings} filings under a kind.`);
  } catch (error) {
    if (error instanceof CoverageFilesError || error instanceof CoverageRegisterMismatch) {
      console.error(error.message);
      console.error('Nothing was loaded: the tables hold what they held.');
      await pool.end();
      process.exit(1);
    }
    throw error;
  }
  await pool.end();
  process.exit(0);
}

// Only run main() when invoked directly, not when imported by a spec.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
