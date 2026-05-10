import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Paper,
  List,
  IconButton,
  Tooltip,
  Button,
  Switch,
  FormControlLabel,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import type { Region, RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import type { SubdivisionGroup } from './types';
import { removeMemberAtIndex } from './groupMutations';
import { DivisionRow } from './DivisionRow';
import { GroupCard } from './GroupCard';

interface DivWithGroup { div: RegionMember; groupIdx: number | null }

interface ListViewTabProps {
  selectedRegion: Region | null;
  unassignedDivisions: RegionMember[];
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
  subdivisionGroups: SubdivisionGroup[];
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  draggingDivisionId: number | null;
  setDraggingDivisionId: (id: number | null) => void;
  dragOverGroupIdx: number | 'unassigned' | null;
  setDragOverGroupIdx: (idx: number | 'unassigned' | null) => void;
  editingGroupIdx: number | null;
  setEditingGroupIdx: (idx: number | null) => void;
  editingGroupName: string;
  setEditingGroupName: (name: string) => void;
  onPreviewDivision: (division: RegionMember) => void;
}

export function ListViewTab({
  selectedRegion,
  unassignedDivisions,
  setUnassignedDivisions,
  subdivisionGroups,
  setSubdivisionGroups,
  draggingDivisionId,
  setDraggingDivisionId,
  dragOverGroupIdx,
  setDragOverGroupIdx,
  editingGroupIdx,
  setEditingGroupIdx,
  editingGroupName,
  setEditingGroupName,
  onPreviewDivision,
}: ListViewTabProps) {
  const [multilineMode, setMultilineMode] = useState(false);
  const totalDivisions = unassignedDivisions.length + subdivisionGroups.reduce((sum, g) => sum + g.members.length, 0);

  const sortedDivisions: DivWithGroup[] = [
    ...unassignedDivisions.map(d => ({ div: d, groupIdx: null })),
    ...subdivisionGroups.flatMap((group, groupIdx) =>
      group.members.map(member => ({ div: member, groupIdx })),
    ),
  ].sort((a, b) => a.div.name.localeCompare(b.div.name));

  // Add single group from input
  const addSingleGroup = () => {
    const input = document.getElementById('new-group-name-input') as HTMLInputElement;
    if (!input) return;

    const name = input.value.trim();
    if (name && !subdivisionGroups.some(g => g.name === name)) {
      setSubdivisionGroups(prev => [...prev, { name, members: [] }]);
      input.value = '';
    }
  };

  // Add multiple groups from multiline input
  const addGroupsFromInput = () => {
    const input = document.getElementById('new-group-name-input') as HTMLTextAreaElement;
    if (!input) return;

    const lines = input.value.split('\n');
    const newGroups: string[] = [];

    for (const line of lines) {
      const name = line.trim();
      if (name && !subdivisionGroups.some(g => g.name === name) && !newGroups.includes(name)) {
        newGroups.push(name);
      }
    }

    if (newGroups.length > 0) {
      setSubdivisionGroups(prev => [
        ...prev,
        ...newGroups.map(name => ({ name, members: [] })),
      ]);
      input.value = '';
    }
  };

  return (
    <>
      {/* Add new group(s) */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-start' }}>
        {multilineMode ? (
          <TextField
            size="small"
            placeholder="Enter group names (one per line)&#10;e.g.:&#10;Ralik Chain&#10;Ratak Chain"
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            onKeyDown={(e) => {
              // Ctrl+Enter or Cmd+Enter to add groups
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addGroupsFromInput();
              }
            }}
            id="new-group-name-input"
            helperText="One group per line. Press Ctrl+Enter or click Add."
          />
        ) : (
          <TextField
            size="small"
            placeholder="New group name (e.g., Ralik Chain)"
            fullWidth
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSingleGroup();
              }
            }}
            onPaste={(e) => {
              // Check if pasted text contains newlines
              const pastedText = e.clipboardData.getData('text');
              if (pastedText.includes('\n')) {
                e.preventDefault();
                // Switch to multiline mode and set the pasted content
                setMultilineMode(true);
                // Use setTimeout to ensure the textarea is rendered before setting value
                setTimeout(() => {
                  const textarea = document.getElementById('new-group-name-input') as HTMLTextAreaElement;
                  if (textarea) {
                    textarea.value = pastedText;
                    textarea.focus();
                  }
                }, 0);
              }
            }}
            id="new-group-name-input"
          />
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
          <Button
            variant="outlined"
            onClick={multilineMode ? addGroupsFromInput : addSingleGroup}
            sx={{ minWidth: 100, height: multilineMode ? 56 : 40 }}
          >
            {multilineMode ? 'Add Groups' : 'Add'}
          </Button>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={multilineMode}
                onChange={(e) => setMultilineMode(e.target.checked)}
              />
            }
            label={<Typography variant="caption">Multiple</Typography>}
            sx={{ m: 0 }}
          />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, minHeight: 400 }}>
        {/* Left: Divisions list (draggable items) */}
        <Paper variant="outlined" sx={{ flex: 1, p: 1.5, overflow: 'auto' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2">
              Divisions ({totalDivisions})
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Copy all division paths to clipboard (full GADM hierarchy)">
                <IconButton
                  size="small"
                  onClick={() => {
                    const allDivisions = [
                      ...unassignedDivisions,
                      ...subdivisionGroups.flatMap(g => g.members)
                    ];
                    const basePath = selectedRegion?.name || '';
                    const paths = allDivisions
                      .map(d => {
                        if (!d?.name) return null;
                        if (d.path) {
                          return d.path;
                        }
                        return `${basePath} > ${d.name}`;
                      })
                      .filter(Boolean)
                      .join('\n');
                    navigator.clipboard.writeText(paths);
                  }}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Copy group paths to clipboard">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => {
                      const basePath = selectedRegion?.name || '';
                      const paths = subdivisionGroups
                        .map(g => `${basePath} > ${g.name}`)
                        .join('\n');
                      navigator.clipboard.writeText(paths);
                    }}
                    disabled={subdivisionGroups.length === 0}
                  >
                    <FolderCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Drag divisions to groups on the right →
          </Typography>

          {/* Division list - draggable */}
          <List dense>
            {sortedDivisions.map(({ div, groupIdx }) => (
              <DivisionRow
                key={getMemberKey(div)}
                div={div}
                groupIdx={groupIdx}
                draggingDivisionId={draggingDivisionId}
                subdivisionGroups={subdivisionGroups}
                setDraggingDivisionId={setDraggingDivisionId}
                setDragOverGroupIdx={setDragOverGroupIdx}
                setSubdivisionGroups={setSubdivisionGroups}
                setUnassignedDivisions={setUnassignedDivisions}
                onPreviewDivision={onPreviewDivision}
              />
            ))}
          </List>

          {totalDivisions === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              No divisions
            </Typography>
          )}
        </Paper>

        {/* Right: Drop zones (groups) */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle2">
            Drop Zones (Groups)
          </Typography>

          {subdivisionGroups.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', flex: 1 }}>
              <Typography color="text.secondary" variant="body2">
                Create groups using the field above, then drag divisions here
              </Typography>
            </Paper>
          ) : (
            <>
              {subdivisionGroups.map((group, groupIdx) => (
                <GroupCard
                  key={groupIdx}
                  group={group}
                  groupIdx={groupIdx}
                  unassignedDivisions={unassignedDivisions}
                  subdivisionGroups={subdivisionGroups}
                  dragOverGroupIdx={dragOverGroupIdx}
                  editingGroupIdx={editingGroupIdx}
                  editingGroupName={editingGroupName}
                  setDragOverGroupIdx={setDragOverGroupIdx}
                  setDraggingDivisionId={setDraggingDivisionId}
                  setEditingGroupIdx={setEditingGroupIdx}
                  setEditingGroupName={setEditingGroupName}
                  setSubdivisionGroups={setSubdivisionGroups}
                  setUnassignedDivisions={setUnassignedDivisions}
                />
              ))}
            </>
          )}

          {/* Unassigned drop zone */}
          <Paper
            variant="outlined"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverGroupIdx('unassigned');
            }}
            onDragLeave={() => setDragOverGroupIdx(null)}
            onDrop={(e) => {
              e.preventDefault();
              const memberKey = e.dataTransfer.getData('text/plain');
              if (!memberKey) return;

              let div: RegionMember | undefined;
              let currentGroupIdx = -1;
              for (let i = 0; i < subdivisionGroups.length; i++) {
                div = subdivisionGroups[i].members.find(m => getMemberKey(m) === memberKey);
                if (div) {
                  currentGroupIdx = i;
                  break;
                }
              }
              if (!div) return;

              if (currentGroupIdx >= 0) {
                setSubdivisionGroups(prev => removeMemberAtIndex(prev, currentGroupIdx, memberKey));
                setUnassignedDivisions(prev => [...prev, div!]);
              }

              setDragOverGroupIdx(null);
              setDraggingDivisionId(null);
            }}
            sx={{
              p: 1.5,
              mt: 'auto',
              borderWidth: 2,
              borderStyle: dragOverGroupIdx === 'unassigned' ? 'dashed' : 'solid',
              borderColor: dragOverGroupIdx === 'unassigned' ? 'warning.main' : 'divider',
              bgcolor: dragOverGroupIdx === 'unassigned' ? 'warning.light' : 'action.hover',
              transition: 'all 0.2s ease',
            }}
          >
            <Typography variant="body2" color="text.secondary">
              📥 Unassigned ({unassignedDivisions.length})
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Drop here to remove from group
            </Typography>
          </Paper>
        </Box>
      </Box>
    </>
  );
}
