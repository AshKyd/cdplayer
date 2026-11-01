//! Dedicated reader thread. Drive reads block and the drive can only do one thing at a time,
//! so every request (playback chunk, pre-fetch, seek, re-opening the drive) is queued here and run in order.
//!
//! The drive is only held open while it is being used. An open handle on the disc stops the OS
//! ejecting it (macOS reports the disc as in use), so it is released shortly after the last read, and
//! straight after a TOC check.

use super::{Disc, ReadOutcome, SectorSource, Toc};
use std::{
    sync::{
        Arc, RwLock,
        mpsc::{self, RecvTimeoutError, Sender},
    },
    thread,
    time::Duration,
};

/// How long the drive stays open after the last request. Long enough that a run of chunk reads
/// shares one open; short enough that the disc can be ejected soon after playback pauses.
const DEFAULT_IDLE_CLOSE: Duration = Duration::from_secs(1);

pub type ReadReply = Result<ReadOutcome, String>;

enum Request {
    Read { start_sector: i32, sector_count: u32, reply: Sender<ReadReply> },
    /// Open the drive, read the TOC of whichever disc is in it now, then release the drive.
    Reload { reply: Sender<Result<Toc, String>> },
}

/// The TOC of the disc in the drive, or why there is none. Shared so `respond` can check it without
/// queueing behind a read.
type SharedToc = Arc<RwLock<Result<Arc<Toc>, String>>>;

/// Cheap-to-clone handle to the reader thread and the current disc's TOC.
#[derive(Clone)]
pub struct DiscHandle {
    requests: Sender<Request>,
    toc: SharedToc,
}

impl DiscHandle {
    /// The TOC as of the last open, or the reason there is no disc. Doesn't touch the drive.
    pub fn current_toc(&self) -> Result<Arc<Toc>, String> {
        self.toc.read().map_err(|_| "disc state is unavailable".to_string())?.clone()
    }

    /// Queues a read and blocks until the reader thread has finished it.
    pub fn read_sectors(&self, start_sector: i32, sector_count: u32) -> ReadReply {
        let (reply, reply_receiver) = mpsc::channel();
        self.requests
            .send(Request::Read { start_sector, sector_count, reply })
            .map_err(|_| "disc reader has stopped".to_string())?;
        reply_receiver
            .recv()
            .map_err(|_| "disc reader has stopped".to_string())?
    }

    /// Opens the drive and reads the TOC again, so a swapped or ejected disc is noticed.
    /// Queued behind any read in progress, and blocks until done. The drive is released afterwards.
    pub fn reload(&self) -> Result<Toc, String> {
        let (reply, reply_receiver) = mpsc::channel();
        self.requests
            .send(Request::Reload { reply })
            .map_err(|_| "disc reader has stopped".to_string())?;
        reply_receiver
            .recv()
            .map_err(|_| "disc reader has stopped".to_string())?
    }
}

/// Starts the reader thread and reads the TOC once. Having no disc is not a failure: the handle still
/// works, and `reload()` can find a disc later.
pub fn spawn_reader() -> Result<DiscHandle, String> {
    spawn_reader_with(
        || {
            let disc = Disc::open_default()?;
            let toc = disc.read_toc()?;
            Ok((disc, toc))
        },
        DEFAULT_IDLE_CLOSE,
    )
}

