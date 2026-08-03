import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LifecycleChip, lifecycleLabel, verdictOf } from './LifecycleChip';

describe('lifecycleLabel', () => {
  it('says nothing about an ordinary object', () => {
    expect(lifecycleLabel({ source_membership: 'present', existence: 'extant' })).toBeNull();
  });

  it('says nothing about one a run merely flagged', () => {
    // `missing_since` is an observation, not a verdict — a source outage must
    // not change what anyone sees, so nothing public may hang on it
    expect(lifecycleLabel({})).toBeNull();
  });

  it('answers the more important question first', () => {
    // Delisted *and* destroyed: "Former" would answer about the catalogue
    // while the reader is standing where the building used to be
    const both = lifecycleLabel({ source_membership: 'former', existence: 'lost' });

    expect(both?.label).toBe('Lost');
  });

  it('explains why a lost object is still on the reader screen', () => {
    expect(lifecycleLabel({ existence: 'lost' })?.title).toMatch(/visit to it still counts/i);
  });

  it('says a former object is still worth going to', () => {
    expect(lifecycleLabel({ source_membership: 'former' })?.title).toMatch(/still there to visit/i);
  });
});

describe('LifecycleChip', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<LifecycleChip state={{ source_membership: 'present', existence: 'extant' }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('labels a delisted place', () => {
    render(<LifecycleChip state={{ source_membership: 'former', existence: 'extant' }} />);

    expect(screen.getByText('Former')).toBeInTheDocument();
  });
});

describe('both card surfaces', () => {
  it('renders the same for a row whichever list it came from', () => {
    // Map mode and Discover read the same by-region response, so a row
    // labelled in one and bare in the other would be the same object
    // explained in one place and unexplained in the other
    const row = { source_membership: 'former' as const, existence: 'extant' as const };

    expect(lifecycleLabel(row)?.label).toBe('Former');
  });
});

describe('verdictOf', () => {
  it('finds nothing to take back on an ordinary row', () => {
    expect(verdictOf({ source_membership: 'present', existence: 'extant' })).toBeNull();
    expect(verdictOf(null)).toBeNull();
  });

  it('offers to undo the verdict that actually hid the row', () => {
    // Delisted *and* destroyed: undoing `former` would leave it hidden, since
    // `lost` is what takes it out of the lists
    expect(verdictOf({ source_membership: 'former', existence: 'lost' })).toBe('lost');
  });

  it('offers to undo a delisting on its own', () => {
    expect(verdictOf({ source_membership: 'former', existence: 'extant' })).toBe('former');
  });
});
