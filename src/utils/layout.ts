/**
 * Layout configuration utilities
 */

export interface LayoutConfig {
  useTags: number
  maxPerColumn: number
  rows: Array<{ columns: number; tagIndices: number[] }>
}

/**
 * Get the layout configuration based on the number of tags
 *
 * Mobile (isMobile=true): Always single-column stacked layout
 * Desktop (isMobile=false):
 *   1 tag: 1 row × 1 column (full width)
 *   2 tags: 1 row × 2 columns (half split)
 *   3 tags: 1 row × 3 columns (thirds)
 *   4 tags: Row 1: 3 columns, Row 2: 1 column
 *   5 tags: Row 1: 3 columns, Row 2: 2 columns
 *   6+ tags: 2 rows × 3 columns (thirds on both rows) - show top 6
 *
 * `uncapped` lifts that top-6 ceiling and lays every tag out in rows of three.
 * A standard board ranks tags by frequency, so showing only the top 6 is a real
 * choice; an AUTOMATION board's lanes are its declared structure, and dropping
 * lanes 7+ hides them *and* the tasks sitting in them. Rows-of-three reproduces
 * the 4/5/6-tag layouts exactly ([3,1], [3,2], [3,3]) and just keeps going.
 */
export function getLayoutConfig(
  tagCount: number,
  isMobile = false,
  uncapped = false
): LayoutConfig {
  if (tagCount === 0) {
    return { useTags: 0, maxPerColumn: Infinity, rows: [] }
  }

  // Mobile: always single-column stacked layout
  if (isMobile) {
    const rows = Array.from({ length: tagCount }, (_, i) => ({
      columns: 1,
      tagIndices: [i]
    }))

    return {
      useTags: tagCount,
      maxPerColumn: Infinity,
      rows
    }
  }

  // Desktop layouts
  if (tagCount === 1) {
    return {
      useTags: 1,
      maxPerColumn: Infinity,
      rows: [{ columns: 1, tagIndices: [0] }]
    }
  }

  if (tagCount === 2) {
    return {
      useTags: 2,
      maxPerColumn: Infinity,
      rows: [{ columns: 2, tagIndices: [0, 1] }]
    }
  }

  if (tagCount === 3) {
    return {
      useTags: 3,
      maxPerColumn: Infinity,
      rows: [{ columns: 3, tagIndices: [0, 1, 2] }]
    }
  }

  if (tagCount === 4) {
    return {
      useTags: 4,
      maxPerColumn: 10,
      rows: [
        { columns: 3, tagIndices: [0, 1, 2] },
        { columns: 1, tagIndices: [3] }
      ]
    }
  }

  if (tagCount === 5) {
    return {
      useTags: 5,
      maxPerColumn: 10,
      rows: [
        { columns: 3, tagIndices: [0, 1, 2] },
        { columns: 2, tagIndices: [3, 4] }
      ]
    }
  }

  // 6+ tags, uncapped (automation lanes): every tag, in rows of three.
  if (uncapped) {
    const rows: LayoutConfig['rows'] = []
    for (let i = 0; i < tagCount; i += 3) {
      const tagIndices = Array.from(
        { length: Math.min(3, tagCount - i) },
        (_, offset) => i + offset
      )
      rows.push({ columns: 3, tagIndices })
    }
    return { useTags: tagCount, maxPerColumn: 10, rows }
  }

  // 6+ tags: show top 6 in 2 rows of 3
  return {
    useTags: 6,
    maxPerColumn: 10,
    rows: [
      { columns: 3, tagIndices: [0, 1, 2] },
      { columns: 3, tagIndices: [3, 4, 5] }
    ]
  }
}
