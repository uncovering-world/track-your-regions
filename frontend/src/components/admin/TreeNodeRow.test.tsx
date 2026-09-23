/**
 * The tree draws a source-page glyph beside every node whose import named a
 * page, and the glyph's href goes through `safeHref` rather than linking
 * whatever string the row carried (#703): `href={url}` for a value an import
 * tree posted and `z.string().url()` let through is a `javascript:` href that
 * runs on click, in the admin's session. A page `safeHref` refuses gets no
 * glyph at all -- there is nothing to open.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TreeNodeRow, type TreeNodeRowProps } from './TreeNodeRow';
import type { MatchTreeNode } from '../../api/admin/worldViewImport';

const WIKIVOYAGE_PAGE = 'https://en.wikivoyage.org/wiki/Saharan_Atlas';

function node(sourceUrl: string | null): MatchTreeNode {
  return {
    id: 1,
    name: 'Saharan Atlas',
    isLeaf: true,
    matchStatus: 'auto_matched',
    suggestions: [],
    sourceUrl,
    regionMapUrl: null,
    mapImageCandidates: [],
    mapImageReviewed: false,
    needsManualFix: false,
    fixNote: null,
    wikidataId: null,
    memberCount: 0,
    assignedDivisions: [],
    geoAvailable: null,
    markerPoints: null,
    hierarchyWarnings: [],
    hierarchyReviewed: false,
    children: [],
  };
}

function renderRow(sourceUrl: string | null) {
  const noop = vi.fn();
  const props: TreeNodeRowProps = {
    node: node(sourceUrl),
    depth: 0,
    expanded: new Set(),
    onToggle: noop,
    onAccept: noop,
    onAcceptAndRejectRest: noop,
    onReject: noop,
    onDBSearch: noop,
    onAIMatch: noop,
    onDismissChildren: noop,
    onSync: noop,
    onHandleAsGrouping: noop,
    onGeocodeMatch: noop,
    onGeoshapeMatch: noop,
    onPointMatch: noop,
    onResetMatch: noop,
    onRejectRemaining: noop,
    onAcceptAll: noop,
    onPreview: noop,
    onOpenMapPicker: noop,
    onManualFix: noop,
    isMutating: false,
    dbSearchingRegionId: null,
    aiMatchingRegionId: null,
    dismissingRegionId: null,
    syncingRegionId: null,
    groupingRegionId: null,
    geocodeMatchingRegionId: null,
    geoshapeMatchingRegionId: null,
    pointMatchingRegionId: null,
    geocodeProgress: null,
    duplicateUrls: new Set(),
    syncedUrls: new Set(),
    shadowsByRegionId: new Map(),
    ancestorIsMatched: false,
  };
  render(<TreeNodeRow {...props} />);
}

/** Every address the row offers to open. */
const linkedHrefs = () => Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));

describe('TreeNodeRow source page', () => {
  it('links the page the import named', () => {
    renderRow(WIKIVOYAGE_PAGE);
    expect(linkedHrefs()).toEqual([WIKIVOYAGE_PAGE]);
  });

  it('offers no link to a page whose address would execute', () => {
    renderRow('javascript:alert(document.cookie)');
    expect(linkedHrefs()).toEqual([]);
  });

  it('offers no link where the import named no page', () => {
    renderRow(null);
    expect(linkedHrefs()).toEqual([]);
  });
});
