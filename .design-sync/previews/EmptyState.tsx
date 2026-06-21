import { EmptyState } from 'frontend';

export const Rich = () => (
  <EmptyState
    title="No regions yet"
    message="Start logging the places you've been and watch your map fill in."
    action={{ label: 'Add your first region', onClick: () => {} }}
  />
);
export const NoResults = () => <EmptyState message="No experiences match your filters." />;
export const Tight = () => <EmptyState message="Nothing here." padding={1} />;
