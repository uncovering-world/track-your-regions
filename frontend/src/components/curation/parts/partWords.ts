/**
 * The words of the card's *Parts* and *Part of* sections (#2118): whose word
 * makes a place a part, how near a candidate stands, and why one cannot be
 * chosen. Plain functions, so the section and its spec read the same words.
 */

import type { PartCandidate, PartRow } from '../../../api/parts';
import { formatDay } from '../../../utils/dateFormat';
import { distanceLabel } from '../../../utils/moveDescription';

/** Beyond this, a candidate is named far from the whole's parts and asked about. */
export const FAR_M = 50_000;

/** The line under a row's name: its kind, or none, and what it is. */
export function placeLine(place: PartRow['place']): string {
  const kind = place.kind_name ?? 'No kind of its own';
  return place.subtitle ? `${kind} · ${place.subtitle}` : kind;
}

/** Each word that makes the place a part of the whole, one line each, the curator's last. */
export function claimLines(row: PartRow): string[] {
  const lines: string[] = [];
  if (row.list) {
    lines.push(row.list.name ? `Named on UNESCO’s list of its places as “${row.list.name}”` : 'Named on UNESCO’s list of its places');
  }
  if (row.statement) lines.push('Wikidata says it is a part');
  const word = row.curator;
  if (word?.admission === 'admitted') lines.push(`Added by ${word.by_you ? 'you' : 'a curator'}${dayOf(word.answered_at)}`);
  return lines;
}

/** Whether a source still names the place, so taking it out keeps it out rather than letting it go. */
export function sourceNames(row: PartRow): boolean {
  return row.list !== null || row.statement;
}

/** The line a kept-out row carries: who kept it out, and when. */
export function keptOutLine(row: PartRow): string {
  return `Kept out by ${row.curator?.by_you ? 'you' : 'a curator'}${dayOf(row.curator?.answered_at ?? null)}`;
}

function dayOf(at: string | null): string {
  return at ? ` · ${formatDay(at)}` : '';
}

/** How near the candidate stands: "77 m from Seville Cathedral, a part", or from the place itself. */
export function nearLine(candidate: PartCandidate, role: 'part' | 'whole'): string | null {
  if (candidate.distance_m === null) return null;
  const distance = distanceLabel(candidate.distance_m);
  if (candidate.near_name) return `${distance} from ${candidate.near_name}, a part`;
  return role === 'part' ? `${distance} from it` : `${distance} from this place`;
}

/** What a place outside the caller's scope says: the word on it is another curator's. */
export const OUTSIDE_SCOPE = 'Outside the regions you curate. A curator of its region adds it.';

/** Why a candidate cannot be chosen, in the curator's words; null where it can. */
export function takenLine(candidate: PartCandidate, role: 'part' | 'whole', selfName: string): string | null {
  switch (candidate.taken) {
    case 'self': return 'A place cannot be a part of itself.';
    case 'already': return role === 'part' ? 'Already a part' : 'Already part of it';
    case 'loop': return role === 'part'
      ? `${selfName} is one of its parts. A whole cannot become a part of its own part.`
      : `It is one of ${selfName}’s parts. A whole cannot become a part of its own part.`;
    case 'scope': return OUTSIDE_SCOPE;
    default: return null;
  }
}
