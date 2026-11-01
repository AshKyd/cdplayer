/** Rotate amounts: four per round, repeating within the round's 16 steps. */
const SHIFTS = [
  [7, 12, 17, 22],
  [5, 9, 14, 20],
  [4, 11, 16, 23],
  [6, 10, 15, 21],
];

/** Sine-derived constants, as the MD5 spec defines them. */
const CONSTANTS = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0);

const rotateLeft = (value: number, bits: number): number => (value << bits) | (value >>> (32 - bits));

/**
 * MD5 of a string (as UTF-8), in lower-case hex.
 *
 * Last.fm signs requests and logs in with MD5, and WebCrypto doesn't offer it. This is for that protocol only;
 * MD5 isn't safe for anything else.
 */
export const md5 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);

  // Pad: a 1 bit, zeros up to 56 mod 64, then the bit length as a 64-bit little-endian number.
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, (bytes.length << 3) >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bytes.length / 2 ** 29), true);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
    let [a, b, c, d] = [a0, b0, c0, d0];

    for (let step = 0; step < 64; step++) {
      const [mix, wordIndex] =
        step < 16
          ? [(b & c) | (~b & d), step]
          : step < 32
            ? [(d & b) | (~d & c), (5 * step + 1) % 16]
            : step < 48
              ? [b ^ c ^ d, (3 * step + 5) % 16]
              : [c ^ (b | ~d), (7 * step) % 16];
      const sum = (a + mix + CONSTANTS[step] + words[wordIndex]) | 0;
      [a, d, c] = [d, c, b];
      b = (b + rotateLeft(sum, SHIFTS[step >> 4][step % 4])) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const digest = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((word, index) => digest.setUint32(index * 4, word >>> 0, true));
  return Array.from(new Uint8Array(digest.buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
