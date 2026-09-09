/**
 * Judges one Lighthouse report against the budgets in lighthouse-budgets.json.
 *
 * The budget syntax is Lighthouse CI's, so anyone who has read a
 * lighthouserc.json reads this one: `"<key>": ["<level>", { <threshold> }]`
 * where level is "error" (fails the lane), "warn" (reported, never fails) or
 * "off", and the key is one of
 *
 *   categories:<id>                       minScore against the category score
 *   resource-summary:<type>:size|count    maxNumericValue in bytes / requests,
 *                                         against the resource-summary audit's
 *                                         row for that type (script, total, ...)
 *   <audit id>                            maxNumericValue against numericValue
 *                                         (ms for timings, unitless for CLS),
 *                                         or minScore against the audit score
 *
 * Only what the lane uses is implemented; a key of another shape, a
 * threshold the key does not take, or an audit the report does not carry,
 * fails the assertion rather than passing it quietly - a budget that cannot
 * be read is not a budget that was met.
 *
 * The result rows keep Lighthouse CI's assertion-results.json field names,
 * which scripts/lighthouse-summary.mjs prints.
 */

const RESOURCE_SUMMARY_FIELDS = { count: 'requestCount', size: 'transferSize' };
const LEVELS = new Set(['error', 'warn', 'off']);

/**
 * Refuses a budgets block that could not gate: no budgets at all, a level
 * that is not one of the three (a mistyped "eror" would be measured,
 * breached and counted as a pass by everything downstream, since only the
 * literal "error" fails the lane), or a threshold that is neither
 * maxNumericValue nor minScore. Run before the browser is launched so a
 * broken file costs a second, not a lane.
 */
export function validateAssertions(assertions) {
  if (!assertions || typeof assertions !== 'object' || Array.isArray(assertions) || Object.keys(assertions).length === 0) {
    throw new Error('budgets have no "assertions" object with at least one entry');
  }
  for (const [key, spec] of Object.entries(assertions)) {
    const [level, options] = Array.isArray(spec) ? spec : [spec, {}];
    if (!LEVELS.has(level)) {
      throw new Error(`budget "${key}": level must be "error", "warn" or "off", got ${JSON.stringify(level)}`);
    }
    if (level === 'off') {
      continue;
    }
    const thresholds = options && typeof options === 'object' ? options : {};
    const hasMax = Number.isFinite(thresholds.maxNumericValue);
    const hasMin = Number.isFinite(thresholds.minScore);
    // Exactly one: with both present resolveCheck would take maxNumericValue
    // and the minScore would be a number nobody checks.
    if (hasMax === hasMin) {
      throw new Error(`budget "${key}": needs exactly one numeric threshold, maxNumericValue or minScore`);
    }
  }
}

export function evaluateAssertions(lhr, assertions, url) {
  const results = [];
  for (const [key, spec] of Object.entries(assertions)) {
    const [level, options] = Array.isArray(spec) ? spec : [spec, {}];
    if (level === 'off') {
      continue;
    }
    const check = resolveCheck(options ?? {});
    const target = resolveTarget(lhr, key, check);
    const actual = target.value;
    const passed =
      Number.isFinite(actual) &&
      (check.operator === '<=' ? actual <= check.expected : actual >= check.expected);
    results.push({
      url,
      auditId: target.auditId,
      auditProperty: target.auditProperty,
      level,
      name: check.name,
      operator: check.operator,
      expected: check.expected,
      actual,
      passed,
      message: target.message,
    });
  }
  return results;
}

/**
 * A budget that did not pass and is not a warning. Anything but the literal
 * "warn" counts - validateAssertions keeps unknown levels out of the file,
 * and this keeps one from ever reading as a pass if it got in anyway.
 */
export function hasFailures(results) {
  return results.some((r) => r.level !== 'warn' && !r.passed);
}

/**
 * The pages a budgets file names, each with the requests its representative
 * run must have made — as `{ url, expects }`, every string already put
 * through `fill` (the runner's placeholder substitution).
 *
 * A `urls` entry is a string, or `{ url, expectRequestMatching }` for a page
 * that must have asked for something of its own. `expectRequestMatching` at
 * the top level applies to every page; either takes a string or an array.
 * The two lists join, so a page's own fragment adds to the shared one rather
 * than replacing it.
 *
 * The page-level form exists for the map: its regions are vector tiles that
 * a worker parses, and a build in which that worker dies — maplibre-gl 6's
 * worker URL resolved against the entry chunk, #849 — still paints the raster
 * basemap, mounts a canvas and reads as a loaded page to every timing here.
 * Only a tile request answered 2xx says the map asked for its regions, and
 * only the map view asks: Discover draws no region tiles, so the fragment
 * sits on the one URL rather than on the file.
 */
