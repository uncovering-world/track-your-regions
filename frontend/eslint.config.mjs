import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';

// Where a query key stands (#790): the `queryKey` option, the first argument
// of a query client's cache calls, and a local named `…Key`. A literal array
// there is refused whether it is bare or wrapped in `as const`, `satisfies` or
// both; the call's first argument is pinned, because its second is data and
// may well be an array.
const QUERY_CLIENT_CACHE_CALLS = '/^(getQueryData|setQueryData|getQueryState|getQueriesData|setQueriesData|cancelQueries|removeQueries|refetchQueries|invalidateQueries|resetQueries|fetchQuery|prefetchQuery|ensureQueryData)$/';
const KEY_WRAPPERS = [
  [], ['TSAsExpression'], ['TSSatisfiesExpression'],
  ['TSAsExpression', 'TSSatisfiesExpression'], ['TSSatisfiesExpression', 'TSAsExpression'],
];
const QUERY_KEY_SELECTORS = KEY_WRAPPERS.flatMap(wrappers => {
  const chain = [...wrappers, 'ArrayExpression'];
  const path = chain.join(' > ');
  const firstArgument = [`${chain[0]}:first-child`, ...chain.slice(1)].join(' > ');
  return [
    `Property[key.name='queryKey'] > ${path}`,
    `CallExpression[callee.property.name=${QUERY_CLIENT_CACHE_CALLS}] > ${firstArgument}`,
    `VariableDeclarator[id.name=/[kK]ey$/] > ${path}`,
  ];
});

export default [
  {
    ignores: ['dist/', 'node_modules/'],
  },
  // TypeScript recommended rules
  ...tseslint.configs['flat/recommended'],
  // Security rules
  security.configs.recommended,
  // Code quality rules (cognitive complexity, dead code, redundant patterns)
  sonarjs.configs.recommended,
  // React recommended rules (flat config) with settings
  {
    ...reactPlugin.configs.flat.recommended,
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    ...reactPlugin.configs.flat['jsx-runtime'],
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      // React hooks rules
      ...reactHooksPlugin.configs.recommended.rules,
      // Relax rules that conflict with common patterns
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // React 18 doesn't need import React
      'react/react-in-jsx-scope': 'off',
      // Allow prop spreading (common in MUI)
      'react/jsx-props-no-spreading': 'off',
      // Allow quotes in JSX text (common in UI strings)
      'react/no-unescaped-entities': 'off',
      // Security: keep most as warnings, disable noisy ones
      'security/detect-object-injection': 'off', // Too many false positives with TypeScript
      'security/detect-eval-with-expression': 'error',
      // The "split now" line of docs/tech/development-guide.md § Keep Files
      // Small, in this rule's measure: lines of code, blank and comment lines
      // skipped, because the repo asks for dense explanatory comments and a
      // raw-line cap would tax exactly those. The guide states this number
      // and names this entry, so a change here is a change there too (#530).
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      // A TanStack Query key is built by the factory in src/api/queryKeys.ts
      // (#790): a literal array beside it is a second spelling of the
      // vocabulary, and a key and its invalidation spelled apart drift apart
      // silently. Refused wherever a key stands (QUERY_KEY_SELECTORS above).
      // A local counts by its name, `…Key`, because the rule cannot follow a
      // local to its use. The specs are exempt below, since they pin the
      // shapes the factory must keep producing.
      'no-restricted-syntax': ['error',
        ...QUERY_KEY_SELECTORS.map(selector => ({
          selector,
          message: 'Build query keys with queryKeys (src/api/queryKeys.ts, #790), not a literal array.',
        })),
      ],
      // SonarJS: disable genuine false positives only
      'sonarjs/pseudo-random': 'off', // Math.random is fine for non-crypto uses (e.g., jitter)
      'sonarjs/no-clear-text-protocols': 'off', // False positives on example/docs URLs
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  // The factory itself, and the specs that pin the arrays it has to produce.
  {
    files: ['src/api/queryKeys.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // The performance lane's runner and budget evaluator: plain ESM run by
  // Node inside the e2e container, not by the browser.
  {
    files: ['perf/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Same false-positive class as in the src block above: every index is
      // one of the evaluator's own keys (a threshold name, a resource type)
      // or an audit id from the report it is judging - nothing a request
      // supplied.
      'security/detect-object-injection': 'off',
      // The lane's URLs are the test stack's compose-network origins
      // (http://frontend:5173, http://backend:3001); there is no TLS inside
      // that network to prefer.
      'sonarjs/no-clear-text-protocols': 'off',
      // Every path the runner touches is built from the committed budgets
      // file's outputDir and this directory's own layout, and writing reports
      // to a configured directory is the runner's job; the rule would fire on
      // all seven fs calls with nothing to say about any of them.
      'security/detect-non-literal-fs-filename': 'off',
      // The same ceiling as src/, documented at the entry there.
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
];
