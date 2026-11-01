//! In-memory disc for tests, so the reader thread and protocol can be exercised without a drive.

use super::{ReadOutcome, SECTOR_BYTES, SectorSource, Toc, Track, read_salvaging};

/// A disc whose sectors in `bad_sectors` can't be read. Like the real crate after its retries,
/// any range containing a bad sector fails as a whole.
pub struct FakeDisc {
    bad_sectors: Vec<i32>,
}

impl FakeDisc {
    pub fn new(bad_sectors: Vec<i32>) -> Self {
        Self { bad_sectors }
    }

    /// Track 1 is sectors 0..=999, track 2 is 1000..=1099 (both audio), track 3 is data.
    pub fn toc() -> Toc {
        Toc {
            tracks: vec![
                Track { number: 1, first_sector: 0, last_sector: 999, is_audio: true },
                Track { number: 2, first_sector: 1000, last_sector: 1099, is_audio: true },
                Track { number: 3, first_sector: 1100, last_sector: 5000, is_audio: false },
            ],
            leadout_sector: 5001,
        }
    }

    /// Every byte of a good sector. Never 0, so silence can be told apart from audio.
    pub fn byte_for(sector: i32) -> u8 {
        (sector % 250) as u8 + 1
    }
}

impl SectorSource for FakeDisc {
    fn read_sectors(&self, start_sector: i32, sector_count: u32) -> Result<ReadOutcome, String> {
        read_salvaging(start_sector, sector_count, &mut |start, count| {
            let sectors = start..start + count as i32;
            if sectors.clone().any(|sector| self.bad_sectors.contains(&sector)) {
                return Err("read error".to_string());
            }
            Ok(sectors.flat_map(|sector| vec![Self::byte_for(sector); SECTOR_BYTES]).collect())
        })
    }
}
