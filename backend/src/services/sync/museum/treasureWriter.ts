/**
 * The works a museum puts on show: writing them, and saying who photographed them.
 *
 * Its own file because it is its own responsibility — a work's identity, the
 * fields a curator may claim on it, the link that says it hangs here, and the
 * credit under its picture — and because `museumSyncService.ts` was the file the
 * development guide calls a stop at 800 lines. What is left there is the run:
 * collecting, admitting and writing the venues.
 */

import { pool } from '../../../db/index.js';
import { creditToWrite, type ImageCredit, type StoredCredit } from '../imageCredit.js';
import { retirePassAfterNewContent } from '../curationDecay.js';
import { workChanges } from '../contentsChangeSet.js';
import type {
  ContentItem, ContentItemChange, ContentsDelta, ProcessedContent,
} from '../types.js';
import { ICONIC_SITELINKS, ICONIC_RELEASE } from './tier1.js';

/** `Top Art Museums` — the category a treasure reads its gate from, since it has none of its own. */
const MUSEUM_CATEGORY_ID = 2;

/** What a run knows about who took the pictures: what it fetched, and what the rows hold. */
export interface TreasureCredits {
  fetched: Map<string, ImageCredit>;
  stored: Map<string, StoredCredit>;
}

/**
 * What a run should store beside a work, which today is who took its picture.
 *
 * `null` and not an empty object where there is no credit: the upsert writes
 * `metadata = EXCLUDED.metadata` outright, so an empty object would replace a
 * `null` on every work with no picture and report a change to a column nobody
 * reads. The rule about *which* credit — this run's, the row's own, or none —
 * is `creditToWrite`'s and is the same one the three experience collectors go
 * through, claim included: `treasures.curated_fields` holds `image_url` in its
 * claimable set, and a claimed picture must not be described by whoever took a
 * different one.
 *
 * Its own exported function rather than a line inside the loop because that is
 * where it can be read against a claim without a database: the loop below is
 * twelve positional parameters, and this promise is the ninth of them.
 */
export function treasureMetadata(
  artwork: ProcessedContent,
  fetched: Map<string, ImageCredit>,
  stored: Map<string, StoredCredit>,
): string | null {
  const patch = creditToWrite(
    artwork.imageUrl ? fetched.get(artwork.imageUrl) : undefined,
    stored.get(artwork.externalId),
    artwork.imageUrl,
  );
  return Object.keys(patch).length > 0 ? JSON.stringify(patch) : null;
}

/**
 * Upsert artworks as treasures and link to experience via junction table.
 *
 * `is_iconic` is sticky on the way down: a work joins the highlights at `ICONIC_SITELINKS` and
 * only leaves below `ICONIC_RELEASE`, so the badge does not flicker on and off as Wikipedia
 * grows. Selection upstream uses the single threshold; only the stored flag has hysteresis.
 *
 * Returns what the museum gained and what the run rewrote about what it already
 * held, named (ADR-0026). `withdrawn` and `returned` are always empty and that is
 * the decision, not an omission: nothing unlinks a work, because no contents
 * coverage floor exists for treasures and a run that under-fetched would take
 * real works off the walls and report success.
 *
 * `changed` is the one arm computed per work, and its contract is the part a
 * caller cannot see: the "after" side is the **source's offer**, not the row the
 * upsert wrote. That is what makes `curatedConflict` reachable for a work at all
 * — the upsert's own `CASE` writes a claimed value back over itself, so against
 * the written row a claimed field equals itself and the refusal disappears. The
 * comparison is argued where it happens, in the loop below.
 *
 * Exported for its test as well as for the sync: one of its promises lives in a
 * parameter number, which no caller can observe.
 */
