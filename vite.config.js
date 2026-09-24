import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Strict Content-Security-Policy for the packaged app (dev server needs inline HMR scripts).
const csp = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(
    '<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'" />`,
  ),
};

export default defineConfig({
  plugins: [react(), csp],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
