import type { Toc } from "$lib/disc/types";

/** Frames between the start of the disc and LBA 0: every offset in a MusicBrainz disc ID includes it. */
const LEAD_IN_FRAMES = 150;

/** The ID has a slot for each of tracks 1 to 99, plus one for the lead-out. */
const MAX_TRACKS = 99;

const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, "0");

/**
 * The text that is hashed for a MusicBrainz disc ID, or `null` if the disc has no audio tracks:
 * first and last track numbers (2 hex digits each), then 100 offsets (8 hex digits each) for the
 * lead-out and tracks 1 to 99, with 0 for tracks the disc doesn't have.
 *
 * Only audio tracks count. On a CD-Extra disc the lead-out is the end of the audio session; the TOC already
 * ends the last audio track there (`SESSION_GAP_SECTORS` in Rust), so it is the end of that track.
 */
export const discIdInput = ({ tracks }: Toc): string | null => {
  const audio = tracks.filter(({ is_audio }) => is_audio);
  if (audio.length === 0) return null;

  const first = audio[0].number;
  const last = audio[audio.length - 1];
  const leadOut = last.last_sector + 1 + LEAD_IN_FRAMES;

  const offsets = Array.from({ length: MAX_TRACKS }, (_, index) => {
    const track = audio.find(({ number }) => number === index + 1);
    return track ? track.first_sector + LEAD_IN_FRAMES : 0;
  });
  return [hex(first, 2), hex(last.number, 2), hex(leadOut, 8), ...offsets.map((offset) => hex(offset, 8))].join("");
};

/**
 * The MusicBrainz disc ID: the SHA-1 of `discIdInput()` in base64, with `+`, `/` and `=` replaced by `.`,
 * `_` and `-`. Always 28 characters. `null` if the disc has no audio tracks.
 */
export const computeDiscId = async (toc: Toc): Promise<string | null> => {
  const input = discIdInput(toc);
  if (input === null) return null;

  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", ".")
    .replaceAll("/", "_")
    .replaceAll("=", "-");
};
