/**
 * The signed-in visitor's own preferences (#1604): GET and PUT
 * /api/users/me/preferences.
 *
 * Two choices: the maps app "Open in maps" opens (#1604), and the languages a
 * Wikipedia article opens in, first choice first (#2209). A PUT changes the
 * ones it names and keeps the other. It is the caller's own row, read and
 * written by the caller's id, so no other account is reachable.
 */

import type { z } from 'zod/v4';
import type { MyPreferences } from '../../api/responses/auth.js';
import { pool } from '../../db/index.js';
import type { UsersRow } from '../../db/schema.generated.js';
import { failure, notFound } from '../../middleware/errorHandler.js';
import type { myPreferencesBodySchema } from '../../types/index.js';

type PreferencesRow = Pick<UsersRow, 'maps_app' | 'reading_languages'>;

const answer = (row: PreferencesRow | undefined): MyPreferences => {
  if (!row) throw notFound('User not found');
  return { mapsApp: row.maps_app, readingLanguages: row.reading_languages };
};

export async function getMyPreferences({ caller }: { caller: Express.User }): Promise<MyPreferences> {
  let row: PreferencesRow | undefined;
  try {
    row = (await pool.query<PreferencesRow>('SELECT maps_app, reading_languages FROM users WHERE id = $1', [caller.id])).rows[0];
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
      `UPDATE users
          SET maps_app = CASE WHEN $3 THEN $2::maps_app ELSE maps_app END,
              reading_languages = CASE WHEN $5 THEN $4::text[] ELSE reading_languages END
        WHERE id = $1
        RETURNING maps_app, reading_languages`,
      [caller.id, body.mapsApp ?? null, body.mapsApp !== undefined, body.readingLanguages ?? null, body.readingLanguages !== undefined],
    )).rows[0];
  } catch (error) {
    console.error('Error saving preferences:', error);
    throw failure('Failed to save preferences', 500);
  }
  return answer(row);
}
