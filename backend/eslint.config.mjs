import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';

/** What to do instead, said once for both spellings of the mistake below. */
const PINNED_TRANSACTION = "pool.query() does not pin a connection. Open the transaction on one client: "
  + "const client = await pool.connect(); await client.query('BEGIN'); ... client.release(unusable) "
  + "— see editExperience in controllers/experience/curationController.ts.";

/**
 * The verbs that only mean anything on the connection that opened them.
 *
 * Postgres' synonyms are here too — `START TRANSACTION` for BEGIN, `END` and
 * `ABORT` for COMMIT and ROLLBACK — since they open and close exactly the same
 * stray transaction. `END` is safe to name only because the template selector
 * below reads the opening quasi alone: this codebase writes plenty of
 * interpolated `CASE … ${x} … END`, whose trailing quasi would otherwise be
 * reported as a transaction.
 */
const TX_VERBS = '(BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE)';

/**
 * The pinned-transaction entries of `no-restricted-syntax`, named so the block
 * that adds the response-shape entries can repeat them: a later block's
 * options replace an earlier one's, never merge with them.
 */
const TRANSACTION_RULES = [
  {
    // A transaction has to be pinned to one client. `pool.query('BEGIN')`
    // checks out an arbitrary idle client, runs BEGIN on it and releases
    // it with the transaction still open: the statements that follow may
    // land on other connections, and another request that checks out that
    // client runs its own writes inside the stray transaction — to be
    // rolled back with it. The rule exists because the prose form of it,
    // written in curationController, outlived four call sites (#532).
    selector: `CallExpression[callee.object.name='pool'][callee.property.name='query'] > Literal[value=/^\\s*${TX_VERBS}\\b/i]`,
    message: PINNED_TRANSACTION,
  },
  {
    // `:first-child` because only the opening quasi can be the start of
    // the statement. Without it every quasi is read, and an interpolated
    // `… ${x} ROLLBACK …` deep inside one string would be reported as a
    // transaction it never opened.
    selector: `CallExpression[callee.object.name='pool'][callee.property.name='query'] > TemplateLiteral > TemplateElement:first-child[value.raw=/^\\s*${TX_VERBS}\\b/i]`,
    message: PINNED_TRANSACTION,
  },
];

/**
 * A route added to a router by hand rather than declared (#793, ADR-0071).
 * A declaration is what states a route's access, cache policy, limiter and
 * schemas, and `routerOf` builds its middleware from them in one order; a
 * `router.get(…)` written beside it states none of that and is checked by
 * nothing. Keyed on the call's shape rather than the receiver's name, since a
 * router can be called anything: a route method handed a path (a string
 * starting with `/`, or a template) and something after it, or a path handed
 * to `route()`, which chains the methods on. A Map's `get` takes one key, and
 * an outbound call goes through `fetch`. `routerOf` itself adds each route
 * through a computed method, which this does not match. A path read from a
 * variable is beyond a selector, which cannot tell `router.get(PATH, handler)`
 * from any two-argument `get`; review holds that case.
 */
const OWN_ROUTE = 'Declare the route with defineRoute (src/api/route.ts) and build its router with routerOf: the declaration '
  + 'states its access, cache policy, limiter and schemas (ADR-0071, #793).';
const ROUTE_REGISTRY_RULES = [
  {
    selector: "CallExpression[callee.computed=false][callee.property.name=/^(get|post|put|patch|delete|all)$/][arguments.1]"
      + ":matches([arguments.0.value=/^\\//], [arguments.0.type='TemplateLiteral'])",
    message: OWN_ROUTE,
  },
  {
    selector: "CallExpression[callee.computed=false][callee.property.name='route']"
      + ":matches([arguments.0.value=/^\\//], [arguments.0.type='TemplateLiteral'])",
    message: OWN_ROUTE,
  },
];

/**
 * A reader predicate spelled out rather than composed (#791). Whether a row is
 * one a reader may see is asked by a named fragment — `hidePendingSql`,
 * `publishedContentSql` and `hideLostSql` in `src/db/readerPredicates.ts`,
 * `membershipVisibleSql` in `src/db/membership.ts` — and those two files are
 * the only ones that may spell the SQL. A copy elsewhere is the one that
 * misses the next term the question gains. Read in a string's text or a
 * template's literal parts, so a TypeScript comment naming the predicate is
 * not a copy, while a SQL comment inside the statement is, and says so.
 */
