/**
 * ADR-0188: the ruin or dig OpenStreetMap maps near a place under the place's
 * own name, though without its item. A site whose item no OpenStreetMap object
 * carries is often mapped all the same: *Area archeologica dell'antica
 * Abellinum*, *Candi Muara Takus*, *Necropoli Li Muri*, each a
 * `historic=archaeological_site` with no `wikidata` tag, beside the item's
 * point. An unnamed ruin there, or one named for something else, says nothing
 * about the place: the İsa Bey Mosque and a battlefield have ruins near them.
 *
 * Read off the local layer (`osm_objects`, ADR-0134) and the item's labels in
 * the local Wikidata subset, for the places a run asks about. A ruin counts
 * where its `name` or `name:en` holds, as a whole word, a word of four letters
 * or more of any of the item's labels, accents folded, other than a word every
 * site's name may carry in the subset's languages (`GENERIC_WORDS`). With no
 * layer in place nothing is read (null): no new place is shown by a name it
 * was not read for, and a place the tier holds keeps its standing (ADR-0175
 * decision 6).
 */

import { pool } from '../../../db/index.js';
import { layerState } from '../../dumps/osm/layerTables.js';

/** A place to look around: its item and its point. */
export interface PlaceAt { qid: string; lat: number; lon: number }

/** The ruin found near a place under its name. */
export interface NamedRuin { ref: string; name: string }

/**
 * Words a site's name and a ruin's share without naming the same place: what
 * it is, never which, in the languages the subset keeps labels in (English,
 * German, French, Spanish, Italian, Dutch), and the regional words a class of
 * sites is named by (a nuraghe, a castro, a huaca, a tepe). *Temple of Montu*
 * and *Temple of Zeus* share a word, and no place.
 */
export const GENERIC_WORDS = [
  // what a site is
  'temple', 'tempio', 'templo', 'tempel', 'ruins', 'ruin', 'ruine', 'ruinen', 'ruinas', 'ruines', 'rovine', 'site', 'sito',
  'sitio', 'park', 'parco', 'parque', 'national', 'nazionale', 'nacional', 'nationaal', 'monument', 'monumento', 'denkmal',
  'archaeological', 'archeological', 'archeologica', 'archeologico', 'arqueologico', 'arqueologica', 'archeologique',
  'archaologische', 'archeologische', 'archaeology', 'scavi', 'yacimiento', 'fouilles', 'ausgrabung', 'opgraving',
  'ancient', 'antica', 'antico', 'antiguo', 'antigua', 'antike', 'antique', 'cave', 'cueva', 'grotta', 'grotte', 'hohle',
  'fortress', 'fortezza', 'fortaleza', 'festung', 'castle', 'castello', 'castillo', 'chateau', 'burg', 'kasteel', 'church',
  'chiesa', 'iglesia', 'eglise', 'kirche', 'kerk', 'mosque', 'moschea', 'mezquita', 'mosquee', 'moschee', 'city', 'citta',
  'ciudad', 'ville', 'stadt', 'stad', 'bridge', 'ponte', 'puente', 'pont', 'brucke', 'brug', 'tomb', 'tomba', 'tumba',
  'tombe', 'grab', 'graf', 'area', 'zona', 'zone', 'palace', 'palazzo', 'palacio', 'palais', 'palast', 'paleis', 'gate',
  'porta', 'puerta', 'porte', 'island', 'isola', 'isla', 'insel', 'eiland', 'fort', 'forte', 'fuerte', 'tumulus', 'tumulo',
  'theatre', 'theater', 'teatro', 'historic', 'historical', 'storico', 'historico', 'historique', 'historisch', 'roman',
  'romano', 'romana', 'romain', 'romisch', 'romeins', 'necropolis', 'necropoli', 'necropole', 'nekropole', 'village',
  'villaggio', 'pueblo', 'dorf', 'dorp', 'settlement', 'insediamento', 'mound', 'hill', 'colle', 'cerro', 'colline',
  'hugel', 'heuvel', 'tower', 'torre', 'tour', 'turm', 'toren', 'wall', 'walls', 'mura', 'muralla', 'mauer', 'muur',
  'house', 'casa', 'maison', 'haus', 'huis', 'villa', 'abbey', 'abbazia', 'abadia', 'abbaye', 'abtei', 'abdij',
  'cathedral', 'cattedrale', 'catedral', 'cathedrale', 'kathedrale', 'monastery', 'monastero', 'monasterio', 'kloster',
  'klooster', 'museum', 'museo', 'musee', 'tell', 'tepe', 'culture', 'cultura', 'kultur', 'cultuur',
  // a class of sites named by its regional word
  'nuraghe', 'nuraghi', 'castro', 'huaca', 'candi', 'pyramid', 'piramide',
] as const;

/** The ruins near each place under its name; null where no layer is in place, so nothing was read. */
export type NamedRuins = Map<string, NamedRuin> | null;

/** Each place near which the layer maps a ruin or dig under one of its names, within `radiusM`. */
export async function namedRuinsNear(places: readonly PlaceAt[], radiusM: number): Promise<NamedRuins> {
  if (!(await layerState())) return null;
  if (!places.length) return new Map();
  const result = await pool.query<{ qid: string; ref: string; name: string }>(
    `WITH place AS (
       SELECT p.qid, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326) AS at
         FROM unnest($1::text[], $2::float8[], $3::float8[]) AS p(qid, lat, lon)
     ),
     word AS (
       SELECT DISTINCT l.id AS qid, w AS word
         FROM wikidata_labels l, regexp_split_to_table(lower(unaccent(l.label)), '[^[:alnum:]]+') w
        WHERE l.id = ANY($1::text[]) AND length(w) >= 4 AND w <> ALL($5::text[])
     )
     SELECT DISTINCT ON (place.qid) place.qid,
            CASE o.osm_type WHEN 'N' THEN 'node' WHEN 'W' THEN 'way' ELSE 'relation' END || '/' || o.osm_id AS ref,
            coalesce(o.tags->>'name:en', o.tags->>'name') AS name
       FROM place
       JOIN osm_objects o
         -- A box the spatial index answers first, wider in longitude towards the poles.
         ON o.geom && ST_Expand(place.at, $4 / 111320.0 / greatest(cos(radians(ST_Y(place.at))), 0.05), $4 / 111320.0)
        AND ST_DWithin(o.geom::geography, place.at::geography, $4)
        AND o.tags->>'historic' IN ('archaeological_site', 'ruins')
      -- A whole word of the ruin's name: "tell" is no word of "Castello", nor "roma" of "romano".
      WHERE EXISTS (
        SELECT 1 FROM word
         WHERE word.qid = place.qid
           AND (lower(unaccent(coalesce(o.tags->>'name', ''))) ~ ('\\m' || word.word || '\\M')
             OR lower(unaccent(coalesce(o.tags->>'name:en', ''))) ~ ('\\m' || word.word || '\\M')))
      ORDER BY place.qid, ST_Distance(o.geom::geography, place.at::geography), ref`,
    [places.map((p) => p.qid), places.map((p) => p.lat), places.map((p) => p.lon), radiusM, [...GENERIC_WORDS]],
  );
  return new Map(result.rows.map((row) => [row.qid, { ref: row.ref, name: row.name }]));
}
