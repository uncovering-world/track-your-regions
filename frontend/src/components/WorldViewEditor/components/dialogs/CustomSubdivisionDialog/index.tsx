import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Tooltip,
  Tabs,
  Tab,
  Box,
  Chip,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SaveIcon from '@mui/icons-material/Save';
import type { Region, RegionMember } from '../../../../../types';
import type { SubdivisionGroup } from './types';
import { ListViewTab } from './ListViewTab';
import { MapViewTab } from './MapViewTab';
import { AIAssistTab, type RegionSuggestion, type UsageStats, type LastOperation } from './AIAssistTab';
import { DivisionPreviewDialog } from '../DivisionPreviewDialog';
import {
  checkAIStatus,
  fetchRegionMembers,
  createRegion,
  moveMemberToRegion,
  addDivisionsToRegion,
  removeDivisionsFromRegion,
  expandToSubregions,
  fetchDivisionGeometry,
} from '@/api';
import { useQueryClient } from '@tanstack/react-query';
import type { ImageOverlaySettings } from './ImageOverlayDialog';

export type { SubdivisionGroup } from './types';

// Storage key prefix for localStorage
const STORAGE_KEY_PREFIX = 'custom-subdivision-dialog-state-';

// Empty stats helper
const emptyStats = (): UsageStats => ({ tokens: 0, inputCost: 0, outputCost: 0, webSearchCost: 0, totalCost: 0, requests: 0, regionsProcessed: 0 });

/**
 * Check if a stored member still exists in DB members.
 * Matches by memberRowId first (for custom geometry parts), then by division id.
 */
const memberExistsInDb = (storedMember: RegionMember, dbMembers: RegionMember[]): boolean => {
  if (storedMember.memberRowId) {
    if (dbMembers.some(db => db.memberRowId === storedMember.memberRowId)) {
      return true;
    }
  }

  if (!storedMember.hasCustomGeometry) {
    if (dbMembers.some(db => db.id === storedMember.id && !db.hasCustomGeometry)) {
      return true;
    }
  }

  return false;
};

/**
 * Update stored member with current DB data (e.g., get the memberRowId if it was missing)
 */
const updateMemberFromDb = (storedMember: RegionMember, dbMembers: RegionMember[]): RegionMember => {
  let dbMember: RegionMember | undefined;

  if (storedMember.memberRowId) {
    dbMember = dbMembers.find(db => db.memberRowId === storedMember.memberRowId);
  }

  if (!dbMember && !storedMember.hasCustomGeometry) {
    dbMember = dbMembers.find(db => db.id === storedMember.id && !db.hasCustomGeometry);
  }

  if (dbMember) {
    return {
      ...storedMember,
      memberRowId: dbMember.memberRowId,
      hasCustomGeometry: dbMember.hasCustomGeometry,
    };
  }

  return storedMember;
};

/**
 * Check if a DB member exists in stored state (unassigned or any group)
 */
const memberExistsInStored = (dbMember: RegionMember, stored: SavedDialogState): boolean => {
  const inUnassigned = stored.unassignedDivisions.some(s => {
    if (dbMember.memberRowId && s.memberRowId) {
      return dbMember.memberRowId === s.memberRowId;
    }
    if (!dbMember.hasCustomGeometry && !s.hasCustomGeometry) {
      return dbMember.id === s.id;
    }
    return false;
  });

  if (inUnassigned) return true;

  for (const group of stored.subdivisionGroups) {
    const inGroup = group.members.some(s => {
      if (dbMember.memberRowId && s.memberRowId) {
        return dbMember.memberRowId === s.memberRowId;
      }
      if (!dbMember.hasCustomGeometry && !s.hasCustomGeometry) {
        return dbMember.id === s.id;
      }
      return false;
    });
    if (inGroup) return true;
  }

  return false;
};

/**
 * Validate stored state against actual DB members.
 */
