import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';

export default [
  {
    ignores: ['dist/', 'node_modules/'],
  },
  // TypeScript recommended rules
  ...tseslint.configs['flat/recommended'],
  // Security rules
  security.configs.recommended,
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
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
