/**
 * How much ground a place covers, and whose map says so.
 *
 * The credit is the point of the component, not a decoration on it. An
 * archaeology site's outline is OpenStreetMap's work under ODbL, and
 * ADR-0059 decision 3 says the attribution is shown wherever that data is —
 * "© OpenStreetMap contributors", visible without interaction, near the thing
 * it produced. So the extent and its credit are one line that renders together
 * or not at all: a credit beside nothing credits nobody, which is the same rule
 * `ImageCreditLine` follows under a picture that failed to load.
 *
 * The map's own attribution corner already carries OpenStreetMap through the
 * basemap, and this is deliberately not that: the corner credits the tiles, and
 * this credits the outline drawn on top of them — a different work, on a card
 * that may be read with no map beside it at all.
 *
 * Quiet on purpose, like the picture credit: an obligation, not a headline.
 */

import { Link, Typography } from '@mui/material';

/**
 * The area as a traveller would say it: hectares up to a square kilometre,
 * square kilometres above.
 *
 * A site is something you walk across, and "0.057 km²" is a number nobody paces
 * out — Troy's excavations measure 5.7 ha and Machu Picchu 11.5 ha (both read
 * off OpenStreetMap's own polygons on 2026-09-14, with the expression the
 * writer stores them by), and the Acropolis is about 3 ha. Above a square
 * kilometre the hectare stops helping (Angkor would read "40,000 ha"), so the
 * unit changes.
 *
 * **One rule of precision in both units**: one decimal below ten, none from
 * ten up, and never a floor. Flooring the hectares was its own small lie —
 * 5.68 ha read as "5 ha" while 5.68 km² read as "5.7 km²" — and a reader
 * comparing two sites across the boundary was comparing two different
 * roundings. The decimal is decided after rounding, not before: 9.96 rounds
 * to ten, and "10.0" is a number the rule says nobody reads.
 */
export function extentLabel(areaKm2: number): string {
  const hectares = areaKm2 * 100;
  if (hectares < 1) return '<1 ha';
  const [amount, unit] = areaKm2 < 1 ? [hectares, 'ha'] : [areaKm2, 'km²'];
  const oneDecimal = amount.toFixed(1);
  return `${Number(oneDecimal) < 10 ? oneDecimal : Math.round(amount)} ${unit}`;
}

export function ExtentLine({ areaKm2 }: { areaKm2: number | null | undefined }) {
  // No extent, no line — and so no credit standing beside nothing.
  if (areaKm2 == null || areaKm2 <= 0) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
      {`Extent ${extentLabel(areaKm2)} · `}
      <Link
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        color="inherit"
        underline="hover"
      >
        © OpenStreetMap contributors
      </Link>
    </Typography>
  );
}
