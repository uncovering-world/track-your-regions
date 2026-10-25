/**
 * A place's description, and whose text it is.
 *
 * The World Heritage Centre's short descriptions come from UNESCO's dataset
 * under CC BY-SA 4.0, and the licence asks that whoever reads the text sees
 * who wrote it and under what licence (ADR-0149). So the paragraph and its
 * credit are drawn together or not at all, as `ExtentLine` draws an outline's
 * extent with OpenStreetMap's credit: a credit beside nothing credits nobody,
 * and a paragraph with no credit is the licence unanswered. A curator's edit
 * of UNESCO's text is credited as an adaptation of it; a curator's own text
 * carries no source and is drawn alone.
 *
 * The read names the source (`description_source`); `@tyr/shared/textCredits`
 * holds what the credit says, the same entry the run stamps on the row.
 */

import { Box, Link, Typography } from '@mui/material';
import type { TypographyProps } from '@mui/material';
import { TEXT_CREDITS, type TextSource } from '@tyr/shared/textCredits';
import { safeHref } from '../../utils/safeHref';

/**
 * The credit alone, for a screen that shows the text in a field of its own,
 * such as the curator's edit dialog. Nothing for a text with no source.
 */
export function DescriptionCreditLine({ source, adapted = false }: {
  source: TextSource | null | undefined;
  /** The text is a curator's edit of the source's, which the credit calls an adaptation. */
  adapted?: boolean;
}) {
  if (!source) return null;
  const credit = TEXT_CREDITS[source];
  const sourceHref = safeHref(credit.sourceUrl);
  const licenceHref = safeHref(credit.licenceUrl);
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      {adapted ? 'Text: adapted from ' : 'Text: '}
      {sourceHref ? (
        <Link href={sourceHref} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
          {credit.holder}
        </Link>
      ) : credit.holder}
      {' · '}
      {licenceHref ? (
        <Link href={licenceHref} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
          {credit.licence}
        </Link>
      ) : credit.licence}
    </Typography>
  );
}

interface DescriptionTextProps {
  text: string | null | undefined;
  source: TextSource | null | undefined;
  adapted?: boolean;
  /** The space under the block, as the screen spaces its other lines. */
  mb?: number;
  variant?: TypographyProps['variant'];
}

export function DescriptionText({ text, source, adapted, mb = 1.5, variant = 'body2' }: DescriptionTextProps) {
  const paragraph = text?.trim();
  if (!paragraph) return null;
  return (
    <Box sx={{ mb }}>
      <Typography variant={variant} color="text.secondary">
        {paragraph}
      </Typography>
      <DescriptionCreditLine source={source} adapted={adapted} />
    </Box>
  );
}
