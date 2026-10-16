/**
 * Curator Panel
 *
 * Admin panel for managing curator assignments.
 * Lists existing curators with their scopes, allows promoting users,
 * revoking assignments, and viewing activity logs.
 */

import { useState, useCallback, type JSX } from 'react';
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
  Autocomplete,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PublicIcon from '@mui/icons-material/Public';
import MapIcon from '@mui/icons-material/Map';
import SourceIcon from '@mui/icons-material/Source';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listCurators,
  createCuratorAssignment,
  revokeCuratorAssignment,
  getCuratorActivity,
  searchUsers,
  getSources,
} from '../../api/admin';
import type { RegionSearchResult } from '../../api/regions';
import type { CuratorInfo, CuratorScope } from '../../api/admin';
import { CurationActivityTable } from './CurationActivityTable';
import { RegionSearchPicker } from './RegionSearchPicker';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { displayNameOf } from '../../utils/displayName';
import { queryKeys } from '../../api/queryKeys';

// =============================================================================
// Main Panel
// =============================================================================

export function CuratorPanel() {
  const queryClient = useQueryClient();
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [activityUserId, setActivityUserId] = useState<number | null>(null);

  const { data: curators, isLoading } = useQuery({
    queryKey: queryKeys.admin.curators,
    queryFn: listCurators,
  });

  const revokeMutation = useMutation({
    mutationFn: (assignmentId: number) => revokeCuratorAssignment(assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.curators });
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

      {/* The viewing admin is always a row here (#905), so "no rows" can no
          longer happen; "nobody holds an assignment" is the state the hint
          to promote someone is for. */}
      {curators?.every((curator) => curator.scopes.length === 0) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No scopes assigned yet. Click "Add Curator" to promote a user.
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
            {(displayNameOf(curator.display_name) || curator.email || '?')[0].toUpperCase()}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {displayNameOf(curator.display_name) || curator.email || `User #${curator.user_id}`}
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
              {curator.role === 'admin' && (
                <Chip
                  icon={<PublicIcon />}
                  label="Global, by role"
                  size="small"
                  variant="outlined"
                  color="warning"
                />
              )}
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
  let icon: JSX.Element = <SourceIcon />;
  if (scope.scopeType === 'global') icon = <PublicIcon />;
  else if (scope.scopeType === 'region') icon = <MapIcon />;

  let label: string;
  if (scope.scopeType === 'global') label = 'Global';
  else if (scope.scopeType === 'region') label = scope.regionName || `Region #${scope.regionId}`;
  else label = scope.sourceName || `Source #${scope.sourceId}`;

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
  const [scopeType, setScopeType] = useState<'region' | 'source' | 'global'>('region');
  const [selectedRegion, setSelectedRegion] = useState<RegionSearchResult | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  // Queries
  const { data: userResults, isFetching: isSearchingUsers } = useQuery({
    queryKey: queryKeys.admin.userSearch(userQuery),
    queryFn: () => searchUsers(userQuery),
    enabled: userQuery.length >= 2,
  });

  const { data: sources } = useQuery({
    queryKey: queryKeys.admin.sources,
    queryFn: getSources,
    enabled: open && scopeType === 'source',
  });

  const createMutation = useMutation({
    mutationFn: createCuratorAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.curators });
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
    onClose();
  }, [onClose]);

  const handleSubmit = () => {
    if (!selectedUser) return;

    createMutation.mutate({
      userId: selectedUser.id,
      scopeType,
      regionId: scopeType === 'region' ? selectedRegion?.id : undefined,
      sourceId: scopeType === 'source' ? selectedSourceId ?? undefined : undefined,
      notes: notes || undefined,
    });
  };

  const canSubmit =
    selectedUser &&
    (scopeType === 'global' ||
      (scopeType === 'region' && selectedRegion) ||
      (scopeType === 'source' && selectedSourceId));

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Curator Assignment</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* User Search */}
          <Autocomplete
            options={userResults ?? []}
            getOptionLabel={(opt) => displayNameOf(opt.display_name) || opt.email || `User #${opt.id}`}
            value={selectedUser}
            onChange={(_, value) => setSelectedUser(value)}
            onInputChange={(_, value) => setUserQuery(value)}
            loading={isSearchingUsers}
            renderOption={(props, opt) => (
              <li {...props} key={opt.id}>
                <Box>
                  <Typography variant="body2">{displayNameOf(opt.display_name) ?? 'No name'}</Typography>
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
                setScopeType(e.target.value as 'region' | 'source' | 'global');
                setSelectedRegion(null);
                setSelectedSourceId(null);
              }}
            >
              <MenuItem value="region">Region</MenuItem>
              <MenuItem value="source">Source</MenuItem>
              <MenuItem value="global">Global</MenuItem>
            </Select>
          </FormControl>

          {/* Region Scope: World View + Region Search */}
          {scopeType === 'region' && (
            <RegionSearchPicker value={selectedRegion} onChange={setSelectedRegion} required />
          )}

          {/* Source Scope: Source Dropdown */}
          {scopeType === 'source' && (
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
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.curatorActivity(userId),
    queryFn: () => getCuratorActivity(userId!),
    enabled: !!userId,
  });

  return (
    <Dialog open={!!userId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Curator Activity Log</DialogTitle>
      <DialogContent>
        {isLoading && <LoadingSpinner size={24} padding="12px 0" />}
        {!isLoading && !data?.activity.length && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No curation activity recorded yet.
          </Typography>
        )}
        {!isLoading && data?.activity.length ? <CurationActivityTable activity={data.activity} /> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
