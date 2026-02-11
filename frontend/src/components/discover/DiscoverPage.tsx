/**
 * DiscoverPage — Three-panel layout for tree-based experience browsing.
 *
 * Layout:
 *   Left (380px)  — world view switcher + breadcrumbs + region tree with source count badges
 *   Center (flex)  — persistent map + experience list (when a source badge is clicked)
 *   Right (~480px) — detail panel that slides in without dimming, pushing center narrower
 */

import { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Experience } from '../../api/experiences';
import type { CuratorScope } from '../../types/auth';
import { authFetchJson } from '../../api/fetchUtils';
import { CurationDialog } from '../shared/CurationDialog';
import { AddExperienceDialog } from '../shared/AddExperienceDialog';
import {
  Box,
  Select,
  MenuItem,
  Chip,
  Breadcrumbs,
  Link,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useDiscoverExperiences } from '../../hooks/useDiscoverExperiences';
import { useAuth } from '../../hooks/useAuth';
import { DiscoverRegionList } from './DiscoverRegionList';
import { DiscoverExperienceView } from './DiscoverExperienceView';
import { ExperienceDetailPanel } from './ExperienceDetailPanel';

const API_URL = import.meta.env.VITE_API_URL || '';

const LEFT_PANEL_WIDTH = 380;
const DETAIL_PANEL_WIDTH = 480;

/** Auto-assign colors for source summary chips (same palette as DiscoverRegionList) */
const SOURCE_PALETTE = [
  '#0d9488', '#7C3AED', '#D97706', '#2563EB', '#DC2626', '#059669',
  '#9333EA', '#CA8A04', '#0891B2', '#BE185D', '#4F46E5', '#EA580C',
];

function getCategoryColor(categoryId: number): string {
  return SOURCE_PALETTE[categoryId % SOURCE_PALETTE.length];
}

function shortSourceName(name: string): string {
  return name
    .replace('UNESCO World Heritage Sites', 'UNESCO')
    .replace('Top Museums', 'Museums')
    .replace('Public Art & Monuments', 'Art');
}

