/**
 * "Open places in": the maps app a place's *Open in maps* opens (#1604).
 *
 * A signed-in visitor's choice is saved with the account; a signed-out
 * visitor's in this browser (`useMapsApp`). The device's own app is named for
 * the device — Apple Maps, or the maps app Android hands a place to — and on a
 * device with neither it is still offered, saying that the links side by side
 * stand in for it here, since the same account may be used on a phone.
 */

import { Alert, FormControl, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import { MAPS_APPS, type MapsApp } from '@tyr/shared/preferences';
import { useMapsApp } from '../../hooks/useMapsApp';
import { mapsPlatform } from '../../utils/mapsLink';

const ASK = 'ask';

function nameOf(app: MapsApp): string {
  if (app === 'osm') return 'OpenStreetMap';
  if (app === 'google') return 'Google Maps';
  const platform = mapsPlatform();
  if (platform === 'apple') return 'Apple Maps';
  if (platform === 'android') return 'This device\'s maps app';
  return 'The device\'s own maps app (Apple Maps or Android\'s); here, every map side by side';
}

export function MapsAppSetting({ signedIn }: { signedIn: boolean }) {
  const { mapsApp, setMapsApp, saving, failed } = useMapsApp();
  return (
    <FormControl component="fieldset" disabled={saving} sx={{ width: '100%' }}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Open places in
      </Typography>
      <RadioGroup
        value={mapsApp ?? ASK}
        onChange={(event) => setMapsApp(event.target.value === ASK ? null : (event.target.value as MapsApp))}
      >
        <FormControlLabel value={ASK} control={<Radio size="small" />} label="Ask each time: every map side by side" />
        {MAPS_APPS.map((app) => (
          <FormControlLabel key={app} value={app} control={<Radio size="small" />} label={nameOf(app)} />
        ))}
      </RadioGroup>
      <Typography variant="caption" color="text.secondary">
        {signedIn ? 'Saved with your account, on every device you sign in on.' : 'Kept in this browser.'}
      </Typography>
      {failed && <Alert severity="error" sx={{ mt: 1 }}>The choice could not be saved. Try again.</Alert>}
    </FormControl>
  );
}
