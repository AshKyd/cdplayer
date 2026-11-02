use crate::disc::{Toc, reader::DiscHandle};
use crate::files::{FileRegistry, OpenedFile};
use tauri::State;

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

/// Lets go of a file opened with `open_audio_file`.
#[tauri::command]
pub fn close_audio_file(id: u32, registry: State<'_, FileRegistry>) {
    registry.close(id);
}
