# Theme Graveyard

Archived themes and removed tokens, no longer active in the Hadoku Theme System.

---

## Removed Tokens

### v3.0.0 — token set consolidated to a symmetric rectangle

**Removed**: 2026-07-21 | **Reason**: the token set was structurally asymmetric —
each family carried a different, unpredictable set of variants, so the symmetric
guess (`--color-danger-bg`) named something that didn't exist. Six tokens were
removed with **no back-compat aliases**; every consumer migrates.

| Removed token             | Replacement           | Note                                                |
| ------------------------- | --------------------- | --------------------------------------------------- |
| `--color-primary-light`   | `--color-primary-bg`  | tint surface, now uniform across families           |
| `--color-danger-light`    | `--color-danger-bg`   | same value, renamed onto the `<family>-bg` pattern  |
| `--color-danger-darker`   | `--color-danger-dark` | `danger` was the only family with two dark shades   |
| `--color-neutral-light`   | `--color-neutral-bg`  | for hover _surfaces_ use `--color-bg-hover` instead |
| `--color-neutral-lighter` | `--color-neutral-bg`  | third neutral shade, unused in practice             |
| `--color-muted-bg`        | `--color-neutral-bg`  | orphan name that broke the `<family>-bg` pattern    |

**Added** in the same release: `--color-warning-dark`, `--color-neutral-dark`,
`--color-danger-bg`, `--color-neutral-bg`, and `--color-on-<f>-bg` for all five
families (the tint's text color — see `THEME_USAGE_GUIDE.md`).

---

## Kitsune Theme Contest (2025)

4 contestants competed. **Winner: Kitsune Springs D** → renamed to **Izakaya** (active).

---

## Archived Themes

### Kitsune Springs A

**Archived**: 2025-11-06 | **Reason**: Lost contest

| Variant | Primary           | Success   | Danger             | Background |
| ------- | ----------------- | --------- | ------------------ | ---------- |
| Light   | `#32c2ac` (teal)  | `#5ed9bc` | `#8c49a1` (purple) | `#dadedd`  |
| Dark    | `#d45c3c` (coral) | `#dce8ce` | `#81201b`          | `#080404`  |

### Kitsune Springs B

**Archived**: 2025-11-06 | **Reason**: Lost contest

| Variant | Primary            | Success           | Danger    | Background        |
| ------- | ------------------ | ----------------- | --------- | ----------------- |
| Light   | `#bb70da` (purple) | `#64dbf2` (cyan)  | `#6f2f34` | `#e8cfc0` (peach) |
| Dark    | `#bf663b` (orange) | `#f6e0aa` (cream) | `#812c23` | `#251f21`         |

### Kitsune Springs C

**Archived**: 2025-11-06 | **Reason**: Lost contest

| Variant | Primary           | Success          | Danger    | Background |
| ------- | ----------------- | ---------------- | --------- | ---------- |
| Light   | `#e06b49` (coral) | `#49577d` (navy) | `#d75839` | `#e1d3cc`  |
| Dark    | `#2ecab9` (teal)  | `#55d8c5`        | `#9f6569` | `#2c211b`  |

---

## Restoring Archived Themes

These themes can be restored using THEME_CREATION_GUIDE.md. The key colors above provide enough context to regenerate full CSS definitions.

Steps:

1. Derive full variable set using the Theme Creation Guide
2. Add CSS to `themes/src/style.css`
3. Update `THEMES` array in `themes/src/index.ts`
4. Add theme family in `src/app/themeConfig.tsx`
