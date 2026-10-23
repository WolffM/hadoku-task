import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

/**
 * The hosted theme editor (@wolffm/task/editor → dist/editor.js), built apart
 * from the app so the two never share a chunk — see the note on `lib.entry` in
 * vite.config.ts. Runs AFTER the app build and must not empty dist/.
 *
 * Everything else (externals, minify, dedupe) is inherited, so the editor
 * resolves React and @wolffm/themes from the host's import map like the app.
 */
export default mergeConfig(
  base,
  defineConfig({
    build: {
      emptyOutDir: false,
      lib: {
        entry: 'src/editor/entry.tsx',
        fileName: () => 'editor.js'
      },
      rollupOptions: {
        output: {
          entryFileNames: 'editor.js',
          chunkFileNames: 'editor-[name]-[hash].js'
        }
      }
    }
  })
)
