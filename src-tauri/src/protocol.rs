//! `cd-track://localhost/track/{n}?start={sector}&count={sectors}` serves raw PCM chunks.
//! `start` is relative to the track's first sector. The response is headerless 16-bit/44.1kHz stereo.

use crate::disc::{MAX_CHUNK_SECTORS, ReadOutcome, Toc, reader::DiscHandle};
use tauri::http::{Response, StatusCode};

/// Response header with the number of sectors in the chunk that could not be read (sent as silence).
const UNREADABLE_SECTORS_HEADER: &str = "X-Unreadable-Sectors";

#[derive(Debug, PartialEq)]
struct ChunkRequest {
    track_number: u8,
    start_sector: u32,
    sector_count: u32,
}

/// Parses `/track/{n}` plus `start`/`count` query parameters (`start` defaults to 0, `count` to a full chunk).
fn parse_chunk_request(path: &str, query: Option<&str>) -> Option<ChunkRequest> {
    let track_number = path.strip_prefix("/track/")?.parse::<u8>().ok()?;

    let parameter = |name: &str, default: u32| -> Option<u32> {
        let found = query
            .unwrap_or("")
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == name);
        match found {
            Some((_, value)) => value.parse().ok(),
            None => Some(default),
        }
    };

    Some(ChunkRequest {
        track_number,
        start_sector: parameter("start", 0)?,
        sector_count: parameter("count", MAX_CHUNK_SECTORS)?,
    })
}

/// Maps a track-relative request to an absolute `(start_sector, sector_count)`, capping the chunk size
/// and clamping to the track end. Returns `None` for unknown/non-audio tracks or a start past the end.
fn resolve_range(toc: &Toc, request: &ChunkRequest) -> Option<(i32, u32)> {
    let track = toc
        .tracks
        .iter()
        .find(|track| track.number == request.track_number && track.is_audio)?;

    let track_sectors = u32::try_from(track.last_sector - track.first_sector + 1).ok()?;
    let remaining = track_sectors.checked_sub(request.start_sector).filter(|remaining| *remaining > 0)?;
    let sector_count = request.sector_count.min(MAX_CHUNK_SECTORS).min(remaining);

    Some((track.first_sector + request.start_sector as i32, sector_count))
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(message.as_bytes().to_vec())
        .expect("static response is valid")
}

