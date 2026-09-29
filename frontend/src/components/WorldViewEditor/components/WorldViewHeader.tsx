import { useState } from 'react';
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
import type { UpdateWorldViewBody, WorldView } from '../../../api/worldViews';
import { WORLD_VIEW_DESCRIPTION_MAX_LENGTH } from '../../../api/worldViews';
import { useAppTheme } from '../../../theme';
import { useEditForm } from '../../../hooks/useEditForm';

type HeaderFields = Required<Pick<UpdateWorldViewBody, 'name' | 'description' | 'source'>>;
type HeaderField = keyof HeaderFields;

interface WorldViewHeaderProps {
  worldView: WorldView;
  /** Settles when the save does: an editor closes on success and shows the reason on failure. */
  onUpdate: (data: UpdateWorldViewBody) => Promise<unknown>;
  isPending: boolean;
  onClose: () => void;
}

export function WorldViewHeader({ worldView, onUpdate, isPending }: WorldViewHeaderProps) {
  const { P, sx: sxTokens } = useAppTheme();
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isEditingSource, setIsEditingSource] = useState(false);
  // The three fields and a refusal's reason come from the form layer
  // (ADR-0076): each inline editor saves its own field alone, an emptied one as
  // empty, and a refused one stays open with the reason under it (#448).
  const form = useEditForm<HeaderFields>({
    initial: { name: worldView.name, description: worldView.description ?? '', source: worldView.source ?? '' },
    resetKey: worldView.id,
    required: ['name'],
  });
  const save = (key: HeaderField, close: () => void) => {
    // Enter reaches here past the disabled button: one save in flight at a time.
    if (isPending) return;
    form.submit(onUpdate, [key]).then(landed => { if (landed) close(); });
  };

  // Opening or dismissing an editor puts its field back, which also abandons
  // a save still in flight: answered after, it neither closes the editor open
  // now nor shows its refusal there.
  const open = (key: HeaderField, setEditing: (on: boolean) => void) => {
    form.resetField(key);
    setEditing(true);
  };
  const cancel = (key: HeaderField, setEditing: (on: boolean) => void) => {
    form.resetField(key);
    setEditing(false);
  };
  const openName = () => open('name', setIsEditingName);
  const openDescription = () => open('description', setIsEditingDescription);
  const openSource = () => open('source', setIsEditingSource);
  const cancelName = () => cancel('name', setIsEditingName);
  const cancelDescription = () => cancel('description', setIsEditingDescription);
  const cancelSource = () => cancel('source', setIsEditingSource);

  // The open editor's field: its own refused reason, or the refusal that names
  // no field — only one editor is open at a time, so that one is this one's.
  const editorField = (key: HeaderField, helperText?: string) => {
    const fieldProps = form.field(key, { helperText: form.formError ?? helperText });
    return { ...fieldProps, error: fieldProps.error || form.formError !== null };
  };

  const handleSaveName = () => {
    if (!form.missing) save('name', () => setIsEditingName(false));
  };
  const handleSaveDescription = () => save('description', () => setIsEditingDescription(false));
  const handleSaveSource = () => save('source', () => setIsEditingSource(false));

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
                {...editorField('name')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') cancelName();
                }}
                autoFocus
                sx={{ ...inlineInputSx, minWidth: 200 }}
              />
              <Button size="small" variant="contained" onClick={handleSaveName} disabled={form.missing || isPending} sx={saveBtnSx}>
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
                {...editorField('description', `${form.values.description.length}/${WORLD_VIEW_DESCRIPTION_MAX_LENGTH}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveDescription();
                  if (e.key === 'Escape') cancelDescription();
                }}
                placeholder="Description..."
                autoFocus
                fullWidth
                sx={inlineInputSx}
                slotProps={{ htmlInput: { maxLength: WORLD_VIEW_DESCRIPTION_MAX_LENGTH } }}
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
                {...editorField('source')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSource();
                  if (e.key === 'Escape') cancelSource();
                }}
                placeholder="Source..."
                autoFocus
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
