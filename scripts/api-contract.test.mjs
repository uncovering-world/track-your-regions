import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  argumentsFor, assertTestStack, EXCLUDED, OUTSIDE, outsideArgumentsFor, outsideConfig, RUNS, SCHEMATHESIS,
} from './api-contract.mjs';
import { repoFile } from './repo-root.mjs';

const document = JSON.parse(readFileSync(repoFile('packages', 'shared', 'src', 'openapi.generated.json'), 'utf8'));
const operations = Object.values(document.paths).flatMap((methods) => Object.entries(methods)
  .map(([method, operation]) => ({
    method, id: operation.operationId, access: operation['x-access'],
    parameters: (operation.parameters ?? []).map((parameter) => `${parameter.in}.${parameter.name}`),
  })));

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

  it('keeps the traveller\'s and the curator\'s runs under the authenticated limit, which the environment cannot raise', () => {
    for (const caller of ['traveller', 'curator']) {
      const run = RUNS.find((one) => one.caller === caller);
      expect(argumentsFor(run, 'http://localhost:5301').join(' ')).toContain('--rate-limit 50/m');
    }
  });

  it('refuses anything but the test stack\'s own backend on this machine', () => {
    expect(() => assertTestStack('http://localhost:5301', '5301')).not.toThrow();
    // The dev backend, another local service, and the dev port even when a test port names it.
    expect(() => assertTestStack('http://localhost:3001', '5301')).toThrow(/Refusing/);
    expect(() => assertTestStack('http://localhost:8080', '5301')).toThrow(/Refusing/);
    expect(() => assertTestStack('http://localhost:3001', '3001')).toThrow(/Refusing/);
    expect(() => assertTestStack('https://example.org', '5301')).toThrow(/Refusing/);
  });

  describe('the routes that call a service outside the stack (#2428)', () => {
    it('are GET routes the document has, each read by a caller its access admits', () => {
      for (const [id, route] of Object.entries(OUTSIDE)) {
        const operation = operations.find((one) => one.id === id);
        expect(operation?.method, id).toBe('get');
        expect(RUNS.find((run) => run.caller === route.caller).access, id).toContain(operation.access);
      }
    });

    it('are left out of every generated run', () => {
      for (const run of RUNS) {
        const args = argumentsFor(run, 'http://localhost:5301').join(' ');
        for (const id of Object.keys(OUTSIDE)) expect(args).toContain(`--exclude-operation-id ${id}`);
      }
    });

    it('are read with every declared parameter fixed, optional ones too, so no generated value reaches the service', () => {
      for (const [id, route] of Object.entries(OUTSIDE)) {
        const fixed = Object.keys(route.parameters({ point: 1 }));
        expect(operations.find((one) => one.id === id).parameters.filter((name) => !fixed.includes(name)), id).toEqual([]);
      }
      expect(outsideConfig('curator', { point: 42 })).toContain('"path.locationId" = 42');
    });

    it("read an outside service's failure as the route's answer, and a 500 still as a server error", () => {
      const config = outsideConfig('curator', { point: 42 });
      expect(config).toContain('not_a_server_error.expected-statuses = ["2xx", "3xx", "4xx", 502, 503, 504]');
      expect(config).not.toMatch(/\b500\b/);
    });

    it('are requested once each, valid data only, with no phase that varies a request', () => {
      for (const caller of ['curator', 'admin']) {
        const args = outsideArgumentsFor(caller, 'http://localhost:5301').join(' ');
        expect(args).toContain('--phases fuzzing --mode positive --max-examples 1');
        expect(args).not.toMatch(/coverage|examples,|negative/);
        expect(args).toContain('--rate-limit 1/s');
        expect(args).toContain('--request-timeout 30 --max-response-time 30');
      }
    });
  });

  it('runs Schemathesis pinned by digest', () => {
    expect(SCHEMATHESIS).toMatch(/^schemathesis\/schemathesis:[\d.]+@sha256:[0-9a-f]{64}$/);
  });
});
