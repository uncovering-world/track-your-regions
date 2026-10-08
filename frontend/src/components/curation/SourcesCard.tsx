/**
 * Two data sources that describe one place differently (#1246): a table of the
 * facts they contradict, one column per source, and the curator picks a source
 * per fact.
 *
 * Rila Monastery is the shape: UNESCO calls it "Rila Monastery" and shows one
 * photograph, Wikidata calls it "Monastery of Saint John of Rila" and shows
 * another. The value readers see now is marked and chosen to begin with, so
 * the one button keeps the place as it is until the curator picks otherwise,
 * and says what it will change. The facts the sources agree on, or that only
 * one of them reports, are named under the table rather than asked. A choice
 * stands until one of the two sources sends something different.
 */

import { useState } from 'react';
import { Box, Button, Card, CardContent, Link, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { chooseSourceViews, suggestSourceViews } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { PictureWithCredit } from '../shared/PictureWithCredit';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import { VIEW_FIELD_WORD } from './feed/rowSpecific';
import { ItemHeader, messageFor } from './queueCard';

type SourceViewField = NonNullable<ReviewQueueItem['source_views']>[number];
type SourceView = SourceViewField['views'][number];
type QuietField = NonNullable<ReviewQueueItem['quiet_fields']>[number];

const FIELD_LABEL: Record<SourceViewField['field'], string> = {
  name: 'Name',
  description: 'Description',
  imageUrl: 'Picture',
  location: 'Where it is',
};

/** The columns: every source with a view of some asked field, in the order the server gave them. */
function sourceColumns(fields: readonly SourceViewField[]): { key: string; kind: string; source: string }[] {
  const seen = new Map<string, { key: string; kind: string; source: string }>();
  for (const field of fields) {
    for (const view of field.views) {
      const key = `${view.kind_name}|${view.source_name}`;
      if (!seen.has(key)) seen.set(key, { key, kind: view.kind_name, source: view.source_name });
    }
  }
  return [...seen.values()];
}

const coordinates = (view: SourceView) => (view.latitude == null || view.longitude == null
  ? '' : `${view.latitude.toFixed(5)}, ${view.longitude.toFixed(5)}`);

/** Why a fact is not asked, in a few words. */
function quietWords(quiet: QuietField): string {
  const word = VIEW_FIELD_WORD[quiet.field];
  if (quiet.why === 'answered') return `${word} (a curator chose)`;
  if (quiet.why === 'one_source') return `${word} (only one source has it)`;
  if (quiet.field === 'location' && quiet.metres != null) return `${word} (the points are ${quiet.metres} m apart)`;
  return `${word} (the same in both)`;
}

function ViewValue({ field, view }: { field: SourceViewField['field']; view: SourceView }) {
  if (field === 'imageUrl' && view.image_url) {
    return <PictureWithCredit url={view.image_url} credit={view.image_credit} alt={`${view.kind_name}’s picture`} width={330} />;
  }
  if (field === 'location') return <Typography variant="body2">{coordinates(view)}</Typography>;
  return <Typography variant="body1" sx={{ fontWeight: field === 'name' ? 600 : 400 }}>{view.value}</Typography>;
}

/** The location row's way to the map: both points, readers' one first. */
function BothPoints({ name, views }: { name: string; views: readonly SourceView[] }) {
  const [open, setOpen] = useState(false);
  const shown = views.find(view => view.shown) ?? views[0];
  const other = views.find(view => view !== shown);
  if (!shown || !other || shown.latitude == null || shown.longitude == null
    || other.latitude == null || other.longitude == null) return null;
  return (
    <>
      <Link component="button" type="button" variant="body2" underline="hover" onClick={() => setOpen(true)}>
        see both points on the map
      </Link>
      <PointPreviewDialog
        open={open}
        onClose={() => setOpen(false)}
        name={`${name}: ${shown.kind_name}’s point, and ${other.kind_name}’s`}
        latitude={shown.latitude}
        longitude={shown.longitude}
        movedTo={{ latitude: other.latitude, longitude: other.longitude }}
      />
    </>
  );
}

/** What the curator is told once the answer landed. */
function outcomeOf(name: string, changed: readonly SourceViewField['field'][]): string {
  if (changed.length === 0) return `${name}: keeps what readers see`;
  return `${name}: now shows ${changed.map(field => VIEW_FIELD_WORD[field]).join(', ')} from the source you chose`;
}

/** The one button's words: what pressing it will change. */
function saveLabel(changes: number): string {
  if (changes === 0) return 'Keep what readers see';
  return `Publish ${changes} ${changes === 1 ? 'change' : 'changes'}`;
}

/** One source's value of one fact, as a choice. */
function ViewTile({ field, view, on, onPick, suggested }: {
  field: SourceViewField['field']; view: SourceView; on: boolean; onPick: () => void;
  /** Jev's confidence where it suggests this view (#1260); a suggestion, never a choice. */
  suggested?: number;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={on}
      onClick={onPick}
      sx={{
        textAlign: 'left', font: 'inherit', color: 'text.primary', cursor: 'pointer',
        p: 1.5, borderRadius: 1, bgcolor: on ? 'action.selected' : 'background.paper',
        border: on ? 2 : 1, borderColor: on ? 'primary.main' : 'divider',
        display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-start',
      }}
    >
      <ViewValue field={field} view={view} />
      {suggested !== undefined && (
        // In grey, apart from the marks about readers: a suggestion is not a state of the place.
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Jev suggests this · {Math.round(suggested * 100)} %
        </Typography>
      )}
      <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, minHeight: 18 }}>
        {on && view.shown && 'Readers see this · keeping it'}
        {on && !view.shown && 'Chosen · readers will see this'}
        {!on && view.shown && 'Readers see this now'}
      </Typography>
    </Box>
  );
}

