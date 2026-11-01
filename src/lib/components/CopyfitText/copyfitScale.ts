/**
 * The largest scale (1 down to `minScale`, in `step`s) at which the text fits. Below `minScale` the text
 * is clipped with an ellipsis instead of becoming unreadable.
 * @param fitsAtScale Applies the scale to the text and reports whether it fits its box.
 */
export function copyfitScale(fitsAtScale: (scale: number) => boolean, minScale: number, step = 0.05): number {
  const steps = Math.max(0, Math.floor((1 - minScale) / step + 1e-9));
  const scales = Array.from({ length: steps + 1 }, (_, index) => Number((1 - index * step).toFixed(4)));
  const fitting = scales.find(fitsAtScale);
  return fitting ?? Math.min(1, minScale);
}
