/**
 * Assignment Panel
 *
 * Controls for assigning experiences to regions based on spatial containment.
 */

import { useState, useEffect, useCallback } from 'react';
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
  getCategories,
  startRegionAssignment,
  getAssignmentStatus,
  cancelAssignment,
  getExperienceCountsByRegion,
  type AssignmentStatus,
} from '../../api/admin';
import { fetchWorldViews } from '../../api/worldViews';

export function AssignmentPanel() {
  const [selectedWorldView, setSelectedWorldView] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [status, setStatus] = useState<AssignmentStatus | null>(null);

  // Fetch world views
  const { data: worldViews } = useQuery({
    queryKey: ['worldViews'],
    queryFn: fetchWorldViews,
  });

  // Fetch categories (to check if assignment is needed)
  const { data: categories, refetch: refetchCategories } = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: getCategories,
  });

  // Check if any category needs assignment
  const needsAssignment = categories?.some(s => s.assignment_needed);

  // Fetch experience counts when world view is selected
  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: ['admin', 'experienceCounts', selectedWorldView, selectedCategory],
    queryFn: () => getExperienceCountsByRegion(selectedWorldView!, selectedCategory || undefined),
    enabled: !!selectedWorldView,
  });

  // Start assignment mutation
  const startMutation = useMutation({
    mutationFn: () => startRegionAssignment(selectedWorldView!, selectedCategory || undefined),
    onSuccess: () => {
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

    try {
      const newStatus = await getAssignmentStatus(selectedWorldView);
      setStatus(newStatus);

      if (!newStatus.running) {
        setIsPolling(false);
        refetchCounts();
        // Refresh sources to update assignment_needed flag
        refetchCategories();
      }
    } catch (error) {
      console.error('Error polling status:', error);
      setIsPolling(false);
    }
  }, [selectedWorldView, refetchCounts, refetchCategories]);

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

  // Filter to only custom world views (not GADM)
  const customWorldViews = worldViews?.filter(wv => !wv.isDefault) || [];

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Region Assignment
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Assign experiences to regions based on spatial containment. Experiences are assigned to
        regions that contain their location point, and the assignment is propagated to ancestor regions.
      </Typography>

      {needsAssignment && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <strong>Assignment needed!</strong> Experiences were synced since the last region assignment.
          Select a world view and run assignment to update region assignments.
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControl sx={{ minWidth: 250 }}>
              <InputLabel>World View</InputLabel>
              <Select
                value={selectedWorldView || ''}
                label="World View"
                onChange={(e) => setSelectedWorldView(e.target.value as number)}
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
              <InputLabel>Category (optional)</InputLabel>
              <Select
                value={selectedCategory || ''}
                label="Category (optional)"
                onChange={(e) => setSelectedCategory(e.target.value as number || null)}
                disabled={isRunning}
              >
                <MenuItem value="">All Categories</MenuItem>
                {categories?.map((cat) => (
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
