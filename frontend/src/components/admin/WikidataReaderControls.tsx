/**
 * Which Wikidata a source's runs read, on its card in the sync panel (#1459):
 * the live query service, or the local subset built from the entities dump
 * (ADR-0105). Drawn only for a source every question of which has a twin in
 * the subset (`subsetReady`); for any other, a switch would promise a run that
 * the server refuses. The next run applies it, and one that finds the subset
 * not built stops and says so.
 */

import { Alert, Box, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setWikidataReader, type ExperienceSource } from '../../api/admin';
import { queryKeys } from '../../api/queryKeys';

export function WikidataReaderControls({ source }: { source: ExperienceSource }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (reader: ExperienceSource['wikidataReader']) => setWikidataReader(source.id, reader),
    // The cache section reads the reader too: on the subset it names the dump
    // and keeps fewer kinds (ADR-0119), so an open section is read again.
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.sources }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.wikidataCache(source.id) }),
    ]),
  });
  if (!source.subsetReady) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="body2">Wikidata</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={source.wikidataReader}
          disabled={mutation.isPending}
          onChange={(_event, reader: ExperienceSource['wikidataReader'] | null) => { if (reader) mutation.mutate(reader); }}
          aria-label="Which Wikidata this source's runs read"
        >
          <ToggleButton value="live">Live service</ToggleButton>
          <ToggleButton value="subset">Local subset</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {source.wikidataReader === 'subset'
          ? 'Runs read the local copy built under Public Dumps, as of its dump date, and ask the live service nothing.'
          : 'Runs ask the live query service, which answers today\'s Wikidata and can time out.'}
      </Typography>
      {mutation.isError && <Alert severity="error" sx={{ mt: 1 }}>{(mutation.error as Error).message}</Alert>}
    </Box>
  );
}
