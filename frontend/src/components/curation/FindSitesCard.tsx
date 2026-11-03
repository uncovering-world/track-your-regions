/**
 * The review page's card for a site a run proposed finds for (#2304): the
 * finds a museum holds whose own Wikidata point stands on the site, and no
 * record names where they were found (#2242). The Code of Ur-Nammu, in the
 * Istanbul Archaeology Museums, is proposed for Ur.
 *
 * The questions are the place's dialog's own (`SiteFindQuestions`), answered
 * one find at a time through the same endpoint: a point can be where a find
 * comes from, what a painting shows or where a lost original stood, so a
 * batch answers none of them (`reviewAnswerDispatch.ts`). Each answer is said
 * in the page's notice and the queue is read again; the card stays while the
 * site has a proposal left, as a site's roughly placed points do.
 */

import { Card, CardContent } from '@mui/material';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { SiteFindQuestions } from '../shared/SiteFindQuestions';
import { ItemHeader } from './queueCard';

type OnDone = (message?: string, experienceId?: number) => void;

export function FindSitesCard({ item, onDone }: { item: ReviewQueueItem; onDone: OnDone }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} />
        <SiteFindQuestions
          siteId={item.id}
          onAnswered={(find, answer) => onDone(
            `${item.name}: ${find} ${answer === 'confirmed' ? 'comes from here' : 'is not from here'}`, item.id,
          )}
        />
      </CardContent>
    </Card>
  );
}
