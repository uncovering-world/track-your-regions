/**
 * What the admin panel's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/admin/index.ts` calls, declared once. That is
 * placing experiences into a world view's regions and what it placed, and the
 * curator directory: its curators and their assignments, what a curator did,
 * and the people an admin can make one.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { CURATION_LOG_ACTIONS } from '@tyr/shared/curationLog';
import { z } from 'zod/v4';
import { CHECK_VALUES } from '../../db/schema.generated.js';
import { CuratorScope, UserRole } from './auth.js';

/** A timestamp as the wire carries it: the handler converts the driver's `Date`. */
const timestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// Placing experiences into regions
// ---------------------------------------------------------------------------

export const AssignmentStarted = z.strictObject({
  started: z.literal(true),
  worldViewId: z.number().int(),
  worldViewName: z.string(),
  sourceId: z.number().int().nullable().describe('The one source placed, or null for every source.'),
  message: z.string(),
}).describe('A placement of experiences into a world view\'s regions, started in the background.');
export type AssignmentStarted = z.infer<typeof AssignmentStarted>;

export const AssignmentStatus = z.strictObject({
  running: z.boolean(),
  status: z.enum(['assigning', 'propagating', 'denormalizing', 'complete', 'failed', 'cancelled']).optional()
    .describe('The step: each point placed in its leaf regions, then carried up to their ancestors, then an experience\'s regions written from its points.'),
  statusMessage: z.string().optional(),
  directAssignments: z.number().int().optional().describe('Points placed in the regions that contain them.'),
  ancestorAssignments: z.number().int().optional().describe('Placements carried up to those regions\' ancestors.'),
  totalAssignments: z.number().int().optional(),
  errors: z.number().int().optional(),
}).describe('A world view\'s placement as it stands. Only `running` is sent while no run is known since the server started.');
export type AssignmentStatus = z.infer<typeof AssignmentStatus>;

export const AssignmentCancelled = z.strictObject({
  cancelled: z.boolean().describe('False when no placement was running to stop.'),
}).describe('A stop asked of a world view\'s placement.');
export type AssignmentCancelled = z.infer<typeof AssignmentCancelled>;

export const PlacementCount = z.strictObject({
  regionId: z.number().int(),
  regionName: z.string(),
  count: z.number().int(),
}).describe('How many experiences are placed in one region.');
export type PlacementCount = z.infer<typeof PlacementCount>;

export const PlacementCounts = z.array(PlacementCount)
  .describe('Every region of the world view holding at least one experience, most first.');
export type PlacementCounts = z.infer<typeof PlacementCounts>;

// ---------------------------------------------------------------------------
// The curator directory
// ---------------------------------------------------------------------------

export const CuratorInfo = z.strictObject({
  user_id: z.number().int(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: UserRole,
  avatar_url: z.string().nullable(),
  scopes: z.array(CuratorScope).describe('Newest first. An admin with none curates everything by role.'),
}).describe('One person who curates: every admin, and every curator with an assignment.');
export type CuratorInfo = z.infer<typeof CuratorInfo>;

export const Curators = z.array(CuratorInfo).describe('Everyone who curates, by display name.');
export type Curators = z.infer<typeof Curators>;

export const CuratorAssignmentCreated = z.strictObject({
  id: z.number().int(),
  userId: z.number().int(),
  scopeType: z.enum(CHECK_VALUES.curator_assignments.scope_type),
  regionId: z.number().int().nullable(),
  sourceId: z.number().int().nullable(),
  assignedAt: timestamp.nullable(),
  rolePromoted: z.boolean().describe('The person was a `user`, and is a `curator` now.'),
}).describe('A curator assignment granted.');
export type CuratorAssignmentCreated = z.infer<typeof CuratorAssignmentCreated>;

export const CuratorAssignmentRevoked = z.strictObject({
  success: z.literal(true),
  assignmentId: z.number().int(),
  userId: z.number().int(),
  remainingAssignments: z.number().int(),
  roleReverted: z.boolean().describe('The last assignment went, and the curator is a `user` again.'),
}).describe('A curator assignment taken back.');
export type CuratorAssignmentRevoked = z.infer<typeof CuratorAssignmentRevoked>;

export const CuratorActivityEntry = z.strictObject({
  id: z.number().int(),
  action: z.enum(CURATION_LOG_ACTIONS),
  created_at: timestamp.nullable(),
  details: z.record(z.string(), z.unknown()).nullable()
    .describe('What the act changed, in the shape its action writes.'),
  experience_id: z.number().int(),
  experience_name: z.string(),
  region_id: z.number().int().nullable(),
  region_name: z.string().nullable(),
}).describe('One act of a curator\'s, on one experience.');
export type CuratorActivityEntry = z.infer<typeof CuratorActivityEntry>;

export const CuratorActivity = z.strictObject({
  activity: z.array(CuratorActivityEntry).describe('Newest first.'),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
}).describe('A page of what one curator did.');
export type CuratorActivity = z.infer<typeof CuratorActivity>;

export const UserSearchResult = z.strictObject({
  id: z.number().int(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  role: UserRole,
}).describe('One account whose name or email matched.');
export type UserSearchResult = z.infer<typeof UserSearchResult>;

export const UserSearchResults = z.array(UserSearchResult)
  .describe('Up to twenty accounts, by display name.');
export type UserSearchResults = z.infer<typeof UserSearchResults>;
