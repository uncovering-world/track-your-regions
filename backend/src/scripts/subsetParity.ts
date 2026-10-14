/**
 * Prints how the local Wikidata subset answers the questions the runs asked
 * the live service and cached (#1458): per question shape, how many agree and
 * what differs: a developer's check of the subset's answers. No run reads
 * the subset yet.
 *
 *   npm --prefix backend run subset:parity [-- --limit 200]
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../.env') });

const { pool } = await import('../db/index.js');
const { compareCached } = await import('../services/sync/subset/parity.js');

const limitAt = process.argv.indexOf('--limit');
const limit = limitAt >= 0 ? Number(process.argv[limitAt + 1]) : 200;
if (!Number.isSafeInteger(limit) || limit < 1) {
  console.error(`--limit takes a whole number of questions per shape, at least 1: got ${process.argv[limitAt + 1] ?? 'nothing'}.`);
  process.exit(1);
}
const built = await pool.query<{ dump_date: string }>(
  "SELECT to_char(dump_date, 'YYYY-MM-DD') AS dump_date FROM wikidata_subset_builds ORDER BY swapped_at DESC LIMIT 1",
);
if (!built.rows[0]) {
  console.error('No subset is built: build it from the admin panel (Public Dumps, All entities) first.');
  process.exitCode = 1;
} else {
  console.log(`Subset from the dump of ${built.rows[0].dump_date}`);
  const { reports, notCompared } = await compareCached(limit);
  for (const report of reports) {
    console.log(`${report.shape}: ${report.agreeing} of ${report.questions} agree; ${report.onlyLive} keys only live, ${report.onlySubset} only in the subset`
      + (report.skipped > 0 ? `; ${report.skipped} older question(s) past --limit ${limit} not compared` : ''));
    for (const example of report.examples) console.log(`  ${example}`);
  }
  console.log(`${notCompared} cached question(s) of shapes the subset does not answer yet`);
}
await pool.end();
