/**
 * Whether *Find component items* has Jev judge what it proposed, and what one
 * press may spend on it (#1355). Jev is paid by the input token, so it is off
 * until an admin turns it on; off, or past the budget, a candidate is judged
 * when a curator opens its site's card, as before.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, FormControlLabel, InputAdornment, Stack, Switch, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  JEV_FINDER_BUDGET_USD_KEY, JEV_FINDER_JUDGES_KEY, MAX_JEV_FINDER_BUDGET_USD, finderBudgetUsd, finderJudges,
} from '@tyr/shared/jevSettings';
import { getAISettings, updateAISetting } from '../../api/admin/ai';
import { queryKeys } from '../../api/queryKeys';

export function JevFinderSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: queryKeys.ai.settings, queryFn: getAISettings });
  const settings = data?.settings ?? {};
  const judges = finderJudges(settings[JEV_FINDER_JUDGES_KEY]);
  const budget = finderBudgetUsd(settings[JEV_FINDER_BUDGET_USD_KEY]);
  const [draft, setDraft] = useState(String(budget));
  useEffect(() => { setDraft(String(budget)); }, [budget]);

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateAISetting(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ai.settings }),
  });
  const typed = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(typed) && typed >= 0 && typed <= MAX_JEV_FINDER_BUDGET_USD;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Jev on component candidates</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Off, Jev judges a site&apos;s candidate items when a curator opens its card. On, <em>Find component items</em> also
          asks Jev about every candidate not yet judged once it has proposed them, so the card opens with the judgement —
          up to the budget below for one press. Candidates past the budget are judged when their card is opened.
        </Typography>
        <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
          <FormControlLabel
            control={(
              <Switch
                checked={judges}
                disabled={save.isPending}
                onChange={(_, on) => save.mutate({ key: JEV_FINDER_JUDGES_KEY, value: on ? 'on' : 'off' })}
              />
            )}
            label="Judge new candidates when the search runs"
          />
          <TextField
            size="small"
            label="Budget for one search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (valid && typed !== budget) save.mutate({ key: JEV_FINDER_BUDGET_USD_KEY, value: String(typed) }); }}
            error={!valid}
            helperText={valid ? 'US dollars' : `A number from 0 to ${MAX_JEV_FINDER_BUDGET_USD}`}
            slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
            sx={{ width: 200 }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}
