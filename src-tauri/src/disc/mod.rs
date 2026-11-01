//! Audio CD access via the pure-Rust `cd-da-reader` crate.
//!
//! Sector addresses are the crate's LBAs, exactly as reported by its TOC. The protocol only
//! ever adds offsets to them, so their origin doesn't matter outside this module.

pub mod reader;

use cd_da_reader::{CdReader, ReadOptions, ReadSpeed};
use serde::Serialize;
use std::fmt::Debug;

/// CD-DA sectors per second of audio.
pub const SECTORS_PER_SECOND: u32 = 75;
/// Largest chunk the protocol will serve: 5 s of audio (882,000 bytes).
pub const MAX_CHUNK_SECTORS: u32 = 5 * SECTORS_PER_SECOND;

/// Sectors the crate leaves out between the last audio track and the data session of a CD-Extra disc.
const SESSION_GAP_SECTORS: u32 = 11_400;

/// Drive speed multiplier requested so reads run well ahead of real time (a request only; drives may ignore it).
const REQUESTED_READ_SPEED: u8 = 52;

#[derive(Debug, Clone, Serialize)]
pub struct Track {
    pub number: u8,
    pub first_sector: i32,
    pub last_sector: i32,
    pub is_audio: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Toc {
    pub tracks: Vec<Track>,
    pub leadout_sector: i32,
}

pub struct Disc {
    reader: CdReader,
    read_options: ReadOptions,
}

fn describe(error: impl Debug) -> String {
    format!("{error:?}")
}

impl Disc {
    /// Opens the first drive that contains an audio CD.
    pub fn open_default() -> Result<Self, String> {
        let reader = CdReader::open_default().map_err(describe)?;
        let read_options = ReadOptions::default().with_read_speed(ReadSpeed::CustomMultiplier(REQUESTED_READ_SPEED));
        Ok(Self { reader, read_options })
    }

    pub fn read_toc(&self) -> Result<Toc, String> {
        let toc = self.reader.read_toc().map_err(describe)?;

        // The crate gives start addresses only, so each track ends where the next begins
        // (or at the lead-out). Before a data session, the gap is excluded.
        let tracks = toc
            .tracks
            .iter()
            .enumerate()
            .map(|(index, track)| {
                let end_exclusive = match toc.tracks.get(index + 1) {
                    Some(next) if track.is_audio && !next.is_audio => next.start_lba.saturating_sub(SESSION_GAP_SECTORS),
                    Some(next) => next.start_lba,
                    None => toc.leadout_lba,
                };
                Track {
                    number: track.number,
                    first_sector: track.start_lba as i32,
                    last_sector: end_exclusive as i32 - 1,
                    is_audio: track.is_audio,
                }
            })
            .collect();

        Ok(Toc { tracks, leadout_sector: toc.leadout_lba as i32 })
    }

    /// Reads `sector_count` raw 16-bit/44.1kHz stereo PCM sectors (2352 bytes each), blocking.
    pub fn read_sectors(&self, start_sector: i32, sector_count: u32) -> Result<Vec<u8>, String> {
        self.reader
            .read_sector_range(start_sector as u32, sector_count, &self.read_options)
            .map_err(describe)
    }
}
