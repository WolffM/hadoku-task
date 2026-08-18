import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, appendFileSync } from 'fs'
import { resolve, dirname } from 'path'

export default defineConfig({
  plugins: [
    react(),
    // Dev-only local log sink. The client logger's dev sink POSTs every entry
    // here (see src/utils/devLogSink.ts); we append one JSON line per event to
    // .dev-logs/actions.log so local actions are tail-able without edge-router.
    // `apply: 'serve'` keeps this out of production builds entirely.
    {
      name: 'dev-log-sink',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__devlog', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.end()
            return
          }
          let body = ''
          req.on('data', chunk => (body += chunk))
          req.on('end', () => {
            try {
              const dir = resolve(__dirname, '.dev-logs')
              mkdirSync(dir, { recursive: true })
              appendFileSync(resolve(dir, 'actions.log'), body.trim() + '\n')
            } catch {
              /* dev-only best-effort; never break the request */
            }
            res.statusCode = 204
            res.end()
          })
        })
      }
    },
    // Copy manually-maintained type definitions to dist
    // IMPORTANT: src/app/entry.d.ts must be committed to the repo
    // (see .gitignore exception and docs/BUILD_REQUIREMENTS.md)
    {
      name: 'copy-types',
      writeBundle() {
        const dest = resolve(__dirname, 'dist/app/entry.d.ts')
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(resolve(__dirname, 'src/app/entry.d.ts'), dest)
      }
    },
    // Re-minify JS to strip whitespace (Vite preserves whitespace in ES lib mode)
    {
      name: 'minify-es-lib',
      async renderChunk(code) {
        const esbuild = await import('esbuild')
        const result = await esbuild.transform(code, {
          minify: true,
          target: 'es2022'
        })
        return { code: result.code, map: null }
      }
    }
  ],
  server: {
    proxy: {
      '/task/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: false,
        timeout: 5000
      },
      // The prefs worker CORS-allowlists DEFAULT_HADOKU_ORIGINS, which contains no
      // localhost entry, so any dev shell calling http://localhost:3003 directly is
      // preflight-rejected and degrades to localStorage. Proxying makes it
      // same-origin, so a dev page exercises the real fetch -> edge-auth -> D1 path.
      // Used by the icon gallery; the e2e helper still points straight at :3003.
      '/prefs': {
        target: 'http://127.0.0.1:3003',
        changeOrigin: true,
        ws: false,
        timeout: 5000
      }
    }
  },
  resolve: {
    // HadokuThemeContext is DEFINED in task-ui-components and PROVIDED by
    // themes' <HadokuThemeRoot>. If the bundle ever carries two copies of
    // task-ui-components (themes resolving a published tarball while the app
    // resolves the workspace source), provider and consumer hold different
    // React contexts and every mount dies with "No <HadokuThemeRoot> above
    // this component" — that took prod down on 2026-08-05 (4.0.0–4.1.1).
    // Manifest hygiene (workspace:* in themes/package.json) is the real fix;
    // this guarantees one instance even if that regresses.
    dedupe: ['@wolffm/task-ui-components', '@wolffm/themes']
  },
  build: {
    // The favicon in public/ is for the `vite dev` harness only. This bundle is
    // a library mounted into hadoku.me, which serves its own favicon from the
    // site root — so copying public/ into dist/ would ship a stray asset in the
    // published package that nothing would ever read.
    copyPublicDir: false,
    lib: {
      entry: 'src/app/entry.tsx',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    rollupOptions: {
      // React is provided by hadoku-site via import maps, so externalize it.
      // 'react-dom' (bare) is needed for flushSync in entry.tsx and maps to
      // /mf/vendor/react-dom.mjs in the host importmap.
      // Provided by the parent page's import map (hadoku_site
      // src/layouts/Base.astro). Each of these is a SINGLETON: React and the
      // theme context match on module identity, and prefs-client and the logger
      // each hold their own cache. Inlining one gives the page a second copy
      // that the first never talks to — which is how aggregator and printtool
      // threw "No <HadokuThemeRoot> above this component" on 2026-08-05 with
      // the provider plainly mounted.
      // Enforced by hadoku_site's check:mf-externals.
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@wolffm/themes',
        '@wolffm/task-ui-components',
        '@wolffm/logger/client',
        '@wolffm/prefs-client',
        '@wolffm/prefs-client/react',
        // zod is in the parent's import map too, and reaches this bundle through
        // src/prefs/taskPrefs.ts. Not a singleton — a second copy does not fork
        // state, it is just weight, and weight for nothing: @wolffm/themes
        // imports zod BARE from its themePrefs.js, so the page fetches
        // esm.sh/zod whether or not this bundle carries its own copy. Verified
        // 2026-08-18: /task inlining zod issued the same 16 esm.sh/zod requests
        // as an app that externalizes it. The rule is mechanical — anything the
        // import map provides that you import belongs here.
        'zod'
      ],
      output: {
        assetFileNames: 'style.css',
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js'
      }
    },
    target: 'es2022'
  }
})
