/**
 * Source-contract test: the undo snapshot SELECT and restore INSERT column lists
 * must include all workflow columns added in the import-review redesign.
 *
 * If a column is added to region_import_state but omitted here, undoing a
 * dismiss-children / handle-as-grouping will silently reset curation state
 * even though Re-match All preserves it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const utilsSrc = readFileSync(join(__dirname, 'wvImportUtils.ts'), 'utf8');
const hierarchySrc = readFileSync(join(__dirname, 'wvImportHierarchyController.ts'), 'utf8');
const flattenSrc = readFileSync(join(__dirname, 'wvImportFlattenController.ts'), 'utf8');
const treeOpsSrc = readFileSync(join(__dirname, 'wvImportTreeOpsController.ts'), 'utf8');

const WORKFLOW_COLUMNS = [
  'is_work_unit',
  'hierarchy_confirmed',
  'signoff_status',
  'signed_off_at',
  'assignment_waived',
  'reference_division_ids',
];

/**
 * Extract SELECT blocks from region_import_state that are snapshot-style
 * (i.e., they select the full set of columns including needs_manual_fix).
 * These are the blocks that feed ImportStateSnapshot.
 */
function extractSnapshotSelectBlocks(src: string): string[] {
  const blocks: string[] = [];
  // Match backtick-quoted template literal SELECT blocks that reference region_import_state
  const re = /`([^`]*FROM\s+region_import_state[^`]*)`/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const block = m[1];
    // Only snapshot SELECTs include needs_manual_fix — narrow column selects are not snapshot SELECTs
    if (/\bneeds_manual_fix\b/.test(block)) {
      blocks.push(block);
    }
  }
  return blocks;
}

describe('undo snapshot/restore column coverage', () => {
  for (const col of WORKFLOW_COLUMNS) {
    it(`ImportStateSnapshot type includes "${col}"`, () => {
      expect(utilsSrc).toMatch(new RegExp(`\\b${col}\\b`));
    });

    it(`insertImportStatesIfMissing INSERT includes "${col}"`, () => {
      // Extract the insertImportStatesIfMissing function body from source
      const fnMatch = hierarchySrc.match(/async function insertImportStatesIfMissing[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toMatch(new RegExp(`\\b${col}\\b`));
    });

    it(`restoreParentImportState UPDATE includes "${col}"`, () => {
      const fnMatch = hierarchySrc.match(/async function restoreParentImportState[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toMatch(new RegExp(`\\b${col}\\b`));
    });

    it(`upsertImportState INSERT/UPDATE includes "${col}"`, () => {
      const fnMatch = hierarchySrc.match(/async function upsertImportState[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toMatch(new RegExp(`\\b${col}\\b`));
    });

    it(`undoCollapseToParent inline UPDATE includes "${col}"`, () => {
      const fnMatch = hierarchySrc.match(/async function undoCollapseToParent[\s\S]*?^}/m);
      expect(fnMatch).not.toBeNull();
      expect(fnMatch![0]).toMatch(new RegExp(`\\b${col}\\b`));
    });
  }

  for (const [label, src] of [
    ['wvImportFlattenController.ts', flattenSrc],
    ['wvImportTreeOpsController.ts', treeOpsSrc],
  ] as const) {
    describe(`${label} snapshot SELECTs`, () => {
      const selectBlocks = extractSnapshotSelectBlocks(src);

      it(`has at least one snapshot SELECT in ${label}`, () => {
        expect(selectBlocks.length).toBeGreaterThan(0);
      });

      for (const col of WORKFLOW_COLUMNS) {
        it(`every snapshot SELECT in ${label} includes "${col}"`, () => {
          expect(selectBlocks.length).toBeGreaterThan(0);
          for (const block of selectBlocks) {
            expect(block, `SELECT block missing "${col}":\n${block}`).toMatch(
              new RegExp(`\\b${col}\\b`),
            );
          }
        });
      }
    });
  }
});
