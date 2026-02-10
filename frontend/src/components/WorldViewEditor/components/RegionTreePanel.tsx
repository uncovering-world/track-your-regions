import { useState, useCallback, useEffect } from 'react';
import {
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  Typography,
  Box,
  Chip,
  Divider,
  TextField,
  Tooltip,
  CircularProgress,
  Collapse,
  Popover,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DrawIcon from '@mui/icons-material/Draw';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlaceIcon from '@mui/icons-material/Place';
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Region, RegionMember } from '../../../types';
import { useAppTheme } from '../../../theme';

// ─── Props ──────────────────────────────────────────────────────────

export interface RegionTreePanelProps {
  regions: Region[];
  regionsLoading: boolean;
  selectedRegion: Region | null;
  onSelectRegion: (region: Region | null) => void;
  regionMembers: RegionMember[];
  membersLoading: boolean;
  inheritParentColor: boolean;
  onInheritParentColorChange: (value: boolean) => void;
  onCreateRegion: (data: { name: string; color: string; parentRegionId?: number }) => void;
  createRegionPending: boolean;
  onEditRegion: (region: Region) => void;
  onDeleteRegion: (region: Region) => void;
  onMoveRegion: (regionId: number, newParentId: number | null) => void;
  // Division leaf selection
  selectedMember: RegionMember | null;
  onSelectMember: (member: RegionMember | null) => void;
}

// ─── Utility ────────────────────────────────────────────────────────

function buildRegionHierarchyText(regions: Region[]): string {
  const childrenMap = new Map<number | null, Region[]>();
  for (const region of regions) {
    const parentId = region.parentRegionId;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(region);
  }
  const lines: string[] = [];
  function addRegion(region: Region, indent: string, isLast: boolean) {
    lines.push(indent + (isLast ? '└── ' : '├── ') + region.name);
    const children = childrenMap.get(region.id) || [];
    const childIndent = indent + (isLast ? '    ' : '│   ');
    children.forEach((child, idx) => addRegion(child, childIndent, idx === children.length - 1));
  }
  const rootRegions = childrenMap.get(null) || [];
  rootRegions.forEach((region, idx) => addRegion(region, '', idx === rootRegions.length - 1));
  return lines.join('\n');
}

// ─── Draggable Region Item ──────────────────────────────────────────

interface DraggableRegionItemProps {
  region: Region;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  childCount: number;
  isDropTarget: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
}

function DraggableRegionItem({
  region, depth, isSelected, isExpanded, hasChildren, childCount,
  isDropTarget, onSelect, onEdit, onDelete, onToggleExpand,
}: DraggableRegionItemProps) {
  const { P, sx: sxTokens } = useAppTheme();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: `region-${region.id}`,
    data: { type: 'region', region },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      disablePadding
      sx={{ pl: depth * 2.5 }}
      secondaryAction={
        isSelected ? (
          <Box sx={{ display: 'flex', gap: 0.25 }}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(); }} sx={sxTokens.darkIconBtn}>
              <EditIcon sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(); }} sx={{ ...sxTokens.darkIconBtn, '&:hover': { color: P.accent.danger, bgcolor: P.dark.bgHover } }}>
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ) : null
      }
    >
      <ListItemButton
        selected={isSelected}
        onClick={onSelect}
        sx={{
          borderLeft: `3px solid ${region.color || '#3388ff'}`,
          borderRadius: '0 4px 4px 0',
          py: 0.5,
          minHeight: 36,
          bgcolor: isDropTarget ? P.dark.bgSelected : isSelected ? P.dark.bgSelected : 'transparent',
          outline: isDropTarget ? `1px dashed ${P.accent.primary}` : 'none',
          '&:hover': { bgcolor: P.dark.bgHover },
          '&.Mui-selected': { bgcolor: P.dark.bgSelected, '&:hover': { bgcolor: P.dark.bgSelected } },
        }}
      >
        {/* Drag handle */}
        <Box
          {...attributes}
          {...listeners}
          sx={{ cursor: 'grab', display: 'flex', alignItems: 'center', mr: 0.25, color: P.dark.textMuted, opacity: 0.4, '&:hover': { opacity: 1 }, '&:active': { cursor: 'grabbing' } }}
          onClick={(e) => e.stopPropagation()}
        >
          <DragIndicatorIcon sx={{ fontSize: 14 }} />
        </Box>

        {/* Expand/collapse */}
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            sx={{ mr: 0.25, p: 0.25, color: P.dark.textMuted }}
          >
            {isExpanded ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        ) : (
          <Box sx={{ width: 24 }} />
        )}

        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{
                fontFamily: P.font.ui,
                fontSize: '0.82rem',
                fontWeight: isSelected ? 600 : 400,
                color: isSelected ? P.dark.textBright : P.dark.text,
                lineHeight: 1.3,
              }}>
                {region.name}
              </Typography>
              {region.isCustomBoundary && (
                <Box component="span" sx={{ ...sxTokens.darkBadge, bgcolor: 'rgba(78, 205, 196, 0.15)', color: P.accent.primary }}>
                  <DrawIcon sx={{ fontSize: 9 }} /> custom
                </Box>
              )}
              {region.isArchipelago && (
                <Box component="span" sx={{ ...sxTokens.darkBadge, bgcolor: 'rgba(255, 183, 77, 0.15)', color: P.accent.warning }}>
                  arch
                </Box>
              )}
            </Box>
          }
          secondary={hasChildren ? (
            <Typography sx={{ fontFamily: P.font.mono, fontSize: '0.6rem', color: P.dark.textMuted }}>
              {childCount} subregion{childCount > 1 ? 's' : ''}
            </Typography>
          ) : undefined}
        />
      </ListItemButton>
    </ListItem>
  );
}

