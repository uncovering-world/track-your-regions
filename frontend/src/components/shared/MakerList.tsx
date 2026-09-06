/**
 * The people who made a work, in the order a curator puts them in.
 *
 * Putting them in order is the point, not a text field's side effect. The stored
 * order is a query planner's and not the source's (ADR-0040), so who *led* a
 * collaboration is a judgement nobody has made yet: the *Visitation* in the
 * Prado lists Gianfrancesco Penni, Giulio Romano and Raphael, in that order,
 * which is why its row reads "3 artists" instead of naming Raphael. Retyping
 * three names to move one of them invites a typo in a name nobody asked to
 * change, so the names are objects here and never text.
 *
 * Two ways to move one, because they serve different hands. The grip drags
 * (`@dnd-kit`, already carrying the region tree in the world-view editor), which
 * is the fastest thing with a mouse. The arrows are the keyboard's path and
 * appear on hover and on focus in the row's own line, like every other row
 * action in the product. The grip is deliberately *not* focusable: a handle that
 * takes focus and then answers no key is worse than no handle, and the arrows
 * beside it already answer every key.
 *
 * An empty list is a state with something to say rather than a blank frame.
 * "Nobody knows who made this" is an answer — the right one for the *Salvator
 * Mundi*, whose stored maker, "Leonardeschi", names no person at all — and the
 * caller sends it as an empty list, which the endpoint keeps apart from leaving
 * the field alone.
 */

import { useState } from 'react';
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext, closestCenter, useSensor, useSensors, PointerSensor, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { sameLabel } from '../../utils/labelFold';

/**
 * The most the endpoint stores, so the form refuses a twenty-first rather than
 * the server. Exported because the cap is asked in two directions: this file
 * stops a curator adding one, and `refusals()` catches a list that *arrived*
 * over the line — the import has no cap of its own, so a work can be stored
 * with more than this and every other field of it is still correctable.
 */
export const MAX_MAKERS = 20;

export function MakerList({ makers, onChange, overCap = false }: {
  makers: string[];
  onChange: (makers: string[]) => void;
  /** The stored list is already longer than the endpoint stores — say what to do about it. */
  overCap?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const sensors = useSensors(
    // The same eight pixels the region tree asks for: a row carries buttons, and
    // without a threshold a click on one of them starts a drag instead.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const move = (from: number, to: number) => onChange(arrayMove(makers, from, to));
  const remove = (at: number) => onChange(makers.filter((_, i) => i !== at));

  const add = () => {
    const name = typed.trim();
    if (!name || duplicate) return;
    onChange([...makers, name]);
    setTyped('');
  };

  // The endpoint refuses the same maker twice and folds before it compares —
  // NFKC, every dash to the plain one, runs of whitespace to one, lowercase —
  // because the importer dedupes that way and a stored list never names one
  // person twice. Asked with the same fold here (`utils/labelFold`), or the
  // narrower question would pass exactly what the server then refuses: a work
  // names *Vincent van Gogh* and a curator pastes `Vincent  van Gogh` off a
  // wrapped line, or a hyphen that is U+2010, and the answer comes back as the
  // opaque "Validation error" this form exists to prevent.
  const duplicate = typed.trim().length > 0 && makers.some(held => sameLabel(held, typed));
  const full = makers.length >= MAX_MAKERS;

  // Why the field is refusing, where it is: the same maker twice — the check the
  // endpoint makes, folded — or a list already at the width the column stores.
  let addHint: string | undefined;
  if (duplicate) addHint = 'This work already names them.';
  else if (full) addHint = `A work names at most ${MAX_MAKERS} makers.`;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    move(makers.indexOf(String(active.id)), makers.indexOf(String(over.id)));
  };

  return (
    <Stack spacing={1}>
      {makers.length === 0 ? (
        <Box sx={{
          p: 1.5, border: '1px dashed', borderColor: 'divider', borderRadius: 1,
        }}>
          <Typography variant="body2">
            <strong>No maker recorded.</strong> The row will name nobody rather than name the
            wrong person — which is the right answer for a work whose maker is unknown.
          </Typography>
        </Box>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {/* Keyed by the name, which is what makes a row identifiable to the
              sortable context. Names are unique in this list by construction —
              `add` refuses a repeat, folded, as the endpoint does. */}
          <SortableContext items={makers} strategy={verticalListSortingStrategy}>
            <Box component="ul" sx={{
              listStyle: 'none', m: 0, p: 0,
              border: '1px solid', borderColor: 'divider', borderRadius: 1,
            }}>
              {makers.map((name, index) => (
                <MakerRow
                  key={name}
                  name={name}
                  index={index}
                  count={makers.length}
                  onUp={() => move(index, index - 1)}
                  onDown={() => move(index, index + 1)}
                  onRemove={() => remove(index)}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      {/* Said where a curator meets it rather than on the Save button, because
          the list arrived this way: nothing caps the import. The other fields
          are still saveable — the endpoint's cap is on the body, and `artists`
          reaches it only when the list is sent — so this says what it costs to
          send one rather than "you cannot save". */}
      {overCap && (
        <Typography variant="caption" color="error">
          This work names {makers.length} makers and the catalogue stores at most {MAX_MAKERS},
          so the makers cannot be confirmed or reordered until one comes off. Its title, year
          and picture can still be corrected.
        </Typography>
      )}
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          fullWidth
          label="Add a maker"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          disabled={full}
          error={duplicate}
          helperText={addHint}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        <Button
          onClick={add}
          disabled={!typed.trim() || duplicate || full}
          sx={{ alignSelf: 'flex-start', height: 40 }}
        >
          Add
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * One maker, with the two ways to move them and the way to take them off.
 *
 * Its own component because a sortable row holds state of its own — `useSortable`
 * gives it a transform and a dragging flag — and because the row's actions are
 * revealed by *its* hover, which a shared parent cannot express.
 */
function MakerRow({ name, index, count, onUp, onDown, onRemove }: {
  name: string;
  index: number;
  count: number;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: name });
  return (
    <Box
      component="li"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.5, pr: 1, py: 0.5,
        borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 },
        bgcolor: 'background.paper',
        opacity: isDragging ? 0.4 : 1,
        '&:hover .maker-actions, &:focus-within .maker-actions': { opacity: 1 },
      }}
    >
      {/* Not a button and not a tab stop: the arrows beside it are the keyboard's
          way to do this, and a focusable grip that answers no key would be a
          control that does nothing. `aria-hidden` for the same reason. */}
      <Box
        {...attributes}
        {...listeners}
        tabIndex={-1}
        aria-hidden
        sx={{
          display: 'flex', alignItems: 'center', color: 'text.disabled',
          cursor: 'grab', touchAction: 'none', '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>
      {index === 0 && count > 1 && (
        <Typography
          variant="caption"
          sx={{ color: 'primary.main', textTransform: 'uppercase', letterSpacing: '.06em', mr: 0.5 }}
        >
          leads
        </Typography>
      )}
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{name}</Typography>
      <Stack
        direction="row"
        className="maker-actions"
        sx={{ opacity: 0, transition: 'opacity .12s' }}
      >
        <Tooltip title="Move up">
          <span>
            <IconButton size="small" onClick={onUp} disabled={index === 0}
              aria-label={`Move ${name} up`}>
              <ArrowUpwardIcon fontSize="inherit" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Move down">
          <span>
            <IconButton size="small" onClick={onDown} disabled={index === count - 1}
              aria-label={`Move ${name} down`}>
              <ArrowDownwardIcon fontSize="inherit" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Remove">
          <IconButton size="small" onClick={onRemove} aria-label={`Remove ${name}`}>
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}
