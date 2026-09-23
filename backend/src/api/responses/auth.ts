/**
 * What the sign-in and account calls answer (ADR-0066): the success bodies of
 * the endpoints `frontend/src/api/auth.ts` calls, and of the session refresh
 * `frontend/src/api/fetchUtils.ts` makes, declared once. That is a session
 * started, refreshed or exchanged for, a password changed, the messages the
 * registration flow answers with, and the signed-in account.
 *
 * These describe the shape of what the body carries and nothing else. A body
 * that starts a session carries the access token and nothing more secret: the
 * refresh token travels only in its httpOnly cookie, and no schema here names
 * it.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { AUTH_PROVIDERS, USER_ROLES } from '@tyr/shared/auth';
import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true });

export const PublicUser = z.strictObject({
  id: z.number().int(),
  uuid: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: z.enum(USER_ROLES),
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  authProvider: z.enum(AUTH_PROVIDERS).nullable().describe('How the account signs in: a password, or an OAuth provider.'),
}).describe('The signed-in account, as the app shows it: never a hash, a provider id or a token.');
export type PublicUser = z.infer<typeof PublicUser>;

const accessToken = z.string()
  .describe('The short-lived access token, held in memory and sent as a Bearer token. The refresh token is not in the body: it is set as an httpOnly cookie.');

export const SessionStarted = z.strictObject({
  accessToken,
  user: PublicUser,
}).describe('A session started by signing in or verifying an email, or renewed from the refresh cookie.');
export type SessionStarted = z.infer<typeof SessionStarted>;

export const CodeExchanged = z.strictObject({
  accessToken,
}).describe('An OAuth sign-in\'s one-time code exchanged for a session. The account is read afterwards.');
export type CodeExchanged = z.infer<typeof CodeExchanged>;

export const PasswordChanged = z.strictObject({
  accessToken,
  message: z.string().describe('The sentence to show, which says the other sessions were signed out.'),
}).describe('A password changed: every refresh token revoked, and a new session for this device.');
export type PasswordChanged = z.infer<typeof PasswordChanged>;

export const AuthMessage = z.strictObject({
  message: z.string(),
}).describe('What registration and a resent verification answer, the same whether or not the address has an account.');
export type AuthMessage = z.infer<typeof AuthMessage>;

export const LoggedOut = z.strictObject({
  success: z.literal(true),
}).describe('A session ended: the refresh token revoked and its cookie cleared.');
export type LoggedOut = z.infer<typeof LoggedOut>;

export const CuratorScope = z.strictObject({
  id: z.number().int(),
  scopeType: z.enum(CHECK_VALUES.curator_assignments.scope_type)
    .describe('What the assignment reaches: one region, one source, or everything.'),
  regionId: z.number().int().nullable(),
  regionName: z.string().nullable(),
  sourceId: z.number().int().nullable(),
  sourceName: z.string().nullable(),
  assignedAt: timestamp.nullable(),
  notes: z.string().nullable(),
}).describe('One curator assignment.');
export type CuratorScope = z.infer<typeof CuratorScope>;

export const MyAccount = z.strictObject({
  id: z.number().int(),
  uuid: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: z.enum(USER_ROLES),
  avatarUrl: z.string().nullable(),
  curatorScopes: z.array(CuratorScope).optional()
    .describe('Sent to a curator or an admin: what their curation reaches.'),
}).describe('The signed-in account, with what a curator\'s assignments reach.');
export type MyAccount = z.infer<typeof MyAccount>;
