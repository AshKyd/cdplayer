//! Reads every tag in an audio file (ID3, Vorbis comments, MP4 atoms...) without decoding any audio.
//! Nothing is picked or renamed here: the frontend chooses which tags it wants (`src/lib/files/fileMetadata.ts`).

use serde::Serialize;
use serde_json::{Value, json};
use std::{fs::File, path::Path};
use symphonia::core::{
    formats::{FormatOptions, probe::Hint},
    io::MediaSourceStream,
    meta::{MetadataOptions, MetadataRevision, RawValue, Tag},
};

/// One tag, as the file stores it.
#[derive(Debug, Serialize, PartialEq)]
pub struct FileTag {
    /// The tag's own key, which differs by format: `TIT2` (ID3), `TITLE` (Vorbis), `©nam` (MP4).
    pub key: String,
    /// Text, numbers and flags as JSON. Binary values (such as embedded pictures) are not sent, only a note of their size.
    pub value: Value,
    /// symphonia's format-independent name for the tag when it knows it (`TrackTitle`, `Artist`, `Album`,
    /// `TrackNumber`...), so the frontend doesn't need every format's keys.
    pub standard: Option<String>,
}

/// Every tag in the file, oldest revision first (a leading ID3v2 tag comes before a trailing ID3v1 tag).
/// Opens and probes the file, so call off the main thread.
pub fn read_tags(path: &Path) -> Result<Vec<FileTag>, String> {
    let file = File::open(path).map_err(|error| format!("can't open the file: {error}"))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
        .map_err(|error| format!("unsupported file: {error}"))?;

    // Tags found before the audio (ID3v2) are queued on the reader along with the container's own, one revision each.
    let mut log = format.metadata();
    let mut revisions = std::iter::from_fn(|| log.pop()).collect::<Vec<_>>();
    revisions.extend(log.current().cloned());

    Ok(revisions.iter().flat_map(tags_of).collect())
}

/// The media-level tags of a revision, then any a single track carries.
fn tags_of(revision: &MetadataRevision) -> Vec<FileTag> {
    revision
        .media
        .tags
        .iter()
        .chain(revision.per_track.iter().flat_map(|track| track.metadata.tags.iter()))
        .map(file_tag)
        .collect()
}

fn file_tag(tag: &Tag) -> FileTag {
    FileTag {
        key: tag.raw.key.clone(),
        value: json_value(&tag.raw.value),
        // The Debug form is `Variant(value)`; the variant name is all that's wanted.
        standard: tag.std.as_ref().map(|standard| {
            let debug = format!("{standard:?}");
            debug.split('(').next().unwrap_or(&debug).to_string()
        }),
    }
}

fn json_value(value: &RawValue) -> Value {
    match value {
        RawValue::Binary(bytes) => json!(format!("<{} bytes of binary data>", bytes.len())),
        RawValue::Boolean(boolean) => json!(boolean),
        RawValue::Flag => json!(true),
        RawValue::Float(float) => json!(float),
        RawValue::SignedInt(int) => json!(int),
        RawValue::String(string) => json!(string.as_str()),
        RawValue::StringList(list) => json!(list),
        RawValue::UnsignedInt(uint) => json!(uint),
        // `RawValue` can grow; show anything new as text rather than dropping it.
        other => json!(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An ID3v2.3 tag holding a title and an artist. symphonia reads one in front of any container, which is how
    /// tags reach us (RIFF `INFO` tags in a WAV are dropped by symphonia 0.6.1, so a WAV can't carry them here).
    fn id3v2_tag() -> Vec<u8> {
        /// One text frame: id, size, flags, then the encoding byte (0 = Latin-1) and the text.
        fn text_frame(id: &[u8; 4], text: &str) -> Vec<u8> {
            let body = [&[0u8][..], text.as_bytes()].concat();
            [id.as_slice(), &(body.len() as u32).to_be_bytes(), &[0, 0], &body].concat()
        }

        let frames = [text_frame(b"TIT2", "Test Title"), text_frame(b"TPE1", "Test Artist")].concat();
        // The tag's size is a 28-bit "syncsafe" integer: 7 bits in each byte.
        let size = frames.len() as u32;
        let syncsafe = [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f].map(|part| part as u8);
        [b"ID3".as_slice(), &[3, 0, 0], &syncsafe, &frames].concat()
    }

    /// A tiny valid 16-bit mono WAV with an ID3v2 tag in front.
    fn tagged_wav() -> Vec<u8> {
        let data = vec![0u8; 4410 * 2];
        let fmt = [
            1u16.to_le_bytes().to_vec(),
            1u16.to_le_bytes().to_vec(),
            44100u32.to_le_bytes().to_vec(),
            88200u32.to_le_bytes().to_vec(),
            2u16.to_le_bytes().to_vec(),
            16u16.to_le_bytes().to_vec(),
        ]
        .concat();
        let chunks = [
            b"fmt ".to_vec(),
            (fmt.len() as u32).to_le_bytes().to_vec(),
            fmt,
            b"data".to_vec(),
            (data.len() as u32).to_le_bytes().to_vec(),
            data,
        ]
        .concat();
        let wav = [b"RIFF".to_vec(), (4 + chunks.len() as u32).to_le_bytes().to_vec(), b"WAVE".to_vec(), chunks].concat();
        [id3v2_tag(), wav].concat()
    }

    #[test]
    fn returns_every_tag_with_its_key_and_standard_name() {
        let path = std::env::temp_dir().join(format!("cdplayer-test-{}-tags.wav", std::process::id()));
        std::fs::write(&path, tagged_wav()).unwrap();

        let tags = read_tags(&path).unwrap();
        let title = tags.iter().find(|tag| tag.key == "TIT2").expect("the title tag");
        assert_eq!(title.value, json!("Test Title"));
        assert_eq!(title.standard.as_deref(), Some("TrackTitle"));
        let artist = tags.iter().find(|tag| tag.key == "TPE1").expect("the artist tag");
        assert_eq!(artist.value, json!("Test Artist"));
        assert_eq!(artist.standard.as_deref(), Some("Artist"));
    }
}
