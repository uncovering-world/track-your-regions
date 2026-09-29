/**
 * AddExperienceDialog — Shared dialog for adding experiences to a region.
 *
 * Two tabs:
 *   1. Create New — create a new manual experience with auto-fill from Wikidata
 *   2. Search & Add — search existing experiences by name, assign to region
 *
 * Auto-fill: when the curator types a name (3+ chars, debounced), the system
 * automatically looks up coordinates (Nominatim), image, and description
 * (Wikidata) — but only ONCE. After the first successful lookup, the name
 * can be freely edited without re-triggering. A "Re-lookup" link lets the
 * curator explicitly re-search when needed (e.g. typed the wrong name).
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
  shortDescription: string;
  type: string;
  kindId: number | '';
  coords: { lat: number; lng: number } | null;
  imageUrl: string;
  wikipediaUrl: string;
  websiteUrl: string;
};

/** The fields a create sends only when filled in; the rest the body requires. */
const OPTIONAL_FIELDS = ['shortDescription', 'type', 'imageUrl', 'wikipediaUrl', 'websiteUrl'] as const;
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

function nameHelperText(loading: boolean, name: string): string | undefined {
  if (loading) return ' '; // Reserve space so layout doesn't jump
  if (name.length >= 1 && name.length < 3) return 'Type 3+ characters to auto-fill';
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
  /** Region name — appended to Nominatim queries for better geo-disambiguation */
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
  // A select's refusal is read out with it, as a text field's helper text is.
  const kindErrorId = useId();
  const typeErrorId = useId();
  const form = useEditForm<NewPlace>({
    initial: {
      name: '', shortDescription: '', type: '', kindId: defaultKindId ?? '', coords: null,
      imageUrl: '', wikipediaUrl: '', websiteUrl: '',
    },
    resetKey: draft,
    required: REQUIRED_FIELDS,
    paths: COORDS_PATHS,
  });
  const { name, kindId, coords, imageUrl, wikipediaUrl } = form.values;
  const typeOptions = typeOptionsFor(kindId === '' ? null : kindId);
  const [wikidataId, setWikidataId] = useState<string | null>(null);

  // An opening, or new defaults while open, picks the tab and kind it was opened
  // for. A type belongs to a kind: a value picked for the last kind is not one of
  // this kind's, and a select holding a value outside its items renders blank.
  useOnOpening(open ? `${defaultTab ?? 0}:${defaultKindId ?? ''}` : null, () => {
    setActiveTab(defaultTab ?? 0);
    form.set('kindId', defaultKindId ?? '');
    form.set('type', '');
  });

  // --- Auto-fill tracking ---
  // Refs track whether each field was set by auto-fill (true) or manually (false).
  // Auto-fill overwrites fields that are empty OR were previously auto-filled.
  const coordsAutoFilled = useRef(false);
  const imageAutoFilled = useRef(false);
  const descAutoFilled = useRef(false);
  const linkAutoFilled = useRef(false);
  const autoFillGen = useRef(0); // Generation counter for race conditions
  const autoFillDone = useRef(false); // Lock: once true, name edits don't re-trigger

  // Refs for reading current values inside async effects without stale closures
  const stateRef = useRef({ values: form.values, wikidataId, regionName });
  stateRef.current = { values: form.values, wikidataId, regionName };

  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillInfo, setAutoFillInfo] = useState<string | null>(null);
  const [autoFillEntity, setAutoFillEntity] = useState<{ label: string; wikidataId: string } | null>(null);

  // Apply a Wikidata image suggestion, from the auto-fill and the Suggest button
  // alike: the picture always, the description and Wikipedia URL when the field
  // is empty or was filled by an earlier suggestion — so a re-lookup never leaves
  // a stale auto-filled description behind, and a curator's own text stays.
  const applySuggestion = (suggestion: ImageSuggestion): void => {
    const current = stateRef.current.values;
    form.set('imageUrl', suggestion.imageUrl);
    imageAutoFilled.current = true;
    setAutoFillEntity({ label: suggestion.entityLabel, wikidataId: suggestion.wikidataId });
    if (suggestion.description && (!current.shortDescription || descAutoFilled.current)) {
      form.set('shortDescription', suggestion.description);
      descAutoFilled.current = true;
    }
    if (suggestion.wikipediaUrl && (!current.wikipediaUrl || linkAutoFilled.current)) {
      form.set('wikipediaUrl', suggestion.wikipediaUrl);
      linkAutoFilled.current = true;
    }
  };

  // --- Suggest mutation (for manual Suggest button) ---
  const suggestMutation = useMutation({
    mutationFn: (params: { name?: string; lat?: number; lng?: number; wikidataId?: string }) =>
      suggestImageUrl(params),
    onSuccess: applySuggestion,
  });

  // --- Core lookup logic (used by both auto-fill and Re-lookup) ---
  // Reads from stateRef to always have current values regardless of closures.

  // Apply Nominatim geocode result to local state. Returns the *effective*
  // coords/QID that the form is now using — so the downstream image-
  // suggestion lookup uses the same identity (manually-pinned coords
  // override geocoded ones, and we explicitly null out the wikidataId
  // when the new place has none, instead of letting the caller fall back
  // to a stale previous QID).
  const applyNominatimPlace = (place: PlaceResult): { lat: number; lng: number; wikidataId?: string } => {
    const pinned = coordsAutoFilled.current ? null : stateRef.current.values.coords;
    const effectiveCoords = pinned ?? { lat: place.lat, lng: place.lng };
    if (!pinned) {
      form.set('coords', effectiveCoords);
      coordsAutoFilled.current = true;
    }
    setWikidataId(place.wikidataId ?? null);
    setAutoFillInfo(place.display_name.split(',').slice(0, 3).join(',').trim());
    return {
      lat: effectiveCoords.lat,
      lng: effectiveCoords.lng,
      wikidataId: place.wikidataId ?? undefined,
    };
  };

  const performLookup = async () => {
    const lookupName = stateRef.current.values.name;
    if (lookupName.length < 3) return;

    const generation = ++autoFillGen.current;
    setAutoFillLoading(true);
    setAutoFillInfo(null);
    setAutoFillEntity(null);

    try {
      // Step 1: Search Nominatim for coordinates. Append region name for
      // geo-disambiguation (e.g. "Holocaust Memorial Berlin").
      const nominatimQuery = stateRef.current.regionName ? `${lookupName} ${stateRef.current.regionName}` : lookupName;
      const places = await searchPlaces(nominatimQuery, 1);
      if (autoFillGen.current !== generation) return;
      const effective = places.length > 0 ? applyNominatimPlace(places[0]) : null;

      // Step 2: Suggest image + description (only if user hasn't set image manually).
      if (!stateRef.current.values.imageUrl || imageAutoFilled.current) {
        try {
          // When Nominatim returned a place, trust its identity (already
          // reconciled with the form's manual pins inside applyNominatimPlace).
          // Only fall back to stateRef when Nominatim returned nothing at all,
          // so a previous lookup's QID can't bleed into the new suggestion.
          const suggestion = await suggestImageUrl({
            name: lookupName,
            lat: effective?.lat ?? stateRef.current.values.coords?.lat,
            lng: effective?.lng ?? stateRef.current.values.coords?.lng,
            wikidataId: effective ? effective.wikidataId : stateRef.current.wikidataId ?? undefined,
          });
          if (autoFillGen.current !== generation) return;
          applySuggestion(suggestion);
          suggestMutation.reset();
        } catch {
          // 404 or error — no image found, that's OK.
        }
      }

      autoFillDone.current = true;
    } catch {
      // Nominatim search failed, ignore.
    } finally {
      if (autoFillGen.current === generation) {
        setAutoFillLoading(false);
      }
    }
  };

  // Keep performLookup accessible via ref for the Re-lookup button
  const performLookupRef = useRef(performLookup);
  performLookupRef.current = performLookup;

  // --- Auto-fill effect: fires once, then locks ---
  useEffect(() => {
    if (name.length < 3) {
      setAutoFillInfo(null);
      setAutoFillEntity(null);
      autoFillDone.current = false; // Reset lock when name is cleared
      return;
    }

    // Skip if auto-fill already ran — curator can use "Re-lookup" to re-trigger
    if (autoFillDone.current) return;

    const timer = setTimeout(() => performLookupRef.current(), 800);
    return () => clearTimeout(timer);
  }, [name]);

  // --- Explicit re-lookup (for when curator changed the name after initial auto-fill) ---
  const handleRelookup = () => {
    autoFillDone.current = false;
    // Allow auto-fill to overwrite all fields since curator explicitly requested
    coordsAutoFilled.current = true;
    imageAutoFilled.current = true;
    descAutoFilled.current = true;
    linkAutoFilled.current = true;
    performLookupRef.current();
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

  const handleClose = () => {
    setSearchQuery('');
    setActiveTab(0);
    setWikidataId(null);
    setAutoFillInfo(null);
    setAutoFillEntity(null);
    coordsAutoFilled.current = false;
    imageAutoFilled.current = false;
    descAutoFilled.current = false;
    autoFillDone.current = false;
    autoFillGen.current++;
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
    setDraft(d => d + 1);
    linkAutoFilled.current = false;
    handleClose();
  };

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
                slotProps={{
                  input: {
                    endAdornment: autoFillLoading ? <CircularProgress size={16} /> : null,
                  },
                }}
              />
              {/* Suggestion result info box */}
              {(autoFillInfo || autoFillEntity) && !autoFillLoading && (
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
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                    {autoFillEntity
                      ? <>Matched: <strong>{autoFillEntity.label}</strong> ({autoFillEntity.wikidataId})</>
                      : <>Found: {autoFillInfo}</>
                    }
                  </Typography>
                  <Typography
                    variant="caption"
                    component="span"
                    role="button"
                    tabIndex={0}
                    onClick={handleRelookup}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRelookup(); }}
                    sx={{
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      color: 'primary.main',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    Re-lookup
                  </Typography>
                </Box>
              )}
            </Box>

            <TextField
              label="Short Description"
              {...form.field('shortDescription')}
              onChange={(e) => { form.set('shortDescription', e.target.value); descAutoFilled.current = false; }}
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
              {...form.field('websiteUrl', { helperText: 'Official site (UNESCO page, museum site, etc.)' })}
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
