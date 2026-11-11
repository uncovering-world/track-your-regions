/**
 * Whom or what a place commemorates, on its card (#2144): "Commemorates:
 * Abraham Lincoln" on the Lincoln Memorial, "Commemorates: Dmitry Pozharsky,
 * Kuzma Minin" on their monument in Red Square. The same line names the holy
 * figure a religious work depicts under its own word (#2404): "Depicts: Jesus
 * Christ" on Christ the Redeemer, which was not raised to remember him.
 *
 * The line also names the people and figures a monument shows (#2436). A long
 * list is folded: the first `SHOWN_FOLDED` names, then "and N more", which
 * opens the whole list in place. The Republic Monument's five founders are
 * shown whole, and the Reformation Wall's reformers fold.
 *
 * One line for Map mode's expanded row and Discover's detail panel, so a place
 * says the same thing on both. Each subject is a link to its English Wikipedia
 * article where it has one, and its name alone where it has none. Every
 * address passes `safeHref` where it meets the DOM: a run writes the article
 * through no request schema. Nothing where the place names no one.
 */

import { Fragment, useState } from 'react';
import { Link, Typography } from '@mui/material';
import type { CommemoratedSubject } from '../../api/experiences';
import { safeHref } from '../../utils/safeHref';

/** How many names a folded line shows. A list one longer is shown whole, since "and 1 more" hides nothing. */
export const SHOWN_FOLDED = 4;

export function CommemoratesLine({ subjects, mb = 1.5, word = 'Commemorates' }: {
  subjects: readonly CommemoratedSubject[] | null | undefined;
  mb?: number;
  /** What the line says the place does with them. */
  word?: 'Commemorates' | 'Depicts';
}) {
  const [open, setOpen] = useState(false);
  if (!subjects?.length) return null;
  const folded = !open && subjects.length > SHOWN_FOLDED + 1;
  const shown = folded ? subjects.slice(0, SHOWN_FOLDED) : subjects;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb }}>
      {`${word}: `}
      {shown.map((subject, i) => {
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
      {folded && (
        <>
          {' and '}
          <Link component="button" type="button" variant="caption" underline="hover" sx={{ verticalAlign: 'baseline' }}
            onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
            {`${subjects.length - SHOWN_FOLDED} more`}
          </Link>
        </>
      )}
    </Typography>
  );
}