/// Builds the response for one protocol request. Blocks on the drive, so call off the main thread.
pub fn respond(disc: &DiscHandle, path: &str, query: Option<&str>) -> Response<Vec<u8>> {
    let toc = match disc.current_toc() {
        Ok(toc) => toc,
        Err(message) => return text_response(StatusCode::SERVICE_UNAVAILABLE, &message),
    };
    let Some(request) = parse_chunk_request(path, query) else {
        return text_response(StatusCode::BAD_REQUEST, "expected /track/{n}?start={sector}&count={sectors}");
    };
    let Some((start_sector, sector_count)) = resolve_range(&toc, &request) else {
        return text_response(StatusCode::NOT_FOUND, "no such audio track or range");
    };

    match disc.read_sectors(start_sector, sector_count) {
        // Unreadable sectors are already silence in `pcm`; the count lets the frontend tell the user.
        Ok(ReadOutcome { pcm, unreadable_sectors }) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "application/octet-stream")
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Expose-Headers", UNREADABLE_SECTORS_HEADER)
            .header(UNREADABLE_SECTORS_HEADER, unreadable_sectors.to_string())
            .body(pcm)
            .expect("static response is valid"),
        Err(message) => text_response(StatusCode::INTERNAL_SERVER_ERROR, &message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disc::{
        SECTOR_BYTES, Track,
        fake::{FakeDisc, FakeDrive},
        reader::spawn_reader_with,
    };
    use std::time::Duration;

    fn toc() -> Toc {
        Toc {
            tracks: vec![
                Track { number: 1, first_sector: 0, last_sector: 999, is_audio: true },
                Track { number: 2, first_sector: 1000, last_sector: 1099, is_audio: true },
                Track { number: 3, first_sector: 1100, last_sector: 5000, is_audio: false },
            ],
            leadout_sector: 5001,
        }
    }

    #[test]
    fn parses_path_and_query() {
        assert_eq!(
            parse_chunk_request("/track/2", Some("start=75&count=150")),
            Some(ChunkRequest { track_number: 2, start_sector: 75, sector_count: 150 })
        );
    }

    #[test]
    fn applies_defaults_and_rejects_bad_input() {
        assert_eq!(
            parse_chunk_request("/track/1", None),
            Some(ChunkRequest { track_number: 1, start_sector: 0, sector_count: MAX_CHUNK_SECTORS })
        );
        assert_eq!(parse_chunk_request("/nope/1", None), None);
        assert_eq!(parse_chunk_request("/track/1", Some("start=abc")), None);
    }

    #[test]
    fn maps_to_absolute_sector() {
        let request = ChunkRequest { track_number: 2, start_sector: 10, sector_count: 20 };
        assert_eq!(resolve_range(&toc(), &request), Some((1010, 20)));
    }

    #[test]
    fn caps_chunk_size_and_clamps_to_track_end() {
        let oversized = ChunkRequest { track_number: 1, start_sector: 0, sector_count: 10_000 };
        assert_eq!(resolve_range(&toc(), &oversized), Some((0, MAX_CHUNK_SECTORS)));

        let near_end = ChunkRequest { track_number: 2, start_sector: 90, sector_count: 375 };
        assert_eq!(resolve_range(&toc(), &near_end), Some((1090, 10)));
    }

    fn reader_for(drive: &FakeDrive) -> DiscHandle {
        let drive = drive.clone();
        spawn_reader_with(move || drive.open(), Duration::from_secs(1)).expect("reader starts")
    }

    fn fake_disc(bad_sectors: Vec<i32>) -> DiscHandle {
        reader_for(&FakeDrive::with_disc(bad_sectors))
    }

    fn header<'a>(response: &'a Response<Vec<u8>>, name: &str) -> Option<&'a str> {
        response.headers().get(name).and_then(|value| value.to_str().ok())
    }

    #[test]
    fn serves_a_clean_chunk() {
        let response = respond(&fake_disc(vec![]), "/track/2", Some("start=0&count=10"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().len(), 10 * SECTOR_BYTES);
        assert_eq!(response.body()[0], FakeDisc::byte_for(1000));
        assert_eq!(header(&response, UNREADABLE_SECTORS_HEADER), Some("0"));
        assert_eq!(header(&response, "Content-Type"), Some("application/octet-stream"));
        assert_eq!(header(&response, "Access-Control-Expose-Headers"), Some(UNREADABLE_SECTORS_HEADER));
    }

    #[test]
    fn reports_unreadable_sectors_and_sends_them_as_silence() {
        let response = respond(&fake_disc(vec![1003]), "/track/2", Some("start=0&count=10"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(header(&response, UNREADABLE_SECTORS_HEADER), Some("1"));

        let sector = |index: usize| &response.body()[index * SECTOR_BYTES..(index + 1) * SECTOR_BYTES];
        assert!(sector(2).iter().all(|byte| *byte == FakeDisc::byte_for(1002)));
        assert!(sector(3).iter().all(|byte| *byte == 0));
        assert!(sector(4).iter().all(|byte| *byte == FakeDisc::byte_for(1004)));
    }

    #[test]
    fn fails_with_500_when_nothing_in_the_chunk_is_readable() {
        let response = respond(&fake_disc(vec![1000]), "/track/2", Some("start=0&count=1"));
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(response.body().as_slice(), b"read error");
    }

    #[test]
    fn fails_with_500_when_far_too_many_sectors_are_unreadable() {
        // Every other sector is bad: the disc is effectively gone, so don't play silence.
        let bad_sectors = (0..375).step_by(2).collect();
        let response = respond(&fake_disc(bad_sectors), "/track/1", Some("start=0&count=375"));
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn answers_503_without_a_disc_and_4xx_for_bad_requests() {
        let no_disc = reader_for(&FakeDrive::empty());
        let response = respond(&no_disc, "/track/1", None);
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.body().as_slice(), b"no disc");

        assert_eq!(respond(&fake_disc(vec![]), "/nope", None).status(), StatusCode::BAD_REQUEST);
        assert_eq!(respond(&fake_disc(vec![]), "/track/3", None).status(), StatusCode::NOT_FOUND);
        assert_eq!(respond(&fake_disc(vec![]), "/track/9", None).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn answers_503_after_the_disc_is_ejected_and_serves_again_when_one_returns() {
        let drive = FakeDrive::with_disc(vec![]);
        let handle = reader_for(&drive);
        assert_eq!(respond(&handle, "/track/1", Some("count=1")).status(), StatusCode::OK);

        drive.eject();
        assert!(handle.reload().is_err());
        let response = respond(&handle, "/track/1", Some("count=1"));
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.body().as_slice(), b"no disc");

        drive.insert(FakeDisc::toc(), vec![]);
        assert!(handle.reload().is_ok());
        assert_eq!(respond(&handle, "/track/1", Some("count=1")).status(), StatusCode::OK);
    }

    #[test]
    fn rejects_start_past_end_missing_and_data_tracks() {
        let past_end = ChunkRequest { track_number: 2, start_sector: 100, sector_count: 10 };
        assert_eq!(resolve_range(&toc(), &past_end), None);

        let missing = ChunkRequest { track_number: 9, start_sector: 0, sector_count: 10 };
        assert_eq!(resolve_range(&toc(), &missing), None);

        let data_track = ChunkRequest { track_number: 3, start_sector: 0, sector_count: 10 };
        assert_eq!(resolve_range(&toc(), &data_track), None);
    }
}
