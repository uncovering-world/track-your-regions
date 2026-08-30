/**
 * The object as a curator may see it, which is the only reason it can be seen.
 *
 * Its own file rather than a section of `WaitingToPublish.tsx`: it is a read of
 * its own with its own cache key, its own failure line and its own test, and the
 * card it hangs under had reached the length the development guide splits at.
 */

import { useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { fetchExperience, type ImageCredit } from '../../api/experiences';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';

/**
 * The object as a curator may see it, which is the only reason it can be seen.
 *
 * An arrival is absent from every list, count and map — the gate is absolute
 * there — and a by-id read is the one place it answers, relaxed for a curator
 * exactly so this card can be followed through to the thing it is asking about.
 * Without it the card names an object and offers no way to judge it, which is
 * the dead end this whole section exists to remove.
 *
 * Exported for its test: the promise below is about what survives a *rerender*
 * with a different id, which no caller can observe and no assertion about
 * `GatedCard` reaches without driving a mutation first.
 */
export function ObjectPreview({ experienceId }: { experienceId: number }) {
  // Which picture failed, not that one did. `GatedCard` is mounted unkeyed from
  // `ReviewBench`, and `showObject` survives moving between two waiting rows, so
  // a new `experienceId` reconciles into this same instance — a flag would carry
  // one object's refusal onto the next and hide a picture that is there. Same
  // finding as `ObjectContext`, same shape, second site.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['experience', experienceId],
    queryFn: () => fetchExperience(experienceId),
  });

  if (isLoading) return <LoadingSpinner size={20} padding={2} />;
  if (isError || !data) {
    return (
      <Typography variant="body2" color="error" sx={{ mt: 2 }}>
        Could not open the object{error instanceof Error ? `: ${error.message}` : '.'}
      </Typography>
    );
  }

  const source = extractImageUrl(data.image_url);
  // A failure is ordinary here rather than exceptional: this preview draws from
  // the same catalogue the queue does, whose URLs largely answer 403 (#557), and
  // a credit beside a picture that did not arrive names a photographer for
  // nothing.
  const url = source ? toThumbnailUrl(source, 250) : null;
  const image = url && url !== failedUrl ? url : null;
  // Already in hand: `GET /experiences/:id` returns `metadata` whole, so the
  // credit was reaching this preview and simply not being drawn.
  const credit = (data.metadata?.imageCredit ?? null) as ImageCredit | null;
  return (
    <Stack direction="row" spacing={2} sx={{ mt: 2 }} alignItems="flex-start">
      {image && (
        <Box sx={{ width: 120, flexShrink: 0 }}>
          <Box
            component="img"
            src={image}
            alt={data.name}
            sx={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 1 }}
            onError={() => setFailedUrl(image)}
          />
          <ImageCreditLine credit={credit} />
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ mb: 0.5 }}>
          {data.description || data.short_description || 'No description on the object.'}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {data.latitude.toFixed(4)}, {data.longitude.toFixed(4)}
          {data.country_names?.length > 0 ? ` — ${data.country_names.join(', ')}` : ''}
        </Typography>
        {/* `fetchExperience` (`GET /api/experiences/:id`) carries no
            `location_count` at all — that column exists only on the region
            list's own query (`buildRegionQueries`) — so a count here would
            read zero regardless of the object's real contents. A true
            sentence beats a number that is always wrong; #524 tracks the read
            that would list this object's points and works properly. */}
        <Typography variant="caption" color="text.secondary" display="block">
          Its points and works are not listed on this preview.
        </Typography>
      </Box>
    </Stack>
  );
}
