/**
 * The types a kind's list can be narrowed to (#589), read off the rows it holds:
 * a World Heritage list in Italy offers Cultural, Natural and Mixed, a Places of
 * worship list Cathedral, Church, Mosque…, each with how many of the list's rows
 * it keeps. A kind with no types, or a list whose rows are all of one type, offers
 * none — a filter that cannot narrow anything is no choice.
 */

export interface TypeChoice {
  type: string;
  count: number;
}

/** The types present, the most common first, ties by name; empty when fewer than two. */
export function typeChoices(rows: ReadonlyArray<{ type?: string | null }>): TypeChoice[] {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.type) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  const choices = [...counts].map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return choices.length > 1 ? choices : [];
}

/** The chosen type while the choices still offer it, else none: a choice with no chip left to take it back narrows nothing. */
export function offeredType(choices: ReadonlyArray<TypeChoice>, type: string | null): string | null {
  return choices.some(choice => choice.type === type) ? type : null;
}

/** The rows of one type, or every row when no type is chosen. */
export function narrowToType<T extends { type?: string | null }>(rows: T[], type: string | null): T[] {
  return type === null ? rows : rows.filter(row => row.type === type);
}
