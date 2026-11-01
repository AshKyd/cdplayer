export interface TrackMetadata {
  /** Track number on the disc. */
  number: number;
  title: string;
  /** The track's artist; the same as the album's unless this is a compilation. */
  artist: string;
}

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
  /** A small front cover from the Cover Art Archive, or `null` if the release has none. */
  coverUrl: string | null;
}
