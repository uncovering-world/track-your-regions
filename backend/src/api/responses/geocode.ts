/**
 * What the place-search calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/geocode.ts` calls, declared once — places found
 * by name through Nominatim, and a picture suggested for a new experience from
 * Wikidata, with the item's own coordinate. The AI geocode that module also calls answers `AIGeocodeResult`, in
 * `ai.ts` beside this file, with the rest of what a model answers.
 *
 * Each exported schema is the type of the same name in the web's generated client, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';

export const PlaceResult = z.strictObject({
  display_name: z.string().describe('The place\'s full name as OpenStreetMap writes it, country last.'),
  lat: z.number(),
  lng: z.number(),
  type: z.string().describe('OpenStreetMap\'s word for what the place is: `city`, `museum`, `peak`, …'),
  wikidataId: z.string().nullable().describe('The Wikidata item OpenStreetMap links the place to, when it links one.'),
}).describe('One place found by name.');
export type PlaceResult = z.infer<typeof PlaceResult>;

export const PlaceSearch = z.strictObject({
  results: z.array(PlaceResult).describe('Best match first, as Nominatim ranks them.'),
}).describe('Places found by name.');
export type PlaceSearch = z.infer<typeof PlaceSearch>;

export const ImageSuggestion = z.strictObject({
  imageUrl: z.string().describe('The Wikimedia Commons file of the item\'s image statement.'),
  source: z.enum(['wikidata_direct', 'wikidata_spatial', 'wikidata_search'])
    .describe('How the item was found: by the id the curator gave, by the nearest item to the point, or by the name.'),
  entityLabel: z.string().describe('The item\'s English label, or its id when it has none, so the curator can tell whether it is the place they meant.'),
  wikidataId: z.string(),
  description: z.string().optional().describe('The item\'s English description.'),
  wikipediaUrl: z.string().optional().describe('The item\'s English Wikipedia article.'),
  coordinates: z.strictObject({ lat: z.number(), lng: z.number() }).optional()
    .describe('The item\'s own coordinate location (P625) at its best rank, when it states one on the Earth: where the place is, as Wikidata says.'),
}).describe('A picture for a new experience, from the Wikidata item it most likely is.');
export type ImageSuggestion = z.infer<typeof ImageSuggestion>;

export const PlaceAtPoint = z.strictObject({
  name: z.string().nullable().describe('The name OpenStreetMap gives the object nearest the point — a church, a square, a street — or null where that object is unnamed: a building, a bare address.'),
  street: z.string().nullable().describe('The address the object stands at, house number first where it has one.'),
  area: z.string().nullable().describe('The neighbourhood, village or town the point is in, the narrowest OpenStreetMap names.'),
  category: z.string().nullable().describe('OpenStreetMap\'s key for what the object is: `building`, `highway`, `amenity`, `historic`, …'),
  type: z.string().nullable().describe('Its value under that key: `church`, `residential`, `yes` for a building of no stated kind, …'),
  osmUrl: z.string().nullable().describe('The object on openstreetmap.org, where the answer names one.'),
}).describe('What OpenStreetMap holds at a point: the object nearest it, at the level of a building (Nominatim\'s reverse lookup). Every field null where it holds nothing there. The data is OpenStreetMap contributors\', under the ODbL.');
export type PlaceAtPoint = z.infer<typeof PlaceAtPoint>;

export const ArticlePoint = z.strictObject({
  article: z.string().nullable().describe('The Wikipedia article the place links to, or null where it links none.'),
  coordinate: z.strictObject({ latitude: z.number(), longitude: z.number() }).nullable()
    .describe('The article\'s primary coordinate on the Earth, or null where it states none or the wiki did not answer.'),
}).describe('Where the place\'s Wikipedia article says it stands.');
export type ArticlePoint = z.infer<typeof ArticlePoint>;