function RootDropZone({ isOver }: { isOver: boolean }) {
  const { P } = useAppTheme();
  const { setNodeRef } = useSortable({ id: 'root-drop-zone', data: { type: 'root' } });
  return (
    <Box
      ref={setNodeRef}
      sx={{
        p: 0.75, mb: 0.5, borderRadius: 1,
        border: '1px dashed', borderColor: isOver ? P.accent.primary : P.dark.border,
        bgcolor: isOver ? P.dark.bgSelected : 'transparent',
        textAlign: 'center', transition: 'all 0.2s',
      }}
    >
      <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.65rem', color: isOver ? P.accent.primary : P.dark.textMuted }}>
        Drop to root level
      </Typography>
    </Box>
  );
}

// ─── Division Leaf Item ─────────────────────────────────────────────

interface DivisionLeafItemProps {
  member: RegionMember;
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
}

function DivisionLeafItem({ member, depth, isSelected, onSelect }: DivisionLeafItemProps) {
  const { P, sx: sxTokens } = useAppTheme();

  return (
    <ListItem disablePadding sx={{ pl: (depth + 1) * 2.5 + 1 }}>
      <ListItemButton
        selected={isSelected}
        onClick={onSelect}
        sx={{
          py: 0.25,
          minHeight: 30,
          borderRadius: '4px',
          bgcolor: isSelected ? P.dark.bgSelected : 'transparent',
          '&:hover': { bgcolor: P.dark.bgHover },
          '&.Mui-selected': { bgcolor: P.dark.bgSelected, '&:hover': { bgcolor: P.dark.bgSelected } },
        }}
      >
        <ListItemIcon sx={{ minWidth: 22 }}>
          {member.hasCustomGeometry ? (
            <Tooltip title="Partial (custom boundary)">
              <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <PlaceIcon sx={{ fontSize: 13, color: P.accent.primary }} />
                <Box sx={{
                  position: 'absolute', bottom: -1, right: -1,
                  width: 5, height: 5, bgcolor: P.accent.warning,
                  borderRadius: '50%', border: `1px solid ${P.dark.bg}`,
                }} />
              </Box>
            </Tooltip>
          ) : (
            <PlaceIcon sx={{ fontSize: 13, color: P.dark.textMuted }} />
          )}
        </ListItemIcon>
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{
                fontFamily: P.font.ui, fontSize: '0.76rem',
                color: isSelected ? P.dark.textBright : P.dark.text,
                lineHeight: 1.3,
              }}>
                {member.name}
              </Typography>
              {member.hasCustomGeometry && (
                <Box component="span" sx={{ ...sxTokens.darkBadge, bgcolor: 'rgba(255, 183, 77, 0.15)', color: P.accent.warning }}>
                  partial
                </Box>
              )}
            </Box>
          }
          secondary={member.path ? (
            <Typography sx={{
              fontFamily: P.font.mono, fontSize: '0.55rem', color: P.dark.textMuted,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {member.path}
            </Typography>
          ) : undefined}
        />
      </ListItemButton>
    </ListItem>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function RegionTreePanel({
  regions, regionsLoading, selectedRegion, onSelectRegion,
  regionMembers, membersLoading, inheritParentColor, onInheritParentColorChange,
  onCreateRegion, createRegionPending, onEditRegion, onDeleteRegion, onMoveRegion,
  selectedMember, onSelectMember,
}: RegionTreePanelProps) {
  const { P, sx: sxTokens } = useAppTheme();
  const [expandedRegions, setExpandedRegions] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [newRegionName, setNewRegionName] = useState('');
  const [newRegionColor, setNewRegionColor] = useState('#3388ff');
  const [createPopoverAnchor, setCreatePopoverAnchor] = useState<HTMLElement | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const toggleRegionExpanded = useCallback((regionId: number) => {
    setExpandedRegions(prev => {
      const next = new Set(prev);
      if (next.has(regionId)) next.delete(regionId); else next.add(regionId);
      return next;
    });
  }, []);

  // Auto-expand parent when region selected + auto-expand selected region itself
  useEffect(() => {
    if (!selectedRegion) return;
    setExpandedRegions(prev => {
      const next = new Set(prev);
      let changed = false;
      // Expand the selected region itself (to reveal division leaves)
      if (!next.has(selectedRegion.id)) {
        next.add(selectedRegion.id);
        changed = true;
      }
      // Expand ancestor chain
      if (selectedRegion.parentRegionId) {
        let current: Region | undefined = regions.find(r => r.id === selectedRegion.parentRegionId);
        while (current) {
          if (!next.has(current.id)) {
            next.add(current.id);
            changed = true;
          }
          current = current.parentRegionId ? regions.find(r => r.id === current!.parentRegionId) : undefined;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedRegion, regions]);

  const handleCreateRegion = useCallback(() => {
    if (!newRegionName.trim()) return;
    const colorToUse = (inheritParentColor && selectedRegion?.color) ? selectedRegion.color : newRegionColor;
    onCreateRegion({ name: newRegionName.trim(), color: colorToUse, parentRegionId: selectedRegion?.id });
    setNewRegionName('');
    setCreatePopoverAnchor(null);
  }, [newRegionName, newRegionColor, inheritParentColor, selectedRegion, onCreateRegion]);

  const handleDragStart = useCallback((event: DragStartEvent) => setActiveId(event.active.id as string), []);
  const handleDragOver = useCallback((event: DragOverEvent) => setOverId(event.over?.id as string | null), []);
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);
    if (!over) return;
    const draggedId = parseInt((active.id as string).replace('region-', ''));
    const targetId = (over.id as string) === 'root-drop-zone' ? null : parseInt((over.id as string).replace('region-', ''));
    const draggedRegion = regions.find(r => r.id === draggedId);
    if (!draggedRegion || targetId === draggedId) return;
    const isDescendant = (regionId: number, potentialAncestorId: number): boolean => {
      const region = regions.find(r => r.id === regionId);
      if (!region?.parentRegionId) return false;
      if (region.parentRegionId === potentialAncestorId) return true;
      return isDescendant(region.parentRegionId, potentialAncestorId);
    };
    if (targetId !== null && isDescendant(targetId, draggedId)) return;
    if (draggedRegion.parentRegionId === targetId) return;
    onMoveRegion(draggedId, targetId);
  }, [regions, onMoveRegion]);

  // ── Tree rendering
  const rootRegions = regions.filter(r => !r.parentRegionId);
  const getChildRegions = (parentId: number) => regions.filter(r => r.parentRegionId === parentId);
  const draggedRegion = activeId ? regions.find(r => r.id === parseInt(activeId.replace('region-', ''))) : null;

  // Division members (non-subregion) to show as leaves under the selected region
  const divisionMembers = regionMembers.filter(m => !m.isSubregion);

  const renderRegionItem = (region: Region, depth = 0): React.ReactNode => {
    const children = getChildRegions(region.id);
    const isSelected = selectedRegion?.id === region.id;
    // Count children: child regions + division members (if this is the selected region)
    const memberLeafCount = isSelected ? divisionMembers.length : 0;
    const hasChildren = children.length > 0 || memberLeafCount > 0;
    const isExpanded = expandedRegions.has(region.id);
    const isDropTarget = overId === `region-${region.id}`;

    return (
      <Box key={region.id}>
        <DraggableRegionItem
          region={region} depth={depth}
          isSelected={isSelected}
          isExpanded={isExpanded} hasChildren={hasChildren}
          childCount={children.length + memberLeafCount} isDropTarget={isDropTarget}
          onSelect={() => onSelectRegion(region)}
          onEdit={() => onEditRegion(region)}
          onDelete={() => onDeleteRegion(region)}
          onToggleExpand={() => toggleRegionExpanded(region.id)}
        />
        {hasChildren && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            {children.map(child => renderRegionItem(child, depth + 1))}
            {isSelected && divisionMembers.map((m) => (
              <DivisionLeafItem
                key={m.memberRowId ? `member-${m.memberRowId}` : `division-${m.id}`}
                member={m}
                depth={depth}
                isSelected={selectedMember?.id === m.id && selectedMember?.memberRowId === m.memberRowId}
                onSelect={() => onSelectMember(m)}
              />
            ))}
            {isSelected && membersLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1, pl: (depth + 1) * 2.5 }}>
                <CircularProgress size={14} sx={{ color: P.accent.primary }} />
              </Box>
            )}
          </Collapse>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── SECTION: Region Tree header ── */}
      <Box sx={{ ...sxTokens.sidebarLabel, pt: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Regions</span>
        <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center' }}>
          <Tooltip title="Create region">
            <IconButton
              size="small"
              onClick={(e) => setCreatePopoverAnchor(e.currentTarget)}
              sx={{ ...sxTokens.darkIconBtn, p: 0.25, '&:hover': { color: P.accent.primary, bgcolor: P.accent.primaryDim } }}
            >
              <AddIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Copy hierarchy to clipboard">
            <span>
              <IconButton
                size="small"
                onClick={() => navigator.clipboard.writeText(buildRegionHierarchyText(regions || []))}
                disabled={!regions?.length}
                sx={{ ...sxTokens.darkIconBtn, p: 0.25 }}
              >
                <ContentCopyIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Create Region Popover ── */}
      <Popover
        open={Boolean(createPopoverAnchor)}
        anchorEl={createPopoverAnchor}
        onClose={() => setCreatePopoverAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: P.dark.bg,
              border: `1px solid ${P.dark.border}`,
              p: 1.5,
              width: 300,
            },
          },
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder={selectedRegion ? `+ in "${selectedRegion.name}"` : '+ New root region'}
            value={newRegionName}
            onChange={(e) => setNewRegionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateRegion()}
            sx={{
              ...sxTokens.darkInput,
              '& .MuiOutlinedInput-root': {
                ...sxTokens.darkInput['& .MuiOutlinedInput-root'],
                height: 32,
              },
            }}
          />
          <Tooltip title={inheritParentColor && selectedRegion ? 'Using parent color' : 'Pick color'}>
            <input
              type="color"
              value={inheritParentColor && selectedRegion?.color ? selectedRegion.color : newRegionColor}
              onChange={(e) => { setNewRegionColor(e.target.value); onInheritParentColorChange(false); }}
              style={{
                width: 28, height: 28, border: 'none', cursor: 'pointer',
                borderRadius: 4, background: 'transparent', flexShrink: 0,
                opacity: inheritParentColor && selectedRegion ? 0.6 : 1,
              }}
            />
          </Tooltip>
          <IconButton
            size="small"
            onClick={handleCreateRegion}
            disabled={!newRegionName.trim() || createRegionPending}
            sx={{ color: P.accent.primary, '&:hover': { bgcolor: P.accent.primaryDim } }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
        {selectedRegion && (
          <Chip
            size="small"
            label={`Parent: ${selectedRegion.name}`}
            onDelete={() => onSelectRegion(null)}
            sx={{
              mt: 0.75, height: 22, fontSize: '0.65rem',
              fontFamily: P.font.ui,
              bgcolor: P.dark.bgHover, color: P.dark.text,
              '& .MuiChip-deleteIcon': { color: P.dark.textMuted, fontSize: 14 },
            }}
          />
        )}
      </Popover>

      <Divider sx={{ borderColor: P.dark.border, flexShrink: 0 }} />

      {/* ── Region tree (scrollable, unified with division leaves) ── */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, px: 0.5, py: 0.5 }}>
        {regionsLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={20} sx={{ color: P.accent.primary }} />
          </Box>
        ) : regions.length === 0 ? (
          <Typography sx={{ px: 1.5, py: 2, fontFamily: P.font.ui, fontSize: '0.8rem', color: P.dark.textMuted }}>
            No regions yet. Click + to create one.
          </Typography>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <Box>
              {activeId && draggedRegion?.parentRegionId !== null && (
                <RootDropZone isOver={overId === 'root-drop-zone'} />
              )}
              <List dense disablePadding>
                {rootRegions.map(region => renderRegionItem(region))}
              </List>
            </Box>
            <DragOverlay>
              {draggedRegion ? (
                <Box sx={{
                  p: 1, px: 1.5,
                  bgcolor: P.dark.bgSelected,
                  borderLeft: `3px solid ${draggedRegion.color || '#3388ff'}`,
                  borderRadius: '0 4px 4px 0',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}>
                  <Typography sx={{ fontFamily: P.font.ui, fontSize: '0.82rem', color: P.dark.textBright }}>
                    {draggedRegion.name}
                  </Typography>
                </Box>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </Box>
    </Box>
  );
}
