import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // _-prefixed names are intentional "I don't need this" markers
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // any usage is real debt — track as warnings, fix gradually
      '@typescript-eslint/no-explicit-any': 'warn',
      // Guard-clause setState early-returns in effects are intentional here
      'react-hooks/set-state-in-effect': 'warn',
      // React Compiler rules (new in v7) — warnings until Compiler is adopted
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
)
