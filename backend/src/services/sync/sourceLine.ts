/**
 * The fame line a source states for itself.
 *
 * Not two constants in the pipeline that reads them: a pair of constants is
 * fine while every source shares one number and wrong as soon as one does
 * not — a kind whose sources enumerate different worlds needs its own line,
 * and moving a constant takes a deploy.
 * The line is a property of the source, so it is stored on the source row
 * (`experience_sources.api_config`) — read by the run, edited from the admin
 * panel (ADR-0052).
 *
 * Two numbers, not one, because the tier is hysteretic (ADR-0023): a row enters
 * at `enterSitelinks` and stays until it falls below `staySitelinks`, so a list
 * does not flap as Wikipedia grows.
 *
 * A kind whose finds are thinner than its places states a second pair
 * (ADR-0058 decision 5). Archaeology admits both the site a traveller stands on
 * and the famous find a museum holds, and a find carries fewer articles than
 * the museum that shows it: holders of a find number 56 at 22 sitelinks and 78
 * at 18, the National Museum of Iraq entering through the Warka Vase at 20 and
 * the Acropolis Museum through the Kritios Boy at 18, while the museums
 * themselves are known in 36 and 37 languages. One line for both doors would
 * either lose those two museums or widen the sites into their long tail. The
 * second pair is optional: a source with one door states one line, and reads
 * exactly as it did before.
 */

import { pool } from '../../db/index.js';

/** One hysteretic line: the count a row enters on, and the count it stays on. */
export interface LinePair {
  /** How famous a row must be to enter the world tier. */
  enterSitelinks: number;
  /** How far an admitted row may slip before it is refused by name. */
  staySitelinks: number;
}

export interface SourceLine extends LinePair {
  /** The finds' own line, where the source states one; absent for a source with one line. */
  find?: LinePair;
}

/**
 * A sitelink count a person could have meant. The ceiling is not a rule about
 * the world — the most linked entity on Wikidata is nowhere near it — but a
 * line above it admits nothing, which is a typo rather than an intention.
 */
const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1000;

/**
 * One pair of counts off the row, or an error naming the key that is wrong.
 *
 * The keys are arguments rather than fixed, because the two pairs a source may
 * state are the same rule read twice: whichever door the caller is asking
 * about, an unusable number must be refused by the name the row spells it
 * under, so an admin reading the error knows which field to correct.
 */
function parsePair(
  config: Record<string, unknown>,
  enterKey: string,
  stayKey: string,
): LinePair {
  const enter = config[enterKey];
  const stay = config[stayKey];
  if (!isCount(enter)) {
    throw new Error(`The source row states no ${enterKey} line (api_config)`);
  }
  if (!isCount(stay)) {
    throw new Error(`The source row states no ${stayKey} line (api_config)`);
  }
  // Equal is allowed — a source may choose to run without hysteresis — but a
  // stay line above the enter line would refuse rows the same run just admitted.
  if (stay > enter) {
    throw new Error(`The stay line (${stay}) is above the enter line (${enter})`);
  }
  return { enterSitelinks: enter, staySitelinks: stay };
}

/**
 * The line a source row states, or an error naming what is missing.
 *
 * Throws rather than falling back to a default: a run that quietly used 22
 * because the row said nothing would admit a different catalogue than the panel
 * says it does, and the admission axis exists to prevent exactly that
 * (ADR-0024).
 *
 * The finds pair is read only when the row mentions it, and then in full: half
 * a pair is an error rather than a pair completed from the places' line,
 * because a find silently judged by the museums' line is the flood the second
 * line exists to prevent (ADR-0058 decision 5).
 */
export function parseSourceLine(apiConfig: unknown): SourceLine {
  const config = (apiConfig ?? {}) as Record<string, unknown>;
  const main = parsePair(config, 'enterSitelinks', 'staySitelinks');
  const statesFind = config.findEnterSitelinks !== undefined || config.findStaySitelinks !== undefined;
  if (!statesFind) return main;
  return { ...main, find: parsePair(config, 'findEnterSitelinks', 'findStaySitelinks') };
}

/**
 * The line a source's *contents* are judged by: its second pair where it states
 * one, and its only line where it does not (ADR-0058 decision 5).
 *
 * One function rather than a `?? ` at each reader, because two readers of one
 * source now ask it — the collector, deciding which find carries a museum over
 * the place line, and the run, telling the treasure writer which line the find's
 * own must-see flag is read at. Spelled twice, a source with one line would have
 * its museums judged at its own number and its finds badged at the art museums'
 * 22/18, and the two badges would disagree about the same find (ADR-0023
 * decision 2).
 */
export function contentsLine(line: SourceLine): LinePair {
  return line.find ?? line;
}

/**
 * Where a row stands against the line it is judged by: in, out, or fallen.
 *
 * `fell` and `out` are both below the line and they are not the same answer.
 * A refusal names a rule that ran on the row, so a row the source already
 * admits that has slipped is refused **by name, with its number** — a curator
 * can see which of their list is going and why. A row that was never in and is
 * below the line had no rule run on it: reporting it would bury the real
 * refusals under the long tail of everything Wikidata holds, so it is simply
 * out.
 *
 * The rule lives here, beside the numbers it reads, because three kinds ask it
 * and a kind that spelled it slightly differently would give a curator two
 * sentences for one fact. It takes a `LinePair` rather than a `SourceLine`, so
 * a source's second pair (its finds' line, ADR-0058 decision 5) is asked with
 * the same function as its first.
 */
export type LineStanding = 'in' | 'out' | 'fell';

export function lineStanding(
  sitelinks: number,
  wasAdmitted: boolean,
  line: LinePair,
): LineStanding {
  if (sitelinks >= line.enterSitelinks) return 'in';
  if (!wasAdmitted) return 'out';
  return sitelinks >= line.staySitelinks ? 'in' : 'fell';
}

/** The sentence a curator reads beside a row that fell: one wording for every kind. */
export function belowLineReason(sitelinks: number, line: LinePair): string {
  return `${sitelinks} sitelinks: below the world tier's line `
    + `(${line.enterSitelinks} to enter, ${line.staySitelinks} to stay)`;
}

export async function readSourceLine(sourceId: number): Promise<SourceLine> {
  const result = await pool.query(
    'SELECT api_config FROM experience_sources WHERE id = $1',
    [sourceId],
  );
  if (result.rows.length === 0) throw new Error(`No source row with id ${sourceId}`);
  return parseSourceLine(result.rows[0].api_config);
}
