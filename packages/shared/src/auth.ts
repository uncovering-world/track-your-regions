/**
 * Who a user can be, and how they signed in — the two Postgres enums
 * `user_role` and `auth_provider`, as both sides read them.
 *
 * The backend's generated row types carry the same unions from the schema
 * (`UserRole`, `AuthProvider` in `backend/src/db/schema.generated.ts`,
 * ADR-0064); `backend/src/db/curationLogActions.test.ts` asks TypeScript
 * whether these and those are the same, so a value added to the schema alone
 * fails the typecheck. The frontend reads its `User` type off these. Neither
 * list authorises anything: what a role may do is decided on the server, per
 * route (`requireCurator`, `requireAdmin`).
 */

export const USER_ROLES = ['user', 'curator', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const AUTH_PROVIDERS = ['local', 'google', 'apple'] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];
