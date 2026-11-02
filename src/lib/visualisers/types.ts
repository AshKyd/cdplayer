/** The track that is playing (or ready to play). */
export interface VisualiserTrackInfo {
  /** Track number on the disc. */
  number: number | null;
  title: string;
  artist: string;
  durationSeconds: number;
}
