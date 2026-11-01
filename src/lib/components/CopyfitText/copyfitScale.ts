/**
 * How much to shrink text so it fits: 1 when it already fits, down to `minScale` (below that it is
 * clipped with an ellipsis instead of becoming unreadable).
 */
export function copyfitScale(availableWidth: number, naturalWidth: number, minScale: number): number {
  if (naturalWidth <= 0 || availableWidth >= naturalWidth) return 1;
  return Math.max(minScale, availableWidth / naturalWidth);
}
