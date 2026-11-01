export interface TrackMetadata {
  /** Track number on the disc. */
  number: number;
  title: string;
  /** The track's artist; the same as the album's unless this is a compilation. */
  artist: string;
}

/** Frees a cover's blob URL once nothing shows it any more. Remote URLs and `null` are left alone. */
export const revokeCoverUrl = (metadata: DiscMetadata | null): void => {
  if (metadata?.coverUrl?.startsWith("blob:")) URL.revokeObjectURL(metadata.coverUrl);
};

/** What MusicBrainz knows about a disc. */
export interface DiscMetadata {
  discId: string;
  /** MusicBrainz release ID, for linking back to the release. */
  releaseId: string;
  album: string;
  artist: string;
  /** Release year, or empty if unknown. */
  year: string;
  tracks: TrackMetadata[];
  /** The highest quality front cover from the Cover Art Archive (a blob URL when cached), or `null` if the release has none. */
  coverUrl: string | null;
}
