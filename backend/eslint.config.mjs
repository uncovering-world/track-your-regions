import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';

export default [
  {
    ignores: ['dist/', 'node_modules/'],
  },
  // Base config for all TypeScript files
  ...tseslint.configs['flat/recommended'],
  // Security rules
  security.configs.recommended,
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
    },
  },
];
