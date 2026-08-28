/**
 * What an object's History makes of the trail `experience_curation_log` holds.
 *
 * Each entry gets two things: a chip naming the act, and a line under it saying what the
 * row carries that the chip cannot — the note a curator typed, the values an edit moved.
 *
 * Its own module rather than a block inside `CurationDialog`, because the presentation is
 * not the dialog's: the cross-curator feed (#611) is to render the same rows, and a
 * second rendering of a curator's act is how the two would come to disagree.
 */

import type { CurationLogEntry } from '../../api/experiences';

export const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  rejected: { label: 'Rejected', color: '#EF4444' },
  unrejected: { label: 'Unrejected', color: '#22C55E' },
  edited: { label: 'Edited', color: '#3B82F6' },
  created: { label: 'Created', color: '#8B5CF6' },
  added_to_region: { label: 'Added to region', color: '#0D9488' },
  removed_from_region: { label: 'Removed from region', color: '#F59E0B' },
  // The verdicts on one point (ADR-0026). Unlabelled, the row printed the raw
  // `location_marked_former` through the fallback below, which is machine noise on a
  // screen a person reads — and this is the only screen that has a point's verdict at
  // all, since answering one takes it off every list (#544).
  location_marked_former: { label: 'Place: source dropped it', color: '#F59E0B' },
  location_marked_lost: { label: 'Place: no longer exists', color: '#EF4444' },
  location_state_restored: { label: 'Place: verdict taken back', color: '#22C55E' },
  location_missing_dismissed: { label: 'Place: false alarm', color: '#22C55E' },
  // The fifth member of the same family (ADR-0029) and the one that lands in this list
  // beside the four above, so leaving it out would have the History read "Place: source
  // dropped it" on one row and `location_edited` on the next. The nine other unlabelled
  // actions this code writes are a different family and stay as they were.
  location_edited: { label: 'Place corrected', color: '#3B82F6' },
};

/** The four actions above, as the detail formatter has to recognise them. */
const POINT_VERDICT_ACTIONS = new Set([
  'location_marked_former', 'location_marked_lost',
  'location_state_restored', 'location_missing_dismissed',
]);

/**
 * A value as text, and the one shape `String()` cannot render: a coordinate pair.
 *
 * The object-level `edited` action records scalar column updates, so every value it
 * carries stringifies. A *point* edit does not: `location_edited` writes a move as
 * `{ old: { lon, lat }, new: { lon, lat } }` (ADR-0029), and without this branch the row
 * whose whole purpose is saying what moved reads
 * `location: "[object Object]" → "[object Object]"`.
 *
 * Latitude first, as every other coordinate in the product is written — and **unrounded**,
 * unlike `coordinateLabel` on the queue's own cards, which cuts at four decimals because
 * that is finer than naming a place needs. Here it would be wrong: a correction inside the
 * writer's ten-metre tolerance is exactly what this row exists to show, and four decimals
 * would print both sides of it identically — the failure the withdrawal card documents at
 * 1.2 cm (#543).
 */
function truncate40(value: unknown): string {
  const pair = value as { lat?: unknown; lon?: unknown } | null;
  if (pair && typeof pair === 'object'
    && typeof pair.lat === 'number' && typeof pair.lon === 'number') {
    return `${pair.lat}, ${pair.lon}`;
  }
  const str = String(value || '(empty)');
  return str.length > 40 ? str.slice(0, 40) + '...' : str;
}

function formatEditedChanges(d: Record<string, unknown>): string | null {
  const changes: string[] = [];
  for (const [field, val] of Object.entries(d)) {
    const change = val as { old?: unknown; new?: unknown } | undefined;
    if (change?.old === undefined || change?.new === undefined) continue;
    changes.push(`${field}: "${truncate40(change.old)}" → "${truncate40(change.new)}"`);
  }
  return changes.length > 0 ? changes.join('\n') : null;
}

/**
 * A verdict on one point, in the two facts the label cannot carry.
 *
 * Which place, and what the curator wrote about it. The transition is not repeated: the
 * chip beside this already names it, and `details` carries both axes whether or not the
 * act moved them, so printing them would say `existence: extant → extant` beside a
 * membership verdict.
 *
 * This is the note's **only** screen, which is what makes it worth a branch of its own.
 * The row's `state_note` holds the standing answer, and taking a verdict back moves
 * `state_decided_by` and `state_decided_at` to whoever took it — so the note goes with
 * the answer it explained rather than being reattributed, and the wording survives here
 * or nowhere (#544).
 *
 * The place is a bare id because the log has no name to give: the audit row hangs off the
 * experience and names the point in `details.locationId`, which is what stops a serial
 * site's seven components recording seven indistinguishable verdicts. Printed as an id
 * and said to be one, rather than as a number a reader has to guess the meaning of.
 */
function formatPointVerdict(d: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (d.locationId !== undefined && d.locationId !== null) parts.push(`Place #${d.locationId}`);
  if (d.note) parts.push(`“${d.note}”`);
  return parts.length > 0 ? parts.join(' — ') : null;
}

export function formatLogDetails(entry: CurationLogEntry): string | null {
  if (!entry.details) return null;
  const d = entry.details as Record<string, unknown>;

  if (entry.action === 'rejected' && d.reason) return `Reason: ${d.reason}`;
  if (entry.action === 'edited') return formatEditedChanges(d);
  if (entry.action === 'created' && d.name) return `Name: ${d.name}`;
  if (POINT_VERDICT_ACTIONS.has(entry.action)) return formatPointVerdict(d);
  // A correction rather than a verdict, so it has values to show — and `details` carries
  // only the keys the edit actually changed, which is what lets the shared formatter run
  // over it without inventing a coordinate move out of a rename.
  if (entry.action === 'location_edited') {
    return [
      d.locationId === undefined || d.locationId === null ? null : `Place #${d.locationId}`,
      formatEditedChanges(d),
    ].filter(Boolean).join(' — ') || null;
  }
  return null;
}
