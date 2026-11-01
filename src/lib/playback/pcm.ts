/**
 * Converts headerless 16-bit little-endian interleaved stereo PCM into one Float32Array per channel.
 * Done by hand (not `decodeAudioData`) because CD audio has no container to decode.
 */
export const int16InterleavedToChannels = (pcm: ArrayBuffer): [Float32Array, Float32Array] => {
  const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 4) * 2);
  const frameCount = samples.length / 2;
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    left[frame] = samples[frame * 2] / 32768;
    right[frame] = samples[frame * 2 + 1] / 32768;
  }
  return [left, right];
};
