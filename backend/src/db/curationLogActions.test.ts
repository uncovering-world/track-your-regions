/**
 * The vocabularies both sides import are the schema's own — held by a type,
 * not by reading a file.
 *
 * `@tyr/shared/curationLog`, `@tyr/shared/auth` and `@tyr/shared/runStatuses`
 * declare, once for both sides, what an `experience_curation_log.action` may
 * be, what a user's role and sign-in provider may be, and what a run's, an
 * import's and a match's status may be. The schema is the third statement of each:
 * a CHECK list and two Postgres enums, which ADR-0064 renders into
 * `schema.generated.ts` as `CheckValue<…>` and two unions. The two
 * declarations have to be the same set, and TypeScript can say whether two
 * unions are: `expectTypeOf` here is checked by `tsc`, so an action added to
 * the schema and not to the package — or the other way round — fails
 * `typecheck:backend` before this file is ever run, and `vitest` reports the
 * same failure as a test. Until #789 this was `curationLogActionLabels.test.ts`,
 * which read the CHECK out of `01-schema.sql` and the labels out of the
 * frontend's `curationLog.ts` with regular expressions.
 *
 * The labels the drawing side gives each action are typed by the same union
 * (`ACTION_LABELS: Record<CurationLogAction, …>`), so an act with no label, or
 * a label for an act that cannot happen, is a type error on that side.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { CURATION_LOG_ACTIONS, POINT_VERDICT_ACTIONS, type CurationLogAction } from '@tyr/shared/curationLog';
import { AUTH_PROVIDERS, USER_ROLES, type AuthProvider, type UserRole } from '@tyr/shared/auth';
import {
  CLOSED_SYNC_STATUSES, IMPORT_RUN_STATUSES, MATCH_STATUSES, SYNC_LOG_STATUSES,
  type ClosedSyncStatus, type ImportRunStatus, type MatchStatus, type SyncLogStatus,
} from '@tyr/shared/runStatuses';
import {
  CHECK_VALUES,
  type AuthProvider as SchemaAuthProvider,
  type CheckValue,
  type UserRole as SchemaUserRole,
} from './schema.generated.js';

describe('the vocabularies both sides import', () => {
  it('name exactly the curation-log actions the schema allows', () => {
    expectTypeOf<CurationLogAction>().toEqualTypeOf<CheckValue<'experience_curation_log', 'action'>>();
    // The same claim at runtime, in the schema's order, so a reordering shows
    // up as a diff rather than as a type that still matches.
    expect([...CURATION_LOG_ACTIONS]).toEqual([...CHECK_VALUES.experience_curation_log.action]);
  });

  it('name the four point verdicts as actions that can happen', () => {
    for (const action of POINT_VERDICT_ACTIONS) expect(CURATION_LOG_ACTIONS).toContain(action);
  });

  it('name exactly the statuses a run, its source, an import and a match may carry (#794)', () => {
    expectTypeOf<SyncLogStatus>().toEqualTypeOf<CheckValue<'experience_sync_logs', 'status'>>();
    expectTypeOf<ClosedSyncStatus>().toEqualTypeOf<CheckValue<'experience_sources', 'last_sync_status'>>();
    expectTypeOf<ClosedSyncStatus>().toEqualTypeOf<Exclude<SyncLogStatus, 'running'>>();
    expectTypeOf<ImportRunStatus>().toEqualTypeOf<CheckValue<'import_runs', 'status'>>();
    expectTypeOf<MatchStatus>().toEqualTypeOf<CheckValue<'region_import_state', 'match_status'>>();
    expect([...SYNC_LOG_STATUSES]).toEqual([...CHECK_VALUES.experience_sync_logs.status]);
    expect([...CLOSED_SYNC_STATUSES]).toEqual([...CHECK_VALUES.experience_sources.last_sync_status]);
    expect([...IMPORT_RUN_STATUSES]).toEqual([...CHECK_VALUES.import_runs.status]);
    expect([...MATCH_STATUSES]).toEqual([...CHECK_VALUES.region_import_state.match_status]);
  });

  it('name exactly the roles and the sign-in providers the schema has', () => {
    expectTypeOf<UserRole>().toEqualTypeOf<SchemaUserRole>();
    expectTypeOf<AuthProvider>().toEqualTypeOf<SchemaAuthProvider>();
    expect(USER_ROLES).toHaveLength(3);
    expect(AUTH_PROVIDERS).toHaveLength(3);
  });
});
