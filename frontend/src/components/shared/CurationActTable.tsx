/**
 * The curation log as an audit table (#956): one act a row, under the day it
 * happened, with the fact it changed and the value before and after. One table
 * for both readers of the log:
 *
 * - **the trail** an admin audits a curator by (`variant="trail"`): the time,
 *   the place with its picture and a way to open it, and the curator in the
 *   feed across curators;
 * - **a place's History** in the Curate dialog (`variant="history"`): the
 *   date and time, and who acted, the place being the dialog's own.
 *
 * An act against what the rule decided — a place put back, an arrival turned
 * away, a place taken out of a kind — is marked on its row, since that is what
 * an auditor checks first. Why the rule decided, the curator's own words and the
 * whole of what the act recorded open under the row (*Why*, or *More*), so no
 * field the log holds goes unshown. No raw record is shown: the table is the
 * record, read.
 */

import { Fragment, useState, type ReactNode } from 'react';
import { Box, Button, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { ImageCredit } from '../../api/client.generated';
import { DenseThumbnail } from './DenseThumbnail';
import { actionLabel } from './curationLog';
import { actNote, actRecord, actRows, actWhy, againstTheRule, type Act, type ActRow } from './actRows';

/** One act as the table needs it. */
export interface ActEntry extends Act {
  id: number;
  created_at: string | null;
  /** Who acted, named as the screen names them. */
  who: string;
  /** The place the act was about, for the trail; the History is the place's own. */
  place?: { id: number; name: string; imageUrl: string | null; credit: ImageCredit | null };
  /** In a History, the entry a merge folded into this place that the act was about. */
  about?: string;
}

/** The day an act happened, "16 November", with its year where it is not this one. */
function dayOf(iso: string | null): string {
  if (!iso) return 'Date not recorded';
  const date = new Date(iso);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year });
}

