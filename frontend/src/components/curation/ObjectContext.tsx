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
import {
  Box, Button, ButtonBase, Chip, Dialog, DialogContent, DialogTitle, Link, Stack, Typography,
} from '@mui/material';
import PlaceIcon from '@mui/icons-material/Place';
import type { ReviewQueueItem } from '../../api/experiences';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { plural } from '../../utils/plural';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { PointPreviewDialog } from './PointPreviewDialog';

/** Four decimals is about 11 m at the equator — finer than this screen can use. */
function coordinateLabel(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * What the object is *made of*, when that changes how the card reads.
 *
 * UNESCO 1239 is why this exists: the source proposed a description of Waldsiedlung
 * Zehlendorf, one of the seven housing estates the site is made of, and the card
 * showed that text against the site's own with nothing to say the site had parts.
 * A curator reading it has no way to know they are being shown a part.
 *
 * Silent for a single place holding nothing, which is most of the catalogue — 1119
 * of 1604 objects hold exactly one point. Saying "made of 1 place" on all of them
 * would be a line that never carries information, and a curator learns to stop
 * reading a line like that before they meet the one that matters.
 */
export function madeOfLabel(
  offeredLocations: number | undefined,
  works: number | undefined,
): string | null {
  const parts: string[] = [];
  // Two and up, because "1 place" is what an object is by default. Both counts go
  // through `plural` even though this one can never be 1: the point of the helper is
  // that the `n === 1` comparison lives in one place, and a card that spelled one
  // plural and computed the other is how a second copy of it starts.
  if ((offeredLocations ?? 0) > 1) parts.push(`made of ${plural(offeredLocations ?? 0, 'place')}`);
  if ((works ?? 0) > 0) parts.push(`holds ${plural(works ?? 0, 'famous work')}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ObjectContext({ item }: { item: ReviewQueueItem }) {
  const [showMap, setShowMap] = useState(false);
  const [showImage, setShowImage] = useState(false);
  // Two, because they are two requests: the card asks for 120 px and the dialog
  // for 960. A failure has to take its *own* credit away. On this screen it used
  // to be the ordinary case rather than the edge one — most of what the queue
  // holds is UNESCO, whose portal URLs answered 403 through the resizer that
  // stood here (#557); every picture is a Commons file since ADR-0043, and the
  // rule stays for the day one does not load.
  //
  // Held as *which picture* failed rather than as a flag, because this component
  // is not a list row: the bench draws one card at a time (`ReviewBench`,
  // `<ObjectContext item={item} />` with no key anywhere on the chain), so moving
  // between two questions of the same kind reconciles a new `item` into the same
  // instance. A boolean would survive that and blank the next object's picture —
  // one 403 turning every card after it into a photoless card. Keyed by URL it
  // cannot: a different picture is a different key.
  const [cardFailedFor, setCardFailedFor] = useState<string | null>(null);
  const [fullFailedFor, setFullFailedFor] = useState<string | null>(null);
  const image = extractImageUrl(item.image_url ?? null);
  // The thumbnail, not the extracted URL, is what decides whether there is a picture:
  // `extractImageUrl` turns a stored `/images/…` path into one on our own API, whose host
  // is not in the trusted list, so `toThumbnailUrl` answers with an empty string — and
  // `src=""` resolves against the page and draws a broken image in a 96×72 frame, which is
  // the one thing this file's header says it must not do. The same empty answer comes
  // back for a host the product may not draw from — a UNESCO row still carrying the
  // portal's photograph until *Fix pictures* has been run on that database (ADR-0043) —
  // so this guard is what keeps those cards photoless rather than broken.
  const cardFailed = !!image && cardFailedFor === image;
  const fullFailed = !!image && fullFailedFor === image;
  const thumbnail = image && !cardFailed ? toThumbnailUrl(image, 120) : '';
  const hasPoint = typeof item.latitude === 'number' && typeof item.longitude === 'number';
  const regions = item.region_names ?? [];
  const links: Array<{ label: string; href: string }> = [];
  if (item.website_url) links.push({ label: 'source page', href: item.website_url });
  if (item.wikipedia_url) links.push({ label: 'Wikipedia', href: item.wikipedia_url });

  const madeOf = madeOfLabel(item.offered_locations, item.counted_works_total ?? undefined);

  if (!thumbnail && !hasPoint && !madeOf && regions.length === 0 && links.length === 0) return null;

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
        // Openable, because 96×72 answers "is there a picture" and the question a curator
        // actually has is "is this the building I think it is" — which needs a size the
        // card has no room for. The larger one is requested at 960, a width Wikimedia's
        // CDN already holds, so opening it costs a cached fetch rather than the full file.
        //
        // `ButtonBase` and not an `<img onClick>`: an image takes no focus and fires on no
        // key, so the alt text would announce a control to a reader who then cannot operate
        // it. Nothing in the frontend's lint config checks this — `jsx-a11y` is not
        // installed — so it is a decision rather than something the gate would have caught.
        <ButtonBase
          onClick={() => setShowImage(true)}
          aria-label={`${item.name} — enlarge the picture`}
          sx={{ borderRadius: 1, flexShrink: 0, cursor: 'zoom-in' }}
        >
          <Box
            component="img"
            src={thumbnail}
            alt=""
            loading="lazy"
            sx={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 1, bgcolor: 'grey.100' }}
            onError={() => setCardFailedFor(image)}
          />
        </ButtonBase>
      )}
      <Box sx={{ minWidth: 0 }}>
        {/* First line of the text column rather than under the 96×72 frame: a
            caption there would set the width of the picture's own column, and a
            photographer's name is longer than the picture is wide. No
            `redundantWith` — a card names an object, not an artist, so there is
            nothing here for the credit to repeat.
            Hung on the thumbnail rather than on the credit alone: a row whose
            `image_url` is a local path draws no picture here (see above), and a
            photographer named under no photograph credits them for nothing. */}
        {thumbnail && <ImageCreditLine credit={item.image_credit} />}
        {madeOf && (
          // Above the coordinates, because it changes what the coordinates mean: one
          // pair of numbers on an object made of seven places is one of seven.
          <Typography variant="caption" color="text.secondary" display="block">
            {madeOf}
          </Typography>
        )}
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
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap alignItems="center">
            {/* Named, because unlabelled chips are decoration. They answer a real question
                — where this object counts, and therefore what a refusal takes it out of,
                and why this card reached a region-scoped curator at all — and none of that
                is guessable from three place names in a row. */}
            <Typography variant="caption" color="text.secondary">counts in</Typography>
            {/* Names rather than ids, and all of them: an object crosses regions.
                `whiteSpace: normal` because a region can be called "Peloponnese, Western
                Greece and the Ionian Islands", and a chip that clips mid-word ends on the
                word "and" — which reads as a bug rather than as a long name. */}
            {regions.map(region => (
              <Chip
                key={region}
                label={region}
                size="small"
                variant="outlined"
                sx={{ height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 } }}
              />
            ))}
          </Stack>
        )}
      </Box>

      {image && (
        <Dialog open={showImage} onClose={() => setShowImage(false)} maxWidth="md">
          <DialogTitle sx={{ pb: 1 }}>{item.name}</DialogTitle>
          <DialogContent sx={{ pt: 0 }}>
            {!fullFailed && (
              <Box
                component="img"
                src={toThumbnailUrl(image, 960)}
                alt={item.name}
                sx={{ width: '100%', height: 'auto', display: 'block' }}
                onError={() => setFullFailedFor(image)}
              />
            )}
            {/* And again under the enlargement, which is where the picture is
                actually being looked at — a credit on the card the reader
                scrolled past does not follow the photograph onto this screen.
                Gated on this copy's own arrival: the card's 120 px and this 960 px
                are two requests, and the credit belongs to whichever is drawn. */}
            {!fullFailed && <ImageCreditLine credit={item.image_credit} />}
            {/* Said rather than left blank: the curator opened this deliberately, so
                an empty white box under the object's name reads as a rendering fault
                on the one screen whose job is deciding whether a picture is right. */}
            {fullFailed && (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                This picture could not be loaded. Its source may no longer be serving it.
              </Typography>
            )}
          </DialogContent>
        </Dialog>
      )}

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
