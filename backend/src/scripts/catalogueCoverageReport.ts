import { pathToFileURL } from 'node:url';
import { coverageReport } from '../controllers/admin/catalogueCoverage/report.js';
import { renderCoverageReport } from '../controllers/admin/catalogueCoverage/reportText.js';
import { pool } from '../db/index.js';

/** The values of every `--region <slug>` on the command line. */
function regionArgs(argv: string[]): string[] {
  return argv.flatMap((arg, index) => (arg === '--region' && argv[index + 1] ? [argv[index + 1]] : []));
}

/**
 * CLI entrypoint: print the coverage report over what is loaded (ADR-0081).
 * `--region <slug>`, repeatable, narrows it; `--json` prints the report as data.
 */
async function main(): Promise<void> {
  const asked = regionArgs(process.argv);
  const report = await coverageReport(asked.length > 0 ? asked : undefined);
  await pool.end();
  // A slug that matched nothing is a typing mistake, and a report narrowed to nothing says nothing.
  const unknown = asked.filter(slug => !report.regions.some(region => region.slug === slug));
  if (unknown.length > 0) {
    console.error(`No surveyed region is loaded under: ${unknown.join(', ')}. The slugs are those of db/catalogue-coverage/regions.jsonl.`);
    process.exit(1);
  }
  if (report.regions.length === 0) {
    console.error('No surveyed region is loaded. Run the load first.');
    process.exit(1);
  }
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : renderCoverageReport(report));
  process.exit(0);
}

// Only run main() when invoked directly, not when imported by a spec.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
