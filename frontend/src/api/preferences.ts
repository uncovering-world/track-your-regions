/**
 * Preferences API client: what the signed-in visitor chooses for themselves,
 * under `/api/users/me/preferences` (#1604).
 */

import type { MyPreferences } from './client.generated';
import { getUsersMePreferences, putUsersMePreferences } from './client.generated';
import type { MapsApp } from '@tyr/shared/preferences';

// Declared once, as a backend schema (ADR-0066), and passed on from here.
export type { MyPreferences };

export function getMyPreferences(): Promise<MyPreferences> {
  return getUsersMePreferences();
}

export function saveMyPreferences(mapsApp: MapsApp | null): Promise<MyPreferences> {
  return putUsersMePreferences({ mapsApp });
}
