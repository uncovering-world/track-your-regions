/**
 * World view source types produced by the import pipeline.
 *
 * These lived as four copies of the same inline SQL allowlist, which is why a new
 * source type was invisible to the review, finalize and rematch endpoints until
 * all four were found. Add a source type here and the pipeline picks it up.
 *
 * A source type gains a `_done` suffix once its match review is finalized
 * (wvImportFinalizeController).
 */

/** Source types whose review is still open. */
export const IMPORT_SOURCE_TYPES = ['wikivoyage', 'imported', 'base_layer'] as const;

export type ImportSourceType = typeof IMPORT_SOURCE_TYPES[number];

/** The finalized name for a source type. */
export function finalizedSourceType(sourceType: string): string {
  return `${sourceType}_done`;
}

/** Both states — open and finalized — for each of `types`, in order. */
function withFinalized(types: readonly string[]): string[] {
  return types.flatMap((t) => [t, finalizedSourceType(t)]);
}

/** Every source type the import pipeline owns, in both states. */
export const IMPORT_SOURCE_TYPES_ALL: string[] = withFinalized(IMPORT_SOURCE_TYPES);

/**
 * World views that may be targeted by Wikivoyage extraction. Deliberately
 * excludes `base_layer`: a mirror of the administrative base layer is generated,
 * never extracted from an article.
 */
export const WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL: string[] =
  withFinalized(['wikivoyage', 'imported']);
