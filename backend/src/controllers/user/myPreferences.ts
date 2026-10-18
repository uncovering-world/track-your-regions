/**
 * The signed-in visitor's own preferences (#1604): GET and PUT
 * /api/users/me/preferences.
 *
 * One choice today, the maps app "Open in maps" opens. It is the caller's own
 * row, read and written by the caller's id, so no other account is reachable.
 */

import type { z } from 'zod/v4';
import type { MyPreferences } from '../../api/responses/auth.js';
import { pool } from '../../db/index.js';
import type { UsersRow } from '../../db/schema.generated.js';
import { failure, notFound } from '../../middleware/errorHandler.js';
import type { myPreferencesBodySchema } from '../../types/index.js';

type PreferencesRow = Pick<UsersRow, 'maps_app'>;

const answer = (row: PreferencesRow | undefined): MyPreferences => {
  if (!row) throw notFound('User not found');
  return { mapsApp: row.maps_app };
};

export async function getMyPreferences({ caller }: { caller: Express.User }): Promise<MyPreferences> {
  let row: PreferencesRow | undefined;
  try {
    row = (await pool.query<PreferencesRow>('SELECT maps_app FROM users WHERE id = $1', [caller.id])).rows[0];
  } catch (error) {
    console.error('Error reading preferences:', error);
    throw failure('Failed to read preferences', 500);
  }
  return answer(row);
}

export async function setMyPreferences(
  { body, caller }: { body: z.output<typeof myPreferencesBodySchema>; caller: Express.User },
): Promise<MyPreferences> {
  let row: PreferencesRow | undefined;
  try {
    row = (await pool.query<PreferencesRow>(
      'UPDATE users SET maps_app = $2 WHERE id = $1 RETURNING maps_app',
      [caller.id, body.mapsApp],
    )).rows[0];
  } catch (error) {
    console.error('Error saving preferences:', error);
    throw failure('Failed to save preferences', 500);
  }
  return answer(row);
}
