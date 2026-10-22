/**
 * What Jev has cost, and how often curators chose what it suggested (#1260).
 */

import type { JevUsage } from '../adminClient.generated';
import { getAdminJevUsage } from '../adminClient.generated';

export type { JevUsage } from '../adminClient.generated';

export async function getJevUsage(): Promise<JevUsage> {
  return getAdminJevUsage();
}