/// Like `spawn_reader`, but `open` supplies the sector source and TOC (it is called every time the drive
/// is opened) and `idle_close` is how long the drive stays open after the last request. `open` runs on the
/// reader thread, so the source itself doesn't need to be `Send`. Tests use it with a fake drive.
pub fn spawn_reader_with<Source: SectorSource + 'static>(
    mut open: impl FnMut() -> Result<(Source, Toc), String> + Send + 'static,
    idle_close: Duration,
) -> Result<DiscHandle, String> {
    let (requests, request_receiver) = mpsc::channel::<Request>();
    let (ready_sender, ready_receiver) = mpsc::channel::<()>();
    let toc: SharedToc = Arc::new(RwLock::new(Err("disc has not been read yet".to_string())));
    let thread_toc = Arc::clone(&toc);

    thread::Builder::new()
        .name("cd-reader".into())
        .spawn(move || {
            let mut source: Option<Source> = None;

            // First look at the drive; the source is dropped straight away.
            let _ = open_and_record(&mut open, &thread_toc);
            let _ = ready_sender.send(());

            loop {
                let request = match request_receiver.recv_timeout(idle_close) {
                    Ok(request) => request,
                    Err(RecvTimeoutError::Timeout) => {
                        source = None;
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                };

                match request {
                    Request::Read { start_sector, sector_count, reply } => {
                        let outcome = read_opening_if_needed(&mut source, &mut open, &thread_toc, start_sector, sector_count);
                        // A failed read may mean the disc was ejected; start from a fresh open next time.
                        if outcome.is_err() {
                            source = None;
                        }
                        let _ = reply.send(outcome);
                    }
                    Request::Reload { reply } => {
                        // Drop the old source first: two handles on one drive can conflict.
                        source = None;
                        let _ = reply.send(open_and_record(&mut open, &thread_toc).map(|(_, toc)| toc));
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;

    ready_receiver.recv().map_err(|_| "disc reader failed to start".to_string())?;
    Ok(DiscHandle { requests, toc })
}

/// Opens the drive and records the TOC it found (or why it found none) in `shared`.
fn open_and_record<Source>(
    open: &mut impl FnMut() -> Result<(Source, Toc), String>,
    shared: &SharedToc,
) -> Result<(Source, Toc), String> {
    let result = open();
    if let Ok(mut shared) = shared.write() {
        *shared = result.as_ref().map(|(_, toc)| Arc::new(toc.clone())).map_err(Clone::clone);
    }
    result
}

/// Reads from the open source, first opening the drive if it was released. A drive opened again must
/// hold the same disc as before, otherwise the sector numbers the caller has are for another disc.
fn read_opening_if_needed<Source: SectorSource>(
    source: &mut Option<Source>,
    open: &mut impl FnMut() -> Result<(Source, Toc), String>,
    shared: &SharedToc,
    start_sector: i32,
    sector_count: u32,
) -> ReadReply {
    if source.is_none() {
        let known = shared.read().map_err(|_| "disc state is unavailable".to_string())?.clone()?;
        let (opened, toc) = open_and_record(open, shared)?;
        if toc != *known {
            return Err("the disc changed".to_string());
        }
        *source = Some(opened);
    }
    match source {
        Some(source) => source.read_sectors(start_sector, sector_count),
        None => Err("no disc".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disc::{SECTOR_BYTES, fake::{FakeDisc, FakeDrive}};

    const QUICK_IDLE_CLOSE: Duration = Duration::from_millis(50);

    fn reader_for(drive: &FakeDrive, idle_close: Duration) -> DiscHandle {
        let drive = drive.clone();
        spawn_reader_with(move || drive.open(), idle_close).expect("reader starts")
    }

    fn handle(bad_sectors: Vec<i32>) -> DiscHandle {
        reader_for(&FakeDrive::with_disc(bad_sectors), DEFAULT_IDLE_CLOSE)
    }

    /// Waits for the reader thread to release the drive, which it does on its own timer.
    fn wait_until_closed(drive: &FakeDrive) {
        for _ in 0..100 {
            if drive.open_sessions() == 0 {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("drive was still open after 2 s");
    }

    #[test]
    fn exposes_the_toc() {
        assert_eq!(handle(vec![]).current_toc().unwrap().tracks.len(), 3);
    }

    #[test]
    fn reads_a_clean_range() {
        let outcome = handle(vec![]).read_sectors(1000, 3).unwrap();
        assert_eq!(outcome.unreadable_sectors, 0);
        assert_eq!(outcome.pcm.len(), 3 * SECTOR_BYTES);
        assert_eq!(outcome.pcm[0], FakeDisc::byte_for(1000));
    }

    #[test]
    fn reports_unreadable_sectors_from_the_reader_thread() {
        let outcome = handle(vec![1001]).read_sectors(1000, 3).unwrap();
        assert_eq!(outcome.unreadable_sectors, 1);
        assert!(outcome.pcm[SECTOR_BYTES..2 * SECTOR_BYTES].iter().all(|byte| *byte == 0));
    }

    #[test]
    fn works_from_a_cloned_handle() {
        let original = handle(vec![]);
        let clone = original.clone();
        assert!(clone.read_sectors(0, 1).is_ok());
        assert!(original.read_sectors(1, 1).is_ok());
    }

    #[test]
    fn starts_without_a_disc() {
        let handle = reader_for(&FakeDrive::empty(), DEFAULT_IDLE_CLOSE);
        assert_eq!(handle.current_toc().err(), Some("no disc".to_string()));
        assert_eq!(handle.read_sectors(0, 1).err(), Some("no disc".to_string()));
    }

    #[test]
    fn reload_picks_up_a_new_disc() {
        // Disc B has one track whose sector 5 is unreadable.
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive, DEFAULT_IDLE_CLOSE);
        assert_eq!(handle.current_toc().unwrap().tracks.len(), 3);
        assert!(handle.read_sectors(5, 1).is_ok());

        drive.insert(FakeDisc::single_track_toc(), vec![5]);
        let toc = handle.reload().unwrap();
        assert_eq!(toc.tracks.len(), 1);
        assert_eq!(handle.current_toc().unwrap().tracks.len(), 1);
        // Sector 5 only fails on the new disc, so this read came from it.
        assert!(handle.read_sectors(5, 1).is_err());
    }

    #[test]
    fn reload_reports_an_ejected_disc_and_recovers_when_one_returns() {
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive, DEFAULT_IDLE_CLOSE);

        drive.eject();
        assert_eq!(handle.reload().err(), Some("no disc".to_string()));
        assert_eq!(handle.current_toc().err(), Some("no disc".to_string()));
        assert_eq!(handle.read_sectors(0, 1).err(), Some("no disc".to_string()));

        drive.insert(FakeDisc::single_track_toc(), vec![]);
        assert_eq!(handle.reload().unwrap().tracks.len(), 1);
        assert!(handle.read_sectors(0, 1).is_ok());
    }

    #[test]
    fn the_drive_is_not_held_open_when_idle() {
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive, QUICK_IDLE_CLOSE);
        // The first look at the drive reads the TOC and lets go.
        assert_eq!(drive.open_sessions(), 0);

        // A run of reads shares one open, then the drive is released on its own.
        assert!(handle.read_sectors(0, 1).is_ok());
        assert!(handle.read_sectors(1, 1).is_ok());
        assert_eq!(drive.open_sessions(), 1);
        wait_until_closed(&drive);

        // The next read opens it again.
        assert!(handle.read_sectors(2, 1).is_ok());
        assert_eq!(drive.open_sessions(), 1);
    }

    #[test]
    fn a_toc_check_releases_the_drive_straight_away() {
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive, DEFAULT_IDLE_CLOSE);

        assert!(handle.read_sectors(0, 1).is_ok());
        assert_eq!(drive.open_sessions(), 1);
        assert!(handle.reload().is_ok());
        assert_eq!(drive.open_sessions(), 0);
    }

    #[test]
    fn a_read_after_the_disc_was_swapped_is_refused_not_served_from_the_new_disc() {
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive, QUICK_IDLE_CLOSE);
        assert!(handle.read_sectors(0, 1).is_ok());
        wait_until_closed(&drive);

        drive.insert(FakeDisc::single_track_toc(), vec![]);
        assert_eq!(handle.read_sectors(0, 1).err(), Some("the disc changed".to_string()));
        // The new disc is now the known one, and reads work against it.
        assert_eq!(handle.current_toc().unwrap().tracks.len(), 1);
        assert!(handle.read_sectors(0, 1).is_ok());
    }

    #[test]
    fn a_read_after_the_disc_was_ejected_fails_and_clears_the_toc() {
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive, QUICK_IDLE_CLOSE);
        assert!(handle.read_sectors(0, 1).is_ok());
        wait_until_closed(&drive);

        drive.eject();
        assert_eq!(handle.read_sectors(0, 1).err(), Some("no disc".to_string()));
        assert_eq!(handle.current_toc().err(), Some("no disc".to_string()));
    }
}
