/**
 * Tests for the line a curator reads after releasing a whole source.
 *
 * Called directly rather than through a rendered dialog, which is the point of the
 * module existing: every clause here is a *claim about what happened*, each one was
 * corrected during review for saying something the response did not support, and each was
 * previously reachable only by mounting a component and clicking twice. A defect in a
 * count or a plural is a defect in this function, so this is where it is pinned.
 *
 * The component's own suite keeps one end-to-end case — that this text reaches the alert —
 * and everything about the switch, the confirmation and the caches.
 */

import { describe, it, expect } from 'vitest';
import { noticeFor } from './curationGateNotice';

type Result = Parameters<typeof noticeFor>[0];
type Published = Result['published'][number];

function result(over: Partial<Result> = {}): Result {
  return {
    categoryId: 2, published: [], refused: [], outOfScope: 0, heldLeftForReview: 0, ...over,
  };
}

function object(over: Partial<Published> = {}): Published {
  return {
    id: 1,
    name: 'Museo Nacional del Prado',
    locationsPublished: 0,
    treasureLinksPublished: 0,
    treasuresPublished: 0,
    withdrawalsReleased: 0,
    ...over,
  };
}

describe('the opening clause', () => {
  it('says nothing was waiting only when the response reports nothing at all', () => {
    expect(noticeFor(result())).toBe('Nothing was waiting.');
  });

  it('does not call the source empty when objects refused', () => {
    // "Nothing was waiting. 2 objects refused" asserts both that there was nothing and
    // that there were two. The first clause is a claim about the *source*.
    const notice = noticeFor(result({
      refused: [{ id: 9, name: 'Rijksmuseum', error: 'holding a proposal from a different run' }],
    }));

    expect(notice).toContain('Nothing was published.');
    expect(notice).not.toContain('Nothing was waiting');
  });

  it('does not call the source empty when a held change is still waiting', () => {
    // The count most likely to be non-zero, since held changes are what the batch leaves
    // behind on purpose — so "Nothing was waiting" would deny what the next clause says.
    const notice = noticeFor(result({ heldLeftForReview: 1 }));

    expect(notice).toContain('Nothing was published.');
    expect(notice).toContain('1 held change still waiting on its own card.');
    expect(notice).not.toContain('Nothing was waiting');
  });

  it('counts the objects it published, in words', () => {
    expect(noticeFor(result({ published: [object()] }))).toContain('1 object published.');
    expect(noticeFor(result({ published: [object(), object({ id: 2 })] })))
      .toContain('2 objects published.');
  });
});

describe('what the release did', () => {
  it('says what became visible, not only how many objects were published', () => {
    // A work passed here for the first time moves both axes; one already verified
    // elsewhere moves only the link. `Math.max` per object is what the single-object card
    // takes, and summing the two columns would count the first museum's works twice.
    const notice = noticeFor(result({
      published: [
        object({ locationsPublished: 3, treasureLinksPublished: 12, treasuresPublished: 12 }),
        object({ id: 2, name: 'Rijksmuseum', treasureLinksPublished: 1 }),
      ],
    }));

    expect(notice).toContain('3 points and 13 works now visible.');
  });

  it('leaves out the half that is zero rather than printing it', () => {
    const points = noticeFor(result({ published: [object({ locationsPublished: 2 })] }));
    expect(points).toContain('2 points now visible.');
    expect(points).not.toContain('work');

    const works = noticeFor(result({ published: [object({ treasuresPublished: 1 })] }));
    expect(works).toContain('1 work now visible.');
    expect(works).not.toContain('point');
  });

  it('names the object whose replaced pin stopped being shown', () => {
    // A change to what readers see that "1 object published." says nothing about: nothing
    // but the per-object history records when an old pin went.
    const notice = noticeFor(result({
      published: [object({ locationsPublished: 3, withdrawalsReleased: 2 })],
    }));

    expect(notice).toContain('2 replaced points in Museo Nacional del Prado no longer shown.');
  });

  it('names both units when more than one object dropped a pin', () => {
    const notice = noticeFor(result({
      published: [
        object({ name: 'Prado', withdrawalsReleased: 2 }),
        object({ id: 2, name: 'Rijksmuseum', withdrawalsReleased: 1 }),
        object({ id: 3, name: 'Louvre' }),
      ],
    }));

    expect(notice).toContain('3 replaced points in 2 objects no longer shown — Prado, Rijksmuseum.');
    // The one that released none is neither named nor counted.
    expect(notice).not.toContain('Louvre');
    expect(notice).not.toContain('3 objects no longer');
  });

  it('says what the truncated tail counts', () => {
    // Where a point count over an object list goes wrong: "23 replaced points … and 3
    // more" leaves the reader deciding whether three more points or three more museums.
    const names = ['Prado', 'Rijksmuseum', 'Louvre', 'Uffizi', 'MoMA', 'Tate', 'Hermitage', 'Met'];
    const notice = noticeFor(result({
      published: names.map((name, i) => object({
        id: i + 1, name, withdrawalsReleased: i === 0 ? 9 : 2,
      })),
    }));

    expect(notice).toContain('23 replaced points in 8 objects no longer shown — '
      + 'Prado, Rijksmuseum, Louvre, Uffizi, MoMA and 3 more.');
  });
});

