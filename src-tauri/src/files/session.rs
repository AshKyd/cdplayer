//! One open audio file: reads it with symphonia, converts to 44.1 kHz stereo `f32`, and hands it out in
//! frame-exact chunks. Not tied to Tauri, so it is tested on its own.

use super::resampler::Resampler;
use std::{fs::File, path::Path};
use symphonia::core::{
    codecs::audio::{AudioDecoder, AudioDecoderOptions},
    errors::Error,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType, probe::Hint},
    io::MediaSourceStream,
    meta::MetadataOptions,
    units::Timestamp,
};

/// Everything is delivered at this rate, which is what the Web Audio context runs at.
pub const OUTPUT_RATE: u32 = 44100;

/// Output channels. Interleaved left, right.
const OUTPUT_CHANNELS: usize = 2;

pub struct FileSession {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    /// Seconds per timestamp tick of the track.
    time_base_seconds: f64,
    resampler: Option<Resampler>,
    /// Stereo output not yet handed out. Its first frame is output frame `position_frames`.
    pending: Vec<f32>,
    position_frames: u64,
    /// After a seek, the timestamp (in track ticks) the audio has to start from; earlier audio is dropped.
    required_ts: Option<i64>,
    reached_end: bool,
    /// Packets that couldn't be decoded since the last read, reported to the caller.
    decode_errors: u32,
    scratch: Vec<f32>,
    stereo: Vec<f32>,
    pub duration_seconds: f64,
}

/// One chunk of output.
pub struct Chunk {
    /// Interleaved stereo `f32` at `OUTPUT_RATE`. Shorter than asked at the end of the file; empty past it.
    pub frames: Vec<f32>,
    /// Packets skipped because they were damaged, since the last read.
    pub decode_errors: u32,
}

