/**
 * A place's curation history, folded until a curator opens it, and the one act
 * the history itself offers: undoing a merge (#1247, ADR-0046 decision 5,
 * ADR-0086). A merge is recorded on the place that stayed, and that row is
 * where a curator who finds two places wrongly made one takes them apart.
 *
 * What an entry reads as — the chip naming each act and the line under it — is
 * `curationLog.ts`, presentation the admin panel reads too.
 *
 * A near pair's *part of* or *two places* is taken back from its row the same
 * way (#1991), whether the pass read it off Wikidata or a curator gave it: the
 * pair is asked about again on the review queue.
 *
 * A place a merge folded another entry into reads that entry's history too
 * (#1366): what was decided about it came along with what the merge moved, a
 * pin among them. Those rows say which entry they were about and offer nothing
 * to undo — the merge row above them is where the merge itself is undone.
 */

import { useState } from 'react';
import { Alert, Box, Button, Chip, Collapse, Divider, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import UndoIcon from '@mui/icons-material/Undo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCurationLog, takeBackMergeProposal, takeBackPointItem, undoPlaceMerge, undoSeparation, type CurationLogEntry,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { formatRelativeTime } from '../../utils/dateFormat';
import { displayNameOf } from '../../utils/displayName';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { LoadingSpinner } from './LoadingSpinner';
import {
  actionLabel, catalogueActor, formatLogDetails, takeableItems, takeablePair, undoableMerge, undoableSeparation,
  type TakeableItem,
} from './curationLog';

interface CurationHistoryProps {
  experienceId: number;
  /** The region the dialog was opened in, whose lists an undo changes. */
  regionId: number | null;
}

/** The one act a history row offers to undo: a merge (ADR-0086), or a separation (ADR-0144). */
type UndoableAct = { merge: number } | { separation: number };

function undoableAct(entry: CurationLogEntry, log: readonly CurationLogEntry[], placeId: number): UndoableAct | null {
  const mergeId = undoableMerge(entry, log, placeId);
  if (mergeId !== null) return { merge: mergeId };
  const separationId = undoableSeparation(entry, log, placeId);
  return separationId === null ? null : { separation: separationId };
}

/** The words of a take-back button: the point, then the item it was confirmed as. */
function takeBackLabel(item: TakeableItem): string {
  const point = item.point ?? `point #${item.locationId}`;
  return `Take back: ${point} ← ${item.label ?? item.item}`;
}

function HistoryRow({
  entry, onUndo, undoLabel = 'Undo this merge', undoing, takeBacks = [], onTakeBack, takingBack, onTakeBackPair, takingBackPair,
}: {
  entry: CurationLogEntry;
  /** Present on a merge, or a separation (ADR-0144), this place can still undo. */
  onUndo?: () => void;
  undoLabel?: string;
  undoing: boolean;
  /** The confirmed component items this row can still take back (#1317). */
  takeBacks?: TakeableItem[];
  onTakeBack?: (item: TakeableItem) => void;
  /** The point whose take-back is in flight, if any. */
  takingBack?: number;
  /** Present on a near pair's answer this place can still take back (#1991). */
  onTakeBackPair?: () => void;
  takingBackPair?: boolean;
}) {
  const actionInfo = actionLabel(entry.action) || { label: entry.action, color: '#6B7280' };
  const details = formatLogDetails(entry);
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        py: 0.75,
        borderBottom: '1px solid',
        borderColor: 'divider',
        alignItems: 'flex-start',
      }}
    >
      <Chip
        label={actionInfo.label}
        size="small"
        sx={{
          height: 20,
          fontSize: '0.6rem',
          fontWeight: 600,
          color: actionInfo.color,
          bgcolor: `${actionInfo.color}14`,
          border: `1px solid ${actionInfo.color}30`,
          flexShrink: 0,
          '& .MuiChip-label': { px: 0.5 },
        }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 500 }}>
          {/* A curator who set no display name, or a blank one, is still somebody; the
              catalogue's own acts are nobody's (ADR-0086, ADR-0141). */}
          {catalogueActor(entry) ?? displayNameOf(entry.curator_name) ?? 'A curator'}
        </Typography>
        {entry.region_name && (
          <Typography variant="caption" color="text.secondary">
            {' '}in {entry.region_name}
          </Typography>
        )}
        {entry.folded_id !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
            About {entry.folded_name ?? 'an entry'} (#{entry.folded_id}), since merged into this place
          </Typography>
        )}
        {details && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.25, whiteSpace: 'pre-line', lineHeight: 1.3 }}
          >
            {details}
          </Typography>
        )}
        {onUndo && (
          <Button
            size="small"
            startIcon={<UndoIcon fontSize="small" />}
            disabled={undoing}
            onClick={onUndo}
            sx={{ mt: 0.25, py: 0, textTransform: 'none', fontSize: '0.7rem' }}
          >
            {undoing ? 'Undoing…' : undoLabel}
          </Button>
        )}
        {takeBacks.map(item => (
          <Button
            key={`${item.locationId}:${item.item}`}
            size="small"
            startIcon={<UndoIcon fontSize="small" />}
            disabled={takingBack !== undefined}
            onClick={() => onTakeBack?.(item)}
            sx={{ mt: 0.25, py: 0, textTransform: 'none', fontSize: '0.7rem', display: 'flex' }}
          >
            {takingBack === item.locationId ? 'Taking back…' : takeBackLabel(item)}
          </Button>
        ))}
        {onTakeBackPair && (
          <Button
            size="small"
            startIcon={<UndoIcon fontSize="small" />}
            disabled={takingBackPair}
            onClick={onTakeBackPair}
            sx={{ mt: 0.25, py: 0, textTransform: 'none', fontSize: '0.7rem' }}
          >
            {takingBackPair ? 'Taking back…' : 'Take back this answer'}
          </Button>
        )}
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ flexShrink: 0, fontSize: '0.65rem' }}
      >
        {entry.created_at && formatRelativeTime(entry.created_at)}
      </Typography>
    </Box>
  );
}

