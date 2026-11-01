import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5 } from "./md5";

describe("md5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    // 80 bytes: pads into a second block.
    ["12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a"],
    ["The quick brown fox jumps over the lazy dog", "9e107d9d372bb6826bd81d3542a419d6"],
  ])("hashes %j", (text, expected) => {
    expect(md5(text)).toBe(expected);
  });

  it.each(["é", "Björk – Homogenic 🎵", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)])(
    "matches Node's MD5 for %j",
    (text) => {
      expect(md5(text)).toBe(createHash("md5").update(text).digest("hex"));
    },
  );
});
