import { useState, useEffect, useCallback, useRef } from 'react';
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
  Alert,
} from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SaveIcon from '@mui/icons-material/Save';
import type { Region } from '../../../../../types';
import type { RegionMember } from '../../../../../api/regions';
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
import { formatRelativeTime } from '../../../../../utils/dateFormat';
import type { ImageOverlaySettings } from './ImageOverlayDialog';
import { legacyOverlay, STORAGE_KEY_PREFIX } from './overlayStorage';
import { useRegionImageOverlay } from './useRegionImageOverlay';
import { ReferenceMapNotices } from './ReferenceMapNotices';
import { deleteRegionSubdivisionGroups, fetchRegionSubdivisionGroups } from '../../../../../api/regions';
import { carriedGroups, forgetLegacyGroups, groupsFromDb, legacyGroups, unassignedAmong } from './groupsStorage';
import { useSubdivisionGroupsSync } from './useSubdivisionGroupsSync';
import { queryKeys } from '../../../../../api/queryKeys';

export type { SubdivisionGroup } from './types';

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
const memberExistsInStored = (
  dbMember: RegionMember,
  stored: { unassignedDivisions: RegionMember[]; subdivisionGroups: SubdivisionGroup[] },
): boolean => {
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
 * Whether a saved entry holds the dialog's state, and not only a reference map
 * a reset kept while its Keep or Discard offer was unanswered (#595).
 */
const isDialogState = (state: Partial<SavedDialogState> | null): state is SavedDialogState =>
  typeof state?.savedAt === 'string';

/** A saved state with nothing in it, for validating an earlier session's groups alone. */
const emptySavedState = (): SavedDialogState => ({
  aiSuggestions: [], activeTab: 0, savedAt: '', singleRequestStats: emptyStats(), batchRequestStats: emptyStats(), lastOperation: null,
});

/**
 * Validate stored state against actual DB members.
 * Only division members (not subregions) belong in the dialog.
 */
const validateStoredState = (
  stored: SavedDialogState & { unassignedDivisions: RegionMember[]; subdivisionGroups: SubdivisionGroup[] },
  dbMembers: RegionMember[]
): SavedDialogState & { unassignedDivisions: RegionMember[]; subdivisionGroups: SubdivisionGroup[] } => {
  // Only divisions belong in the dialog — subregions are child regions shown as target groups
  const divisionMembers = dbMembers.filter(m => !m.isSubregion);

  const validUnassigned = stored.unassignedDivisions
    .filter(d => memberExistsInDb(d, divisionMembers))
    .map(d => updateMemberFromDb(d, divisionMembers));

  const validGroups = stored.subdivisionGroups.map(group => ({
    ...group,
    members: group.members
      .filter(m => memberExistsInDb(m, divisionMembers))
      .map(m => updateMemberFromDb(m, divisionMembers)),
  }));

  const newMembers = divisionMembers.filter(db => !memberExistsInStored(db, stored));
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
  /**
   * Only what an earlier session kept here before the database held the
   * groups (#595): adopted once into a database that has none, then forgotten.
   */
  unassignedDivisions?: RegionMember[];
  subdivisionGroups?: SubdivisionGroup[];
  aiSuggestions: Array<[number, RegionSuggestion]>;
  /**
   * Only a map an earlier session kept here before the database held it
   * (#595): carried forward untouched until the admin keeps or discards it.
   */
  imageOverlaySettings?: ImageOverlaySettings | null;
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
  existingChildren: Region[];
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
  existingChildren,
  worldViewId,
  worldViewDescription,
  worldViewSource,
  onClose,
  onComplete,
  onSplitsApplied,
}: CustomSubdivisionDialogProps) {
  const queryClient = useQueryClient();

  // Internal state
  const [unassignedDivisions, setUnassignedDivisions] = useState<RegionMember[]>([]);
  const [subdivisionGroups, setSubdivisionGroups] = useState<SubdivisionGroup[]>([]);
  const [draggingDivisionId, setDraggingDivisionId] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | 'unassigned' | null>(null);
  const [editingGroupIdx, setEditingGroupIdx] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isQuickExpanding, setIsQuickExpanding] = useState(false);

  // Preview state
  const [previewDivision, setPreviewDivision] = useState<{ id: number; name: string } | null>(null);
  const [previewGeometry, setPreviewGeometry] = useState<GeoJSON.Geometry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [activeTab, setActiveTab] = useState(0);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  // Lifted state for persistence across tab switches
  const [aiSuggestions, setAiSuggestions] = useState<Map<number, RegionSuggestion>>(new Map());
  // The reference map is the database's (#595), not this browser's saved state.
  const overlay = useRegionImageOverlay(selectedRegion?.id ?? null, open);
  // The groups are the database's too (#595), saved as they change.
  const groupsSync = useSubdivisionGroupsSync(selectedRegion?.id ?? null, open, subdivisionGroups);
  // Which opening a load belongs to: one for an earlier region, or for a
  // dialog since closed, lands nowhere.
  const loadGeneration = useRef(0);
  const imageOverlaySettings = overlay.settings;

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

    // The groups are the database's (#595); the entry keeps what is this
    // browser's, and an earlier session's groups untouched until they are adopted.
    const state: SavedDialogState = {
      ...(selectedRegion ? carriedGroups(selectedRegion.id) as Partial<SavedDialogState> : {}),
      aiSuggestions: Array.from(aiSuggestions.entries()),
      imageOverlaySettings: selectedRegion ? legacyOverlay(selectedRegion.id).settings : null,
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
  }, [getStorageKey, selectedRegion, aiSuggestions, activeTab, singleRequestStats, batchRequestStats, lastOperation]);

  // Restore state from localStorage
  const restoreState = useCallback(() => {
    const key = getStorageKey();
    if (!key) return false;

    try {
      const saved = localStorage.getItem(key);
      if (!saved) return false;

      const state: SavedDialogState = JSON.parse(saved);
      if (!isDialogState(state)) return false;

      setAiSuggestions(new Map(state.aiSuggestions));
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
      // A reference map still waiting for the admin's Keep or Discard (#595)
      // outlives a reset: it is the admin's to drop, not the reset's.
      if (overlay.legacy) localStorage.setItem(key, JSON.stringify({ imageOverlaySettings: overlay.legacy }));
      else localStorage.removeItem(key);
      setHasSavedState(false);
      setLastSavedAt(null);
    }
  }, [getStorageKey, overlay.legacy]);

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
    setSingleRequestStats(emptyStats());
    setBatchRequestStats(emptyStats());
    setLastOperation(null);
    setActiveTab(0);
    setHasSavedState(false);
    setLastSavedAt(null);

    // Initialize unassigned from regionMembers
    const divisions = regionMembers.filter(m => !m.isSubregion);
    setUnassignedDivisions(divisions);

    // The groups come from the database (#595); what else this browser saved
    // for the region (AI suggestions, the tab, usage counts) from its entry.
    const regionId = selectedRegion.id;
    const key = getStorageKey();
    const withChildren = (groups: SubdivisionGroup[]): SubdivisionGroup[] => {
      const represented = new Set(groups.map(g => g.existingRegionId).filter(Boolean));
      const missing = existingChildren.filter(r => !represented.has(r.id));
      return [...groups, ...missing.map(r => ({ name: r.name, members: [] as RegionMember[], existingRegionId: r.id }))];
    };
    setSubdivisionGroups(withChildren([]));
    const generation = ++loadGeneration.current;
    Promise.all([fetchRegionMembers(regionId), fetchRegionSubdivisionGroups(regionId)])
      .then(([dbMembers, stored]) => {
        if (generation !== loadGeneration.current) return;
        const divisionMembers = dbMembers.filter(m => !m.isSubregion);
        // An earlier session's groups, kept only in this browser, become the
        // region's when the database holds none; then the browser forgets them.
        const legacy = stored.groups.length === 0 ? legacyGroups(regionId) : null;
        const groups = withChildren(legacy
          ? validateStoredState({ ...emptySavedState(), unassignedDivisions: [], subdivisionGroups: legacy }, dbMembers).subdivisionGroups
          : groupsFromDb(stored, divisionMembers));
        setSubdivisionGroups(groups);
        setUnassignedDivisions(unassignedAmong(divisionMembers, groups));
        // Adopted groups stay in the browser until the database holds them;
        // beside the database's own, the browser's copy is only stale.
        if (legacy) groupsSync.settle(groups, { save: true, onSaved: () => forgetLegacyGroups(regionId) });
        else {
          forgetLegacyGroups(regionId);
          groupsSync.settle(groups);
        }

        const saved = key ? localStorage.getItem(key) : null;
        const state = saved ? JSON.parse(saved) as Partial<SavedDialogState> : null;
        if (!isDialogState(state)) return;
        setAiSuggestions(new Map(state.aiSuggestions));
        setActiveTab(state.activeTab);
        setLastSavedAt(state.savedAt);
        setHasSavedState(true);
        if (state.singleRequestStats) setSingleRequestStats(state.singleRequestStats);
        if (state.batchRequestStats) setBatchRequestStats(state.batchRequestStats);
        if (state.lastOperation) {
          setLastOperation({ ...state.lastOperation, timestamp: new Date(state.lastOperation.timestamp) });
        }
      })
      .catch(e => {
        if (generation !== loadGeneration.current) return;
        // Nothing is saved over groups that could not be read: the sync waits for a settle.
        console.error('Failed to read the region\'s members or groups:', e);
        restoreState();
      });

    setLastRestoredRegionId(selectedRegion.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- regionMembers changes on every render; we only want to init on open/region change
  }, [open, selectedRegion, lastRestoredRegionId, getStorageKey, restoreState]);

  // When existingChildren arrive (async regions query), inject them as groups if missing
  const existingChildrenIds = existingChildren.map(r => r.id).join(',');
  useEffect(() => {
    if (!open || existingChildren.length === 0) return;

    setSubdivisionGroups(prev => {
      const existingIds = new Set(prev.map(g => g.existingRegionId).filter(Boolean));
      const missing = existingChildren.filter(r => !existingIds.has(r.id));
      if (missing.length === 0) return prev; // no change needed
      return [
        ...prev,
        ...missing.map(r => ({ name: r.name, members: [] as RegionMember[], existingRegionId: r.id })),
      ];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- existingChildrenIds is a stable string derived from existingChildren
  }, [open, existingChildrenIds]);

  // Reset tracking when dialog closes
  useEffect(() => {
    if (!open) {
      setLastRestoredRegionId(null);
      loadGeneration.current += 1;
    }
  }, [open]);

  // Auto-save state on changes (debounced)
  useEffect(() => {
    if (!open || !selectedRegion) return;

    const timer = setTimeout(() => {
      saveState();
    }, 1000);

    return () => clearTimeout(timer);
  }, [open, selectedRegion, unassignedDivisions, subdivisionGroups, aiSuggestions, activeTab, singleRequestStats, batchRequestStats, lastOperation, saveState]);

  // Preview a division's geometry
  const handlePreviewDivision = useCallback(async (div: RegionMember) => {
    setPreviewDivision({ id: div.id, name: div.name });
    setPreviewLoading(true);
    setPreviewGeometry(null);
    try {
      const geom = await fetchDivisionGeometry(div.id, { detail: 'medium' });
      setPreviewGeometry(geom?.geometry ?? null);
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
    // No save of the groups may land after they are dropped below.
    await groupsSync.stop();
    try {
      await expandToSubregions(selectedRegion.id, { inheritColor: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.regions.list(worldViewId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.regions.members(selectedRegion.id) });
      // Every member is a subregion of its own now, so the groups have nothing left to hold.
      await deleteRegionSubdivisionGroups(selectedRegion.id).catch(e => console.error('Failed to drop the groups:', e));
      onComplete();
    } catch (e) {
      console.error('Failed to quick expand:', e);
      groupsSync.resume();
    } finally {
      setIsQuickExpanding(false);
    }
  }, [selectedRegion, unassignedDivisions, subdivisionGroups, worldViewId, queryClient, onComplete, groupsSync]);

  // Create subregions from groups
  const handleCreateSubregions = useCallback(async () => {
    if (!selectedRegion) return;

    const sourceRegionId = selectedRegion.id;

    const buildMemberLookup = (dbMembers: Awaited<ReturnType<typeof fetchRegionMembers>>) => {
      const lookup = new Map<string, number>();
      for (const m of dbMembers) {
        if (m.memberRowId) {
          lookup.set(`${m.id}-${m.name}`, m.memberRowId);
        }
      }
      return lookup;
    };

    const resolveTargetRegionId = async (group: typeof subdivisionGroups[number]): Promise<number> => {
      if (group.existingRegionId) return group.existingRegionId;
      const newRegion = await createRegion(worldViewId, {
        name: group.name,
        parentRegionId: sourceRegionId,
        color: selectedRegion.color || undefined,
      });
      return newRegion.id;
    };

    const moveMember = async (
      member: typeof subdivisionGroups[number]['members'][number],
      targetRegionId: number,
      memberLookup: Map<string, number>,
    ) => {
      const realMemberRowId = memberLookup.get(`${member.id}-${member.name}`);
      if (realMemberRowId && realMemberRowId > 0) {
        await moveMemberToRegion(sourceRegionId, realMemberRowId, targetRegionId);
        return;
      }
      if (member.memberRowId && member.memberRowId > 0) {
        await moveMemberToRegion(sourceRegionId, member.memberRowId, targetRegionId);
        return;
      }
      await addDivisionsToRegion(targetRegionId, [member.id]);
      await removeDivisionsFromRegion(sourceRegionId, [member.id]);
    };

    setIsCreating(true);
    // No save of the groups may land after they are dropped below.
    await groupsSync.stop();
    try {
      const dbMembers = await fetchRegionMembers(sourceRegionId);
      const memberLookup = buildMemberLookup(dbMembers);

      for (const group of subdivisionGroups) {
        if (group.members.length === 0) continue;
        const targetRegionId = await resolveTargetRegionId(group);
        for (const member of group.members) {
          await moveMember(member, targetRegionId, memberLookup);
        }
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.regions.list(worldViewId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.regions.members(sourceRegionId) });

      clearSavedState();
      // The groups are subregions now; kept, they would come back as empty groups.
      await deleteRegionSubdivisionGroups(sourceRegionId).catch(e => console.error('Failed to drop the groups:', e));
      onComplete();
    } catch (e) {
      console.error('Failed to create subregions:', e);
      groupsSync.resume();
      alert('Failed to create subregions');
    } finally {
      setIsCreating(false);
    }
  }, [selectedRegion, subdivisionGroups, worldViewId, queryClient, clearSavedState, onComplete, groupsSync]);

  const aiTabDisabled = aiAvailable === false;


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
                  label={`Saved ${formatRelativeTime(lastSavedAt, 24 * 60 * 60 * 1000)}`}
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
          <ReferenceMapNotices overlay={overlay} regionName={selectedRegion?.name} />
          {groupsSync.error && <Alert severity="warning" sx={{ mb: 2 }}>{groupsSync.error}</Alert>}
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
              onApplyImageOverlay={overlay.apply}
              onRemoveImageOverlay={overlay.remove}
              regionMapUrl={selectedRegion?.regionMapUrl}
              worldViewId={worldViewId}
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
            <span>
              <Button
                variant="outlined"
                disabled={isCreating || isQuickExpanding || (unassignedDivisions.length + subdivisionGroups.reduce((sum, g) => sum + g.members.length, 0)) === 0}
                onClick={handleQuickExpand}
              >
                {isQuickExpanding ? 'Expanding...' : 'Quick Expand (1:1)'}
              </Button>
            </span>
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