export async function upsertMuseumTreasures(
  experienceId: number,
  artworks: ProcessedContent[],
  // Required, with no default: the run's credits live a file away now, and a
  // default of empty maps would be the one shape that quietly destroys data.
  //
  // **`stored` is the half that must not be empty.** The upsert replaces
  // `metadata` outright, so a caller passing two empty maps writes `null` over
  // every credit the rows already hold — a run that could not reach Commons
  // survives only because it resends what it read at the start. Which is why
  // `readStoredTreasureCredits` is awaited in `fetchMuseumItems`, before the
  // first museum is written, rather than beside the fetch it protects.
  credits: TreasureCredits,
): Promise<ContentsDelta> {
  const added: ContentItem[] = [];
  const changed: ContentItemChange[] = [];

  // What the run is about to write over, read once for the whole museum rather
  // than once per work. The upsert cannot answer this itself — it is a single
  // `INSERT … ON CONFLICT` and `RETURNING` gives back the new values — and
  // without a "before" there is nothing to compare, so a source rewriting a
  // title or an attribution would land silently on a work a curator has already
  // passed. The claim set comes with it, because a field the source proposed and
  // the guard above refused is the *reason* to report rather than a case to skip.
  const refs = artworks.map(a => a.externalId);
  const before = new Map<string, {
    name: string | null; artist: string | null; year: number | null;
    imageUrl: string | null; curatedFields: string[];
  }>();
  if (refs.length > 0) {
    const stored = await pool.query(
      `SELECT external_id, name, artist, year, image_url, curated_fields
         FROM treasures WHERE external_id = ANY($1::text[])`,
      [refs],
    );
    for (const row of stored.rows) {
      before.set(row.external_id, {
        name: row.name, artist: row.artist, year: row.year,
        imageUrl: row.image_url, curatedFields: row.curated_fields ?? [],
      });
    }
  }

  for (const artwork of artworks) {
    // Step 1: Upsert into treasures (globally unique by external_id)
    //
    // `curation_state` is bound to `MUSEUM_CATEGORY_ID` directly rather than
    // reached through an experience: a treasure is globally shared and is not
    // owned by any one of them. It is set on insert only — absent from
    // `DO UPDATE SET` — because a work already stored may already have been
    // passed by a curator, and this run must not reset that (ADR-0025).
    const treasureResult = await pool.query(
      `INSERT INTO treasures (
        external_id, name, treasure_type, artist, year,
        image_url, sitelinks_count, is_iconic, metadata, curation_state, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN (SELECT requires_curation FROM experience_categories WHERE id = $12)
             THEN 'pending' ELSE 'auto' END,
        NOW(), NOW())
      ON CONFLICT (external_id) DO UPDATE SET
        -- Four of these are things a curator can be right about, and the guard is
        -- the one an experience's columns have carried since #488: a claimed field
        -- keeps what was decided, and everything else still follows the source.
        -- sitelinks_count and is_iconic are outside it deliberately -- a count and a
        -- threshold on that count are a measurement, not a judgement -- and so is
        -- external_id, which is identity and is the conflict target above.
        name = CASE WHEN treasures.curated_fields ? 'name' THEN treasures.name ELSE EXCLUDED.name END,
        treasure_type = EXCLUDED.treasure_type,
        artist = CASE WHEN treasures.curated_fields ? 'artist' THEN treasures.artist ELSE EXCLUDED.artist END,
        year = CASE WHEN treasures.curated_fields ? 'year' THEN treasures.year ELSE EXCLUDED.year END,
        image_url = CASE WHEN treasures.curated_fields ? 'image_url'
                         THEN treasures.image_url ELSE EXCLUDED.image_url END,
        sitelinks_count = EXCLUDED.sitelinks_count,
        is_iconic = CASE
          WHEN EXCLUDED.sitelinks_count >= $10 THEN true
          WHEN treasures.is_iconic THEN EXCLUDED.sitelinks_count >= $11
          ELSE false
        END,
        -- Replaced whole, like the experiences upsert replaces theirs, which is
        -- why a run that could not reach Commons resends the stored credit
        -- instead of omitting it: a key left out of the object is a key dropped,
        -- and one Commons 5xx would otherwise strip the photographer's name off
        -- every work in the batch. That decision is treasureMetadata's, above.
        --
        -- Except where a curator owns the picture, and that guard has to be here
        -- rather than only in treasureMetadata: the claim set it reads is a
        -- snapshot taken before the collection, and a museum run takes long
        -- enough that a curator can claim image_url while it is still going. The
        -- row above keeps their picture; without this line the metadata beside it
        -- would still be replaced, printing the source photographer's name under
        -- a photograph they chose -- the one thing this feature promises never to
        -- do. Read at write time, so the window closes.
        metadata = CASE WHEN treasures.curated_fields ? 'image_url'
                        THEN treasures.metadata ELSE EXCLUDED.metadata END,
        updated_at = NOW()
      -- The name beside the id because a link is named by what the catalogue
      -- calls the work, which on a claimed field is not what the source sent.
      -- Nothing else off this row: the comparison that reports a rewrite reads
      -- the pre-run snapshot instead, and taking its claim set from here would be
      -- taking it from the statement that already honoured it.
      RETURNING id, name`,
      [
        artwork.externalId,
        artwork.name,
        artwork.treasureType,
        artwork.artist,
        artwork.year,
        artwork.imageUrl,
        artwork.sitelinksCount,
        artwork.sitelinksCount >= ICONIC_SITELINKS,
        treasureMetadata(artwork, credits.fetched, credits.stored),
        ICONIC_SITELINKS,
        ICONIC_RELEASE,
        MUSEUM_CATEGORY_ID,
      ]
    );

    const stored = treasureResult.rows[0];
    const treasureId = stored.id;

    // What this run did to a work it already held, or tried to.
    //
    // **The "after" is the source's offer, not the row the statement wrote** —
    // the same pair `keptChanges` compares for a point, and for the same reason.
    // The upsert's own `CASE` keeps the stored value wherever a claim holds, so a
    // claimed field written back over itself compares equal: read from the
    // written row, exactly the refusals worth reporting are the ones that
    // disappear, and `curatedConflict` could never be true for a work. Read from
    // the offer, a claim marks the entry rather than erasing it.
    //
    // A work the run has just inserted has no "before" and is an arrival, which
    // `added` below carries.
    const was = before.get(artwork.externalId);
    if (was) {
      const fields = workChanges(was, {
        name: artwork.name, artist: artwork.artist, year: artwork.year, imageUrl: artwork.imageUrl,
      }, was.curatedFields);
      if (fields.length > 0) {
        changed.push({ item: { name: was.name, ref: artwork.externalId }, fields });
      }
    }

    // Step 2: Link treasure to experience via junction table. Unlike the
    // treasure above, a link does have an experience to read the gate through,
    // so it is reached the same way the location insert reaches it. Links are
    // never deleted (ADR-0023), so a link a curator already passed must keep
    // that state when a later run finds it again — insert-only, same as above.
    const link = await pool.query(
      `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state)
       VALUES ($1, $2,
         CASE WHEN (SELECT c.requires_curation
                      FROM experiences e JOIN experience_categories c ON c.id = e.category_id
                     WHERE e.id = $1)
              THEN 'pending' ELSE 'auto' END)
       ON CONFLICT (experience_id, treasure_id) DO NOTHING
       RETURNING treasure_id`,
      [experienceId, treasureId]
    );
    // `DO NOTHING` returns no row when the link was already there, so this is
    // "the museum gained a work", not "the run mentioned one".
    //
    // Named from the row the statement wrote, not from the artwork in hand: on a
    // work whose name a curator has claimed those are different strings, and the
    // one a reader will see is the stored one. Reporting the source's title for a
    // link to a work the catalogue calls something else names a work nobody can
    // find.
    if (link.rows.length > 0) added.push({ name: stored.name, ref: artwork.externalId });
  }

  // Once for the museum rather than once per painting: the fact is that a
  // curator's pass no longer covers everything on show, and it is the same fact
  // whether one work arrived or twelve.
  if (added.length > 0) await retirePassAfterNewContent(pool, experienceId);

  // `changed` is expected to be empty most runs and is still computed. Re-asking
  // a museum's works of Wikidata weeks after importing them turned up no
  // differences at all in name, artist, year or image — but that says how often a
  // card will appear, not whether the run should be able to raise one. The axis
  // that moves for a work is which venue holds it, and the day a source does
  // rewrite an attribution is the day a curator needs to hear about it rather
  // than the day we discover the run could not say.
  return { added, withdrawn: [], returned: [], changed };
}
