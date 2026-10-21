/**
 * AddExperienceDialog — Shared dialog for adding experiences to a region.
 *
 * Two tabs:
 *   1. Create New — create a new manual experience with auto-fill from Wikidata
 *   2. Search & Add — search existing experiences by name, assign to region
 *
 * Auto-fill: once the curator has typed a name (3+ chars), *Look up* (the
 * button beside it, or Enter in the field) finds the place (Nominatim) and the
 * Wikidata item it is, filling the fields that are empty: the image and
 * description from the item; the location from the item's own coordinate
 * where the item is the place — Nominatim found none, or the item is the one
 * the found place links to — and from the found place's point otherwise
 * (`lookupLocation`). An item the name search matched that is not the place
 * found is a namesake elsewhere and fills none of them (`namesakeOf`): the
 * outcome names it as not the place. A lookup that finds no location says so
 * beside the match. It never runs as the curator types:
 * Nominatim's usage policy forbids auto-complete over its API, and a lookup
 * fired by a pause in typing searched a half-typed name. Pressed again
 * (*Look up again*), it overwrites what an earlier lookup filled in.
 *
 * Used from both Map mode (ExperienceList) and Discover mode
 * (DiscoverExperienceView).
 */

import { memo, useId, useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Tabs,
  Tab,
  Box,
  Typography,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
  FormControl,
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  searchExperiences,
  fetchExperienceKinds,
  type ExperienceSearchResult,
} from '../../api/experiences';
import { assignExperienceToRegion, createManualExperience } from '../../api/curation';
import { searchPlaces, suggestImageUrl, type PlaceResult, type ImageSuggestion } from '../../api/geocode';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { useEditForm } from '../../hooks/useEditForm';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { LocationPicker } from './LocationPicker';
import { LoadingSpinner } from './LoadingSpinner';
import { EmptyState } from './EmptyState';
import { ImageCreditLine } from './ImageCreditLine';
import { PictureWithCredit } from './PictureWithCredit';
import { typeOptionsFor } from '../../utils/experienceTypes';
import { queryKeys } from '../../api/queryKeys';

/**
 * The new place's fields, named by the create body's keys (ADR-0076); the one
 * coordinates box stands for the body's `latitude` and `longitude`.
 */
type NewPlace = {
  name: string;
  description: string;
  type: string;
  kindId: number | '';
  coords: { lat: number; lng: number } | null;
  imageUrl: string;
  wikipediaUrl: string;
  websiteUrl: string;
};

/** The fields a create sends only when filled in; the rest the body requires. */
const OPTIONAL_FIELDS = ['description', 'type', 'imageUrl', 'wikipediaUrl', 'websiteUrl'] as const;
const COORDS_PATHS = { latitude: 'coords', longitude: 'coords' } as const;
const REQUIRED_FIELDS = ['name', 'kindId', 'coords'] as const;

/**
 * Calls `onOpen` in the render where `key` changes to a value, not after it in
 * an effect, so an opening never paints a frame of the last opening's choices.
 * `null` is closed; the first render's key counts as already seen.
 */
function useOnOpening(key: string | null, onOpen: () => void): void {
  const [seen, setSeen] = useState(key);
  if (key === seen) return;
  setSeen(key);
  if (key !== null) onOpen();
}

/** A select points at its refusal while it has one, so the reason is read out with it. */
function describedBy(error: string | undefined, id: string) {
  return { 'aria-describedby': error ? id : undefined };
}

/** The name field's *Look up*: a spinner while it runs, *Look up again* once it has. */
function LookUpButton({ loading, looked, disabled, onClick }: {
  loading: boolean; looked: boolean; disabled: boolean; onClick: () => void;
}) {
  let label: React.ReactNode = looked ? 'Look up again' : 'Look up';
  if (loading) label = <CircularProgress size={16} />;
  return (
    <Button size="small" onClick={onClick} disabled={disabled} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
      {label}
    </Button>
  );
}