describe('what did not happen', () => {
  it('groups refusals by reason and names them, because the reasons differ', () => {
    // "3 objects refused — open Prado to see why" would explain Prado and mislead about
    // Louvre, whose reason is a thrown database error rather than a newer proposal.
    const stale = 'This row is holding a proposal from a different run — reload to see it';
    const notice = noticeFor(result({
      refused: [
        { id: 1, name: 'Prado', error: stale },
        { id: 2, name: 'Rijksmuseum', error: stale },
        { id: 3, name: 'Louvre', error: 'Publishing this object failed — open it to see where it stands' },
      ],
    }));

    // The group of two names its objects and then attributes the server's sentence, which
    // is written for one row; the group of one reads as the sentence it is, with no count.
    expect(notice).toContain('2 objects refused — Prado, Rijksmuseum. Each: “');
    // Terminated: clauses join with a single space and the server's reason ends in no
    // punctuation, so without the full stop the next clause ran on from it.
    expect(notice).toMatch(/reload to see it”\. /);
    expect(notice).toContain('Louvre refused — Publishing this object failed');
    expect(notice).not.toContain('1 object refused');
  });

  it('names what a region-scoped curator did not cover, rather than a bare number', () => {
    // The one clause only a region-scoped curator ever reads, and the reason the count
    // exists is that a short result must not read as a cleared source.
    expect(noticeFor(result({ published: [object()], outOfScope: 3 })))
      .toContain('3 objects outside your scope, left alone.');
  });

  it('names the objects and world views a publication left stale', () => {
    // Rebuilding a world view is an admin's job, so the curator's one useful act is
    // naming which object and which world view. A count would reduce them to
    // "something about regions failed".
    const notice = noticeFor(result({
      published: [
        object({
          locationsPublished: 1,
          placementFailed: true,
          placementFailedWorldViews: [{ id: 4, name: 'Continents' }],
        }),
        object({ id: 2, name: 'Rijksmuseum', locationsPublished: 1 }),
      ],
    }));

    // The id travels with the name, through the same helper the single-object card uses:
    // the curator reports the name, the admin searches by the number.
    expect(notice).toContain('Museo Nacional del Prado in Continents (world view 4)');
    expect(notice).toContain('Tell an admin');
    expect(notice).not.toContain('Rijksmuseum');
  });

  it('keeps the handover line to one level of brackets with several world views', () => {
    // `worldViewList` returns `Name (world view N)` and joins several with commas, so
    // wrapping each object's list in brackets nested a comma-separated list inside
    // parentheses inside a semicolon-separated list. One world view per object hides it;
    // two do not, and this line exists to be forwarded to an admin word for word.
    const notice = noticeFor(result({
      published: [
        object({
          name: 'Prado',
          placementFailed: true,
          placementFailedWorldViews: [{ id: 1, name: 'GADM' }, { id: 4, name: 'Continents' }],
        }),
        object({
          id: 2,
          name: 'Rijksmuseum',
          placementFailed: true,
          placementFailedWorldViews: [{ id: 4, name: 'Continents' }],
        }),
      ],
    }));

    expect(notice).toContain('Prado in GADM (world view 1), Continents (world view 4); '
      + 'Rijksmuseum in Continents (world view 4).');
    expect(notice).not.toContain('))');
  });

  it('agrees with the count when talking about held changes', () => {
    expect(noticeFor(result({ heldLeftForReview: 1 })))
      .toContain('1 held change still waiting on its own card.');
    expect(noticeFor(result({ heldLeftForReview: 2 })))
      .toContain('2 held changes still waiting on their own cards.');
  });

  it('says the held remainder could not be counted rather than showing it as none', () => {
    // The publications committed and the closing count did not. Rendering `null` as
    // "nothing still held" would be a claim about the source that nothing checked — and
    // it points at where the number lives rather than promising one will be there, since
    // the panel's count is a separate, wider query that fails for the same causes.
    const notice = noticeFor(result({ published: [object()], heldLeftForReview: null }));

    expect(notice).toContain('1 object published.');
    expect(notice).toContain('How much this source is still holding could not be counted — '
      + 'the panel counts it separately.');
    expect(notice).not.toContain('still waiting on');
  });
});

describe('the order of the clauses', () => {
  it('keeps what the release did together, with everything that did not happen after it', () => {
    // The single-object notice runs visible → no longer shown → what failed, and a batch
    // is read by the same person. A refusal between the two halves of what the release did
    // splits one account into two with a failure wedged inside it.
    const notice = noticeFor(result({
      published: [object({ locationsPublished: 3, withdrawalsReleased: 2 })],
      refused: [{ id: 9, name: 'Rijksmuseum', error: 'holding a proposal from a different run' }],
      outOfScope: 1,
    }));

    expect(notice.indexOf('now visible')).toBeLessThan(notice.indexOf('no longer shown'));
    expect(notice.indexOf('no longer shown')).toBeLessThan(notice.indexOf('refused'));
    expect(notice.indexOf('refused')).toBeLessThan(notice.indexOf('outside your scope'));
  });
});
