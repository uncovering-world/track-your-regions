/**
 * Whose work a drawn region shape is (#2085). A Commons map data file is its
 * author's work under the licence it declares, most often ODbL for one drawn
 * from OpenStreetMap, and the licence asks for the credit wherever the shape
 * is shown, the admin's import dialogs included, as a region map image's
 * (`RegionMapCreditLine`) and a site's outline's (`ExtentLine`) are.
 *
 * A dialog renders it only where it draws the shape, and it renders nothing
 * for no credit: a credit beside nothing credits nobody.
 */

import { Link, Typography } from '@mui/material';
import type { ShapeCredit } from '../../api/admin/worldViewImport';
import { safeHref } from '../../utils/safeHref';

export function ShapeCreditLine({ credits }: { credits: readonly ShapeCredit[] | null | undefined }) {
  if (!credits?.length) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
      {credits.length === 1 ? 'Shape: ' : 'Shapes: '}
      {credits.map((credit, i) => (
        <span key={credit.url}>
          {i > 0 && '; '}
          <Link href={safeHref(credit.url) ?? undefined} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
            {credit.label}
          </Link>
          {`, ${credit.licence}`}
          {credit.attribution && ` (${credit.attribution})`}
        </span>
      ))}
    </Typography>
  );
}