function nameHelperText(loading: boolean, name: string): string | undefined {
  if (loading) return ' '; // Reserve space so layout doesn't jump
  if (name.length >= 1 && name.length < 3) return 'Type 3+ characters to look the place up';
  return undefined;
}

function pickImageHelperText(args: {
  isError: boolean;
  isSuccess: boolean;
  successEntityLabel: string | undefined;
  imageAutoFilled: boolean;
  hasNewImageUrl: boolean;
  autoFillEntityLabel: string | undefined;
}): string {
  if (args.isError) return 'No image found on Wikidata';
  if (args.isSuccess) return `Found via ${args.successEntityLabel}`;
  if (args.imageAutoFilled && args.hasNewImageUrl) {
    return args.autoFillEntityLabel
      ? `Auto-suggested from ${args.autoFillEntityLabel}`
      : 'Auto-suggested from Wikidata';
  }
  return 'Wikimedia Commons URLs work best';
}

/**
 * The place a lookup is about, from Nominatim: asked with the region's name
 * first, which tells one "Old Town Hall" from another ("Old Town Hall
 * Czechia" finds Brno's), then by the name alone when that finds nothing.
 * Nominatim reads a query as an address, and a continent, a Wikivoyage region
 * or a world view's own group ("Europe", "Balkans") is no part of one:
 * "Charles Bridge Europe" finds nothing where "Charles Bridge" finds Karlův
 * most (#270). A search that fails is not asked again — the usage policy's
 * answer to a client that keeps asking after a refusal is a ban — and counts
 * as no place: the item is still looked for by its name.
 */
async function findPlace(
  name: string, regionName: string | undefined, stillAsked: () => boolean,
): Promise<PlaceResult | undefined> {
  const queries = regionName ? [`${name} ${regionName}`, name] : [name];
  for (const query of queries) {
    let places: PlaceResult[];
    try {
      places = await searchPlaces(query, 1);
    } catch {
      return undefined;
    }
    if (places.length > 0 || !stillAsked()) return places[0];
  }
  return undefined;
}

/** A Wikidata item as the lookup outcome names it. */
type ItemRef = { label: string; wikidataId: string };

/**
 * What the last lookup found, under the name: the Wikidata item it matched, or
 * the place Nominatim found where no item was — with the namesake the name
 * search matched instead, named as not the place — and, beside either or
 * alone, that it found no location, while the curator has set none.
 */
function LookupOutcome({ entity, namesake, found, locationMissed }: {
  entity: ItemRef | null; namesake: ItemRef | null; found: string | null; locationMissed: boolean;
}) {
  if (!entity && !found && !locationMissed) return null;
  let match: React.ReactNode = null;
  if (entity) match = <>Matched: <strong>{entity.label}</strong> ({entity.wikidataId})</>;
  else if (found) {
    match = (
      <>
        Found: {found}
        {namesake && (
          <Box component="span" sx={{ display: 'block' }}>
            No item matched the place: <strong>{namesake.label}</strong> ({namesake.wikidataId}) only shares its name
          </Box>
        )}
      </>
    );
  }
  return (
    <Box sx={{
      mt: 0.75,
      px: 1.5,
      py: 0.75,
      bgcolor: 'action.hover',
      borderRadius: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 1,
    }}>
      {match && (
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>{match}</Typography>
      )}
      {locationMissed && (
        // The primary text colour, heavier than the match beside it: the
        // theme's amber reads at about 2:1 on this box, too faint for a caption.
        <Typography variant="caption" color="text.primary" sx={{ lineHeight: 1.4, fontWeight: 600 }}>
          No location found — set it below
        </Typography>
      )}
    </Box>
  );
}

/**
 * A search hit's picture and its lines, including whose photograph it is.
 *
 * Its own component because the row holds state: whether the picture arrived.
 * Most of what this dialog searches is UNESCO, where four URLs in five answered
 * 403 until ADR-0043 replaced the portal's photographs with Commons files
 * (#557); a picture can still fail — and hiding the `<img>` while leaving the
 * credit would name a photographer under nothing.
 */
