/**
 * Jev on the review page (#1260): what its suggestions have cost, and how often
 * curators chose the source it suggested.
 *
 * Jev suggests which of two sources' views a place should show on the sources
 * card; a curator decides. The agreement counts the choices a curator made for
 * the same views Jev was asked about — a choice that kept the place's own value
 * has nothing to compare.
 */

import { Card, CardContent, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getJevUsage } from '../../api/admin/jev';
import { queryKeys } from '../../api/queryKeys';
import { plural } from '../../utils/plural';

/** Dollars as a reader reads them: cents once there are any, two significant digits below a cent. */
function costOf(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 0.01 ? `$${usd.toPrecision(2)}` : `$${usd.toFixed(2)}`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="h6">{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

export function JevUsageCard() {
  const { data } = useQuery({ queryKey: queryKeys.ai.jevUsage, queryFn: getJevUsage });
  if (!data) return null;
  const agreement = data.compared > 0 ? `${Math.round((data.agreed / data.compared) * 100)} %` : '—';
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6">Jev suggestions</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {data.configured
            ? 'Jev suggests which of two sources’ name, picture or point a place should show, on the review page; a curator decides.'
            : 'Not configured: set JEV_API_KEY to show Jev’s suggestion on the review page. Nothing else changes without it.'}
        </Typography>
        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
          <Figure label="suggestions asked for" value={String(data.calls)} />
          <Figure label="input tokens" value={data.inputTokens.toLocaleString()} />
          <Figure label="cost" value={costOf(data.usd)} />
          <Figure
            label={`curators chose what Jev suggested, of ${plural(data.compared, 'choice')}`}
            value={agreement}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
