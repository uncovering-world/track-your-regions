import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every act the trail can record has to be an act a screen can name.
 *
 * `experience_curation_log.action` is a closed list — a CHECK in
 * `db/init/01-schema.sql`, so a curator's act cannot be recorded at all until it is named
 * there — and `ACTION_LABELS` in `frontend/src/components/shared/curationLog.ts` is what
 * one of those rows reads as wherever it is named as a chip: an object's own History, and
 * the admin panel's curator-activity table. Nothing held the two lists together, and they
 * drifted apart nine times: the list grew one feature at a time — `published`, the two
 * source verdicts, the two admission ones, the four object-level lifecycle verdicts — and
 * each widening left both screens printing the raw column value, so a curator read
 * `admission_overridden` where the product says "put back" (#691).
 *
 * A text-level guard in the shape `tileScopeGuards.test.ts` and
 * `schemaMigrationParity.test.ts` already use, and in the backend suite for the reason
 * they give: `db/init/01-schema.sql` has no test runner of its own, and the frontend's
 * has no way to read it — that tsconfig keeps node's globals out of browser code on
 * purpose, and Vite refuses a `?raw` import from outside the frontend root. Which leaves
 * the two files' text, compared here. What the labels *say* is checked where they live,
 * in `curationLog.test.ts`, and that an admin's table reads them at all in
 * `CuratorPanel.activity.test.tsx`.
 *
 * The comparison is an equality rather than a coverage check, because the other direction
 * is a real failure too: a label keyed on a misspelt action would be dead code no screen
 * ever reaches, and no row would ever be named by it.
 */

const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
const LABELS_PATH = fileURLToPath(
  new URL('../../../frontend/src/components/shared/curationLog.ts', import.meta.url),
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8').replace(/\s+/g, ' ');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const labelsSource = readFileSync(LABELS_PATH, 'utf8');

/**
 * The actions the column accepts today.
 *
 * From the `ALTER TABLE` at the foot of the schema rather than the `CREATE TABLE` above
 * it: `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already holds the table,
 * so a widened CHECK is applied there and only there, and the two say the same thing only
 * as long as nobody widens one alone.
 */
function actionsInSchema(): string[] {
  const check = /experience_curation_log_action_check CHECK \(action IN \(([^)]+)\)\)/
    .exec(schema);
  expect(check, `no action CHECK found in ${SCHEMA_PATH}`).not.toBeNull();
  return [...check![1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
}

/** The actions the History has words for, as the keys of its label table. */
function actionsWithLabels(): string[] {
  const table = /export const ACTION_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(labelsSource);
  expect(table, `no ACTION_LABELS table found in ${LABELS_PATH}`).not.toBeNull();
  return [...table![1].matchAll(/^ {2}([a-z_]+): \{/gm)].map(match => match[1]).sort();
}

describe('the History names every act the trail can record', () => {
  const inSchema = actionsInSchema();
  const labelled = actionsWithLabels();

  it('read both lists, rather than matching nothing twice', () => {
    // Two regexes that quietly found nothing would agree perfectly and prove nothing.
    expect(inSchema).toContain('admission_overridden');
    expect(labelled).toContain('admission_overridden');
    expect(inSchema.length).toBeGreaterThanOrEqual(20);
  });

  it('has a label for each, and no label for an act that cannot happen', () => {
    expect(labelled).toEqual(inSchema);
  });
});
