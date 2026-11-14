import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Streamdown loads this parser with Markdown, independent of the app shell.
            { name: 'markdown-html-parser', test: /[\\/]node_modules[\\/]parse5[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': process.env.HOST_URL ?? 'http://127.0.0.1:8917',
    },
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
