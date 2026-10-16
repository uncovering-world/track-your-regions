/**
 * "Open in maps": a point offered to the visitor's maps apps (#1194, ADR-0115).
 *
 * The one route to a place for a visitor walking there, and the only one for a
 * place with no street address — a village chapel, an excavation, a monument on
 * a hill. Several targets, the device's own app first, then OpenStreetMap and
 * Google Maps (`mapsTargets`), until a visitor can choose one for good (#1604).
 * A `geo:` link opens in place, since the system hands it to an app; a web map
 * opens in a new tab.
 *
 * Two shapes: the targets side by side, each with its icon and name, on a card's
 * line of links; and on one place's row of a card listing several, a single map
 * icon named for that place, whose menu holds the same targets — three icons on
 * each of thirty rows would be ninety.
 */

import { useState } from 'react';
import { Button, IconButton, ListItemIcon, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import GoogleIcon from '@mui/icons-material/Google';
import AppleIcon from '@mui/icons-material/Apple';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import { mapsPlatform, mapsTargets, type MapsTarget } from '../../utils/mapsLink';

function TargetIcon({ target }: { target: MapsTarget }) {
  if (target.id === 'google') return <GoogleIcon fontSize="small" />;
  if (target.id === 'device') {
    return mapsPlatform() === 'apple' ? <AppleIcon fontSize="small" /> : <PhoneAndroidIcon fontSize="small" />;
  }
  return <MapIcon fontSize="small" />;
}

/** Where a target opens: in place for the system's `geo:`, in a new tab for a web map. */
function opening(target: MapsTarget): { target?: string; rel?: string } {
  return target.href.startsWith('geo:') ? {} : { target: '_blank', rel: 'noopener noreferrer' };
}

export function OpenInMapsLink({ point, label, compact = false, className }: {
  point: { latitude: number; longitude: number };
  /** The place's name, which labels the pin where a maps app takes a label. */
  label: string;
  /** One icon with a menu, for a place's row. */
  compact?: boolean;
  className?: string;
}) {
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const targets = mapsTargets(point, label);
  if (targets.length === 0) return null;
  // The row under it opens and hovers; following a link does neither.
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  if (compact) {
    return (
      <>
        <Tooltip title={`Open ${label} in maps`} describeChild>
          <IconButton size="small" className={className} aria-label={`Open ${label} in maps`}
            aria-haspopup="menu" aria-expanded={menuAt !== null}
            onClick={(event) => { event.stopPropagation(); setMenuAt(event.currentTarget); }}>
            <MapIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={menuAt} open={menuAt !== null} onClose={() => setMenuAt(null)} onClick={stop}>
          {targets.map((target) => (
            <MenuItem key={target.id} component="a" href={target.href} {...opening(target)}
              onClick={() => setMenuAt(null)}>
              <ListItemIcon><TargetIcon target={target} /></ListItemIcon>
              {target.name}
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  }
  return (
    <Stack direction="row" alignItems="center" className={className} sx={{ gap: 0.5, flexWrap: 'wrap' }}>
      <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>Open in</Typography>
      {targets.map((target) => (
        <Button key={target.id} variant="text" size="small" startIcon={<TargetIcon target={target} />}
          component="a" href={target.href} {...opening(target)} onClick={stop}>
          {target.name}
        </Button>
      ))}
    </Stack>
  );
}
