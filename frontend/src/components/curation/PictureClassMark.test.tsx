/**
 * What a picture on a review card is, where it is no photograph (#2192), on the
 * 2026-10-31 walkthrough's cases: Banqiao Dam's map, the Saqqara Tablet's 1865
 * engraving beside its photograph.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

let onScreen = true;
vi.mock('../../hooks/useNearViewport', () => ({ useNearViewport: () => onScreen }));
vi.mock('../../api/curation', async original => ({
  ...(await original<typeof import('../../api/curation')>()),
  getPictureClasses: vi.fn(),
}));

import { getPictureClasses } from '../../api/curation';
import { classWords, PictureClassMark } from './PictureClassMark';
import { PictureFact } from './PictureFact';

const mockedClasses = getPictureClasses as unknown as ReturnType<typeof vi.fn>;
const MAP = 'https://upload.wikimedia.org/wikipedia/commons/3/3a/Banqiaomap.png';
const PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/5/5c/SaqqaraKingList.png';
const ENGRAVING = 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Saqqara-deRouge-1865.jpg';
const CHECKED = '2026-10-31T08:00:00.000Z';

function withQuery(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('what a picture on a review card is (#2192)', () => {
  beforeEach(() => {
    onScreen = true;
    mockedClasses.mockReset();
    mockedClasses.mockResolvedValue({ classes: [
      { url: MAP, class: 'map', basis: 'Maps of dams in China', checkedAt: CHECKED },
      { url: PHOTO, class: 'photograph', basis: 'image/png', checkedAt: CHECKED },
      { url: ENGRAVING, class: 'drawing', basis: 'Engravings of Egypt (1865)', checkedAt: CHECKED },
    ] });
  });

  it('says a map is a map, and nothing of a photograph', async () => {
    render(withQuery(<><PictureClassMark experienceId={40102} url={MAP} /><PictureClassMark experienceId={40102} url={PHOTO} /></>));
    expect(await screen.findByText('a map, not a photograph')).toBeInTheDocument();
    expect(screen.queryByText(/photograph, not/)).not.toBeInTheDocument();
    // One request per card, whatever the number of pictures on it.
    await waitFor(() => expect(mockedClasses).toHaveBeenCalledTimes(1));
    expect(mockedClasses).toHaveBeenCalledWith(40102);
  });

  it('marks both sides of a picture question: the engraving proposed for the Saqqara Tablet', async () => {
    render(withQuery(
      <>
        <PictureFact url={PHOTO} credit={null} side="before" experienceId={6220} />
        <PictureFact url={ENGRAVING} credit={null} side="after" experienceId={6220} />
      </>,
    ));
    expect(await screen.findByText('a drawing or engraving, not a photograph')).toBeInTheDocument();
    expect(screen.queryByText(/a map/)).not.toBeInTheDocument();
  });

  it('asks nothing while the picture is off screen, and nothing without the place', async () => {
    onScreen = false;
    render(withQuery(<PictureClassMark experienceId={40102} url={MAP} />));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mockedClasses).not.toHaveBeenCalled();
    onScreen = true;
    render(withQuery(<PictureFact url={MAP} credit={null} side="before" />));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mockedClasses).not.toHaveBeenCalled();
  });

  it('has words for a map, a drawing and a diagram, and none for a photograph or an unclassed picture', () => {
    expect(classWords({ class: 'map' })).toBe('a map, not a photograph');
    expect(classWords({ class: 'drawing' })).toBe('a drawing or engraving, not a photograph');
    expect(classWords({ class: 'diagram' })).toBe('a diagram, not a photograph');
    expect(classWords({ class: 'photograph' })).toBeNull();
    expect(classWords({ class: null })).toBeNull();
    expect(classWords(undefined)).toBeNull();
  });
});
