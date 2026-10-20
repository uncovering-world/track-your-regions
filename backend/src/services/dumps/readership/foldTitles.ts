/**
 * The titles a month stages under the floor (#1702, ADR-0055 decision 2): a
 * redirect readership folds, and the article it folds into. A work read
 * through many rare spellings, each under 10 views, still reads them all, since
 * the floor is applied once they are summed (`keepMonth`, `readershipMonth.ts`).
 *
 * Every redirect the local subset keeps and every article one points to is
 * held as a 32-bit hash of its site and title, sorted, so the set costs four
 * bytes a title rather than the title itself. A hash says "maybe": a title that
 * collides with one in the set is staged for nothing, and the month's SQL
 * joins on the title, so it is never counted. A title in the set always
 * answers yes.
 */

/** FNV-1a over the site, a tab and the title, as UTF-16 code units. */
export function titleHash(site: string, title: string): number {
  let hash = 0x811c9dc5;
  const mix = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  };
  mix(site);
  mix('\t');
  mix(title);
  return hash >>> 0;
}

export class FoldTitles {
  private constructor(private readonly hashes: Uint32Array) {}

  /**
   * The set of the hashes in `hashes`, which it sorts in place; duplicates are
   * dropped. The kept range is copied out, so the larger buffer, every
   * redirect's two hashes, is not held for the build.
   */
  static ofHashes(hashes: Uint32Array): FoldTitles {
    hashes.sort();
    let kept = 0;
    for (let i = 0; i < hashes.length; i++) {
      if (i === 0 || hashes[i] !== hashes[kept - 1]) hashes[kept++] = hashes[i];
    }
    return new FoldTitles(hashes.slice(0, kept));
  }

  static of(titles: Iterable<{ site: string; title: string }>): FoldTitles {
    return FoldTitles.ofHashes(Uint32Array.from(titles, t => titleHash(t.site, t.title)));
  }

  get size(): number {
    return this.hashes.length;
  }

  has(site: string, title: string): boolean {
    const wanted = titleHash(site, title);
    let low = 0;
    let high = this.hashes.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const at = this.hashes[middle];
      if (at === wanted) return true;
      if (at < wanted) low = middle + 1;
      else high = middle - 1;
    }
    return false;
  }
}
