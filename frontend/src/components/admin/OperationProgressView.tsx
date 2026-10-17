/**
 * How far a long admin operation is (#1356), drawn the same way wherever one
 * runs: the step it is on as "Step N of M" with its sentence, a bar that
 * measures that step (indeterminate only while the step cannot say how much it
 * has to do), how much of the step is done, how long the step and the whole
 * have run, a wait on an outside service with how long it has left, and a
 * cancel that has been asked and not yet acted on.
 */

import { Box, LinearProgress, Typography } from '@mui/material';
import type { OperationProgressAnswer } from '../../api/admin';
import { elapsedText } from '@tyr/shared/durations';

interface OperationProgressViewProps {
  operation: OperationProgressAnswer;
  /** Said until the first step opens. */
  starting: string;
  /**
   * The run's own latest sentence, said under the step when it says more than
   * the step does ("Loading divisions into memory...").
   */
  detail?: string;
  /** How a step's count is written: a dump build's bytes as sizes rather than digits. */
  formatCount?: (n: number) => string;
}

export function OperationProgressView({ operation, starting, detail, formatCount = (n) => n.toLocaleString() }: OperationProgressViewProps) {
  const { step, wait } = operation;
  const measurable = !!step && step.total > 0;
  const percent = measurable ? Math.min(100, Math.round((step.done / step.total) * 100)) : 0;
  // A run that names its steps as it goes (a dump build) cannot say how many it has.
  const stepLabel = step && (step.count === null ? `Step ${step.index}` : `Step ${step.index} of ${step.count}`);
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Typography variant="body2">
          {step ? <><strong>{stepLabel}</strong> · {step.sentence}</> : starting}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {elapsedText(operation.elapsedSeconds)}
        </Typography>
      </Box>
      <LinearProgress
        variant={measurable ? 'determinate' : 'indeterminate'}
        value={measurable ? percent : undefined}
        aria-label={stepLabel ?? starting}
      />
      {step && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {measurable ? `${formatCount(step.done)} of ${formatCount(step.total)} · ` : ''}
          {!measurable && step.done > 0 ? `${formatCount(step.done)} so far · ` : ''}
          this step {elapsedText(step.elapsedSeconds)}
        </Typography>
      )}
      {step && detail && detail !== step.sentence && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{detail}</Typography>
      )}
      {operation.cancelling && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }} role="status">
          Cancelling: the run stops at the next point it can, usually when this step ends.
        </Typography>
      )}
      {wait && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }} role="status">
          {wait.sentence}
          {wait.secondsLeft > 0 ? ` (${elapsedText(wait.secondsLeft)} left)` : ''}
        </Typography>
      )}
    </Box>
  );
}
