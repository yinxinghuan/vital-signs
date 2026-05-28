import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/vital-signs/',
  plugins: [react()],
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'src/shared') },
  },
  css: {
    preprocessorOptions: {
      less: { javascriptEnabled: true },
    },
  },
});
