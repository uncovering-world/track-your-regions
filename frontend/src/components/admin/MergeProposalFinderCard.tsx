/**
 * Near places with similar names, proposed as one place (#1249, ADR-0046
 * decision 2).
 *
 * Two places whose nearest points stand within reach of each other and whose
 * names are alike may be one place shown twice — the Statue of Liberty as a
 * World Heritage site and as public art — a part inside a whole, or two
 * neighbours. This card runs the pass that proposes every such pair for a
 * person to answer — which of the three — and shows what the pass found:
 * the pairs still open, how many have been answered and how, and the pairs
 * in one kind the rule left apart, since one place cannot be in a kind twice.
 */

import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Collapse, Stack, Typography } from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/TravelExplore';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { findPlacesThatMayBeOne, type MergeProposalPass } from '../../api/admin/mergeProposals';
import { plural } from '../../utils/plural';

type OpenPair = MergeProposalPass['open'][number];
type LeftApart = MergeProposalPass['leftApart'][number];

/** One pair in a line: both places with their kinds, the distance and how alike the names are. */
function pairLine(pair: OpenPair | LeftApart): string {
  const kinds = (names: string[]) => (names.length > 0 ? ` (${names.join(', ')})` : '');
  const within = 'foundBy' in pair && pair.foundBy === 'words' ? ', one name within the other' : '';
  return `${pair.placeA.name}${kinds(pair.placeA.kinds)} and ${pair.placeB.name}${kinds(pair.placeB.kinds)}: `
    + `${pair.distanceM} m apart, names alike at ${Math.round(pair.nameSimilarity * 100)} %${within}`;
}

/** The pass's outcome in one sentence. */
function outcomeSentence({ open, answered, leftApart, foundBy }: MergeProposalPass): string {
  const answeredCount = answered.one + answered.two + answered.partOf;
  const within = foundBy.words > 0 ? ` (${foundBy.words} by one name standing within the other)` : '';
  const parts = [
    open.length === 0 ? 'No pair waits for a person' : `${plural(open.length, 'pair')} wait for a person${within}`,
  ];
  if (answeredCount > 0) {
    parts.push(`${plural(answeredCount, 'pair')} answered so far: ${answered.one} one place, ${answered.two} two places, ${answered.partOf} part of the other`);
  }
  if (leftApart.length > 0) parts.push(`${plural(leftApart.length, 'pair')} in one kind left apart`);
  return `${parts.join('; ')}.`;
}

function PairList({ title, pairs, keyOf }: { title: string; pairs: (OpenPair | LeftApart)[]; keyOf: (pair: OpenPair | LeftApart, index: number) => string }) {
  const [open, setOpen] = useState(false);
  if (pairs.length === 0) return null;
  return (
    <>
      <Button size="small" sx={{ mt: 1 }} onClick={() => setOpen(!open)} endIcon={open ? <ExpandLess /> : <ExpandMore />}>
        {open ? `Hide ${title}` : `Show ${title}`}
      </Button>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {pairs.map((pair, index) => (
            <Typography key={keyOf(pair, index)} variant="body2">{pairLine(pair)}</Typography>
          ))}
        </Stack>
      </Collapse>
    </>
  );
}

function PassReport({ report }: { report: MergeProposalPass }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Alert severity={report.open.length > 0 ? 'info' : 'success'}>{outcomeSentence(report)}</Alert>
      <PairList title="the open pairs" pairs={report.open} keyOf={pair => String((pair as OpenPair).id)} />
      <PairList title="the pairs left apart" pairs={report.leftApart} keyOf={(pair, index) => `${pair.placeA.name}-${index}`} />
    </Box>
  );
}

export function MergeProposalFinderCard() {
  const queryClient = useQueryClient();
  const pass = useMutation({
    mutationFn: findPlacesThatMayBeOne,
    // The checks below count the proposals afresh.
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6">Places that may be one place</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Two places within reach of each other with names alike enough — the Statue of Liberty as a World
          Heritage site and as public art, Durham Cathedral beside the site &quot;Durham Castle and
          Cathedral&quot; — are proposed as one place and listed for a person to answer: one place, two
          places, or one part of the other. A pair answered once is never proposed again. A pair in the
          same kind is left apart, since one place cannot be in a kind twice.
        </Typography>
        <Button
          variant="contained"
          startIcon={<SearchIcon />}
          disabled={pass.isPending}
          onClick={() => pass.mutate()}
        >
          {pass.isPending ? 'Looking…' : 'Propose near places with similar names'}
        </Button>
        {pass.isError && <Alert severity="error" sx={{ mt: 2 }}>{(pass.error as Error).message}</Alert>}
        {pass.data && <PassReport report={pass.data} />}
      </CardContent>
    </Card>
  );
}
