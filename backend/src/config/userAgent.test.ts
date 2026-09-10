import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { userAgent, isUsableContact } from './userAgent.js';

const PACKAGE_VERSION = (
  JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a literal path resolved against this module's own URL
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

// The variable can be set in the environment this suite inherits, which would
// decide the default-contact cases, and deleting it outright would decide them
// for whatever else runs in this worker afterwards.
const inheritedContact = process.env.USER_AGENT_CONTACT;

beforeEach(() => {
  delete process.env.USER_AGENT_CONTACT;
});

afterEach(() => {
  if (inheritedContact === undefined) delete process.env.USER_AGENT_CONTACT;
  else process.env.USER_AGENT_CONTACT = inheritedContact;
});

describe('userAgent', () => {
  it('publishes a contact a stranger can use, in the format Wikimedia states', () => {
    expect(userAgent()).toBe(`TrackYourRegions/${PACKAGE_VERSION} (https://uncovering.world; info@uncovering.world)`);
  });

  it('takes its version from the package rather than a literal', () => {
    // The old strings said 1.0 while the package said 1.0.0, and nothing moved
    // them together. Whatever the package says, the header says (#864).
    expect(userAgent()).toContain(`/${PACKAGE_VERSION} `);
  });

  it('carries "bot" for an unattended run, as the policy asks, and not otherwise', () => {
    expect(userAgent({ bot: true }).toLowerCase()).toContain('bot');
    expect(userAgent().toLowerCase()).not.toContain('bot');
    expect(userAgent({ bot: true })).toBe(`TrackYourRegionsBot/${PACKAGE_VERSION} (https://uncovering.world; info@uncovering.world)`);
  });

  it('names the purpose beside the contact, inside the parentheses', () => {
    expect(userAgent({ purpose: 'admin image proxy' })).toBe(
      `TrackYourRegions/${PACKAGE_VERSION} (https://uncovering.world; info@uncovering.world; admin image proxy)`,
    );
    expect(userAgent({ bot: true, purpose: 'region hierarchy extraction' })).toBe(
      `TrackYourRegionsBot/${PACKAGE_VERSION} (https://uncovering.world; info@uncovering.world; region hierarchy extraction)`,
    );
  });

  it('lets a deployment speak for itself through USER_AGENT_CONTACT', () => {
    process.env.USER_AGENT_CONTACT = 'https://fork.example; ops@fork.example';
    expect(userAgent({ purpose: 'admin image proxy' })).toBe(
      `TrackYourRegions/${PACKAGE_VERSION} (https://fork.example; ops@fork.example; admin image proxy)`,
    );
  });

  it('keeps a pasted newline from becoming a header no client will send', () => {
    process.env.USER_AGENT_CONTACT = 'https://fork.example\r\nX-Injected: 1';
    // The text survives, on one line: undici refuses a header value containing
    // CR or LF, so the alternative is every outbound call throwing.
    expect(userAgent()).toBe(`TrackYourRegions/${PACKAGE_VERSION} (https://fork.example X-Injected: 1)`);
  });

  it('falls back to the built-in contact rather than publishing an empty one', () => {
    process.env.USER_AGENT_CONTACT = '   ';
    expect(userAgent()).toContain('https://uncovering.world');
  });

  it('drops what no header may carry, instead of building one every fetch would throw on', () => {
    // An em dash is what a pasted contact carries, and undici answers it with
    // "character at index N has a value of 8212 which is greater than 255" —
    // for every outbound call, not just this one.
    process.env.USER_AGENT_CONTACT = 'https://fork.example \u2014 ops@fork.example';
    expect(userAgent()).toBe(`TrackYourRegions/${PACKAGE_VERSION} (https://fork.example ops@fork.example)`);
  });

  it('builds a header the runtime accepts, for every shape this module produces', () => {
    for (const value of ['\u2014\u2014\u2014', 'https://fork.example\r\nX-Injected: 1', 'ops@fork.example']) {
      process.env.USER_AGENT_CONTACT = value;
      for (const options of [{}, { bot: true }, { purpose: 'admin image proxy' }]) {
        expect(() => new Headers({ 'User-Agent': userAgent(options) })).not.toThrow();
      }
    }
  });

  it('keeps the built-in contact when the override is nothing a header can carry', () => {
    process.env.USER_AGENT_CONTACT = '\u2014\u2014\u2014';
    expect(userAgent()).toContain('https://uncovering.world');
  });
});

describe('isUsableContact', () => {
  it('accepts the three shapes the policy names', () => {
    expect(isUsableContact('https://uncovering.world; info@uncovering.world')).toBe(true);
    expect(isUsableContact('https://fork.example')).toBe(true);
    expect(isUsableContact('ops@fork.example')).toBe(true);
    expect(isUsableContact('(wikipedia:de; User:DuesenBot)')).toBe(true);
  });

  it('refuses what names no one reachable', () => {
    for (const value of ['', '   ', 'the maintainers', '@', 'https://']) {
      expect(isUsableContact(value)).toBe(false);
    }
  });

  it('refuses what a header cannot carry, however reachable it reads', () => {
    expect(isUsableContact('https://fork.example \u2014 ops@fork.example')).toBe(false);
    expect(isUsableContact('ops@fork.example\u0000')).toBe(false);
  });
});
