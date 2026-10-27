/**
 * Wikivoyage import source.
 *
 * Reads the Wikivoyage region hierarchy from English Wikivoyage's copy kept
 * from the monthly dump (#2089), enriches it with Wikidata IDs, then imports
 * and matches countries to administrative divisions. Extraction progress (and
 * the shared "existing world views" list) is polled by the parent panel under
 * the same query key this form reads the copy's date from — the two subscribe
 * to the same cache rather than duplicating a fetch.
 */

import {
  Alert,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  startWikivoyageExtraction,
  getExtractionStatus,
} from '../../../api/admin/wikivoyageExtract';
import type { ImportSourceFormProps } from './types';
import { queryKeys } from '../../../api/queryKeys';

export function WikivoyageForm({ worldViewName }: ImportSourceFormProps) {
  const queryClient = useQueryClient();

  // Poll extraction status (primary)
  const { data: extractStatus } = useQuery({
    queryKey: queryKeys.admin.wvExtractStatus,
    queryFn: getExtractionStatus,
    refetchInterval: (query) => {
      const st = query.state.data;
      if (st?.running) return 2000;
      return false;
    },
  });

  // Undefined until the status has answered; null when no copy is kept.
  const copy = extractStatus?.copy;

  const extractMutation = useMutation({
    mutationFn: () => startWikivoyageExtraction(worldViewName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.wvExtractStatus });
    },
  });

  return (
    <Stack spacing={2}>
      {extractMutation.isError && (
        <Alert severity="error">{(extractMutation.error as Error).message}</Alert>
      )}

      {copy === null && (
        <Alert severity="info">
          English Wikivoyage&apos;s articles are not kept yet. Build them under Public Dumps
          (<em>English Wikivoyage&apos;s articles</em>), then fetch from here.
        </Alert>
      )}

      <Button
        variant="contained"
        startIcon={<LanguageIcon />}
        onClick={() => extractMutation.mutate()}
        disabled={!worldViewName.trim() || !copy || extractMutation.isPending}
        size="large"
      >
        Fetch from Wikivoyage
      </Button>

      <Typography variant="caption" color="text.secondary">
        {copy
          ? <>Reads the region hierarchy from the <strong>{copy.dumpDate}</strong> copy of English Wikivoyage, </>
          : <>Reads the region hierarchy from the kept copy of English Wikivoyage, </>}
        enriches it with Wikidata IDs, then imports and matches countries to GADM divisions.
        Two fetches from one copy build the same tree.
      </Typography>
    </Stack>
  );
}
