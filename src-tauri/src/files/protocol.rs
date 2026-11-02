//! `file-track://localhost/{id}?start={frame}&count={frames}` serves decoded PCM chunks of an open file.
//! `start` and `count` are in output frames (44.1 kHz). The response is headerless little-endian `f32`,
//! stereo interleaved, and shorter than asked (or empty) at the end of the file.

use super::{FileRegistry, session::OUTPUT_RATE};
use tauri::http::{Response, StatusCode};

/// Response header with the number of damaged packets that were skipped in the chunk.
const DECODE_ERRORS_HEADER: &str = "X-Decode-Errors";

/// The most a single request may ask for: 10 s.
const MAX_CHUNK_FRAMES: usize = 10 * OUTPUT_RATE as usize;

#[derive(Debug, PartialEq)]
struct ChunkRequest {
    id: u32,
    start_frame: u64,
    frame_count: usize,
}

/// Parses `/{id}` plus `start`/`count` query parameters (`start` defaults to 0, `count` to 2 s).
fn parse_chunk_request(path: &str, query: Option<&str>) -> Option<ChunkRequest> {
    let id = path.strip_prefix('/')?.parse::<u32>().ok()?;

    let parameter = |name: &str, default: u64| -> Option<u64> {
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
        id,
        start_frame: parameter("start", 0)?,
        frame_count: usize::try_from(parameter("count", 2 * u64::from(OUTPUT_RATE))?).ok()?.min(MAX_CHUNK_FRAMES),
    })
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(message.as_bytes().to_vec())
        .expect("static response is valid")
}

/// Builds the response for one protocol request. Decodes, so call off the main thread.
pub fn respond(registry: &FileRegistry, path: &str, query: Option<&str>) -> Response<Vec<u8>> {
    let Some(request) = parse_chunk_request(path, query) else {
        return text_response(StatusCode::BAD_REQUEST, "expected /{id}?start={frame}&count={frames}");
    };
    let Some(session) = registry.get(request.id) else {
        return text_response(StatusCode::NOT_FOUND, "no such open file");
    };

    // One request at a time per file, since each read carries on from the last.
    let chunk = match session.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).read(request.start_frame, request.frame_count) {
        Ok(chunk) => chunk,
        Err(message) => return text_response(StatusCode::INTERNAL_SERVER_ERROR, &message),
    };

    let body: Vec<u8> = chunk.frames.iter().flat_map(|sample| sample.to_le_bytes()).collect();
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/octet-stream")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Expose-Headers", DECODE_ERRORS_HEADER)
        .header(DECODE_ERRORS_HEADER, chunk.decode_errors.to_string())
        .body(body)
        .expect("static response is valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_path_and_query() {
        assert_eq!(
            parse_chunk_request("/3", Some("start=88200&count=44100")),
            Some(ChunkRequest { id: 3, start_frame: 88200, frame_count: 44100 })
        );
    }

    #[test]
    fn applies_defaults_caps_the_size_and_rejects_bad_input() {
        assert_eq!(parse_chunk_request("/1", None), Some(ChunkRequest { id: 1, start_frame: 0, frame_count: 88200 }));
        assert_eq!(parse_chunk_request("/1", Some("count=99999999")).unwrap().frame_count, MAX_CHUNK_FRAMES);
        assert_eq!(parse_chunk_request("/nope", None), None);
        assert_eq!(parse_chunk_request("/1", Some("start=abc")), None);
        assert_eq!(parse_chunk_request("/-1", None), None);
    }

    #[test]
    fn answers_404_for_an_unknown_file_and_400_for_a_bad_request() {
        let registry = FileRegistry::default();
        assert_eq!(respond(&registry, "/7", None).status(), StatusCode::NOT_FOUND);
        assert_eq!(respond(&registry, "/nope", None).status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn serves_float_stereo_chunks() {
        let registry = FileRegistry::default();
        let path = std::env::temp_dir().join(format!("cdplayer-test-{}-protocol.wav", std::process::id()));
        std::fs::write(&path, super::super::tests::silent_wav()).unwrap();
        let id = registry.open(path.to_str().unwrap()).unwrap().id;

        let response = respond(&registry, &format!("/{id}"), Some("start=0&count=1000"));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().len(), 1000 * 2 * 4);
        assert_eq!(response.headers().get(DECODE_ERRORS_HEADER).and_then(|v| v.to_str().ok()), Some("0"));

        let last = respond(&registry, &format!("/{id}"), Some("start=4000&count=1000"));
        assert_eq!(last.body().len(), 410 * 2 * 4);
    }
}
