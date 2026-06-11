import { useMemo, useState } from 'react';
import { Box, List, ListSubheader, TextField } from '@mui/material';
import type { DashboardUnit } from '../../../api/admin/wvImportWorkflow';
import { groupUnitsByContinent, findDuplicateSourceUrls } from './dashboardUtils';
import { CountryRow } from './CountryRow';

export function CountriesTab({ worldViewId, units }: { worldViewId: number; units: DashboardUnit[] }) {
  const [filter, setFilter] = useState('');
  const dupes = useMemo(() => findDuplicateSourceUrls(units), [units]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const visible = f ? units.filter(u => u.name.toLowerCase().includes(f)) : units;
    return groupUnitsByContinent(visible);
  }, [units, filter]);

  return (
    <Box>
      <TextField
        size="small"
        placeholder="Filter countries…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        sx={{ mb: 1, width: 280 }}
      />
      <List dense disablePadding>
        {groups.map(g => (
          <Box key={g.continent}>
            <ListSubheader disableSticky>{g.continent}</ListSubheader>
            {g.units.map(u => (
              <CountryRow
                key={u.regionId}
                worldViewId={worldViewId}
                unit={u}
                isDuplicate={!!u.sourceUrl && dupes.has(u.sourceUrl)}
              />
            ))}
          </Box>
        ))}
      </List>
    </Box>
  );
}
