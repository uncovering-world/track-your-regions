/**
 * Drop-zone card for a single subdivision group used by ListViewTab.
 * Lifted out of the parent's .map so the inner setState callbacks
 * stay within the no-nested-functions threshold.
 */

import { Box, Chip, IconButton, Paper, TextField, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import type { RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import type { SubdivisionGroup } from './types';
import { removeMemberAtIndex, addMemberAtIndex } from './groupMutations';

interface GroupCardProps {
  group: SubdivisionGroup;
  groupIdx: number;
  unassignedDivisions: RegionMember[];
  subdivisionGroups: SubdivisionGroup[];
  dragOverGroupIdx: number | 'unassigned' | null;
  editingGroupIdx: number | null;
  editingGroupName: string;
  setDragOverGroupIdx: (idx: number | 'unassigned' | null) => void;
  setDraggingDivisionId: (id: number | null) => void;
  setEditingGroupIdx: (idx: number | null) => void;
  setEditingGroupName: (name: string) => void;
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
}

function findDivisionByKey(
  memberKey: string,
  unassignedDivisions: RegionMember[],
  subdivisionGroups: SubdivisionGroup[],
): RegionMember | undefined {
  const fromUnassigned = unassignedDivisions.find(m => getMemberKey(m) === memberKey);
  if (fromUnassigned) return fromUnassigned;
  for (const g of subdivisionGroups) {
    const found = g.members.find(m => getMemberKey(m) === memberKey);
    if (found) return found;
  }
  return undefined;
}

export function GroupCard({
  group,
  groupIdx,
  unassignedDivisions,
  subdivisionGroups,
  dragOverGroupIdx,
  editingGroupIdx,
  editingGroupName,
  setDragOverGroupIdx,
  setDraggingDivisionId,
  setEditingGroupIdx,
  setEditingGroupName,
  setSubdivisionGroups,
  setUnassignedDivisions,
}: GroupCardProps) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroupIdx(groupIdx);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const memberKey = e.dataTransfer.getData('text/plain');
    if (!memberKey) return;

    const div = findDivisionByKey(memberKey, unassignedDivisions, subdivisionGroups);
    if (!div) return;

    const currentGroupIdx = subdivisionGroups.findIndex(g =>
      g.members.some(m => getMemberKey(m) === memberKey),
    );

    if (currentGroupIdx >= 0) {
      setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
    } else {
      setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
    }

    setSubdivisionGroups(prev => addMemberAtIndex(prev, groupIdx, div));
    setDragOverGroupIdx(null);
    setDraggingDivisionId(null);
  };

  const commitRename = () => {
    if (editingGroupName.trim()) {
      setSubdivisionGroups(prev =>
        prev.map((g, i) => i === groupIdx ? { ...g, name: editingGroupName.trim() } : g),
      );
    }
    setEditingGroupIdx(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') setEditingGroupIdx(null);
  };

  const handleDelete = () => {
    setUnassignedDivisions(prev => [...prev, ...group.members]);
    setSubdivisionGroups(prev => prev.filter((_, i) => i !== groupIdx));
  };

  return (
    <Paper
      variant="outlined"
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOverGroupIdx(null)}
      onDrop={handleDrop}
      sx={{
        p: 1.5,
        minHeight: 80,
        borderWidth: 2,
        borderStyle: dragOverGroupIdx === groupIdx ? 'dashed' : 'solid',
        borderColor: dragOverGroupIdx === groupIdx ? 'primary.main' : 'divider',
        bgcolor: dragOverGroupIdx === groupIdx ? 'primary.light' : 'background.paper',
        transition: 'all 0.2s ease',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        {editingGroupIdx === groupIdx ? (
          <TextField
            size="small"
            value={editingGroupName}
            onChange={(e) => setEditingGroupName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            sx={{ flex: 1, mr: 1 }}
            inputProps={{ style: { fontSize: '0.875rem', fontWeight: 'bold' } }}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              onClick={() => {
                setEditingGroupIdx(groupIdx);
                setEditingGroupName(group.name);
              }}
              sx={{
                cursor: 'pointer',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {group.name}
            </Typography>
            {group.existingRegionId && (
              <Chip size="small" label="existing" variant="outlined" color="info" sx={{ height: 18, fontSize: '0.65rem' }} />
            )}
          </Box>
        )}
        <Box>
          <Chip size="small" label={`${group.members.length}`} sx={{ mr: 0.5 }} />
          {editingGroupIdx !== groupIdx && (
            <Tooltip title="Rename group">
              <IconButton
                size="small"
                onClick={() => {
                  setEditingGroupIdx(groupIdx);
                  setEditingGroupName(group.name);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={handleDelete}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      {group.members.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          Drop divisions here
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {group.members.map(m => m.name).slice(0, 3).join(', ')}
          {group.members.length > 3 && ` +${group.members.length - 3} more`}
        </Typography>
      )}
    </Paper>
  );
}
