import config from '@retn0/oxfmt-config';
import { artifactIgnores } from './ignores.mts';

export default {
  ...config,
  ignorePatterns: [...(config.ignorePatterns ?? []), ...artifactIgnores, 'pnpm-lock.yaml'],
} satisfies typeof config;
