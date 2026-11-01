//! Dedicated reader thread. Drive reads block and the drive can only do one thing at a time,
//! so every read (playback chunk, pre-fetch, seek) is queued here and run in order.

use super::{Disc, Toc};
use std::{
    sync::{
        Arc,
        mpsc::{self, Sender},
    },
    thread,
};

pub type ReadReply = Result<Vec<u8>, String>;

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
    let (requests, request_receiver) = mpsc::channel::<ReadRequest>();
    let (ready_sender, ready_receiver) = mpsc::channel::<Result<Toc, String>>();

    thread::Builder::new()
        .name("cd-reader".into())
        .spawn(move || {
            let opened = Disc::open_default().and_then(|disc| disc.read_toc().map(|toc| (disc, toc)));
            let (disc, toc) = match opened {
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