impl FileSession {
    pub fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|error| format!("can't open the file: {error}"))?;
        let stream = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
            hint.with_extension(extension);
        }
        let format = symphonia::default::get_probe()
            .probe(&hint, stream, FormatOptions::default(), MetadataOptions::default())
            .map_err(|error| format!("unsupported file: {error}"))?;

        let (track_id, time_base_seconds, duration_seconds, decoder) = {
            let track = format.default_track(TrackType::Audio).ok_or("the file has no audio")?;
            let params = track
                .codec_params
                .as_ref()
                .and_then(|params| params.audio())
                .ok_or("the file has no audio")?;
            let sample_rate = params.sample_rate.ok_or("the file doesn't say its sample rate")?;
            let time_base_seconds = track.time_base.map(f64::from).unwrap_or(1.0 / f64::from(sample_rate));
            let duration_seconds = track
                .time_base
                .zip(track.duration)
                .and_then(|(time_base, duration)| time_base.calc_duration(duration))
                .map(|time| time.as_secs_f64())
                .or_else(|| track.num_frames.map(|frames| frames as f64 / f64::from(sample_rate)))
                .unwrap_or(0.0);
            let decoder = super::codecs::registry()
                .make_audio_decoder(params, &AudioDecoderOptions::default())
                .map_err(|error| format!("unsupported audio format: {error}"))?;
            (track.id, time_base_seconds, duration_seconds, decoder)
        };

        Ok(Self {
            format,
            decoder,
            track_id,
            time_base_seconds,
            resampler: None,
            pending: Vec::new(),
            position_frames: 0,
            required_ts: None,
            reached_end: false,
            decode_errors: 0,
            scratch: Vec::new(),
            stereo: Vec::new(),
            duration_seconds,
        })
    }

    /// Returns `frame_count` output frames from `start_frame` (or fewer at the end of the file). A request that
    /// carries on from the last one costs only the decoding; any other first seeks.
    pub fn read(&mut self, start_frame: u64, frame_count: usize) -> Result<Chunk, String> {
        if start_frame != self.position_frames {
            self.seek(start_frame)?;
        }
        while self.pending.len() < frame_count * OUTPUT_CHANNELS && !self.reached_end {
            self.decode_next_packet()?;
        }

        let taken = (self.pending.len() / OUTPUT_CHANNELS).min(frame_count);
        let frames: Vec<f32> = self.pending.drain(..taken * OUTPUT_CHANNELS).collect();
        self.position_frames += taken as u64;
        Ok(Chunk { frames, decode_errors: std::mem::take(&mut self.decode_errors) })
    }

    /// Moves to output frame `start_frame`. The container can only land on a packet at or before it, so the
    /// audio between is decoded and dropped (`required_ts`).
    fn seek(&mut self, start_frame: u64) -> Result<(), String> {
        self.pending.clear();
        self.position_frames = start_frame;
        self.required_ts = None;
        self.reached_end = false;
        self.decode_errors = 0;
        if let Some(resampler) = self.resampler.as_mut() {
            resampler.reset();
        }

        // In the track's own ticks, rounded, so a seek to a source frame boundary lands exactly on it.
        let seconds = start_frame as f64 / f64::from(OUTPUT_RATE);
        let ts = Timestamp::new((seconds / self.time_base_seconds).round() as i64);
        match self.format.seek(SeekMode::Accurate, SeekTo::Timestamp { ts, track_id: self.track_id }) {
            Ok(seeked) => {
                self.decoder.reset();
                self.required_ts = Some(seeked.required_ts.get());
                Ok(())
            }
            // Past the end: there is nothing to play from there.
            Err(Error::SeekError(_)) => {
                self.reached_end = true;
                Ok(())
            }
            Err(error) => Err(format!("can't seek: {error}")),
        }
    }

    /// Decodes one packet into `pending`, or marks the end of the file.
    fn decode_next_packet(&mut self) -> Result<(), String> {
        let packet = match self.format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) | Err(Error::ResetRequired) => return Ok(self.finish_stream()),
            Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(self.finish_stream());
            }
            Err(error) => return Err(format!("can't read the file: {error}")),
        };
        if packet.track_id != self.track_id {
            return Ok(());
        }
        // The first audio frame that will come out: the decoder trims frames the encoder added (mp3 delay).
        let first_ts = packet.pts.get() + packet.trim_start.get() as i64;

        let decoded = match self.decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // A damaged packet is skipped, as a scratch on a disc would be.
            Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => {
                self.decode_errors += 1;
                return Ok(());
            }
            Err(error) => return Err(format!("can't decode the file: {error}")),
        };
        let source_channels = decoded.spec().channels().count();
        let source_rate = decoded.spec().rate();
        decoded.copy_to_vec_interleaved::<f32>(&mut self.scratch);

        to_stereo(&self.scratch, source_channels, &mut self.stereo);

        // Drop what is before the seek target.
        let mut skip_frames = 0usize;
        if let Some(required) = self.required_ts {
            let behind_ticks = (required - first_ts).max(0) as f64;
            skip_frames = (behind_ticks * self.time_base_seconds * f64::from(source_rate)).round() as usize;
            let available = self.stereo.len() / OUTPUT_CHANNELS;
            if skip_frames >= available {
                // All of it is early; the target is in a later packet.
                return Ok(());
            }
            self.required_ts = None;
        }
        let audio = &self.stereo[skip_frames * OUTPUT_CHANNELS..];

        if source_rate == OUTPUT_RATE {
            self.pending.extend_from_slice(audio);
            return Ok(());
        }
        if self.resampler.is_none() {
            self.resampler = Some(Resampler::new(source_rate, OUTPUT_RATE, OUTPUT_CHANNELS)?);
        }
        if let Some(resampler) = self.resampler.as_mut() {
            resampler.push(audio, &mut self.pending);
        }
        Ok(())
    }

    fn finish_stream(&mut self) {
        self.reached_end = true;
        if let Some(resampler) = self.resampler.as_mut() {
            resampler.finish(&mut self.pending);
        }
    }
}

