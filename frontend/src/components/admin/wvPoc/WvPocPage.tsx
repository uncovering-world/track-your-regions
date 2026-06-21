import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Typography, List, ListItemButton, ListItemText, Chip, Alert, CircularProgress } from '@mui/material';
import { useAuth } from '../../../hooks/useAuth';
import { getWorkflowDashboard, type DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import { computeLevelProgress, type LevelId } from './wvPocLevels';
import { LevelSwitcher } from './LevelSwitcher';

export function WvPocPage() {
  const { worldViewId: wvParam } = useParams<{ worldViewId?: string }>();
  const worldViewId = parseInt(wvParam ?? '');
  const navigate = useNavigate();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [level, setLevel] = useState<LevelId>('l2');

  const { data, isLoading } = useQuery({
    queryKey: ['wvPocDashboard', worldViewId],
    queryFn: () => getWorkflowDashboard(worldViewId),
    enabled: Number.isFinite(worldViewId) && isAdmin,
  });

  const units: DashboardUnit[] = useMemo(() => data?.units ?? [], [data]);
  const progress = useMemo(() => computeLevelProgress(units), [units]);

  const byContinent = useMemo(() => {
    const m = new Map<string, DashboardUnit[]>();
    for (const u of units) {
      const c = u.continent ?? (u.ancestorPath[0] ?? 'Ungrouped');
      (m.get(c) ?? m.set(c, []).get(c)!).push(u);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [units]);

  if (authLoading || isLoading) return <Box sx={{ p: 4 }}><CircularProgress /></Box>;
  if (!isAdmin) return <Box sx={{ p: 4 }}><Alert severity="error">Admin only.</Alert></Box>;
  if (!Number.isFinite(worldViewId)) return <Box sx={{ p: 4 }}><Alert severity="error">Bad world view id.</Alert></Box>;

  const openCountry = (regionId: number) => navigate(`/admin/import/${worldViewId}/region/${regionId}`);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h6">World View {worldViewId} — build (POC)</Typography>
        <LevelSwitcher value={level} onChange={setLevel} progress={progress} />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {level === 'l1' && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>Supra-national — countries grouped by continent (view-only in this POC slice)</Typography>
            {byContinent.map(([continent, list]) => (
              <Box key={continent} sx={{ mb: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{continent} · {list.length}</Typography>
                <Typography variant="caption" color="text.secondary">{list.map((u) => u.name).join(', ')}</Typography>
              </Box>
            ))}
          </Box>
        )}

        {level === 'l2' && (
          <List dense>
            {units.map((u) => (
              <ListItemButton key={u.regionId} onClick={() => openCountry(u.regionId)}>
                <ListItemText primary={u.name} secondary={u.continent ?? u.ancestorPath.join(' › ')} />
                <Chip size="small" label={u.signoffStatus} />
              </ListItemButton>
            ))}
          </List>
        )}

        {level === 'l3' && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>Pick a country to open its sub-national workspace (the existing country workspace).</Alert>
            <List dense>
              {units.map((u) => (
                <ListItemButton key={u.regionId} onClick={() => openCountry(u.regionId)}>
                  <ListItemText primary={u.name} secondary={`${u.leafResolved}/${u.leafTotal} leaves`} />
                </ListItemButton>
              ))}
            </List>
          </Box>
        )}
      </Box>
    </Box>
  );
}
