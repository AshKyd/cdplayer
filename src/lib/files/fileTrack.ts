/** One dropped audio file in the file player's playlist. */
export interface FileTrack {
  id: string;
  /** Where the file is on disk. Rust opens it by this path. */
  path: string;
  title: string;
  /** Length in seconds. 0 until the file has been opened for playing. */
  durationSeconds: number;
}

/** The file's name from a path, with either kind of separator. */
export const fileNameFromPath = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;

/** The file's name without its extension. There is no tag reading yet, so this is the only title. */
export const titleFromPath = (path: string): string => {
  const name = fileNameFromPath(path);
  return name.replace(/\.[^.]+$/, "") || name;
};

export const createFileTrack = (path: string): FileTrack => ({
  id: crypto.randomUUID(),
  path,
  title: titleFromPath(path),
  durationSeconds: 0,
});
