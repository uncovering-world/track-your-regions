import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/adr-issues.sh against a decisions directory of two ADRs and a `gh`
// that answers the list of open issues from a file, so the spec needs no network.
const script = join(dirname(fileURLToPath(import.meta.url)), 'adr-issues.sh');

const adr = (number, fields) => `# ADR-${number}: A title\n\n**Date:** 2026-11-16\n**Status:** Draft\n${fields}\n---\n\n## Context\n\nIt follows #77 and mentions #9 in passing.\n`;

describe('adr-issues.sh', () => {
  let dir;
  const run = (issues, ...args) => {
    writeFileSync(join(dir, 'issues.json'), JSON.stringify(issues));
    return spawnSync(script, args, {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(dir)}:${process.env.PATH}`, ADR_ISSUES_DIR: dir, GH_FAKE: join(dir, 'issues.json') },
    });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'adr-issues-'));
    writeFileSync(join(dir, 'gh'), '#!/usr/bin/env bash\n[[ -n "${GH_FAIL:-}" ]] && exit 1\ncat "$GH_FAKE"\n');
    chmodSync(join(dir, 'gh'), 0o755);
    // The field wraps over two lines and ends at the next field.
    writeFileSync(join(dir, '0001-with-a-field.md'), adr('0001', '**Issue:** #5\n**Built by:** #10, #11,\n#12\n**Narrows:** ADR-0000, as #99 asked\n'));
    writeFileSync(join(dir, '0002-without-a-field.md'), adr('0002', '**Issue:** #10\n'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const agreed = [
    { number: 10, body: '**Built to:** ADR-0001 decisions 1 to 3\r\n\r\n## Description' },
    { number: 11, body: 'A note first.\n**Built to:** ADR-0001 decision 2' },
    // #12 is closed, so it is not in the list and is asked nothing.
    { number: 99, body: 'It quotes ADR-0001 and is not built to it.' },
  ];

  it('passes when every open issue and every field name each other', () => {
    const result = run(agreed, 'check');
    expect(result.stdout).toContain('agree');
    expect(result.status).toBe(0);
  });

  it('fails on an open issue the field names whose body does not name the ADR', () => {
    const result = run([{ number: 10, body: '**Built to:** ADR-0001' }, { number: 11, body: 'Built to ADR-0001, said in prose.' }], 'check');
    expect(result.stdout).toContain("ADR-0001 names #11, and #11's body does not name ADR-0001");
    expect(result.stdout).not.toContain('#10,');
    expect(result.status).toBe(1);
  });

  it('fails on an issue whose line names an ADR that does not name it back', () => {
    const result = run([...agreed, { number: 13, body: '**Built to:** ADR-0001 decision 1; ADR-0002; ADR-0003' }], 'check');
    expect(result.stdout).toContain("#13 names ADR-0001, and ADR-0001's Built by field does not name #13");
    expect(result.stdout).toContain('#13 names ADR-0002, and ADR-0002 has no Built by field');
    expect(result.stdout).toContain('#13 names ADR-0003, and docs/decisions/ holds no ADR-0003');
    expect(result.stdout).toContain('3 mismatch(es)');
    expect(result.status).toBe(1);
  });

  it('refuses a zero-padded issue number, which would match no key GitHub sends', () => {
    expect(run(agreed, 'check', '#010').status).not.toBe(0);
    expect(run(agreed, 'for', '010').status).not.toBe(0);
    expect(run(agreed, 'for', '#10').stdout).toContain('ADR-0001');
  });

  it('counts only the mismatches that involve an argument', () => {
    const issues = [{ number: 10, body: '' }, { number: 11, body: '' }];
    expect(run(issues, 'check', '#10').stdout).toContain('1 mismatch(es)');
    expect(run(issues, 'check', 'ADR-0001').stdout).toContain('2 mismatch(es)');
    expect(run(issues, 'check', 'ADR-0002').status).toBe(0);
  });

  it('exits 2, never 0, when the issues could not be read', () => {
    writeFileSync(join(dir, 'issues.json'), '[]');
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, ADR_ISSUES_DIR: dir, GH_FAKE: join(dir, 'issues.json') };
    expect(spawnSync(script, ['check'], { encoding: 'utf8', env }).status).toBe(2);
    expect(spawnSync(script, ['check'], { encoding: 'utf8', env: { ...env, GH_FAIL: '1' } }).status).toBe(2);
  });

  it('tells the ADR an issue is built to from one that only mentions it, with each Status', () => {
    const out = execFileSync(script, ['for', '10', '9'], { encoding: 'utf8', env: { ...process.env, ADR_ISSUES_DIR: dir } });
    expect(out).toMatch(/#10 is built to:\n {2}ADR-0001 {2}Status: Draft/);
    expect(out).toMatch(/#10 is mentioned, and not named as built to it, by:\n {2}ADR-0002 {2}\(no Built by field yet\)/);
    expect(out).toMatch(/#9 is built to:\n {2}no ADR's Built by field names it/);
    // #99 stands in the next field of ADR-0001, not in Built by.
    expect(execFileSync(script, ['for', '99'], { encoding: 'utf8', env: { ...process.env, ADR_ISSUES_DIR: dir } })).toContain("no ADR's Built by field names it");
  });
});
