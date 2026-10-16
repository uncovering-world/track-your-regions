/**
 * A region picked by name within a world view: the world view menu, shown when there is
 * more than one, and a search over its regions by name and path.
 *
 * Shared by the admin's two region questions — the scope of a curator assignment and the
 * region the curation activity feed narrows to (#611) — so both search the same way.
 * The first non-default world view is picked on its own, as the assignment dialog
 * always did: GADM's tree is rarely the one a curator's scope or a feed means.
 */

import { useState } from 'react';
import {
  Autocomplete, Box, FormControl, InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { fetchWorldViews } from '../../api/worldViews';
import { searchRegions, type RegionSearchResult } from '../../api/regions';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../api/queryKeys';

export function RegionSearchPicker({
  value,
  onChange,
  required = false,
  size,
}: {
  value: RegionSearchResult | null;
  onChange: (region: RegionSearchResult | null) => void;
  required?: boolean;
  size?: 'small' | 'medium';
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [worldViewId, setWorldViewId] = useState<number | null>(null);

  const { data: worldViews } = useQuery({
    // Same rule as useNavigation: this list is filtered by visibility, so it
    // is cached per identity. Sharing the key also shares the entry, which is
    // why this does not refetch what navigation already has.
    queryKey: queryKeys.worldViews.forCaller(user?.id),
    queryFn: fetchWorldViews,
  });

  const { data: results, isFetching } = useQuery({
    queryKey: queryKeys.admin.regionSearch(worldViewId, query),
    queryFn: () => searchRegions(worldViewId!, query),
    enabled: !!worldViewId && query.length >= 2,
  });

  if (worldViews?.length && !worldViewId) {
    const custom = worldViews.find((wv) => !(wv as { isDefault?: boolean }).isDefault);
    setWorldViewId(custom?.id ?? worldViews[0].id);
  }

  return (
    <>
      {worldViews && worldViews.length > 1 && (
        <FormControl fullWidth size="small">
          <InputLabel>World View</InputLabel>
          <Select
            value={worldViewId ?? ''}
            label="World View"
            onChange={(e) => {
              setWorldViewId(Number(e.target.value));
              onChange(null);
              setQuery('');
            }}
          >
            {worldViews.map((wv) => (
              <MenuItem key={wv.id} value={wv.id}>
                {wv.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      <Autocomplete
        options={results ?? []}
        getOptionLabel={(opt) => opt.path || opt.name}
        value={value}
        onChange={(_, next) => onChange(next)}
        onInputChange={(_, next) => setQuery(next)}
        loading={isFetching}
        disabled={!worldViewId}
        size={size}
        fullWidth
        renderOption={(props, opt) => (
          <li {...props} key={opt.id}>
            <Box>
              <Typography variant="body2">{opt.name}</Typography>
              {opt.path && opt.path !== opt.name && (
                <Typography variant="caption" color="text.secondary">
                  {opt.path}
                </Typography>
              )}
            </Box>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Search Region"
            placeholder="Type region name..."
            required={required}
          />
        )}
      />
    </>
  );
}