export function SourcesCard({ item, onDone }: {
  item: ReviewQueueItem;
  onDone: (message?: string, experienceId?: number) => void;
}) {
  const fields = item.source_views ?? [];
  const columns = sourceColumns(fields);
  // What readers see, chosen to begin with: keeping is the answer that changes nothing.
  const [chosen, setChosen] = useState<Record<string, number | null>>(() => Object.fromEntries(
    fields.map(field => [field.field, field.views.find(view => view.shown)?.membership_id ?? null]),
  ));
  const changes = fields.filter(field => {
    const pick = chosen[field.field];
    return pick != null && !field.views.find(view => view.membership_id === pick)?.shown;
  }).length;

  const save = useMutation({
    mutationFn: () => chooseSourceViews(item.id, fields.map(field => ({
      field: field.field, membershipId: chosen[field.field] ?? null,
    }))),
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeOf(item.name, data?.changed ?? []), item.id),
  });

  // Jev's suggestion, where this deployment asks Jev (#1260): shown beside the
  // views, never chosen for the curator. A failed read shows none.
  const { data: suggestions } = useQuery({
    // Keyed by the views too: a suggestion is about the views it was asked
    // for, and a card showing new ones asks again.
    queryKey: queryKeys.experience.viewSuggestions(item.id, JSON.stringify(fields)),
    queryFn: () => suggestSourceViews(item.id),
    staleTime: 300_000,
    retry: false,
  });
  const suggestedFor = (field: string, membershipId: number) => suggestions?.suggestions
    .find(one => one.field === field && one.membershipId === membershipId)?.confidence;
  const pick = (field: string, membershipId: number) => setChosen(previous => ({ ...previous, [field]: membershipId }));
  const quiet = item.quiet_fields ?? [];
  const grid = `120px repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`;

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} kinds={columns.map(column => column.kind)} />
        <Typography variant="body2" sx={{ my: 2 }}>
          {columns.map(column => column.source).join(' and ')} describe this place differently. Readers see
          what is marked until you choose; your choice stays until one of the sources sends something new.
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: grid, columnGap: 2, rowGap: 1.5, alignItems: 'stretch' }}>
          <Box />
          {columns.map(column => (
            <Typography key={column.key} variant="caption" sx={{ fontWeight: 600, letterSpacing: '0.04em' }}>
              {column.kind.toUpperCase()}
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}> · {column.source}</Box>
            </Typography>
          ))}
          {fields.map(field => (
            <Box key={field.field} sx={{ display: 'contents' }}>
              <Stack sx={{ pt: 1.5 }} spacing={0.5}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{FIELD_LABEL[field.field]}</Typography>
                {field.field === 'location' && <BothPoints name={item.name} views={field.views} />}
              </Stack>
              {columns.map(column => {
                // Two sources can fill one kind: a column is a kind and a source.
                const view = field.views.find(one => `${one.kind_name}|${one.source_name}` === column.key);
                if (!view) return <Box key={column.key} />;
                return (
                  <ViewTile
                    key={column.key}
                    field={field.field}
                    view={view}
                    on={chosen[field.field] === view.membership_id}
                    onPick={() => pick(field.field, view.membership_id)}
                    suggested={suggestedFor(field.field, view.membership_id)}
                  />
                );
              })}
            </Box>
          ))}
        </Box>

        {quiet.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Not asked: {quiet.map(quietWords).join(', ')}.
          </Typography>
        )}

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
          <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>
            {saveLabel(changes)}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
