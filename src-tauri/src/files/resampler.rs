//! A streaming sample rate converter for interleaved audio.
//!
//! It is a polyphase windowed-sinc filter with an exact rational ratio (`out_rate / in_rate` reduced to
//! `l / m`), so there is no interpolation error between table entries. Audio goes in as it is decoded and
//! comes out as soon as enough input has arrived, so a chunk never has to wait for the whole file.

/// Filter taps per phase. More is sharper and slower; 32 keeps the passband error near -80 dB for music.
const TAPS: usize = 32;

/// Largest numerator of the reduced ratio. Rates that reduce to something bigger (odd rates) are refused
/// rather than building a huge table.
const MAX_PHASES: usize = 4096;

/// Pulls the cutoff a little under the new Nyquist rate so the filter's transition band fits.
const CUTOFF_GUARD: f64 = 0.97;

fn greatest_common_divisor(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { greatest_common_divisor(b, a % b) }
}

fn sinc(x: f64) -> f64 {
    if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) }
}

pub struct Resampler {
    channels: usize,
    /// Output samples per `m` input samples, after reducing the ratio.
    l: usize,
    m: usize,
    /// `table[phase * TAPS + k]` is the weight of the input sample `k` frames before the newest one in reach.
    table: Vec<f32>,
    /// Half the length of the prototype filter, in its upsampled domain.
    centre: usize,
    /// Interleaved input not yet fully used, starting at input frame `buffer_start`.
    buffer: Vec<f32>,
    buffer_start: u64,
    /// Index of the next output frame to produce.
    next_output: u64,
    /// Input frames received since the last reset.
    total_input: u64,
}

impl Resampler {
    pub fn new(in_rate: u32, out_rate: u32, channels: usize) -> Result<Self, String> {
        if in_rate == 0 || out_rate == 0 || channels == 0 {
            return Err("sample rate and channel count must be above zero".into());
        }
        let divisor = greatest_common_divisor(in_rate, out_rate);
        let l = (out_rate / divisor) as usize;
        let m = (in_rate / divisor) as usize;
        if l > MAX_PHASES {
            return Err(format!("can't convert {in_rate} Hz to {out_rate} Hz"));
        }

        let cutoff = (l as f64 / m as f64).min(1.0) * CUTOFF_GUARD;
        let length = l * TAPS;
        let centre = length / 2;
        let prototype: Vec<f64> = (0..length)
            .map(|j| {
                let offset = j as f64 - centre as f64;
                let hann = 0.5 + 0.5 * (std::f64::consts::PI * offset / centre as f64).cos();
                cutoff * sinc(cutoff * offset / l as f64) * hann
            })
            .collect();

        // One row per phase, each scaled so a constant signal passes at exactly its own level.
        let mut table = vec![0.0f32; l * TAPS];
        for phase in 0..l {
            let row: Vec<f64> = (0..TAPS).map(|k| prototype[phase + k * l]).collect();
            let sum: f64 = row.iter().sum();
            for (k, weight) in row.iter().enumerate() {
                table[phase * TAPS + k] = (weight / sum) as f32;
            }
        }

        Ok(Self {
            channels,
            l,
            m,
            table,
            centre,
            buffer: Vec::new(),
            buffer_start: 0,
            next_output: 0,
            total_input: 0,
        })
    }

