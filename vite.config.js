import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/PokerDemo/',
  cacheDir: 'node_modules/.vite',
  optimizeDeps: {
    include: ['react', 'react/jsx-dev-runtime', 'react-dom/client'],
    esbuildOptions: {
      plugins: [
        {
          name: 'react-cjs-relative-resolver',
          setup(build) {
            build.onResolve({ filter: /^\.\/cjs\/.*\.js$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path),
            }));
          },
        },
      ],
    },
  },
  server: {
    fs: {
      allow: ['.'],
    },
  },
});
