import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
import svgrPlugin from 'vite-plugin-svgr';

import { ONTIME_VERSION } from './src/ONTIME_VERSION';
import { getPrecacheList } from './src/service-worker/swRules';

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const isDev = process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'development';

/**
 * Builds src/service-worker/sw.ts to a stable /sw.js at the root of the build
 * and injects the Ontime version and the list of build files to precache
 * The worker is only generated for builds, it does not exist in vite dev
 */
function serviceWorkerPlugin() {
  const entry = fileURLToPath(new URL('./src/service-worker/sw.ts', import.meta.url));
  const fileName = 'sw.js';

  return {
    name: 'ontime-service-worker',
    apply: 'build',
    buildStart() {
      this.emitFile({ type: 'chunk', id: entry, fileName });
    },
    generateBundle(_options, bundle) {
      const worker = bundle[fileName];
      if (!worker || worker.type !== 'chunk') {
        this.error('Service worker chunk was not generated');
      }

      const precache = getPrecacheList(Object.keys(bundle));
      // the build hash ensures a rebuild of the same version still replaces the cache
      const buildHash = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 8);
      const version = `${ONTIME_VERSION}-${buildHash}`;

      if (!worker.code.includes('__ONTIME_SW_VERSION__') || !worker.code.includes('__ONTIME_SW_PRECACHE__')) {
        this.error('Service worker placeholders not found');
      }
      worker.code = worker.code
        .replaceAll('__ONTIME_SW_VERSION__', JSON.stringify(version))
        .replaceAll('__ONTIME_SW_PRECACHE__', JSON.stringify(precache));
    },
  };
}

export default defineConfig({
  base: './', // Ontime cloud: we use relative paths to allow them to reference a dynamic base set at runtime
  plugins: [
    react(),
    svgrPlugin(),
    // must run before the compression plugin so the compressed worker contains the injected values
    serviceWorkerPlugin(),
    !isDev &&
      sentryVitePlugin({
        org: 'get-ontime',
        project: 'ontime',
        include: './build',
        authToken: sentryAuthToken,
        release: ONTIME_VERSION,
        deploy: {
          env: 'production',
        },
        bundleSizeOptimizations: {
          excludeDebugStatements: true,
          excludeReplayIframe: true,
          excludeReplayShadowDom: true,
          excludeReplayWorker: true,
        },
      }),
    compression({
      algorithm: 'brotliCompress',
      exclude: /\.(html)$/, // Ontime cloud: Exclude HTML files from compression so we can change the base property at runtime
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
  build: {
    outDir: './build',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split vendor code
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: {
    legalComments: 'none',
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `
        @use './src/theme/ontimeColours' as *;
        @use './src/theme/ontimeStyles' as *;
        @use './src/theme/mixins' as *;
        `,
      },
    },
  },
});
