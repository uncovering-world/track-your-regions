/**
 * What the dialog says about the region's reference map (#595): the offer to
 * keep a map an earlier session left only in this browser, and a load or save
 * that failed.
 */

import { Alert, Button } from '@mui/material';
import type { RegionImageOverlayState } from './useRegionImageOverlay';

export function ReferenceMapNotices({ overlay, regionName }: { overlay: RegionImageOverlayState; regionName?: string }) {
  return (
    <>
      {overlay.legacy && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={(
            <>
              <Button color="inherit" size="small" onClick={overlay.keepLegacy}>Keep</Button>
              <Button color="inherit" size="small" onClick={overlay.discardLegacy}>Discard</Button>
            </>
          )}
        >
          This browser holds a reference map for {regionName ?? 'this region'} from an earlier session
          ({overlay.legacy.imageName}). Keep it for every admin, or discard it?
        </Alert>
      )}
      {overlay.error && <Alert severity="warning" sx={{ mb: 2 }}>{overlay.error}</Alert>}
    </>
  );
}
