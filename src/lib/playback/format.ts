/** `m:ss`, or `h:mm:ss` from one hour up, rounding down to whole seconds. */
export const formatClock = (totalSeconds: number): string => {
  const wholeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = String(wholeSeconds % 60).padStart(2, "0");
  // Minutes are only zero-padded when an hour precedes them, so "62:05" reads as "1:02:05".
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
};
