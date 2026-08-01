import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const parserOptions = (jsx) => ({
  requireConfigFile: false,
  sourceType: 'module',
  babelOptions: {
    presets: [
      ['@babel/preset-typescript', { ignoreExtensions: true }],
      ...(jsx ? [['@babel/preset-react', { runtime: 'automatic' }]] : []),
    ],
    plugins: jsx ? ['@babel/plugin-syntax-jsx'] : [],
  },
});

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'visual-artifacts/**',
      'coverage/**',
      '.wrangler/**',
      'worker/worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: babelParser,
      parserOptions: parserOptions(false),
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },
  {
    files: ['worker/**/*.ts', 'vitest.collab.config.ts'],
    languageOptions: {
      parser: babelParser,
      parserOptions: parserOptions(false),
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.tsx'],
    languageOptions: {
      parser: babelParser,
      parserOptions: parserOptions(true),
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Babel parses TypeScript 7 without pretending to provide type-aware
      // linting. TypeScript itself owns symbol/unused diagnostics.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/calc/**/*.{ts,tsx}', 'src/models/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/ui/**'], message: 'Calculation and model code must not depend on UI.' },
          { group: ['**/state/**'], message: 'Calculation and model code must remain independent of application state.' },
          { group: ['**/io/**'], message: 'Calculation and model code must not depend on file adapters.' },
          { group: ['**/canvas/**', '**/three/**'], message: 'Calculation and model code must not depend on renderers.' },
        ],
      }],
    },
  },
  {
    files: ['src/io/**/*.{ts,tsx}', 'src/collab/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/ui/**'], message: 'Adapters must not depend on UI components.' },
        ],
      }],
    },
  },
];
