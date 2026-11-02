# Optical volumes

Finds data and MP3 CDs, which the operating system mounts as folders. Audio CDs are not included: they are read sector by sector ([cd-bridge.md](cd-bridge.md)), and `get_toc` ignores a disc with no audio track.

## Files

- `src-tauri/src/volumes/optical.rs`: `OpticalVolume`, `list_optical_volumes()`, and the parsers for each platform.
- `src-tauri/src/commands.rs`: the `list_optical_volumes` command.
- `src-tauri/capabilities/default.json`: `fs:allow-read-dir`, `fs:allow-read-file`, `fs:allow-exists`.
- `src/lib/volumes/types.ts`: the matching `OpticalVolume` type.

## API

- `list_optical_volumes() -> { mount_path, label }[]`. `mount_path` is the folder with the disc's files. `label` is the disc's name.
- It also adds each returned `mount_path` to the fs plugin's scope (`app.fs_scope().allow_directory`, recursive). The plugin has no other scope, so the frontend can list a mounted disc's folders and read its playlists, and nothing else.
- Playing a file does not go through the fs plugin: `open_audio_file` opens it in Rust.

## Behaviour

- macOS: parses `/sbin/mount` for `cd9660` and `udf`. `cddafs` (macOS's own audio CD mount) is left out.
- Linux: parses `/proc/mounts` for `iso9660` and `udf`. `\040` style escapes in the mount path are decoded.
- Windows: drives of type `DRIVE_CDROM` that have a disc, found with `GetLogicalDrives`, `GetDriveTypeW` and `GetVolumeInformationW` (declared directly, no extra crate).
- Reading the list does not touch the disc, so it is safe to poll during playback.

## Limits

- The Windows code has not been run.
- A mixed-mode (CD-Extra) disc is an audio disc to `get_toc`; whether the OS also mounts its data session is up to the OS. The page ignores mounted discs while an audio disc is loaded.
- Read access stays granted for the rest of the session after a disc is ejected. The path no longer exists, so there is nothing to read.
