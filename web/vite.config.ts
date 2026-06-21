import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Some paths (e.g. /projects, /settings) are shared between the React router
// and API routes. Only proxy when the request is an API call (JSON accept
// header or a known API sub-path like /media, /artifacts, /research),
// otherwise fall through to the SPA so direct URL navigation works.
const API_SUBPATHS = ['/media/', '/artifacts/', '/research/'];
function apiOrSpaBypass(req) {
  if (req.headers.accept?.includes('application/json')) return undefined;
  if (API_SUBPATHS.some(p => req.url?.includes(p))) return undefined;
  return '/index.html';
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/sessions': 'http://localhost:3000',
      '/messages': 'http://localhost:3000',
      '/connections': 'http://localhost:3000',
      '/executions': 'http://localhost:3000',
      '/memory': 'http://localhost:3000',
      '/scheduled-tasks': 'http://localhost:3000',
      '/campaigns': 'http://localhost:3000',
      '/pipelines': 'http://localhost:3000',
      '/projects': {
        target: 'http://localhost:3000',
        bypass: apiOrSpaBypass,
      },
      '/settings': {
        target: 'http://localhost:3000',
        bypass: apiOrSpaBypass,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
