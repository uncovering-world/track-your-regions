/**
 * Sync History Panel
 *
 * Shows history of sync operations with details.
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  CircularProgress,
  TablePagination,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { getSyncLogs, getSyncLogDetails, type SyncLog } from '../../api/admin';
import { formatDateTime, formatDuration } from '../../utils/dateFormat';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { SyncChangeList } from './SyncChangeList';

export function SyncHistoryPanel() {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedLog, setSelectedLog] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'syncLogs', page, rowsPerPage],
    queryFn: () => getSyncLogs(undefined, rowsPerPage, page * rowsPerPage),
  });

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  if (isLoading) {
    return <LoadingSpinner padding={4} />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Sync History
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        View past sync operations and their results.
      </Typography>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right">Fetched</TableCell>
              <TableCell align="right">Created</TableCell>
              <TableCell align="right">Updated</TableCell>
              <TableCell align="right">Errors</TableCell>
              <TableCell>Triggered By</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.logs.map((log) => (
              <SyncLogRow
                key={log.id}
                log={log}
                onViewDetails={() => setSelectedLog(log.id)}
              />
            ))}
            {(!data?.logs || data.logs.length === 0) && (
              <TableRow>
                <TableCell colSpan={10} align="center">
                  <Typography color="text.secondary" sx={{ py: 4 }}>
                    No sync history found
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={data?.total || 0}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={handleChangePage}
          onRowsPerPageChange={handleChangeRowsPerPage}
        />
      </TableContainer>

      {/* Details Dialog */}
      <SyncLogDialog logId={selectedLog} onClose={() => setSelectedLog(null)} />
    </Box>
  );
}

interface SyncLogRowProps {
  log: SyncLog;
  onViewDetails: () => void;
}

function SyncLogRow({ log, onViewDetails }: SyncLogRowProps) {
  const getStatusChip = () => {
    switch (log.status) {
      case 'success':
        return <Chip icon={<SuccessIcon />} label="Success" color="success" size="small" />;
      case 'partial':
        return <Chip icon={<WarningIcon />} label="Partial" color="warning" size="small" />;
      case 'failed':
        return <Chip icon={<ErrorIcon />} label="Failed" color="error" size="small" />;
      case 'cancelled':
        return <Chip icon={<CancelIcon />} label="Cancelled" color="default" size="small" />;
      case 'running':
        return <Chip icon={<CircularProgress size={14} />} label="Running" color="primary" size="small" />;
      default:
        return <Chip label={log.status} size="small" />;
    }
  };


  return (
    <TableRow hover>
      <TableCell>{getStatusChip()}</TableCell>
      <TableCell>
        {log.category_name}
        {log.is_dry_run && (
          <Chip label="Preview" size="small" color="info" variant="outlined" sx={{ ml: 1 }} />
        )}
      </TableCell>
      <TableCell>{formatDateTime(log.started_at)}</TableCell>
      <TableCell>{formatDuration(log.started_at, log.completed_at)}</TableCell>
      <TableCell align="right">{(log.total_fetched ?? 0).toLocaleString()}</TableCell>
      <TableCell align="right">{(log.total_created ?? 0).toLocaleString()}</TableCell>
      <TableCell align="right">
        {(log.total_updated ?? 0).toLocaleString()}
        {!log.has_changeset && log.total_updated > 0 && (
          <Tooltip title="Counted every row touched, not only those that changed — not comparable with later runs">
            <Typography component="span" color="text.secondary" sx={{ ml: 0.5 }}>*</Typography>
          </Tooltip>
        )}
      </TableCell>
      <TableCell align="right">
        {log.total_errors > 0 ? (
          <Chip label={log.total_errors} color="error" size="small" />
        ) : (
          '0'
        )}
      </TableCell>
      <TableCell>{log.triggered_by_name || 'System'}</TableCell>
      <TableCell>
        <IconButton size="small" onClick={onViewDetails}>
          <InfoIcon />
        </IconButton>
      </TableCell>
    </TableRow>
  );
}

interface SyncLogDialogProps {
  logId: number | null;
  onClose: () => void;
}

