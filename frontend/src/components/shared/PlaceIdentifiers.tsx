/**
 * A place's external identifiers in its curation dialog, and the curator's
 * word on one (#1896, ADR-0143 decision 5): a Wikidata item, a World Heritage
 * reference or an OpenStreetMap object, whether it identifies the place or only
 * refers to it, and who else holds it.
 *
 * The frequent case is two places that are one thing, which a merge settles
 * and this panel only names. The word is for an identifier that names another
 * thing: a chapel carrying its monastery's item, a tower carrying its square's.
 */

import { useState } from 'react';
import {
  Alert, Box, Button, Chip, FormControl, InputLabel, Link, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPlaceIdentifiers, settlePlaceIdentifier, type IdentifierVerdict, type PlaceIdentifier,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { safeHref } from '../../utils/safeHref';
import { wikidataItemUrl } from '../../utils/wikidataLinks';
import { IDENTIFIER_SHAPES } from '@tyr/shared/identifiers';

const SCHEME_EXAMPLE: Record<PlaceIdentifier['scheme'], string> = { wikidata: 'Q12345', whc: '1739-005', osm: 'way/12345' };

const SCHEME_LABEL: Record<PlaceIdentifier['scheme'], string> = {
  wikidata: 'Wikidata item',
  whc: 'World Heritage reference',
  osm: 'OpenStreetMap object',
};

/** The page that names the identifier, or nothing: Wikidata's item, the Centre's list page, the OSM object. */
export function identifierHref(scheme: PlaceIdentifier['scheme'], value: string): string | null {
  if (!IDENTIFIER_SHAPES[scheme].test(value)) return null;
  if (scheme === 'wikidata') return wikidataItemUrl(value);
  // A component's reference opens its site's page: the Centre has no page per component.
  if (scheme === 'whc') return `https://whc.unesco.org/en/list/${value.split('-')[0]}`;
  return `https://www.openstreetmap.org/${value}`;
}

/** What a row says of its standing, in the curator's words. */
function standingOf(row: PlaceIdentifier): { label: string; color: 'success' | 'default' | 'warning' | 'error' } {
  if (row.verdict === 'removed') return { label: 'taken off', color: 'error' };
  const others = row.others.filter(o => o.identifies || row.claimsIdentity);
  if (row.claimsIdentity && !row.identifies && others.length > 0) return { label: 'also claimed by another place', color: 'warning' };
  if (row.identifies) return { label: 'identifies this place', color: 'success' };
  return { label: 'only refers to this place', color: 'default' };
}

const WORDS: { verdict: IdentifierVerdict; label: string; when: (row: PlaceIdentifier) => boolean }[] = [
  { verdict: 'identifies', label: 'It names this place', when: row => row.verdict !== 'identifies' && !row.identifies },
  { verdict: 'refers', label: 'It only refers to this place', when: row => row.verdict !== 'refers' && row.verdict !== 'removed' },
  { verdict: 'removed', label: 'Take it off this place', when: row => row.verdict !== 'removed' },
  { verdict: 'derived', label: 'Let the sources decide', when: row => row.verdict !== null },
];

function IdentifierRow({ row, onSettle, pending }: {
  row: PlaceIdentifier;
  onSettle: (verdict: IdentifierVerdict, note: string) => void;
  pending: boolean;
}) {
  const [note, setNote] = useState('');
  const href = safeHref(identifierHref(row.scheme, row.value));
  const standing = standingOf(row);
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" color="text.secondary">{SCHEME_LABEL[row.scheme]}</Typography>
        {href
          ? <Link href={href} target="_blank" rel="noopener noreferrer" variant="body2">{row.value}</Link>
          : <Typography variant="body2">{row.value}</Typography>}
        <Chip size="small" label={standing.label} color={standing.color} variant="outlined" />
        {row.verdict && <Chip size="small" label="a curator’s word" variant="outlined" />}
      </Stack>
      {row.others.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Also held by {row.others.map(o => `${o.name} (#${o.id}${o.identifies ? ', identifies it' : ''})`).join(', ')}.
          {row.claimsIdentity && !row.identifies ? ' Two places that are one thing are merged, not corrected here.' : ''}
        </Typography>
      )}
      {row.note && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>“{row.note}”</Typography>
      )}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
        <TextField size="small" label="Note" value={note} onChange={e => setNote(e.target.value)} sx={{ minWidth: 200 }} />
        {WORDS.filter(w => w.when(row)).map(w => (
          <Button key={w.verdict} size="small" variant="outlined" disabled={pending} onClick={() => onSettle(w.verdict, note)}>
            {w.label}
          </Button>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * The other half of a move: naming an identifier the sources did not bring.
 * Behind a button, since it is the rare act and its scheme select would
 * otherwise stand beside the dialog's own every time it opens.
 */
function AddIdentifier({ onAdd, pending }: { onAdd: (scheme: PlaceIdentifier['scheme'], value: string, note: string) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [scheme, setScheme] = useState<PlaceIdentifier['scheme']>('wikidata');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  if (!open) {
    return (
      <Button size="small" sx={{ mt: 1 }} onClick={() => setOpen(true)}>Name an identifier the sources missed</Button>
    );
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
      <FormControl size="small" sx={{ minWidth: 190 }}>
        <InputLabel id="identifier-scheme">Identifier</InputLabel>
        <Select labelId="identifier-scheme" label="Identifier" value={scheme} onChange={e => setScheme(e.target.value as PlaceIdentifier['scheme'])}>
          {(Object.keys(SCHEME_LABEL) as PlaceIdentifier['scheme'][]).map(s => <MenuItem key={s} value={s}>{SCHEME_LABEL[s]}</MenuItem>)}
        </Select>
      </FormControl>
      <TextField size="small" label="Value" placeholder={SCHEME_EXAMPLE[scheme]} value={value} onChange={e => setValue(e.target.value.trim())} />
      <TextField size="small" label="Note" value={note} onChange={e => setNote(e.target.value)} />
      <Button size="small" variant="outlined" disabled={pending || value === ''} onClick={() => { onAdd(scheme, value, note); setValue(''); setNote(''); setOpen(false); }}>
        It names this place
      </Button>
      <Button size="small" onClick={() => setOpen(false)}>Cancel</Button>
    </Stack>
  );
}

/** One place's identifiers, in its curation dialog. */
export function PlaceIdentifiers({ experienceId }: { experienceId: number }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.experience.identifiers(experienceId),
    queryFn: () => fetchPlaceIdentifiers(experienceId),
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (body: { scheme: PlaceIdentifier['scheme']; value: string; verdict: IdentifierVerdict; note?: string }) =>
      settlePlaceIdentifier(experienceId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.experience.identifiers(experienceId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLog(experienceId) });
    },
  });
  const settle = (scheme: PlaceIdentifier['scheme'], value: string, verdict: IdentifierVerdict, note: string) =>
    mutation.mutate({ scheme, value, verdict, note: note === '' ? undefined : note });
  const rows = query.data?.identifiers ?? [];
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Identifiers</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        What the sources know this place by. A run finds the place through an identifier that names it, so an
        identifier that names another thing is taken off here, and one the sources missed is named here.
      </Typography>
      {mutation.isError && <Alert severity="error" sx={{ mb: 1 }}>{(mutation.error as Error).message}</Alert>}
      <Stack spacing={1}>
        {rows.map(row => (
          <IdentifierRow
            key={`${row.scheme}:${row.value}`}
            row={row}
            pending={mutation.isPending}
            onSettle={(verdict, note) => settle(row.scheme, row.value, verdict, note)}
          />
        ))}
        {rows.length === 0 && query.isSuccess && (
          <Typography variant="body2" color="text.secondary">No source knows this place by an identifier.</Typography>
        )}
      </Stack>
      <AddIdentifier pending={mutation.isPending} onAdd={(scheme, value, note) => settle(scheme, value, 'identifies', note)} />
    </Box>
  );
}
