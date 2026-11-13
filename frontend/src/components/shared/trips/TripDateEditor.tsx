import { useState } from 'react';
import { Box, Button, MenuItem, TextField } from '@mui/material';
import { daysInMonth, EARLIEST_TRIP_YEAR } from '@tyr/shared/approximateDates';
import type { TripDateBody } from '../../../api/trips';
import { monthNames } from '../../../utils/dateFormat';

interface TripDateEditorProps {
  initial: TripDateBody;
  disabled: boolean;
  onSave: (date: TripDateBody) => void;
  onCancel: () => void;
}

const ANY = '';

/**
 * A trip's date in its own line (#2120): a year, then a month and a day as
 * precise as the traveller remembers, "Any month" and "Any day" leaving them
 * out. "I don't remember" saves the trip with no date.
 */
export function TripDateEditor({ initial, disabled, onSave, onCancel }: TripDateEditorProps) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(initial.year ?? thisYear);
  const [month, setMonth] = useState<number | null>(initial.month);
  const [day, setDay] = useState<number | null>(initial.day);
  const years = Array.from({ length: thisYear - EARLIEST_TRIP_YEAR + 1 }, (_, i) => thisYear - i);
  const days = month === null ? 0 : daysInMonth(year, month);
  const shownDay = day !== null && day <= days ? day : null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', py: 0.5 }}>
      <TextField select size="small" label="Year" value={year} onChange={e => setYear(Number(e.target.value))}>
        {years.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
      </TextField>
      <TextField
        select size="small" label="Month" value={month ?? ANY} sx={{ minWidth: 130 }}
        onChange={e => { const m = e.target.value === ANY ? null : Number(e.target.value); setMonth(m); if (m === null) setDay(null); }}
      >
        <MenuItem value={ANY}>Any month</MenuItem>
        {monthNames().map((name, i) => <MenuItem key={name} value={i + 1}>{name}</MenuItem>)}
      </TextField>
      <TextField
        select size="small" label="Day" value={shownDay ?? ANY} disabled={month === null}
        onChange={e => setDay(e.target.value === ANY ? null : Number(e.target.value))}
      >
        <MenuItem value={ANY}>Any day</MenuItem>
        {Array.from({ length: days }, (_, i) => <MenuItem key={i + 1} value={i + 1}>{i + 1}</MenuItem>)}
      </TextField>
      <Button size="small" variant="contained" disabled={disabled} onClick={() => onSave({ year, month, day: shownDay })}>
        Save
      </Button>
      <Button size="small" disabled={disabled} onClick={onCancel}>Cancel</Button>
      <Button size="small" disabled={disabled} onClick={() => onSave({ year: null, month: null, day: null })}>
        I don't remember
      </Button>
    </Box>
  );
}
