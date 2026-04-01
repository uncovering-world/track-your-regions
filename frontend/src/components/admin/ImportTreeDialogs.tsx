import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  Checkbox,
  CircularProgress,
  Link as MuiLink,
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import MapGL, { NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { type searchDivisions } from '../../api/divisions';
import type {
  RenameDialogState,
  ReparentDialogState,
  SuggestChildrenState,
  DivisionSearchDialogState,
  GapAnalysisState,
  FlatRegionItem,
} from './useImportTreeDialogs';
import { GapDivisionTree, GapContextMap } from './GapAnalysis';
import { mergeGeometries, mergeGeomsIntoSibling } from './CvMatchMap';
import { type MatchTreeNode, type ReviewChildAction, getChildrenRegionGeometry } from '../../api/adminWorldViewImport';

export const COVERAGE_MAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Extracted to avoid re-rendering the entire tree on every keystroke */
export function ManualFixDialog({ state, onClose, onSubmit, isPending }: {
  state: { regionId: number; regionName: string } | null;
  onClose: () => void;
  onSubmit: (regionId: number, fixNote: string | undefined) => void;
  isPending: boolean;
}) {
  const [fixNote, setFixNote] = useState('');

  // Reset note when dialog opens with a new region
  const prevRegionId = state?.regionId;
  const [lastRegionId, setLastRegionId] = useState<number | undefined>();
  if (prevRegionId !== lastRegionId) {
    setLastRegionId(prevRegionId);
    if (prevRegionId != null) setFixNote('');
  }

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mark as Needing Manual Fix</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {state?.regionName}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          label="What needs to be fixed?"
          placeholder="e.g., Borders don't match GADM, need to split into sub-regions..."
          value={fixNote}
          onChange={(e) => setFixNote(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => {
            if (state) {
              onSubmit(state.regionId, fixNote || undefined);
              onClose();
            }
          }}
          disabled={isPending}
        >
          Mark for Fix
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Confirmation dialog for removing a region from the import tree */
export function RemoveRegionDialog({ state, onClose, onConfirm, isPending }: {
  state: { regionId: number; regionName: string; hasChildren: boolean; hasDivisions: boolean } | null;
  onClose: () => void;
  onConfirm: (regionId: number, reparentChildren: boolean, reparentDivisions: boolean) => void;
  isPending: boolean;
}) {
  const hasChildren = state?.hasChildren ?? false;
  const hasDivisions = state?.hasDivisions ?? false;

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Remove Region</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {state?.regionName}
        </Typography>
        {hasChildren && hasDivisions ? (
          <Typography variant="body2">
            This region has children and assigned divisions. Choose what to keep:
          </Typography>
        ) : hasChildren ? (
          <Typography variant="body2">
            This region has children. Choose what to do with them:
          </Typography>
        ) : hasDivisions ? (
          <Typography variant="body2">
            This region has assigned GADM divisions. Move them to the parent?
          </Typography>
        ) : (
          <Typography variant="body2">
            Remove this region from the import tree?
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {hasChildren ? (
          <>
            <Button
              variant="outlined"
              color="error"
              onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
              disabled={isPending}
            >
              Remove entire branch
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => { if (state) onConfirm(state.regionId, true, hasDivisions); }}
              disabled={isPending}
            >
              Move children{hasDivisions ? ' & divisions' : ''} up
            </Button>
          </>
        ) : hasDivisions ? (
          <>
            <Button
              variant="outlined"
              color="error"
              onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
              disabled={isPending}
            >
              Remove with divisions
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={() => { if (state) onConfirm(state.regionId, false, true); }}
              disabled={isPending}
            >
              Move divisions to parent
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            color="error"
            onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
            disabled={isPending}
          >
            Remove
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

const CHILD_COLORS = ['#3388ff', '#33aa55', '#9955cc', '#cc7733', '#5599dd', '#aa3366', '#55bb88', '#8866cc', '#dd5555', '#44bbaa', '#7766bb', '#bb8844'];

/** Right-side panel: children's divisions (unified or color-coded) or geoshape */
function CoverageRightPanel({ data, fitToAll }: {
  data: {
    regionId: number;
    worldViewId: number;
    childrenGeometry: GeoJSON.Geometry | null;
    geoshapeGeometry?: GeoJSON.Geometry | null;
  };
  fitToAll: (mapRef: React.RefObject<MapRef | null>) => void;
}) {
  const mapRef = useRef<MapRef>(null);
  const hasGeoshape = data.geoshapeGeometry != null;
  const hasChildren = data.childrenGeometry != null;

  // Color-coded children view
  const [rightMode, setRightMode] = useState<'unified' | 'colored'>('unified');
  const [childRegions, setChildRegions] = useState<Array<{ regionId: number; name: string; geometry: GeoJSON.Geometry }> | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset when region changes
  useEffect(() => { setRightMode('unified'); setChildRegions(null); }, [data.regionId]);

  const handleToggle = useCallback(async () => {
    setRightMode(prev => prev === 'colored' ? 'unified' : 'colored');
    if (rightMode !== 'unified' || childRegions) return; // toggling off, or already loaded
    setLoading(true);
    try {
      const result = await getChildrenRegionGeometry(data.worldViewId, data.regionId);
      setChildRegions(result.childRegions);
    } finally {
      setLoading(false);
    }
  }, [rightMode, childRegions, data.worldViewId, data.regionId]);

  const coloredChildren = useMemo(() =>
    (childRegions ?? []).map((c, i) => ({
      ...c,
      color: CHILD_COLORS[i % CHILD_COLORS.length],
      fc: {
        type: 'FeatureCollection' as const,
        features: [{ type: 'Feature' as const, properties: { name: c.name }, geometry: c.geometry }],
      },
    })),
  [childRegions]);

  let rightLabel = 'Wikidata geoshape (expected shape)';
  if (rightMode === 'colored') rightLabel = 'Subregions (color-coded)';
  else if (hasChildren) rightLabel = "Children's divisions (all descendants)";

  let buttonLabel = 'Color by subregion';
  if (loading) buttonLabel = 'Loading...';
  else if (rightMode === 'colored') buttonLabel = 'Show unified';

  if (!hasChildren && !hasGeoshape) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{rightLabel}</Typography>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography color="text.secondary">No data to compare</Typography>
        </Box>
      </Box>
    );
  }

  const geojsonData = hasChildren
    ? { type: 'Feature' as const, properties: {}, geometry: data.childrenGeometry! }
    : { type: 'Feature' as const, properties: {}, geometry: data.geoshapeGeometry! };
  const fillColor = hasChildren ? '#ff8833' : '#22c55e';
  const showColored = rightMode === 'colored' && hasChildren;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{rightLabel}</Typography>
        {hasChildren && (
          <Button
            size="small"
            variant={rightMode === 'colored' ? 'contained' : 'outlined'}
            onClick={handleToggle}
            disabled={loading}
            sx={{ fontSize: '0.7rem', py: 0.25, px: 1, minWidth: 0 }}
          >
            {buttonLabel}
          </Button>
        )}
      </Box>
      <MapGL
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
        style={{ width: '100%', flex: 1, minHeight: showColored ? 280 : 350 }}
        mapStyle={COVERAGE_MAP_STYLE}
        onLoad={() => fitToAll(mapRef)}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {showColored ? (
          coloredChildren.map((c, i) => (
            <Source key={`child-${c.regionId}`} id={`child-${i}`} type="geojson" data={c.fc}>
              <Layer id={`child-fill-${i}`} type="fill" paint={{ 'fill-color': c.color, 'fill-opacity': 0.45 }} />
              <Layer id={`child-outline-${i}`} type="line" paint={{ 'line-color': c.color, 'line-width': 1.5 }} />
            </Source>
          ))
        ) : (
          <Source id="right-geo" type="geojson" data={geojsonData}>
            <Layer id="right-fill" type="fill" paint={{ 'fill-color': fillColor, 'fill-opacity': 0.4 }} />
            <Layer id="right-outline" type="line" paint={{ 'line-color': fillColor, 'line-width': 2 }} />
          </Source>
        )}
      </MapGL>
      {showColored && coloredChildren.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, maxHeight: 60, overflow: 'auto' }}>
          {coloredChildren.map(c => (
            <Box key={c.regionId} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c.color, flexShrink: 0 }} />
              <Typography variant="caption" noWrap sx={{ maxWidth: 120 }}>{c.name}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Side-by-side map dialog comparing parent's own divisions vs children's divisions */
export function CoverageCompareDialog({ data, onClose, onAnalyzeGaps }: {
  data: {
    regionId: number;
    regionName: string;
    worldViewId: number;
    loading: boolean;
    parentGeometry: GeoJSON.Geometry | null;
    childrenGeometry: GeoJSON.Geometry | null;
    geoshapeGeometry?: GeoJSON.Geometry | null;
  } | null;
  onClose: () => void;
  onAnalyzeGaps?: (regionId: number) => void;
}) {
  const leftMapRef = useRef<MapRef>(null);

  const hasGeoshape = data?.geoshapeGeometry != null;
  const hasChildren = data?.childrenGeometry != null;

  // Fit both maps to the combined extent
  const allGeometries = [data?.parentGeometry, data?.childrenGeometry, data?.geoshapeGeometry].filter(Boolean) as GeoJSON.Geometry[];
  const combinedBbox = useMemo(() => {
    if (allGeometries.length === 0) return null;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: allGeometries.map(g => ({ type: 'Feature' as const, properties: {}, geometry: g })),
    };
    return turf.bbox(fc) as [number, number, number, number];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.parentGeometry, data?.childrenGeometry, data?.geoshapeGeometry]);

  const fitToAll = useCallback((mapRef: React.RefObject<MapRef | null>) => {
    if (!mapRef.current || !combinedBbox) return;
    mapRef.current.fitBounds([[combinedBbox[0], combinedBbox[1]], [combinedBbox[2], combinedBbox[3]]], { padding: 40, duration: 0 });
  }, [combinedBbox]);

  return (
    <Dialog open={data != null} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Coverage Comparison: {data?.regionName}</DialogTitle>
      <DialogContent>
        {data?.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 2, minHeight: 400 }}>
            {/* Left: assigned divisions + geoshape overlay */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Assigned divisions{hasGeoshape && hasChildren ? ' + geoshape outline' : ''}
              </Typography>
              {data?.parentGeometry ? (
                <MapGL
                  ref={leftMapRef}
                  initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
                  style={{ width: '100%', flex: 1, minHeight: 350 }}
                  mapStyle={COVERAGE_MAP_STYLE}
                  onLoad={() => fitToAll(leftMapRef)}
                >
                  <NavigationControl position="top-right" showCompass={false} />
                  <Source id="parent-geo" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data.parentGeometry }}>
                    <Layer id="parent-fill" type="fill" paint={{ 'fill-color': '#3388ff', 'fill-opacity': 0.4 }} />
                    <Layer id="parent-outline" type="line" paint={{ 'line-color': '#3388ff', 'line-width': 2 }} />
                  </Source>
                  {hasGeoshape && hasChildren && (
                    <Source id="geoshape-overlay" type="geojson" data={{ type: 'Feature', properties: {}, geometry: data.geoshapeGeometry! }}>
                      <Layer id="geoshape-overlay-outline" type="line" paint={{ 'line-color': '#22c55e', 'line-width': 2, 'line-dasharray': [4, 3] }} />
                    </Source>
                  )}
                </MapGL>
              ) : (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography color="text.secondary">No divisions assigned</Typography>
                </Box>
              )}
            </Box>

            {/* Right: children panel with unified/colored toggle */}
            {data && (
              <CoverageRightPanel data={data} fitToAll={fitToAll} />
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {onAnalyzeGaps && data && !data.loading && hasChildren && (
          <Button
            variant="outlined"
            size="small"
            onClick={() => { onAnalyzeGaps(data.regionId); onClose(); }}
            sx={{ mr: 'auto' }}
          >
            Find Gap Divisions
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Simple text-field dialog for renaming a region */
export function RenameRegionDialog({ state, onClose, onSubmit, onNameChange }: {
  state: RenameDialogState | null;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
}) {
  return (
    <Dialog open={state != null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename Region</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Region name"
          value={state?.newName ?? ''}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button onClick={onSubmit} variant="contained" size="small"
          disabled={!state?.newName.trim() || state?.newName.trim() === state?.currentName}>
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Autocomplete dialog for moving a region to a new parent */
export function ReparentRegionDialog({ state, onClose, onSubmit, onParentChange, flatRegionList }: {
  state: ReparentDialogState | null;
  onClose: () => void;
  onSubmit: () => void;
  onParentChange: (parentId: number | null) => void;
  flatRegionList: FlatRegionItem[];
}) {
  return (
    <Dialog open={state != null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Move &quot;{state?.regionName}&quot;</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Select new parent region:
        </Typography>
        <Autocomplete
          size="small"
          options={flatRegionList.filter(r => r.id !== state?.regionId)}
          getOptionLabel={(opt) => '\u00A0'.repeat(opt.depth * 2) + opt.name}
          value={flatRegionList.find(r => r.id === state?.selectedParentId) ?? null}
          onChange={(_e, val) => onParentChange(val?.id ?? null)}
          renderInput={(params) => <TextField {...params} label="Parent region" placeholder="Search regions..." />}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button onClick={onSubmit} variant="contained" size="small"
          disabled={state?.selectedParentId == null}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Dialog for adding a new child region by name */
export function AddChildDialog({ parentRegionId, name, onNameChange, onClose, onSubmit, isPending }: {
  parentRegionId: number | null;
  name: string;
  onNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={parentRegionId != null} onClose={onClose}>
      <DialogTitle>Add Child Region</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Region name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && parentRegionId) {
              onSubmit();
            }
          }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={!name.trim() || isPending}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Dialog showing AI-reviewed children actions grouped by type */
export function AISuggestChildrenDialog({ state, onClose, onToggle, onSubmit, isPending }: {
  state: SuggestChildrenState | null;
  onClose: () => void;
  onToggle: (key: string) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  if (!state) return null;

  const addActions = state.result.actions.filter(a => a.type === 'add');
  const removeActions = state.result.actions.filter(a => a.type === 'remove');
  const renameActions = state.result.actions.filter(a => a.type === 'rename');
  const enrichActions = state.result.actions.filter(a => a.type === 'enrich');

  const renderEnrichment = (action: ReviewChildAction) => {
    if (action.type === 'remove' || !action.verified) return null;
    return (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {action.sourceUrl && (
          <Typography variant="caption" color="text.secondary">
            <LinkIcon sx={{ fontSize: 12, mr: 0.25, verticalAlign: 'middle' }} />
            <MuiLink href={action.sourceUrl} target="_blank" rel="noopener" sx={{ fontSize: 'inherit' }}>
              {decodeURIComponent(action.sourceUrl.split('/wiki/')[1] ?? '')}
            </MuiLink>
          </Typography>
        )}
        {action.sourceExternalId && (
          <Typography variant="caption" color="text.secondary">
            <MuiLink
              href={`https://www.wikidata.org/wiki/${action.sourceExternalId}`}
              target="_blank"
              rel="noopener"
              sx={{ fontSize: 'inherit' }}
            >
              {action.sourceExternalId}
            </MuiLink>
          </Typography>
        )}
      </Box>
    );
  };

  const renderSection = (
    title: string,
    actions: ReviewChildAction[],
    color: string,
  ) => {
    if (actions.length === 0) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" color={color} sx={{ mb: 0.5 }}>
          {title} ({actions.length})
        </Typography>
        {actions.map((a) => {
          const key = `${a.type}:${a.name}`;
          return (
            <Box key={key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.5 }}>
              <Checkbox
                size="small"
                checked={state.selected.has(key)}
                onChange={() => onToggle(key)}
                sx={{ p: 0.25, mt: 0.25 }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                  {a.type === 'rename' ? (
                    <>{a.name} <ArrowForwardIcon sx={{ fontSize: 14, verticalAlign: 'middle', mx: 0.5 }} /> {a.newName}</>
                  ) : (
                    a.name
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">{a.reason}</Typography>
                {renderEnrichment(a)}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Review Children for &quot;{state.regionName}&quot;</DialogTitle>
      <DialogContent>
        {state.result.analysis && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {state.result.analysis}
          </Typography>
        )}
        {state.result.actions.length === 0 && (
          <Typography variant="body2">All children look correct — no changes suggested.</Typography>
        )}
        {renderSection('Add', addActions, 'success.main')}
        {renderSection('Remove', removeActions, 'error.main')}
        {renderSection('Rename', renameActions, 'warning.main')}
        {renderSection('Enrich', enrichActions, 'info.main')}
        {state.result.stats && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            {(state.result.stats.inputTokens + state.result.stats.outputTokens).toLocaleString()} tokens
            {' \u00b7 '}${state.result.stats.cost.toFixed(4)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!state.selected.size || isPending}
          onClick={onSubmit}
        >
          Apply {state.selected.size} Selected
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Autocomplete search dialog for manually assigning a GADM division to a region */
export function DivisionSearchDialog({ state, onClose, onSelect, query, results, loading, onInputChange }: {
  state: DivisionSearchDialogState | null;
  onClose: () => void;
  onSelect: (divisionId: number) => void;
  query: string;
  results: Awaited<ReturnType<typeof searchDivisions>>;
  loading: boolean;
  onInputChange: (_e: unknown, value: string) => void;
}) {
  return (
    <Dialog
      open={state != null}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Assign Division to &quot;{state?.regionName}&quot;</DialogTitle>
      <DialogContent>
        <Autocomplete
          size="small"
          options={results}
          getOptionLabel={(opt) => `${opt.name} (${opt.path})`}
          filterOptions={(x) => x}
          inputValue={query}
          onInputChange={onInputChange}
          loading={loading}
          onChange={(_e, val) => {
            if (val && state) {
              onSelect(val.id);
            }
          }}
          renderOption={(props, opt) => (
            <li {...props} key={opt.id}>
              <Box>
                <Typography variant="body2">{opt.name}</Typography>
                <Typography variant="caption" color="text.secondary">{opt.path}</Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search GADM divisions"
              placeholder="Type at least 2 characters..."
              autoFocus
              sx={{ mt: 1 }}
            />
          )}
          noOptionsText={query.length < 2 ? 'Type at least 2 characters' : 'No divisions found'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Full-screen dialog for coverage gap analysis with map and division tree */
export function GapAnalysisDialog({ state, tree, worldViewId, highlightedGapId, setHighlightedGapId, gapMapSelectedRegionId, setGapMapSelectedRegionId, onClose, setLastMutatedRegionId, acceptAllMutation, addChildMutation, isMutating }: {
  state: GapAnalysisState | null;
  tree: MatchTreeNode[] | undefined;
  worldViewId: number;
  highlightedGapId: number | null;
  setHighlightedGapId: React.Dispatch<React.SetStateAction<number | null>>;
  gapMapSelectedRegionId: number | null;
  setGapMapSelectedRegionId: React.Dispatch<React.SetStateAction<number | null>>;
  onClose: () => void;
  setLastMutatedRegionId: (id: number) => void;
  acceptAllMutation: { mutate: (assignments: Array<{ regionId: number; divisionId: number }>) => void };
  addChildMutation: { mutate: (args: { parentRegionId: number; name: string }, opts?: { onSuccess?: (result: { regionId: number } | undefined) => void }) => void; isPending: boolean };
  isMutating: boolean;
}) {
  // Local state setter used from callbacks to remove gaps after assignment.
  // Syncs from external state on open and when loading completes, but preserves
  // local modifications (e.g. removed gaps) while not loading.
  const [localState, setLocalState] = useState<GapAnalysisState | null>(null);
  const localModified = useRef(false);

  // Sync external state → local state when region changes or loading status changes
  useEffect(() => {
    if (!state) { setLocalState(null); localModified.current = false; return; }
    // Always sync loading state and fresh results; only skip if user made local edits
    if (state.loading || !localModified.current) {
      setLocalState(state);
    }
  }, [state?.regionId, state?.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveState = localState?.regionId === state?.regionId ? localState : state;

  if (!effectiveState) return null;

  const subtreeRegions = (() => {
    if (!tree) return [];
    const findNode = (nodes: MatchTreeNode[]): MatchTreeNode | null => {
      for (const n of nodes) {
        if (n.id === effectiveState.regionId) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    const parent = findNode(tree);
    if (!parent) return [];
    const result: Array<{ id: number; name: string; depth: number }> = [];
    const walk = (nodes: MatchTreeNode[], depth: number) => {
      for (const n of nodes) {
        result.push({ id: n.id, name: n.name, depth });
        walk(n.children, depth + 1);
      }
    };
    walk(parent.children, 0);
    return result;
  })();

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: '90vh', display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle sx={{ pb: 1, flexShrink: 0 }}>Coverage Gap Analysis: {effectiveState.regionName}</DialogTitle>
      {/* Top: source image + context map side by side (sticky) */}
      <Box sx={{ display: 'flex', gap: 1, px: 3, pb: 1, flexShrink: 0, minHeight: 0 }}>
        {effectiveState.regionMapUrl && (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              component="img"
              src={`${effectiveState.regionMapUrl}?width=800`}
              alt={`${effectiveState.regionName} region map`}
              sx={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 1, border: 1, borderColor: 'divider' }}
            />
          </Box>
        )}
        {!effectiveState.loading && effectiveState.gapDivisions.length > 0 && (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <GapContextMap
              gapDivisions={effectiveState.gapDivisions}
              siblingRegions={effectiveState.siblingRegions}
              worldViewId={worldViewId}
              highlightedGapId={highlightedGapId}
              onHighlight={setHighlightedGapId}
              selectedRegionId={gapMapSelectedRegionId}
              onRegionSelect={(regionId) => setGapMapSelectedRegionId(regionId)}
            />
          </Box>
        )}
      </Box>
      {/* Bottom: scrollable gap list */}
      <DialogContent sx={{ flex: 1, overflow: 'auto', pt: 1 }}>
        {effectiveState.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : effectiveState.gapDivisions.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No gap divisions found.
          </Typography>
        ) : (
          <GapDivisionTree
            gapDivisions={effectiveState.gapDivisions}
            parentRegionId={effectiveState.regionId}
            parentRegionName={effectiveState.regionName}
            mapSelectedRegionId={gapMapSelectedRegionId}
            subtreeRegions={subtreeRegions}
            worldViewId={worldViewId}
            highlightedGapId={highlightedGapId}
            onHighlight={setHighlightedGapId}
            isMutating={isMutating}
            onAssign={(gap, descendantIds, targetRegionId) => {
              setLastMutatedRegionId(targetRegionId);
              acceptAllMutation.mutate([{
                regionId: targetRegionId,
                divisionId: gap.divisionId,
              }]);
              const removeIds = new Set([gap.divisionId, ...descendantIds]);
              const removedGeoms = effectiveState.gapDivisions
                .filter(d => removeIds.has(d.divisionId) && d.geometry)
                .map(d => d.geometry!);
              localModified.current = true;
              setLocalState(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  gapDivisions: prev.gapDivisions.filter(d => !removeIds.has(d.divisionId)),
                  siblingRegions: mergeGeomsIntoSibling(prev.siblingRegions, targetRegionId, removedGeoms),
                };
              });
            }}
            onNewRegion={(gap, descendantIds) => {
              if (!effectiveState) return;
              addChildMutation.mutate(
                { parentRegionId: effectiveState.regionId, name: gap.name },
                {
                  onSuccess: (newRegion) => {
                    if (newRegion?.regionId) {
                      setLastMutatedRegionId(newRegion.regionId);
                      acceptAllMutation.mutate([{
                        regionId: newRegion.regionId,
                        divisionId: gap.divisionId,
                      }]);
                    }
                    const removeIds = new Set([gap.divisionId, ...descendantIds]);
                    const removedGeoms = effectiveState.gapDivisions
                      .filter(d => removeIds.has(d.divisionId) && d.geometry)
                      .map(d => d.geometry!);
                    const mergedGeom = mergeGeometries(removedGeoms);
                    setLocalState(prev => {
                      if (!prev) return prev;
                      const newSiblings = mergedGeom && newRegion?.regionId
                        ? [...prev.siblingRegions, { regionId: newRegion.regionId, name: gap.name, geometry: mergedGeom }]
                        : prev.siblingRegions;
                      return {
                        ...prev,
                        gapDivisions: prev.gapDivisions.filter(d => !removeIds.has(d.divisionId)),
                        siblingRegions: newSiblings,
                      };
                    });
                  },
                },
              );
            }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
