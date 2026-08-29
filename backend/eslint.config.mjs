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
      // File-size cap: keep files under 1000 lines so they stay scannable.
      // Skip blank lines and single-line comments (docstrings / section banners)
      // from the count so files aren't artificially close to the limit.
      'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }],
      // Two rules, each documented at its own entries below.
      'no-restricted-syntax': ['error',
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
      ],
      // SonarJS: disable genuine false positives only
      'sonarjs/pseudo-random': 'off', // Math.random is fine for non-crypto uses (e.g., jitter)
      'sonarjs/no-clear-text-protocols': 'off', // False positives on example/docs URLs
    },
  },
];
