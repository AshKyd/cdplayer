import { beforeEach, describe, expect, it } from "vitest";
import type { LastFmTrack } from "$lib/lastfm/lastFmClient";
import { ScrobbleTracker, type PlaybackSnapshot } from "./ScrobbleTracker";

const playing: PlaybackSnapshot = {
  isSounding: true,
  isActive: true,
  trackNumber: 1,
  title: "Song",
  artist: "Band",
  album: "Album",
  positionSeconds: 0,
  durationSeconds: 200,
};

const setup = () => {
  const nowPlaying: LastFmTrack[] = [];
  const scrobbles: Array<{ track: LastFmTrack; startedAtSeconds: number }> = [];
  const ignored: number[] = [];
  let nowMs = 1_000_000;
  const tracker = new ScrobbleTracker({
    onNowPlaying: (track) => nowPlaying.push(track),
    onScrobble: (track, startedAtSeconds) => scrobbles.push({ track, startedAtSeconds }),
    onIgnored: (trackNumber) => ignored.push(trackNumber),
    now: () => nowMs,
  });
  /** Plays on from the current position, one second per step, up to `toSeconds`. */
  const playTo = (toSeconds: number, snapshot: Partial<PlaybackSnapshot> = {}, fromSeconds = 0) => {
    for (let position = fromSeconds; position <= toSeconds; position++) {
      tracker.update({ ...playing, ...snapshot, positionSeconds: position });
      nowMs += 1000;
    }
  };
  return { tracker, nowPlaying, scrobbles, ignored, playTo };
};

describe("ScrobbleTracker", () => {
  let context: ReturnType<typeof setup>;
  beforeEach(() => {
    context = setup();
  });

  it("sends now playing once when the track starts sounding", () => {
    context.playTo(5);
    expect(context.nowPlaying).toEqual([
      { artist: "Band", title: "Song", album: "Album", durationSeconds: 200, trackNumber: 1 },
    ]);
  });

  it("waits for sound before sending now playing", () => {
    context.tracker.update({ ...playing, isSounding: false });
    expect(context.nowPlaying).toEqual([]);
    context.tracker.update({ ...playing });
    expect(context.nowPlaying).toHaveLength(1);
  });

  it("scrobbles once after half the track, stamped with when it began", () => {
    context.playTo(150);
    expect(context.scrobbles).toHaveLength(1);
    expect(context.scrobbles[0].startedAtSeconds).toBe(1000);
  });

  it("does not scrobble before half the track", () => {
    context.playTo(99);
    expect(context.scrobbles).toEqual([]);
  });

  it("scrobbles a long track after four minutes", () => {
    context.playTo(239, { durationSeconds: 1000 });
    expect(context.scrobbles).toEqual([]);
    context.playTo(241, { durationSeconds: 1000 }, 240);
    expect(context.scrobbles).toHaveLength(1);
  });

  it("never scrobbles a track of 30 seconds or less", () => {
    context.playTo(30, { durationSeconds: 30 });
    expect(context.scrobbles).toEqual([]);
  });

  it("does not count paused time or a seek ahead as listening", () => {
    context.playTo(10);
    // Paused: position holds still, nothing is added.
    Array.from({ length: 200 }).forEach(() => context.tracker.update({ ...playing, isSounding: false, positionSeconds: 10 }));
    // Seeks to 190.
    context.tracker.update({ ...playing, positionSeconds: 190 });
    context.tracker.update({ ...playing, positionSeconds: 191 });
    expect(context.scrobbles).toEqual([]);
  });

  it("treats a different track as a new play", () => {
    context.playTo(150);
    context.playTo(5, { trackNumber: 2, title: "Next" });
    expect(context.nowPlaying.map(({ title }) => title)).toEqual(["Song", "Next"]);
    expect(context.scrobbles).toHaveLength(1);
  });

  it("starts a new play when the track is started over after being scrobbled", () => {
    context.playTo(150);
    context.playTo(150, {}, 0);
    expect(context.nowPlaying).toHaveLength(2);
    expect(context.scrobbles).toHaveLength(2);
  });

  it("forgets the play when playback stops", () => {
    context.playTo(150);
    context.tracker.update({ ...playing, isActive: false, trackNumber: null });
    context.playTo(5);
    expect(context.nowPlaying).toHaveLength(2);
  });

  it("ignores tracks with no artist, as when the disc isn't on MusicBrainz, and says so once", () => {
    context.playTo(150, { artist: "" });
    expect(context.nowPlaying).toEqual([]);
    expect(context.scrobbles).toEqual([]);
    expect(context.ignored).toEqual([1]);
  });
});
