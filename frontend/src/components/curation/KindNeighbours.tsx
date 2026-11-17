/**
 * "<Kind> in the catalogue" on an arrival's card (#2185): one place of the
 * same kind and type a curator kept, and one a curator turned away, each with
 * its picture, its name and the answer, the name opening that place's card.
 * A curator who has never heard of the kind decides from real answered
 * neighbours: under Towers, a bell tower the catalogue holds and one it does
 * not. The refused one says why it is out, in words: a curator's no, or the
 * rule's reason a curator upheld, which may be its fame rather than its kind,
 * so it is never labelled "not a tower" on a reason it does not give. The
 * heading carries the kind's rule behind ⓘ (`kindRuleWords`), so it stands
 * where no neighbour was answered yet; nothing is drawn where there is neither.
 */

import { Box, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { fetchKindNeighbours, type KindNeighbour } from '../../api/kindNeighbours';
import { fetchKindRule } from '../../api/kindRule';
import { queryKeys } from '../../api/queryKeys';
import { CURATOR_REFUSAL_REASON } from '@tyr/shared/lifecycle';
import { refusalSummary } from './refusalReason';
import { DenseThumbnail } from '../shared/DenseThumbnail';
import { CuratePlaceButton } from './CuratePlaceButton';
import { HelpHint } from './HelpHint';
import { kindRuleWords } from './kindRuleWords';

/** A kind's rule moves only with a run, so a session reads it once a kind, not once a card. */
const RULE_STALE_MS = 10 * 60_000;

/**
 * What the refused neighbour's answer says, in words: a curator's no, or the
 * rule's reason a curator upheld. A reason `refusalSummary` words says why the
 * place is out already ("Kept out by hand: …", "Not a place you visit: …");
 * one it leaves as recorded is introduced as what kept it out.
 */
function refusedWords(reason: string | null): string {
  if (!reason || reason === CURATOR_REFUSAL_REASON) return CURATOR_REFUSAL_REASON;
  const text = refusalSummary(reason).text;
  const line = (text === reason ? `kept out: ${reason}` : text).replace(/\.$/, '');
  return `${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}

function NeighbourRow({ neighbour, answer }: { neighbour: NonNullable<KindNeighbour>; answer: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <DenseThumbnail imageUrl={neighbour.imageUrl} title={neighbour.name} credit={neighbour.imageCredit} width={40} height={40} reserve />
      <Typography variant="body2" sx={{ minWidth: 0 }}>
        {neighbour.name} <Typography component="span" variant="body2" color="text.secondary">— {answer}</Typography>
      </Typography>
      <CuratePlaceButton placeId={neighbour.placeId} name={neighbour.name} />
    </Stack>
  );
}

export function KindNeighbours({ membershipId, kindId, kindName }: {
  membershipId: number;
  kindId: number;
  kindName: string;
}) {
  const read = useQuery({
    queryKey: queryKeys.curation.kindNeighbours(membershipId),
    queryFn: () => fetchKindNeighbours(membershipId),
    // Read afresh on every card: an answer just given on another card of the kind is the line this one shows.
    staleTime: 0,
  });
  const rule = useQuery({
    queryKey: queryKeys.curation.kindRule(kindId),
    queryFn: () => fetchKindRule(kindId),
    staleTime: RULE_STALE_MS,
  });
  const { kept = null, refused = null } = read.data ?? {};
  const ruleText = kindRuleWords(rule.data, kindId, kindName);
  if (!kept && !refused && !ruleText) return null;
  return (
    <Box component="section" aria-label={`${kindName} in the catalogue`} sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {kindName} in the catalogue <HelpHint text={ruleText} label={`how ${kindName} decides`} />
      </Typography>
      <Stack spacing={0.75}>
        {kept && <NeighbourRow neighbour={kept} answer="kept" />}
        {refused && <NeighbourRow neighbour={refused} answer={refusedWords(refused.reason)} />}
      </Stack>
    </Box>
  );
}
