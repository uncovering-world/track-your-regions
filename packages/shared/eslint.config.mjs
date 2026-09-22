import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';

/**
 * The backend's base stack (backend/eslint.config.mjs) without the rules that
 * name a server: no Node globals, no Cache-Control or `pool.query` selectors.
 * A module here has no runtime of its own to lean on, and the config says so
 * the way the tsconfig does with `"types": []`.
 */
export default [
  {
    ignores: ['node_modules/'],
  },
  ...tseslint.configs['flat/recommended'],
  security.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'security/detect-object-injection': 'off',
      'security/detect-eval-with-expression': 'error',
      // The same ceiling as the other two packages, in the same measure
      // (docs/tech/development-guide.md § Keep Files Small, #530).
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'sonarjs/no-clear-text-protocols': 'off',
    },
  },
  // The files nobody writes: `api.generated.ts` is the backend's response
  // schemas rendered by backend/src/api/generateApiTypes.ts (ADR-0066), and its
  // length is the API's, not a sign of a file to split.
  {
    files: ['src/*.generated.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
];
