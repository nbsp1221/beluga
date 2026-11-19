import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import icon from 'astro-icon';
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://beluga.retn0.dev',
  devToolbar: { enabled: false },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Inter',
      cssVariable: '--font-inter',
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
  ],
  integrations: [
    react(),
    icon({
      iconDir: 'src/assets',
      include: {
        tabler: [
          'brand-docker',
          'check',
          'chevron-down',
          'device-desktop',
          'folder',
          'moon',
          'route',
          'shield',
          'sun',
          'terminal-2',
        ],
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
