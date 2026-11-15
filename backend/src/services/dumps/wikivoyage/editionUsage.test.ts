import { describe, expect, it } from 'vitest';
import { EditionUsage, guideTitle, type PageRow } from './editionUsage.js';

/**
 * What one Wikivoyage edition's guide uses (#1768, #2520), on rows shaped as
 * the 2026-10-01 `page` and `wbc_entity_usage` tables write them. English
 * Wikivoyage's Bath article uses the Roman Baths for its coordinates and for
 * its picture, and Somerset's article lists them too; a user's draft uses
 * Stapleton International Airport. The edition's witness is the Roman Baths
 * once, and both articles stand behind it.
 */

const BATHS = 'Q2540426';
const STAPLETON = 'Q1436575';
const page = (id: number, title: string, namespace = 0, isRedirect = 0): PageRow => ({ id, namespace, title, isRedirect });

describe('guideTitle (#1768, #2520)', () => {
  it("reads a guide article's title as a reader reads it", () => {
    expect(guideTitle('enwikivoyage', page(17, 'Bath'))).toBe('Bath');
    expect(guideTitle('ruwikivoyage', page(6, 'Старый_Брест'))).toBe('Старый Брест');
  });

  it('leaves out a page outside the articles, a redirect and a heritage register', () => {
    expect(guideTitle('enwikivoyage', page(90, 'Someone/Denver', 2))).toBeNull();
    expect(guideTitle('enwikivoyage', page(91, 'Wikivoyage:Travellers%27_pub', 4))).toBeNull();
    expect(guideTitle('ruwikivoyage', page(6, 'Старый_Брест', 0, 1))).toBeNull();
    expect(guideTitle('ruwikivoyage', page(5, 'Культурное_наследие_Беларуси/Брестская_область'))).toBeNull();
    expect(guideTitle('ukwikivoyage', page(7, 'Культурна_спадщина_України'))).toBeNull();
    // A register's root is an edition's own: German Wikivoyage keeps no such list.
    expect(guideTitle('dewikivoyage', page(8, 'Культурное_наследие_Беларуси'))).toBe('Культурное наследие Беларуси');
  });

  it('leaves out a row with no id or no title', () => {
    expect(guideTitle('enwikivoyage', { id: null, namespace: 0, title: 'Bath', isRedirect: 0 })).toBeNull();
    expect(guideTitle('enwikivoyage', { id: 17, namespace: 0, title: null, isRedirect: 0 })).toBeNull();
  });
});

describe('EditionUsage (#2520)', () => {
  const articles = new Map([[17, 'Bath'], [18, 'Somerset'], [19, 'Bristol']]);

  it('keeps an article that uses an item over several aspects once', () => {
    const usage = new EditionUsage(articles);
    usage.add(BATHS, 17);
    usage.add(BATHS, 17);
    usage.add(BATHS, 17);
    expect(usage.items()).toEqual([BATHS]);
    expect([...usage.articleRows()]).toEqual([{ item: BATHS, pageId: 17, title: 'Bath' }]);
  });

  it('keeps every article of the edition that uses an item, and the item once', () => {
    const usage = new EditionUsage(articles);
    for (const pageId of [17, 18, 17, 19]) usage.add(BATHS, pageId);
    expect(usage.items()).toEqual([BATHS]);
    expect([...usage.articleRows()]).toEqual([
      { item: BATHS, pageId: 17, title: 'Bath' },
      { item: BATHS, pageId: 18, title: 'Somerset' },
      { item: BATHS, pageId: 19, title: 'Bristol' },
    ]);
  });

  it('keeps no property, no lexeme and no page that is no guide article', () => {
    const usage = new EditionUsage(articles);
    usage.add('P1082', 17);
    usage.add('L7', 17);
    usage.add(STAPLETON, 90);
    usage.add(null, 17);
    usage.add(BATHS, null);
    expect(usage.items()).toEqual([]);
    expect([...usage.articleRows()]).toEqual([]);
  });

  it('keeps each item its articles use, once each', () => {
    const usage = new EditionUsage(articles);
    usage.add(BATHS, 17);
    usage.add(STAPLETON, 19);
    usage.add(BATHS, 18);
    expect(usage.items()).toEqual([BATHS, STAPLETON]);
    expect([...usage.articleRows()].map(row => [row.item, row.pageId])).toEqual([[BATHS, 17], [BATHS, 18], [STAPLETON, 19]]);
  });
});
