import type { Linter } from 'eslint';
import retn0 from '@retn0/eslint-config';
import eslintConfigOxlint from '@retn0/eslint-config-oxlint';
import turbo from 'eslint-plugin-turbo';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { artifactIgnores } from './ignores.mts';
import oxlintConfig from './oxlint.mts';

// Turbo exposes flat and legacy presets through the same generic type.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const turboConfig = turbo.configs?.['flat/recommended'] as Linter.Config;

const common = [
  ...eslintConfigOxlint(oxlintConfig),
  turboConfig,
  globalIgnores(artifactIgnores),
  ...defineConfig({
    files: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    extends: retn0({ js: false, ts: false, stylistic: false, vitest: true }),
  }),
] satisfies Linter.Config[];

export const nodeConfig = retn0({ environments: ['node'], perfectionist: true }, ...common);

export const reactConfig = retn0(
  { react: true, perfectionist: true },
  ...common,
  { files: ['src/**/*.{js,jsx,ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    files: ['*.config.{js,mjs,ts,mts}', 'test/**/*.{ts,mts}'],
    languageOptions: { globals: globals.node },
  },
);
