import path from 'node:path'
import { loadEnv, type Plugin } from 'vite'
import { createPublishingHandler, createStore } from './server/publishing.mjs'

/** Development and production use the same publishing implementation. */
export function exportToDisplayPlugin(): Plugin {
  return {
    name: 'trip-guide-export',
    configureServer(server) {
      const root = server.config.root
      const env = loadEnv(server.config.mode, root, '')
      const store = createStore({
        spotsDir: path.join(root, 'public/spots'),
        trashDir: path.join(root, '.trash/spots'),
      })
      const handler = createPublishingHandler({
        store,
        adminToken: process.env.PUBLISH_ADMIN_TOKEN || env.PUBLISH_ADMIN_TOKEN || '',
      })
      server.middlewares.use((req, res, next) => {
        void handler(req, res).then((handled: boolean) => { if (!handled) next() }).catch(next)
      })
    },
  }
}
