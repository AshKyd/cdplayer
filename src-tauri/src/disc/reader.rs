//! Dedicated reader thread. Drive reads block and the drive can only do one thing at a time,
//! so every read (playback chunk, pre-fetch, seek) is queued here and run in order.

use super::{Disc, ReadOutcome, SectorSource, Toc};
use std::{
    sync::{
        Arc,
        mpsc::{self, Sender},
    },
    thread,
};

pub type ReadReply = Result<ReadOutcome, String>;

struct ReadRequest {
    start_sector: i32,
    sector_count: u32,
    reply: Sender<ReadReply>,
}

/// Cheap-to-clone handle to the reader thread and the disc's TOC.
#[derive(Clone)]
pub struct DiscHandle {
    requests: Sender<ReadRequest>,
    pub toc: Arc<Toc>,
}

impl DiscHandle {
    /// Queues a read and blocks until the reader thread has finished it.
    pub fn read_sectors(&self, start_sector: i32, sector_count: u32) -> ReadReply {
        let (reply, reply_receiver) = mpsc::channel();
        self.requests
            .send(ReadRequest { start_sector, sector_count, reply })
            .map_err(|_| "disc reader has stopped".to_string())?;
        reply_receiver
            .recv()
            .map_err(|_| "disc reader has stopped".to_string())?
    }
}

/// Opens the drive on a new thread (reads are blocking and the disc is used only from this thread)
/// and returns once the TOC has been read.
pub fn spawn_reader() -> Result<DiscHandle, String> {
    spawn_reader_with(|| {
        let disc = Disc::open_default()?;
        let toc = disc.read_toc()?;
        Ok((disc, toc))
    })
}

/// Like `spawn_reader`, but `open` supplies the sector source and TOC. It runs on the reader thread,
/// so the source itself doesn't need to be `Send`. Tests use it with a fake disc.
pub fn spawn_reader_with<Source: SectorSource + 'static>(
    open: impl FnOnce() -> Result<(Source, Toc), String> + Send + 'static,
) -> Result<DiscHandle, String> {
    let (requests, request_receiver) = mpsc::channel::<ReadRequest>();
    let (ready_sender, ready_receiver) = mpsc::channel::<Result<Toc, String>>();

    thread::Builder::new()
        .name("cd-reader".into())
        .spawn(move || {
            let (disc, toc) = match open() {
                Ok(opened) => opened,
                Err(message) => return drop(ready_sender.send(Err(message))),
            };
            let _ = ready_sender.send(Ok(toc));

            request_receiver.iter().for_each(|ReadRequest { start_sector, sector_count, reply }| {
                let _ = reply.send(disc.read_sectors(start_sector, sector_count));
            });
        })
        .map_err(|error| error.to_string())?;

    let toc = ready_receiver.recv().map_err(|_| "disc reader failed to start".to_string())??;
    Ok(DiscHandle { requests, toc: Arc::new(toc) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disc::{SECTOR_BYTES, fake::FakeDisc};

    fn handle(bad_sectors: Vec<i32>) -> DiscHandle {
        spawn_reader_with(move || Ok((FakeDisc::new(bad_sectors), FakeDisc::toc()))).ok().expect("fake disc opens")
    }

    #[test]
    fn exposes_the_toc() {
        assert_eq!(handle(vec![]).toc.tracks.len(), 3);
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
    fn open_failure_is_returned() {
        let result = spawn_reader_with::<FakeDisc>(|| Err("no disc".to_string()));
        assert_eq!(result.err(), Some("no disc".to_string()));
    }
}
