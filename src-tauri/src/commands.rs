use crate::disc::{Toc, reader::DiscHandle};
use crate::files::{self, FileRegistry, FileTag, OpenedFile};
use crate::volumes::optical::{self, OpticalVolume};
use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

/// The reader thread's handle. It keeps working with no disc in the drive; `get_toc` looks for one.
pub struct DiscState(pub DiscHandle);

/// Re-opens the drive and reads the table of contents of whichever disc is in it now.
/// The drive read blocks, so it runs off the async runtime's threads; the frontend polls this
/// to notice a swapped or ejected disc, and shouldn't call it during playback.
#[tauri::command]
pub async fn get_toc(state: State<'_, DiscState>) -> Result<Toc, String> {
    let disc = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || disc.reload())
        .await
        .map_err(|error| error.to_string())?
}

/// Opens an audio file for decoding. Its audio is then read in chunks over the `file-track` protocol.
/// Opening reads the file's header, so it runs off the async runtime's threads.
#[tauri::command]
pub async fn open_audio_file(path: String, registry: State<'_, FileRegistry>) -> Result<OpenedFile, String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || registry.open(&path))
        .await
        .map_err(|error| error.to_string())?
}

/// Every tag in an audio file (title, artist, track number...), as the file stores them. The frontend picks
/// what it wants. Reads the file's header, so it runs off the async runtime's threads.
#[tauri::command]
pub async fn get_metadata(path: String) -> Result<Vec<FileTag>, String> {
    tauri::async_runtime::spawn_blocking(move || files::read_file_tags(&path))
        .await
        .map_err(|error| error.to_string())?
}

/// Optical discs the system has mounted as folders (data and MP3 CDs). Audio CDs are not included; see `get_toc`.
/// Each disc's folder is also opened up to the frontend's fs plugin, which has no other scope, so the frontend
/// can list the disc's files and read its playlists but nothing else on the machine.
#[tauri::command]
pub async fn list_optical_volumes(app: AppHandle) -> Result<Vec<OpticalVolume>, String> {
    let volumes = tauri::async_runtime::spawn_blocking(optical::list_optical_volumes)
        .await
        .map_err(|error| error.to_string())?;
    volumes
        .iter()
        .try_for_each(|volume| app.fs_scope().allow_directory(&volume.mount_path, true))
        .map_err(|error| error.to_string())?;
    Ok(volumes)
}

/// Lets go of a file opened with `open_audio_file`.
#[tauri::command]
pub fn close_audio_file(id: u32, registry: State<'_, FileRegistry>) {
    registry.close(id);
}
