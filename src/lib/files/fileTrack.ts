import { pickTrackInfo, type FileTag } from "./fileMetadata";

/** One dropped audio file in the file player's playlist. */
export interface FileTrack {
  id: string;
  /** Where the file is on disk. Rust opens it by this path. */
  path: string;
  /** The title tag, or the file's name until the tags are read (or when it has none). */
  title: string;
  /** Length in seconds. 0 until the file has been opened for playing. */
  durationSeconds: number;
  artist?: string;
  album?: string;
  albumArtist?: string;
  /** Position on the album, from the file's tags. */
  trackNumber?: number;
  year?: string;
  /** Every tag in the file, empty until read. */
  tags: FileTag[];
}

/** The file's name from a path, with either kind of separator. */
export const fileNameFromPath = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;

/** The file's name without its extension. The title until the file's tags are read, and when it has no title tag. */
export const titleFromPath = (path: string): string => {
  const name = fileNameFromPath(path);
  return name.replace(/\.[^.]+$/, "") || name;
};

export const createFileTrack = (path: string): FileTrack => ({
  id: crypto.randomUUID(),
  path,
  title: titleFromPath(path),
  durationSeconds: 0,
  tags: [],
});

/** `track` with what its file's tags say. A missing tag leaves the existing value, so a file with no title keeps its file name. */
export const applyTags = (track: FileTrack, tags: FileTag[]): FileTrack => {
  const { title, artist, album, albumArtist, trackNumber, year } = pickTrackInfo(tags);
  return {
    ...track,
    title: title ?? track.title,
    artist: artist ?? track.artist,
    album: album ?? track.album,
    albumArtist: albumArtist ?? track.albumArtist,
    trackNumber: trackNumber ?? track.trackNumber,
    year: year ?? track.year,
    tags,
  };
};
