import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The matcher and rematch controller are integration-shaped; pin the
// contracts at the SQL-source level: the batch write persists work-unit
// flags additively, and the rematch reset clears sign-off lifecycle
// without touching curation flags.
describe('work-unit persistence contracts', () => {
  it('matcher batch write persists is_work_unit and reference_division_ids with COALESCE', () => {
    const src = readFileSync(new URL('./matcher.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/is_work_unit = COALESCE\(\$3, is_work_unit\)/);
    expect(src).toMatch(/reference_division_ids = COALESCE\(\$4, reference_division_ids\)/);
  });

  it('country branches set isWorkUnit and referenceDivisionIds', () => {
    const src = readFileSync(new URL('./matcher.ts', import.meta.url), 'utf8');
    const countryFlagCount = (src.match(/isWorkUnit: true/g) ?? []).length;
    expect(countryFlagCount).toBeGreaterThanOrEqual(5); // 3 drill-down branches + ambiguous + leaf-country
  });

  it('grouping flow persists work-unit flags additively', () => {
    const src = readFileSync(new URL('./matcherGrouping.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/is_work_unit = COALESCE\(\$3, is_work_unit\)/);
    expect(src).toMatch(/reference_division_ids = COALESCE\(\$4, reference_division_ids\)/);
    expect((src.match(/isWorkUnit: true/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('rematch resets signoff lifecycle but not curation flags', () => {
    const src = readFileSync(
      new URL('../../controllers/admin/wvImportRematchController.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/signoff_status = 'not_started'/);
    expect(src).toMatch(/signed_off_at = NULL/);
    expect(src).not.toMatch(/hierarchy_confirmed\s*=/i);
    expect(src).not.toMatch(/is_work_unit\s*=\s*(FALSE|DEFAULT)/i);
  });
});
