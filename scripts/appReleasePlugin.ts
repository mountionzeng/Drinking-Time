import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';

/** The HTML and release endpoint share one identity; a loaded tab never adopts a newer identity. */
export function appReleasePlugin(): Plugin {
  const version = randomUUID();
  return {
    name: 'app-release-identity',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'app-release', content: version }, injectTo: 'head' }];
    },
    configureServer(server) {
      // Vite applies source changes through HMR. Editing a component is not a
      // deployment: rotating here permanently blocked every mutation in open tabs.
      // A server restart or a production build still creates a new identity.
      server.middlewares.use('/app-release.json', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ version }));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'app-release.json', source: JSON.stringify({ version }) });
    },
  };
}
