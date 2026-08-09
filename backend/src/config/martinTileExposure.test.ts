/**
 * Martin publishes what this file says it publishes, and nothing else.
 *
 * The guard lives in the backend's test suite rather than beside the config
 * because that suite is the one the pre-commit gate runs; `martin/config.yaml`
 * has no test runner of its own. The failure this catches is a future edit
 * turning table publication back on — either through `auto_publish.tables`,
 * or through an explicit `postgres.tables` source map, which publishes a
 * table directly and bypasses `auto_publish` entirely — which would silently
 * re-expose table sources, including every column of `experiences`, on a
 * public port.
 *
 * Parsed with the `yaml` package, not scanned as text. A hand-rolled
 * line/indentation reader used to sit here; it took the first `tables:` line
 * whose indentation looked deep enough, so a decoy nested one level further
 * in (`auto_publish: { functions: { tables: false }, tables: true }`) read
 * as the real key while the actual `auto_publish.tables` — `true` — went
 * unchecked. The same reader also rejected flow-style mappings
 * (`auto_publish: { tables: false, functions: true }`, the exact form this
 * repo's own docs use) as having no children at all. A real parser builds
 * the same tree Martin's own config loader builds, and this guard asserts on
 * a path in that tree (`parsed.postgres.auto_publish.tables`) instead of
 * "whichever line looked right" — neither failure mode survives that.
 *
 * `YAML.parse()`'s `uniqueKeys` option (on by default; passed explicitly
 * below because this guard's correctness leans on it) rejects a file with a
 * repeated key — e.g. two `auto_publish:` entries — the same way Martin
 * does: Martin (serde_yaml) refuses to start on such a file with `Unable to
 * parse config file /config.yaml: postgres: duplicate entry with key
 * "auto_publish"`, verified by running the real martin:0.14.2 image against
 * this project's database.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const CONFIG_PATH = fileURLToPath(new URL('../../../martin/config.yaml', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const configText = readFileSync(CONFIG_PATH, 'utf8');

interface MartinConfig {
  postgres?: {
    tables?: unknown;
    auto_publish?: {
      tables?: unknown;
      functions?: unknown;
    };
  };
}

// `uniqueKeys: true` is yaml's own default; named explicitly because this
// guard depends on it (see file docstring) rather than merely benefiting
// from it — a future default change upstream must not silently disarm this.
const config = parse(configText, { uniqueKeys: true }) as MartinConfig;

describe('Martin tile exposure', () => {
  it('does not auto-publish tables as tile sources', () => {
    // Strict equality, not truthiness: a quoted `tables: "false"` parses as
    // the string "false", not the boolean Martin's schema expects, and must
    // not read as "off" here.
    expect(config.postgres?.auto_publish?.tables).toBe(false);
  });

  it('does not publish a table through an explicit source map either', () => {
    // `postgres.tables: { experiences: {...} }` publishes a table directly
    // and is not governed by `auto_publish` at all, so the check above does
    // not by itself rule this out.
    expect(config.postgres?.tables).toBeUndefined();
  });

  it('still auto-publishes the functions the map draws from', () => {
    expect(config.postgres?.auto_publish?.functions).toBe(true);
  });
});
