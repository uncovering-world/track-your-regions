/**
 * What Jev has cost, and how often curators chose what it suggested (#1260).
 */

import type { JevUsage } from '../client.generated';
import { getAdminJevUsage } from '../client.generated';

export type { JevUsage } from '../client.generated';

export async function getJevUsage(): Promise<JevUsage> {
  return getAdminJevUsage();
}