const READER_PREDICATE = 'A reader predicate is composed, not spelled: use publishedContentSql / hidePendingSql / hideLostSql / '
  + 'offeredLocationSql (src/db/readerPredicates.ts) or membershipVisibleSql (src/db/membership.ts) (#791).';
const READER_PREDICATE_TEXT = "/curation_state\\s*<>\\s*'pending'|existence\\s*<>\\s*'lost'/";
const READER_PREDICATE_RULES = [
  { selector: `TemplateElement[value.raw=${READER_PREDICATE_TEXT}]`, message: READER_PREDICATE },
  { selector: `Literal[value=${READER_PREDICATE_TEXT}]`, message: READER_PREDICATE },
];

/**
 * A write to `experiences` outside the modules that write it (ADR-0069, #791).
 * The table's writers are a closed list: the curator's writes in
 * `src/db/experienceWriter.ts`, under the object lock's token; the run's upsert
 * (`src/services/sync/experienceUpsert.ts`), whose one statement writes the
 * place and its membership together; missing detection's mark and the picture
 * repair, each a single-purpose module of its own; and the seed. Read in a
 * string's text or a template's literal parts, as the reader-predicate rule is.
 */
const EXPERIENCE_WRITE = 'experiences is written by its writer modules only (ADR-0069): add a named write to '
  + 'src/db/experienceWriter.ts, taking the LockedExperience token where the write assumes the object lock.';
const EXPERIENCE_WRITE_TEXT = '/\\b(INSERT\\s+INTO|UPDATE)\\s+experiences(?!\\w)/i';
const EXPERIENCE_WRITE_RULES = [
  { selector: `TemplateElement[value.raw=${EXPERIENCE_WRITE_TEXT}]`, message: EXPERIENCE_WRITE },
  { selector: `Literal[value=${EXPERIENCE_WRITE_TEXT}]`, message: EXPERIENCE_WRITE },
];

/**
 * A write to `experience_locations` — an object's points — outside the modules
 * that write it (ADR-0069, #791): the curator's writes in
 * `src/controllers/experience/experienceLocationWriter.ts`, every one of them
 * under the object's `LockedExperience` token; the run's location writer
 * (`src/services/sync/locationWriter.ts`), which takes the same lock; and the
 * seed.
 */
const EXPERIENCE_LOCATION_WRITE = 'experience_locations is written by its writer modules only (ADR-0069): add a named '
  + 'write to src/controllers/experience/experienceLocationWriter.ts, taking the object\'s LockedExperience token.';
const EXPERIENCE_LOCATION_WRITE_TEXT = '/\\b(INSERT\\s+INTO|UPDATE)\\s+experience_locations(?!\\w)/i';
const EXPERIENCE_LOCATION_WRITE_RULES = [
  { selector: `TemplateElement[value.raw=${EXPERIENCE_LOCATION_WRITE_TEXT}]`, message: EXPERIENCE_LOCATION_WRITE },
  { selector: `Literal[value=${EXPERIENCE_LOCATION_WRITE_TEXT}]`, message: EXPERIENCE_LOCATION_WRITE },
];

/**
 * A write to `treasures` or `experience_treasures` — a venue's works and their
 * links — outside the modules that write them (ADR-0069, #1072): the curator's
 * writes in `src/controllers/experience/workWriter.ts`, every one of them under
 * the venue's `LockedExperience` token; the run's treasure writer and link
 * reconciliation (`src/services/sync/museum/treasureWriter.ts`,
 * `src/services/sync/museum/linkWithdrawal.ts`); and the seed.
 */
const WORK_WRITE = 'treasures, experience_treasures and experience_treasure_placements are written by their writer '
  + 'modules only (ADR-0069): add a named write to src/controllers/experience/workWriter.ts, taking the venue\'s '
  + 'LockedExperience token.';
// A placement is deleted when a run stops placing a link (ADR-0084), so a delete
// is a write to it too.
const WORK_WRITE_TEXT = '/\\b((INSERT\\s+INTO|UPDATE)\\s+(experience_)?treasures|(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+experience_treasure_placements)(?!\\w)/i';
const WORK_WRITE_RULES = [
  { selector: `TemplateElement[value.raw=${WORK_WRITE_TEXT}]`, message: WORK_WRITE },
  { selector: `Literal[value=${WORK_WRITE_TEXT}]`, message: WORK_WRITE },
];