export function CurationHistory({ experienceId, regionId }: CurationHistoryProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Read when the history is opened, not with the dialog.
  const logQuery = useQuery({
    queryKey: queryKeys.experience.curationLog(experienceId),
    queryFn: () => fetchCurationLog(experienceId),
    enabled: open,
    staleTime: 30_000,
  });

  const undo = useMutation({
    mutationFn: undoPlaceMerge,
    onSuccess: ({ foldedId }) => {
      // The folded place is a place again, back in every list and on the map
      // with the kinds it brought; this one holds less. Its own card, and any
      // address that was led from it to this place, are read afresh.
      invalidateExperiences(queryClient, { regionId, experienceId });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.one(foldedId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.survivor(foldedId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
    },
  });

  const undoSep = useMutation({
    mutationFn: undoSeparation,
    onSuccess: ({ separatedId }) => {
      // The place the separation made is folded back into this one, which
      // holds its kind again; the other's card and address answer with this.
      invalidateExperiences(queryClient, { regionId, experienceId });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.one(separatedId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.survivor(separatedId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
    },
  });

  const startUndo = (act: UndoableAct) => ('merge' in act ? undo.mutate(act.merge) : undoSep.mutate(act.separation));
  const isUndoing = (act: UndoableAct) => ('merge' in act
    ? undo.isPending && undo.variables === act.merge
    : undoSep.isPending && undoSep.variables === act.separation);

  const takeBack = useMutation({
    // The item the row showed goes with the point: a history read before
    // another curator changed the point is refused rather than taking the
    // newer item off.
    mutationFn: ({ locationId, item }: TakeableItem) => takeBackPointItem(locationId, item),
    onSuccess: () => {
      // The point has no item again: its row on the place's card and the
      // place's history are read afresh, and so is the review queue, where
      // the candidate is open again and marked (#1336).
      invalidateExperiences(queryClient, { regionId, experienceId });
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.curation.reviewQueueAll });
    },
  });

  const takeBackPair = useMutation({
    mutationFn: (proposalId: number) => takeBackMergeProposal(experienceId, proposalId),
    onSuccess: () => {
      // The pair is open again: the place's history, and the review queue,
      // where it is asked about again, are read afresh.
      queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
      queryClient.invalidateQueries({ queryKey: queryKeys.curation.reviewQueueAll });
    },
  });

  const log = logQuery.data ?? [];
  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Button
        size="small"
        startIcon={<HistoryIcon />}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => setOpen(!open)}
        sx={{ mb: 1, textTransform: 'none', color: 'text.secondary' }}
      >
        Curation History
        {log.length > 0 && (
          <Chip
            label={log.length}
            size="small"
            sx={{ ml: 0.75, height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.5 } }}
          />
        )}
      </Button>

      <Collapse in={open}>
        {undo.isError && (
          <Alert severity="error" sx={{ py: 0, mb: 1 }}>{(undo.error as Error).message}</Alert>
        )}
        {undoSep.isError && (
          <Alert severity="error" sx={{ py: 0, mb: 1 }}>{(undoSep.error as Error).message}</Alert>
        )}
        {takeBack.isError && (
          <Alert severity="error" sx={{ py: 0, mb: 1 }}>{(takeBack.error as Error).message}</Alert>
        )}
        {takeBackPair.isError && (
          <Alert severity="error" sx={{ py: 0, mb: 1 }}>{(takeBackPair.error as Error).message}</Alert>
        )}
        <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
          {logQuery.isLoading && (
            <LoadingSpinner size={20} padding="8px 0" />
          )}
          {logQuery.isError && (
            <Alert severity="error" sx={{ py: 0 }}>
              Failed to load history
            </Alert>
          )}
          {logQuery.data && log.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1 }}>
              No curation history yet.
            </Typography>
          )}
          {log.map((entry) => {
            const own = entry.folded_id === null;
            const act = own ? undoableAct(entry, log, experienceId) : null;
            const pair = own ? takeablePair(entry, log) : null;
            return (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onUndo={act === null ? undefined : () => startUndo(act)}
                undoLabel={act !== null && 'separation' in act ? 'Undo this separation' : 'Undo this merge'}
                undoing={act !== null && isUndoing(act)}
                takeBacks={own ? takeableItems(entry, log) : []}
                onTakeBack={item => takeBack.mutate(item)}
                takingBack={takeBack.isPending ? takeBack.variables?.locationId : undefined}
                onTakeBackPair={pair === null ? undefined : () => takeBackPair.mutate(pair)}
                takingBackPair={takeBackPair.isPending && takeBackPair.variables === pair}
              />
            );
          })}
        </Box>
      </Collapse>
    </>
  );
}
