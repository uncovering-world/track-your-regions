/**
 * Discover's panel holding one part's own card (#1271), in place of the
 * object's: `PointCard`, with the visitor's own record of the part.
 */

import { useAuth } from '../../hooks/useAuth';
import { useVisitedLocations } from '../../hooks/useVisitedExperiences';
import { PointCard, type PointCardObject } from '../shared/PointCard';

export function DiscoverPointCard({ experience, pointId, onBack, onOpenPoint, onPointGone }: {
  experience: PointCardObject;
  pointId: number;
  onBack: () => void;
  onOpenPoint: (pointId: number, name: string) => void;
  onPointGone: () => void;
}) {
  const { isAuthenticated } = useAuth();
  const { isLocationVisited, markLocationVisited, unmarkLocationVisited } = useVisitedLocations(experience.id);
  const visited = isLocationVisited(pointId);
  return (
    <PointCard
      object={experience}
      pointId={pointId}
      onBack={onBack}
      onOpenPoint={onOpenPoint}
      onPointGone={onPointGone}
      visited={isAuthenticated ? {
        isVisited: visited,
        onToggle: () => (visited ? unmarkLocationVisited(pointId) : markLocationVisited(pointId)),
      } : null}
    />
  );
}
