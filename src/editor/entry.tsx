/**
 * @wolffm/task/editor — the hosted theme editor, mounted by hadoku_site at
 * hadoku.me/task/editor (service tier, gated at the edge AND by the API).
 *
 * Built on its own by vite.editor.config.ts and imports NO stylesheet: the
 * hosting page loads the app's /mf/task/style.css (themes + icons + app), which
 * styles the preview's real components exactly as in the app — and a CSS
 * import here would make this build emit a style.css over the app's. The
 * editor's own chrome is injected at mount (`?inline`) instead.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import editorCss from './editor.css?inline'
import { ThemeEditor } from './ThemeEditor'
import { createEditorApi } from './api'

export interface ThemeEditorProps {
  /** Theme to open on. Defaults to `light`. */
  theme?: string
  /**
   * Dev stack only: ask the local edge shim for this tier (worker/test/dev-server.ts
   * reads `X-Dev-Tier`). Never set in production — the edge resolves the tier
   * from the session cookie and ignores the header.
   */
  devTier?: string
}

interface EditorElement extends HTMLElement {
  __root?: Root
  __style?: HTMLStyleElement
}

export function mount(el: HTMLElement, props: ThemeEditorProps = {}) {
  const host = el as EditorElement
  const style = document.createElement('style')
  style.dataset.hadokuThemeEditor = ''
  style.textContent = editorCss
  document.head.appendChild(style)
  host.__style = style

  el.replaceChildren()
  const root = createRoot(el)
  root.render(<ThemeEditor api={createEditorApi(props.devTier)} initialTheme={props.theme} />)
  host.__root = root
}

export function unmount(el: HTMLElement) {
  const host = el as EditorElement
  host.__root?.unmount()
  host.__style?.remove()
}
