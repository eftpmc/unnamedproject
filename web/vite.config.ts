import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/sessions': 'http://localhost:3000',
      '/messages': 'http://localhost:3000',
      '/connections': 'http://localhost:3000',
      '/projects': 'http://localhost:3000',
      '/settings': 'http://localhost:3000',
      '/executions': 'http://localhost:3000',
      '/memory': 'http://localhost:3000',
      '/scheduled_tasks': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
});
