import config from '@workspace/tooling-config/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
  ...config,
  sortTailwindcss: {
    stylesheet: 'packages/ui/src/styles/globals.css',
    functions: ['cn', 'clsx', 'cva'],
  },
});
