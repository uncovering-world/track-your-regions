/**
 * Curator Panel
 *
 * Admin panel for managing curator assignments.
 * Lists existing curators with their scopes, allows promoting users,
 * revoking assignments, and viewing activity logs.
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Avatar,
  Chip,
  IconButton,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Autocomplete,
  Collapse,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  History as HistoryIcon,
  PersonAdd as PersonAddIcon,
  Public as PublicIcon,
  Map as MapIcon,
  Category as CategoryIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listCurators,
  createCuratorAssignment,
  revokeCuratorAssignment,
  getCuratorActivity,
  searchUsers,
  getCategories,
} from '../../api/admin';
import { fetchWorldViews } from '../../api/worldViews';
import { searchRegions, type RegionSearchResult } from '../../api/regions';
import type { CuratorInfo, CuratorScope, CuratorActivityEntry } from '../../api/admin';
import { formatDateTime } from '../../utils/dateFormat';
import { LoadingSpinner } from '../shared/LoadingSpinner';

// =============================================================================
// Main Panel
// =============================================================================

export function CuratorPanel() {
  const queryClient = useQueryClient();
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [activityUserId, setActivityUserId] = useState<number | null>(null);

  const { data: curators, isLoading } = useQuery({
    queryKey: ['admin', 'curators'],
    queryFn: listCurators,
  });

  const revokeMutation = useMutation({
    mutationFn: (assignmentId: number) => revokeCuratorAssignment(assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'curators'] });
    },
  });

  if (isLoading) {
    return <LoadingSpinner padding="16px 0" />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">Curator Management</Typography>
        <Button
          variant="contained"
          startIcon={<PersonAddIcon />}
          onClick={() => setAddFormOpen(true)}
        >
          Add Curator
        </Button>
      </Box>

      {curators?.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No curators assigned yet. Click "Add Curator" to promote a user.
        </Alert>
      )}

      {/* Curator Cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {curators?.map((curator) => (
          <CuratorCard
            key={curator.user_id}
            curator={curator}
            onRevoke={(assignmentId) => revokeMutation.mutate(assignmentId)}
            onViewActivity={(userId) => setActivityUserId(userId)}
            isRevoking={revokeMutation.isPending}
          />
        ))}
      </Box>

      {/* Add Curator Dialog */}
      <AddCuratorDialog
        open={addFormOpen}
        onClose={() => setAddFormOpen(false)}
      />

      {/* Activity Log Dialog */}
      <ActivityDialog
        userId={activityUserId}
        onClose={() => setActivityUserId(null)}
      />
    </Box>
  );
}

// =============================================================================
// Curator Card
// =============================================================================