    /// Forgets all input, ready for audio from somewhere else in the file (after a seek).
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.buffer_start = 0;
        self.next_output = 0;
        self.total_input = 0;
    }

    /// Adds interleaved input and appends every output frame that can now be worked out.
    pub fn push(&mut self, input: &[f32], output: &mut Vec<f32>) {
        self.buffer.extend_from_slice(input);
        self.total_input += (input.len() / self.channels) as u64;
        self.produce(output, None);
    }

    /// Appends the output frames that were waiting for input past the end, treating that as silence.
    /// The total comes to exactly `ceil(input frames * l / m)`.
    pub fn finish(&mut self, output: &mut Vec<f32>) {
        let total_output = (self.total_input * self.l as u64).div_ceil(self.m as u64);
        self.produce(output, Some(total_output));
    }

    /// Produces outputs while their input is all present, or, with `limit`, up to that many in all.
    fn produce(&mut self, output: &mut Vec<f32>, limit: Option<u64>) {
        let available_end = self.buffer_start + (self.buffer.len() / self.channels) as u64;

        loop {
            if limit.is_some_and(|total| self.next_output >= total) {
                break;
            }
            let position = self.next_output * self.m as u64 + self.centre as u64;
            let newest = position / self.l as u64;
            let phase = (position % self.l as u64) as usize;
            if limit.is_none() && newest >= available_end {
                break;
            }

            let weights = &self.table[phase * TAPS..(phase + 1) * TAPS];
            for channel in 0..self.channels {
                let sum: f32 = weights
                    .iter()
                    .enumerate()
                    .map(|(k, weight)| {
                        // Before the start and past the end count as silence.
                        let Some(index) = newest.checked_sub(k as u64) else { return 0.0 };
                        if index < self.buffer_start || index >= available_end {
                            return 0.0;
                        }
                        weight * self.buffer[(index - self.buffer_start) as usize * self.channels + channel]
                    })
                    .sum();
                output.push(sum);
            }
            self.next_output += 1;
        }

        // Input older than the oldest one the next output reaches back to is no longer needed.
        let next_newest = (self.next_output * self.m as u64 + self.centre as u64) / self.l as u64;
        let keep_from = next_newest.saturating_sub(TAPS as u64 - 1).min(available_end);
        if keep_from > self.buffer_start {
            self.buffer.drain(..(keep_from - self.buffer_start) as usize * self.channels);
            self.buffer_start = keep_from;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frequency: f64, rate: u32, frames: usize) -> Vec<f32> {
        (0..frames).map(|n| (2.0 * std::f64::consts::PI * frequency * n as f64 / rate as f64).sin() as f32).collect()
    }

    /// Resamples a mono signal in pieces of `piece` frames.
    fn convert(input: &[f32], in_rate: u32, out_rate: u32, piece: usize) -> Vec<f32> {
        let mut resampler = Resampler::new(in_rate, out_rate, 1).unwrap();
        let mut output = Vec::new();
        for part in input.chunks(piece) {
            resampler.push(part, &mut output);
        }
        resampler.finish(&mut output);
        output
    }

    #[test]
    fn gives_exactly_the_expected_number_of_frames() {
        let output = convert(&sine(1000.0, 48000, 48000), 48000, 44100, 1024);
        assert_eq!(output.len(), 44100);
    }

    #[test]
    fn keeps_a_sine_wave_intact_when_converting_down_and_up() {
        for (in_rate, out_rate) in [(48000, 44100), (22050, 44100), (96000, 44100), (32000, 44100)] {
            let output = convert(&sine(1000.0, in_rate, in_rate as usize), in_rate, out_rate, 777);
            let worst_error = (2000..output.len() - 2000)
                .map(|n| (output[n] as f64 - (2.0 * std::f64::consts::PI * 1000.0 * n as f64 / out_rate as f64).sin()).abs())
                .fold(0.0, f64::max);
            assert!(worst_error < 0.001, "{in_rate} -> {out_rate}: error {worst_error}");
        }
    }

    #[test]
    fn gives_the_same_result_whatever_the_piece_size() {
        let input = sine(440.0, 48000, 20000);
        let whole = convert(&input, 48000, 44100, input.len());
        let pieces = convert(&input, 48000, 44100, 313);
        assert_eq!(whole.len(), pieces.len());
        assert!(whole.iter().zip(&pieces).all(|(a, b)| (a - b).abs() < 1e-6));
    }

    #[test]
    fn passes_a_constant_signal_at_the_same_level() {
        let output = convert(&vec![0.5; 9600], 48000, 44100, 1000);
        assert!(output[100..output.len() - 100].iter().all(|sample| (sample - 0.5).abs() < 1e-4));
    }

    #[test]
    fn keeps_channels_apart() {
        let mut resampler = Resampler::new(48000, 44100, 2).unwrap();
        let input: Vec<f32> = (0..4800).flat_map(|_| [0.25, -0.25]).collect();
        let mut output = Vec::new();
        resampler.push(&input, &mut output);
        resampler.finish(&mut output);
        let middle = output.len() / 2 & !1;
        assert!((output[middle] - 0.25).abs() < 1e-4);
        assert!((output[middle + 1] + 0.25).abs() < 1e-4);
    }

    #[test]
    fn starts_again_after_a_reset() {
        let mut resampler = Resampler::new(48000, 44100, 1).unwrap();
        let mut output = Vec::new();
        resampler.push(&sine(1000.0, 48000, 5000), &mut output);
        resampler.reset();

        let mut after = Vec::new();
        resampler.push(&sine(1000.0, 48000, 4800), &mut after);
        resampler.finish(&mut after);
        assert_eq!(after.len(), 4410);
    }

    #[test]
    fn refuses_rates_that_need_a_huge_table() {
        assert!(Resampler::new(44100, 99_999, 2).is_err());
        assert!(Resampler::new(0, 44100, 2).is_err());
    }
}
