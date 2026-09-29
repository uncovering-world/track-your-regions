import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Tooltip,
  ClickAwayListener,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import type { WorldView } from '../../../api/worldViews';
import { WORLD_VIEW_DESCRIPTION_MAX_LENGTH } from '../../../api/worldViews';
import { useAppTheme } from '../../../theme';

interface WorldViewHeaderProps {
  worldView: WorldView;
  /** Settles when the save does: an editor closes on success and shows the reason on failure. */
  onUpdate: (data: { name?: string; description?: string; source?: string }) => Promise<unknown>;
  isPending: boolean;
  onClose: () => void;
}

export function WorldViewHeader({ worldView, onUpdate, isPending }: WorldViewHeaderProps) {
  const { P, sx: sxTokens } = useAppTheme();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(worldView.name);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState(worldView.description || '');
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [sourceValue, setSourceValue] = useState(worldView.source || '');
  // Why the last save was refused; the editor it came from stays open with it (#448).
  const [saveError, setSaveError] = useState<string | null>(null);
  // The save whose answer the header still waits for. Dismissing or opening an
  // editor moves it on, so a save answered after its editor closed shows
  // nothing, rather than its refusal turning up under another field.
  const currentSave = useRef(0);

  useEffect(() => {
    setNameValue(worldView.name);
    setDescriptionValue(worldView.description || '');
    setSourceValue(worldView.source || '');
  }, [worldView.name, worldView.description, worldView.source]);

  const save = (data: { name?: string; description?: string; source?: string }, close: () => void) => {
    // Enter reaches here past the disabled button: one save in flight at a time.
    if (isPending) return;
    setSaveError(null);
    const thisSave = ++currentSave.current;
    onUpdate(data).then(
      () => { if (thisSave === currentSave.current) close(); },
      (err: unknown) => {
        if (thisSave !== currentSave.current) return;
        setSaveError(err instanceof Error && err.message ? err.message : 'Could not save');
      },
    );
  };

  const forgetSave = () => { currentSave.current++; setSaveError(null); };
  const openName = () => { forgetSave(); setIsEditingName(true); };
  const openDescription = () => { forgetSave(); setIsEditingDescription(true); };
  const openSource = () => { forgetSave(); setIsEditingSource(true); };

  const handleSaveName = () => {
    if (nameValue.trim()) {
      save({ name: nameValue.trim() }, () => setIsEditingName(false));
    }
  };

  const handleSaveDescription = () => {
    save({ description: descriptionValue.trim() }, () => setIsEditingDescription(false));
  };

  const handleSaveSource = () => {
    save({ source: sourceValue.trim() }, () => setIsEditingSource(false));
  };

  const cancelName = () => { setNameValue(worldView.name); setIsEditingName(false); forgetSave(); };
  const cancelDescription = () => { setDescriptionValue(worldView.description || ''); setIsEditingDescription(false); forgetSave(); };
  const cancelSource = () => { setSourceValue(worldView.source || ''); setIsEditingSource(false); forgetSave(); };

  const inlineInputSx = {
    '& .MuiOutlinedInput-root': {
      bgcolor: P.dark.bgInput,
      color: P.dark.textBright,
      fontFamily: P.font.ui,
      fontSize: '0.85rem',
      height: 32,
      '& fieldset': { borderColor: P.accent.primary },
    },
    '& .MuiInputBase-input': { py: 0.5, px: 1 },
  };

  const saveBtnSx = {
    textTransform: 'none' as const,
    fontFamily: P.font.ui,
    fontSize: '0.75rem',
    fontWeight: 600,
    minWidth: 'auto',
    px: 1.5,
    py: 0.25,
    bgcolor: P.accent.primary,
    color: P.dark.bg,
    '&:hover': { bgcolor: P.accent.primaryHover },
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 0.25 }}>
      {/* ── Row 1: Title ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {isEditingName ? (
          <ClickAwayListener onClickAway={cancelName}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                size="small"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') cancelName();
                }}
                autoFocus
                error={saveError !== null}
                helperText={saveError ?? undefined}
                sx={{ ...inlineInputSx, minWidth: 200 }}
              />
              <Button size="small" variant="contained" onClick={handleSaveName} disabled={!nameValue.trim() || isPending} sx={saveBtnSx}>
                Save
              </Button>
            </Box>
          </ClickAwayListener>
        ) : (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, cursor: 'pointer' }}
            onClick={openName}
          >
            <Typography sx={{
              fontFamily: P.font.display,
              fontWeight: 700,
              fontSize: '1.1rem',
              color: P.dark.textBright,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {worldView.name}
            </Typography>
            <Tooltip title="Rename">
              <IconButton size="small" onClick={openName} sx={sxTokens.darkIconBtn}>
                <EditIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* ── Row 2: Description + Source ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        {/* Description */}
        {isEditingDescription ? (
          <ClickAwayListener onClickAway={cancelDescription}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
              <TextField
                size="small"
                value={descriptionValue}
                onChange={(e) => setDescriptionValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveDescription();
                  if (e.key === 'Escape') cancelDescription();
                }}
                placeholder="Description..."
                autoFocus
                fullWidth
                sx={inlineInputSx}
                slotProps={{ htmlInput: { maxLength: WORLD_VIEW_DESCRIPTION_MAX_LENGTH } }}
                error={saveError !== null}
                helperText={saveError ?? `${descriptionValue.length}/${WORLD_VIEW_DESCRIPTION_MAX_LENGTH}`}
              />
              <Button size="small" variant="contained" onClick={handleSaveDescription} disabled={isPending} sx={saveBtnSx}>
                Save
              </Button>
            </Box>
          </ClickAwayListener>
        ) : (
          <Tooltip title="Click to edit description">
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                flex: 1,
                minWidth: 0,
                cursor: 'pointer',
                px: 0.75,
                py: 0.125,
                borderRadius: 0.5,
                '&:hover': { bgcolor: P.dark.bgHover },
              }}
              onClick={openDescription}
            >
              <Typography sx={{
                fontFamily: P.font.ui,
                fontSize: '0.78rem',
                color: worldView.description ? P.dark.text : P.dark.textMuted,
                fontStyle: worldView.description ? 'normal' : 'italic',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {worldView.description || 'Add description...'}
              </Typography>
            </Box>
          </Tooltip>
        )}

        {/* Separator dot */}
        <Typography sx={{ color: P.dark.textMuted, fontSize: '0.6rem', flexShrink: 0 }}>
          &bull;
        </Typography>

        {/* Source */}
        {isEditingSource ? (
          <ClickAwayListener onClickAway={cancelSource}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 200 }}>
              <TextField
                size="small"
                value={sourceValue}
                onChange={(e) => setSourceValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSource();
                  if (e.key === 'Escape') cancelSource();
                }}
                placeholder="Source..."
                autoFocus
                error={saveError !== null}
                helperText={saveError ?? undefined}
                sx={{ ...inlineInputSx, minWidth: 180 }}
              />
              <Button size="small" variant="contained" onClick={handleSaveSource} disabled={isPending} sx={saveBtnSx}>
                Save
              </Button>
            </Box>
          </ClickAwayListener>
        ) : (
          <Tooltip title="Click to edit source">
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: 'pointer',
                flexShrink: 0,
                px: 0.75,
                py: 0.125,
                borderRadius: 0.5,
                '&:hover': { bgcolor: P.dark.bgHover },
              }}
              onClick={openSource}
            >
              <Typography sx={{
                fontFamily: P.font.mono,
                fontSize: '0.72rem',
                color: worldView.source ? P.dark.text : P.dark.textMuted,
                fontStyle: worldView.source ? 'normal' : 'italic',
                whiteSpace: 'nowrap',
              }}>
                {worldView.source ? `src: ${worldView.source}` : 'Add source...'}
              </Typography>
            </Box>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}
