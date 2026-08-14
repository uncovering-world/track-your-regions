/**
 * Tests for who decided what about a field, and when.
 *
 * The trail exists to answer "has the source changed its mind, or have I" — which it can
 * only do by showing what each earlier answer *took*. Its one real failure mode is a value
 * that quietly does not appear, because that is indistinguishable from an acceptance that
 * applied nothing, and it happens on exactly the field the trail was built for:
 * `shortDescription` acceptances run to 1339 characters and average 841.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvenanceTrail } from './ProvenanceTrail';

/** The length a real `shortDescription` acceptance runs to on the dev database. */
const LONG = `The property, located in north-eastern Democratic Republic of the Congo, forms part of one of the last extensive and continuous forest–savanna mosaic landscapes in Central Africa. ${'It encompasses a diverse range of habitats. '.repeat(15)}`;

describe('ProvenanceTrail', () => {
  it('shows what a long acceptance took, cut and marked rather than dropped', () => {
    render(<ProvenanceTrail field={{ decidedBefore: [{ by: 'admin', at: '2026-07-30T09:00:00Z', applied: LONG }] }} />);

    const line = screen.getByText(/took the source’s value/).textContent ?? '';
    expect(line).toContain('The property, located in north-eastern');
    expect(line).toContain('…');
    // Silence would read as "this acceptance applied nothing", which is a different fact.
    expect(line).toMatch(/: “/);
  });

  it('leaves a short value whole', () => {
    render(<ProvenanceTrail field={{ decidedBefore: [{ by: 'admin', at: '2026-07-30T09:00:00Z', applied: 'Serengeti National Park' }] }} />);

    expect(screen.getByText(/“Serengeti National Park”/)).toBeInTheDocument();
    expect(screen.queryByText(/…/)).not.toBeInTheDocument();
  });

  it('says nothing about a value there was none of', () => {
    // `applied` is `unknown`: a location or a metadata key comes back as an object, and an
    // acceptance that wrote nothing comes back empty. Neither may be quoted as a text.
    render(<ProvenanceTrail field={{ decidedBefore: [
      { by: 'admin', at: '2026-07-30T09:00:00Z', applied: '' },
      { by: 'nina', at: '2026-07-31T09:00:00Z', applied: { lat: 1, lon: 2 } },
    ] }}
    />);

    for (const line of screen.getAllByText(/took the source’s value/)) {
      expect(line.textContent).not.toContain('“');
    }
  });

  it('says which answer each earlier decision was', () => {
    // Both are answers to the same field, and a trail that reported them with one verb
    // would say the field went the source's way every time it went the other.
    render(<ProvenanceTrail field={{ decidedBefore: [
      { by: 'nina', at: '2026-07-31T09:00:00Z', action: 'declined_source', applied: 'Renamed upstream' },
      { by: 'admin', at: '2026-07-30T09:00:00Z', action: 'accepted_source', applied: 'Serengeti National Park' },
    ] }}
    />);

    expect(screen.getByText(/nina refused the source’s value/)).toBeInTheDocument();
    expect(screen.getByText(/admin took the source’s value/)).toBeInTheDocument();
  });

  it('reads a decision with no action recorded as an acceptance', () => {
    // Rows written before refusing was possible carry no action, and an acceptance is
    // the only thing they could have been — nothing else was recordable.
    render(<ProvenanceTrail field={{ decidedBefore: [{ by: 'admin', at: '2026-07-30T09:00:00Z', applied: 'Older' }] }} />);

    expect(screen.getByText(/took the source’s value/)).toBeInTheDocument();
  });

  it('renders nothing at all when there is no provenance to show', () => {
    const { container } = render(<ProvenanceTrail field={{}} />);

    expect(container).toBeEmptyDOMElement();
  });
});
