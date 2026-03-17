# Metallic Gradient Window Effect — Retrospective

## Project Summary

Created a "gradient window" UI effect where cards act as windows into a shared viewport-fixed gradient, with metallic shimmer hover animations. Final deliverables: 3 gradient presets (Beach Day, Cotton Candy, Aurora) and 3 shimmer effects (Cascade Rich, Sat + Rich, Shift).

---

## Process & Iteration Method

### What Worked: Structured Experimentation

1. **Batch variations** — Testing 10 effects at once, then narrowing down
2. **A/B comparisons** — Showing baseline + variations side by side
3. **Rapid feedback loops** — Quick iterations based on specific critiques
4. **Progressive refinement** — 10 → 4 → 3 final effects over multiple rounds

### Iteration Framework Used

```
Round 1: Explore breadth (10 different techniques)
Round 2: Refine winners (5 concepts × 2 variations)
Round 3: Deep polish (4 concepts × 3 variations)
Round 4: Final selection (3 winners)
```

---

## Technical Learnings

### CSS `background-attachment: fixed`

**How it works:**

- Positions background relative to viewport, not element
- All elements with same gradient sample from same viewport position
- Creates "window into shared canvas" illusion

**Critical gotchas:**

- `transform` on element breaks fixed attachment (creates new stacking context)
- `transform: scale()` on hover causes gradient to "jump" to element-local
- Cannot animate a "shift" with fixed attachment — both states sample same viewport position

**Safe hover effects with fixed backgrounds:**

- `filter: brightness()`, `filter: saturate()` — don't break fixed
- `box-shadow` changes — work fine
- Pseudo-element overlays — work fine (the key technique)

### Pseudo-Element Overlay Architecture

The winning pattern for shimmer effects:

```css
.element {
  background: gradient;
  background-attachment: fixed;
  position: relative;
  overflow: hidden;
}

.element::after {
  content: '';
  position: absolute;
  inset: -100%; /* Larger than element for diagonal sweep */
  background: linear-gradient(135deg, ...shimmer...);
  transform: translateX(-50%) translateY(-50%);
  opacity: 0;
  transition:
    transform 2s,
    opacity 0.5s;
}

.element:hover::after {
  transform: translateX(50%) translateY(50%);
  opacity: 1;
}
```

**Key insight:** Use `inset: -100%` or larger to prevent edge clipping during diagonal animations.

### Animation Timing

**What felt good:**

- Shimmer sweep: 2-4 seconds (slower = more premium)
- Opacity fade-in: 0.3-0.5 seconds
- Saturation transitions: 0.6-0.8 seconds

**What felt bad:**

- Fast sweeps (< 1s) — looked cheap
- Instant opacity changes — jarring
- Looping animations — distracting for hover states

**Reverse animations:**

- Use `transition` not `animation` for hover effects
- Ensures smooth reverse when hover ends
- Match or slightly extend reverse duration

### Gradient Angle Consistency

**Critical learning:** Shimmer angle should match gradient angle.

```css
/* Gradient at 135deg */
background: linear-gradient(135deg, ...);

/* Shimmer MUST also be 135deg */
.shimmer::after {
  background: linear-gradient(135deg, transparent, white, transparent);
  /* Diagonal movement to match */
  transform: translateX(-50%) translateY(-50%);
}
```

Mismatched angles break the metallic illusion — light should "catch" along the same axis as the color bands.

### Multi-Wave Cascades

**Technique:** Multiple shimmer bands with varied properties

```css
/* In a single gradient */
background: linear-gradient(
  135deg,
  transparent 20%,
  rgba(255, 255, 255, 0.05) 26%,
  /* Wave 1: subtle */ transparent 32%,
  transparent 44%,
  rgba(255, 255, 255, 0.15) 50%,
  /* Wave 2: strong */ transparent 56%,
  transparent 68%,
  rgba(255, 255, 255, 0.08) 74%,
  /* Wave 3: medium */ transparent 80%
);
```

**Variation dimensions:**

- Opacity (0.03 → 0.18 range worked well)
- Width (narrow vs wide bands)
- Spacing (gaps between waves)
- Speed (via separate pseudo-elements with different transition durations)

### Two-Layer Shift Effect

For gradient displacement on hover while keeping scroll-reactivity:

```css
.element {
  /* Base: fixed attachment, scroll-reactive */
  background: gradient;
  background-attachment: fixed;
}

.element::after {
  /* Hover layer: scroll attachment, can animate position */
  background: gradient;
  background-size: 130% 130%;
  background-position: 30% 30%;
  opacity: 0;
  transition:
    opacity 0.4s,
    background-position 0.8s;
}

.element:hover::after {
  opacity: 1;
  background-position: 70% 70%;
}
```

