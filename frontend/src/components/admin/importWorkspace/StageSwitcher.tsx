/**
 * StageSwitcher — A compact MUI ToggleButtonGroup with 3 segments:
 * Hierarchy / Assign / Verify. Each segment shows a progress glyph.
 *
 * Active segment is filled with a stage-colour tint; inactive segments are ghost.
 */

import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import type { VerifyResult } from '../../../api/admin/wvImportWorkflow';

export type StageTab = 'hierarchy' | 'assignment' | 'verification';

interface StageSwitcherProps {
  value: StageTab;
  onChange: (tab: StageTab) => void;
  hierarchyConfirmed: boolean;
  leafResolved: number;
  leafTotal: number;
  verify: VerifyResult | null;
}

function verifyGlyph(verify: VerifyResult | null): string {
  if (verify === null) return '—';
  if (verify.blockers.length > 0) return '⚠';
  return '✓';
}

function verifyHasBlockers(verify: VerifyResult | null): boolean {
  return verify !== null && verify.blockers.length > 0;
}

function verifyTooltip(verify: VerifyResult | null): string {
  if (verify === null) return 'Checks not run yet';
  if (verify.blockers.length > 0) return `${verify.blockers.length} blocker(s)`;
  return 'All checks green';
}

export function StageSwitcher({
  value,
  onChange,
  hierarchyConfirmed,
  leafResolved,
  leafTotal,
  verify,
}: StageSwitcherProps) {
  const theme = useTheme();

  const stages: Array<{
    id: StageTab;
    label: string;
    badge: string;
    colorKey: 'warning' | 'info' | 'success';
    tooltip: string;
  }> = [
    {
      id: 'hierarchy',
      label: 'Hierarchy',
      badge: hierarchyConfirmed ? '✓' : '✗',
      colorKey: 'warning',
      tooltip: hierarchyConfirmed
        ? 'Hierarchy confirmed'
        : 'Hierarchy not confirmed',
    },
    {
      id: 'assignment',
      label: 'Assign',
      badge: `${leafResolved}/${leafTotal}`,
      colorKey: 'info',
      tooltip: `${leafResolved} of ${leafTotal} leaves resolved`,
    },
    {
      id: 'verification',
      label: 'Verify',
      badge: verifyGlyph(verify),
      // warning when blockers, success otherwise (including null = not-run '—')
      colorKey: verifyHasBlockers(verify) ? 'warning' : 'success',
      tooltip: verifyTooltip(verify),
    },
  ];

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_, next: StageTab | null) => {
        // ToggleButtonGroup passes null when clicking the active button;
        // keep the current selection in that case.
        if (next !== null) onChange(next);
      }}
      sx={{ height: 28 }}
    >
      {stages.map(({ id, label, badge, colorKey, tooltip }) => {
        const isActive = value === id;
        const color = theme.palette[colorKey].main;
        return (
          <Tooltip key={id} title={tooltip} placement="bottom" enterDelay={400} disableInteractive>
            <ToggleButton
              value={id}
              sx={{
                height: 28,
                fontSize: '0.72rem',
                textTransform: 'none',
                px: 1.5,
                gap: 0.5,
                border: isActive
                  ? `1px solid ${color} !important`
                  : undefined,
                color: isActive ? color : 'text.secondary',
                bgcolor: isActive
                  ? `${alpha(color, 0.12)} !important`
                  : 'transparent',
                '&:hover': {
                  bgcolor: alpha(color, 0.08),
                },
              }}
            >
              {label}
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: isActive ? color : 'inherit',
                  marginLeft: 2,
                }}
              >
                {badge}
              </span>
            </ToggleButton>
          </Tooltip>
        );
      })}
    </ToggleButtonGroup>
  );
}