function CuratorCard({
  curator,
  onRevoke,
  onViewActivity,
  isRevoking,
}: {
  curator: CuratorInfo;
  onRevoke: (assignmentId: number) => void;
  onViewActivity: (userId: number) => void;
  isRevoking: boolean;
}) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Avatar
            src={curator.avatar_url ?? undefined}
            sx={{ width: 48, height: 48 }}
          >
            {(curator.display_name || curator.email || '?')[0].toUpperCase()}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {curator.display_name || curator.email || `User #${curator.user_id}`}
              </Typography>
              <Chip
                label={curator.role}
                size="small"
                color={curator.role === 'admin' ? 'error' : 'primary'}
                variant="outlined"
              />
            </Box>

            {curator.email && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {curator.email}
              </Typography>
            )}

            {/* Scopes */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {curator.scopes.map((scope) => (
                <ScopeChip
                  key={scope.id}
                  scope={scope}
                  onDelete={() => onRevoke(scope.id)}
                  disabled={isRevoking}
                />
              ))}
            </Box>
          </Box>

          <Tooltip title="View Activity">
            <IconButton onClick={() => onViewActivity(curator.user_id)} size="small">
              <HistoryIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Scope Chip
// =============================================================================

function ScopeChip({
  scope,
  onDelete,
  disabled,
}: {
  scope: CuratorScope;
  onDelete: () => void;
  disabled: boolean;
}) {
  const icon =
    scope.scopeType === 'global' ? <PublicIcon /> :
    scope.scopeType === 'region' ? <MapIcon /> :
    <CategoryIcon />;

  const label =
    scope.scopeType === 'global' ? 'Global' :
    scope.scopeType === 'region' ? scope.regionName || `Region #${scope.regionId}` :
    scope.categoryName || `Category #${scope.categoryId}`;

  return (
    <Chip
      icon={icon}
      label={label}
      onDelete={onDelete}
      deleteIcon={
        <Tooltip title="Revoke this scope">
          <DeleteIcon fontSize="small" />
        </Tooltip>
      }
      disabled={disabled}
      size="small"
      variant="outlined"
      color={scope.scopeType === 'global' ? 'warning' : 'default'}
      sx={{ '& .MuiChip-label': { maxWidth: 200 } }}
    />
  );
}

// =============================================================================
// Add Curator Dialog
// =============================================================================

function AddCuratorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();

  // User search
  const [userQuery, setUserQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<{
    id: number;
    display_name: string | null;
    email: string | null;
    role: string;
  } | null>(null);

  // Scope
  const [scopeType, setScopeType] = useState<'region' | 'category' | 'global'>('region');
  const [selectedRegion, setSelectedRegion] = useState<RegionSearchResult | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  // Region search
  const [regionQuery, setRegionQuery] = useState('');
  const [selectedWorldViewId, setSelectedWorldViewId] = useState<number | null>(null);

  // Queries
  const { data: userResults, isFetching: isSearchingUsers } = useQuery({
    queryKey: ['admin', 'userSearch', userQuery],
    queryFn: () => searchUsers(userQuery),
    enabled: userQuery.length >= 2,
  });

  const { data: worldViews } = useQuery({
    queryKey: ['worldViews'],
    queryFn: fetchWorldViews,
    enabled: open && scopeType === 'region',
  });

  const { data: regionResults, isFetching: isSearchingRegions } = useQuery({
    queryKey: ['admin', 'regionSearch', selectedWorldViewId, regionQuery],
    queryFn: () => searchRegions(selectedWorldViewId!, regionQuery),
    enabled: !!selectedWorldViewId && regionQuery.length >= 2,
  });

  const { data: sources } = useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: getCategories,
    enabled: open && scopeType === 'category',
  });

  const createMutation = useMutation({
    mutationFn: createCuratorAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'curators'] });
      handleClose();
    },
  });

  const handleClose = useCallback(() => {
    setUserQuery('');
    setSelectedUser(null);
    setScopeType('region');
    setSelectedRegion(null);
    setSelectedSourceId(null);
    setNotes('');
    setRegionQuery('');
    setSelectedWorldViewId(null);
    onClose();
  }, [onClose]);

  const handleSubmit = () => {
    if (!selectedUser) return;

    createMutation.mutate({
      userId: selectedUser.id,
      scopeType,
      regionId: scopeType === 'region' ? selectedRegion?.id : undefined,
      categoryId: scopeType === 'category' ? selectedSourceId ?? undefined : undefined,
      notes: notes || undefined,
    });
  };

  const canSubmit =
    selectedUser &&
    (scopeType === 'global' ||
      (scopeType === 'region' && selectedRegion) ||
      (scopeType === 'category' && selectedSourceId));

  // Auto-select first world view
  if (worldViews?.length && !selectedWorldViewId) {
    const custom = worldViews.find((wv) => !(wv as { isDefault?: boolean }).isDefault);
    setSelectedWorldViewId(custom?.id ?? worldViews[0].id);
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Curator Assignment</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* User Search */}
          <Autocomplete
            options={userResults ?? []}
            getOptionLabel={(opt) => opt.display_name || opt.email || `User #${opt.id}`}
            value={selectedUser}
            onChange={(_, value) => setSelectedUser(value)}
            onInputChange={(_, value) => setUserQuery(value)}
            loading={isSearchingUsers}
            renderOption={(props, opt) => (
              <li {...props} key={opt.id}>
                <Box>
                  <Typography variant="body2">{opt.display_name || 'No name'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {opt.email} — {opt.role}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Search User"
                placeholder="Type name or email..."
                required
              />
            )}
          />

          {/* Scope Type */}
          <FormControl fullWidth>
            <InputLabel>Scope Type</InputLabel>
            <Select
              value={scopeType}
              label="Scope Type"
              onChange={(e) => {
                setScopeType(e.target.value as 'region' | 'category' | 'global');
                setSelectedRegion(null);
                setSelectedSourceId(null);
              }}
            >
              <MenuItem value="region">Region</MenuItem>
              <MenuItem value="category">Category</MenuItem>
              <MenuItem value="global">Global</MenuItem>
            </Select>
          </FormControl>

          {/* Region Scope: World View + Region Search */}
          {scopeType === 'region' && (
            <>
              {worldViews && worldViews.length > 1 && (
                <FormControl fullWidth size="small">
                  <InputLabel>World View</InputLabel>
                  <Select
                    value={selectedWorldViewId ?? ''}
                    label="World View"
                    onChange={(e) => {
                      setSelectedWorldViewId(Number(e.target.value));
                      setSelectedRegion(null);
                      setRegionQuery('');
                    }}
                  >
                    {worldViews.map((wv) => (
                      <MenuItem key={wv.id} value={wv.id}>
                        {wv.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <Autocomplete
                options={regionResults ?? []}
                getOptionLabel={(opt) => opt.path || opt.name}
                value={selectedRegion}
                onChange={(_, value) => setSelectedRegion(value)}
                onInputChange={(_, value) => setRegionQuery(value)}
                loading={isSearchingRegions}
                disabled={!selectedWorldViewId}
                renderOption={(props, opt) => (
                  <li {...props} key={opt.id}>
                    <Box>
                      <Typography variant="body2">{opt.name}</Typography>
                      {opt.path && opt.path !== opt.name && (
                        <Typography variant="caption" color="text.secondary">
                          {opt.path}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Search Region"
                    placeholder="Type region name..."
                    required
                  />
                )}
              />
            </>
          )}

          {/* Source Scope: Source Dropdown */}
          {scopeType === 'category' && (
            <FormControl fullWidth>
              <InputLabel>Experience Source</InputLabel>
              <Select
                value={selectedSourceId ?? ''}
                label="Experience Source"
                onChange={(e) => setSelectedSourceId(Number(e.target.value))}
              >
                {sources?.map((src) => (
                  <MenuItem key={src.id} value={src.id}>
                    {src.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Global Scope Warning */}
          {scopeType === 'global' && (
            <Alert severity="warning">
              Global scope grants curation rights over all experiences in the system.
            </Alert>
          )}

          {/* Notes */}
          <TextField
            label="Notes (optional)"
            placeholder="Reason for this assignment..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={2}
          />

          {createMutation.isError && (
            <Alert severity="error">
              {(createMutation.error as Error).message || 'Failed to create assignment'}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit || createMutation.isPending}
        >
          {createMutation.isPending ? 'Assigning...' : 'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Activity Dialog
// =============================================================================

function ActivityDialog({
  userId,
  onClose,
}: {
  userId: number | null;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'curatorActivity', userId],
    queryFn: () => getCuratorActivity(userId!),
    enabled: !!userId,
  });

  return (
    <Dialog open={!!userId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Curator Activity Log</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <LoadingSpinner size={24} padding="12px 0" />
        ) : !data?.activity.length ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No curation activity recorded yet.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Action</TableCell>
                <TableCell>Experience</TableCell>
                <TableCell>Region</TableCell>
                <TableCell>Date</TableCell>
                <TableCell width={40} />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.activity.map((entry) => (
                <ActivityRow
                  key={entry.id}
                  entry={entry}
                  expanded={expanded === entry.id}
                  onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Activity Row
// =============================================================================

function ActivityRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: CuratorActivityEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const actionColors: Record<string, 'error' | 'success' | 'info' | 'warning' | 'default'> = {
    rejected: 'error',
    unrejected: 'success',
    created: 'success',
    edited: 'info',
    added_to_region: 'info',
    removed_from_region: 'warning',
  };

  return (
    <>
      <TableRow hover>
        <TableCell>
          <Chip
            label={entry.action.replace(/_/g, ' ')}
            size="small"
            color={actionColors[entry.action] || 'default'}
            variant="outlined"
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
        <TableCell>
          <Typography variant="caption">
            {formatDateTime(entry.created_at)}
          </Typography>
        </TableCell>
        <TableCell>
          {entry.details && (
            <IconButton size="small" onClick={onToggle}>
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          )}
        </TableCell>
      </TableRow>
      {entry.details && (
        <TableRow>
          <TableCell colSpan={5} sx={{ py: 0, borderBottom: expanded ? undefined : 'none' }}>
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
