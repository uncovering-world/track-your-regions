/**
 * The curation log as an admin audits it (#956): the audit table of
 * `CurationActTable`, one act a row with the fact it changed before and after,
 * the place with its picture and a way to open it.
 *
 * One table for both of the admin's reads of the log — a curator's activity
 * dialog and the feed across every curator (#611) — and the same rows a place's
 * History shows, so an act reads the same on every screen (#691).
 */

import type { CuratorActivityEntry } from '../../api/admin';
import { displayNameOf } from '../../utils/displayName';
import { CuratePlaceButton } from '../curation/CuratePlaceButton';
import { CurationActTable, type ActEntry } from '../shared/CurationActTable';

/** Who acted, as a reader can name them: a run's own merge has no curator, and says so. */
export function actorName(entry: Pick<CuratorActivityEntry, 'curator_id' | 'curator_name'>): string {
  if (entry.curator_id === null) return 'The catalogue';
  return displayNameOf(entry.curator_name) ?? `User #${entry.curator_id}`;
}

function actEntryOf(entry: CuratorActivityEntry): ActEntry {
  return {
    id: entry.id,
    action: entry.action,
    details: entry.details,
    kind_name: entry.kind_name,
    created_at: entry.created_at,
    who: actorName(entry),
    batch: entry.batch,
    place: {
      id: entry.experience_id,
      name: entry.experience_name,
      imageUrl: entry.experience_image_url,
      credit: entry.experience_image_credit,
    },
  };
}

export function CurationActivityTable({ activity, showCurator = false }: {
  activity: CuratorActivityEntry[];
  /** The feed across curators names who acted; one curator's own log does not need to. */
  showCurator?: boolean;
}) {
  return (
    <CurationActTable
      entries={activity.map(actEntryOf)}
      variant="trail"
      showCurator={showCurator}
      // A batch is many places: its row opens none, and its places are listed under it.
      rowActions={(entry) => !entry.batch && entry.place && <CuratePlaceButton placeId={entry.place.id} name={entry.place.name} />}
    />
  );
}
