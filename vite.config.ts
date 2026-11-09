import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Dev server stays on this machine only (127.0.0.1).
export default defineConfig({
  root: 'web',
  base: './',
  server: { host: '127.0.0.1', port: 5195, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: { guide: here('web/guide/index.html'), try: here('web/guide/try.html') } } },
});