function SearchResultBody({ exp, imageUrl }: { exp: ExperienceSearchResult; imageUrl: string }) {
  const [failed, setFailed] = useState(false);
  const shown = failed ? '' : imageUrl;
  return (
    <>
      {shown && (
        <Box
          component="img"
          src={shown}
          alt=""
          sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
          onError={() => setFailed(true)}
        />
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <ListItemText
          primary={exp.name}
          secondary={[exp.kind_name, exp.type, exp.country_names?.[0]].filter(Boolean).join(' \u00B7 ')}
          primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}
          secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
          sx={{ my: 0 }}
        />
        {/* Hung on the picture that is actually on screen: these rows show one at
            40 px, and a small picture is still the picture being shown. Nothing
            here names an artist, so the credit has nothing to repeat and always
            draws. */}
        {shown && <ImageCreditLine credit={exp.image_credit} />}
      </Box>
    </>
  );
}

interface AddExperienceDialogProps {
  open: boolean;
  onClose: () => void;
  regionId: number;
  /** Region name — tried with the name in the place search first (`findPlace`) */
  regionName?: string;
  /** Pre-select this source when opening Create New tab */
  defaultKindId?: number;
  /** Open directly on a specific tab: 0 = Create New, 1 = Search & Add */
  defaultTab?: 0 | 1;
}

function AddExperienceDialogComponent({ open, onClose, regionId, regionName, defaultKindId, defaultTab }: AddExperienceDialogProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(defaultTab ?? 0);
  const [searchQuery, setSearchQuery] = useState('');

  // --- Search & Assign tab ---
  const { data: searchResults, isFetching } = useQuery({
    queryKey: queryKeys.experiences.search(searchQuery),
    queryFn: () => searchExperiences(searchQuery, 20),
    enabled: searchQuery.length >= 2,
  });

  const assignMutation = useMutation({
    mutationFn: (experienceId: number) => assignExperienceToRegion(experienceId, regionId),
    onSuccess: () => {
      invalidateExperiences(queryClient, { regionId });
    },
  });

  // --- Kinds for Create New tab ---
  const { data: kinds } = useQuery({
    queryKey: queryKeys.experiences.kinds,
    queryFn: fetchExperienceKinds,
  });

  // --- Create New tab state ---
  // The draft outlives a close — the lazy wrapper keeps this dialog mounted for
  // that — and starts blank again only once a place is created (the key bump).
  const [draft, setDraft] = useState(0);
  // The kind a draft opens on, fixed when the draft starts: read from the
  // prop instead, a later opening that names no kind would move an untouched
  // kind to blank through the form's late-value rebase (#1147).
  const draftStartKind = useRef<number | ''>(defaultKindId ?? '');
  // A select's refusal is read out with it, as a text field's helper text is.
  const kindErrorId = useId();
  const typeErrorId = useId();
  const form = useEditForm<NewPlace>({
    initial: {
      name: '', description: '', type: '', kindId: draftStartKind.current, coords: null,
      imageUrl: '', wikipediaUrl: '', websiteUrl: '',
    },
    resetKey: draft,
    required: REQUIRED_FIELDS,
    paths: COORDS_PATHS,
  });
  const { name, kindId, coords, imageUrl, wikipediaUrl } = form.values;
  const typeOptions = typeOptionsFor(kindId === '' ? null : kindId);
  const [wikidataId, setWikidataId] = useState<string | null>(null);

  // An opening picks the tab it was opened for, and takes the kind it was
  // opened for only when it names one other than the draft's own: a kept draft
  // reopened from its kind's "+", or from a button that names no kind, keeps
  // the kind and type the curator chose (#1147). A type belongs to a kind, so a
  // new kind clears it — a select holding a value outside its items renders
  // blank.
  useOnOpening(open ? `${defaultTab ?? 0}:${defaultKindId ?? ''}` : null, () => {
    setActiveTab(defaultTab ?? 0);
    if (defaultKindId === undefined || defaultKindId === form.values.kindId) return;
    form.set('kindId', defaultKindId);
    form.set('type', '');
  });

  // --- Auto-fill tracking ---
  // Refs track whether each field was set by auto-fill (true) or manually (false).
  // Auto-fill overwrites fields that are empty OR were previously auto-filled.
  const coordsAutoFilled = useRef(false);
  // The item id a lookup took from Nominatim, as against one the curator chose
  // in the location search: only the curator's outlives the next lookup.
  const wikidataAutoFilled = useRef(false);
  const imageAutoFilled = useRef(false);
  const descAutoFilled = useRef(false);
  const linkAutoFilled = useRef(false);
  const autoFillGen = useRef(0); // Generation counter for race conditions
  const autoFillDone = useRef(false); // A lookup has run: the next one overwrites what it filled

  // Refs for reading current values inside async effects without stale closures
  const stateRef = useRef({ values: form.values, wikidataId, regionName });
  stateRef.current = { values: form.values, wikidataId, regionName };

  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillInfo, setAutoFillInfo] = useState<string | null>(null);
  const [autoFillEntity, setAutoFillEntity] = useState<ItemRef | null>(null);
  // The item the last lookup's name search matched and refused as another
  // place (`namesakeOf`), named beside the place found.
  const [namesake, setNamesake] = useState<ItemRef | null>(null);
  // The last lookup found no location for the name: neither the item nor
  // Nominatim gave one, and the curator had placed no pin.
  const [locationMissed, setLocationMissed] = useState(false);

  // Apply a Wikidata image suggestion, from the auto-fill and the Suggest button
  // alike: the picture unless told to keep the curator's own, the description
  // and Wikipedia URL when the field is empty or was filled by an earlier
  // suggestion — so a re-lookup never leaves a stale auto-filled description
  // behind, and a curator's own text stays. The item applied is the match from
  // then on, in place of any namesake the last lookup named.
  const applySuggestion = (suggestion: ImageSuggestion, keepPicture = false): void => {
    const current = stateRef.current.values;
    if (!keepPicture) {
      form.set('imageUrl', suggestion.imageUrl);
      imageAutoFilled.current = true;
    }
    setAutoFillEntity({ label: suggestion.entityLabel, wikidataId: suggestion.wikidataId });
    setNamesake(null);
    if (suggestion.description && (!current.description || descAutoFilled.current)) {
      form.set('description', suggestion.description);
      descAutoFilled.current = true;
    }
    if (suggestion.wikipediaUrl && (!current.wikipediaUrl || linkAutoFilled.current)) {
      form.set('wikipediaUrl', suggestion.wikipediaUrl);
      linkAutoFilled.current = true;
    }
  };

  // What an earlier lookup filled in and this one has no item for — a namesake
  // refused, or no item at all — is taken back, so *Look up again* never leaves
  // another place's picture, description or link under the place it found. The
  // curator's own stay.
  const clearAutoFill = (): void => {
    if (imageAutoFilled.current) {
      form.set('imageUrl', '');
      imageAutoFilled.current = false;
    }
    if (descAutoFilled.current) {
      form.set('description', '');
      descAutoFilled.current = false;
    }
    if (linkAutoFilled.current) {
      form.set('wikipediaUrl', '');
      linkAutoFilled.current = false;
    }
  };

  // --- Suggest mutation (for manual Suggest button) ---
  // A Suggest answered after a lookup started is about the draft as it was
  // before that lookup, which owns the fields now: its answer is dropped, or a
  // namesake the lookup refused comes back through it.
  const suggestMutation = useMutation({
    mutationFn: ({ generation: _generation, ...params }: {
      name?: string; lat?: number; lng?: number; wikidataId?: string; generation: number;
    }) => suggestImageUrl(params),
    onSuccess: (suggestion, { generation }) => {
      if (generation === autoFillGen.current) applySuggestion(suggestion);
    },
  });

  // --- Core lookup logic, run by Look up ---
  // Reads from stateRef to always have current values regardless of closures.

  // A pin the curator placed, never one an earlier lookup placed: a lookup
  // moves only what a lookup wrote. Read again after every wait, since the
  // curator can drop a pin while a lookup runs.
  const pinnedCoords = (): { lat: number; lng: number } | null =>
    (coordsAutoFilled.current ? null : stateRef.current.values.coords);

  // The item the name search matched when Nominatim found a place and the
  // item is not the one it links to: a namesake elsewhere ("Old Town Hall" —
  // Hanover's, for Brno's), since that layer reads the bare name with no
  // region and no point. It fills nothing — picture, description, link or
  // location — and is named beside the place for the curator to judge. Where
  // Nominatim found nothing, the name is all there is to go on, and the item
  // the name search matched is taken as the place.
  const namesakeOf = (place: PlaceResult | undefined, suggestion: ImageSuggestion): boolean =>
    !!place && suggestion.source === 'wikidata_search' && suggestion.wikidataId !== place.wikidataId;

  // The location a lookup fills in, from the item it applied (never a
  // namesake). The item's own coordinate (P625) where the item is the place:
  // Nominatim found none, or found the place and the item is the one it
  // links to — then the coordinate is a statement about it, where Nominatim's
  // point is a search's best guess. Otherwise the place's point wins: an item
  // found by its distance to the point (a neighbour within two kilometres) is
  // another place, shown as the match for the curator to judge but never
  // moving the pin.
  const lookupLocation = (
    place: PlaceResult | undefined, item: ImageSuggestion | null,
  ): { lat: number; lng: number } | null => {
    if (item?.coordinates && item.source !== 'wikidata_spatial') return item.coordinates;
    return place ? { lat: place.lat, lng: place.lng } : null;
  };

  // A picture the curator set themselves, which a lookup leaves alone.
  const imageIsCurators = () => !!stateRef.current.values.imageUrl && !imageAutoFilled.current;

  // The item id a lookup asks about, written to the form's state: the place
  // Nominatim found is the identity. Without one, the item the curator chose
  // in the location search still is, but the one an earlier lookup took for
  // another name is dropped — the Suggest button reads the same state.
  const takeItemId = (place: PlaceResult | undefined): string | undefined => {
    if (place) {
      setWikidataId(place.wikidataId ?? null);
      wikidataAutoFilled.current = true;
      return place.wikidataId ?? undefined;
    }
    if (!wikidataAutoFilled.current) return stateRef.current.wikidataId ?? undefined;
    setWikidataId(null);
    wikidataAutoFilled.current = false;
    return undefined;
  };

  // The Wikidata item for a looked-up name, or null when none has a picture.
  const suggestFor = async (
    lookupName: string, place: PlaceResult | undefined, itemId: string | undefined,
  ): Promise<ImageSuggestion | null> => {
    const point = pinnedCoords() ?? place;
    try {
      return await suggestImageUrl({ name: lookupName, lat: point?.lat, lng: point?.lng, wikidataId: itemId });
    } catch {
      return null; // 404 or error — no image found, that's OK.
    }
  };

  const performLookup = async () => {
    const lookupName = stateRef.current.values.name;
    if (lookupName.length < 3) return;

    const generation = ++autoFillGen.current;
    suggestMutation.reset();
    setAutoFillLoading(true);
    setAutoFillInfo(null);
    setAutoFillEntity(null);
    setNamesake(null);
    setLocationMissed(false);

    try {
      // Step 1: the place, from Nominatim. It names the Wikidata item
      // OpenStreetMap links it to, which the suggestion below reads directly.
      const place = await findPlace(lookupName, stateRef.current.regionName, () => autoFillGen.current === generation);
      if (autoFillGen.current !== generation) return;
      const itemId = takeItemId(place);
      if (place) setAutoFillInfo(place.display_name.split(',').slice(0, 3).join(',').trim());

      // Step 2: the item — its match, description and coordinate always, its
      // picture only where the curator has not set their own, before the
      // lookup or while it ran; a namesake's none of them.
      const suggestion = await suggestFor(lookupName, place, itemId);
      if (autoFillGen.current !== generation) return;
      const elsewhere = suggestion && namesakeOf(place, suggestion) ? suggestion : null;
      const item = elsewhere ? null : suggestion;
      if (item) {
        applySuggestion(item, imageIsCurators());
        suggestMutation.reset();
      } else {
        clearAutoFill();
        suggestMutation.reset();
      }
      if (elsewhere) setNamesake({ label: elsewhere.entityLabel, wikidataId: elsewhere.wikidataId });

      // Step 3: the location, unless the curator placed their own pin — before
      // the lookup or while it ran.
      if (!pinnedCoords()) {
        const found = lookupLocation(place, item);
        form.set('coords', found);
        coordsAutoFilled.current = found !== null;
        setLocationMissed(found === null);
      }

      autoFillDone.current = true;
    } finally {
      if (autoFillGen.current === generation) {
        setAutoFillLoading(false);
      }
    }
  };

  // --- A changed name drops a lookup still running; a cleared one forgets the last ---
  useEffect(() => {
    // The answer on its way is about the name it was asked for, not this one.
    autoFillGen.current++;
    setAutoFillLoading(false);
    // A Suggest on its way is about the old name too, and its answer is dropped
    // (`onSuccess`): its state goes with it, or the image field would say
    // *Found via* over a picture nobody filled.
    if (suggestMutation.isPending) suggestMutation.reset();
    if (name.length >= 3) return;
    setAutoFillInfo(null);
    setAutoFillEntity(null);
    setNamesake(null);
    setLocationMissed(false);
    autoFillDone.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a changed name is the event; the Suggest state is read as that change finds it
  }, [name]);

  // --- Look up, on the button or Enter: never as the curator types ---
  const canLookUp = name.trim().length >= 3 && !autoFillLoading;
  const handleLookup = () => {
    if (name.trim().length < 3 || autoFillLoading) return;
    // Asked again, a lookup replaces only what an earlier one filled in: the
    // *AutoFilled refs say which fields those are, and a field the curator set
    // since — a pin moved, a picture pasted — stays theirs.
    void performLookup();
  };

  // --- Manual change handlers (mark fields as manually set) ---
  const handleCoordsChange = (c: { lat: number; lng: number } | null) => {
    form.set('coords', c);
    coordsAutoFilled.current = false;
  };

  // --- Create mutation ---
  const createMutation = useMutation({
    mutationFn: createManualExperience,
    onSuccess: () => invalidateExperiences(queryClient, { regionId }),
  });

  // A close keeps the draft whole — its values, and which of them auto-fill
  // wrote — so a reopened draft behaves as it did before the close (#1147): a
  // value filled for the old name still moves with a new one. Only a lookup in
  // flight is dropped, since it answers a question nobody is waiting on.
  const handleClose = () => {
    setSearchQuery('');
    setActiveTab(0);
    autoFillGen.current++;
    // The dropped lookup never reaches its own `finally`, so its spinner ends here.
    setAutoFillLoading(false);
    suggestMutation.reset();
    // The dialog stays mounted after a close (`LazyAddExperienceDialog`), so
    // an outcome line would otherwise greet the next opening.
    createMutation.reset();
    assignMutation.reset();
    onClose();
  };

  // The form sends the optional fields that were filled in; the ones the body
  // requires come from the values, which `form.missing` holds non-blank before
  // the button is enabled — the check below only narrows their types.
  const handleCreate = async () => {
    if (kindId === '' || coords === null) return;
    const created = await form.submit(filled => createMutation.mutateAsync({
      ...filled,
      name: name.trim(),
      kindId,
      latitude: coords.lat,
      longitude: coords.lng,
      regionId,
    }), OPTIONAL_FIELDS);
    if (!created) return;
    // A new draft: blank values, no kind — the next opening's "+" names its
    // own, and a button that names none leaves it for the curator to pick — and
    // no auto-fill of its own yet.
    draftStartKind.current = '';
    setDraft(d => d + 1);
    setWikidataId(null);
    setAutoFillInfo(null);
    setAutoFillEntity(null);
    setNamesake(null);
    setLocationMissed(false);
    coordsAutoFilled.current = false;
    wikidataAutoFilled.current = false;
    imageAutoFilled.current = false;
    descAutoFilled.current = false;
    linkAutoFilled.current = false;
    autoFillDone.current = false;
    handleClose();
  };

  // Said until the curator sets a location: the pin they place answers it.
  const showLocationMissed = locationMissed && coords === null;

  // Helper text for image field
  const imageHelperText = pickImageHelperText({
    isError: suggestMutation.isError,
    isSuccess: suggestMutation.isSuccess,
    successEntityLabel: suggestMutation.data?.entityLabel,
    imageAutoFilled: imageAutoFilled.current,
    hasNewImageUrl: !!imageUrl,
    autoFillEntityLabel: autoFillEntity?.label,
  });

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>Add Experience to Region</DialogTitle>
      <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ px: 3 }}>
        <Tab label="Create New" />
        <Tab label="Search & Add" />
      </Tabs>
      <DialogContent>
        {/* Create New Tab */}
        {activeTab === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box>
              <TextField
                label="Name"
                {...form.field('name', { helperText: nameHelperText(autoFillLoading, name) })}
                required
                fullWidth
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
                slotProps={{
                  input: {
                    endAdornment: (
                      <LookUpButton
                        loading={autoFillLoading} looked={autoFillDone.current} disabled={!canLookUp} onClick={handleLookup}
                      />
                    ),
                  },
                }}
              />
              {!autoFillLoading && (
                <LookupOutcome
                  entity={autoFillEntity} namesake={namesake} found={autoFillInfo} locationMissed={showLocationMissed}
                />
              )}
            </Box>

            <TextField
              label="Description"
              {...form.field('description')}
              onChange={(e) => { form.set('description', e.target.value); descAutoFilled.current = false; }}
              fullWidth
              multiline
              rows={2}
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl fullWidth size="small" required error={!!form.errors.kindId}>
                <InputLabel>Kind</InputLabel>
                <Select
                  value={kindId}
                  label="Kind"
                  SelectDisplayProps={describedBy(form.errors.kindId, kindErrorId)}
                  onChange={(e) => { form.set('kindId', e.target.value as number | ''); form.set('type', ''); }}
                >
                  {kinds?.map((s) => (
                    <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                  ))}
                </Select>
                {form.errors.kindId && <FormHelperText id={kindErrorId}>{form.errors.kindId}</FormHelperText>}
              </FormControl>

              {/* The chosen kind's own types, or no control for a kind without any
                  — a museum (ADR-0045, #814). */}
              {typeOptions.length > 0 && (
                <FormControl fullWidth size="small" error={!!form.errors.type}>
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={form.values.type}
                    label="Type"
                    SelectDisplayProps={describedBy(form.errors.type, typeErrorId)}
                    onChange={(e) => form.set('type', e.target.value)}
                  >
                    <MenuItem value="">None</MenuItem>
                    {typeOptions.map(option => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </Select>
                  {form.errors.type && <FormHelperText id={typeErrorId}>{form.errors.type}</FormHelperText>}
                </FormControl>
              )}
            </Box>

            <Box>
              <LocationPicker
                value={coords}
                onChange={handleCoordsChange}
                name={name}
                onPlaceSelect={(place) => {
                  setWikidataId(place.wikidataId ?? null);
                  wikidataAutoFilled.current = false;
                  coordsAutoFilled.current = false;
                }}
              />
              {form.errors.coords && <FormHelperText error>{form.errors.coords}</FormHelperText>}
            </Box>

            <Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Image URL (optional)"
                  {...form.field('imageUrl', { helperText: imageHelperText })}
                  onChange={(e) => { form.set('imageUrl', e.target.value); imageAutoFilled.current = false; suggestMutation.reset(); }}
                  fullWidth
                  size="small"
                  placeholder="https://commons.wikimedia.org/..."
                  error={!!form.errors.imageUrl || suggestMutation.isError}
                  color={suggestMutation.isSuccess || (imageAutoFilled.current && imageUrl) ? 'success' : undefined}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => suggestMutation.mutate({
                    name: name || undefined,
                    lat: coords?.lat,
                    lng: coords?.lng,
                    wikidataId: wikidataId ?? undefined,
                    generation: autoFillGen.current,
                  })}
                  disabled={suggestMutation.isPending || (!name && !coords)}
                  sx={{ minWidth: 90, mt: 0.25 }}
                >
                  {suggestMutation.isPending ? <CircularProgress size={16} /> : 'Suggest'}
                </Button>
              </Box>
              {/* No credit under this one, and that is the shape of the data rather
                  than an omission: the object does not exist yet, so there is no
                  stored `metadata.imageCredit` to draw. `POST /experiences` resolves
                  the credit for whatever URL is saved, so the picture is named from
                  the moment anybody but its author can see it. */}
              {imageUrl && <PictureWithCredit url={imageUrl} alt="Picture preview" />}
            </Box>

            <TextField
              label="Wikipedia URL (optional)"
              {...form.field('wikipediaUrl', {
                helperText: linkAutoFilled.current && wikipediaUrl ? 'Auto-suggested from Wikidata' : undefined,
              })}
              onChange={(e) => { form.set('wikipediaUrl', e.target.value); linkAutoFilled.current = false; }}
              fullWidth
              size="small"
              placeholder="https://en.wikipedia.org/wiki/..."
              color={linkAutoFilled.current && wikipediaUrl ? 'success' : undefined}
            />
            <TextField
              label="Website URL (optional)"
              {...form.field('websiteUrl', { helperText: 'The place’s own website (a UNESCO site’s World Heritage page is kept apart)' })}
              fullWidth
              size="small"
              placeholder="https://..."
            />

            {form.formError && <Alert severity="error">{form.formError}</Alert>}

            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={form.missing || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Experience'}
            </Button>
          </Box>
        )}

        {/* Search & Add Tab */}
        {activeTab === 1 && (
          <Box>
            <TextField
              placeholder="Search experiences by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              fullWidth
              autoFocus
              size="small"
              sx={{ mb: 2, mt: 1 }}
              slotProps={{
                input: {
                  startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                },
              }}
            />

            {isFetching && (
              <LoadingSpinner size={24} padding="8px 0" />
            )}

            {searchResults && !isFetching && searchResults.results.length === 0 && searchQuery.length >= 2 && (
              <EmptyState message="No experiences found." padding="8px 0" />
            )}

            {searchResults && searchResults.results.length > 0 && (
              <List dense disablePadding sx={{ maxHeight: 400, overflowY: 'auto' }}>
                {searchResults.results.map((exp) => {
                  // The normalised URL decides whether there is a picture, not the stored
                  // one: `toThumbnailUrl` answers with an empty string for a host we do
                  // not trust, and `src=""` is not "no image" — the browser resolves it
                  // against the page and draws a broken thumbnail. The rule
                  // `ObjectContext` states, applied to the row that shows the same
                  // objects — and it is what keeps a credit off a picture nobody sees.
                  const thumbnail = extractImageUrl(exp.image_url);
                  const imageUrl = thumbnail ? toThumbnailUrl(thumbnail, 120) : '';
                  return (
                    <ListItem
                      key={exp.id}
                      sx={{
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:hover': { bgcolor: 'action.hover' },
                        gap: 1.5,
                      }}
                      secondaryAction={
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => assignMutation.mutate(exp.id)}
                          disabled={assignMutation.isPending}
                        >
                          Add
                        </Button>
                      }
                    >
                      <SearchResultBody exp={exp} imageUrl={imageUrl} />
                    </ListItem>
                  );
                })}
              </List>
            )}

            {assignMutation.isSuccess && (
              <Alert severity="success" sx={{ mt: 1 }}>
                Experience added to region.
              </Alert>
            )}
            {assignMutation.isError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {(assignMutation.error as Error).message}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Memoised for the reason given on `CurationDialog`: mounted while closed. */
export const AddExperienceDialog = memo(AddExperienceDialogComponent);