/**
 * A write to `regions` outside the modules that write it (ADR-0069 applied to
 * regions, #1073): the editor's and the import review's writes in
 * `src/db/regionWriter.ts`; the geometry computations, each writing the outline
 * its own pipeline made in a statement the pipeline's guards read
 * (`geometryCompute.ts`, `geometryComputeSSE.ts`, `geometryComputeSingle.ts`,
 * `computeSingleMemberFastPath.ts`); the hull generator; and the seed. A delete
 * is a write here too: it changes a parent's union and its tiles.
 */
const REGION_WRITE = 'regions is written by its writer modules only (ADR-0069): add a named write to src/db/regionWriter.ts, '
  + 'taking the caller\'s connection.';
const REGION_WRITE_TEXT = '/\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+regions(?!\\w)/i';
const REGION_WRITE_RULES = [
  { selector: `TemplateElement[value.raw=${REGION_WRITE_TEXT}]`, message: REGION_WRITE },
  { selector: `Literal[value=${REGION_WRITE_TEXT}]`, message: REGION_WRITE },
];

/**
 * The curation gate's tables, on the same closed lists (ADR-0077 decision 4,
 * #1148): the answers a curator gives a run's proposals, the run's own record
 * of what it proposed, and the membership that says whether a place is in a
 * kind and in what state. One family per table, since each has its own
 * writers; a delete is a write on each of them, as on `regions`.
 */
const GATE_WRITE_VERBS = '(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)';

/** The two entries that refuse a statement naming `table` outright. */
function spelledWriteRules(table, message) {
  const text = `/\\b${GATE_WRITE_VERBS}\\s+${table}(?!\\w)/i`;
  return [
    { selector: `TemplateElement[value.raw=${text}]`, message },
    { selector: `Literal[value=${text}]`, message },
  ];
}

/**
 * A curator's standing refusal of a proposed value and its release: both ends
 * of the record in `src/controllers/experience/conflictDecisions.ts`.
 */
const CONFLICT_DECISION_WRITE = 'experience_conflict_decisions is written by its writer module only (ADR-0077): add a named '
  + 'write to src/controllers/experience/conflictDecisions.ts, taking the place\'s LockedExperience token.';
const CONFLICT_DECISION_WRITE_RULES = spelledWriteRules('experience_conflict_decisions', CONFLICT_DECISION_WRITE);

/** A curator's answer to one row of a held proposal: `recordHeldAnswers` in `heldDecisions.ts`. */
const HELD_DECISION_WRITE = 'experience_held_decisions is written by its writer module only (ADR-0077): record an answer '
  + 'through recordHeldAnswers in src/controllers/experience/heldDecisions.ts.';
const HELD_DECISION_WRITE_RULES = spelledWriteRules('experience_held_decisions', HELD_DECISION_WRITE);

/**
 * A run's record of what it proposed, written once and never rewritten (a
 * changeset is what happened, ADR-0020): `recordSyncChanges` in
 * `src/services/sync/changeRecorder.ts`.
 */
const SYNC_CHANGE_WRITE = 'experience_sync_changes is written by its writer module only (ADR-0077): a run records its '
  + 'changes through recordSyncChanges in src/services/sync/changeRecorder.ts, and nothing rewrites them.';
const SYNC_CHANGE_WRITE_RULES = spelledWriteRules('experience_sync_changes', SYNC_CHANGE_WRITE);

/**
 * A place's membership in a kind: the curator's writes in
 * `src/controllers/experience/membershipWriter.ts`, under the place's
 * `LockedExperience` token; the run's upsert (`experienceUpsert.ts`, which
 * writes the place and its membership in one statement), the admission sweep
 * (`admission.ts`), the verified pass a new content retires
 * (`curationDecay.ts`) and the held proposal's pointer
 * (`heldProposalPointer.ts`); and the seed.
 *
 * The table is named through `MEMBERSHIPS` (`src/db/membership.ts`) far more
 * often than it is spelled, so the verb is read at the end of the literal part
 * before an interpolation, in a template that interpolates `MEMBERSHIPS`. A
 * selector cannot pair a literal part with the expression after it, so a
 * template that interpolates both `MEMBERSHIPS` and another table right after a
 * verb is read as a membership write too; none does. A row lock
 * (`FOR UPDATE`, `FOR NO KEY UPDATE`) and an upsert's `DO UPDATE` end the same
 * way and are not writes to the table, so the lookbehind lets them pass.
 */
const MEMBERSHIP_WRITE = 'experience_kind_memberships is written by its writer modules only (ADR-0077): add a named write '
  + 'to src/controllers/experience/membershipWriter.ts, taking the place\'s LockedExperience token.';
