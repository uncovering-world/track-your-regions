import { describe, it, expect } from 'vitest';
import { boundedClosure } from './classClosure.js';

describe('boundedClosure', () => {
  it('keeps a tree that grows sanely', async () => {
    // painting measured: 109 -> 220 -> 254
    const children = (qids: string[]) => {
      if (qids.includes('Qpainting')) {
        return Promise.resolve(['Qa', 'Qb']);
      }
      if (qids.includes('Qa')) {
        return Promise.resolve(['Qc']);
      }
      return Promise.resolve([]);
    };
    const { classes, refused } = await boundedClosure(['Qpainting'], children);
    expect(classes.sort()).toEqual(['Qa', 'Qb', 'Qc', 'Qpainting']);
    expect(refused).toEqual([]);
  });

  it('refuses a hop that explodes, and keeps what it already had', async () => {
    // sculpture measured: 236 direct subclasses, then 142 870 at hop 2 (banknotes reached
    // through "work printed from a plate"). The root and hop 1 must survive.
    const hop1 = Array.from({ length: 236 }, (_, i) => `Qs${i}`);
    const hop2 = Array.from({ length: 142870 }, (_, i) => `Qx${i}`);
    const children = (qids: string[]) => {
      if (qids[0] === 'Qsculpture') {
        return Promise.resolve(hop1);
      }
      if (qids[0]?.startsWith('Qs')) {
        return Promise.resolve(hop2);
      }
      return Promise.resolve([]);
    };
    const { classes, refused } = await boundedClosure(['Qsculpture'], children);
    expect(classes).toHaveLength(237);
    expect(refused).toEqual([{ root: 'Qsculpture', hop: 2, offered: 142870 }]);
  });

  it('does not refuse hop 1 against a set of size one', async () => {
    // the floor exists because the first version compared growth to the set size, which is 1
    // at hop 1, so every root was refused and every closure collapsed to its bare root
    const children = (qids: string[]) => {
      if (qids[0] === 'Qroot') {
        return Promise.resolve(Array.from({ length: 109 }, (_, i) => `Qc${i}`));
      }
      return Promise.resolve([]);
    };
    const { classes } = await boundedClosure(['Qroot'], children);
    expect(classes).toHaveLength(110);
  });

  it('detects hoisted seen by refusal verdict', async () => {
    // With seen correctly reset per root, root B's hop-1 refusal depends on its own size.
    // With seen hoisted, root B's threshold inflates from root A's classes, changing the verdict.
    // Uses growthFloor: 1, maxGrowth: 10 so threshold is driven by seen.size, not the floor.
    const rootAHop1 = Array.from({ length: 9 }, (_, i) => `Qa${i}`);
    const rootBHop1 = Array.from({ length: 12 }, (_, i) => `Qb${i}`);

    const children = (qids: string[]) => {
      if (qids[0] === 'QrootA') {
        return Promise.resolve(rootAHop1);
      }
      if (qids[0] === 'QrootB') {
        return Promise.resolve(rootBHop1);
      }
      return Promise.resolve([]);
    };

    const { refused } = await boundedClosure(['QrootA', 'QrootB'], children, {
      growthFloor: 1,
      maxGrowth: 10,
    });

    // With seen per-root (correct): A passes (9 <= max(1,1)*10=10), B starts at size 1, threshold is
    // max(1,1)*10=10, 12 > 10, B refused at hop 1.
    // With seen hoisted (broken): A passes, but B sees size 10 (from A), threshold is max(10,1)*10=100,
    // 12 < 100, B not refused—the bug allows ontology explosion through.
    expect(refused).toEqual([{ root: 'QrootB', hop: 1, offered: 12 }]);
  });

  it('says which root each class was reached from', async () => {
    // The medium question — one original, or an edition — is answered against this and
    // nothing else. A label cannot answer it: "engraving" names a printmaking technique and
    // a kind of object with two different entities, and matching on the word picks whichever
    // the label service happened to return.
    const children = (qids: string[]) => {
      if (qids[0] === 'Qpainting') return Promise.resolve(['Qfresco']);
      if (qids[0] === 'Qprint') return Promise.resolve(['Qetching', 'Qlithograph']);
      return Promise.resolve([]);
    };

    const { byRoot } = await boundedClosure(['Qpainting', 'Qprint'], children);

    expect(byRoot.Qprint.sort()).toEqual(['Qetching', 'Qlithograph', 'Qprint']);
    expect(byRoot.Qpainting.sort()).toEqual(['Qfresco', 'Qpainting']);
    // Nothing under painting may answer yes to the edition question.
    expect(byRoot.Qprint).not.toContain('Qfresco');
  });

  it('records a class reached from two roots under both', async () => {
    // A shared descendant is not a tie to break here: the caller asks "is this an edition?",
    // and a class that is reachable from print is one whichever else also reaches it.
    const children = (qids: string[]) => (
      qids[0] === 'Qpainting' || qids[0] === 'Qprint'
        ? Promise.resolve(['Qshared'])
        : Promise.resolve([])
    );

    const { byRoot, classes } = await boundedClosure(['Qpainting', 'Qprint'], children);

    expect(byRoot.Qpainting).toContain('Qshared');
    expect(byRoot.Qprint).toContain('Qshared');
    expect(classes.filter((c) => c === 'Qshared')).toHaveLength(1);
  });

  it('scopes seen and frontier per root in multi-root closure', async () => {
    // painting grows sanely, sculpture explodes at hop 2.
    // Verifies per-root scoping of seen/frontier: if they were hoisted, the painting's
    // descendants would be rejected when sculpture's hop 2 is tested, or vice versa.
    const paintingHop1 = Array.from({ length: 3 }, (_, i) => `Qpaint${i}`);
    const paintingHop2 = ['Qpaint-leaf'];
    const sculptureHop1 = Array.from({ length: 5 }, (_, i) => `Qsculpt${i}`);
    const sculptureHop2 = Array.from({ length: 2000 }, (_, i) => `Qbad${i}`);

    const children = (qids: string[]) => {
      if (qids[0] === 'Qpainting') {
        return Promise.resolve(paintingHop1);
      }
      if (qids[0]?.startsWith('Qpaint')) {
        return Promise.resolve(paintingHop2);
      }
      if (qids[0] === 'Qsculpture') {
        return Promise.resolve(sculptureHop1);
      }
      if (qids[0]?.startsWith('Qsculpt')) {
        return Promise.resolve(sculptureHop2);
      }
      return Promise.resolve([]);
    };

    const { classes, refused } = await boundedClosure(['Qpainting', 'Qsculpture'], children);

    // Painting root + 3 hop-1 items + 1 hop-2 leaf = 5 total
    const paintingClasses = ['Qpainting', ...paintingHop1, ...paintingHop2];
    for (const cls of paintingClasses) {
      expect(classes).toContain(cls);
    }

    // Sculpture root + 5 hop-1 items only (hop 2 refused)
    const sculptureClasses = ['Qsculpture', ...sculptureHop1];
    for (const cls of sculptureClasses) {
      expect(classes).toContain(cls);
    }

    // Refused names only sculpture at hop 2
    expect(refused).toEqual([{ root: 'Qsculpture', hop: 2, offered: 2000 }]);
  });
});