export function pageExpectations(budgets, fill) {
  const shared = asList(budgets.expectRequestMatching).map(fill);
  return (budgets.urls ?? []).map((entry) => {
    if (typeof entry === 'string') {
      return { url: fill(entry), expects: shared };
    }
    if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') {
      throw new Error(`budgets "urls": each entry is a string or { url, expectRequestMatching }, got ${JSON.stringify(entry)}`);
    }
    return { url: fill(entry.url), expects: [...shared, ...asList(entry.expectRequestMatching).map(fill)] };
  });
}

function asList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  for (const fragment of list) {
    if (typeof fragment !== 'string' || fragment.length === 0) {
      throw new Error(`budgets "expectRequestMatching": a fragment is a non-empty string, got ${JSON.stringify(fragment)}`);
    }
  }
  return list;
}

/**
 * Whether the run made a request containing the fragment that was answered
 * 2xx. A request alone proves nothing: the app reads the world view the
 * address names eagerly and only then learns the visitor cannot see it, so a
 * 404 for the fragment is exactly the fallback case. The CORS preflight that
 * precedes every cross-origin read is listed as its own request and answers
 * 204 whatever the read then answers, so it does not count — verified
 * against a world view that does not exist, whose root-regions read is a 204
 * preflight followed by a 404. A tile function's own 204 does count: Martin
 * answers it for a tile with nothing in it, which is still the map asking.
 */
export function gotSuccessfulRequestMatching(lhr, fragment) {
  const items = lhr.audits?.['network-requests']?.details?.items;
  return (
    Array.isArray(items) &&
    items.some(
      (item) =>
        typeof item.url === 'string' &&
        item.url.includes(fragment) &&
        item.resourceType !== 'Preflight' &&
        Number.isFinite(item.statusCode) &&
        item.statusCode >= 200 &&
        item.statusCode < 300,
    )
  );
}

function resolveCheck(options) {
  if (Number.isFinite(options.maxNumericValue)) {
    return { name: 'maxNumericValue', operator: '<=', expected: options.maxNumericValue };
  }
  if (Number.isFinite(options.minScore)) {
    return { name: 'minScore', operator: '>=', expected: options.minScore };
  }
  // No threshold at all: nothing can pass it, and the row says why.
  return { name: 'maxNumericValue', operator: '<=', expected: Number.NaN };
}

function resolveTarget(lhr, key, check) {
  if (key.startsWith('categories:')) {
    return resolveCategory(lhr, key, check);
  }
  if (key.startsWith('resource-summary:')) {
    return resolveResourceSummary(lhr, key, check);
  }
  return resolveAudit(lhr, key, check);
}

function resolveCategory(lhr, key, check) {
  const id = key.slice('categories:'.length);
  const target = { auditId: key, auditProperty: undefined };
  if (check.name !== 'minScore') {
    return { ...target, value: undefined, message: 'a category takes minScore' };
  }
  const category = lhr.categories?.[id];
  if (!category) {
    return { ...target, value: undefined, message: `category "${id}" not in report` };
  }
  return { ...target, value: category.score, message: undefined };
}

function resolveResourceSummary(lhr, key, check) {
  const [, resourceType, measure] = key.split(':');
  const target = { auditId: 'resource-summary', auditProperty: `${resourceType}:${measure}` };
  const field = RESOURCE_SUMMARY_FIELDS[measure];
  if (!field) {
    return { ...target, value: undefined, message: `unknown measure "${measure}" (use size or count)` };
  }
  if (check.name !== 'maxNumericValue') {
    return { ...target, value: undefined, message: 'a resource-summary row takes maxNumericValue' };
  }
  const items = lhr.audits?.['resource-summary']?.details?.items;
  const row = Array.isArray(items) ? items.find((item) => item.resourceType === resourceType) : undefined;
  if (!row) {
    return { ...target, value: undefined, message: `resource type "${resourceType}" not in resource-summary` };
  }
  return { ...target, value: row[field], message: undefined };
}

/** minScore reads the audit's score, maxNumericValue its numericValue - never one for the other. */
function resolveAudit(lhr, key, check) {
  const target = { auditId: key, auditProperty: undefined };
  const audit = lhr.audits?.[key];
  if (!audit) {
    return { ...target, value: undefined, message: `audit "${key}" not in report` };
  }
  const field = check.name === 'minScore' ? 'score' : 'numericValue';
  if (!Number.isFinite(audit[field])) {
    return { ...target, value: undefined, message: `audit "${key}" has no ${field}` };
  }
  return { ...target, value: audit[field], message: undefined };
}
