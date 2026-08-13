/**
 * The object a card is asking about, so the answer does not require leaving the page.
 *
 * Every kind in this queue asks a curator to judge something — is this site gone, is the
 * source's description better, should this museum be visible — and the screen used to
 * show a name and an external id. Judging the wording of a description without the
 * photograph, the place, or the page it was written from is guesswork with a button
 * under it.
 *
 * Everything here is optional in the data and rendered only when present: 14 of 1604
 * rows carry no image, and a landmark commonly has no website. An empty frame or a dead
 * link would be worse than the absence — it would say the object has something it does
 * not.
 */

import { useState } from 'react';
import { Box, Button, Chip, Link, Stack } from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import type { ReviewQueueItem } from '../../api/experiences';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { PointPreviewDialog } from './PointPreviewDialog';

/** Four decimals is about 11 m at the equator — finer than this screen can use. */
function coordinateLabel(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export function ObjectContext({ item }: { item: ReviewQueueItem }) {
  const [showMap, setShowMap] = useState(false);
  const image = extractImageUrl(item.image_url ?? null);
  // The thumbnail, not the extracted URL, is what decides whether there is a picture:
  // `extractImageUrl` turns a stored `/images/…` path into one on our own API, whose host
  // is not in the trusted list, so `toThumbnailUrl` answers with an empty string — and
  // `src=""` resolves against the page and draws a broken image in a 96×72 frame, which is
  // the one thing this file's header says it must not do. UNESCO and museum rows carry
  // trusted remote URLs today; the local shape is what `museumSyncService` still repairs.
  const thumbnail = image ? toThumbnailUrl(image, 120) : '';
  const hasPoint = typeof item.latitude === 'number' && typeof item.longitude === 'number';
  const regions = item.region_names ?? [];
  const links: Array<{ label: string; href: string }> = [];
  if (item.website_url) links.push({ label: 'source page', href: item.website_url });
  if (item.wikipedia_url) links.push({ label: 'Wikipedia', href: item.wikipedia_url });

  if (!thumbnail && !hasPoint && regions.length === 0 && links.length === 0) return null;

  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 1.5 }} alignItems="flex-start">
      {thumbnail && (
        // A plain <img>, like every other place that shows an experience's picture
        // (`ExperienceExpandedDetails`, `ArtworksList`). Not `AuthImage`: that fetches
        // through `authFetchBlob`, which attaches an Authorization header, and a header
        // makes the browser send a preflight — which Wikimedia answers with a redirect,
        // and a redirected preflight is refused outright. Museums carry remote Wikimedia
        // URLs (`docs/tech/experiences.md`), so that route failed twice per image and
        // filled the console on a page of cards. `AuthImage` is for images our own API
        // serves behind its auth, and those are the CV previews.
        <Box
          component="img"
          src={thumbnail}
          alt=""
          loading="lazy"
          sx={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 1, bgcolor: 'grey.100' }}
        />
      )}
      <Box sx={{ minWidth: 0 }}>
        {hasPoint && (
          // Opens a map here rather than navigating: the app reads four query parameters
          // — `wv`, `code`, `error`, `token` — and none positions the map, so a
          // `/?lat=…&lon=…` link would do a full-document navigation, drop the curator
          // out of the queue with its paging and any card they were part-way through,
          // and land on the default view nowhere near the object. The number stays on the
          // button because it is worth copying, but the number alone answers nothing: a
          // description claiming "close to the northern border" is checked by looking.
          <Button
            size="small"
            startIcon={<PlaceIcon fontSize="small" />}
            onClick={() => setShowMap(true)}
            sx={{ p: 0, minWidth: 0, textTransform: 'none' }}
          >
            {coordinateLabel(item.latitude as number, item.longitude as number)}
          </Button>
        )}
        {links.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
            {links.map(link => (
              // `rel` on every outbound link: these open a source's own site, and
              // `noopener` is what keeps that page from reaching back into this one.
              <Link
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                variant="caption"
                underline="hover"
              >
                {link.label}
              </Link>
            ))}
          </Stack>
        )}
        {regions.length > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
            {/* Names rather than ids, and all of them: an object crosses regions, and
                which ones it is in is exactly what tells a region-scoped curator why
                this card reached them. */}
            {regions.map(region => (
              <Chip key={region} label={region} size="small" variant="outlined" />
            ))}
          </Stack>
        )}
      </Box>

      {hasPoint && (
        <PointPreviewDialog
          open={showMap}
          onClose={() => setShowMap(false)}
          name={item.name}
          latitude={item.latitude as number}
          longitude={item.longitude as number}
        />
      )}
    </Stack>
  );
}
