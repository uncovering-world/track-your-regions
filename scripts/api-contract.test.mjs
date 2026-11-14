import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  argumentsFor, assertTestStack, configFor, CREDENTIAL_VARIABLES, EXCLUDED, operationsFor, OUTSIDE, outsideArgumentsFor,
  outsideConfig, PARTS, planFor, reportFailure, RUNS, SCHEMATHESIS, shardsOf, SHARED_PART,
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

  it('runs reads only: every write method is excluded, and the run\'s operations included by id', () => {
    const args = argumentsFor(RUNS[0], 'http://localhost:5301', ['getHealth', 'getWorldViews']);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(args.join(' ')).toContain(`--exclude-method ${method}`);
    }
    expect(args.join(' ')).toContain('--include-operation-id getHealth --include-operation-id getWorldViews');
    // Schemathesis keeps only the last of several --include-by, which once left
    // the public routes out of the anonymous run while it named both levels.
    expect(args).not.toContain('--include-by');
  });

  it('keeps the traveller\'s and the curator\'s runs under the authenticated limit, which the environment cannot raise', () => {
    for (const caller of ['traveller', 'curator']) {
      const run = RUNS.find((one) => one.caller === caller);
      expect(argumentsFor(run, 'http://localhost:5301', ['getAuthMe']).join(' ')).toContain('--rate-limit 50/m');
    }
  });

  describe('the parts, one CI job each (#2513)', () => {
    const plans = PARTS.map((part) => planFor(part, document));
    const read = plans.flatMap((plan) => plan.runs.flatMap(({ run, ids }) => ids.map((id) => `${run.caller} ${id}`)));

    it('read every GET operation of each run\'s levels exactly once, the ones left out by name aside', () => {
      const expected = RUNS.flatMap((run) => operations
        .filter((one) => one.method === 'get' && run.access.includes(one.access) && !EXCLUDED[one.id] && !OUTSIDE[one.id])
        .map((one) => `${run.caller} ${one.id}`));
      expect(read.sort()).toEqual(expected.sort());
      expect(new Set(read).size).toBe(read.length);
    });

    it('cut the curator\'s routes into shards of about equal weight, every shard reading some', () => {
      const curator = RUNS.find((run) => run.caller === 'curator');
      const weights = operationsFor(curator, document);
      const totals = shardsOf(weights, curator.shards)
        .map((ids) => ids.reduce((sum, id) => sum + weights.find((one) => one.id === id).weight, 0));
      expect(totals).toHaveLength(curator.shards);
      expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(Math.max(...weights.map((one) => one.weight)));
      expect(shardsOf([{ id: 'b', weight: 3 }, { id: 'a', weight: 3 }, { id: 'c', weight: 1 }], 2)).toEqual([['a', 'c'], ['b']]);
    });

    it('give the outside runs to the shared part alone', () => {
      expect(plans.filter((plan) => plan.outside)).toEqual([planFor(SHARED_PART, document)]);
      expect(SHARED_PART).toBe('anonymous-traveller-admin');
    });

    it('refuse a part that does not exist, and a shard with nothing to read, which Schemathesis would read as everything', () => {
      expect(() => planFor('curator-4-of-3', document)).toThrow(/No API contract part/);
      expect(() => planFor('curator-1-of-3', { paths: {} })).toThrow(/no operation to read/);
    });

    it('are the matrix of the api-contract job in ci.yml, so each part is a check a pull request shows', () => {
      const workflow = parse(readFileSync(repoFile('.github', 'workflows', 'ci.yml'), 'utf8'));
      const job = workflow.jobs['api-contract'];
      expect(job.strategy.matrix.part).toEqual(PARTS);
      expect(job.strategy['fail-fast']).toBe(false);
      expect(job.name).toBe('API Contract (${{ matrix.part }})');
    });
  });

  describe('a signed-in run\'s token (#2513)', () => {
    it('is fetched by Schemathesis itself, signing in as the caller, never handed over as a header that expires', () => {
      for (const run of RUNS.filter((one) => one.caller !== 'anonymous')) {
        const config = configFor(run.caller);
        expect(config).toContain('[auth.dynamic.openapi.bearer]\npath = "/api/auth/login"');
        expect(config).toContain('extract_selector = "/accessToken"');
        expect(argumentsFor(run, 'http://localhost:5301', ['getAuthMe'])).not.toContain('-H');
      }
      expect(configFor('anonymous')).not.toContain('[auth');
    });

    it('signs in with credentials read from the environment, so no password sits on a command line', () => {
      const config = configFor('curator');
      expect(config).toContain(`email = "\${${CREDENTIAL_VARIABLES.email}}"`);
      expect(config).toContain(`password = "\${${CREDENTIAL_VARIABLES.password}}"`);
      expect(config).not.toMatch(/e2e-curator-password|@e2e\.test/);
    });

    it('fails every run, the outside ones too, on an operation that answered only 401 or 403', () => {
      for (const run of RUNS) expect(configFor(run.caller)).toContain('[warnings]\nfail-on = ["missing_auth"]');
      expect(configFor('curator', outsideConfig('curator', { point: 42 }))).toContain('fail-on = ["missing_auth"]');
      for (const args of [argumentsFor(RUNS[2], 'http://localhost:5301', ['getAuthMe']), outsideArgumentsFor('admin', 'http://localhost:5301')]) {
        expect(args.slice(0, 2)).toEqual(['--config-file', '/config/schemathesis.toml']);
        expect(args.join(' ')).toContain('--report json --report-json-path /report/report.json');
      }
    });

    it('fails a run whose signing in stopped working mid-run, which Schemathesis only reports', () => {
      expect(reportFailure({ auth: { reauth_count: 3, reauth_broke: true } })).toMatch(/stopped working/);
      expect(reportFailure({ auth: { reauth_count: 1, reauth_broke: false } })).toBeNull();
    });

    it('fails a run that wrote no JSON report, rather than reading the missing file as a pass', () => {
      expect(reportFailure(undefined)).toMatch(/wrote no JSON report/);
    });

    it('fails a run whose report does not say whether signing in held, as after a change of its format', () => {
      for (const report of [null, {}, { auth: {} }, { auth: { reauth_broke: 'false' } }, { reauth_broke: false }]) {
        expect(reportFailure(report), JSON.stringify(report)).toMatch(/does not say whether signing in held/);
      }
    });
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
      for (const plan of PARTS.map((part) => planFor(part, document))) {
        for (const { run, ids } of plan.runs) {
          for (const id of Object.keys(OUTSIDE)) expect(ids).not.toContain(id);
          const args = argumentsFor(run, 'http://localhost:5301', ids).join(' ');
          for (const id of Object.keys(OUTSIDE)) expect(args).toContain(`--exclude-operation-id ${id}`);
        }
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
