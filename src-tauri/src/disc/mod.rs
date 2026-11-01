//! Audio CD access via the pure-Rust `cd-da-reader` crate.
//!
//! Sector addresses are the crate's LBAs, exactly as reported by its TOC. The protocol only
//! ever adds offsets to them, so their origin doesn't matter outside this module.

#[cfg(test)]
pub mod fake;
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

}

/// Where the reader thread gets sectors from: the real `Disc`, or a fake in tests.
pub trait SectorSource {
    /// Reads `sector_count` raw 16-bit/44.1kHz stereo PCM sectors (2352 bytes each), blocking.
    fn read_sectors(&self, start_sector: i32, sector_count: u32) -> Result<ReadOutcome, String>;
}

impl SectorSource for Disc {
    /// The crate already retries each read (4 attempts, shrinking the request); sectors that still
    /// fail are replaced with silence, see `read_salvaging`.
    fn read_sectors(&self, start_sector: i32, sector_count: u32) -> Result<ReadOutcome, String> {
        read_salvaging(start_sector, sector_count, &mut |start, count| {
            self.reader
                .read_sector_range(start as u32, count, &self.read_options)
                .map_err(describe)
        })
    }
}

/// Raw PCM for a sector range, plus how many of its sectors could not be read and are silence.
#[derive(Debug, PartialEq)]
pub struct ReadOutcome {
    pub pcm: Vec<u8>,
    pub unreadable_sectors: u32,
}

/// Most unreadable sectors tolerated in one read before giving up. A scratch is a few sectors;
/// more than this means the disc or drive is gone (e.g. ejected) and silence would just hide it.
const MAX_UNREADABLE_SECTORS_PER_READ: u32 = 32;

pub const SECTOR_BYTES: usize = 2352;

/// Reads a range with `read_range`; if it fails, splits it in half and retries each half, down to single
/// sectors. A single sector that still fails becomes silence, so one scratch costs a few milliseconds of
/// audio instead of ending playback. Splitting keeps the number of failing reads to about
/// `log2(range) * bad sectors` rather than one per sector.
///
/// Returns an error when every sector failed or more than `MAX_UNREADABLE_SECTORS_PER_READ` did.
fn read_salvaging(
    start_sector: i32,
    sector_count: u32,
    read_range: &mut dyn FnMut(i32, u32) -> Result<Vec<u8>, String>,
) -> Result<ReadOutcome, String> {
    struct Salvage {
        pcm: Vec<u8>,
        unreadable_sectors: u32,
        last_error: String,
    }

    fn fill(
        salvage: &mut Salvage,
        start_sector: i32,
        sector_count: u32,
        read_range: &mut dyn FnMut(i32, u32) -> Result<Vec<u8>, String>,
    ) -> Result<(), String> {
        match read_range(start_sector, sector_count) {
            Ok(pcm) => salvage.pcm.extend(pcm),
            Err(message) if sector_count == 1 => {
                salvage.unreadable_sectors += 1;
                salvage.last_error = message;
                if salvage.unreadable_sectors > MAX_UNREADABLE_SECTORS_PER_READ {
                    return Err(format!("too many unreadable sectors: {}", salvage.last_error));
                }
                salvage.pcm.resize(salvage.pcm.len() + SECTOR_BYTES, 0);
            }
            Err(_) => {
                let first_half = sector_count / 2;
                fill(salvage, start_sector, first_half, read_range)?;
                fill(salvage, start_sector + first_half as i32, sector_count - first_half, read_range)?;
            }
        }
        Ok(())
    }

    let mut salvage = Salvage {
        pcm: Vec::with_capacity(sector_count as usize * SECTOR_BYTES),
        unreadable_sectors: 0,
        last_error: String::new(),
    };
    fill(&mut salvage, start_sector, sector_count, read_range)?;

    if sector_count > 0 && salvage.unreadable_sectors == sector_count {
        return Err(salvage.last_error);
    }
    Ok(ReadOutcome { pcm: salvage.pcm, unreadable_sectors: salvage.unreadable_sectors })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake drive: sectors in `bad` fail, and any range containing one fails (like the real crate after retries).
    fn fake_drive(bad: &'static [i32], reads: &mut Vec<(i32, u32)>) -> impl FnMut(i32, u32) -> Result<Vec<u8>, String> {
        move |start, count| {
            reads.push((start, count));
            if (start..start + count as i32).any(|sector| bad.contains(&sector)) {
                return Err("read error".into());
            }
            Ok((start..start + count as i32).flat_map(|sector| vec![(sector % 200) as u8 + 1; SECTOR_BYTES]).collect())
        }
    }

    #[test]
    fn clean_range_is_one_read() {
        let mut reads = vec![];
        let outcome = read_salvaging(10, 4, &mut fake_drive(&[], &mut reads)).unwrap();
        assert_eq!(reads, [(10, 4)]);
        assert_eq!(outcome.unreadable_sectors, 0);
        assert_eq!(outcome.pcm.len(), 4 * SECTOR_BYTES);
    }

    #[test]
    fn bad_sector_becomes_silence_and_neighbours_are_kept() {
        let mut reads = vec![];
        let outcome = read_salvaging(10, 4, &mut fake_drive(&[12], &mut reads)).unwrap();
        assert_eq!(outcome.unreadable_sectors, 1);
        assert_eq!(outcome.pcm.len(), 4 * SECTOR_BYTES);
        let sector = |index: usize| &outcome.pcm[index * SECTOR_BYTES..(index + 1) * SECTOR_BYTES];
        assert!(sector(0).iter().all(|byte| *byte == 11));
        assert!(sector(1).iter().all(|byte| *byte == 12));
        assert!(sector(2).iter().all(|byte| *byte == 0));
        assert!(sector(3).iter().all(|byte| *byte == 14));
    }

    #[test]
    fn splitting_limits_the_number_of_reads() {
        let mut reads = vec![];
        read_salvaging(0, 375, &mut fake_drive(&[200], &mut reads)).unwrap();
        assert!(reads.len() < 30, "{} reads", reads.len());
    }

    #[test]
    fn fails_when_every_sector_fails() {
        let mut reads = vec![];
        let result = read_salvaging(10, 2, &mut fake_drive(&[10, 11], &mut reads));
        assert_eq!(result, Err("read error".to_string()));
    }

    #[test]
    fn fails_when_too_many_sectors_are_unreadable() {
        // Every even sector is bad, so any range of two or more fails and half of all sectors are lost.
        let result = read_salvaging(0, 375, &mut |start, count| {
            if (start..start + count as i32).any(|sector| sector % 2 == 0) {
                Err("read error".into())
            } else {
                Ok(vec![1; count as usize * SECTOR_BYTES])
            }
        });
        assert!(result.unwrap_err().starts_with("too many unreadable sectors"));
    }
}