/// Converts interleaved audio of any channel count to interleaved stereo. Mono is doubled; more than two
/// channels keep only the front left and right.
fn to_stereo(interleaved: &[f32], channels: usize, stereo: &mut Vec<f32>) {
    stereo.clear();
    match channels {
        0 => {}
        1 => stereo.extend(interleaved.iter().flat_map(|sample| [*sample, *sample])),
        2 => stereo.extend_from_slice(interleaved),
        _ => stereo.extend(interleaved.chunks_exact(channels).flat_map(|frame| [frame[0], frame[1]])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16-bit mono or stereo WAV file of a sine wave, written to a temp file.
    fn write_wav(name: &str, rate: u32, channels: u16, seconds: f64, frequency: f64) -> std::path::PathBuf {
        let frames = (rate as f64 * seconds) as usize;
        let mut data = Vec::new();
        for n in 0..frames {
            let sample = ((2.0 * std::f64::consts::PI * frequency * n as f64 / rate as f64).sin() * 20000.0) as i16;
            for _ in 0..channels {
                data.extend_from_slice(&sample.to_le_bytes());
            }
        }
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * u32::from(channels) * 2).to_le_bytes());
        wav.extend_from_slice(&(channels * 2).to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);

        let path = std::env::temp_dir().join(format!("cdplayer-test-{}-{name}.wav", std::process::id()));
        std::fs::write(&path, wav).unwrap();
        path
    }

    fn expected_sample(frequency: f64, frame: u64) -> f32 {
        ((2.0 * std::f64::consts::PI * frequency * frame as f64 / f64::from(OUTPUT_RATE)).sin() * 20000.0 / 32768.0) as f32
    }

    /// Whether `sample` is the sine's value at `frame`, give or take half a frame of seek rounding.
    fn is_sine_at(sample: f32, frequency: f64, frame: u64) -> bool {
        [frame.saturating_sub(1), frame, frame + 1].iter().any(|near| (sample - expected_sample(frequency, *near)).abs() < 0.001)
    }

    #[test]
    fn reports_the_duration() {
        let path = write_wav("duration", 44100, 2, 2.0, 440.0);
        let session = FileSession::open(&path).unwrap();
        assert!((session.duration_seconds - 2.0).abs() < 0.01);
    }

    #[test]
    fn reads_chunks_one_after_another_without_gaps() {
        let path = write_wav("sequential", 44100, 2, 2.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();

        let first = session.read(0, 30000).unwrap();
        let second = session.read(30000, 30000).unwrap();

        assert_eq!(first.frames.len(), 60000);
        assert_eq!(second.frames.len(), 60000);
        // Frame 30000 is the first of the second chunk, on both channels.
        assert!((second.frames[0] - expected_sample(440.0, 30000)).abs() < 0.001);
        assert!((second.frames[1] - expected_sample(440.0, 30000)).abs() < 0.001);
    }

    #[test]
    fn seeks_to_the_exact_frame() {
        let path = write_wav("seek", 44100, 2, 3.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();
        session.read(0, 1000).unwrap();

        let chunk = session.read(100_001, 500).unwrap();

        assert_eq!(chunk.frames.len(), 1000);
        assert!(is_sine_at(chunk.frames[0], 440.0, 100_001));
        assert!(is_sine_at(chunk.frames[998], 440.0, 100_500));
    }

    #[test]
    fn can_seek_back_to_the_start() {
        let path = write_wav("back", 44100, 2, 2.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();
        session.read(0, 50000).unwrap();

        let chunk = session.read(0, 100).unwrap();

        assert!((chunk.frames[20] - expected_sample(440.0, 10)).abs() < 0.001);
    }

    #[test]
    fn returns_a_short_chunk_at_the_end_and_nothing_after() {
        let path = write_wav("end", 44100, 2, 1.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();

        let last = session.read(40000, 10000).unwrap();
        assert_eq!(last.frames.len(), 4100 * 2);

        let after = session.read(44100, 10000).unwrap();
        assert!(after.frames.is_empty());
    }

    #[test]
    fn reads_nothing_when_seeking_past_the_end() {
        let path = write_wav("past", 44100, 2, 1.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();

        let chunk = session.read(10_000_000, 1000).unwrap();

        assert!(chunk.frames.is_empty());
    }

    #[test]
    fn doubles_mono_into_both_channels() {
        let path = write_wav("mono", 44100, 1, 1.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();

        let chunk = session.read(0, 100).unwrap();

        assert_eq!(chunk.frames.len(), 200);
        assert_eq!(chunk.frames[50], chunk.frames[51]);
    }

    #[test]
    fn converts_other_sample_rates_to_44100() {
        let path = write_wav("resample", 22050, 2, 1.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();

        let chunk = session.read(0, 100_000).unwrap();

        assert_eq!(chunk.frames.len(), 44100 * 2);
        let frame = 20000u64;
        assert!((chunk.frames[frame as usize * 2] - expected_sample(440.0, frame)).abs() < 0.01);
    }

    #[test]
    fn seeks_inside_a_resampled_file() {
        let path = write_wav("resample-seek", 48000, 2, 2.0, 440.0);
        let mut session = FileSession::open(&path).unwrap();

        // 0.5 s is a whole number of source frames at 48 kHz, so the seek lands exactly.
        let chunk = session.read(22_050, 1000).unwrap();

        assert_eq!(chunk.frames.len(), 2000);
        assert!((chunk.frames[200] - expected_sample(440.0, 22_150)).abs() < 0.01);
    }

    #[test]
    fn refuses_a_file_that_is_not_audio() {
        let path = std::env::temp_dir().join(format!("cdplayer-test-{}-not-audio.wav", std::process::id()));
        std::fs::write(&path, b"this is not a wav file at all").unwrap();
        assert!(FileSession::open(&path).is_err());
    }

    #[test]
    fn converts_channel_layouts_to_stereo() {
        let mut stereo = Vec::new();
        to_stereo(&[1.0, 2.0], 1, &mut stereo);
        assert_eq!(stereo, [1.0, 1.0, 2.0, 2.0]);

        to_stereo(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0], 3, &mut stereo);
        assert_eq!(stereo, [1.0, 2.0, 4.0, 5.0]);
    }
}
