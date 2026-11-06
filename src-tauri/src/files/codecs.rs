//! The codec registry for audio files: symphonia's own decoders plus Opus, which symphonia 0.6 lacks.

use std::sync::LazyLock;
use symphonia::core::codecs::registry::CodecRegistry;
use symphonia_adapter_libopus::OpusDecoder;

static REGISTRY: LazyLock<CodecRegistry> = LazyLock::new(|| {
    let mut registry = CodecRegistry::new();
    symphonia::default::register_enabled_codecs(&mut registry);
    registry.register_audio_decoder::<OpusDecoder>();
    registry
});

/// Use this instead of `symphonia::default::get_codecs()` so Opus files decode.
pub fn registry() -> &'static CodecRegistry {
    &REGISTRY
}
