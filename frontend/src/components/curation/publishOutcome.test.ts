/**
 * Tests for the line a curator reads after publishing one object.
 *
 * The sentence exists to be handed to an admin word for word — it names the object and
 * the world views whose regions are now stale, because re-assigning them is admin-only
 * and the curator's one useful act is reporting them. So the words around the list have
 * to agree with the list: it is normally several, one per world view.
 */

import { describe, it, expect } from 'vitest';
import { heldRefusalOutcomeFor, publishOutcomeFor } from './publishOutcome';
import type { PublishResult } from '../../api/experiences';

function result(over: Partial<PublishResult> = {}): PublishResult {
  return {
    experienceId: 6206,
    curationState: 'verified',
    appliedFields: [],
    claimedFieldsSkipped: [],
    appliedParts: [],
    fromSyncLogId: null,
    heldLeftOpen: 0,
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

  it('says the card is still standing after a one-row publish', () => {
    // The symmetry a refusal already had: publishing one of six leaves the rest
    // waiting, and the refetch shows a card that looks unanswered otherwise. A
    // state and not a number, for the `tags` reason the refusal line gives.
    const line = publishOutcomeFor(item, { ...result(), appliedFields: ['name'], heldLeftOpen: 2 });

    expect(line).toContain('the rest of the card is still waiting');
    expect(line).not.toMatch(/\b2 (things|thing)\b/);
  });

  it('says nothing of the kind when the whole card was answered', () => {
    expect(publishOutcomeFor(item, { ...result(), appliedFields: ['name'] }))
      .not.toContain('still waiting');
  });
});

/**
 * What a refusal says, since the row it answered goes away with it.
 *
 * The line is the only place the answer is stated at all: the refetch drops the
 * row, and where it was the last one the whole card goes with it.
 */
describe('heldRefusalOutcomeFor', () => {
  const refusal = {
    experienceId: 1, declinedFields: ['metadata'], declinedParts: [],
    fromSyncLogId: 68, heldLeftOpen: 0,
  };

  it('names what was refused and the run that has to ask again', () => {
    const line = heldRefusalOutcomeFor(item, refusal);

    // By value and by run: a curator meeting the field again next month is being
    // told the source changed its mind, not that the click failed.
    expect(line).toContain('source data refused');
    expect(line).toContain('readers keep what they see');
    expect(line).toContain('run 68 has to propose something different');
  });

  it('names a part with its field, since a bare field name answers for nothing', () => {
    const line = heldRefusalOutcomeFor(item, {
      ...refusal, declinedFields: [],
      declinedParts: [{ kind: 'treasures', name: 'The Wine Glass', fields: ['artist'] }],
    });

    expect(line).toContain('artist of The Wine Glass');
  });

  it('says the card is still standing, without counting what is on it', () => {
    // `heldLeftOpen` counts the changeset fields the run held, and the card does
    // not draw all of them — `tags` is written and never shown (#570). Refusing
    // one of Bamiyan's two visible rows leaves two fields open, and "2 things
    // still waiting" over a card showing one is a line a curator counts and
    // disagrees with. Found by driving the real screen.
    const line = heldRefusalOutcomeFor(item, { ...refusal, heldLeftOpen: 2 });

    expect(line).toContain('The rest of the card is still waiting.');
    expect(line).not.toMatch(/\b2 (things|thing)\b/);
  });

  it('says nothing more when that was the last of it', () => {
    expect(heldRefusalOutcomeFor(item, refusal)).not.toContain('still waiting');
  });
});
