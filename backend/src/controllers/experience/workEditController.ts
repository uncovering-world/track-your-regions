/**
 * A curator's correction to one work: what it is called, who made it, when, and
 * which photograph it is shown by.
 *
 * The third answer for a work, and it arrives with the makers becoming a list
 * (#720). Storing every creator the source names removes the churn that was
 * ordering — 22 of the attributions museum run 64 rewrote were the same people
 * in another order — and leaves behind the entries that were never orderings at
 * all: *Borghese Gladiator* reads Nicolas Cordier, who restored an arm in the
 * 17th century, where Agasias of Ephesus carved it; *Salvator Mundi* reads
 * "Leonardeschi"; *The Stolen Kiss* reads Marguerite Gérard where the Hermitage
 * says Fragonard with her participation. Those are judgements, and until now a
 * curator holding one had nowhere to put it: the gate's two answers are "take
 * the source's" and "keep what is here", and neither says *this instead*.
 *
 * Its own file on `locationEditController`'s precedent: a different table, a
 * different lock, and one rule that has no counterpart on a point — the reach,
 * below.
 */

import { Response } from 'express';
import { pool, rollbackQuietly } from '../../db/index.js';
import { OBJECT_LOCK } from '../../db/locks.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { offeredLinkSql } from './experienceLifecycle.js';
import { creditForOneImage, type ImageCredit } from '../../services/sync/imageCredit.js';
import { userAgent } from '../../config/userAgent.js';

/**
 * What a curator may claim on a work — the whole `treasures.curated_fields`
 * vocabulary.
 *
 * The picture is one of them, and it is written here only because the credit is
 * written beside it — ADR-0049, which narrows ADR-0040 decision 6. That one
 * withheld the picture for this very reason, before the answering was built: a
 * hosted picture carries a credit (ADR-0043), the credit beside a work is
 * `metadata.imageCredit`, and a URL replaced without it would print one
 * photographer's name under another's photograph, which is the one thing that
 * feature promises never to do. So the two are resolved and written together
 * below, the way `editExperience` has always done it for an object.
 *
 * There is no separate claim on the credit, as there is on an experience. On a
 * work `image_url` protects both: `treasureWriter`'s upsert keeps the row's own
 * `metadata` whenever `curated_fields ? 'image_url'`, so a second key would be
 * one nothing reads and one more thing for `accept-source` to have to release.
 */
type Claim = 'name' | 'artists' | 'year' | 'image_url';

/** The claims this edit adds, kept in the order the column already holds. */
function withClaims(stored: string[], added: Claim[]): string[] {
  const next = new Set(stored);
  for (const claim of added) next.add(claim);
  return [...next];
}

/** A work as it stood before the edit — what the audit row reports as `old`. */
interface StoredWork {
  name: string;
  artists: string[];
  year: number | null;
  image_url: string | null;
  curated_fields: string[];
}