const validateStoredState = (
  stored: SavedDialogState,
  dbMembers: RegionMember[]
): SavedDialogState => {
  const validUnassigned = stored.unassignedDivisions
    .filter(d => memberExistsInDb(d, dbMembers))
    .map(d => updateMemberFromDb(d, dbMembers));

  const validGroups = stored.subdivisionGroups.map(group => ({
    ...group,
    members: group.members
      .filter(m => memberExistsInDb(m, dbMembers))
      .map(m => updateMemberFromDb(m, dbMembers)),
  }));

  const newMembers = dbMembers.filter(db => !memberExistsInStored(db, stored));
  const finalUnassigned = [...validUnassigned, ...newMembers];

  const storedCount = stored.unassignedDivisions.length +
    stored.subdivisionGroups.reduce((sum, g) => sum + g.members.length, 0);
  const validCount = validUnassigned.length +
    validGroups.reduce((sum, g) => sum + g.members.length, 0);

  if (storedCount !== validCount) {
    console.log(`Cleaned up ${storedCount - validCount} stale divisions from localStorage`);
  }
  if (newMembers.length > 0) {
    console.log(`Added ${newMembers.length} new members from DB to unassigned`);
  }

  return {
    ...stored,
    unassignedDivisions: finalUnassigned,
    subdivisionGroups: validGroups,
  };
};

// Serializable state for persistence
interface SavedDialogState {
  unassignedDivisions: RegionMember[];
  subdivisionGroups: SubdivisionGroup[];
  aiSuggestions: Array<[number, RegionSuggestion]>;
  imageOverlaySettings: ImageOverlaySettings | null;
  activeTab: number;
  savedAt: string;
  singleRequestStats: UsageStats;
  batchRequestStats: UsageStats;
  lastOperation: (Omit<LastOperation, 'timestamp'> & { timestamp: string }) | null;
}

interface CustomSubdivisionDialogProps {
  open: boolean;
  selectedRegion: Region | null;
  regionMembers: RegionMember[];
  worldViewId: number;
  worldViewDescription?: string;
  worldViewSource?: string;
  onClose: () => void;
  onComplete: () => void;
  onSplitsApplied?: () => void;
}

