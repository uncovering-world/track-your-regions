/**
 * World Views API
 */

import type { DeleteImpact, WorldView, WorldViews } from '@tyr/shared/api';
import {
  deleteWorldViewsByWorldViewId, getWorldViews, getWorldViewsByWorldViewIdDeleteImpact, postWorldViews,
  putWorldViewsByWorldViewId, type CreateWorldViewBody, type UpdateWorldViewBody,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type { DeleteImpact, WorldView, WorldViews } from '@tyr/shared/api';

/**
 * Longest description the server keeps: `world_views.description` is
 * VARCHAR(1000) and the request schema bounds itself by that column. Mirrored
 * here so the field stops at the limit while it is being typed, rather than the
 * save coming back as a validation error.
 */
export const WORLD_VIEW_DESCRIPTION_MAX_LENGTH = 1000;

export async function fetchWorldViews(): Promise<WorldViews> {
  return getWorldViews();
}

export async function createWorldView(data: CreateWorldViewBody): Promise<WorldView> {
  return postWorldViews(data);
}

export async function updateWorldView(worldViewId: number, data: UpdateWorldViewBody): Promise<WorldView> {
  return putWorldViewsByWorldViewId(worldViewId, data);
}

export async function getDeleteImpact(worldViewId: number): Promise<DeleteImpact> {
  return getWorldViewsByWorldViewIdDeleteImpact(worldViewId);
}

/** The answer is a 204 with no body. */
export async function deleteWorldView(worldViewId: number): Promise<void> {
  await deleteWorldViewsByWorldViewId(worldViewId);
}
