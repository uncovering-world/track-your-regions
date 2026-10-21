/**
 * Sync Panel
 *
 * Controls for syncing experience sources (UNESCO, etc.)
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSources, reorderSources, type ExperienceSource } from '../../api/admin';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { queryKeys } from '../../api/queryKeys';
import { SourceCard } from './SourceCard';

export function SyncPanel() {
  const queryClient = useQueryClient();
  const { data: sources, isLoading } = useQuery({
    queryKey: queryKeys.admin.sources,
    queryFn: getSources,
  });

  // Drag-and-drop state
  const [orderedSources, setOrderedSources] = useState<ExperienceSource[]>([]);
  const dragItemRef = useRef<number | null>(null);
  const dragOverItemRef = useRef<number | null>(null);

  // Sync ordered list when sources load
  useEffect(() => {
    if (sources) {
      setOrderedSources([...sources]);
    }
  }, [sources]);

  const reorderMutation = useMutation({
    mutationFn: (sourceIds: number[]) => reorderSources(sourceIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.sources });
    },
  });

  const handleDragStart = (index: number) => {
    dragItemRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverItemRef.current = index;
  };

  const handleDrop = () => {
    if (dragItemRef.current === null || dragOverItemRef.current === null) return;
    if (dragItemRef.current === dragOverItemRef.current) return;

    const newOrder = [...orderedSources];
    const [draggedItem] = newOrder.splice(dragItemRef.current, 1);
    newOrder.splice(dragOverItemRef.current, 0, draggedItem);

    setOrderedSources(newOrder);
    reorderMutation.mutate(newOrder.map(s => s.id));

    dragItemRef.current = null;
    dragOverItemRef.current = null;
  };

  if (isLoading) {
    return <LoadingSpinner padding={4} />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Sync Experiences
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Drag to reorder how sources appear in the experience list.
      </Typography>

      <Box sx={{ display: 'grid', gap: 3 }}>
        {orderedSources.map((source, index) => (
          <Box
            key={source.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
          >
            <SourceCard
              source={source}
              runsWith={source.runsWith.map((id) => orderedSources.find((other) => other.id === id)?.name ?? `source ${id}`)}
            />
          </Box>
        ))}
      </Box>

    </Box>
  );
}
