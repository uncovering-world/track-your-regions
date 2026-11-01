/**
 * Two data sources that describe one place differently (#1246): a table of the
 * facts they contradict, one column per value of each fact, headed by every
 * source that gives it (#2212), and the curator picks a value per fact.
 *
 * Rila Monastery is the shape: UNESCO calls it "Rila Monastery" and shows one
 * photograph, Wikidata calls it "Monastery of Saint John of Rila" and shows
 * another. The value readers see now is marked and chosen to begin with, so
 * the one button keeps the place as it is until the curator picks otherwise,
 * and says what it will change. The facts the sources agree on, or that only
 * one of them reports, are named under the table rather than asked. A choice
 * stands until one of the two sources sends something different.
 *
 * Each column names the record its value comes from — once for two kinds
 * that read one item — and the point's row says how far apart the points
 * stand and which one a source gave only to the whole minute (#2158). A kind
 * that refused the place is no source of it and is not on the card
 * (`placeViewsSql`, #2212).
 */

import { useState } from 'react';
import { Box, Button, Card, CardContent, Link, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { onWholeMinute } from '@tyr/shared/precision';
import { chooseSourceViews, suggestSourceViews } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { distanceLabel } from '../../utils/moveDescription';
import { safeHref } from '../../utils/safeHref';
import { wikipediaArticleTitle } from '../../utils/wikidataLinks';
import { PictureWithCredit } from '../shared/PictureWithCredit';
import { PointPreviewDialog } from '../shared/PointPreviewDialog';
import type { MapPin } from '../shared/PointPreviewPins';
import { VIEW_FIELD_WORD } from './feed/rowSpecific';
import { minuteCellSize } from './minuteCell';
import { ItemHeader, messageFor } from './queueCard';
import { SourceId, worldHeritagePartsHref } from './SourceId';
import { recordsOf, sourcesOf, viewGroups, type SourceView, type SourceViewField, type ViewGroup } from './sourceGroups';
import { PictureClassMark } from './PictureClassMark';

type QuietField = NonNullable<ReviewQueueItem['quiet_fields']>[number];

const FIELD_LABEL: Record<SourceViewField['field'], string> = {
  name: 'Name',
  subtitle: 'Subtitle',
  imageUrl: 'Picture',
  location: 'Where it is',
  wikipediaUrl: 'Wikipedia article',
};

/**
 * The source's own record of the place, as a way to open it (#2158): the
 * Wikidata item a Wikidata-filled kind reads, the place's page on the World
 * Heritage list. A serial site's view of one of its components is read off
 * the component's record, so the column says that it is the component's and
 * not the property's, and links the list's table of the property's parts,
 * where the component's row is (#2183); the property's own page names no
 * component. A reference the builder does not read links the page the view
 * carries.
 */
function ColumnRecord({ view }: { view: SourceView }) {
  if (!view.component) return <SourceId id={view.external_id} kind={view.kind_name} sourcePage={view.source_page} />;
  const href = safeHref(worldHeritagePartsHref(view.external_id) ?? view.source_page);
  const ref = `component ${view.external_id}`;
  return (
    <Typography variant="caption" color="text.secondary">
      The list's record of {href ? <Link href={href} target="_blank" rel="noopener noreferrer">{ref}</Link> : ref},
      not of the whole property
    </Typography>
  );
}

/**
 * Who gives a column's value (#2212): each record it comes from, under the
 * kinds that read it — "Public art · Monuments & memorials" above one
 * Q775020 — outside the tile, which is a button and cannot hold a link.
 */
function GroupSources({ group }: { group: ViewGroup }) {
  return (
    <Stack spacing={0.75}>
      {recordsOf(group.views).map(views => (
        <Stack key={views[0].membership_id} spacing={0.25}>
          {views.map(view => (
            <Typography key={view.membership_id} variant="caption" sx={{ fontWeight: 600, letterSpacing: '0.04em' }}>
              {view.kind_name.toUpperCase()}
              <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}> · {view.source_name}</Box>
            </Typography>
          ))}
          <ColumnRecord view={views[0]} />
        </Stack>
      ))}
    </Stack>
  );
}

const coordinates = (view: SourceView) => (view.latitude == null || view.longitude == null
  ? '' : `${view.latitude.toFixed(5)}, ${view.longitude.toFixed(5)}`);

