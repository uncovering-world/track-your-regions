/**
 * A row Postgres refuses for what it holds is left out of the subset and
 * named, rather than ending a build of many hours (#1434): a pass over the
 * whole dump meets values no test foresaw, and one of them stopped the first
 * full build in its second pass. A batch refused for its data is retried row
 * by row, so only the rows at fault are left out.
 *
 * Only a data exception (SQLSTATE class 22: an untranslatable character, a
 * value out of range) is a row's fault. Anything else — a full disk, a lost
 * connection, a cancel — stops the build as before, and so do more refusals
 * than any dump explains, which say the build itself is wrong.
 */

/** More refused rows than this is not a few odd values but a fault of the build. */
export const MAX_REFUSED = 1000;
/** How many refused ids the build's notes name. */
const NAMED = 10;

export const isRowsFault = (error: unknown): boolean =>
  /^22/.test(String((error as { code?: unknown } | null)?.code ?? ''));

export class Refusals {
  count = 0;
  readonly named: Array<{ id: string; reason: string }> = [];

  refuse(id: string, error: unknown): void {
    this.count += 1;
    if (this.named.length < NAMED) this.named.push({ id, reason: (error as Error).message });
    if (this.count > MAX_REFUSED) {
      throw new Error(`Postgres refused more than ${MAX_REFUSED} rows, the first ${this.named[0].id}: ${this.named[0].reason}`);
    }
  }

  /** Count again what an earlier build of the same pass recorded (#1493); the budget holds over both. */
  restore(refused: ReadonlyArray<{ id: string; reason: string }>): void {
    for (const row of refused) this.refuse(row.id, new Error(row.reason));
  }

  /** For the build's notes, or null when none was refused. */
  note(what: string): string | null {
    if (this.count === 0) return null;
    const named = this.named.map(r => `${r.id} (${r.reason})`).join(', ');
    return `left out ${this.count} ${what} Postgres refused: ${named}${this.count > this.named.length ? ', ...' : ''}`;
  }
}

/**
 * Insert `rows`, and where the batch is refused for its data, each row on its
 * own, leaving out and recording those still refused; answers how many were
 * written.
 */
export async function insertRefusing<T>(
  rows: T[], idOf: (row: T) => string, insert: (rows: T[]) => Promise<void>, refusals: Pick<Refusals, 'refuse'>,
): Promise<number> {
  try {
    await insert(rows);
    return rows.length;
  } catch (error) {
    if (!isRowsFault(error) || rows.length === 0) throw error;
  }
  let written = 0;
  for (const row of rows) {
    try {
      await insert([row]);
      written += 1;
    } catch (error) {
      if (!isRowsFault(error)) throw error;
      refusals.refuse(idOf(row), error);
    }
  }
  return written;
}
