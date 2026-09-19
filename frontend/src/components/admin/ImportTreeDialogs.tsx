import { useState } from 'react';
import LinkIcon from '@mui/icons-material/Link';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { type searchDivisions } from '../../api/divisions';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Autocomplete, Checkbox, Link as MuiLink,
} from '@mui/material';
import type {
  RenameDialogState, ReparentDialogState, SuggestChildrenState, DivisionSearchDialogState,
  FlatRegionItem,
} from './useImportTreeDialogs';
import { type ReviewChildAction } from '../../api/admin/worldViewImport';
import { safeHref } from '../../utils/safeHref';
import { wikidataItemUrl } from '../../utils/wikidataLinks';

/** Extracted to avoid re-rendering the entire tree on every keystroke */
export function ManualFixDialog({ state, onClose, onSubmit, isPending }: {
  state: { regionId: number; regionName: string } | null;
  onClose: () => void;
  onSubmit: (regionId: number, fixNote: string | undefined) => void;
  isPending: boolean;
}) {
  const [fixNote, setFixNote] = useState('');

  // Reset note when dialog opens with a new region
  const prevRegionId = state?.regionId;
  const [lastRegionId, setLastRegionId] = useState<number | undefined>();
  if (prevRegionId !== lastRegionId) {
    setLastRegionId(prevRegionId);
    if (prevRegionId != null) setFixNote('');
  }

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mark as Needing Manual Fix</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {state?.regionName}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          label="What needs to be fixed?"
          placeholder="e.g., Borders don't match GADM, need to split into sub-regions..."
          value={fixNote}
          onChange={(e) => setFixNote(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => {
            if (state) {
              onSubmit(state.regionId, fixNote || undefined);
              onClose();
            }
          }}
          disabled={isPending}
        >
          Mark for Fix
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Confirmation dialog for removing a region from the import tree */
export function RemoveRegionDialog({ state, onClose, onConfirm, isPending }: {
  state: { regionId: number; regionName: string; hasChildren: boolean; hasDivisions: boolean } | null;
  onClose: () => void;
  onConfirm: (regionId: number, reparentChildren: boolean, reparentDivisions: boolean) => void;
  isPending: boolean;
}) {
  const hasChildren = state?.hasChildren ?? false;
  const hasDivisions = state?.hasDivisions ?? false;

  let message: string;
  if (hasChildren && hasDivisions) {
    message = 'This region has children and assigned divisions. Choose what to keep:';
  } else if (hasChildren) {
    message = 'This region has children. Choose what to do with them:';
  } else if (hasDivisions) {
    message = 'This region has assigned GADM divisions. Move them to the parent?';
  } else {
    message = 'Remove this region from the import tree?';
  }

  let actions: React.ReactNode;
  if (hasChildren) {
    actions = (
      <>
        <Button
          variant="outlined"
          color="error"
          onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
          disabled={isPending}
        >
          Remove entire branch
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => { if (state) onConfirm(state.regionId, true, hasDivisions); }}
          disabled={isPending}
        >
          Move children{hasDivisions ? ' & divisions' : ''} up
        </Button>
      </>
    );
  } else if (hasDivisions) {
    actions = (
      <>
        <Button
          variant="outlined"
          color="error"
          onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
          disabled={isPending}
        >
          Remove with divisions
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => { if (state) onConfirm(state.regionId, false, true); }}
          disabled={isPending}
        >
          Move divisions to parent
        </Button>
      </>
    );
  } else {
    actions = (
      <Button
        variant="contained"
        color="error"
        onClick={() => { if (state) onConfirm(state.regionId, false, false); }}
        disabled={isPending}
      >
        Remove
      </Button>
    );
  }

  return (
    <Dialog open={!!state} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Remove Region</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {state?.regionName}
        </Typography>
        <Typography variant="body2">{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {actions}
      </DialogActions>
    </Dialog>
  );
}

/** Simple text-field dialog for renaming a region */
export function RenameRegionDialog({ state, onClose, onSubmit, onNameChange }: {
  state: RenameDialogState | null;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (value: string) => void;
}) {
  return (
    <Dialog open={state != null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename Region</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Region name"
          value={state?.newName ?? ''}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button onClick={onSubmit} variant="contained" size="small"
          disabled={!state?.newName.trim() || state?.newName.trim() === state?.currentName}>
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Autocomplete dialog for moving a region to a new parent */
export function ReparentRegionDialog({ state, onClose, onSubmit, onParentChange, flatRegionList }: {
  state: ReparentDialogState | null;
  onClose: () => void;
  onSubmit: () => void;
  onParentChange: (parentId: number | null) => void;
  flatRegionList: FlatRegionItem[];
}) {
  return (
    <Dialog open={state != null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Move &quot;{state?.regionName}&quot;</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Select new parent region:
        </Typography>
        <Autocomplete
          size="small"
          options={flatRegionList.filter(r => r.id !== state?.regionId)}
          getOptionLabel={(opt) => '\u00A0'.repeat(opt.depth * 2) + opt.name}
          value={flatRegionList.find(r => r.id === state?.selectedParentId) ?? null}
          onChange={(_e, val) => onParentChange(val?.id ?? null)}
          renderInput={(params) => <TextField {...params} label="Parent region" placeholder="Search regions..." />}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button onClick={onSubmit} variant="contained" size="small"
          disabled={state?.selectedParentId == null}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Dialog for adding a new child region by name */
export function AddChildDialog({ parentRegionId, name, onNameChange, onClose, onSubmit, isPending }: {
  parentRegionId: number | null;
  name: string;
  onNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={parentRegionId != null} onClose={onClose}>
      <DialogTitle>Add Child Region</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Region name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && parentRegionId) {
              onSubmit();
            }
          }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={!name.trim() || isPending}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Dialog showing AI-reviewed children actions grouped by type */
export function AISuggestChildrenDialog({ state, onClose, onToggle, onSubmit, isPending }: {
  state: SuggestChildrenState | null;
  onClose: () => void;
  onToggle: (key: string) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  if (!state) return null;

  const addActions = state.result.actions.filter(a => a.type === 'add');
  const removeActions = state.result.actions.filter(a => a.type === 'remove');
  const renameActions = state.result.actions.filter(a => a.type === 'rename');
  const enrichActions = state.result.actions.filter(a => a.type === 'enrich');

  const renderEnrichment = (action: ReviewChildAction) => {
    if (action.type === 'remove' || !action.verified) return null;
    // Built on the server from a Wikivoyage title today, and held to what a
    // link may be all the same: a page the rule refuses is not offered (#703).
    const sourceHref = safeHref(action.sourceUrl);
    // The QID is the model's own answer, held by the schema to a string of at
    // most 100 characters and nothing more, so the address is built only from
    // one that is a QID — and through safeHref like the page above, since
    // `urlSafety.test.ts` reads every href in a module that carries a stored
    // link as going through it.
    const itemHref = safeHref(wikidataItemUrl(action.sourceExternalId));
    return (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {sourceHref && (
          <Typography variant="caption" color="text.secondary">
            <LinkIcon sx={{ fontSize: 12, mr: 0.25, verticalAlign: 'middle' }} />
            <MuiLink href={sourceHref} target="_blank" rel="noopener" sx={{ fontSize: 'inherit' }}>
              {decodeURIComponent(sourceHref.split('/wiki/')[1] ?? '')}
            </MuiLink>
          </Typography>
        )}
        {action.sourceExternalId && (
          // The id stays on screen whether or not it links: approving the action
          // stores it (`region_import_state.source_external_id`), so a malformed
          // answer — "unknown", a P-number — is the one the admin most needs to see.
          <Typography variant="caption" color="text.secondary">
            {itemHref
              ? (
                <MuiLink
                  href={itemHref}
                  target="_blank"
                  rel="noopener"
                  sx={{ fontSize: 'inherit' }}
                >
                  {action.sourceExternalId}
                </MuiLink>
              )
              : action.sourceExternalId}
          </Typography>
        )}
      </Box>
    );
  };

  const renderSection = (
    title: string,
    actions: ReviewChildAction[],
    color: string,
  ) => {
    if (actions.length === 0) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" color={color} sx={{ mb: 0.5 }}>
          {title} ({actions.length})
        </Typography>
        {actions.map((a) => {
          const key = `${a.type}:${a.name}`;
          return (
            <Box key={key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.5 }}>
              <Checkbox
                size="small"
                checked={state.selected.has(key)}
                onChange={() => onToggle(key)}
                sx={{ p: 0.25, mt: 0.25 }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2">
                  {a.type === 'rename' ? (
                    <>{a.name} <ArrowForwardIcon sx={{ fontSize: 14, verticalAlign: 'middle', mx: 0.5 }} /> {a.newName}</>
                  ) : (
                    a.name
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">{a.reason}</Typography>
                {renderEnrichment(a)}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Review Children for &quot;{state.regionName}&quot;</DialogTitle>
      <DialogContent>
        {state.result.analysis && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {state.result.analysis}
          </Typography>
        )}
        {state.result.actions.length === 0 && (
          <Typography variant="body2">All children look correct — no changes suggested.</Typography>
        )}
        {renderSection('Add', addActions, 'success.main')}
        {renderSection('Remove', removeActions, 'error.main')}
        {renderSection('Rename', renameActions, 'warning.main')}
        {renderSection('Enrich', enrichActions, 'info.main')}
        {state.result.stats && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            {(state.result.stats.inputTokens + state.result.stats.outputTokens).toLocaleString()} tokens
            {' \u00b7 '}${state.result.stats.cost.toFixed(4)}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!state.selected.size || isPending}
          onClick={onSubmit}
        >
          Apply {state.selected.size} Selected
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Autocomplete search dialog for manually assigning a GADM division to a region */
export function DivisionSearchDialog({ state, onClose, onSelect, query, results, loading, onInputChange }: {
  state: DivisionSearchDialogState | null;
  onClose: () => void;
  onSelect: (divisionId: number) => void;
  query: string;
  results: Awaited<ReturnType<typeof searchDivisions>>;
  loading: boolean;
  onInputChange: (_e: unknown, value: string) => void;
}) {
  return (
    <Dialog
      open={state != null}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Assign Division to &quot;{state?.regionName}&quot;</DialogTitle>
      <DialogContent>
        <Autocomplete
          size="small"
          options={results}
          getOptionLabel={(opt) => `${opt.name} (${opt.path})`}
          filterOptions={(x) => x}
          inputValue={query}
          onInputChange={onInputChange}
          loading={loading}
          onChange={(_e, val) => {
            if (val && state) {
              onSelect(val.id);
            }
          }}
          renderOption={(props, opt) => (
            <li {...props} key={opt.id}>
              <Box>
                <Typography variant="body2">{opt.name}</Typography>
                <Typography variant="caption" color="text.secondary">{opt.path}</Typography>
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search GADM divisions"
              placeholder="Type at least 2 characters..."
              autoFocus
              sx={{ mt: 1 }}
            />
          )}
          noOptionsText={query.length < 2 ? 'Type at least 2 characters' : 'No divisions found'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