export function CustomSubdivisionDialog({
  open,
  selectedRegion,
  regionMembers,
  worldViewId,
  worldViewDescription,
  worldViewSource,
  onClose,
  onComplete,
  onSplitsApplied,
}: CustomSubdivisionDialogProps) {
  const queryClient = useQueryClient();

  // Internal state — previously lifted to parent
  const [unassignedDivisions, setUnassignedDivisions] = useState<RegionMember[]>([]);
  const [subdivisionGroups, setSubdivisionGroups] = useState<SubdivisionGroup[]>([]);
  const [draggingDivisionId, setDraggingDivisionId] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | 'unassigned' | null>(null);
  const [editingGroupIdx, setEditingGroupIdx] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isQuickExpanding, setIsQuickExpanding] = useState(false);

  // Preview state — previously in parent
  const [previewDivision, setPreviewDivision] = useState<{ id: number; name: string } | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [activeTab, setActiveTab] = useState(0);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  // Lifted state for persistence across tab switches
  const [aiSuggestions, setAiSuggestions] = useState<Map<number, RegionSuggestion>>(new Map());
  const [imageOverlaySettings, setImageOverlaySettings] = useState<ImageOverlaySettings | null>(null);

  // Usage stats (lifted from AIAssistTab for persistence)
  const [singleRequestStats, setSingleRequestStats] = useState<UsageStats>(emptyStats());
  const [batchRequestStats, setBatchRequestStats] = useState<UsageStats>(emptyStats());
  const [lastOperation, setLastOperation] = useState<LastOperation | null>(null);

  // Track if we have saved state and when it was last saved
  const [hasSavedState, setHasSavedState] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Get storage key for current region
  const getStorageKey = useCallback(() => {
    return selectedRegion ? `${STORAGE_KEY_PREFIX}${selectedRegion.id}` : null;
  }, [selectedRegion]);

  // Save state to localStorage
  const saveState = useCallback(() => {
    const key = getStorageKey();
    if (!key) return;

    const state: SavedDialogState = {
      unassignedDivisions,
      subdivisionGroups,
      aiSuggestions: Array.from(aiSuggestions.entries()),
      imageOverlaySettings,
      activeTab,
      savedAt: new Date().toISOString(),
      singleRequestStats,
      batchRequestStats,
      lastOperation: lastOperation ? {
        ...lastOperation,
        timestamp: lastOperation.timestamp.toISOString(),
      } : null,
    };

    try {
      localStorage.setItem(key, JSON.stringify(state));
      setLastSavedAt(state.savedAt);
      setHasSavedState(true);
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }, [getStorageKey, unassignedDivisions, subdivisionGroups, aiSuggestions, imageOverlaySettings, activeTab, singleRequestStats, batchRequestStats, lastOperation]);

  // Restore state from localStorage
  const restoreState = useCallback(() => {
    const key = getStorageKey();
    if (!key) return false;

    try {
      const saved = localStorage.getItem(key);
      if (!saved) return false;

      const state: SavedDialogState = JSON.parse(saved);

      setUnassignedDivisions(state.unassignedDivisions);
      setSubdivisionGroups(state.subdivisionGroups);
      setAiSuggestions(new Map(state.aiSuggestions));
      setImageOverlaySettings(state.imageOverlaySettings);
      setActiveTab(state.activeTab);
      setLastSavedAt(state.savedAt);
      setHasSavedState(true);

      if (state.singleRequestStats) setSingleRequestStats(state.singleRequestStats);
      if (state.batchRequestStats) setBatchRequestStats(state.batchRequestStats);
      if (state.lastOperation) {
        setLastOperation({
          ...state.lastOperation,
          timestamp: new Date(state.lastOperation.timestamp),
        });
      }

      return true;
    } catch (e) {
      console.error('Failed to restore state:', e);
      return false;
    }
  }, [getStorageKey]);

  // Clear saved state
  const clearSavedState = useCallback(() => {
    const key = getStorageKey();
    if (key) {
      localStorage.removeItem(key);
      setHasSavedState(false);
      setLastSavedAt(null);
    }
  }, [getStorageKey]);

  // Check AI availability when dialog opens
  useEffect(() => {
    if (open) {
      checkAIStatus()
        .then(status => setAiAvailable(status.available))
        .catch(() => setAiAvailable(false));
    }
  }, [open]);

  // Track the last region ID we restored for
  const [lastRestoredRegionId, setLastRestoredRegionId] = useState<number | null>(null);

  // Initialize/restore state when dialog opens
  useEffect(() => {
    if (!open || !selectedRegion) return;

    if (lastRestoredRegionId === selectedRegion.id) return;

    // Reset local state first
    setAiSuggestions(new Map());
    setImageOverlaySettings(null);
    setSingleRequestStats(emptyStats());
    setBatchRequestStats(emptyStats());
    setLastOperation(null);
    setActiveTab(0);
    setHasSavedState(false);
    setLastSavedAt(null);

    // Initialize unassigned from regionMembers
    const divisions = regionMembers.filter(m => !m.isSubregion);
    setUnassignedDivisions(divisions);
    setSubdivisionGroups([]);

    // Check if there's saved state for this region and restore it (with validation)
    const key = getStorageKey();
    if (key && localStorage.getItem(key)) {
      fetchRegionMembers(selectedRegion.id)
        .then(dbMembers => {
          try {
            const saved = localStorage.getItem(key);
            if (!saved) return;

            let state: SavedDialogState = JSON.parse(saved);
            state = validateStoredState(state, dbMembers);

            setUnassignedDivisions(state.unassignedDivisions);
            setSubdivisionGroups(state.subdivisionGroups);
            setAiSuggestions(new Map(state.aiSuggestions));
            setImageOverlaySettings(state.imageOverlaySettings);
            setActiveTab(state.activeTab);
            setLastSavedAt(state.savedAt);
            setHasSavedState(true);

            if (state.singleRequestStats) setSingleRequestStats(state.singleRequestStats);
            if (state.batchRequestStats) setBatchRequestStats(state.batchRequestStats);
            if (state.lastOperation) {
              setLastOperation({
                ...state.lastOperation,
                timestamp: new Date(state.lastOperation.timestamp),
              });
            }
          } catch (e) {
            console.error('Failed to restore state:', e);
          }
        })
        .catch(e => {
          console.error('Failed to fetch DB members for validation:', e);
          restoreState();
        });
    }

    setLastRestoredRegionId(selectedRegion.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- regionMembers changes on every render; we only want to init on open/region change
  }, [open, selectedRegion, lastRestoredRegionId, getStorageKey, restoreState]);

  // Reset tracking when dialog closes
  useEffect(() => {
    if (!open) {
      setLastRestoredRegionId(null);
    }
  }, [open]);

  // Auto-save state on changes (debounced)
  useEffect(() => {
    if (!open || !selectedRegion) return;

    const timer = setTimeout(() => {
      saveState();
    }, 1000);

    return () => clearTimeout(timer);
  }, [open, selectedRegion, unassignedDivisions, subdivisionGroups, aiSuggestions, imageOverlaySettings, activeTab, singleRequestStats, batchRequestStats, lastOperation, saveState]);

  // Preview a division's geometry
  const handlePreviewDivision = useCallback(async (div: RegionMember) => {
    setPreviewDivision({ id: div.id, name: div.name });
    setPreviewLoading(true);
    setPreviewGeometry(null);
    try {
      const geom = await fetchDivisionGeometry(div.id, 1);
      setPreviewGeometry(geom?.geometry as GeoJSON.Geometry || null);
    } catch {
      setPreviewGeometry(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Quick expand: create one subregion per division
  const handleQuickExpand = useCallback(async () => {
    if (!selectedRegion) return;
    const divisionCount = unassignedDivisions.length + subdivisionGroups.reduce((sum, g) => sum + g.members.length, 0);
    if (!window.confirm(`Quick Expand: Create ${divisionCount} subregions (one for each division)?`)) return;

    setIsQuickExpanding(true);
    try {
      await expandToSubregions(selectedRegion.id, { inheritColor: true });
      queryClient.invalidateQueries({ queryKey: ['regions', worldViewId] });
      queryClient.invalidateQueries({ queryKey: ['regionMembers', selectedRegion.id] });
      onComplete();
    } catch (e) {
      console.error('Failed to quick expand:', e);
    } finally {
      setIsQuickExpanding(false);
    }
  }, [selectedRegion, unassignedDivisions, subdivisionGroups, worldViewId, queryClient, onComplete]);

  // Create subregions from groups
  const handleCreateSubregions = useCallback(async () => {
    if (!selectedRegion) return;

    setIsCreating(true);
    try {
      // Refresh members from DB first to get real memberRowIds
      const dbMembers = await fetchRegionMembers(selectedRegion.id);

      const memberLookup = new Map<string, number>();
      for (const m of dbMembers) {
        if (m.memberRowId) {
          const key = `${m.id}-${m.name}`;
          memberLookup.set(key, m.memberRowId);
        }
      }

      for (const group of subdivisionGroups) {
        if (group.members.length === 0) continue;

        const newRegion = await createRegion(worldViewId, {
          name: group.name,
          parentRegionId: selectedRegion.id,
          color: selectedRegion.color || undefined,
        });

        for (const member of group.members) {
          const lookupKey = `${member.id}-${member.name}`;
          const realMemberRowId = memberLookup.get(lookupKey);

          if (realMemberRowId && realMemberRowId > 0) {
            await moveMemberToRegion(selectedRegion.id, realMemberRowId, newRegion.id);
          } else if (member.memberRowId && member.memberRowId > 0) {
            await moveMemberToRegion(selectedRegion.id, member.memberRowId, newRegion.id);
          } else {
            await addDivisionsToRegion(newRegion.id, [member.id]);
            await removeDivisionsFromRegion(selectedRegion.id, [member.id]);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['regions', worldViewId] });
      queryClient.invalidateQueries({ queryKey: ['regionMembers', selectedRegion.id] });

      clearSavedState();
      onComplete();
    } catch (e) {
      console.error('Failed to create subregions:', e);
      alert('Failed to create subregions');
    } finally {
      setIsCreating(false);
    }
  }, [selectedRegion, subdivisionGroups, worldViewId, queryClient, clearSavedState, onComplete]);

  const aiTabDisabled = aiAvailable === false;

  const formatSavedTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              Create Custom Subregions
              <Typography variant="body2" color="text.secondary">
                Group divisions into named subregions for "{selectedRegion?.name}"
              </Typography>
            </Box>
            {hasSavedState && lastSavedAt && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  icon={<SaveIcon />}
                  label={`Saved ${formatSavedTime(lastSavedAt)}`}
                  size="small"
                  color="success"
                  variant="outlined"
                />
                <Tooltip title="Clear saved state and start fresh">
                  <Button
                    size="small"
                    color="warning"
                    onClick={clearSavedState}
                  >
                    Reset
                  </Button>
                </Tooltip>
              </Box>
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 2 }}>
            <Tab label="List View" />
            <Tab label="Map View" icon={<MapIcon fontSize="small" />} iconPosition="start" />
            <Tab
              label={
                <Tooltip title={aiTabDisabled ? "AI not configured. Set OPENAI_API_KEY in .env" : ""}>
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <SmartToyIcon fontSize="small" />
                    AI Assistant
                  </Box>
                </Tooltip>
              }
              disabled={aiTabDisabled}
              sx={aiTabDisabled ? { opacity: 0.5 } : {}}
            />
          </Tabs>

          {activeTab === 0 && (
            <ListViewTab
              selectedRegion={selectedRegion}
              unassignedDivisions={unassignedDivisions}
              setUnassignedDivisions={setUnassignedDivisions}
              subdivisionGroups={subdivisionGroups}
              setSubdivisionGroups={setSubdivisionGroups}
              draggingDivisionId={draggingDivisionId}
              setDraggingDivisionId={setDraggingDivisionId}
              dragOverGroupIdx={dragOverGroupIdx}
              setDragOverGroupIdx={setDragOverGroupIdx}
              editingGroupIdx={editingGroupIdx}
              setEditingGroupIdx={setEditingGroupIdx}
              editingGroupName={editingGroupName}
              setEditingGroupName={setEditingGroupName}
              onPreviewDivision={handlePreviewDivision}
            />
          )}

          {activeTab === 1 && (
            <MapViewTab
              selectedRegion={selectedRegion}
              unassignedDivisions={unassignedDivisions}
              setUnassignedDivisions={setUnassignedDivisions}
              subdivisionGroups={subdivisionGroups}
              setSubdivisionGroups={setSubdivisionGroups}
              editingGroupName={editingGroupName}
              setEditingGroupName={setEditingGroupName}
              onSplitsApplied={onSplitsApplied}
              imageOverlaySettings={imageOverlaySettings}
              setImageOverlaySettings={setImageOverlaySettings}
            />
          )}

          {activeTab === 2 && (
            <AIAssistTab
              selectedRegion={selectedRegion}
              worldViewDescription={worldViewDescription}
              worldViewSource={worldViewSource}
              unassignedDivisions={unassignedDivisions}
              setUnassignedDivisions={setUnassignedDivisions}
              subdivisionGroups={subdivisionGroups}
              setSubdivisionGroups={setSubdivisionGroups}
              suggestions={aiSuggestions}
              setSuggestions={setAiSuggestions}
              singleRequestStats={singleRequestStats}
              setSingleRequestStats={setSingleRequestStats}
              batchRequestStats={batchRequestStats}
              setBatchRequestStats={setBatchRequestStats}
              lastOperation={lastOperation}
              setLastOperation={setLastOperation}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>
            Cancel
          </Button>
          <Tooltip title="Create one subregion per division (each division becomes its own subregion)">
            <Button
              variant="outlined"
              disabled={isCreating || isQuickExpanding}
              onClick={handleQuickExpand}
            >
              {isQuickExpanding ? 'Expanding...' : 'Quick Expand (1:1)'}
            </Button>
          </Tooltip>
          <Button
            variant="contained"
            disabled={subdivisionGroups.length === 0 || subdivisionGroups.every(g => g.members.length === 0) || isCreating}
            onClick={handleCreateSubregions}
          >
            {isCreating ? 'Creating...' : `Create ${subdivisionGroups.filter(g => g.members.length > 0).length} Subregion(s)`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Simple Division Map Preview Dialog */}
      <DivisionPreviewDialog
        division={previewDivision}
        geometry={previewGeometry}
        loading={previewLoading}
        onClose={() => setPreviewDivision(null)}
      />
    </>
  );
}
