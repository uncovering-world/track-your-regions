/**
 * Whom or what a place commemorates, on its card (#2144): "Commemorates:
 * Abraham Lincoln" on the Lincoln Memorial, "Commemorates: Dmitry Pozharsky,
 * Kuzma Minin" on their monument in Red Square.
 *
 * One line for Map mode's expanded row and Discover's detail panel, so a place
 * says the same thing on both. Each subject is a link to its English Wikipedia
 * article where it has one, and its name alone where it has none. Every
 * address passes `safeHref` where it meets the DOM: a run writes the article
 * through no request schema. Nothing where the place names no one.
 */

import { Fragment } from 'react';
import { Link, Typography } from '@mui/material';
import type { CommemoratedSubject } from '../../api/experiences';
import { safeHref } from '../../utils/safeHref';

export function CommemoratesLine({ subjects, mb = 1.5 }: { subjects: readonly CommemoratedSubject[] | null | undefined; mb?: number }) {
  if (!subjects?.length) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb }}>
      {'Commemorates: '}
      {subjects.map((subject, i) => {
        const href = safeHref(subject.article_url);
        return (
          <Fragment key={subject.qid}>
            {i > 0 && ', '}
            {href ? (
              // `rel` on every outbound link: this opens somebody else's site.
              <Link href={href} target="_blank" rel="noopener noreferrer" underline="hover"
                onClick={(event) => event.stopPropagation()}>
                {subject.label}
              </Link>
            ) : subject.label}
          </Fragment>
        );
      })}
    </Typography>
  );
}
