/**
 * The one place a world view import is started.
 *
 * Sources differ in their parameters, not in their shape, so they live in a
 * registry and this panel renders whichever one is selected. Only the selected
 * source's form is mounted, so switching sources clears inputs that no longer
 * apply.
 *
 * The world view name field is seeded from the selected source's suggested
 * default — a source is data, so its default name lives on its descriptor,
 * not here — until the admin types their own. Once they have, switching
 * sources never overwrites what they typed.
 */

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { IMPORT_SOURCES } from './importSources';

interface ImportSourcePanelProps {
  worldViewName: string;
  onWorldViewNameChange: (name: string) => void;
}

export function ImportSourcePanel({ worldViewName, onWorldViewNameChange }: ImportSourcePanelProps) {
  const [sourceId, setSourceId] = useState(IMPORT_SOURCES[0].id);
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId) ?? IMPORT_SOURCES[0];
  const SourceForm = source.Form;

  // Sticks once the admin types their own name; until then, a source change
  // (including the initial one below) offers that source's suggested default
  // instead of leaving a previous source's name behind. Seeded from the
  // incoming name rather than hardcoded false: the panel unmounts and
  // remounts with `!isRunning` in the parent (e.g. another admin's run, or a
  // stale status refetch, flips it while this admin is mid-form), and the
  // parent's name state survives that cycle. A name that doesn't match the
  // initially-selected source's own default must be treated as already the
  // admin's, or the mount effect below would silently overwrite it.
  const editedRef = useRef(worldViewName !== (IMPORT_SOURCES[0].defaultWorldViewName ?? ''));

  // Seed from the initially selected source so the panel opens consistent
  // with its own selector, rather than with whatever the parent happened to
  // initialise its name state to. onWorldViewNameChange is the parent's
  // setState setter, whose identity React guarantees is stable, so this
  // effect runs once, on mount. A source with no suggested default (the file
  // source) is left alone rather than blanked — not every source has one.
  useEffect(() => {
    const defaultName = IMPORT_SOURCES[0].defaultWorldViewName;
    if (!editedRef.current && defaultName !== undefined) {
      onWorldViewNameChange(defaultName);
    }
  }, [onWorldViewNameChange]);

  const handleSourceChange = (id: string) => {
    setSourceId(id);
    if (!editedRef.current) {
      const next = IMPORT_SOURCES.find((s) => s.id === id) ?? IMPORT_SOURCES[0];
      const defaultName = next.defaultWorldViewName;
      if (defaultName !== undefined) {
        onWorldViewNameChange(defaultName);
      }
    }
  };

  const handleNameChange = (value: string) => {
    editedRef.current = true;
    onWorldViewNameChange(value);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Start an import</Typography>
        <Stack spacing={2}>
          <TextField
            select
            label="Source"
            value={sourceId}
            onChange={(e) => handleSourceChange(e.target.value)}
            size="small"
            fullWidth
          >
            {IMPORT_SOURCES.map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="WorldView Name"
            value={worldViewName}
            onChange={(e) => handleNameChange(e.target.value)}
            size="small"
            fullWidth
          />

          <SourceForm worldViewName={worldViewName} />
        </Stack>
      </CardContent>
    </Card>
  );
}
