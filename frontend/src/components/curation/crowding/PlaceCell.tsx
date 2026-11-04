/**
 * A row's place in the crowded-city window (#2345): what the place is, beside
 * what the rule reads of it. A curator who does not know a square in Kraków
 * cannot tell it from its name, so the row shows the place's picture as a
 * thumbnail and links its Wikipedia article, as its review card does.
 *
 * A dense row, so the picture's credit is the © badge on the thumbnail, and a
 * press on the thumbnail opens it enlarged with the full credit (ADR-0182) —
 * both only while the thumbnail is on screen (`DenseThumbnail`).
 */

import type { ReactNode } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import type { CrowdingWindowRow } from '../../../api/crowding';
import { safeHref } from '../../../utils/safeHref';
import { DenseThumbnail } from '../../shared/DenseThumbnail';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';

/** The place's name, its picture with its credit and its article, around what the table says of it (`children`). */
export function PlaceCell({ row, children }: { row: CrowdingWindowRow; children: ReactNode }) {
  const articleHref = safeHref(row.wikipediaUrl);

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <DenseThumbnail imageUrl={row.imageUrl} title={row.name} credit={row.imageCredit} width={48} height={48} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
        {children}
        {articleHref && (
          // A click on the row brings its dot into the map's view; one on its article only opens the article.
          <Stack direction="row" spacing={1} onClick={event => event.stopPropagation()}>
            <Link href={articleHref} target="_blank" rel="noopener noreferrer" variant="caption" underline="hover">
              Wikipedia
            </Link>
            {/* The English article stays the reference; the reader's edition is offered beside it (#2209). */}
            <ReaderEditionBeside article={row.wikipediaUrl} />
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
