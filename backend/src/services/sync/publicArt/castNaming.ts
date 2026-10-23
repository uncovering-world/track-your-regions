/**
 * Of the parts named on one point of an edition, the one the cast is called
 * by: the lowest-numbered item (#880, ADR-0145). An order the data carries, so
 * the live reader (`castsOf`, `queries.ts`) and the subset reader (`poolEntity`,
 * `subset/publicArt.ts`) — and two answers of the endpoint — name it alike. Its
 * own module, because each of those readers imports the other.
 */
export function namingPart(parts: readonly string[]): string {
  const number = (qid: string) => Number.parseInt(qid.slice(1), 10);
  return parts.reduce((kept, part) => (
    Number.isFinite(number(part)) && (!Number.isFinite(number(kept)) || number(part) < number(kept)) ? part : kept
  ));
}
