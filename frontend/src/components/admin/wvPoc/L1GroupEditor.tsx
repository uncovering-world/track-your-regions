import { useState, useMemo, useEffect, useRef } from 'react';
import { Box, Paper, Typography, TextField, Button, Chip, Stack, Autocomplete, Alert, Tooltip } from '@mui/material';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import {
  buildInitialGroups,
  createCustomGroup,
  assignToGroup,
  removeFromGroup,
  groupMemberIds,
  transcontinentalSplits,
  groupMembersView,
  type GroupingState,
} from './wvPocGroups';

/**
 * POC L1 editor: arrange countries into supra-national groups with overlapping membership,
 * and show transcontinental countries (one pivot) split across super-regions as labelled
 * parts. Client-side local state — no persistence.
 */
export function L1GroupEditor({ units }: { units: DashboardUnit[] }) {
  const sig = useMemo(() => units.map((u) => u.regionId).sort((a, b) => a - b).join(','), [units]);
  const [state, setState] = useState<GroupingState>(() => buildInitialGroups(units));
  const seededSig = useRef(sig);
  useEffect(() => {
    // Re-seed only when the underlying country set actually changes (POC: loads once).
    if (seededSig.current !== sig) {
      seededSig.current = sig;
      setState(buildInitialGroups(units));
    }
  }, [sig, units]);

  const [newName, setNewName] = useState('');
  const splits = useMemo(() => transcontinentalSplits(units, state), [units, state]);

  const addGroup = () => {
    const name = newName.trim();
    if (!name) return;
    setState((s) => createCustomGroup(s, name));
    setNewName('');
  };

  const addMember = (regionId: number, groupId: string) =>
    setState((s) => assignToGroup(s, regionId, groupId));
  const removeMember = (regionId: number, groupId: string) =>
    setState((s) => removeFromGroup(s, regionId, groupId));

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Supra-national — arrange countries into groups. Membership overlaps: a country can be in its
        continent <em>and</em> a custom group.
      </Typography>

      {splits.length > 0 && (
        <Alert severity="info" icon={false} sx={{ mb: 2 }}>
          {splits.map((t) => {
            const note = t.parts.find((p) => p.note)?.note;
            return (
              <Box key={t.regionId} component="div">
                <strong>{t.name}</strong> — one country, its territory shown as{' '}
                {t.parts.map((p) => p.label).join(' & ')}
                {note ? ` · ${note}` : ''}
              </Box>
            );
          })}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="New supra-national group"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addGroup();
          }}
        />
        <Button variant="contained" onClick={addGroup} disabled={!newName.trim()}>
          Add group
        </Button>
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
        {state.groups.map((g) => {
          const members = groupMembersView(units, state, g.id);
          const memberIds = new Set(groupMemberIds(state, g.id));
          const candidates = units.filter((u) => !memberIds.has(u.regionId));
          return (
            <Paper key={g.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {g.name}
                </Typography>
                <Chip
                  size="small"
                  label={g.kind}
                  color={g.kind === 'custom' ? 'secondary' : 'default'}
                  variant="outlined"
                />
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {members.length}
                </Typography>
              </Stack>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1, minHeight: 32 }}>
                {members.map((m) => (
                  <Tooltip key={m.regionId} title={m.note ?? (m.overlapping ? 'Also in another group' : '')}>
                    <Chip
                      size="small"
                      label={m.name}
                      color={m.transcontinental ? 'secondary' : 'default'}
                      variant={m.transcontinental ? 'filled' : 'outlined'}
                      onDelete={memberIds.has(m.regionId) ? () => removeMember(m.regionId, g.id) : undefined}
                    />
                  </Tooltip>
                ))}
                {members.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    No countries yet
                  </Typography>
                )}
              </Box>

              <Autocomplete
                size="small"
                options={candidates}
                getOptionLabel={(u) => u.name}
                value={null}
                onChange={(_, u) => {
                  if (u) addMember(u.regionId, g.id);
                }}
                renderInput={(params) => <TextField {...params} label="Add country" placeholder="Search…" />}
                blurOnSelect
              />
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
}
