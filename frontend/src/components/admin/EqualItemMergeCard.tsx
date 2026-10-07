/**
 * Places that are one place, made one (#1247, ADR-0046 decision 2, ADR-0086).
 *
 * Two sources that read one Wikidata item read one place — the Pantheon as a
 * place of worship and as an archaeological site — and the catalogue holds
 * them as two rows, two pins on one spot. This card runs the one pass that
 * merges every such pair into the place with the lower id, and shows what it
 * did: the places merged, and the ones it left apart with the reason. Each
 * merge can be undone from the place's history in its curation dialog.
 */

import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Collapse, Link, Stack, Typography } from '@mui/material';
import { ExpandLess, ExpandMore, MergeType as MergeIcon } from '@mui/icons-material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mergePlacesSharingAnItem, type EqualItemMerges } from '../../api/admin/placeMerges';
import { plural } from '../../utils/plural';
import { wikidataItemUrl } from '../../utils/wikidataLinks';

function ItemLink({ qid }: { qid: string }) {
  const url = wikidataItemUrl(qid);
  return url ? <Link href={url} target="_blank" rel="noopener noreferrer">{qid}</Link> : <>{qid}</>;
}

/** The pass's outcome in one sentence. */
function outcomeSentence({ merged, refused }: EqualItemMerges): string {
  if (merged.length === 0 && refused.length === 0) return 'No two places share a Wikidata item.';
  const apart = refused.length > 0 ? `; ${plural(refused.length, 'pair')} left apart` : '';
  return `${plural(merged.length, 'place')} merged into another${apart}.`;
}

function MergeReport({ report }: { report: EqualItemMerges }) {
  const [open, setOpen] = useState(false);
  const { merged, refused } = report;
  return (
    <Box sx={{ mt: 2 }}>
      <Alert severity={refused.length > 0 ? 'warning' : 'success'}>{outcomeSentence(report)}</Alert>
      {refused.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {refused.map(entry => (
            <Typography key={`${entry.qid}-${entry.placeIds.join('-')}`} variant="body2">
              {entry.name} (<ItemLink qid={entry.qid} />, places {entry.placeIds.join(' and ')}): {entry.error}
            </Typography>
          ))}
        </Stack>
      )}
      {merged.length > 0 && (
        <>
          <Button size="small" sx={{ mt: 1 }} onClick={() => setOpen(!open)} endIcon={open ? <ExpandLess /> : <ExpandMore />}>
            {open ? 'Hide the merged places' : 'Show the merged places'}
          </Button>
          <Collapse in={open}>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {merged.map(entry => (
                <Typography key={entry.mergeId} variant="body2">
                  {entry.name} (<ItemLink qid={entry.qid} />): place {entry.foldedId} into {entry.survivorId}
                </Typography>
              ))}
            </Stack>
          </Collapse>
        </>
      )}
    </Box>
  );
}

export function EqualItemMergeCard() {
  const queryClient = useQueryClient();
  const merge = useMutation({
    mutationFn: mergePlacesSharingAnItem,
    // Every list, map and card that drew the folded places draws the
    // survivors now, and the checks count them afresh.
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6">Places that are one place</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Two sources that read one Wikidata item read one place: the Pantheon as a place of worship and
          as an archaeological site. Merging makes each such pair one place — one pin, offered in both
          kinds — keeping the older row; travellers&apos; visits move with it. A pair in the same kind is
          left apart. Each merge can be undone from the place&apos;s history.
        </Typography>
        <Button
          variant="contained"
          startIcon={<MergeIcon />}
          disabled={merge.isPending}
          onClick={() => merge.mutate()}
        >
          {merge.isPending ? 'Merging…' : 'Merge places that share a Wikidata item'}
        </Button>
        {merge.isError && <Alert severity="error" sx={{ mt: 2 }}>{(merge.error as Error).message}</Alert>}
        {merge.data && <MergeReport report={merge.data} />}
      </CardContent>
    </Card>
  );
}
