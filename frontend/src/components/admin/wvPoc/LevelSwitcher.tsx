import { ToggleButton, ToggleButtonGroup, Tooltip, Box } from '@mui/material';
import type { LevelId, LevelProgress, LevelStatus } from './wvPocLevels';

const GLYPH: Record<LevelStatus, string> = { empty: '○', in_progress: '◐', done: '⬤' };

interface LevelSwitcherProps {
  value: LevelId;
  onChange: (level: LevelId) => void;
  progress: LevelProgress;
}

export function LevelSwitcher({ value, onChange, progress }: LevelSwitcherProps) {
  const levels: Array<{ id: LevelId; label: string; status: LevelStatus; badge: string; tip: string }> = [
    { id: 'l1', label: '① Supra-national', status: progress.l1.status, badge: `${progress.l1.continents} groups`, tip: `${progress.l1.countries} countries in ${progress.l1.continents} continents` },
    { id: 'l2', label: '② Countries', status: progress.l2.status, badge: `${progress.l2.signedOff}/${progress.l2.total}`, tip: `${progress.l2.signedOff} of ${progress.l2.total} countries signed off` },
    { id: 'l3', label: '③ Sub-national', status: progress.l3.status, badge: `${progress.l3.leafResolved}/${progress.l3.leafTotal}`, tip: `${progress.l3.leafResolved} of ${progress.l3.leafTotal} leaves resolved` },
  ];

  const recommendedNext = levels.find((l) => l.status !== 'done')?.id;

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, next: LevelId | null) => { if (next !== null) onChange(next); }}
      aria-label="World-view build level"
    >
      {levels.map(({ id, label, status, badge, tip }) => (
        <Tooltip key={id} title={tip}>
          <ToggleButton value={id} aria-label={label} sx={{ textTransform: 'none', gap: 0.75 }}>
            <span>{GLYPH[status]}</span>
            <span>{label}</span>
            <Box component="span" sx={{ opacity: 0.7, fontSize: '0.8em' }}>{badge}</Box>
            {id === recommendedNext && id !== value && (
              <Box component="span" sx={{ ml: 0.5, fontSize: '0.7em', opacity: 0.6 }}>next →</Box>
            )}
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}
