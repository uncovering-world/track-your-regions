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
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return '-';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <TableRow hover>
      <TableCell>{getStatusChip()}</TableCell>
      <TableCell>{log.category_name}</TableCell>
      <TableCell>{formatDate(log.started_at)}</TableCell>
      <TableCell>{formatDuration(log.started_at, log.completed_at)}</TableCell>
      <TableCell align="right">{log.total_fetched.toLocaleString()}</TableCell>
      <TableCell align="right">{log.total_created.toLocaleString()}</TableCell>
      <TableCell align="right">{log.total_updated.toLocaleString()}</TableCell>
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
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : log ? (
          <Box>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr', mb: 3 }}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Source</Typography>
                <Typography>{log.category_name}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Status</Typography>
                <Typography>{log.status}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Started</Typography>
                <Typography>{new Date(log.started_at).toLocaleString()}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Completed</Typography>
                <Typography>
                  {log.completed_at ? new Date(log.completed_at).toLocaleString() : '-'}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(4, 1fr)', mb: 3 }}>
              <Box sx={{ p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
                <Typography variant="h4">{log.total_fetched.toLocaleString()}</Typography>
                <Typography variant="body2" color="text.secondary">Fetched</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: 'success.light', borderRadius: 1 }}>
                <Typography variant="h4">{log.total_created.toLocaleString()}</Typography>
                <Typography variant="body2" color="text.secondary">Created</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                <Typography variant="h4">{log.total_updated.toLocaleString()}</Typography>
                <Typography variant="body2" color="text.secondary">Updated</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: log.total_errors > 0 ? 'error.light' : 'grey.100', borderRadius: 1 }}>
                <Typography variant="h4">{log.total_errors.toLocaleString()}</Typography>
                <Typography variant="body2" color="text.secondary">Errors</Typography>
              </Box>
            </Box>

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
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