export async function editWork(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const treasureId = parseInt(String(req.params.treasureId));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { name, artists, year, imageUrl } = req.body as
    { name?: string; artists?: string[]; year?: number | null; imageUrl?: string };
  // `''` is how a form says "no picture" — the same reading `editExperience`
  // gives it (#696). `undefined` still means the edit does not touch the
  // picture at all, and the two must not collapse: one drops a photograph and
  // its credit, the other leaves both alone.
  const picture = imageUrl === undefined ? undefined : (imageUrl || null);

  // **The work is judged through the experience the curator came from.**
  //
  // A work hangs in more than one museum — that is what `experience_treasures`
  // is for — so it carries no scope of its own, and "the experience holding it"
  // is not a single row to look up. The caller names which museum they are
  // curating, the link is what proves the work is there, and the scope is that
  // museum's. The reach that follows is real and is ADR-0025's, not this
  // endpoint's: a work is passed once, globally, so a correction made from one
  // museum is the row every other museum holding it carries too. Publishing a held
  // field already works this way.
  //
  // A link the source has stopped placing here proves nothing (ADR-0044): the
  // museum's list no longer shows the work, so its scope no longer reaches it,
  // and whichever museum still holds the work is where the edit belongs.
  const found = await pool.query(
    `SELECT e.category_id
       FROM experience_treasures et
       JOIN experiences e ON e.id = et.experience_id
      WHERE et.experience_id = $1 AND et.treasure_id = $2
        AND ${offeredLinkSql('et')}`,
    [experienceId, treasureId],
  );
  if (found.rows.length === 0) {
    res.status(404).json({ error: 'Work not found in this experience' });
    return;
  }
  const categoryId = found.rows[0].category_id as number;

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, categoryId,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  // What this edit claims, decided once: the transaction writes it onto the row
  // and the response reports it, and the two must be the same list.
  const claims: Claim[] = [];
  if (name !== undefined) claims.push('name');
  if (artists !== undefined) claims.push('artists');
  if (year !== undefined) claims.push('year');
  if (picture !== undefined) claims.push('image_url');

  // Whose photograph the new one is, asked before the transaction opens: it is
  // a request to somebody else's server, and a lock held across one is a lock
  // held for as long as Commons feels like taking. `null` for anything that is
  // not a Commons file, that answers nothing inside five seconds, or for a
  // picture being removed — and a `null` written is the point rather than a
  // failure to write: a credit belongs to one photograph, so the row must not
  // go on naming whoever took the one this edit replaced.
  const credit: ImageCredit | null = picture === undefined
    ? null
    // A curator's save, not a run: no bot marker on this one (#864).
    : await creditForOneImage(picture, userAgent());

  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');

    // **The object first, then the work** — `OBJECT_LOCK`'s rule (`db/locks.ts`).
    // The audit row below reaches `experiences` whatever this handler names, so a
    // transaction that took the work first would hold one row and wait for the
    // other; taken in two orders, two writers on one museum close a cycle and
    // Postgres resolves it by failing one of them with a 500.
    await client.query(`SELECT id FROM experiences WHERE id = $1 ${OBJECT_LOCK}`, [experienceId]);

    // Everything this transaction depends on, re-read under the lock: the claim
    // set it adds to, and the values the trail reports as `old`. The set is
    // re-read rather than carried from the scope query because `accept-source`
    // takes keys back off a claim set, and one landing between an unlocked read
    // and this write would be undone by the rewrite below.
    const locked = await client.query(
      'SELECT name, artists, year, image_url, curated_fields FROM treasures WHERE id = $1 FOR UPDATE',
      [treasureId],
    );
    const before = locked.rows[0] as StoredWork | undefined;
    if (!before) {
      unusable = await rollbackQuietly(client);
      res.status(404).json({ error: 'Work not found' });
      return;
    }

    await client.query(
      `UPDATE treasures
          SET name = COALESCE($2, name),
              -- Not COALESCE: an empty list is a value a curator can mean — "the
              -- source names a maker and nobody knows who made this" — and
              -- COALESCE cannot tell it from "leave this alone". The boolean says
              -- which of the two the request was.
              artists = CASE WHEN $3::boolean THEN $4::varchar(500)[] ELSE artists END,
              year = CASE WHEN $5::boolean THEN $6::integer ELSE year END,
              image_url = CASE WHEN $8::boolean THEN $9::varchar(1000) ELSE image_url END,
              -- The credit moves in the same statement as the photograph it
              -- belongs to, so no moment exists in which the row holds one
              -- picture and another photographer's name. Merged rather than
              -- assigned: the metadata column is the run's too, and this edit
              -- answers for one key of it.
              metadata = CASE WHEN $8::boolean
                              THEN COALESCE(metadata, '{}'::jsonb) || $10::jsonb
                              ELSE metadata END,
              curated_fields = $7::jsonb,
              -- Stamped by hand, as every writer of this table does: there is no
              -- trigger, and a row whose value changed without its timestamp
              -- moving is one nothing downstream can tell has changed.
              updated_at = NOW()
        WHERE id = $1`,
      [treasureId, name ?? null,
        artists !== undefined, artists ?? [],
        year !== undefined, year ?? null,
        JSON.stringify(withClaims(before.curated_fields ?? [], claims)),
        picture !== undefined, picture ?? null,
        JSON.stringify({ imageCredit: credit })],
    );

    await client.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
       VALUES ($1, $2, 'work_edited', $3, $4)`,
      // Only the keys this edit actually changed. The queue's claim attribution
      // asks `details ? '<column>'` to find who claimed a field, so a key present
      // and null would make a rename answer for the attribution — naming a
      // curator who never touched it.
      [experienceId, userId, logRegionId, JSON.stringify({
        treasureId,
        ...(name === undefined ? {} : { name: { old: before.name, new: name } }),
        ...(artists === undefined
          ? {}
          : { artists: { old: before.artists ?? [], new: artists } }),
        ...(year === undefined ? {} : { year: { old: before.year, new: year } }),
        // Under the column's name, as its three neighbours are: the trail is
        // read by asking whether it names a column. The credit is not a second
        // entry — it has no claim of its own here and moved as part of this one.
        ...(picture === undefined
          ? {}
          : { image_url: { old: before.image_url, new: picture } }),
      })],
    );
    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  // What a later run will no longer touch, so a caller can see what the edit
  // took ownership of rather than having to read it back — and, where the
  // picture changed, who was named under it. That one is answered rather than
  // promised: a Commons file whose credit request timed out is stored with a
  // `null`, and a screen that assumed a name would show the picture as
  // credited to nobody without saying that is what happened.
  res.json({
    success: true,
    treasureId,
    claimed: claims,
    ...(picture === undefined ? {} : { imageCredit: credit }),
  });
}
