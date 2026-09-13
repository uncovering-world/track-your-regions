/**
 * The fame line a source states for itself.
 *
 * The world tier's line used to be two constants in the pipeline that owned it
 * (`ENTER_SITELINKS`, `STAY_SITELINKS`), which is fine while every source
 * shares one number and wrong as soon as one does not: a kind whose sources
 * enumerate different worlds needs its own line, and moving it takes a deploy.
 * The line is a property of the source, so it is stored on the source row
 * (`experience_sources.api_config`) — read by the run, edited from the admin
 * panel (ADR-0052).
 *
 * Two numbers, not one, because the tier is hysteretic (ADR-0023): a row enters
 * at `enterSitelinks` and stays until it falls below `staySitelinks`, so a list
 * does not flap as Wikipedia grows.
 */

import { pool } from '../../db/index.js';

export interface SourceLine {
  /** How famous a row must be to enter the world tier. */
  enterSitelinks: number;
  /** How far an admitted row may slip before it is refused by name. */
  staySitelinks: number;
}

/**
 * A sitelink count a person could have meant. The ceiling is not a rule about
 * the world — the most linked entity on Wikidata is nowhere near it — but a
 * line above it admits nothing, which is a typo rather than an intention.
 */
const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000;

/**
 * The line a source row states, or an error naming what is missing.
 *
 * Throws rather than falling back to a default: a run that quietly used 22
 * because the row said nothing would admit a different catalogue than the panel
 * says it does, and the admission axis exists to prevent exactly that
 * (ADR-0024).
 */
export function parseSourceLine(apiConfig: unknown): SourceLine {
  const config = (apiConfig ?? {}) as Record<string, unknown>;
  const enter = config.enterSitelinks;
  const stay = config.staySitelinks;
  if (!isCount(enter)) {
    throw new Error('The source row states no enterSitelinks line (api_config)');
  }
  if (!isCount(stay)) {
    throw new Error('The source row states no staySitelinks line (api_config)');
  }
  // Equal is allowed — a source may choose to run without hysteresis — but a
  // stay line above the enter line would refuse rows the same run just admitted.
  if (stay > enter) {
    throw new Error(`The stay line (${stay}) is above the enter line (${enter})`);
  }
  return { enterSitelinks: enter, staySitelinks: stay };
}

export async function readSourceLine(sourceId: number): Promise<SourceLine> {
  const result = await pool.query(
    'SELECT api_config FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  if (result.rows.length === 0) throw new Error(`No source row with id ${sourceId}`);
  return parseSourceLine(result.rows[0].api_config);
}
