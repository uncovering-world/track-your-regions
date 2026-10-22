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

/**
 * Where a development record would reach the screen: JSX text, a string literal
 * and a template's text. An ADR number anywhere in one; an issue number in
 * brackets ("(#523)", "(#852, #1369)") or of four digits or more. A colour of
 * three digits ('#333', '2px solid #999') is neither, and a string that is a
 * colour alone ('#0008') is let through.
 */
const RECORD = String.raw`ADR-?\d{3,4}|\(#\d{3,5}\b|#\d{4,5}\b`;
const SCREEN_TEXT_SELECTORS = [
  `JSXText[value=/${RECORD}/]`,
  // A string that is a colour and nothing else ('#0008') is let through.
  `Literal[value=/${RECORD}/]:not(Literal[value=/^#[0-9a-fA-F]{3,8}$/])`,
  `TemplateElement[value.raw=/${RECORD}/]`,
];

// The icon package's index loads every one of its thousands of icons:
// the bundle tree-shakes it, but each spec that reaches the import pays
// for the whole package, seconds a file (#1377). One path per icon.
const ICONS_INDEX = {
  name: '@mui/icons-material',
  message: "Import each icon by its path ('@mui/icons-material/Delete'), never the package index (#1377).",
};

export default [
  {
    // Orval's output (ADR-0073) is generated, and api:client holds it to the document.
    ignores: ['dist/', 'node_modules/', 'src/**/*.generated.ts'],
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
      // One path per icon (ICONS_INDEX). The admin operations' generated
      // module loads with the admin screens (#1850): imported from anywhere
      // else, every admin endpoint is back in the chunk every visitor's page
      // loads at startup. Allowed below for src/api/admin/ alone.
      'no-restricted-imports': ['error', {
        paths: [ICONS_INDEX],
        patterns: [{
          group: ['**/adminClient.generated'],
          message: 'Only src/api/admin/ imports the admin client (#1850): call the admin module that wraps the operation.',
        }],
      }],
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
        // A screen reader announces an icon-only button by its accessible name and
        // nothing else (#564). An IconButton carries one as `aria-label`, unless it
        // sits directly in a Tooltip, which names its child; one inside a `span`
        // inside a Tooltip is not named by it. A spread may carry the label, so it
        // is let through. docs/tech/shared-frontend-patterns.md § Icon buttons.
        {
          selector: "JSXOpeningElement[name.name='IconButton']:not(:has(JSXAttribute[name.name=/^aria-label/]))"
            + ':not(:has(JSXSpreadAttribute))'
            + ":not(JSXElement[openingElement.name.name='Tooltip'] > JSXElement > JSXOpeningElement)",
          message: 'An icon-only IconButton needs an aria-label naming its action (#564), or a Tooltip directly around it.',
        },
        // Text a person reads names no development record (#1506): an ADR or an issue
        // number means nothing on screen and cannot be followed from the app. Comments
        // keep theirs (RECORD above says what counts as one).
        ...SCREEN_TEXT_SELECTORS.map(selector => ({
          selector,
          message: 'Text on screen names no ADR or issue number (#1506): say what the person needs to know in plain words.',
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
  // The admin screens' API modules, and the spec that pins how the client
  // encodes a path, which reads admin operations.
  {
    files: ['src/api/admin/**/*.ts', 'src/api/client.encoding.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [ICONS_INDEX] }],
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
