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

/** What the cache rule says when a response may be stored by a shared cache. */
const PRIVATE_CACHE_CONTROL = [
  'This Cache-Control drops `private`. A response behind requireAuth or optionalAuth that a shared cache may store is one an',
  'EventSource or <img src> caller cannot protect any other way, since its token rides in the query string and RFC 9111 § 3.5',
  'excludes nothing for it. Write `private, …`, or suppress this line with the reason the body is public (as the admin image',
  'proxy does). A value this rule cannot find `private` in is reported the same way — a name, a call, a template whose text',
  'is all holes — since it cannot be checked here; a template whose literal part already says `private` is not, because the',
  'header carries it whatever the hole evaluates to.',
].join(' ');

/**
 * The Cache-Control and pinned-transaction entries of `no-restricted-syntax`,
 * named so the block that adds the response-shape entries can repeat them: a
 * later block's options replace an earlier one's, never merge with them.
 */
const QUERY_AND_HEADER_RULES = [
  {
    // Every Cache-Control a handler writes says `private`. requireAuth
    // marks its responses `private, no-store` and optionalAuth
    // `private, no-cache` (#597, #710); a handler that needs another
    // value replaces the whole header, and that is how `private` gets
    // lost — the three SSE streams said a bare `no-cache` until #710,
    // the value every SSE snippet on the web carries. It matters most
    // where RFC 9111 § 3.5 does not help: EventSource and the admin
    // `<img src>` endpoints take the token as `?token=`, so their
    // requests carry no Authorization and `private` is the whole of the
    // guarantee. A value this rule cannot find `private` in is reported
    // too, since it cannot be checked here; a template whose literal
    // part already says it passes, because the header carries it
    // whatever the hole evaluates to.
    // `:matches` on both sides because `[x.value=…]` reads a property
    // only a Literal carries: written in backticks the header name is a
    // TemplateLiteral, whose text sits in `quasis.0.value.cooked`, and
    // the rule would pass over it entirely. The value is read the same
    // way, so a template that does say `private` is not a false report;
    // one with a hole in it has no `cooked` and is reported, which is
    // the runtime case this cannot check.
    selector: "CallExpression[callee.property.name=/^(setHeader|set|header|append)$/]"
      + ":matches([arguments.0.value=/^cache-control$/i], [arguments.0.quasis.0.value.cooked=/^cache-control$/i])"
      + ":not([arguments.1.value=/private/i]):not([arguments.1.quasis.0.value.cooked=/private/i])",
    message: PRIVATE_CACHE_CONTROL,
  },
  {
    // The same value written as an object entry — the shape `writeHead`
    // and `res.set({…})` take. Keyed on the method, like its sibling
    // above, rather than on a receiver named `res`: that covers a chain
    // (`res.status(200).set({…})`) and a response parameter named
    // anything else, both of which a receiver-keyed selector walks past.
    // It still excludes an outbound `fetch(url, { headers })`, whose
    // callee is a bare identifier with no property to match — a
    // `Cache-Control` there is a request header this rule has nothing to
    // say about.
    selector: "CallExpression[callee.property.name=/^(writeHead|set|header|append)$/] > ObjectExpression > Property"
      + ":matches([key.value=/^cache-control$/i], [key.quasis.0.value.cooked=/^cache-control$/i])"
      + ":not([value.value=/private/i]):not([value.quasis.0.value.cooked=/private/i])",
    message: PRIVATE_CACHE_CONTROL,
  },
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
      // Two rules, each documented at its own entries in
      // QUERY_AND_HEADER_RULES above; a third joins them for everything but
      // the specs, in the block below.
      'no-restricted-syntax': ['error', ...QUERY_AND_HEADER_RULES],
      // SonarJS: disable genuine false positives only
      'sonarjs/pseudo-random': 'off', // Math.random is fine for non-crypto uses (e.g., jitter)
      'sonarjs/no-clear-text-protocols': 'off', // False positives on example/docs URLs
    },
  },
  // Every answer a handler sends is one a schema declares (ADR-0066, #993),
  // and none carries an error's own text (#1021).
  // The specs are left out, since a fixture app's handler is not an endpoint,
  // and so is respond.ts, which is where the body is finally written.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/api/respond.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...QUERY_AND_HEADER_RULES, ...RESPONSE_SHAPE_RULES, ...ERROR_TEXT_RULES,
        ...READER_PREDICATE_RULES, ...EXPERIENCE_WRITE_RULES],
    },
  },
  // The two modules the reader predicates are spelled in (#791): every entry
  // above but that one, since a later block's options replace an earlier one's.
  {
    files: ['src/db/readerPredicates.ts', 'src/db/membership.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...QUERY_AND_HEADER_RULES, ...RESPONSE_SHAPE_RULES, ...ERROR_TEXT_RULES,
        ...EXPERIENCE_WRITE_RULES],
    },
  },
  // The modules that write `experiences` (ADR-0069): every entry above but
  // the write rule, for the same reason.
  {
    files: [
      'src/db/experienceWriter.ts',
      'src/services/sync/experienceUpsert.ts',
      'src/services/sync/missingDetection.ts',
      'src/services/sync/pictureRepair.ts',
      'src/db/seed/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...QUERY_AND_HEADER_RULES, ...RESPONSE_SHAPE_RULES, ...ERROR_TEXT_RULES,
        ...READER_PREDICATE_RULES],
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
