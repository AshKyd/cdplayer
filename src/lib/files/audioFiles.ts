/**
 * File extensions the player tries to play. Rust (symphonia) decides in the end whether it can decode one.
 * Keep in step with `AUDIO_EXTENSIONS` in `src-tauri/src/files/mod.rs`, which checks a path again when it is opened.
 */
const AUDIO_EXTENSIONS = ["mp3", "m4a", "mp4", "aac", "flac", "ogg", "oga", "wav", "aif", "aiff", "caf", "mka"];

const extensionOf = (path: string): string => path.split(".").at(-1)?.toLowerCase() ?? "";

/** True for a path that looks like an audio file, by its extension. */
export const isAudioPath = (path: string): boolean => path.includes(".") && AUDIO_EXTENSIONS.includes(extensionOf(path));

/**
 * The audio files among `paths`, in the order given. A dropped folder has no audio extension, so it is
 * left out.
 */
export const audioPathsFrom = (paths: Iterable<string>): string[] => [...paths].filter(isAudioPath);
