import retn0 from '@retn0/oxlint-config';
import { artifactIgnores, shadcnIgnores } from './ignores.mts';

export default retn0(
  { react: true },
  {
    ignorePatterns: [
      ...artifactIgnores,
      ...shadcnIgnores.map((pattern) => `packages/ui/${pattern}`),
    ],
    overrides: [
      {
        files: ['apps/web/src/**', 'packages/ui/src/**', 'packages/client/src/**'],
        env: { browser: true },
      },
      {
        files: [
          'apps/host/**',
          'packages/host-plugins/**',
          'scripts/**',
          '**/test/**/*.{ts,mts}',
          '**/*.config.{js,mjs,ts,mts}',
          'packages/tooling-config/**',
        ],
        env: { node: true },
      },
    ],
  },
);
