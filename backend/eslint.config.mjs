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
      // A transaction has to be pinned to one client. `pool.query('BEGIN')`
      // checks out an arbitrary idle client, runs BEGIN on it and releases it
      // with the transaction still open: the statements that follow may land on
      // other connections, and another request that checks out that client runs
      // its own writes inside the stray transaction — to be rolled back with it.
      // The rule exists because the prose form of it, written in
      // curationController, outlived four call sites (#532).
      'no-restricted-syntax': ['error',
        {
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
