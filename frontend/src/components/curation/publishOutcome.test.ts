/**
 * Tests for the line a curator reads after publishing one object.
 *
 * The sentence exists to be handed to an admin word for word — it names the object and
 * the world views whose regions are now stale, because re-assigning them is admin-only
 * and the curator's one useful act is reporting them. So the words around the list have
 * to agree with the list: it is normally several, one per world view.
 */

import { describe, it, expect } from 'vitest';
import { publishOutcomeFor } from './publishOutcome';
import type { PublishResult } from '../../api/experiences';

function result(over: Partial<PublishResult> = {}): PublishResult {
  return {
    experienceId: 6206,
    curationState: 'verified',
    appliedFields: [],
    claimedFieldsSkipped: [],
    appliedParts: [],
    fromSyncLogId: null,
    locationsPublished: 0,
    treasureLinksPublished: 0,
    treasuresPublished: 0,
    withdrawalsReleased: 0,
    ...over,
  };
}

const item = { name: 'Museo Nacional del Prado' };

describe('publishOutcomeFor', () => {
  it('names each part it wrote to, with the fields in the reader\'s words', () => {
    // A held re-attribution published (ADR-0037): the line says which work, and
    // what about it, the way the card's own group did — and which of its fields
    // stayed as the curator wrote them.
    const line = publishOutcomeFor(item, result({
      appliedParts: [
        { kind: 'treasures', name: 'The Wine Glass', fields: ['artist', 'image_url'], claimedFieldsSkipped: [] },
        { kind: 'locations', name: 'Château de Montésgur', fields: [], claimedFieldsSkipped: ['name'] },
      ],
    }));

    expect(line).toContain('The Wine Glass: artist, picture applied');
    expect(line).toContain('Château de Montésgur: name left as you wrote it');
    expect(line).not.toContain('image_url');
  });

  it('says which parts the proposal named that were no longer there to write', () => {
    const line = publishOutcomeFor(item, result({
      partsNotFound: [{ kind: 'locations', name: 'Château de Montésgur' }],
    }));

    expect(line).toContain('Château de Montésgur is no longer offered, so nothing was written to it');
  });

  it('says what became visible, counting works from whichever axis moved', () => {
    // The link says a work has been passed *here*, the row says it has been passed at
    // all, so a work already verified in another venue moves only the link — and one
    // number is what a curator wants, not two.
    const line = publishOutcomeFor(item, result({
      locationsPublished: 3, treasureLinksPublished: 12, treasuresPublished: 0,
    }));

    expect(line).toBe('Museo Nacional del Prado: 3 points and 12 works now visible.');
  });

  it('names fields the way the card that asked did', () => {
    // The card's rows are labelled through `fieldLabel`, and the server answers with the
    // changeset's own names. A line confirming a click must not rename what it acted on:
    // "shortDescription applied" under a row headed "short description" reads as a second
    // subject, and it is the schema talking on the one screen written to keep it quiet.
    const line = publishOutcomeFor(item, result({
      appliedFields: ['shortDescription', 'imageUrl'],
      claimedFieldsSkipped: ['name'],
    }));

    expect(line).toContain('short description, picture applied');
    expect(line).toContain('name left as you wrote them');
    expect(line).not.toContain('shortDescription');
    expect(line).not.toContain('imageUrl');
  });

  it('says which replaced points stopped being shown', () => {
    const line = publishOutcomeFor(item, result({ locationsPublished: 1, withdrawalsReleased: 2 }));

    expect(line).toContain('2 replaced points no longer shown');
  });

  // Every case below carries `withdrawalsReleased` above zero, because placement is
  // reached only when a withdrawal was released (`publishController.ts` places on
  // `withdrawalsReleased > 0`, `lifecycleController` answers `{}` on zero). A fixture
  // pairing `placementFailed` with zero releases is a state production cannot produce,
  // and the notice's closing count is written on the strength of that invariant.
  it('asks for one world view in the singular, and counts the one point it kept', () => {
    const line = publishOutcomeFor(item, result({
      locationsPublished: 1,
      withdrawalsReleased: 1,
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Continents' }],
    }));

    expect(line).toContain('not recomputed in Continents (world view 4)');
    expect(line).toContain('tell one this object and that world view');
    expect(line).toContain('placed by 1 point it no longer has');
  });

  it('asks for several in the plural, which is the ordinary shape', () => {
    // One failure per world view: a publication that failed in three of them printed a
    // list and then said "that world view", in the sentence meant to be forwarded as is.
    const line = publishOutcomeFor(item, result({
      locationsPublished: 1,
      withdrawalsReleased: 3,
      placementFailed: true,
      placementFailedWorldViews: [
        { id: 4, name: 'Continents' },
        { id: 7, name: 'Oceans' },
        { id: 9, name: 'Empires' },
      ],
    }));

    expect(line).toContain('tell one this object and those world views');
    expect(line).not.toContain('that world view;');
    // The closing count in the plural, beside the singular case above: a hardcoded noun
    // satisfies exactly one of the two, so the pair is what holds the count in place.
    expect(line).toContain('placed by 3 points it no longer has');
  });

  it('takes the plural for an empty list', () => {
    const line = publishOutcomeFor(item, result({
      locationsPublished: 1,
      withdrawalsReleased: 2,
      placementFailed: true,
      placementFailedWorldViews: [],
    }));

    expect(line).toContain('its world views');
    expect(line).toContain('those world views');
  });

  it('takes the plural for the one entry that stands for all of them', () => {
    // `placeAfterRelease` returns a single `{id: null}` when listing the world views is
    // itself what failed, so nothing was placed anywhere. It is one array element and it
    // names no world view — counting it as "one" put a singular phrase under
    // `worldViewList`'s "every world view — they could not even be listed".
    const line = publishOutcomeFor(item, result({
      locationsPublished: 1,
      withdrawalsReleased: 2,
      placementFailed: true,
      placementFailedWorldViews: [{ id: null, name: null }],
    }));

    expect(line).toContain('every world view — they could not even be listed');
    expect(line).toContain('those world views');
    expect(line).not.toContain('that world view;');
  });
});
