/**
 * One part of a serial object, on a card of its own (#1271).
 *
 * The object's card lists its parts — Prehistoric Pile Dwellings around the
 * Alps has 111, Rock Art of the Mediterranean Basin on the Iberian Peninsula
 * 758 — and a part used to be a row and a pin and nothing more. This card takes
 * the object's place in the same panel when a part is opened from its row or its
 * pin, and the address names it (`…/e/<object>/p/<part>`, `docs/tech/addresses.md`).
 *
 * It shows what a part can say for itself: its own picture with its credit, or
 * the object's, said to be the whole site's (`pointPicture`); its name and its
 * component reference, with the full name to copy; its description as Wikidata
 * gives it, shown as it is (the product decision on #1271); links to its
 * Wikidata item and article and to the object's own page; and whether the
 * visitor has been there. The way back is to the object, and the steps go
 * through the object's parts in the source's order.
 *
 * The part is read from the object's own points (`fetchExperienceLocations`),
 * the read the curator's list of places already caches: it carries the
 * description and the Wikidata item, which the region feed leaves out. A part
 * that read does not hold — withdrawn, hidden, or another object's — is said so
 * once the read has answered, and the caller drops it from the address.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, IconButton, Link, Stack, Typography } from '@mui/material';
import { ArrowBack, ChevronLeft, ChevronRight } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { fetchExperienceLocations, type ImageCredit } from '../../api/experiences';
import { queryKeys } from '../../api/queryKeys';
import { experienceDetailsQuery } from '../../api/experienceCardQueries';
import { locationLabel, pointFullName } from '../../utils/locationLabel';
import { pointPicture } from '../../utils/pointPicture';
import { wikidataItemUrl, wikipediaArticleUrl } from '../../utils/wikidataLinks';
import { safeHref } from '../../utils/safeHref';
import { CopyNameButton } from './CopyNameButton';
import { ImageCreditLine } from './ImageCreditLine';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { VISITED_GREEN } from '../../utils/kindColors';

/** The object the part belongs to, as the surface that opened the card knows it. */
export interface PointCardObject {
  id: number;
  name: string;
  image_url: string | null;
  image_credit?: ImageCredit | null;
}

export interface PointCardProps {
  object: PointCardObject;
  pointId: number;
  /** Back to the object's card. */
  onBack: () => void;
  /** Open another part of the same object: a step. */
  onOpenPoint: (pointId: number, name: string) => void;
  /**
   * The parts the steps go through, where the caller's view narrows them — the
   * object's parts in the region the map is showing — and the name of that
   * view ("in Aargau"). Absent, or not holding this part, the steps go
   * through every part a visitor sees.
   */
  steps?: { ids: readonly number[]; within: string } | null;
  /** Said once the object's points have answered without this part, so the caller drops it from the address. */
  onPointGone: () => void;
  /** Whether the visitor has been there, and the way to say so; absent for a visitor who is not signed in. */
  visited?: { isVisited: boolean; onToggle: () => void } | null;
  /** Said in the layout phase whenever the card's height may have changed, for a list that measures its rows. */
  onHeightChange?: () => void;
}

