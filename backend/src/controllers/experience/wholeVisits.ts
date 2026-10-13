/**
 * A visit to a part of a serial site is a visit to the site (ADR-0046
 * decision 7, ADR-0100 decision 5): the one statement of that cascade and of
 * taking it back, for every writer that records or removes a place visit by
 * the place's id — a tick on the place, and "mark all" over it. A tick on a
 * point names the wholes through the points' places itself.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import { pointsShownSql, visitedPointsSql } from '../../db/placePoints.js';
import { experienceOfferedToReaderSql, offeredLocationSql } from '../../db/readerPredicates.js';

type Db = Pick<PoolClient, 'query'>;

/** Record a visit to every whole the place `placeId` is a part of that the reader may claim. */
export async function visitWholes(userId: number, placeId: number, db: Db = pool): Promise<void> {
  await db.query(`
    INSERT INTO user_visited_experiences (user_id, experience_id, visited_at)
    SELECT $1, prt.whole_id, NOW()
      FROM experience_parts prt JOIN experiences e ON e.id = prt.whole_id
     WHERE prt.part_id = $2 AND ${experienceOfferedToReaderSql()}
    ON CONFLICT (user_id, experience_id) DO NOTHING
  `, [userId, placeId]);
}

/**
 * Remove the visit to every whole of the place `placeId` that the reader holds
 * no other visited point of: a whole keeps its visit while another of its
 * parts, or a point of its own, is visited.
 */
export async function dropUnvisitedWholes(userId: number, placeId: number, db: Db = pool): Promise<void> {
  await db.query(`
    DELETE FROM user_visited_experiences uve
     USING experience_parts prt
     WHERE prt.part_id = $2 AND uve.experience_id = prt.whole_id AND uve.user_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM ${pointsShownSql('uve.experience_id', 'el')}
         JOIN ${visitedPointsSql('$1')} uvl ON uvl.location_id = el.id
         WHERE ${offeredLocationSql()})
  `, [userId, placeId]);
}