/** Why a fact is not asked, in a few words. */
function quietWords(quiet: QuietField): string {
  const word = VIEW_FIELD_WORD[quiet.field];
  if (quiet.why === 'answered') return `${word} (a curator chose)`;
  if (quiet.why === 'one_source') return `${word} (only one source has it)`;
  if (quiet.field === 'location' && quiet.metres != null) return `${word} (the points are ${distanceLabel(quiet.metres)} apart)`;
  return `${word} (the same in both)`;
}

function ViewValue({ field, view, experienceId }: { field: SourceViewField['field']; view: SourceView; experienceId: number }) {
  if (field === 'imageUrl' && view.image_url) {
    return (
      <>
        <PictureWithCredit url={view.image_url} credit={view.image_credit} alt={`${view.kind_name}’s picture`} width={330} />
        {/* A curator choosing between two pictures reads which is a map or a drawing (#2192). */}
        <PictureClassMark experienceId={experienceId} url={view.image_url} />
      </>
    );
  }
  if (field === 'location') {
    // A point given to the whole minute may stand a kilometre or more off (#1853): said on its tile (#2158).
    const { latitude, longitude } = view;
    const rough = latitude != null && longitude != null && onWholeMinute(longitude, latitude);
    return (
      <>
        <Typography variant="body2">{coordinates(view)}</Typography>
        {rough && (
          <Typography variant="caption" color="text.secondary">
            Given only to the whole minute: anywhere in a cell of about {minuteCellSize(latitude)}
          </Typography>
        )}
      </>
    );
  }
  // The title is what a curator weighs; the links to read them sit beside the row (`ArticleLinks`).
  if (field === 'wikipediaUrl') {
    return <Typography variant="body1">{view.value ? wikipediaArticleTitle(view.value) : ''}</Typography>;
  }
  return <Typography variant="body1" sx={{ fontWeight: field === 'name' ? 600 : 400 }}>{view.value}</Typography>;
}

/**
 * The article row's way to the articles (#1975), one link per article: outside
 * the tiles, which are buttons and cannot hold a link. The articles differ, so
 * each title names its link.
 */
function ArticleLinks({ groups }: { groups: readonly ViewGroup[] }) {
  return (
    <>
      {groups.map(({ lead }) => {
        const href = safeHref(lead.value);
        return href && (
          <Link key={lead.membership_id} href={href} target="_blank" rel="noopener noreferrer" variant="body2">
            read {wikipediaArticleTitle(href)}
          </Link>
        );
      })}
    </>
  );
}

/**
 * The location row's way to the map: each source's point, readers' one first,
 * every pin labelled with its source (#2202). Not a move — no run proposes
 * anything here, so no arrow is drawn and nothing says "the run proposes".
 * Each pin offers "keep this point": the same answer as choosing that source's
 * tile for the point and pressing the card's one button, with the card's
 * other choices as they stand, so the curator who reads the answer off the
 * ground gives it there. The card's own button stays what it is.
 */
