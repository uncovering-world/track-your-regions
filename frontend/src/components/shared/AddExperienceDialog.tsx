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

import { useState, useRef, useEffect } from 'react';
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
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  searchExperiences,
  assignExperienceToRegion,
  createManualExperience,
  fetchExperienceCategories,
} from '../../api/experiences';
import { searchPlaces, suggestImageUrl } from '../../api/geocode';
import { extractImageUrl, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { LocationPicker } from './LocationPicker';

interface AddExperienceDialogProps {
  open: boolean;
  onClose: () => void;
  regionId: number;
  /** Region name — appended to Nominatim queries for better geo-disambiguation */
  regionName?: string;
  /** Pre-select this source when opening Create New tab */
  defaultCategoryId?: number;
  /** Open directly on a specific tab: 0 = Create New, 1 = Search & Add */
  defaultTab?: 0 | 1;
}

export function AddExperienceDialog({ open, onClose, regionId, regionName, defaultCategoryId, defaultTab }: AddExperienceDialogProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(defaultTab ?? 0);
  const [searchQuery, setSearchQuery] = useState('');

  // --- Search & Assign tab ---
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['experiences', 'search', searchQuery],
    queryFn: () => searchExperiences(searchQuery, 20),
    enabled: searchQuery.length >= 2,
  });

  const assignMutation = useMutation({
    mutationFn: (experienceId: number) => assignExperienceToRegion(experienceId, regionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', regionId] });
      queryClient.invalidateQueries({ queryKey: ['discover-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });
      queryClient.invalidateQueries({ queryKey: ['experiences'] });
    },
  });

  // --- Categories for Create New tab ---
  const { data: categories } = useQuery({
    queryKey: ['experience-categories'],
    queryFn: fetchExperienceCategories,
  });

  // Sync tab and category when dialog opens with different defaults
  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab ?? 0);
      setNewCategoryId(defaultCategoryId ?? '');
    }
  }, [open, defaultTab, defaultCategoryId]);

  // --- Create New tab state ---
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryId, setNewCategoryId] = useState<number | ''>(defaultCategoryId ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newWikipediaUrl, setNewWikipediaUrl] = useState('');
  const [newWebsiteUrl, setNewWebsiteUrl] = useState('');
  const [wikidataId, setWikidataId] = useState<string | null>(null);

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
  const stateRef = useRef({ coords, newImageUrl, newDescription, newWikipediaUrl, wikidataId, newName, regionName });
  stateRef.current = { coords, newImageUrl, newDescription, newWikipediaUrl, wikidataId, newName, regionName };

  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillInfo, setAutoFillInfo] = useState<string | null>(null);
  const [autoFillEntity, setAutoFillEntity] = useState<{ label: string; wikidataId: string } | null>(null);

  // --- Suggest mutation (for manual Suggest button) ---
  const suggestMutation = useMutation({
    mutationFn: (params: { name?: string; lat?: number; lng?: number; wikidataId?: string }) =>
      suggestImageUrl(params),
    onSuccess: (data) => {
      setNewImageUrl(data.imageUrl);
      imageAutoFilled.current = true;
      setAutoFillEntity({ label: data.entityLabel, wikidataId: data.wikidataId });
      if (data.description && !stateRef.current.newDescription) {
        setNewDescription(data.description);
        descAutoFilled.current = true;
      }
      if (data.wikipediaUrl && (!stateRef.current.newWikipediaUrl || linkAutoFilled.current)) {
        setNewWikipediaUrl(data.wikipediaUrl);
        linkAutoFilled.current = true;
      }
    },
  });

  // --- Core lookup logic (used by both auto-fill and Re-lookup) ---
  // Reads from stateRef to always have current values regardless of closures.
  const performLookup = async () => {
    const name = stateRef.current.newName;
    if (name.length < 3) return;

    const generation = ++autoFillGen.current;
    setAutoFillLoading(true);
    setAutoFillInfo(null);
    setAutoFillEntity(null);

    try {
      // Step 1: Search Nominatim for coordinates
      // Append region name for geo-disambiguation (e.g. "Holocaust Memorial Berlin")
      const nominatimQuery = stateRef.current.regionName ? `${name} ${stateRef.current.regionName}` : name;
      const places = await searchPlaces(nominatimQuery, 1);
      if (autoFillGen.current !== generation) return;

      let effectiveLat: number | undefined;
      let effectiveLng: number | undefined;
      let effectiveWikidataId: string | undefined;

      if (places.length > 0) {
        const place = places[0];
        effectiveLat = place.lat;
        effectiveLng = place.lng;
        effectiveWikidataId = place.wikidataId ?? undefined;

        // Auto-fill coords if empty or previously auto-filled
        if (!stateRef.current.coords || coordsAutoFilled.current) {
          setCoords({ lat: place.lat, lng: place.lng });
          coordsAutoFilled.current = true;
        }

        if (place.wikidataId) {
          setWikidataId(place.wikidataId);
        }

        setAutoFillInfo(place.display_name.split(',').slice(0, 3).join(',').trim());
      }

      // Step 2: Suggest image + description
      if (!stateRef.current.newImageUrl || imageAutoFilled.current) {
        try {
          const suggestion = await suggestImageUrl({
            name,
            lat: effectiveLat ?? stateRef.current.coords?.lat,
            lng: effectiveLng ?? stateRef.current.coords?.lng,
            wikidataId: effectiveWikidataId ?? stateRef.current.wikidataId ?? undefined,
          });
          if (autoFillGen.current !== generation) return;

          setNewImageUrl(suggestion.imageUrl);
          imageAutoFilled.current = true;
          setAutoFillEntity({ label: suggestion.entityLabel, wikidataId: suggestion.wikidataId });
          suggestMutation.reset();

          // Auto-fill description if empty or previously auto-filled
          if (suggestion.description && (!stateRef.current.newDescription || descAutoFilled.current)) {
            setNewDescription(suggestion.description);
            descAutoFilled.current = true;
          }

          // Auto-fill Wikipedia URL if empty or previously auto-filled
          if (suggestion.wikipediaUrl && (!stateRef.current.newWikipediaUrl || linkAutoFilled.current)) {
            setNewWikipediaUrl(suggestion.wikipediaUrl);
            linkAutoFilled.current = true;
          }
        } catch {
          // 404 or error — no image found, that's OK
        }
      }

      autoFillDone.current = true;
    } catch {
      // Nominatim search failed, ignore
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
    if (newName.length < 3) {
      setAutoFillInfo(null);
      setAutoFillEntity(null);
      autoFillDone.current = false; // Reset lock when name is cleared
      return;
    }

    // Skip if auto-fill already ran — curator can use "Re-lookup" to re-trigger
    if (autoFillDone.current) return;

    const timer = setTimeout(() => performLookupRef.current(), 800);
    return () => clearTimeout(timer);
  }, [newName]);

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
    setCoords(c);
    coordsAutoFilled.current = false;
  };

  const handleDescriptionChange = (desc: string) => {
    setNewDescription(desc);
    descAutoFilled.current = false;
  };

  const handleImageUrlChange = (url: string) => {
    setNewImageUrl(url);
    imageAutoFilled.current = false;
    suggestMutation.reset();
  };

  // --- Create mutation ---
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createManualExperience>[0]) => createManualExperience(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', regionId] });
      queryClient.invalidateQueries({ queryKey: ['discover-experiences'] });
      queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });
      queryClient.invalidateQueries({ queryKey: ['experiences'] });
      // Reset form state
      setNewName('');
      setNewDescription('');
      setNewCategory('');
      setNewCategoryId('');
      setCoords(null);
      setNewImageUrl('');
      setNewWikipediaUrl('');
      setNewWebsiteUrl('');
      setWikidataId(null);
      setAutoFillInfo(null);
      setAutoFillEntity(null);
      coordsAutoFilled.current = false;
      imageAutoFilled.current = false;
      descAutoFilled.current = false;
      linkAutoFilled.current = false;
      autoFillDone.current = false;
      suggestMutation.reset();
      // Close the dialog — the map/list will refresh via query invalidation
      onClose();
    },
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
    onClose();
  };

  const handleCreate = () => {
    if (!newName || !coords) return;
    createMutation.mutate({
      name: newName,
      shortDescription: newDescription || undefined,
      category: newCategory || undefined,
      longitude: coords.lng,
      latitude: coords.lat,
      imageUrl: newImageUrl || undefined,
      wikipediaUrl: newWikipediaUrl || undefined,
      websiteUrl: newWebsiteUrl || undefined,
      categoryId: newCategoryId || undefined,
      regionId,
    });
  };

  const canCreate = !!newName && coords !== null && !!newCategoryId;

  // Helper text for image field
  const imageHelperText = suggestMutation.isError
    ? 'No image found on Wikidata'
    : suggestMutation.isSuccess
      ? `Found via ${suggestMutation.data.entityLabel}`
      : imageAutoFilled.current && newImageUrl
        ? `Auto-suggested${autoFillEntity ? ` from ${autoFillEntity.label}` : ' from Wikidata'}`
        : 'Wikimedia Commons URLs work best';

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
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                fullWidth
                autoFocus
                helperText={
                  autoFillLoading
                    ? ' ' // Reserve space so layout doesn't jump
                    : newName.length >= 1 && newName.length < 3
                      ? 'Type 3+ characters to auto-fill'
                      : undefined
                }
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
              value={newDescription}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl fullWidth size="small" required>
                <InputLabel>Category</InputLabel>
                <Select
                  value={newCategoryId}
                  label="Category"
                  onChange={(e) => setNewCategoryId(e.target.value as number | '')}
                >
                  {categories?.map((s) => (
                    <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Category</InputLabel>
                <Select
                  value={newCategory}
                  label="Category"
                  onChange={(e) => setNewCategory(e.target.value)}
                >
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="cultural">Cultural</MenuItem>
                  <MenuItem value="natural">Natural</MenuItem>
                  <MenuItem value="mixed">Mixed</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <LocationPicker
              value={coords}
              onChange={handleCoordsChange}
              name={newName}
              onPlaceSelect={(place) => {
                setWikidataId(place.wikidataId ?? null);
                coordsAutoFilled.current = false;
              }}
            />

            <Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Image URL (optional)"
                  value={newImageUrl}
                  onChange={(e) => handleImageUrlChange(e.target.value)}
                  fullWidth
                  size="small"
                  placeholder="https://commons.wikimedia.org/..."
                  helperText={imageHelperText}
                  error={suggestMutation.isError}
                  color={suggestMutation.isSuccess || (imageAutoFilled.current && newImageUrl) ? 'success' : undefined}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => suggestMutation.mutate({
                    name: newName || undefined,
                    lat: coords?.lat,
                    lng: coords?.lng,
                    wikidataId: wikidataId ?? undefined,
                  })}
                  disabled={suggestMutation.isPending || (!newName && !coords)}
                  sx={{ minWidth: 90, mt: 0.25 }}
                >
                  {suggestMutation.isPending ? <CircularProgress size={16} /> : 'Suggest'}
                </Button>
              </Box>
              {newImageUrl && (
                <Box
                  component="img"
                  src={toThumbnailUrl(newImageUrl, 250)}
                  alt="Preview"
                  sx={{ mt: 1, maxWidth: 200, maxHeight: 120, borderRadius: 1, objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
            </Box>

            <TextField
              label="Wikipedia URL (optional)"
              value={newWikipediaUrl}
              onChange={(e) => { setNewWikipediaUrl(e.target.value); linkAutoFilled.current = false; }}
              fullWidth
              size="small"
              placeholder="https://en.wikipedia.org/wiki/..."
              helperText={linkAutoFilled.current && newWikipediaUrl ? 'Auto-suggested from Wikidata' : undefined}
              color={linkAutoFilled.current && newWikipediaUrl ? 'success' : undefined}
            />
            <TextField
              label="Website URL (optional)"
              value={newWebsiteUrl}
              onChange={(e) => setNewWebsiteUrl(e.target.value)}
              fullWidth
              size="small"
              placeholder="https://..."
              helperText="Official site (UNESCO page, museum site, etc.)"
            />

            {createMutation.isSuccess && (
              <Alert severity="success">
                Experience created and added to region.
              </Alert>
            )}
            {createMutation.isError && (
              <Alert severity="error">
                {(createMutation.error as Error).message || 'Failed to create'}
              </Alert>
            )}

            <Button
              variant="contained"
              onClick={handleCreate}
              disabled={!canCreate || createMutation.isPending}
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
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={24} />
              </Box>
            )}

            {searchResults && !isFetching && searchResults.results.length === 0 && searchQuery.length >= 2 && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                No experiences found.
              </Typography>
            )}

            {searchResults && searchResults.results.length > 0 && (
              <List dense disablePadding sx={{ maxHeight: 400, overflowY: 'auto' }}>
                {searchResults.results.map((exp) => {
                  const imageUrl = extractImageUrl(exp.image_url);
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
                      {imageUrl && (
                        <Box
                          component="img"
                          src={toThumbnailUrl(imageUrl, 120)}
                          alt=""
                          sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <ListItemText
                        primary={exp.name}
                        secondary={[exp.category_name, exp.category, exp.country_names?.[0]].filter(Boolean).join(' \u00B7 ')}
                        primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}
                        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                      />
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
                {(assignMutation.error as Error).message || 'Failed to assign'}
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
