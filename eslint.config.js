import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint configuration.
 *
 * Deliberately not type-aware: `tsc --noEmit` already provides the type
 * guarantees, and keeping lint fast means it actually runs on every change.
 * The React Hooks rules are wired explicitly rather than through a shared
 * preset so a plugin upgrade cannot silently change what is enforced.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/target/**', 'tools/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // `tsc` resolves every identifier against real types, including the DOM
      // and Node globals, so `no-undef` would only produce false positives.
      'no-undef': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Untrusted values must be parsed, never cast into shape.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}', 'vitest.setup.ts', 'vite.config.ts'],
    rules: {
      // Test fixtures intentionally exercise malformed input.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
