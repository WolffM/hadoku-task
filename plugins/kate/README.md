# Hadoku Tasks — Kate plugin

A native `KTextEditor::Plugin` (C++/CMake) that adds **Tasks** and **Calendar**
tool views to Kate's left sidebar, backed by the hosted `@wolffm/task` API. Lives
in this repo (not a separate one) but is invisible to pnpm — it has its own CMake
build and CI workflow. See `../../docs/planning/local-integration-design.md` for
the full design.

## Status

**Phase 1 — embedding spike.** Both tool views currently load `qml/SpikeView.qml`,
a minimal Kirigami scene that exists only to prove the QQuickWidget-in-tool-view
path (focus, typing/IME, HiDPI, render flush) before the real model/UI is built.
Nothing here talks to the API yet.

## Build & install (local, no sudo)

Requires the KF6/Qt6 dev toolchain (Debian 13: `extra-cmake-modules`,
`qt6-base-dev`, `qt6-declarative-dev`, `libkf6texteditor-dev`,
`libkf6coreaddons-dev`, `libkf6i18n-dev`, `libkf6xmlgui-dev`,
`libkf6wallet-dev`, plus the Kirigami runtime `qml6-module-org-kde-kirigami`).

```sh
cd plugins/kate
cmake -B build -S . -DCMAKE_INSTALL_PREFIX="$HOME/.local"
cmake --build build
cmake --install build
```

This installs `katehadokutask.so` into
`~/.local/lib/x86_64-linux-gnu/qt6/plugins/kf6/ktexteditor/`.

If Kate doesn't pick up `~/.local`, make sure it's on the Qt plugin path:

```sh
export QT_PLUGIN_PATH="$HOME/.local/lib/x86_64-linux-gnu/qt6/plugins:$QT_PLUGIN_PATH"
```

## Enable in Kate

Restart Kate, then **Settings → Configure Kate → Plugins** and tick
**Hadoku Tasks**. Two tabs (Tasks, Calendar) appear on the left sidebar.

## Spike checklist (what to verify before building further)

- [ ] Plugin loads; both tool-view tabs appear with icons.
- [ ] Clicking a tab shows the Kirigami scene (heading, label, text field, button).
- [ ] Tab focus moves into the text field and back to the editor cleanly.
- [ ] Typing (and IME, if you use one) works in the field.
- [ ] HiDPI: text/controls scale correctly on a scaled display.
- [ ] No flicker/black-frame on first paint or when toggling the tab.
- [ ] Decide: keep `QQuickWidget`, or switch to `createWindowContainer` + `QQuickView`.

## Layout

```
plugins/kate/
  CMakeLists.txt          # KF6/Qt6 build; installs to the ktexteditor plugin dir
  resources.qrc           # embeds qml/ into the .so
  qml/SpikeView.qml       # Phase-1 embedding spike (placeholder UI)
  src/
    taskplugin.{h,cpp}        # KTextEditor::Plugin entry point + factory
    taskpluginview.{h,cpp}    # per-window controller; creates the tool views
    taskplugin.json           # KPlugin metadata (embedded)
```
