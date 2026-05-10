/**
 * Single draggable division row used by ListViewTab.
 * Lifted out of the parent's IIFE so the inner setState callbacks
 * stay within the no-nested-functions threshold.
 */

import { Box, IconButton, ListItem, ListItemText, Tooltip } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import type { RegionMember } from '../../../../../types';
import { getMemberKey } from '../../../types';
import type { SubdivisionGroup } from './types';
import { removeMemberAtIndex, addMemberAtIndex } from './groupMutations';

interface DivisionRowProps {
  div: RegionMember;
  groupIdx: number | null;
  draggingDivisionId: number | null;
  subdivisionGroups: SubdivisionGroup[];
  setDraggingDivisionId: (id: number | null) => void;
  setDragOverGroupIdx: (idx: number | 'unassigned' | null) => void;
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
  setUnassignedDivisions: React.Dispatch<React.SetStateAction<RegionMember[]>>;
  onPreviewDivision: (division: RegionMember) => void;
}

function buildLabel(div: RegionMember): string {
  const pathParts = div.path?.split(' > ') || [];
  const parentName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : null;
  return parentName ? `${div.name} (${parentName})` : div.name;
}

export function DivisionRow({
  div,
  groupIdx,
  draggingDivisionId,
  subdivisionGroups,
  setDraggingDivisionId,
  setDragOverGroupIdx,
  setSubdivisionGroups,
  setUnassignedDivisions,
  onPreviewDivision,
}: DivisionRowProps) {
  const memberKey = getMemberKey(div);

  const handleDragStart = (e: React.DragEvent) => {
    setDraggingDivisionId(div.memberRowId || div.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', memberKey);
  };

  const handleDragEnd = () => {
    setDraggingDivisionId(null);
    setDragOverGroupIdx(null);
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newGroupIdx = e.target.value === '' ? null : parseInt(e.target.value);
    if (groupIdx !== null) {
      setSubdivisionGroups(prev => removeMemberAtIndex(prev, groupIdx, memberKey));
    } else {
      setUnassignedDivisions(prev => prev.filter(d => getMemberKey(d) !== memberKey));
    }
    if (newGroupIdx !== null) {
      setSubdivisionGroups(prev => addMemberAtIndex(prev, newGroupIdx, div));
    } else {
      setUnassignedDivisions(prev => [...prev, div]);
    }
  };

  return (
    <ListItem
      key={memberKey}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      sx={{
        py: 0.5,
        px: 1,
        mb: 0.5,
        borderRadius: 1,
        cursor: 'grab',
        border: '1px solid',
        borderColor: draggingDivisionId === (div.memberRowId || div.id) ? 'primary.main' : 'divider',
        bgcolor: groupIdx !== null ? 'action.selected' : 'background.paper',
        opacity: draggingDivisionId === (div.memberRowId || div.id) ? 0.5 : 1,
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
            onChange={handleSelectChange}
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
        primary={buildLabel(div)}
        primaryTypographyProps={{ variant: 'body2' }}
      />
    </ListItem>
  );
}
