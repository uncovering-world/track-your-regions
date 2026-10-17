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
}

export function OperationProgressView({ operation, starting }: OperationProgressViewProps) {
  const { step, wait } = operation;
  const measurable = !!step && step.total > 0;
  const percent = measurable ? Math.min(100, Math.round((step.done / step.total) * 100)) : 0;
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
        <Typography variant="body2">
          {step ? <><strong>Step {step.index} of {step.count}</strong> · {step.sentence}</> : starting}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {elapsedText(operation.elapsedSeconds)}
        </Typography>
      </Box>
      <LinearProgress
        variant={measurable ? 'determinate' : 'indeterminate'}
        value={measurable ? percent : undefined}
        aria-label={step ? `Step ${step.index} of ${step.count}` : starting}
      />
      {step && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {measurable ? `${step.done.toLocaleString()} of ${step.total.toLocaleString()} · ` : ''}
          this step {elapsedText(step.elapsedSeconds)}
        </Typography>
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