export function DiscoverPage() {
  const {
    worldViews,
    selectedWorldView,
    changeWorldView,
    breadcrumbs,
    regionCounts,
    countsLoading,
    navigateToRegion,
    navigateToBreadcrumb,
    categories,
    activeCategories,
    levelTotals,
    activeView,
    openExperienceView,
    closeExperienceView,
    experiences,
    experiencesLoading,
    selectedExperienceId,
    setSelectedExperienceId,
    selectedExperienceLocations,
  } = useDiscoverExperiences();

  const { isCurator, isAdmin } = useAuth();

  // Fetch curator scopes (for determining which regions show "+" button)
  const { data: curatorScopes } = useQuery({
    queryKey: ['curator-scopes'],
    queryFn: () => authFetchJson<{ curatorScopes?: CuratorScope[] }>(`${API_URL}/api/users/me`)
      .then(data => data.curatorScopes ?? []),
    enabled: isCurator,
    staleTime: 300_000,
  });

  // Compute scope-aware canAddToRegion function
  const canAddToRegion = useMemo(() => {
    if (!isCurator) return undefined; // not a curator → no "+" button at all

    // Admins have implicit global scope
    if (isAdmin) return (_regionId: number) => true;

    const scopes = curatorScopes ?? [];
    if (scopes.length === 0) return undefined;

    // Global or category scope → can add to any region
    const hasGlobalOrCategoryScope = scopes.some(
      s => s.scopeType === 'global' || s.scopeType === 'category'
    );
    if (hasGlobalOrCategoryScope) return (_regionId: number) => true;

    // Region-scoped: check if any breadcrumb ancestor or the region itself is assigned
    const curatorRegionIds = new Set(
      scopes.filter(s => s.scopeType === 'region' && s.regionId != null).map(s => s.regionId!)
    );
    // If any breadcrumb is in the curator's region assignments, all descendants are in scope
    const ancestorInScope = breadcrumbs.some(bc => bc.regionId != null && curatorRegionIds.has(bc.regionId));

    if (ancestorInScope) return (_regionId: number) => true;

    // Per-region check: only the specific assigned regions
    return (regionId: number) => curatorRegionIds.has(regionId);
  }, [isCurator, isAdmin, curatorScopes, breadcrumbs]);

  const selectedExperience = useMemo(() => {
    if (selectedExperienceId == null) return null;
    return experiences.find(e => e.id === selectedExperienceId) ?? null;
  }, [selectedExperienceId, experiences]);

  const availableWorldViews = useMemo(
    () => worldViews.filter(wv => !wv.isDefault),
    [worldViews],
  );

  // Curation dialog state (for detail panel curate button)
  const [detailCurationTarget, setDetailCurationTarget] = useState<Experience | null>(null);

  // Add experience dialog state (for tree-level "+" button)
  const [addTarget, setAddTarget] = useState<{ regionId: number; regionName: string } | null>(null);
  const handleAddExperience = useCallback((regionId: number, regionName: string) => {
    setAddTarget({ regionId, regionName });
  }, []);

  // Location hover from detail panel → map hover ring
  const [hoveredLocationCoords, setHoveredLocationCoords] = useState<{ lng: number; lat: number } | null>(null);
  const handleHoverLocation = useCallback((coords: { lng: number; lat: number } | null) => {
    setHoveredLocationCoords(coords);
  }, []);

  // Highlight dot hover on map → location list auto-scroll
  const [hoveredLocationId, setHoveredLocationId] = useState<number | null>(null);

  const detailOpen = selectedExperienceId !== null && selectedExperience !== null;

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* ── Left Panel: Tree Navigation ── */}
      <Box
        sx={{
          width: LEFT_PANEL_WIDTH,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {/* World view selector */}
        {availableWorldViews.length > 1 && (
          <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Select
              value={selectedWorldView?.id || ''}
              onChange={(e) => {
                const wv = availableWorldViews.find(w => w.id === e.target.value);
                if (wv) changeWorldView(wv);
              }}
              size="small"
              fullWidth
              sx={{ fontSize: '0.85rem' }}
            >
              {availableWorldViews.map(wv => (
                <MenuItem key={wv.id} value={wv.id} sx={{ fontSize: '0.85rem' }}>
                  {wv.name}
                </MenuItem>
              ))}
            </Select>
          </Box>
        )}

        {/* Breadcrumbs */}
        <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Breadcrumbs
            separator={<NavigateNextIcon sx={{ fontSize: 14 }} />}
            sx={{ '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
          >
            <Link
              component="button"
              underline="hover"
              color={breadcrumbs.length === 0 ? 'text.primary' : 'inherit'}
              onClick={() => navigateToBreadcrumb(-1)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontSize: '0.8rem',
                fontWeight: breadcrumbs.length === 0 ? 600 : 400,
              }}
            >
              <HomeIcon sx={{ fontSize: 16 }} />
              {selectedWorldView?.name || 'Root'}
            </Link>
            {breadcrumbs.map((bc, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <Link
                  key={`${bc.regionId}-${i}`}
                  component="button"
                  underline={isLast ? 'none' : 'hover'}
                  color={isLast ? 'text.primary' : 'inherit'}
                  onClick={() => navigateToBreadcrumb(i)}
                  sx={{
                    fontSize: '0.8rem',
                    fontWeight: isLast ? 600 : 400,
                    maxWidth: 150,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {bc.regionName}
                </Link>
              );
            })}
          </Breadcrumbs>
        </Box>

        {/* Level summary — total counts per source */}
        {!countsLoading && Object.keys(levelTotals).length > 0 && (
          <Box sx={{ px: 1.5, py: 0.75, display: 'flex', gap: 0.75, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider' }}>
            {activeCategories.map(source => {
              const count = levelTotals[source.id] || 0;
              if (!count) return null;
              const color = getCategoryColor(source.id);
              return (
                <Chip
                  key={source.id}
                  label={`${shortSourceName(source.name)} ${count}`}
                  size="small"
                  sx={{
                    height: 24,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color,
                    bgcolor: `${color}12`,
                    border: `1px solid ${color}30`,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              );
            })}
          </Box>
        )}

        {/* Region tree list */}
        <DiscoverRegionList
          regions={regionCounts}
          categories={categories}
          isLoading={countsLoading}
          onNavigate={navigateToRegion}
          onCategoryClick={openExperienceView}
          onAddExperience={canAddToRegion ? handleAddExperience : undefined}
          canAddToRegion={canAddToRegion}
        />
      </Box>

      {/* ── Center Panel: Map + Experience List (always visible, shrinks when detail opens) ── */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          transition: 'margin-right 0.3s ease',
          marginRight: detailOpen ? `${DETAIL_PANEL_WIDTH}px` : 0,
        }}
      >
        <DiscoverExperienceView
          activeView={activeView}
          experiences={experiences}
          isLoading={experiencesLoading}
          onBack={closeExperienceView}
          onSelectExperience={setSelectedExperienceId}
          selectedExperienceId={selectedExperienceId}
          selectedExperienceLocations={selectedExperienceLocations}
          externalHoverCoords={hoveredLocationCoords}
          onHoverHighlightLocation={setHoveredLocationId}
        />
      </Box>

      {/* ── Right Panel: Detail (slides in, no backdrop, push layout) ── */}
      <Box
        sx={{
          position: 'fixed',
          top: 64,
          right: 0,
          bottom: 0,
          width: DETAIL_PANEL_WIDTH,
          bgcolor: 'background.paper',
          borderLeft: '1px solid',
          borderColor: 'divider',
          boxShadow: detailOpen ? '-4px 0 16px rgba(0,0,0,0.08)' : 'none',
          transform: detailOpen ? 'translateX(0)' : `translateX(${DETAIL_PANEL_WIDTH}px)`,
          transition: 'transform 0.3s ease',
          zIndex: 3,
          overflowY: 'auto',
        }}
      >
        {selectedExperience && (
          <ExperienceDetailPanel
            experience={selectedExperience}
            onClose={() => setSelectedExperienceId(null)}
            onHoverLocation={handleHoverLocation}
            hoveredLocationId={hoveredLocationId}
            onCurate={isCurator ? () => setDetailCurationTarget(selectedExperience) : undefined}
          />
        )}
      </Box>

      {/* Curation Dialog (from detail panel) */}
      <CurationDialog
        experience={detailCurationTarget}
        regionId={activeView?.regionId ?? null}
        onClose={() => setDetailCurationTarget(null)}
      />

      {/* Add Experience Dialog (from tree-level "+" button) */}
      {addTarget && (
        <AddExperienceDialog
          open={!!addTarget}
          onClose={() => setAddTarget(null)}
          regionId={addTarget.regionId}
          regionName={addTarget.regionName}
        />
      )}
    </Box>
  );
}
