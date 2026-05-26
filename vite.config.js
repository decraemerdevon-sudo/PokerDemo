import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: 'node_modules/.vite',
  optimizeDeps: {
    include: [],
    noDiscovery: true,
  },
  server: {
    fs: {
      allow: ['.'],
    },
  },
});
