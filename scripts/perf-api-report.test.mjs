import { describe, expect, it } from 'vitest';
import {
  failureLines, failureReason, originOf, parseArgs, percentile, rootsWithoutGeometry, rootsWithoutGeometrySentence,
} from './perf-api-report.mjs';

/** Two roots of world view 5 as the root-regions read answers them, trimmed to what the check reads. */
const AFRICA = { id: 4310, name: 'Africa', focusBbox: [-40.36, -34.84, 63.5, 37.56] };
const EUROPE_WITHOUT_GEOMETRY = { id: 6737, name: 'Europe', focusBbox: null };

describe('the probe\'s precondition', () => {
  it('names the root regions that have no geometry, and only those', () => {
    expect(rootsWithoutGeometry([AFRICA, EUROPE_WITHOUT_GEOMETRY])).toEqual([{ id: 6737, name: 'Europe' }]);
    expect(rootsWithoutGeometry([AFRICA])).toEqual([]);
  });

  it('says which region, of which world view, and why its tile answers 204', () => {
    const sentence = rootsWithoutGeometrySentence('5', [{ id: 6737, name: 'Europe' }]);
    expect(sentence).toMatch(/^World view 5 has root regions with no geometry: Europe \(6737\)\./);
    expect(sentence).toMatch(/ADR-0035/);
    expect(sentence).toMatch(/answers 204/);
  });
});

describe('the probe\'s failures', () => {
  it('tells an empty tile from an endpoint that did not answer or answered otherwise', () => {
    expect(failureReason(204)).toBe('an empty tile (204)');
    expect(failureReason(0)).toBe('no answer (timed out or refused)');
    expect(failureReason(404)).toBe('answered 404');
  });

  it('lists every endpoint that failed, with its reason, and none that did not', () => {
    const results = [
      { name: 'tile: world view root regions z3', status: 200, failures: 0 },
      { name: 'tile: world view root regions z5', status: 204, failures: 31 },
      { name: 'experience counts per region', status: 404, failures: 31 },
    ];
    expect(failureLines(results)).toEqual([
      '  tile: world view root regions z5: an empty tile (204)',
      '  experience counts per region: answered 404',
    ]);
  });
});

describe("the probe's percentiles (#655)", () => {
  it('interpolates between ranks, so p95 of thirty samples is not the maximum', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(percentile(thirty, 50)).toBe(15.5);
    expect(percentile(thirty, 95)).toBeCloseTo(28.55, 10);
    expect(percentile(thirty, 95)).toBeLessThan(30);
  });

  it('answers the one sample for any rank, and nothing for none', () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("the probe's arguments (#655)", () => {
  it('reads every option that takes a value, and --json alone', () => {
    expect(parseArgs(['--api', 'http://localhost:3001', '--runs', '5', '--json', '--world-view', '7']))
      .toEqual({ api: 'http://localhost:3001', runs: '5', json: true, 'world-view': '7' });
  });

  it('refuses an unknown argument by its position, never echoing it', () => {
    expect(() => parseArgs(['--token', 'secret'])).toThrow(/^Unexpected argument at position 1;/);
    expect(() => parseArgs(['--token', 'secret'])).not.toThrow(/secret|token/);
  });

  it('refuses an option left without its value', () => {
    expect(() => parseArgs(['--runs'])).toThrow('--runs needs a value');
    expect(() => parseArgs(['--api', '--json'])).toThrow('--api needs a value');
  });

  it('keeps only the origin of a URL, and names the flag, not the value, when it is not one', () => {
    expect(originOf('http://user:pw@localhost:3001/api?x=1', '--api')).toBe('http://localhost:3001');
    expect(() => originOf('not a url', '--martin')).toThrow('--martin must be a URL');
  });
});