function BothPoints({ name, groups, onKeep, pending }: {
  name: string;
  /** The point's columns: one pin per point, labelled with every source that gives it (#2212). */
  groups: readonly ViewGroup[];
  /** Answer the point with this view's membership, as the card's button would with it chosen. */
  onKeep: (membershipId: number) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const located = groups.filter(({ lead }) => lead.latitude != null && lead.longitude != null);
  if (located.length < 2) return null;
  const pins: MapPin[] = [...located]
    .sort((a, b) => Number(b.lead.shown) - Number(a.lead.shown))
    .map(({ lead, views }) => ({
      latitude: lead.latitude!, longitude: lead.longitude!,
      label: `${[...new Set(views.map(view => view.source_name))].join(' and ')}${lead.shown ? ' · readers see' : ''}`,
      action: { label: 'keep this point', disabled: pending, onPick: () => { setOpen(false); onKeep(lead.membership_id); } },
    }));
  return (
    <>
      <Link component="button" type="button" variant="body2" underline="hover" onClick={() => setOpen(true)}>
        see {pins.length === 2 ? 'both' : `all ${pins.length}`} points on the map
      </Link>
      <PointPreviewDialog
        open={open}
        onClose={() => setOpen(false)}
        name={`${name}: where each source puts it`}
        latitude={pins[0].latitude}
        longitude={pins[0].longitude}
        pins={pins}
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
function ViewTile({ field, view, on, onPick, suggested, experienceId }: {
  field: SourceViewField['field']; view: SourceView; on: boolean; onPick: () => void; experienceId: number;
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
      <ViewValue field={field} view={view} experienceId={experienceId} />
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
  const { kinds, sources } = sourcesOf(fields);
  const rows = fields.map(field => ({ field, groups: viewGroups(field) }));
  // What readers see, chosen to begin with: keeping is the answer that changes nothing.
  const [chosen, setChosen] = useState<Record<string, number | null>>(() => Object.fromEntries(
    fields.map(field => [field.field, field.views.find(view => view.shown)?.membership_id ?? null]),
  ));
  const changes = fields.filter(field => {
    const pick = chosen[field.field];
    return pick != null && !field.views.find(view => view.membership_id === pick)?.shown;
  }).length;

  // The choices to send are handed in, since a pin on the map answers with
  // the choices as they stand plus its own point, before the state has moved.
  const save = useMutation({
    mutationFn: (picks: Record<string, number | null>) => chooseSourceViews(item.id, fields.map(field => ({
      field: field.field, membershipId: picks[field.field] ?? null,
    }))),
    onSettled: (data, error) => onDone(error ? messageFor(item, error) : outcomeOf(item.name, data?.changed ?? []), item.id),
  });
  const keepPoint = (membershipId: number) => {
    const picks = { ...chosen, location: membershipId };
    setChosen(picks);
    save.mutate(picks);
  };

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
  // A column's suggestion is Jev's for any view in it: the views hold one value.
  const suggestedFor = (field: string, group: ViewGroup) => suggestions?.suggestions
    .find(one => one.field === field && group.views.some(view => view.membership_id === one.membershipId))?.confidence;
  const pick = (field: string, membershipId: number) => setChosen(previous => ({ ...previous, [field]: membershipId }));
  const quiet = item.quiet_fields ?? [];
  // As many columns as the widest row; a narrower row leaves the rest empty, so
  // the next row's label stays in the first column.
  const width = Math.max(1, ...rows.map(row => row.groups.length));
  const grid = `120px repeat(${width}, minmax(0, 1fr))`;

  return (
    <Card variant="outlined">
      <CardContent>
        <ItemHeader item={item} kinds={kinds} />
        <Typography variant="body2" sx={{ my: 2 }}>
          {sources.join(' and ')} describe this place differently. Readers see
          what is marked until you choose; your choice stays until one of the sources sends something new.
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: grid, columnGap: 2, rowGap: 1.5, alignItems: 'stretch' }}>
          {rows.map(({ field, groups }) => (
            <Box key={field.field} sx={{ display: 'contents' }}>
              <Stack sx={{ pt: 1.5 }} spacing={0.5}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{FIELD_LABEL[field.field]}</Typography>
                {field.field === 'location' && field.metres != null && (
                  <Typography variant="body2" color="text.secondary">{distanceLabel(field.metres)} apart</Typography>
                )}
                {field.field === 'location' && (
                  <BothPoints name={item.name} groups={groups} onKeep={keepPoint} pending={save.isPending} />
                )}
                {field.field === 'wikipediaUrl' && <ArticleLinks groups={groups} />}
              </Stack>
              {groups.map(group => (
                // One column per value, headed by every source that gives it;
                // choosing it chooses all of them (#2212).
                <Stack key={group.key} spacing={0.75}>
                  <GroupSources group={group} />
                  <ViewTile
                    experienceId={item.id}
                    field={field.field}
                    view={group.lead}
                    on={group.views.some(view => view.membership_id === chosen[field.field])}
                    onPick={() => pick(field.field, group.lead.membership_id)}
                    suggested={suggestedFor(field.field, group)}
                  />
                </Stack>
              ))}
              {Array.from({ length: width - groups.length }, (_, i) => <Box key={`empty-${i}`} />)}
            </Box>
          ))}
        </Box>

        {quiet.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Not asked: {quiet.map(quietWords).join(', ')}.
          </Typography>
        )}

        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
          <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate(chosen)}>
            {saveLabel(changes)}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