/** The local calendar day an act happened, as a key: two years' 10 Novembers are two days. */
function dayKeyOf(iso: string | null): string {
  if (!iso) return 'none';
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
const timeOf = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

/** A value as the cell reads it: a dash for empty, and "not recorded" where the log kept none. */
function Value({ value }: { value: string | null | undefined }) {
  if (value === null) return <Typography component="span" variant="body2" color="text.secondary">not recorded</Typography>;
  if (value === undefined || value === '' || value === '(empty)') return <>—</>;
  return <>{value}</>;
}

/** Group the entries, newest first, under the day each falls on. */
function byDay(entries: readonly ActEntry[]): Array<{ key: string; day: string; entries: ActEntry[] }> {
  const days: Array<{ key: string; day: string; entries: ActEntry[] }> = [];
  for (const entry of entries) {
    const key = dayKeyOf(entry.created_at);
    const last = days.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else days.push({ key, day: dayOf(entry.created_at), entries: [entry] });
  }
  return days;
}

export function CurationActTable({ entries, variant, showCurator = false, rowActions }: {
  entries: readonly ActEntry[];
  variant: 'trail' | 'history';
  /** The feed across curators names who acted; one curator's own trail does not need to. */
  showCurator?: boolean;
  /**
   * What a row offers beside the act: the trail's way to open the place, a
   * History's undo or take-back. The caller's, since opening a place is the
   * Curate dialog, which a History sits inside.
   */
  rowActions?: (entry: ActEntry) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const trail = variant === 'trail';
  const columns = 7 + (trail && showCurator ? 1 : 0);
  return (
    <Box sx={{ overflowX: 'auto' }}>
      {/* The trail's columns are wide on a wide panel; a History sits in the Curate dialog and wraps to its width. */}
      <Table size="small" sx={{ minWidth: trail ? 760 : undefined }}>
        <TableHead>
          <TableRow>
            <TableCell>{trail ? 'Time' : 'When'}</TableCell>
            {!trail && <TableCell>Who</TableCell>}
            <TableCell>Action</TableCell>
            {trail && <TableCell>Place</TableCell>}
            {trail && showCurator && <TableCell>Curator</TableCell>}
            <TableCell>Fact</TableCell>
            <TableCell>Before</TableCell>
            <TableCell>After</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {byDay(entries).map(({ key, day, entries: ofDay }) => (
            <Fragment key={key}>
              {trail && (
                <TableRow>
                  <TableCell colSpan={columns} sx={{ bgcolor: 'action.hover', color: 'text.secondary', fontWeight: 500, py: 0.5 }}>
                    {day}
                  </TableCell>
                </TableRow>
              )}
              {ofDay.map((entry) => (
                <ActRows
                  key={entry.id}
                  entry={entry}
                  trail={trail}
                  showCurator={showCurator}
                  columns={columns}
                  open={open === entry.id}
                  onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                  actions={rowActions?.(entry)}
                />
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function ActRows({ entry, trail, showCurator, columns, open, onToggle, actions }: {
  entry: ActEntry;
  trail: boolean;
  showCurator: boolean;
  columns: number;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  const rows: ActRow[] = actRows(entry);
  const named = actionLabel(entry.action);
  const against = againstTheRule(entry);
  const why = actWhy(entry);
  const note = actNote(entry);
  const record = actRecord(entry);
  const more = Boolean(why || note || record);
  const opens = why ? 'Why' : 'More';
  const span = rows.length;
  const mark = against ? { borderLeft: '3px solid', borderLeftColor: 'warning.main' } : {};
  return (
    <>
      {rows.map((row, i) => (
        <TableRow key={i} sx={{ verticalAlign: 'top' }}>
          {i === 0 && (
            <>
              <TableCell rowSpan={span} sx={{ whiteSpace: 'nowrap', color: 'text.secondary', ...mark }}>
                {trail ? timeOf(entry.created_at) : `${dayOf(entry.created_at)} ${timeOf(entry.created_at)}`}
              </TableCell>
              {!trail && (
                <TableCell rowSpan={span}>
                  {entry.who}
                  {entry.about && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>About {entry.about}</Typography>}
                </TableCell>
              )}
              <TableCell rowSpan={span} sx={{ whiteSpace: 'nowrap', fontWeight: 500, color: named?.color }}>
                {named?.label ?? entry.action.replace(/_/g, ' ')}
                {against && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'warning.dark', fontWeight: 500 }}>
                    against the rule
                  </Typography>
                )}
              </TableCell>
              {trail && (
                <TableCell rowSpan={span}>
                  {entry.place && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <DenseThumbnail
                        imageUrl={entry.place.imageUrl}
                        title={entry.place.name}
                        credit={entry.place.credit}
                        width={32}
                        height={32}
                        reserve
                      />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{entry.place.name}</Typography>
                    </Box>
                  )}
                </TableCell>
              )}
              {trail && showCurator && <TableCell rowSpan={span}>{entry.who}</TableCell>}
            </>
          )}
          <TableCell sx={{ color: 'text.secondary' }}>{row.fact ?? ''}</TableCell>
          {row.note !== undefined ? (
            <TableCell colSpan={2} sx={{ color: 'text.secondary' }}>{row.note}</TableCell>
          ) : (
            <>
              <TableCell sx={{ color: 'text.secondary' }}><Value value={row.before} /></TableCell>
              <TableCell><Value value={row.after} /></TableCell>
            </>
          )}
          {i === 0 && (
            <TableCell rowSpan={span} align="right" sx={{ whiteSpace: 'nowrap' }}>
              {more && (
                <Button size="small" onClick={onToggle} aria-expanded={open} sx={{ textTransform: 'none', minWidth: 0 }}>
                  {open ? 'Hide' : opens}
                </Button>
              )}
              {actions}
            </TableCell>
          )}
        </TableRow>
      ))}
      {open && more && (
        <TableRow>
          <TableCell colSpan={columns} sx={{ bgcolor: 'action.hover' }}>
            {why && <Typography variant="body2">{why}</Typography>}
            {note && <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>“{note}”</Typography>}
            {record && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-line', mt: 0.5 }}>{record}</Typography>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