**Tradeoff:** During hover, loses scroll-reactivity. Acceptable for short interactions.

---

## Design Principles Discovered

### 1. Subtlety > Drama

Effects that tested poorly:

- High opacity (> 0.2) shimmer bands
- Fast animations (< 1.5s)
- Large displacement shifts
- Pulsing/breathing loops

Effects that tested well:

- Low opacity (0.03 - 0.15) shimmer bands
- Slow, deliberate movement (2-4s)
- Gentle shifts (15-20% background-position change)
- Single sweep on hover, smooth reverse on leave

### 2. Physical Plausibility

Metallic effects need to respect how light behaves:

- Light catches along consistent angles
- Brighter highlights have soft falloff edges
- Movement suggests tilting a surface, not magic

### 3. Layered Complexity

Single effects feel flat. Winning effects combined:

- Base saturation/brightness shift (immediate feedback)
- Multi-band shimmer sweep (visual interest)
- Box-shadow enhancement (depth cue)

### 4. Reverse Transitions Matter

Hover-off is as important as hover-on:

- Abrupt snap-back feels broken
- Reverse should be equal or slightly slower
- Opacity should fade smoothly, not cut

---

## Effect Categories for Future Themes

### Shimmer/Sweep Effects

- Single band diagonal sweep
- Multi-band cascade (varied opacity/speed)
- Horizontal/vertical wipes

### Color Modulation

- Saturation boost
- Brightness shift
- Hue rotation (use sparingly)

### Spatial Effects

- Gradient position shift
- Scale (careful with fixed attachment)
- Parallax (mouse-driven)

### Light Simulation

- Mouse-position glow (mask-based reveal)
- Directional highlights (fixed angle, mouse-positioned)
- Edge illumination (inset box-shadow)

### Texture Reveal

- Brushed metal (repeating-linear-gradient)
- Noise overlay (SVG filter or gradient)
- Mask-based spotlight

---

## Failed Approaches (Avoid These)

| Attempt                                   | Why It Failed                                                |
| ----------------------------------------- | ------------------------------------------------------------ |
| `transform: scale()` on hover             | Breaks `background-attachment: fixed`                        |
| `transform: translateY()` for lift        | Gradient stays fixed, element moves = jarring pop            |
| Fixed attachment + position animation     | Both states sample same viewport position = no visible shift |
| Fast shimmer (< 1s)                       | Looks cheap, overwhelming                                    |
| Looping shimmer animation                 | Distracting, doesn't feel like response to hover             |
| Circular mouse glow (no texture)          | Looks like flashlight, not metallic                          |
| Horizontal-only wave on diagonal gradient | Angle mismatch breaks illusion                               |

---

## Gradient Design Notes

### OKLCH Color Space

Used `oklch(lightness chroma hue)` for perceptually uniform gradients:

- Lightness: 0.5-0.9 range for UI elements
- Chroma: 0.08-0.22 (higher = more saturated)
- Hue: 0-360 degrees

### What Made Gradients "Pretty"

**Beach Day:** Wide hue journey (yellow → coral → teal), high chroma
**Cotton Candy:** Soft pastels, low chroma variation, smooth transitions
**Aurora:** Cool-to-warm journey, medium chroma, mysterious feel

### Gradient Tuning Parameters

- **Flatten spectrum:** Reduce chroma, compress hue range
- **Soften:** Increase lightness, reduce chroma
- **Deepen:** Decrease lightness, increase chroma
- **Rotate:** Change angle (45°, 90°, 135°, 180°)
- **Reverse:** Flip color stop order

---

## Checklist for Future Animation Design

### Before Starting

- [ ] Define the physical metaphor (metallic, glass, fabric, etc.)
- [ ] Choose base gradient angle
- [ ] Decide on hover-only vs continuous animation

### During Development

- [ ] Match shimmer angle to gradient angle
- [ ] Test with `inset: -100%` or larger for diagonal sweeps
- [ ] Use `transition` not `animation` for hover states
- [ ] Layer multiple subtle effects rather than one dramatic one
- [ ] Test reverse transition (hover-off)

### Polish Pass

- [ ] Slow down animations (2-4s for sweeps)
- [ ] Reduce opacity (0.03-0.15 for shimmer bands)
- [ ] Soften edges (wider gradient transition zones)
- [ ] Add secondary effects (saturation, shadow)
- [ ] Verify no jarring snap-back on hover-off

### Testing

- [ ] Test all gradient presets
- [ ] Test at different viewport positions (scroll)
- [ ] Test rapid hover on/off
- [ ] Test on different sized elements

---

## File References

- Final component: `GradientWindowDemo.jsx`
- This retrospective: `gradient-window-retrospective.md`
- Session transcript: `/mnt/transcripts/2026-02-19-16-48-15-gradient-window-parallax-shimmer.txt`
