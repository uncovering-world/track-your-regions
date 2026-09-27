import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { argumentsFor, assertTestStack, EXCLUDED, RUNS, SCHEMATHESIS } from './api-contract.mjs';
import { repoFile } from './repo-root.mjs';

const document = JSON.parse(readFileSync(repoFile('packages', 'shared', 'src', 'openapi.generated.json'), 'utf8'));
const operations = Object.values(document.paths).flatMap((methods) => Object.entries(methods)
  .map(([method, operation]) => ({ method, id: operation.operationId, access: operation['x-access'] })));

describe('the API contract lane', () => {
  it('leaves out only operations the document has, so a renamed path cannot quietly let one back in', () => {
    const ids = new Set(operations.map((operation) => operation.id));
    expect(Object.keys(EXCLUDED).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(EXCLUDED).every((id) => operations.find((o) => o.id === id).method === 'get')).toBe(true);
  });

  it('gives every declared access level to exactly one run', () => {
    const levels = new Set(operations.map((operation) => operation.access));
    expect(RUNS.flatMap((run) => run.access).sort()).toEqual([...levels].sort());
  });

  it('runs reads only: every write method is excluded, and the run\'s levels included', () => {
    const args = argumentsFor(RUNS[0], 'http://localhost:5301');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(args.join(' ')).toContain(`--exclude-method ${method}`);
    }
    expect(args).toContain('/x-access == "public"');
    expect(args).toContain('/x-access == "optional"');
  });

  it('keeps the traveller\'s run under the authenticated limit, which the environment cannot raise', () => {
    const traveller = RUNS.find((run) => run.caller === 'traveller');
    expect(argumentsFor(traveller, 'http://localhost:5301').join(' ')).toContain('--rate-limit 50/m');
  });

  it('refuses anything but the test stack\'s own backend on this machine', () => {
    expect(() => assertTestStack('http://localhost:5301', '5301')).not.toThrow();
    // The dev backend, another local service, and the dev port even when a test port names it.
    expect(() => assertTestStack('http://localhost:3001', '5301')).toThrow(/Refusing/);
    expect(() => assertTestStack('http://localhost:8080', '5301')).toThrow(/Refusing/);
    expect(() => assertTestStack('http://localhost:3001', '3001')).toThrow(/Refusing/);
    expect(() => assertTestStack('https://example.org', '5301')).toThrow(/Refusing/);
  });

  it('runs Schemathesis pinned by digest', () => {
    expect(SCHEMATHESIS).toMatch(/^schemathesis\/schemathesis:[\d.]+@sha256:[0-9a-f]{64}$/);
  });
});
