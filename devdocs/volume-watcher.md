# Volume watcher and loader

Plays data and MP3 CDs: notices a mounted disc, works out which files to play and in what order, and hands them to the `FilePlayer` ([file-player.md](file-player.md)). All of it is JS; Rust only lists the mounted discs ([optical-volumes.md](optical-volumes.md)).

## Files

- `src/lib/volumes/VolumeWatcher.svelte.ts`: polls `list_optical_volumes`.
- `src/lib/volumes/VolumeFilesLoader.svelte.ts`: owns a watcher and decides when to load a disc.
- `src/lib/volumes/listAudioFiles.ts`: `listAudioFiles(mountPath, fs)`.
- `src/lib/volumes/playlist.ts`: M3U, M3U8 and PLS parsing, and `resolvePlaylistEntry()`.
- `src/lib/volumes/paths.ts`: path cleaning and natural sort.
- `src/lib/volumes/fileSystem.ts`: the `VolumeFileSystem` interface and the Tauri fs plugin implementation. Tests pass a fake.

## API

- `new VolumeWatcher({ loadVolumes, intervalMs, onChange })`: all optional. `start()`, `stop()`, `checkNow()`. `onChange(volumes)` runs when the set of mount paths changes, including the first check; `checkNow()` waits for it.
- `new VolumeFilesLoader({ loadVolumes, intervalMs, listFiles, canLoad, onFiles, onRemoved })`: `onFiles(paths, volume)` and `onRemoved(volume)` are required. `loaded` (`$state`) is the disc whose files were handed over and is still mounted.
- `listAudioFiles(mountPath)`: the paths to play, in order.

## Behaviour

- The watcher polls every 3 s, also during playback. The list comes from the OS mount table, so it never touches the disc, and it is how an eject is noticed.
- The loader tries each new disc once per insertion. It does nothing when `canLoad()` is false. The page's `canLoad` is: no audio disc in the drive (`noDisc`, not still reading), and the `FilePlayer` is not active. A disc mounted at that moment is not retried later.
- The page's `onFiles` replaces the file player's playlist, switches to files mode and enqueues the paths, playing them only if autoplay is on in settings. `onRemoved` clears the playlist and goes back to the drive, if the playlist holds files from that disc.
- `listAudioFiles` order:
  1. Playlists in the top level of the disc only: `.m3u`, then `.m3u8`, then `.pls`, then by name. The first with at least one playable entry decides the order.
  2. Otherwise every audio file on the disc, found by walking all folders, sorted by path (folder by folder, case-insensitive, digits as numbers, so `2.mp3` is before `10.mp3`).
- Playlist entries: relative to the playlist's folder; `\` counts as `/`; URLs are dropped; entries outside the disc, without an audio extension (`isAudioPath`) or that don't exist are dropped. M3U/M3U8 ignore `#` lines. PLS is ordered by `FileN`. Text is UTF-8, else Windows-1252.
- Hidden files (names starting with `.`, which includes macOS `._` copies) are skipped. Symlinks are not followed.
- A disc that can't be read lists no files and is not loaded.

## Limits

- Only M3U, M3U8 and PLS. XSPF, WPL and ASX are not read.
- No tags, so titles are file names ([file-player.md](file-player.md)).
- Folders are read all at once, which can be slow on a large disc.
- The disc's label is only shown until the first file starts; then the file name is.