/**
 * Why a run has no per-object record, which is not one question but three.
 *
 * A missing changeset means "no record kept", and that has separate causes with
 * separate consequences: a run from before this slice existed, a run whose
 * changeset write failed minutes ago, and a run that legitimately had nothing
 * to record. Only the first says anything about what `Changed` means.
 */
export function changesetNote(log: SyncLog & { error_details?: unknown[] }) {
  if (log.has_changeset) return null;

  const touched = log.total_created + log.total_updated + log.total_missing;
  if (touched === 0) return null; // nothing happened; "no changes" is accurate

  const writeFailed = (log.error_details ?? []).some(
    (e) => typeof e === 'object' && e !== null
      && (e as { externalId?: string }).externalId === 'changeset',
  );

  if (writeFailed) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        This run&apos;s per-object record could not be written, so the breakdown below is missing
        even though the counters above are real. See the error details.
      </Alert>
    );
  }

  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      Run predates change provenance, so it kept no per-object record.
      {log.total_updated > 0 && (
        <> Its <strong>Changed</strong> figure also counts every row the sync touched, whether or
          not a field differed — later runs count only rows that actually changed, so the two are
          not comparable.</>
      )}
    </Alert>
  );
}

function Tile({ value, label, bg }: { value: number | null; label: string; bg: string }) {
  return (
    <Box sx={{ p: 2, bgcolor: bg, borderRadius: 1 }}>
      {/* Counters are nullable in the database; a run that failed before it
          could write them should show a zero, not take the card down. */}
      <Typography variant="h4">{(value ?? 0).toLocaleString()}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Box>
  );
}

function SyncLogDialog({ logId, onClose }: SyncLogDialogProps) {
  const { data: log, isLoading } = useQuery({
    queryKey: ['admin', 'syncLog', logId],
    queryFn: () => getSyncLogDetails(logId!),
    enabled: !!logId,
  });

  return (
    <Dialog open={!!logId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Sync Log Details</DialogTitle>
      <DialogContent>
        {isLoading && <LoadingSpinner padding={4} />}
        {!isLoading && log && (
          <Box>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr', mb: 3 }}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Category</Typography>
                <Typography>{log.category_name}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Status</Typography>
                <Typography>{log.status}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Started</Typography>
                <Typography>{formatDateTime(log.started_at)}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Completed</Typography>
                <Typography>{formatDateTime(log.completed_at ?? null)}</Typography>
              </Box>
            </Box>

            {log.is_dry_run && (
              <Chip label="Preview — nothing was written" color="info" sx={{ mb: 2 }} />
            )}

            {changesetNote(log)}

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(4, 1fr)', mb: 3 }}>
              <Tile value={log.total_fetched} label="Fetched" bg="grey.100" />
              <Tile value={log.total_created} label="Created" bg="success.light" />
              <Tile value={log.total_updated} label="Changed" bg="info.light" />
              <Tile value={log.total_unchanged} label="Unchanged" bg="grey.100" />
              <Tile value={log.total_missing} label="Missing" bg={log.total_missing > 0 ? 'warning.light' : 'grey.100'} />
              <Tile value={log.total_curated_conflicts} label="Conflicts" bg={log.total_curated_conflicts > 0 ? 'warning.light' : 'grey.100'} />
              <Tile value={log.total_errors} label="Errors" bg={log.total_errors > 0 ? 'error.light' : 'grey.100'} />
            </Box>

            {log.detection_skipped_reason && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Missing detection skipped: {log.detection_skipped_reason}
              </Typography>
            )}

            {log.has_changeset && <SyncChangeList logId={log.id} />}

            {log.error_details && log.error_details.length > 0 && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Error Details
                </Typography>
                <Box
                  sx={{
                    maxHeight: 200,
                    overflow: 'auto',
                    bgcolor: 'grey.100',
                    p: 2,
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.875rem',
                  }}
                >
                  {log.error_details.map((err, i) => (
                    <Box key={i} sx={{ mb: 1 }}>
                      {JSON.stringify(err)}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
