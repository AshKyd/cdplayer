//! Decodes audio files for the frontend. See `devdocs/file-decoder.md`.
//!
//! The frontend opens a file by path (`open_audio_file`), then asks for chunks of PCM over the `file-track`
//! protocol. All decoding happens here, off the main thread, and only the little that is asked for is read.

pub mod protocol;
mod resampler;
pub mod session;

use serde::Serialize;
use session::FileSession;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, Ordering},
    },
};

/// File types the player accepts. symphonia decides in the end whether it can decode one.
/// Keep in step with `AUDIO_EXTENSIONS` in `src/lib/files/audioFiles.ts`, which filters what is dropped.
const AUDIO_EXTENSIONS: [&str; 12] =
    ["mp3", "m4a", "mp4", "aac", "flac", "ogg", "oga", "wav", "aif", "aiff", "caf", "mka"];

/// What the frontend learns when it opens a file.
#[derive(Debug, Serialize)]
pub struct OpenedFile {
    pub id: u32,
    /// 0 when the file doesn't say.
    pub duration_seconds: f64,
}

/// The open files. Cheap to clone: every clone shares the same files.
#[derive(Clone, Default)]
pub struct FileRegistry(Arc<Inner>);

#[derive(Default)]
struct Inner {
    sessions: Mutex<HashMap<u32, Arc<Mutex<FileSession>>>>,
    next_id: AtomicU32,
}

impl FileRegistry {
    /// Opens `path`, which must be an existing audio file. Reads the file's header, so call off the main thread.
    pub fn open(&self, path: &str) -> Result<OpenedFile, String> {
        let path = Path::new(path);
        let has_audio_extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()));
        if !has_audio_extension || !path.is_file() {
            return Err("not an audio file".into());
        }

        let session = FileSession::open(path)?;
        let duration_seconds = session.duration_seconds;
        let id = self.0.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions().insert(id, Arc::new(Mutex::new(session)));
        Ok(OpenedFile { id, duration_seconds })
    }

    pub fn get(&self, id: u32) -> Option<Arc<Mutex<FileSession>>> {
        self.sessions().get(&id).cloned()
    }

    pub fn close(&self, id: u32) {
        self.sessions().remove(&id);
    }

    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<u32, Arc<Mutex<FileSession>>>> {
        // A panic while a map was locked can't leave it half-changed, so carry on with it.
        self.0.sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_missing_files_and_other_types() {
        let registry = FileRegistry::default();
        assert!(registry.open("/no/such/file.mp3").is_err());

        let text = std::env::temp_dir().join(format!("cdplayer-test-{}-notes.txt", std::process::id()));
        std::fs::write(&text, "hello").unwrap();
        assert_eq!(registry.open(text.to_str().unwrap()).unwrap_err(), "not an audio file");
    }

    #[test]
    fn gives_each_file_its_own_id_and_forgets_closed_ones() {
        let registry = FileRegistry::default();
        let path = std::env::temp_dir().join(format!("cdplayer-test-{}-registry.wav", std::process::id()));
        std::fs::write(&path, silent_wav()).unwrap();

        let first = registry.open(path.to_str().unwrap()).unwrap();
        let second = registry.open(path.to_str().unwrap()).unwrap();
        assert_ne!(first.id, second.id);
        assert!(registry.get(first.id).is_some());

        registry.close(first.id);
        assert!(registry.get(first.id).is_none());
        assert!(registry.get(second.id).is_some());
    }

    /// A tiny valid 16-bit mono WAV.
    pub fn silent_wav() -> Vec<u8> {
        let data = vec![0u8; 4410 * 2];
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&44100u32.to_le_bytes());
        wav.extend_from_slice(&88200u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);
        wav
    }
}
