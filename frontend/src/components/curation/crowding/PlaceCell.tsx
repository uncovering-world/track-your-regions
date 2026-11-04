/**
 * A row's place in the crowded-city window (#2345): what the place is, beside
 * what the rule reads of it. A curator who does not know a square in Kraków
 * cannot tell it from its name, so the row shows the place's picture as a
 * thumbnail and links its Wikipedia article, as its review card does.
 *
 * The picture's credit is drawn under the name only while the thumbnail is on
 * screen: a photographer named beside a picture that failed to load credits
 * nobody (CLAUDE.md § Experience Images). The failure is held by the picture's
 * address, so a row read again with another picture draws it afresh.
 */

import { useState, type ReactNode } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import type { CrowdingWindowRow } from '../../../api/crowding';
import { extractImageUrl, toThumbnailUrl } from '../../../utils/imageUrl';
import { safeHref } from '../../../utils/safeHref';
import { ImageCreditLine } from '../../shared/ImageCreditLine';
import { ReaderEditionBeside } from '../../shared/WikipediaArticleLink';
import { WorkThumbnail } from '../../shared/WorkThumbnail';

/** The place's name, its picture with its credit and its article, around what the table says of it (`children`). */
export function PlaceCell({ row, children }: { row: CrowdingWindowRow; children: ReactNode }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const image = extractImageUrl(row.imageUrl);
  // `''` for a host the product may not draw from: the thumbnail then draws nothing, and no credit is said.
  const thumbnail = image ? toThumbnailUrl(image, 120) : '';
  const failed = thumbnail !== '' && failedFor === thumbnail;
  const articleHref = safeHref(row.wikipediaUrl);

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <WorkThumbnail url={thumbnail} alt={row.name} failed={failed} onFailed={() => setFailedFor(thumbnail)} />
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
        {/* A dense row: a public-domain picture nobody is named for adds no line. No maker is named here. */}
        {thumbnail && !failed && <ImageCreditLine credit={row.imageCredit} redundantWith={null} />}
      </Box>
    </Stack>
  );
}