const MEMBERSHIP_WRITE_RULES = [
  ...spelledWriteRules('experience_kind_memberships', MEMBERSHIP_WRITE),
  {
    selector: "TemplateLiteral:has(> Identifier[name='MEMBERSHIPS']) > TemplateElement[tail=false]"
      + `[value.raw=/(?<!\\b(FOR(\\s+NO\\s+KEY)?|DO)\\s+)\\b${GATE_WRITE_VERBS}\\s*$/i]`,
    message: MEMBERSHIP_WRITE,
  },
];

/** What the response-shape rule says. */
const RESPONSE_SHAPE = [
  'A success body is sent through respond(res, Schema, body) from src/api/respond.ts, with its schema in src/api/responses/,',
  'and a stream\'s event through writeEvent(res, Schema, event) (ADR-0066): the web\'s types are generated from those schemas,',
  'so a body sent around them is a shape nothing declares. An endpoint no client calls yet is exempted line by line with the',
  'issue that decides it.',
].join(' ');

/**
 * The response-shape entries: a bare `res.json(…)`, and a `.json(…)` after a
 * literal 2xx status; and the same two with `send` when its argument is an
 * object or array literal, which Express sends as JSON. An error answer
 * (`res.status(404).json(…)`, or a status held in a variable, as the curator
 * writers' refusals are) is not a success body and passes, and so is a `send`
 * of a name, a string or a Buffer — the admin images' PNG — whose type a
 * selector cannot read. Keyed on a receiver named `res`, as every handler in
 * this codebase names it, so an outbound `fetch` answer's `response.json()` is
 * not read as one.
 */
const JSON_LITERAL = '[arguments.0.type=/^(ObjectExpression|ArrayExpression)$/]';
const AFTER_2XX = "[callee.object.callee.property.name='status']"
  + '[callee.object.arguments.0.value>=200][callee.object.arguments.0.value<300]';
const RESPONSE_SHAPE_RULES = [
  {
    selector: "CallExpression[callee.object.name='res'][callee.property.name='json']",
    message: RESPONSE_SHAPE,
  },
  {
    selector: `CallExpression[callee.property.name='json']${AFTER_2XX}`,
    message: RESPONSE_SHAPE,
  },
  {
    selector: `CallExpression[callee.object.name='res'][callee.property.name='send']${JSON_LITERAL}`,
    message: RESPONSE_SHAPE,
  },
  {
    selector: `CallExpression[callee.property.name='send']${AFTER_2XX}${JSON_LITERAL}`,
    message: RESPONSE_SHAPE,
  },
];

/**
 * What services/ may import (#1130). The layers run routes → controllers →
 * services → db, so a module under services/ never reaches up into
 * controllers/: what it needs from there moves down, or the module moves up.
 * And OpenCV is loaded once, by controllers/admin/wvImportMatchJsBranch.ts,
 * onto globalThis.__cv; a value import of it below that module would load the
 * WASM build in every spec that reaches the importer, and its thenable hangs
 * vitest. A type import is erased and stays allowed. `no-restricted-imports`
 * reads static imports and re-exports only; a dynamic `import()` is beyond it.
 */
const SERVICE_LAYER_IMPORTS = {
  patterns: [{
    regex: '^(\\.\\./)+controllers/',
    message: 'services/ sits below controllers/ (#1130): move what is needed into services/, or move this module up.',
  }],
  paths: [{
    name: '@techstark/opencv-js',
    allowTypeImports: true,
    message: 'OpenCV is loaded once, by controllers/admin/wvImportMatchJsBranch.ts, onto globalThis.__cv; a value import '
      + 'here loads it in every spec that reaches this module, and its thenable hangs vitest.',
  }],
};

/** What the error-text rule says. */
const ERROR_TEXT = [
  'An error\'s own text does not reach a caller: a driver, an HTTP client or a model SDK puts table and column names, URLs',
  'and internals there, and a client that shows it teaches the product to show whatever a library threw (#1021, Security',
  'Rule 5). Answer a sentence written for the reader and log the error with console.error; a cause the reader can act on is',
  'named by a code of its own, the way the AI routes name quota_exceeded.',
].join(' ');

