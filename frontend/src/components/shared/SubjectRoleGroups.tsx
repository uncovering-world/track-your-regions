/**
 * A line's subjects in the curation dialog, grouped by the form the work shows
 * them in (#2485): the Neptune Fountain's Neptune and Triton without a role,
 * then the Rhine, the Elbe, the Oder and the Vistula under "Shown as women".
 * The groups are what the card will say (`subjectGroups`), in its order.
 *
 * Each chip can be removed, moved to the other line where the dialog shows
 * both, and given a role from its "as…" menu: another role the line already
 * holds, the one typed in the field's "Shown as" box, or none. A group's
 * heading renames its role for every figure in it, or takes it off them all.
 * Renaming to a role another group holds joins the two.
 */

import { useState, type KeyboardEvent } from 'react';
import { Box, Button, Chip, IconButton, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import { MAX_SUBJECT_ROLE_LENGTH, subjectGroups, tidyRole } from '@tyr/shared/commemorates';
import type { EditExperienceBodyCommemoratesItem } from '../../api/curation';

type Subject = EditExperienceBodyCommemoratesItem;

/** The subject with the role given, or with none: no key at all, the shape a subject without one has always had. */
export function withRole(subject: Subject, role: string | null): Subject {
  const plain = { item: subject.item, label: subject.label, articleUrl: subject.articleUrl };
  const tidied = role ? tidyRole(role) : '';
  return tidied ? { ...plain, role: tidied } : plain;
}

/** The list with every figure of the role `from` given the role `to`, or none. */
export function renamedRole(subjects: readonly Subject[], from: string, to: string | null): Subject[] {
  return subjects.map(subject => (subject.role === from ? withRole(subject, to) : subject));
}

interface Shared {
  subjects: readonly Subject[];
  onChange: (subjects: Subject[]) => void;
  disabled: boolean;
}

/** A role group's heading: the role, and renaming it or taking it off the group. */
function RoleHeading({ role, subjects, onChange, disabled }: Shared & { role: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => {
    // A save under way disables the field; a rename typed before it is not committed over it.
    if (draft !== null && !disabled) onChange(renamedRole(subjects, role, draft));
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Enter would otherwise submit nothing useful; Escape keeps the role as it was.
    if (event.key === 'Enter') { event.preventDefault(); done(); }
    if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); }
  };
  if (draft !== null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          label="Role of these figures"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          size="small"
          autoFocus
          disabled={disabled}
          slotProps={{ htmlInput: { maxLength: MAX_SUBJECT_ROLE_LENGTH } }}
        />
        <Button size="small" disabled={disabled} onClick={done}>Done</Button>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">Shown as</Typography>
      <Typography variant="body2" component="strong" sx={{ fontWeight: 500 }}>{role}</Typography>
      <Button size="small" disabled={disabled} aria-label={`Rename the role ${role}`} onClick={() => setDraft(role)}>Rename</Button>
      <Button size="small" disabled={disabled} aria-label={`Take the role ${role} off these figures`}
        onClick={() => onChange(renamedRole(subjects, role, null))}>
        No role for these
      </Button>
    </Box>
  );
}

/** The roles a figure's "as…" menu offers: the line's others, the one typed in "Shown as", and none where it has one. */
function roleChoices(subject: Subject, lineRoles: readonly string[], typed: string): (string | null)[] {
  const roles = typed && !lineRoles.includes(typed) ? [...lineRoles, typed] : lineRoles;
  return [...roles.filter(role => role !== subject.role), ...(subject.role ? [null] : [])];
}

/** One figure: its chip, its "as…" menu where it offers anything, and the move to the other line. */
function SubjectChip({ subject, subjects, onChange, onMove, other, choices, disabled }: Shared & {
  subject: Subject;
  onMove?: (subject: Subject) => void;
  other: string;
  choices: (string | null)[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = `role-menu-${subject.item}`;
  const pick = (role: string | null) => {
    setAnchor(null);
    onChange(subjects.map(listed => (listed.item === subject.item ? withRole(listed, role) : listed)));
  };
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <Chip
        label={subject.label}
        title={subject.item}
        size="small"
        variant="outlined"
        disabled={disabled}
        onDelete={() => onChange(subjects.filter(kept => kept.item !== subject.item))}
        deleteIcon={<CancelIcon titleAccess={`Remove ${subject.label}`} />}
      />
      {choices.length > 0 && (
        <>
          <Button size="small" disabled={disabled} sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}
            aria-label={`What ${subject.label} is shown as`} aria-haspopup="menu" aria-controls={anchor ? menuId : undefined}
            aria-expanded={anchor ? 'true' : undefined} onClick={event => setAnchor(event.currentTarget)}>
            as…
          </Button>
          <Menu id={menuId} anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            {choices.map(role => (
              <MenuItem key={role ?? ''} onClick={() => pick(role)}>{role ? `as ${role}` : 'No role'}</MenuItem>
            ))}
          </Menu>
        </>
      )}
      {onMove && (
        <Tooltip title={`Move to ${other}`}>
          <IconButton size="small" disabled={disabled} aria-label={`Move ${subject.label} to ${other}`} onClick={() => onMove(subject)}>
            <SwapVertIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

export function SubjectRoleGroups({ subjects, onChange, onMove, other, typedRole, disabled }: Shared & {
  /** Where the dialog shows the other line too: the subject moved there, out of this list. */
  onMove?: (subject: Subject) => void;
  /** The other line's heading, which the move names. */
  other: string;
  /** What the field's "Shown as" box holds, tidied: a role its figures' menus offer. */
  typedRole: string;
}) {
  const groups = subjectGroups(subjects);
  const lineRoles = groups.flatMap(group => (group.role ? [group.role] : []));
  const shared = { subjects, onChange, disabled };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {groups.map(group => (
        // A group only where the line holds a role: a line without one reads as the plain row of chips it always was.
        <Box key={group.role ?? ''} {...(lineRoles.length ? { role: 'group', 'aria-label': group.role ? `Shown as ${group.role}` : 'No role' } : {})}
          sx={lineRoles.length ? { border: 1, borderColor: 'divider', borderRadius: 1, p: 1 } : undefined}>
          {group.role && <RoleHeading {...shared} role={group.role} />}
          {!group.role && lineRoles.length > 0 && <Typography variant="caption" color="text.secondary">No role</Typography>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: lineRoles.length ? 0.5 : 0 }}>
            {group.subjects.map(subject => (
              <SubjectChip key={subject.item} {...shared} subject={subject} onMove={onMove} other={other}
                choices={roleChoices(subject, lineRoles, typedRole)} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
