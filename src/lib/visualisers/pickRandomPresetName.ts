/** A random name from `names`, avoiding `previous` so the same preset doesn't play twice in a row. */
export function pickRandomPresetName(names: string[], previous?: string, random: () => number = Math.random): string | null {
  const candidates = names.filter((name) => name !== previous);
  const pool = candidates.length > 0 ? candidates : names;
  return pool[Math.floor(random() * pool.length)] ?? null;
}
