import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/**',
      'public/dist/**',
      'node_modules/**',
      'coverage/**',
      'data/**',
      'scratch/**',
      '*.md',
      'axe-audit-results.json',
      'package-lock.json',
    ],
  },
  js.configs.recommended,
  prettierConfig,
  {
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'off',
    },
  },
];
