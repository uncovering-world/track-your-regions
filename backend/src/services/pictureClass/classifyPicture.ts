/**
 * What a picture is, from what Commons states about the file (#2192): a
 * photograph, a map, a drawing or engraving, or a diagram.
 *
 * A place's picture is meant to show the place and a work's picture the work,
 * and a review card draws a map or a drawing exactly as it draws a photograph:
 * Banqiao Dam's picture is `Banqiaomap.png`, Larsa's a map of Hammurabi's
 * Babylonia, and a run proposed an 1865 engraving for the Saqqara Tablet and a
 * vector rendering for the Aztec sun stone. The class comes from Commons alone
 * — the file's MIME type and the categories its page is in, which `extmetadata`
 * hands over with the credit — and the answer keeps what decided it, so a card
 * can say *a map, not a photograph* and a reader can see why.
 *
 * The rule is conservative on purpose. A category whose head noun is *maps*
 * makes a map ("Maps of Oaxaca", "Old maps of Rome", never "Paintings of
 * people with maps"); one that says *engravings*, *drawings*, *lithographs*,
 * *etchings*, *woodcuts* or *sketches* makes a drawing; one that says
 * *diagrams*, *plans* or *cross sections* makes a diagram; a vector file (SVG)
 * with none of those is a drawing, since a camera makes no vector. A raster
 * file in none of those categories is a photograph, which is what nearly every
 * Commons picture of a place is; a file Commons does not know, or one that
 * could not be asked about, is not classed.
 *
 * What the picture is *of* decides whether a category speaks about the
 * picture or about the subject (measured on the development catalogue on
 * 2026-10-31, 9,146 pictures). For a place, a category speaks about the
 * picture: "Drawings of rock paintings in Spain" is a tracing where a
 * photograph of the cave belongs. For a work, the categories name the work's
 * own medium — Dürer's *Adam and Eve* sits in *Engravings by Albrecht Dürer*
 * and Goya's *Boys playing soldiers* in *Sketches by Francisco de Goya*, and
 * a photograph of either is the right picture — so a category classes a
 * work's picture only where the work is an object a drawing can only depict:
 * a sculpture, a statue, an inscription, a vase, a relief (`OBJECT_TYPES`,
 * read off the work's own type). The Saqqara Tablet is an inscription, so the
 * 1865 engraving a run proposed for it is a drawing; a painting, a print or a
 * papyrus is left alone whatever its categories. A vector file is a drawing
 * for every subject.
 */

export const PICTURE_CLASSES = ['photograph', 'map', 'drawing', 'diagram'] as const;
export type PictureClass = (typeof PICTURE_CLASSES)[number];

export interface PictureClassification {
  /** What the picture is, or null where Commons gave nothing to class it by. */
  class: PictureClass | null;
  /** What decided it: the category or the MIME type, as Commons states it; null with a null class. */
  basis: string | null;
}

/** What Commons states about a file: its MIME type and the categories its page is in. */
export interface CommonsFileFacts {
  mime: string | null;
  categories: readonly string[];
}

/** What the picture is of: a place, or a work with the type its source gives it ("sculpture", "etching print"). */
export type PictureSubject = { kind: 'place' } | { kind: 'work'; type: string | null };

/** A category whose head noun is maps: "Maps of Oaxaca", "Old maps of Rome", "SVG maps", not "Paintings of people with maps". */
const MAP_WORDS = /^(?:[\w'’-]+ )?maps?\b/i;
const DRAWING_WORDS = /\b(engravings?|drawings?|lithographs?|etchings?|woodcuts?|sketches|aquatints?)\b/i;
const DIAGRAM_WORDS = /\b(diagrams?|floor plans?|plans? of|cross[- ]sections?|schematics?)\b/i;
const VECTOR_MIME = 'image/svg+xml';
const RASTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/gif']);
/**
 * The works a drawing can only depict, by the words their type carries: their
 * categories speak about the picture, not about the work's medium.
 */
const OBJECT_WORDS = new Set([
  'sculpture', 'statue', 'bust', 'relief', 'stele', 'stela', 'inscription', 'tablet', 'sarcophagus', 'vase', 'amphora',
  'urn', 'mask', 'altar', 'throne', 'crown', 'jewel', 'jewellery', 'jewelry', 'coin', 'ring', 'cup', 'bowl', 'helmet',
  'armour', 'armor', 'sword', 'mummy', 'figurine', 'monument', 'obelisk', 'column', 'fountain', 'mosaic', 'carving',
  'artefact', 'artifact', 'idol', 'totem', 'chariot', 'ship', 'clock', 'instrument',
]);

/** A word in the singular, as the list spells it: "mummies" → mummy, "statues" → statue. */
function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** A type's words in the singular: "etching print" → etching, print. */
function singularWords(type: string): string[] {
  return type.toLowerCase().split(/[^a-z]+/).filter(word => word.length > 0).map(singular);
}

/** Whether a work's type names an object a drawing can only depict. */
export function isObjectType(type: string | null): boolean {
  return type !== null && singularWords(type).some(word => OBJECT_WORDS.has(word));
}

function firstMatch(categories: readonly string[], words: RegExp): string | null {
  return categories.find(category => words.test(category)) ?? null;
}

/** Whether a category can class this subject's picture: always for a place, for a work only one a drawing can only depict. */
function categoriesSpeakOfThePicture(subject: PictureSubject): boolean {
  return subject.kind === 'place' || isObjectType(subject.type);
}

/**
 * Class a file by what Commons states about it, for a picture of `subject`.
 * The order is the order of certainty: a map category over a drawing one (an
 * engraved map is a map), a drawing over a diagram, a category over the MIME
 * type.
 */
export function classifyPicture(facts: CommonsFileFacts, subject: PictureSubject = { kind: 'place' }): PictureClassification {
  if (categoriesSpeakOfThePicture(subject)) {
    const map = firstMatch(facts.categories, MAP_WORDS);
    if (map) return { class: 'map', basis: map };
    const drawing = firstMatch(facts.categories, DRAWING_WORDS);
    if (drawing) return { class: 'drawing', basis: drawing };
    const diagram = firstMatch(facts.categories, DIAGRAM_WORDS);
    if (diagram) return { class: 'diagram', basis: diagram };
  }
  if (facts.mime === VECTOR_MIME) return { class: 'drawing', basis: facts.mime };
  if (facts.mime && RASTER_MIMES.has(facts.mime)) return { class: 'photograph', basis: facts.mime };
  return { class: null, basis: null };
}

/** Commons hands the categories over as one string, separated by `|`. */
export function categoriesOf(value: string | null | undefined): string[] {
  return (value ?? '').split('|').map(part => part.trim()).filter(part => part.length > 0);
}
