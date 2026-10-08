/**
 * The map's hover card over one part of a serial site (#1270): the part's own
 * picture where it has one, and the whole site's otherwise, said beside the
 * credit — Prehistoric Pile Dwellings around the Alps, whose parts "See" and
 * "Riesi" are different villages on different lakes.
 */

import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { HoverProvider, useHoverActions } from '../../hooks/useHoverContext';
import { HoverPreviewCard } from './HoverPreviewCard';

let actions: ReturnType<typeof useHoverActions>;
function GrabActions() {
  actions = useHoverActions();
  return null;
}

function renderCard() {
  return render(
    <HoverProvider>
      <GrabActions />
      <HoverPreviewCard mapRef={{ current: null }} mapLoaded={false} />
    </HoverProvider>,
  );
}

const preview = {
  experienceId: 418,
  experienceName: 'Prehistoric Pile Dwellings around the Alps',
  locationId: 9001,
  locationName: 'See (1363-061)',
  kindName: 'World Heritage Sites',
  kindId: 1,
  imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Pfahlbauten.jpg',
  imageCredit: null,
  longitude: 9.0,
  latitude: 47.5,
};
const NOTE = "The whole site's picture; this part has none of its own";

describe('HoverPreviewCard over a part of a serial site', () => {
  it("says the picture is the whole site's where the part has none", () => {
    renderCard();
    act(() => actions.setHoverPreview({ ...preview, pictureOfObject: true }));
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it('says nothing over a part showing its own picture', () => {
    renderCard();
    act(() => actions.setHoverPreview({ ...preview, pictureOfObject: false }));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('says nothing where no part is named, as over a museum', () => {
    renderCard();
    act(() => actions.setHoverPreview({ ...preview, locationName: null, pictureOfObject: true }));
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});
