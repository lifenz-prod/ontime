import { baseURI, isProduction } from '../externals';

/**
 * Registers the offline-fallback service worker
 * - only in production builds, the worker is not generated in vite dev
 *   we check the vite mode rather than import.meta.env.PROD since the local and electron builds set NODE_ENV=local
 * - fails silently: browsers only allow workers in secure contexts (https or localhost)
 *   so a view reached by LAN IP over plain http simply runs without it
 */
export function registerServiceWorker() {
  if (!isProduction) {
    return;
  }

  try {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register(`${baseURI}/sw.js`, { scope: `${baseURI}/` }).catch(() => {
        /** a missing worker should not affect the app */
      });
    };

    // wait for the page to load so registering does not compete with the initial render
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  } catch (_error) {
    /** a missing worker should not affect the app */
  }
}
