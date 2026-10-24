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
import { PassCard } from './PassCard';
import { cardsOf } from './passCards';
import { MergeProposalFinderCard } from './MergeProposalFinderCard';


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

  const cards = cardsOf(orderedSources);

  // A card moves whole: a pass's sources keep their places beside each other.
  const handleDrop = () => {
    if (dragItemRef.current === null || dragOverItemRef.current === null) return;
    if (dragItemRef.current === dragOverItemRef.current) return;

    const newCards = [...cards];
    const [draggedCard] = newCards.splice(dragItemRef.current, 1);
    newCards.splice(dragOverItemRef.current, 0, draggedCard);
    const newOrder = newCards.flat();

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
        {cards.map((members, index) => (
          <Box
            key={members[0].id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
          >
            {members.length > 1 ? <PassCard sources={members} /> : <SourceCard source={members[0]} />}
          </Box>
        ))}
      </Box>

      {/* The one pass over the whole catalogue that no run does by itself: a
          run pairs the places it brought, and a publish the arrival; this
          looks at every place, for after a rule changes (#1805). */}
      <Typography variant="h5" sx={{ mt: 4, mb: 1 }}>For the whole catalogue</Typography>
      <MergeProposalFinderCard />
    </Box>
  );
}
