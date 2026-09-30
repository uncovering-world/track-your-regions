/**
 * Assignment Panel
 *
 * Controls for assigning experiences to regions based on spatial containment.
 *
 * The rebuild is one transaction on the server (#1152), so a restart under it
 * keeps nothing it did — and the server that comes back knows nothing of it:
 * the status answers a bare `{ running: false }`. The panel keeps asking
 * through the seconds the server refuses, and when the answer after a run it
 * was following is that bare one, it says the run was lost to a restart.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  LinearProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getSources,
  startRegionAssignment,
  getAssignmentStatus,
  cancelAssignment,
  getExperienceCountsByRegion,
  type AssignmentStatus,
} from '../../api/admin';
import { fetchWorldViews } from '../../api/worldViews';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../api/queryKeys';
import { LOST_TOUCH_AFTER_MS } from './useSyncStatusPolling';

/** What the panel says when a run it was following was lost to a restart. */
export const RESTARTED_UNDER_IT = 'The server was restarted while this was assigning; nothing it did '
  + 'was kept, and the assignments from before stand. Start it again.';

const FINISHED_SEVERITY = { complete: 'success', failed: 'error', cancelled: 'info' } as const;

export function AssignmentPanel() {
  const { user } = useAuth();
  const [selectedWorldView, setSelectedWorldView] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState<AssignmentStatus | null>(null);
  const [restarted, setRestarted] = useState(false);
  const [lostTouch, setLostTouch] = useState(false);
  // Whether the last answer, or a start from here, said a run was going.
  const followingRef = useRef(false);
  // Moved on by a start and by a change of world view: an answer to a request
  // sent before either describes what was there before, and read after a start
  // its bare `{ running: false }` would pass for a restart under the new run.
  const statusGenerationRef = useRef(0);
  const failingSinceRef = useRef<number | null>(null);

  // Fetch world views
  const { data: worldViews } = useQuery({
    // Same rule as useNavigation: this list is filtered by visibility, so it
    // is cached per identity. Sharing the key also shares the entry, which is
    // why this no longer refetches what navigation already has.
    queryKey: queryKeys.worldViews.forCaller(user?.id),
    queryFn: fetchWorldViews,
  });

  // Fetch sources — they populate the optional source filter below.
  const { data: sources } = useQuery({
    queryKey: queryKeys.admin.sources,
    queryFn: getSources,
  });

  // Fetch experience counts when world view is selected
  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: queryKeys.admin.experienceCounts(selectedWorldView, selectedSource),
    queryFn: () => getExperienceCountsByRegion(selectedWorldView!, selectedSource || undefined),
    enabled: !!selectedWorldView,
  });

  // Start assignment mutation
  const startMutation = useMutation({
    mutationFn: () => startRegionAssignment(selectedWorldView!, selectedSource || undefined),
    onMutate: () => {
      statusGenerationRef.current += 1;
    },
    onSuccess: () => {
      followingRef.current = true;
      failingSinceRef.current = null;
      setRestarted(false);
      setLostTouch(false);
      setIsPolling(true);
    },
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelAssignment(selectedWorldView!),
  });

  // Poll for status
  const pollStatus = useCallback(async () => {
    if (!selectedWorldView) return;
    const generation = statusGenerationRef.current;

    try {
      const newStatus = await getAssignmentStatus(selectedWorldView);
      if (generation !== statusGenerationRef.current) return;
      failingSinceRef.current = null;
      setStatus(newStatus);

      if (newStatus.running) {
        followingRef.current = true;
        setIsPolling(true);
      } else {
        // A run that ended keeps its status until the next one starts, so a
        // bare answer right after one was going means the server holding it is gone.
        if (followingRef.current && newStatus.status === undefined) setRestarted(true);
        followingRef.current = false;
        setIsPolling(false);
        refetchCounts();
      }
    } catch (error) {
      if (generation !== statusGenerationRef.current) return;
      console.error('Error polling status:', error);
      // A refusal while a run is being followed is most likely the server
      // restarting: keep asking, and give up only after about two minutes.
      const now = Date.now();
      failingSinceRef.current ??= now;
      if (!followingRef.current || now - failingSinceRef.current >= LOST_TOUCH_AFTER_MS) {
        if (followingRef.current) {
          setLostTouch(true);
          // The last answer said running; nothing has answered since, so the
          // panel stops presenting a run it can no longer see.
          setStatus(s => s && { ...s, running: false });
        }
        followingRef.current = false;
        setIsPolling(false);
      }
    }
  }, [selectedWorldView, refetchCounts]);

  // Check initial status when world view changes
  useEffect(() => {
    if (selectedWorldView) {
      pollStatus();
    }
  }, [selectedWorldView, pollStatus]);

  // Polling interval
  useEffect(() => {
    if (!isPolling) return;

    const interval = setInterval(pollStatus, 1000);
    return () => clearInterval(interval);
  }, [isPolling, pollStatus]);

  const isRunning = status?.running || startMutation.isPending;
  const finished = !isRunning && status?.status !== undefined && status.status in FINISHED_SEVERITY
    ? status.status as keyof typeof FINISHED_SEVERITY
    : null;

  const chooseWorldView = (worldViewId: number) => {
    statusGenerationRef.current += 1;
    followingRef.current = false;
    failingSinceRef.current = null;
    setRestarted(false);
    setLostTouch(false);
    setSelectedWorldView(worldViewId);
  };

  // Filter to only custom world views (not GADM)
  const customWorldViews = worldViews?.filter(wv => !wv.isDefault) || [];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Region Assignment
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Assign experiences to regions based on spatial containment. A location is placed in the
        smallest regions whose outline holds it, and every region above those gets it from the tree;
        a larger region is tested directly only for a location no smaller region holds — so St
        Peter's is listed under Vatican City and Europe, not under Italy. A sync already places
        whatever moved during the run, so this is for the two cases it cannot settle by itself. The
        ordinary one is that regions changed — their boundaries, or where they sit in the tree — and
        every location has to be tested against them again. The other is that the placement at the
        end of a run failed — the run then reports itself Partial and says so, and this is what it is
        asking for. Either way it rebuilds this world view's automatic assignments in one go:
        regions keep their assignments until it finishes, and a stop or a restart leaves them as
        they were.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControl sx={{ minWidth: 250 }}>
              <InputLabel>World View</InputLabel>
              <Select
                value={selectedWorldView || ''}
                label="World View"
                onChange={(e) => chooseWorldView(e.target.value as number)}
                disabled={isRunning}
              >
                {customWorldViews.map((wv) => (
                  <MenuItem key={wv.id} value={wv.id}>
                    {wv.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 250 }}>
              <InputLabel>Source (optional)</InputLabel>
              <Select
                value={selectedSource || ''}
                label="Source (optional)"
                onChange={(e) => setSelectedSource(e.target.value as number || null)}
                disabled={isRunning}
              >
                <MenuItem value="">All Sources</MenuItem>
                {sources?.map((cat) => (
                  <MenuItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {isRunning && status && (
            <Box sx={{ mt: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">{status.statusMessage}</Typography>
              </Box>
              <LinearProgress />
              <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
                <Box>
                  <Typography variant="h5">{status.directAssignments || 0}</Typography>
                  <Typography variant="caption" color="text.secondary">Direct</Typography>
                </Box>
                <Box>
                  <Typography variant="h5">{status.ancestorAssignments || 0}</Typography>
                  <Typography variant="caption" color="text.secondary">Ancestor</Typography>
                </Box>
                <Box>
                  <Typography variant="h5">{status.totalAssignments || 0}</Typography>
                  <Typography variant="caption" color="text.secondary">Total</Typography>
                </Box>
              </Box>
            </Box>
          )}

          {finished && status?.statusMessage && (
            <Alert severity={FINISHED_SEVERITY[finished]} sx={{ mt: 2 }}>{status.statusMessage}</Alert>
          )}

          {restarted && !isRunning && (
            <Alert severity="warning" sx={{ mt: 2 }}>{RESTARTED_UNDER_IT}</Alert>
          )}

          {lostTouch && !isRunning && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Lost touch with the server — reload to see how this assignment ended.
            </Alert>
          )}

          {startMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              Failed to start assignment: {(startMutation.error as Error)?.message}
            </Alert>
          )}
        </CardContent>

        <CardActions>
          {!isRunning ? (
            <Button
              startIcon={<StartIcon />}
              onClick={() => startMutation.mutate()}
              disabled={!selectedWorldView || startMutation.isPending}
              variant="contained"
            >
              Start Assignment
            </Button>
          ) : (
            <Button
              startIcon={<StopIcon />}
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              color="warning"
            >
              Cancel
            </Button>
          )}
        </CardActions>
      </Card>

      {/* Experience counts by region */}
      {selectedWorldView && counts && counts.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>
            Experience Counts by Region
          </Typography>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Region</TableCell>
                  <TableCell align="right">Experiences</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {counts.slice(0, 20).map((row) => (
                  <TableRow key={row.regionId}>
                    <TableCell>{row.regionName}</TableCell>
                    <TableCell align="right">{row.count.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
                {counts.length > 20 && (
                  <TableRow>
                    <TableCell colSpan={2}>
                      <Typography variant="caption" color="text.secondary">
                        ... and {counts.length - 20} more regions
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}
