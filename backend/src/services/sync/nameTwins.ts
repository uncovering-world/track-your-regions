/**
 * A place whose label another place of the catalogue carries is named apart
 * by the hint its description gives: "Soviet War Memorial (Berlin's Treptower
 * Park)" beside "Soviet War Memorial (Berlin-Tiergarten)" (#1967).
 *
 * Decided over the catalogue, never over one run's batch: two kinds of one
 * item admit different neighbours, Monuments & memorials both Soviet War
 * Memorials of Berlin and Public art only the Treptower Park one, and two
 * batches gave one place two names, each run renaming it back. Over the
 * catalogue every source of the item reaches one answer, and the suffix comes
 * and goes only when a twin enters or leaves the catalogue.
 *
 * The comparison is over the labels the sources sent (`reported_label`), never
 * over stored names, which already carry the suffix a twin set apart. Every
 * run applies it, through the upsert, whatever its kind.
 */

import type { PoolClient } from 'pg';
import { capitalizedName, tidyLabel } from '@tyr/shared/labels';
import { MEMBERSHIPS, membershipAdmittedSql } from '../../db/membership.js';
import { viewStandsSql } from '../../db/sourceViews.js';

/**
 * The place a description says a thing stands in: "in Berlin's Treptower Park"
 * gives "Berlin's Treptower Park". A period does not end it, since "in St.
 * Petersburg, Russia" names St. Petersburg; a comma or a semicolon does.
 * Tidied as a stored name is (`tidyLabel`, #835), since it becomes part of one.
 */
export function twinHint(description: string | null): string | null {
  // A negated class, so the match cannot backtrack across the stop characters.
  const match = description?.match(/\bin\s+([^,;()\n]+)/i);
  const hint = match ? tidyLabel(match[1]).replace(/\.$/, '') : undefined;
  return hint ? hint : null;
}

/**
 * The label named apart by its description's hint, or the label as sent where
 * the description gives none, or one the label already says: "Prehistoric
 * Sites and Decorated Caves of the Vézère Valley" gains nothing from "(the
 * Vézère Valley)".
 */
export function namedApart(label: string, description: string | null): string {
  const hint = twinHint(description);
  return hint && !label.toLowerCase().includes(hint.toLowerCase()) ? `${label} (${hint})` : label;
}

/** A place's membership standing in the catalogue: its kind admits it and its source still lists it. */
const standing = (alias: string): string =>
  `${membershipAdmittedSql(alias)} AND ${viewStandsSql(alias)}`;

/** One source's description of the place, as the record carries it or as that source last reported it. */
interface SourceDescription { sourceId: number; description: string | null }

/** What a record is named from: the label and description it carries, and the source that sent it. */
export interface NamedRecord { sourceId: number; label: string; description: string | null }

/**
 * The labels a twin's membership may hold for `label`: the label, and the
 * label before the run gave it its first capital (`capitalizedName`,
 * ADR-0160), which a source that has not run since still holds: the first run
 * after the rule would otherwise find no twin of *Place de la République* in a
 * stored *place de la République*, drop the suffix, and set it back once the
 * twin's source runs.
 */
export function twinLabels(label: string): string[] {
  const lowered = label.replace(/^([^\p{L}\p{N}]*)(\p{Lu})/u, (_, lead: string, letter: string) => lead + letter.toLowerCase());
  return lowered !== label && capitalizedName(lowered) === label ? [label, lowered] : [label];
}

/**
 * Whether another place of the catalogue carries the record's label: one with
 * a membership standing in the catalogue, whether a curator has passed it yet
 * or not, so an arrival is told apart from its twin before it is published.
 * With it, the descriptions the place's other standing sources last reported.
 * `placeId` is the place the record lands on, which is no twin of itself, or
 * null for a place the run has not created yet.
 */
async function twinAndDescriptions(
  query: Pick<PoolClient, 'query'>, record: NamedRecord, placeId: number | null,
): Promise<{ twin: boolean; others: SourceDescription[] }> {
  const result = await query.query<{ twin: boolean; others: SourceDescription[] }>(
    `SELECT EXISTS (
       SELECT 1 FROM ${MEMBERSHIPS} m JOIN experiences e ON e.id = m.experience_id
        WHERE m.reported_label = ANY($1::text[]) AND e.id IS DISTINCT FROM $2::int AND e.merged_into_id IS NULL
          AND ${standing('m')}
     ) AS twin,
     COALESCE((
       SELECT json_agg(json_build_object('sourceId', o.source_id, 'description', o.reported_subtitle))
         FROM ${MEMBERSHIPS} o
        WHERE o.experience_id = $2::int AND o.source_id <> $3 AND ${standing('o')}
     ), '[]'::json) AS others`,
    [twinLabels(record.label), placeId, record.sourceId],
  );
  return { twin: Boolean(result.rows[0]?.twin), others: result.rows[0]?.others ?? [] };
}

/**
 * The name a record is written under: its label, named apart where the
 * catalogue holds a twin.
 *
 * The hint is the place's, not the record's: the first description among the
 * place's sources, in the order of their ids, that names the label apart, the
 * record's own standing in for what its source last reported. Two sources of
 * one place describe it differently ("church in Berlin", "memorial in Berlin's
 * Treptower Park") or not at all, and a hint read off each record alone would
 * rename the place on every pair of runs again.
 */
export async function catalogueName(
  query: Pick<PoolClient, 'query'>, record: NamedRecord, placeId: number | null,
): Promise<string> {
  const { twin, others } = await twinAndDescriptions(query, record, placeId);
  if (!twin) return record.label;
  const descriptions = [...others, { sourceId: record.sourceId, description: record.description }]
    .sort((a, b) => a.sourceId - b.sourceId);
  for (const { description } of descriptions) {
    const apart = namedApart(record.label, description);
    if (apart !== record.label) return apart;
  }
  return record.label;
}
