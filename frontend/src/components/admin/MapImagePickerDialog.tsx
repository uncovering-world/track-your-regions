/**
 * Map Image Picker Dialog
 *
 * Shows a grid of image candidates for an imported region and lets
 * the admin select the correct map image (or mark "none are maps").
 */

import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  ImageList,
  ImageListItem,
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import { toThumbnailUrl } from '../../utils/imageUrl';

interface MapImagePickerDialogProps {
  open: boolean;
  regionName: string;
  candidates: string[];
  currentSelection: string | null;
  onSelect: (imageUrl: string | null) => void;
  onClose: () => void;
  loading?: boolean;
}

export function MapImagePickerDialog({
  open,
  regionName,
  candidates,
  currentSelection,
  onSelect,
  onClose,
  loading,
}: MapImagePickerDialogProps) {
  const [selected, setSelected] = useState<string | null>(currentSelection);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = useCallback((url: string) => {
    setFailedImages(prev => new Set(prev).add(url));
  }, []);

  const handleConfirm = () => {
    onSelect(selected);
  };

  const handleNoneAre = () => {
    onSelect(null);
  };

  // A candidate is wiki content, drawn only as toThumbnailUrl allows (#694): one
  // it refuses is not offered, since a picture no <img> may draw is not a map
  // to choose.
  const visibleCandidates = candidates
    .map(url => ({ url, src: toThumbnailUrl(url, 300) }))
    .filter(({ url, src }) => src && !failedImages.has(url));
  // `selected` is seeded from the region's current map, which may be a value
  // stored before the rule and refused now. A pick has to be one of the
  // candidates on screen, or the dialog would re-post what it will not draw.
  const selectionDrawable = visibleCandidates.some(({ url }) => url === selected);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Select Region Map
        <Typography variant="body2" color="text.secondary">
          {regionName} — {visibleCandidates.length} candidate{visibleCandidates.length !== 1 ? 's' : ''}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {visibleCandidates.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No valid images found.
          </Typography>
        ) : (
          <ImageList cols={3} gap={12}>
            {visibleCandidates.map(({ url, src }) => {
              const isSelected = selected === url;
              return (
                <ImageListItem
                  key={url}
                  onClick={() => setSelected(isSelected ? null : url)}
                  sx={{
                    cursor: 'pointer',
                    border: 3,
                    borderColor: isSelected ? 'primary.main' : 'transparent',
                    borderRadius: 1,
                    overflow: 'hidden',
                    position: 'relative',
                    '&:hover': {
                      borderColor: isSelected ? 'primary.main' : 'action.hover',
                    },
                  }}
                >
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    onError={() => handleImageError(url)}
                    style={{
                      height: 200,
                      objectFit: 'contain',
                      width: '100%',
                      background: '#f5f5f5',
                    }}
                  />
                  {isSelected && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        bgcolor: 'primary.main',
                        color: 'white',
                        borderRadius: '50%',
                        width: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CheckIcon sx={{ fontSize: 18 }} />
                    </Box>
                  )}
                </ImageListItem>
              );
            })}
          </ImageList>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 1.5 }}>
        <Button
          variant="outlined"
          color="warning"
          onClick={handleNoneAre}
          disabled={loading}
        >
          None are maps
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={!selectionDrawable || loading}
            startIcon={loading ? <CircularProgress size={16} /> : undefined}
          >
            Confirm Selection
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
