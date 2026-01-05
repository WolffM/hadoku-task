# Theme Graveyard

Archived themes no longer active in the Hadoku Theme System.

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
