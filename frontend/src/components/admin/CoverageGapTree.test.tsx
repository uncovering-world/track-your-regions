import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GapNodeRow } from './CoverageGapTree';
import { gapTree } from './coverageResolveUtils';

/**
 * A gap's tree is drawn as far as it has been read (#1030): Australia's states
 * come with the coverage answer, and New South Wales says it is loading until
 * its own level arrives.
 */
const AUSTRALIA = { id: 3, name: 'Australia', parentName: 'Oceania', suggestion: null, children: [
  { id: 4, name: 'New South Wales', hasChildren: true },
  { id: 5, name: 'Northern Territory', hasChildren: false },
] };
const SYDNEY = { id: 6, name: 'Sydney', hasChildren: false };

function renderRow(loaded: Map<number, typeof SYDNEY[]>, failed = new Set<number>(), onRetryLoad = vi.fn()) {
  const noop = vi.fn();
  render(
    <GapNodeRow
      gap={AUSTRALIA}
      tree={gapTree(AUSTRALIA.children, loaded, failed)}
      depth={1}
      selectedNodeId={null}
      expandedNodes={new Set([3, 4])}
      nodeSuggestions={new Map()}
      appliedNodes={new Set()}
      getNodeSuggestion={() => null}
      onSelect={noop}
      onToggleExpand={noop}
      onRetryLoad={onRetryLoad}
      onGeoSuggest={noop}
      onDismiss={noop}
      onApplySingle={noop}
      onUnapply={noop}
      geoSuggestPending={false}
      dismissPending={false}
    />,
  );
}

describe('GapNodeRow', () => {
  it('says an expanded branch is loading until its level is read', () => {
    renderRow(new Map());
    expect(screen.getByText('New South Wales')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Sydney')).not.toBeInTheDocument();
  });

  it('draws the level once it is read', () => {
    renderRow(new Map([[4, [SYDNEY]]]));
    expect(screen.getByText('Sydney')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('offers a retry, not an endless loading line, when the level could not be read', () => {
    const onRetryLoad = vi.fn();
    renderRow(new Map(), new Set([4]), onRetryLoad);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't read the divisions under it.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryLoad).toHaveBeenCalledWith(4);
  });
});
