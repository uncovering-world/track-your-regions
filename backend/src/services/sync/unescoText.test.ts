import { describe, expect, it } from 'vitest';
import { feedText } from './unescoText.js';

/**
 * The World Heritage feed's names, as the development catalogue held them on
 * 2026-10-18, read as plain text (#1610).
 */
describe('a World Heritage name read as plain text', () => {
  it('drops the italics the feed marks a foreign term with', () => {
    expect(feedText('Via Appia. <em>Regina Viarum</em>')).toBe('Via Appia. Regina Viarum');
    expect(feedText('<I>Sacri Monti</I> of Piedmont and Lombardy')).toBe('Sacri Monti of Piedmont and Lombardy');
    expect(feedText('Cultural Landscape of Bali Province: the <em>Subak</em> System as a Manifestation of the <em>Tri Hita Karana</em> Philosophy'))
      .toBe('Cultural Landscape of Bali Province: the Subak System as a Manifestation of the Tri Hita Karana Philosophy');
  });

  it('keeps the space a tag sat on, and adds none where there was none', () => {
    expect(feedText('Genoa: <i>Le Strade Nuove</i> and the system of the<i> Palazzi dei Rolli</i>'))
      .toBe('Genoa: Le Strade Nuove and the system of the Palazzi dei Rolli');
    expect(feedText('Ivrée, cité industrielle du XX<sup>e</sup> siècle')).toBe('Ivrée, cité industrielle du XXe siècle');
  });

  it('reads a line break as a space', () => {
    expect(feedText('Auschwitz Birkenau <br /><small>German Nazi Concentration and Extermination Camp (1940-1945)</small>'))
      .toBe('Auschwitz Birkenau German Nazi Concentration and Extermination Camp (1940-1945)');
  });

  it('reads an underline as the macron below the letter, composed where Unicode has the letter', () => {
    expect(feedText('S<U>G</U>ang Gwaay')).toBe('SG̱ang Gwaay');
    expect(feedText('Ulu<U>r</U>u-Kata Tju<U>t</U>a National Park')).toBe('Uluṟu-Kata Tjuṯa National Park');
  });

  it('leaves a plain name as it is', () => {
    expect(feedText('Hallstatt-Dachstein / Salzkammergut Cultural Landscape')).toBe('Hallstatt-Dachstein / Salzkammergut Cultural Landscape');
    expect(feedText('Fort < 5 km')).toBe('Fort < 5 km');
  });

  it('drops a tag that dropping another one puts together', () => {
    expect(feedText('Bad <scr<em>ipt>name')).toBe('Bad name');
  });
});