/**
 * Where an answer leaves a handler: a response body (`json`, `send`,
 * `respond`), a redirect's address, a stream's event (`sendEvent`,
 * `writeEvent`, bare or as a method), and the status a progress poll reads
 * (`status`, `statusMessage`). In each of them an error's `.message`, or the
 * error turned into a string (`String(err)`, `err.toString()`, or `${err}` in
 * a template), is the internal text this rule keeps out. The string cases read
 * the error by its name (`e`, `err`, `error`, `mapErr`, `recordError`), since
 * `String(id)` in a body is an ordinary value. A value read into a variable
 * first is out of a selector's reach; the handlers write the sentence in place,
 * and review holds the rest.
 */
const ANSWER_CONTEXTS = [
  "CallExpression[callee.property.name=/^(json|send|redirect)$/]",
  "CallExpression[callee.name=/^(respond|sendEvent|writeEvent)$/]",
  "CallExpression[callee.property.name=/^(sendEvent|writeEvent)$/]",
  "AssignmentExpression[left.property.name=/^(status|statusMessage)$/]",
];
const ERROR_TEXT_RULES = ANSWER_CONTEXTS.flatMap(context => [
  { selector: `${context} MemberExpression[property.name='message']`, message: ERROR_TEXT },
  { selector: `${context} CallExpression[callee.name='String'][arguments.0.name=/^(e|err|error|\\w+(Err|Error))$/]`, message: ERROR_TEXT },
  { selector: `${context} TemplateLiteral > Identifier[name=/^(e|err|error|\\w+(Err|Error))$/]`, message: ERROR_TEXT },
  { selector: `${context} CallExpression[callee.property.name='toString'][callee.object.name=/^(e|err|error|\\w+(Err|Error))$/]`, message: ERROR_TEXT },
]);

/**
 * Every family of `no-restricted-syntax` entries a source file answers to, in
 * one list. ESLint's flat config replaces a rule's options block by block and
 * never merges them, so a module exempt from one family has to restate every
 * other; `restrictedSyntaxWithout` builds that restatement from this list, and
 * a family added here reaches every block at once, exemptions included.
 */
const SOURCE_RULE_FAMILIES = [
  TRANSACTION_RULES, RESPONSE_SHAPE_RULES, ERROR_TEXT_RULES, READER_PREDICATE_RULES,
  EXPERIENCE_WRITE_RULES, EXPERIENCE_LOCATION_WRITE_RULES, WORK_WRITE_RULES, REGION_WRITE_RULES,
  CONFLICT_DECISION_WRITE_RULES, HELD_DECISION_WRITE_RULES, SYNC_CHANGE_WRITE_RULES, MEMBERSHIP_WRITE_RULES,
  ROUTE_REGISTRY_RULES,
];

/** Every family that closes a table's list of writers, for the seed, which writes them all. */
const TABLE_WRITE_FAMILIES = [
  EXPERIENCE_WRITE_RULES, EXPERIENCE_LOCATION_WRITE_RULES, WORK_WRITE_RULES, REGION_WRITE_RULES,
  CONFLICT_DECISION_WRITE_RULES, HELD_DECISION_WRITE_RULES, SYNC_CHANGE_WRITE_RULES, MEMBERSHIP_WRITE_RULES,
];

/** The `no-restricted-syntax` setting of every family but the ones named. */
function restrictedSyntaxWithout(...allowed) {
  for (const family of allowed) {
    if (!SOURCE_RULE_FAMILIES.includes(family)) throw new Error('restrictedSyntaxWithout: not a family of SOURCE_RULE_FAMILIES');
  }
  return ['error', ...SOURCE_RULE_FAMILIES.filter(family => !allowed.includes(family)).flat()];
}

