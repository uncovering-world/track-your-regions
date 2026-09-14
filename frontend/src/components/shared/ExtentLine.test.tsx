import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExtentLine, extentLabel } from './ExtentLine';

describe('extentLabel', () => {
  it('reads hectares below a square kilometre and square kilometres above it', () => {
    // The two real extents, measured off OpenStreetMap's polygons on
    // 2026-09-14 with the writer's own expression: Troy's excavations
    // (way/423938794) are 0.0568 km² and Machu Picchu's (way/157376572) 0.1149.
    // "0.057 km²" is a number nobody paces out, and a site is something you
    // walk across.
    expect(extentLabel(0.056761)).toBe('5.7 ha');
    expect(extentLabel(0.114937)).toBe('11 ha');
    expect(extentLabel(3.42)).toBe('3.4 km²');
    expect(extentLabel(401)).toBe('401 km²');
  });

  it('rounds both units the same way, and floors neither', () => {
    // 0.945 km² is 94.5 ha. Floored it read "94 ha" while the same number in
    // square kilometres read "0.9"; one rule, so a reader comparing two sites
    // across the boundary compares the same rounding.
    expect(extentLabel(0.945)).toBe('95 ha');
    expect(extentLabel(9.46)).toBe('9.5 km²');
  });

  it('drops the decimal once rounding reaches ten, in either unit', () => {
    // 9.96 rounds to ten: "10.0 ha" would be the one decimal the rule says
    // nobody reads from ten up.
    expect(extentLabel(0.0996)).toBe('10 ha');
    expect(extentLabel(9.96)).toBe('10 km²');
  });

  it('says less than a hectare rather than none', () => {
    expect(extentLabel(0.004)).toBe('<1 ha');
  });
});

describe('ExtentLine', () => {
  it('names the extent and credits the map it came from', () => {
    render(<ExtentLine areaKm2={0.056761} />);
    expect(screen.getByText(/Extent 5.7 ha/)).toBeInTheDocument();
    const credit = screen.getByRole('link', { name: /OpenStreetMap contributors/ });
    expect(credit).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  });

  it('shows nothing where there is no extent, so no credit stands beside nothing', () => {
    const { container } = render(<ExtentLine areaKm2={null} />);
    expect(container).toBeEmptyDOMElement();
    const undefinedCase = render(<ExtentLine areaKm2={undefined} />);
    expect(undefinedCase.container).toBeEmptyDOMElement();
  });
});
