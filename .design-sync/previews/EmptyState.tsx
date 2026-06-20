import { EmptyState } from 'frontend';

export const NoRegions = () => <EmptyState message="No regions in this world view yet." />;
export const NoResults = () => <EmptyState message="No experiences match your filters." />;
export const Tight = () => <EmptyState message="Nothing here." padding={1} />;