export default [
  {
    ignores: ['dist/', 'node_modules/'],
  },
  // Base config for all TypeScript files
  ...tseslint.configs['flat/recommended'],
  // Security rules
  security.configs.recommended,
  // Code quality rules (cognitive complexity, dead code, redundant patterns)
  sonarjs.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Relax rules that conflict with common patterns
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Allow explicit any sparingly (warn instead of error)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Security: keep most as warnings, escalate critical ones to errors
      'security/detect-object-injection': 'off', // Too many false positives with TypeScript
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-child-process': 'warn',
      // The "split now" line of docs/tech/development-guide.md § Keep Files
      // Small, in this rule's measure: lines of code, blank and comment lines
      // skipped, because the repo asks for dense explanatory comments and a
      // raw-line cap would tax exactly those. The guide states this number
      // and names this entry, so a change here is a change there too (#530).
      // No hand-written file is exempt: the list of files that were over it
      // when it was set is gone (#933), and a file that would need an entry
      // is a file to split first. The one relaxation is the generated schema
      // below, whose length is the schema's.
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      // The pinned-transaction rule, documented at its entries in
      // TRANSACTION_RULES above; the rest join it for everything but the
      // specs, in the block below.
      'no-restricted-syntax': ['error', ...TRANSACTION_RULES],
      // SonarJS: disable genuine false positives only
      'sonarjs/pseudo-random': 'off', // Math.random is fine for non-crypto uses (e.g., jitter)
      'sonarjs/no-clear-text-protocols': 'off', // False positives on example/docs URLs
    },
  },
  // Every answer a handler sends is one a schema declares (ADR-0066, #993),
  // none carries an error's own text (#1021), and every route is declared
  // (ADR-0071).
  // The specs are left out, since a fixture app's handler is not an endpoint,
  // and so is respond.ts, which is where the body is finally written.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/api/respond.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(),
    },
  },
  // The two modules the reader predicates are spelled in (#791): every entry
  // above but that one, since a later block's options replace an earlier one's.
  {
    files: ['src/db/readerPredicates.ts', 'src/db/membership.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(READER_PREDICATE_RULES),
    },
  },
  // The modules that write `experiences` (ADR-0069): every entry above but
  // the write rule, for the same reason.
  {
    files: [
      'src/db/experienceWriter.ts',
      'src/services/sync/pictureRepair.ts',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(EXPERIENCE_WRITE_RULES),
    },
  },
  // The run's upsert, whose one statement writes the place and its membership
  // together: both lists name it, and a file matches one block of these.
  {
    files: ['src/services/sync/experienceUpsert.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(EXPERIENCE_WRITE_RULES, MEMBERSHIP_WRITE_RULES),
    },
  },
  // The modules that write `experience_locations` (ADR-0069), the same way.
  {
    files: [
      'src/controllers/experience/experienceLocationWriter.ts',
      'src/services/sync/locationWriter.ts',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(EXPERIENCE_LOCATION_WRITE_RULES),
    },
  },
  // The modules that write `treasures` and `experience_treasures` (ADR-0069,
  // #1072), the same way.
  {
    files: [
      'src/controllers/experience/workWriter.ts',
      'src/services/sync/museum/treasureWriter.ts',
      'src/services/sync/museum/linkWithdrawal.ts',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(WORK_WRITE_RULES),
    },
  },
  // The modules that write `regions` (ADR-0069, #1073), the same way.
  {
    files: [
      'src/db/regionWriter.ts',
      'src/controllers/worldView/geometryCompute.ts',
      'src/controllers/worldView/geometryComputeSSE.ts',
      'src/controllers/worldView/geometryComputeSingle.ts',
      'src/controllers/worldView/computeSingleMemberFastPath.ts',
      'src/services/hull/generator.ts',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(REGION_WRITE_RULES),
    },
  },
  // The curation gate's writers (ADR-0077 decision 4, #1148), the same way:
  // a conflict answer, a held answer, a run's record of its changes, and a
  // place's membership in a kind.
  {
    files: ['src/controllers/experience/conflictDecisions.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(CONFLICT_DECISION_WRITE_RULES),
    },
  },
  {
    files: ['src/controllers/experience/heldDecisions.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(HELD_DECISION_WRITE_RULES),
    },
  },
  {
    files: ['src/services/sync/changeRecorder.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(SYNC_CHANGE_WRITE_RULES),
    },
  },
  {
    files: [
      'src/controllers/experience/membershipWriter.ts',
      'src/services/sync/admission.ts',
      'src/services/sync/curationDecay.ts',
      'src/services/sync/heldProposalPointer.ts',
      'src/services/sync/missingDetection.ts',
    ],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(MEMBERSHIP_WRITE_RULES),
    },
  },
  // The seed writes the catalogue's tables, as the fixture it is.
  {
    files: ['src/db/seed/**/*.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntaxWithout(...TABLE_WRITE_FAMILIES),
    },
  },
  // services/ never imports from controllers/, and loads no OpenCV of its
  // own (SERVICE_LAYER_IMPORTS above). Specs included: a spec under
  // services/ that needs a controller belongs beside that controller.
  {
    files: ['src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', SERVICE_LAYER_IMPORTS],
    },
  },
  // The one file nobody writes: `schema.generated.ts` is the schema's
  // relations rendered by src/db/generateSchemaTypes.ts (ADR-0064), and its
  // length is the schema's, not a sign of a file to split.
  {
    files: ['src/db/schema.generated.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
];
