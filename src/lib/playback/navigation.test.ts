import { describe, expect, it } from "vitest";
import type { Track } from "$lib/disc/types";
import { previousStep, tracksFrom } from "./navigation";

const audio = (number: number): Track => ({ number, first_sector: number * 100, last_sector: number * 100 + 99, is_audio: true });
const tracks: Track[] = [audio(1), audio(2), audio(3), { ...audio(4), is_audio: false }];

describe("tracksFrom", () => {
  it("returns the track and the playable ones after it, in order", () => {
    expect(tracksFrom(tracks, tracks[1]).map(({ number }) => number)).toEqual([2, 3]);
  });

  it("leaves out data tracks, even when starting from one", () => {
    expect(tracksFrom(tracks, tracks[3])).toEqual([]);
  });
});

describe("previousStep", () => {
  const step = (currentTrackNumber: number | null, positionSeconds: number) =>
    previousStep({ tracks, currentTrackNumber, positionSeconds });

  it("goes back a track near the start of a track", () => {
    expect(step(3, 1)).toEqual({ kind: "play", track: tracks[1] });
  });

  it("restarts the track once it has been playing a while", () => {
    expect(step(3, 10)).toEqual({ kind: "restart" });
  });

  it("restarts the first track, since nothing is before it", () => {
    expect(step(1, 1)).toEqual({ kind: "restart" });
  });

  it("restarts when nothing is playing", () => {
    expect(step(null, 0)).toEqual({ kind: "restart" });
  });
});
