/**
 * The period's acts counted by what an auditor reads them for (#956), above a
 * curator's trail and the feed across curators: the calls against the rule
 * first, since those are what an admin checks a curator by. A small table, a
 * figure to a line, never a sentence of figures (interface-writing rule 3).
 */

import { Table, TableBody, TableCell, TableRow } from '@mui/material';
import type { CuratorActivity } from '../../api/admin';

const LINES: Array<{ key: keyof CuratorActivity['counts']; label: string }> = [
  { key: 'againstTheRule', label: 'against the rule' },
  { key: 'arrivalsTurnedAway', label: 'arrivals turned away' },
  { key: 'keptOutAsTheRuleSaid', label: 'kept out, as the rule said' },
  { key: 'editedByHand', label: 'edited by hand' },
  { key: 'published', label: 'published' },
];

export function ActivityCounts({ counts }: { counts: CuratorActivity['counts'] }) {
  return (
    <Table size="small" aria-label="Acts in this period" sx={{ width: 'auto', mb: 1.5 }}>
      <TableBody>
        {LINES.map(({ key, label }) => (
          <TableRow key={key} sx={{ '& td': { border: 0, py: 0.25 } }}>
            <TableCell
              align="right"
              sx={{ fontWeight: 500, pl: 0, color: key === 'againstTheRule' && counts[key] > 0 ? 'warning.dark' : undefined }}
            >
              {counts[key].toLocaleString()}
            </TableCell>
            <TableCell>{label}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
