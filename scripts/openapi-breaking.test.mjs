import { describe, expect, it } from 'vitest';
import { annotation, countFindings, exitCodeFor, OASDIFF, uncompared } from './openapi-breaking.mjs';

/** Two of oasdiff's findings as its JSON format writes them, trimmed to what the counts read. */
const REMOVED_PATH = { id: 'api-path-removed-without-deprecation', level: 3, path: '/api/geocode/search' };
const NEW_ENUM_VALUE = { id: 'response-property-enum-value-added', level: 2, path: '/api/experiences' };

describe('the OpenAPI breaking-change check', () => {
  it('counts a certain break apart from a possible one', () => {
    expect(countFindings([REMOVED_PATH, NEW_ENUM_VALUE, REMOVED_PATH])).toEqual({ breaking: 2, possible: 1 });
    expect(countFindings([])).toEqual({ breaking: 0, possible: 0 });
  });

  it('warns without failing while the policy is warn, and fails a break once it is fail', () => {
    expect(exitCodeFor('warn', 3)).toBe(0);
    expect(exitCodeFor('fail', 0)).toBe(0);
    expect(exitCodeFor('fail', 1)).toBe(1);
  });

  it('annotates the run where anything turned up, a break at the level the policy asks for', () => {
    expect(annotation({ breaking: 0, possible: 0 }, 'warn')).toBeNull();
    expect(annotation({ breaking: 1, possible: 0 }, 'warn')).toMatch(/^::warning title=OpenAPI contract::1 change breaks a client/);
    expect(annotation({ breaking: 2, possible: 1 }, 'fail'))
      .toMatch(/^::error title=OpenAPI contract::2 changes break a client built against the base document, and 1 more may/);
  });

  it('annotates a possible break alone as a warning, whatever the policy', () => {
    expect(annotation({ breaking: 0, possible: 3 }, 'fail')).toMatch(/^::warning title=OpenAPI contract::3 changes may break a client/);
  });

  it('never passes silently when it could not compare, and earns what a break would', () => {
    const shallow = 'No merge base between origin/main and HEAD';
    expect(uncompared(shallow, 'warn')).toEqual({
      line: `::warning title=OpenAPI contract::The OpenAPI document was not compared with a base: ${shallow}`,
      code: 0,
    });
    expect(uncompared(shallow, 'fail').code).toBe(1);
    expect(uncompared(shallow, 'fail').line).toMatch(/^::error /);
  });

  it('runs oasdiff pinned by digest, as the other Docker tools are', () => {
    expect(OASDIFF).toMatch(/^tufin\/oasdiff:v[\d.]+@sha256:[0-9a-f]{64}$/);
  });
});
