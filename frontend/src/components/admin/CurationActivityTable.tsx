/**
 * The curation log as an admin audits it: one row per act, its action named as the
 * object's own History names it, the place, the region it named, who acted and when,
 * and the raw payload on demand.
 *
 * One table for both of the admin's reads of the log — a curator's activity dialog and
 * the feed across every curator (#611) — so an act reads the same on either screen.
 */

import { useState } from 'react';
import {
  Box, Chip, Collapse, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { CuratorActivityEntry } from '../../api/admin';
import { formatDateTime } from '../../utils/dateFormat';
import { displayNameOf } from '../../utils/displayName';
import { actionLabel } from '../shared/curationLog';

/** Who acted, as a reader can name them: a run's own merge has no curator, and says so. */
export function actorName(entry: Pick<CuratorActivityEntry, 'curator_id' | 'curator_name'>): string {
  if (entry.curator_id === null) return 'The catalogue';
  return displayNameOf(entry.curator_name) ?? `User #${entry.curator_id}`;
}

export function CurationActivityTable({
  activity,
  showCurator = false,
}: {
  activity: CuratorActivityEntry[];
  /** The feed across curators names who acted; one curator's own log does not need to. */
  showCurator?: boolean;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Action</TableCell>
          <TableCell>Experience</TableCell>
          <TableCell>Region</TableCell>
          {showCurator && <TableCell>Curator</TableCell>}
          <TableCell>Date</TableCell>
          <TableCell width={40} />
        </TableRow>
      </TableHead>
      <TableBody>
        {activity.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={entry}
            showCurator={showCurator}
            expanded={expanded === entry.id}
            onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function ActivityRow({
  entry,
  showCurator,
  expanded,
  onToggle,
}: {
  entry: CuratorActivityEntry;
  showCurator: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  // The same words the object's own History uses, from the same table. This screen
  // asks a different question — what has this curator done, rather than what was done
  // to this object — but the rows are the rows, and one rendering of an act is enough
  // (#691).
  //
  // The detail below stays raw JSON: an admin reading a curator's trail is auditing it,
  // and the whole payload is the point. `formatLogDetails` says what a curator meant;
  // this says what was written.
  const named = actionLabel(entry.action);

  return (
    <>
      <TableRow hover>
        <TableCell>
          <Chip
            label={named?.label ?? entry.action.replace(/_/g, ' ')}
            size="small"
            variant="outlined"
            sx={named ? {
              color: named.color,
              bgcolor: `${named.color}14`,
              borderColor: `${named.color}55`,
            } : undefined}
          />
        </TableCell>
        <TableCell>
          <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
            {entry.experience_name}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" color="text.secondary">
            {entry.region_name || '—'}
          </Typography>
        </TableCell>
        {showCurator && (
          <TableCell>
            <Typography variant="body2" color={entry.curator_id === null ? 'text.secondary' : undefined}>
              {actorName(entry)}
            </Typography>
          </TableCell>
        )}
        <TableCell>
          <Typography variant="caption">
            {formatDateTime(entry.created_at)}
          </Typography>
        </TableCell>
        <TableCell>
          {entry.details && (
            <IconButton size="small" onClick={onToggle} aria-label={expanded ? 'Hide details' : 'Show details'}>
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          )}
        </TableCell>
      </TableRow>
      {entry.details && (
        <TableRow>
          <TableCell colSpan={showCurator ? 6 : 5} sx={{ py: 0, borderBottom: expanded ? undefined : 'none' }}>
            <Collapse in={expanded}>
              <Box sx={{ py: 1, px: 2, bgcolor: 'grey.50', borderRadius: 1, my: 0.5 }}>
                <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {JSON.stringify(entry.details, null, 2)}
                </Typography>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
