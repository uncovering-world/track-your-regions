/**
 * An official website on a review card, with whether it still answers (#2165).
 *
 * A proposal that replaces Lourdes's dead `fr.lourdes-france.org` with the live
 * `www.lourdes-france.org` looks exactly like one that replaces a working site with
 * a domain that no longer resolves, and 18 of the 106 websites held proposals
 * brought on 2026-10-30 were dead. The card says which, beside the link:
 *
 * - dead: a warning that says why in words (*domain not found*, *page not found
 *   (404)*, *domain for sale*) and when it was checked;
 * - answers: a small check mark saying the site answered on that date, and never
 *   that it is safe: an expired domain bought by someone else answers too;
 * - unclear: a neutral note that it could not be checked.
 *
 * Nothing else on the card changes, and the curator still decides. The check is the
 * backend's (`getWebsiteChecks`), one request per card, asked once the link is near
 * the screen (`useNearViewport`), so a page of cards checks the ones a curator scrolls
 * to and never the whole queue.
 */

import { useRef, type ReactNode } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useQuery } from '@tanstack/react-query';
import { getWebsiteChecks, type WebsiteCheckResult } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { useNearViewport } from '../../hooks/useNearViewport';

const DEAD_WORDS: Partial<Record<WebsiteCheckResult['reason'], string>> = {
  'domain-not-found': 'domain not found',
  'connection-refused': 'connection refused',
  'page-not-found': 'page not found (404)',
  'page-gone': 'page gone (410)',
  'domain-parked': 'domain for sale',
};

const UNCLEAR_WORDS: Partial<Record<WebsiteCheckResult['reason'], string>> = {
  'refused-by-site': 'the site refused the check',
  'unexpected-answer': 'the site gave an unexpected answer',
  'server-error': 'the site answered with a server error',
  'timed-out': 'the site did not answer in time',
  'tls-failure': 'its secure connection failed',
  'not-public': 'it is not a public address',
  'too-many-redirects': 'it redirects too many times',
  'not-checkable': 'it is not a web address',
  failed: 'the request failed',
};

const onDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The words beside a checked link. */
export function checkWords(check: Pick<WebsiteCheckResult, 'outcome' | 'reason' | 'checkedAt'>): string {
  const when = onDate(check.checkedAt);
  if (check.outcome === 'answers') return `answered on ${when}`;
  if (check.outcome === 'dead') return `dead: ${DEAD_WORDS[check.reason] ?? 'no answer'}, checked ${when}`;
  return `could not be checked: ${UNCLEAR_WORDS[check.reason] ?? 'no reason given'}`;
}

function CheckMark({ check }: { check: WebsiteCheckResult }) {
  const words = checkWords(check);
  if (check.outcome === 'dead') {
    return (
      <Typography component="span" variant="caption" color="warning.main" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
        <WarningAmberIcon sx={{ fontSize: 14 }} aria-hidden />
        {words}
      </Typography>
    );
  }
  if (check.outcome === 'answers') {
    return (
      <Tooltip title="The site answered when it was checked. That does not say it is the place's site or that it is safe: an expired domain someone else bought answers too." describeChild>
        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
          <CheckIcon sx={{ fontSize: 14 }} aria-hidden />
          {words}
        </Typography>
      </Tooltip>
    );
  }
  return <Typography component="span" variant="caption" color="text.secondary">{words}</Typography>;
}

/**
 * `children` (the link) with the check of `url` beside it. Without the place's id
 * there is nothing to ask, and the link is shown as it is.
 */
export function CheckedWebsite({ experienceId, url, children }: { experienceId?: number; url: string; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(box);
  const { data } = useQuery({
    queryKey: queryKeys.experience.websiteChecks(experienceId ?? 0),
    queryFn: () => getWebsiteChecks(experienceId as number),
    enabled: near && experienceId !== undefined,
    // The backend keeps an outcome for a day; an hour here spares the request.
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const check = data?.checks.find(one => one.url === url);
  return (
    <Box component="span" ref={box} sx={{ display: 'inline-flex', alignItems: 'center', columnGap: 0.75, flexWrap: 'wrap' }}>
      {children}
      {check && <CheckMark check={check} />}
    </Box>
  );
}
