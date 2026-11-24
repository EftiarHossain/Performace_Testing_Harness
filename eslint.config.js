import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'results/', 'baselines/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // k6 scripts run in k6's own runtime, not Node: only k6's globals exist there.
    files: ['src/**'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
        console: 'readonly',
        open: 'readonly',
      },
    },
  },
  {
    files: ['tools/**', 'mock/**', 'test/**', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      eqeqeq: 'error',
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
