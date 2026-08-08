import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // ios/ and android/ each hold a full COPY of the built bundle (cap sync writes
  // dist into them). Linting those re-lints minified vendor code — it dwarfs the
  // real findings and makes Babel print "deoptimised" warnings on every run.
  globalIgnores(['dist', 'ios', 'android', 'public/training', '.venv']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Build config runs in Node, not the browser — it reads process.env to pick
    // the web vs native asset set, and uses node: builtins to prune the bundle.
    files: ['vite.config.js', 'capacitor.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // api/ is Vercel serverless functions — Node, not the browser. Without this
    // every process.env read reported "'process' is not defined", which is six
    // of the repo's lint errors and none of them real.
    files: ['api/**/*.js'],
    languageOptions: { globals: globals.node },
  },
])
