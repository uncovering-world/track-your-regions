import { describe, expect, it } from 'vitest';
import { arrayItemOf, storableJson, storableText } from './compactEntity.js';
import { termsOf } from './labelsRing.js';

/**
 * What the subset keeps is what Postgres can store: no NUL in `text` or
 * `jsonb`, no surrogate without its partner in `jsonb`. The dump holds both;
 * an Arabic label ending in a NUL stopped the first full build of the
 * 2026-10-05 dump.
 */

describe('a string the subset keeps', () => {
  it('drops a NUL and replaces a lone surrogate, and leaves a pair and everything else alone', () => {
    expect(storableText('الرسومات المرئية (علوم الكمبيوتر)\0')).toBe('الرسومات المرئية (علوم الكمبيوتر)');
    expect(storableText('Palazzo \uD800del Louvre')).toBe('Palazzo \uFFFDdel Louvre');
    expect(storableText('end \uDC00')).toBe('end \uFFFD');
    expect(storableText('Louvre 🖼')).toBe('Louvre 🖼');
  });

  it('cleans every string of an entity JSON that holds one, and passes the rest through as it is', () => {
    const clean = JSON.stringify({ id: 'Q19675', labels: { en: 'Louvre Palace' } });
    expect(storableJson(clean)).toBe(clean);
    const dirty = JSON.stringify({ id: 'Q19675', labels: { ar: 'متحف\0', it: 'Palazzo \uD800' }, claims: { P1448: [{ value: { text: 'x\0' } }] } });
    expect(JSON.parse(storableJson(dirty))).toEqual({ id: 'Q19675', labels: { ar: 'متحف', it: 'Palazzo \uFFFD' }, claims: { P1448: [{ value: { text: 'x' } }] } });
    expect(storableJson(dirty)).not.toMatch(/\\u0000|\\ud8/i);
  });

  it('cleans a key as well as a value', () => {
    const dirty = JSON.stringify({ id: 'Q1', sitelinks: { 'x\0wiki': 'Title\0', [`${'\uD800'}wiki`]: 'T' } });
    expect(JSON.parse(storableJson(dirty))).toEqual({ id: 'Q1', sitelinks: { xwiki: 'Title', '\uFFFDwiki': 'T' } });
  });

  it('keeps a backslash written before "u0000" as text, which only looks like an escape', () => {
    const literal = JSON.stringify({ en: 'C:\\u0000 is a path' });
    expect(JSON.parse(storableJson(literal))).toEqual({ en: 'C:\\u0000 is a path' });
  });

  it('spools a label or description as Postgres can store it', () => {
    const line = `{"type":"item","id":"Q42","labels":{"en":{"language":"en","value":${JSON.stringify('Douglas\0 Adams')}}},`
      + `"descriptions":{"en":{"language":"en","value":${JSON.stringify('writer \uD800')}}},"aliases":{}}`;
    expect(termsOf('Q42', line)).toEqual({ id: 'Q42', terms: { en: ['Douglas Adams', 'writer \uFFFD'] } });
  });

  it('quotes an entity as an element of a Postgres array literal, its backslashes and quotes escaped', () => {
    expect(arrayItemOf('{"en":"Caf\\u00e9 \\"Le Dôme\\""}')).toBe('"{\\"en\\":\\"Caf\\\\u00e9 \\\\\\"Le Dôme\\\\\\"\\"}"');
  });
});
