/**
 * "Open in maps": a point offered to the visitor's maps apps (#1194, ADR-0115).
 *
 * The one route to a place for a visitor walking there, and the only one for a
 * place with no street address — a village chapel, an excavation, a monument on
 * a hill. Several targets, the device's own app first, then OpenStreetMap and
 * Google Maps (`mapsTargets`), unless the visitor has chosen one (#1604): then
 * that one alone, with the others behind a small "Other maps" menu. A choice of
 * the device's own app on a device that has none shows them all, as before.
 * A `geo:` link opens in place, since the system hands it to an app; a web map
 * opens in a new tab.
 *
 * Two shapes: the targets side by side, each with its icon and name, on a card's
 * line of links; and on one place's row of a card listing several, a single map
 * icon named for that place, whose menu holds the same targets — three icons on
 * each of thirty rows would be ninety.
 */

import { useState } from 'react';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import { Button, Divider, IconButton, ListItemIcon, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material';
import MapIcon from '@mui/icons-material/Map';
import GoogleIcon from '@mui/icons-material/Google';
import AppleIcon from '@mui/icons-material/Apple';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import { mapsPlatform, mapsTargets, type MapsTarget } from '../../utils/mapsLink';
import { useMapsApp } from '../../hooks/useMapsApp';

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

/**
 * Where a visitor chooses the maps app every place opens in (#1604): the
 * Account page, which a signed-out visitor reaches from here too, since their
 * menu offers no way to it.
 */
const CHOOSE_MAPS_APP = { href: '/account', label: 'Choose a maps app for every place' } as const;

/** The targets in a menu under `anchor`, each a plain link, and the way to choose one for good. */
function TargetsMenu({ anchor, targets, onClose }: {
  anchor: HTMLElement | null; targets: MapsTarget[]; onClose: () => void;
}) {
  return (
    <Menu anchorEl={anchor} open={anchor !== null} onClose={onClose} onClick={(event) => event.stopPropagation()}>
      {targets.map((target) => (
        <MenuItem key={target.id} component="a" href={target.href} {...opening(target)} onClick={onClose}>
          <ListItemIcon><TargetIcon target={target} /></ListItemIcon>
          {target.name}
        </MenuItem>
      ))}
      <Divider />
      <MenuItem component="a" href={CHOOSE_MAPS_APP.href} onClick={onClose}>
        <ListItemIcon><TuneIcon fontSize="small" /></ListItemIcon>
        {CHOOSE_MAPS_APP.label}
      </MenuItem>
    </Menu>
  );
}

/** The chosen target, and a small menu of the others. */
function ChosenTarget({ chosen, others, label, compact, className }: {
  chosen: MapsTarget; others: MapsTarget[]; label: string; compact: boolean; className?: string;
}) {
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  const more = (
    <>
      <Tooltip title="Other maps" describeChild>
        {/* Named for its place on a row, since a list of places has one of these per row. */}
        <IconButton size="small" aria-label={compact ? `Other maps for ${label}` : 'Other maps'}
          aria-haspopup="menu" aria-expanded={menuAt !== null}
          onClick={(event) => { event.stopPropagation(); setMenuAt(event.currentTarget); }}>
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <TargetsMenu anchor={menuAt} targets={others} onClose={() => setMenuAt(null)} />
    </>
  );
  if (compact) {
    return (
      <Stack direction="row" alignItems="center" className={className}>
        <Tooltip title={`Open ${label} in ${chosen.name}`} describeChild>
          <IconButton size="small" component="a" href={chosen.href} {...opening(chosen)} onClick={stop}
            aria-label={`Open ${label} in ${chosen.name}`}>
            <TargetIcon target={chosen} />
          </IconButton>
        </Tooltip>
        {more}
      </Stack>
    );
  }
  return (
    <Stack direction="row" alignItems="center" className={className} sx={{ gap: 0.5 }}>
      <Button variant="text" size="small" startIcon={<TargetIcon target={chosen} />}
        component="a" href={chosen.href} {...opening(chosen)} onClick={stop}>
        Open in {chosen.name}
      </Button>
      {more}
    </Stack>
  );
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
  const { mapsApp } = useMapsApp();
  const targets = mapsTargets(point, label);
  if (targets.length === 0) return null;
  const chosen = targets.find((target) => target.id === mapsApp);
  if (chosen) {
    return <ChosenTarget chosen={chosen} others={targets.filter((t) => t !== chosen)} label={label}
      compact={compact} className={className} />;
  }
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
        <TargetsMenu anchor={menuAt} targets={targets} onClose={() => setMenuAt(null)} />
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
      <Tooltip title={CHOOSE_MAPS_APP.label} describeChild>
        <IconButton size="small" component="a" href={CHOOSE_MAPS_APP.href} aria-label={CHOOSE_MAPS_APP.label} onClick={stop}>
          <TuneIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
