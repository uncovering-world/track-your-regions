/**
 * An error whose message is a sentence written for the person who reads the
 * answer, and so may be shown there (#1021).
 *
 * Any other error's text is internal: a driver, an HTTP client or a model SDK
 * put it there, with table names, URLs or an upstream body, and it goes to the
 * log. A failure the product itself names -- "Wikidata did not answer, so
 * nothing was changed -- try again later" -- is thrown as one of these, so the
 * status that reports the failure can say it in those words.
 */
export class ReaderFacingError extends Error {
  override name = 'ReaderFacingError';
}

/** What to tell the reader about a failure: a ReaderFacingError's own sentence, or the fallback. */
export function sentenceFor(err: unknown, fallback: string): string {
  return err instanceof ReaderFacingError ? err.message : fallback;
}