export function PointCard({
  object, pointId, onBack, onOpenPoint, onPointGone, visited, onHeightChange, steps,
}: PointCardProps) {
  // Held as *which* picture failed, so a step to the next part tries its own.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // The object's own page — a World Heritage site's on the UNESCO portal — off
  // the read the object's card already makes and caches.
  const { data: details } = useQuery(experienceDetailsQuery(object.id));
  const officialUrl = typeof details?.metadata?.website === 'string' ? details.metadata.website : null;
  const points = useQuery({
    queryKey: queryKeys.experience.locations(object.id),
    queryFn: () => fetchExperienceLocations(object.id),
  });
  // The parts a visitor sees, in the source's order: the read serves a curator
  // the unread ones too, and a step must not land on a part nobody else sees.
  const parts = useMemo(
    () => (points.data?.locations ?? []).filter(loc => loc.curation_state !== 'pending'),
    [points.data],
  );
  // The part itself may be one the read served only to a curator — unread under
  // a gated source — and it opens for them, marked as such; the steps stay on
  // the parts a visitor sees.
  const point = (points.data?.locations ?? []).find(loc => loc.id === pointId) ?? null;
  const unread = point?.curation_state === 'pending';
  // A step stays in what the caller is showing: from Riesi in Aargau, the next
  // part is Aargau's other one, not Port on Lake Geneva while the map stays put.
  const narrowed = steps && steps.ids.includes(pointId)
    ? parts.filter(loc => steps.ids.includes(loc.id))
    : null;
  const route = narrowed ?? parts;
  const at = route.findIndex(loc => loc.id === pointId);

  useEffect(() => {
    if (points.isSuccess && point === null) onPointGone();
  }, [points.isSuccess, point, onPointGone]);

  useLayoutEffect(() => {
    onHeightChange?.();
  }, [point, onHeightChange]);

  if (!point) {
    return (
      <Box sx={{ p: 2 }}>
        <Button size="small" startIcon={<ArrowBack />} onClick={onBack} sx={{ textTransform: 'none' }}>
          {object.name}
        </Button>
        {points.isError && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This place could not be read. Try again in a moment.
          </Typography>
        )}
      </Box>
    );
  }

  const label = locationLabel(point);
  const picture = pointPicture(object, point);
  const pictureSrc = picture.imageUrl ? toThumbnailUrl(extractImageUrl(picture.imageUrl) ?? '', 500) : '';
  const step = (offset: number) => {
    const next = route[at + offset];
    if (next) onOpenPoint(next.id, locationLabel(next));
  };
  const wikidata = wikidataItemUrl(point.wikidata_item);
  const article = point.wikidata_item ? wikipediaArticleUrl(point.wikidata_item) : null;
  const official = officialUrl ? safeHref(officialUrl) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', gap: 1 }}
      >
        <Button
          size="small"
          startIcon={<ArrowBack />}
          onClick={onBack}
          sx={{ textTransform: 'none', minWidth: 0, justifyContent: 'flex-start' }}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {object.name}
          </Box>
        </Button>
        <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
          <IconButton size="small" aria-label="Previous place" disabled={at <= 0} onClick={() => step(-1)}>
            <ChevronLeft fontSize="small" />
          </IconButton>
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {at === -1 ? `${route.length} places` : `${at + 1} of ${route.length}`}{narrowed && steps ? ` ${steps.within}` : ''}
          </Typography>
          <IconButton size="small" aria-label="Next place" disabled={at === -1 || at === route.length - 1} onClick={() => step(1)}>
            <ChevronRight fontSize="small" />
          </IconButton>
        </Stack>
      </Stack>

      <Box sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {pictureSrc && failedSrc !== pictureSrc && (
          <>
            {/* Drawn as the object's card draws its picture: a fixed height, so
                the row the list measures does not grow when the bytes arrive,
                and the credit only with a picture that is on screen. */}
            <Box
              component="img"
              src={pictureSrc}
              alt={label}
              onError={() => setFailedSrc(pictureSrc)}
              sx={{ width: '100%', height: 250, objectFit: 'contain', borderRadius: 1, mt: 1.5, bgcolor: 'grey.100' }}
            />
            <ImageCreditLine credit={picture.imageCredit} />
          </>
        )}
        {pictureSrc && failedSrc !== pictureSrc && picture.pictureOfObject && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            The whole site's picture; this place has none of its own
          </Typography>
        )}

        <Box>
          <Stack direction="row" alignItems="center" sx={{ gap: 0.5 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
              {label}
            </Typography>
            <CopyNameButton fullName={pointFullName(object.name, point)} />
          </Stack>
          {point.external_ref && point.external_ref !== label && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {point.external_ref}
            </Typography>
          )}
        </Box>

        {unread && (
          <Typography variant="caption" color="warning.main">
            Not published yet: only curators see this place until it is published.
          </Typography>
        )}

        <Typography variant="body2">
          Part of{' '}
          <Link component="button" variant="body2" onClick={onBack} sx={{ verticalAlign: 'baseline' }}>
            {object.name}
          </Link>
          {parts.length > 1 ? ` · ${parts.length} places` : ''}
        </Typography>

        {point.description && <Typography variant="body2">{point.description}</Typography>}

        {(wikidata || article || official) && (
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
            {article && (
              <Link href={article} target="_blank" rel="noopener noreferrer" variant="body2">Wikipedia</Link>
            )}
            {wikidata && (
              <Link href={wikidata} target="_blank" rel="noopener noreferrer" variant="body2">
                Wikidata {point.wikidata_item}
              </Link>
            )}
            {official && (
              <Link href={official} target="_blank" rel="noopener noreferrer" variant="body2">
                The site's own page
              </Link>
            )}
          </Stack>
        )}

        {/* The visit is recorded on the place, as a part's row records it; whether
            the whole site counts as visited is a question of its own (#768). Not on
            an unread part: nobody can visit what no reader is shown, and the
            endpoint refuses it. */}
        {visited && !unread && (
          <FormControlLabel
            control={(
              <Checkbox
                size="small"
                checked={visited.isVisited}
                onChange={visited.onToggle}
                sx={{ '&.Mui-checked': { color: VISITED_GREEN } }}
              />
            )}
            label={<Typography variant="body2">I have been to {label}</Typography>}
          />
        )}
      </Box>
    </Box>
  );
}
