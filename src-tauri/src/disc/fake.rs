//! In-memory disc and drive for tests, so the reader thread and protocol can be exercised without a drive.

use super::{ReadOutcome, SECTOR_BYTES, SectorSource, Toc, Track, read_salvaging};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

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

    /// A different disc: one audio track, sectors 0..=99.
    pub fn single_track_toc() -> Toc {
        Toc {
            tracks: vec![Track { number: 1, first_sector: 0, last_sector: 99, is_audio: true }],
            leadout_sector: 100,
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

/// A drive with a tray: a disc can be inserted, swapped or ejected, and the number of times it is
/// currently open is counted, so tests can check the drive is released when idle.
#[derive(Clone)]
pub struct FakeDrive {
    tray: Arc<Mutex<Option<(Toc, Vec<i32>)>>>,
    open_sessions: Arc<AtomicUsize>,
}

impl FakeDrive {
    /// A drive holding the default three-track disc with these unreadable sectors.
    pub fn with_disc(bad_sectors: Vec<i32>) -> Self {
        let drive = Self::empty();
        drive.insert(FakeDisc::toc(), bad_sectors);
        drive
    }

    pub fn empty() -> Self {
        Self { tray: Arc::new(Mutex::new(None)), open_sessions: Arc::new(AtomicUsize::new(0)) }
    }

    pub fn insert(&self, toc: Toc, bad_sectors: Vec<i32>) {
        *self.tray.lock().unwrap() = Some((toc, bad_sectors));
    }

    pub fn eject(&self) {
        *self.tray.lock().unwrap() = None;
    }

    /// How many opened sources are alive right now.
    pub fn open_sessions(&self) -> usize {
        self.open_sessions.load(Ordering::SeqCst)
    }

    /// Opens the drive, like `Disc::open_default()` plus `read_toc()`. Pass to `spawn_reader_with`.
    pub fn open(&self) -> Result<(DriveSession, Toc), String> {
        let (toc, bad_sectors) = self.tray.lock().unwrap().clone().ok_or_else(|| "no disc".to_string())?;
        self.open_sessions.fetch_add(1, Ordering::SeqCst);
        Ok((DriveSession { disc: FakeDisc::new(bad_sectors), open_sessions: Arc::clone(&self.open_sessions) }, toc))
    }
}

/// An open handle on a `FakeDrive`'s disc. Counted while alive, like an open file descriptor.
pub struct DriveSession {
    disc: FakeDisc,
    open_sessions: Arc<AtomicUsize>,
}

impl SectorSource for DriveSession {
    fn read_sectors(&self, start_sector: i32, sector_count: u32) -> Result<ReadOutcome, String> {
        self.disc.read_sectors(start_sector, sector_count)
    }
}

impl Drop for DriveSession {
    fn drop(&mut self) {
        self.open_sessions.fetch_sub(1, Ordering::SeqCst);
    }
}
