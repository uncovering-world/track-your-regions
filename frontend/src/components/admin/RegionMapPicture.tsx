/**
 * A region's map image and the credit it owes, drawn together or not at all.
 *
 * The map a Wikivoyage Regions section draws is a Commons file, most often CC
 * BY-SA and made by one of Wikivoyage's mapmakers, and the import and editor
 * dialogs draw it beside the region they are matching. The licence asks that the
 * author is named wherever the work appears, the admin's screens included
 * (ADR-0043), so the dialogs draw it through this component (#2087).
 *
 * The credit is asked of the backend by the file's address, never by region: a
 * region with no map of its own draws its parent's, and the credit is the file's.
 * The backend reads it from Commons the first time a file is drawn and keeps it.
 *
 * A picture that fails to load takes its credit with it, held as *which address*
 * failed, as `PictureWithCredit` holds it: a dialog outlives the regions it is
 * opened on, and a flag would carry one map's failure onto the next.
 */

import { useState } from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ImageCredit } from '../../api/experiences';
import { getMapImageCredits } from '../../api/admin/worldViewImport';
import { queryKeys } from '../../api/queryKeys';
import { toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from '../shared/ImageCreditLine';

/**
 * The credits of the map images a dialog draws, by stored address.
 *
 * Empty until the answer arrives, and for a dialog that has no world view to
 * ask about. A credit is the file's for as long as the file exists, so an
 * answer is never refetched.
 */
export function useRegionMapCredits(
  worldViewId: number | undefined,
  urls: readonly string[],
): ReadonlyMap<string, ImageCredit | null> {
  const asked = [...new Set(urls.filter(Boolean))].sort();
  const { data } = useQuery({
    queryKey: queryKeys.admin.wvImport.mapCredits(worldViewId ?? 0, asked),
    queryFn: () => getMapImageCredits(worldViewId!, asked),
    enabled: worldViewId != null && asked.length > 0,
    staleTime: Infinity,
  });
  return new Map((data?.credits ?? []).map(({ url, credit }) => [url, credit]));
}

interface RegionMapPictureProps {
  /** The world view whose import holds the map: the backend answers only for a file one of its regions holds. */
  worldViewId: number | undefined;
  /** The map's address as stored (`region_map_url`), sized here. */
  url: string;
  /** One of the widths Wikimedia's own CDN holds (120, 250, 330, 500, 960, 1280). */
  width: number;
  alt: string;
  sx?: SxProps<Theme>;
}

/**
 * The picture and its credit line as two siblings, so the caller's own box lays
 * them out: the side-by-side panels size the picture against their own height.
 */
export function RegionMapPicture({ worldViewId, url, width, alt, sx }: RegionMapPictureProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const src = toThumbnailUrl(url, width);
  // A map no <img> may draw owes no credit, so it is not asked about.
  const credit = useRegionMapCredits(worldViewId, src ? [url] : []).get(url);
  if (!src || failedFor === src) return null;
  return (
    <>
      <Box component="img" key={src} src={src} alt={alt} sx={sx} onError={() => setFailedFor(src)} />
      <ImageCreditLine credit={credit} />
    </>
  );
}

/**
 * The credit alone, for a surface that draws the map its own way: the
 * reference map of Create Subregions, kept as bytes and drawn on the map or
 * beside it, credited by the region map it was loaded from. Nothing for an
 * image that came from no region map. The caller renders it only while its
 * picture is on screen.
 */
export function RegionMapCreditLine({ worldViewId, url }: { worldViewId: number | undefined; url: string | null | undefined }) {
  const credit = useRegionMapCredits(worldViewId, url ? [url] : []).get(url ?? '');
  return <ImageCreditLine credit={credit} />;
}
