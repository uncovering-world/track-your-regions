import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Paper,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Tooltip,
  Chip,
  Button,
  Switch,
  FormControlLabel,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MapIcon from '@mui/icons-material/Map';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderCopyIcon from '@mui/icons-material/FolderCopy';
import type { Region, RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import type { SubdivisionGroup } from './types';

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
            {(() => {
              const allDivs: { div: RegionMember; groupIdx: number | null }[] = [
                ...unassignedDivisions.map(div => ({ div, groupIdx: null })),
                ...subdivisionGroups.flatMap((group, groupIdx) =>
                  group.members.map(member => ({ div: member, groupIdx }))
                ),
              ];

              allDivs.sort((a, b) => a.div.name.localeCompare(b.div.name));

              return allDivs.map(({ div, groupIdx }) => {
                const memberKey = getMemberKey(div);
                return (
                  <ListItem
                    key={memberKey}
                    draggable
                    onDragStart={(e) => {
                      setDraggingDivisionId(div.memberRowId || div.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', memberKey);
                    }}
                    onDragEnd={() => {
                      setDraggingDivisionId(null);
                      setDragOverGroupIdx(null);
                    }}
                    sx={{
                      py: 0.5,
                      px: 1,
                      mb: 0.5,
                      borderRadius: 1,
                      cursor: 'grab',
                      border: '1px solid',
                      borderColor: draggingDivisionId === (div.memberRowId || div.id) ? 'primary.main' : 'divider',
                      bgcolor: groupIdx !== null ? 'action.selected' : 'background.paper',
                      opacity: draggingDivisionId === div.id ? 0.5 : 1,
                      '&:hover': {
                        bgcolor: 'action.hover',
                      },
                      '&:active': {
                        cursor: 'grabbing',
                      },
                    }}
                    secondaryAction={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Tooltip title="Preview on map">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreviewDivision(div);
                            }}
                          >
                            <MapIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <select
                          value={groupIdx ?? ''}
                          onChange={(e) => {
                            const newGroupIdx = e.target.value === '' ? null : parseInt(e.target.value);
                            const currentMemberKey = getMemberKey(div);

                            if (groupIdx !== null) {
                              setSubdivisionGroups(prev => prev.map((g, i) =>
                                i === groupIdx
                                  ? { ...g, members: g.members.filter(m => getMemberKey(m) !== currentMemberKey) }
                                  : g
                              ));
                            } else {
                              setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== currentMemberKey));
                            }

                            if (newGroupIdx !== null) {
                              setSubdivisionGroups(prev => prev.map((g, i) =>
                                i === newGroupIdx
                                  ? { ...g, members: [...g.members, div] }
                                  : g
                              ));
                            } else {
                              setUnassignedDivisions(prev => [...prev, div]);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: '11px',
                            padding: '2px 4px',
                            borderRadius: '4px',
                            border: '1px solid #ccc',
                            backgroundColor: groupIdx !== null ? '#e3f2fd' : '#fff',
                            minWidth: '120px',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">Unassigned</option>
                          {subdivisionGroups.map((group, idx) => (
                            <option key={idx} value={idx}>
                              → {group.name}
                            </option>
                          ))}
                        </select>
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={
                        (() => {
                          const pathParts = div.path?.split(' > ') || [];
                          const parentName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : null;
                          return parentName ? `${div.name} (${parentName})` : div.name;
                        })()
                      }
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                );
              });
            })()}
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
                <Paper
                  key={groupIdx}
                  variant="outlined"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverGroupIdx(groupIdx);
                  }}
                  onDragLeave={() => setDragOverGroupIdx(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const memberKey = e.dataTransfer.getData('text/plain');
                    if (!memberKey) return;

                    let div = unassignedDivisions.find(m => getMemberKey(m) === memberKey);
                    if (!div) {
                      for (const g of subdivisionGroups) {
                        div = g.members.find(m => getMemberKey(m) === memberKey);
                        if (div) break;
                      }
                    }
                    if (!div) return;

                    const currentGroupIdx = subdivisionGroups.findIndex(g =>
                      g.members.some(m => getMemberKey(m) === memberKey)
                    );

                    if (currentGroupIdx >= 0) {
                      setSubdivisionGroups(prev => prev.map((g, i) =>
                        i === currentGroupIdx
                          ? { ...g, members: g.members.filter(m => getMemberKey(m) !== memberKey) }
                          : g
                      ));
                    } else {
                      setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
                    }

                    setSubdivisionGroups(prev => prev.map((g, i) =>
                      i === groupIdx
                        ? { ...g, members: [...g.members, div!] }
                        : g
                    ));

                    setDragOverGroupIdx(null);
                    setDraggingDivisionId(null);
                  }}
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
                        onBlur={() => {
                          if (editingGroupName.trim()) {
                            setSubdivisionGroups(prev => prev.map((g, i) =>
                              i === groupIdx ? { ...g, name: editingGroupName.trim() } : g
                            ));
                          }
                          setEditingGroupIdx(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (editingGroupName.trim()) {
                              setSubdivisionGroups(prev => prev.map((g, i) =>
                                i === groupIdx ? { ...g, name: editingGroupName.trim() } : g
                              ));
                            }
                            setEditingGroupIdx(null);
                          } else if (e.key === 'Escape') {
                            setEditingGroupIdx(null);
                          }
                        }}
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
                      <IconButton
                        size="small"
                        onClick={() => {
                          setUnassignedDivisions(prev => [...prev, ...group.members]);
                          setSubdivisionGroups(prev => prev.filter((_, i) => i !== groupIdx));
                        }}
                      >
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
                setSubdivisionGroups(prev => prev.map((g, i) =>
                  i === currentGroupIdx
                    ? { ...g, members: g.members.filter(m => getMemberKey(m) !== memberKey) }
                    : g
                ));
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
