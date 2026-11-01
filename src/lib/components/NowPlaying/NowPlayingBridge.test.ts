import { beforeEach, describe, expect, it, vi } from "vitest";
import { NowPlayingBridge, type NowPlayingState } from "./NowPlayingBridge";

const playingState: NowPlayingState = {
  status: "playing",
  title: "Song",
  artist: "Band",
  album: "Record",
  coverUrl: "https://example.test/cover.jpg",
  positionSeconds: 10,
  durationSeconds: 200,
  canNext: true,
};

const setup = () => {
  const handlers = new Map<string, unknown>();
  const session = {
    metadata: null as unknown,
    playbackState: "none",
    setActionHandler: vi.fn((action: string, handler: unknown) => void handlers.set(action, handler)),
    setPositionState: vi.fn(),
  };
  const audio = { paused: true, play: vi.fn(), pause: vi.fn() };
  audio.play.mockImplementation(() => {
    audio.paused = false;
    return Promise.resolve();
  });
  audio.pause.mockImplementation(() => {
    audio.paused = true;
  });
  const controls = { play: vi.fn(), pause: vi.fn(), previous: vi.fn(), next: vi.fn(), seek: vi.fn(), stop: vi.fn() };
  let clock = 0;
  const bridge = new NowPlayingBridge({
    controls,
    mediaSession: session as unknown as MediaSession,
    audio,
    createMetadata: (init) => init as unknown as MediaMetadata,
    now: () => clock,
  });
  return { bridge, session, audio, controls, handlers, advance: (ms: number) => (clock += ms) };
};

describe("NowPlayingBridge", () => {
  let context: ReturnType<typeof setup>;
  beforeEach(() => {
    context = setup();
  });

  it("sends the media keys to the controls", () => {
    const { handlers, controls } = context;
    (handlers.get("play") as () => void)();
    (handlers.get("previoustrack") as () => void)();
    (handlers.get("seekto") as (details: { seekTime: number }) => void)({ seekTime: 42 });
    expect(controls.play).toHaveBeenCalled();
    expect(controls.previous).toHaveBeenCalled();
    expect(controls.seek).toHaveBeenCalledWith(42);
  });

  it("shows the track and plays the silent element while playing", () => {
    const { bridge, session, audio } = context;
    bridge.update(playingState);
    expect(session.metadata).toEqual({
      title: "Song",
      artist: "Band",
      album: "Record",
      artwork: [{ src: "https://example.test/cover.jpg" }],
    });
    expect(session.playbackState).toBe("playing");
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it("pauses the silent element when paused", () => {
    const { bridge, session, audio } = context;
    bridge.update(playingState);
    bridge.update({ ...playingState, status: "paused" });
    expect(session.playbackState).toBe("paused");
    expect(audio.pause).toHaveBeenCalled();
  });

  it("clears everything when nothing is playing", () => {
    const { bridge, session, audio } = context;
    bridge.update(playingState);
    bridge.update({ ...playingState, status: "ready" });
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
    expect(audio.paused).toBe(true);
  });

  it("only offers Next while something is queued", () => {
    const { bridge, handlers, controls } = context;
    bridge.update(playingState);
    expect(handlers.get("nexttrack")).toBe(controls.next);
    bridge.update({ ...playingState, canNext: false });
    expect(handlers.get("nexttrack")).toBeNull();
  });

  it("reports the position once, then again only after a jump or a state change", () => {
    const { bridge, session, advance } = context;
    bridge.update(playingState);
    advance(1000);
    bridge.update({ ...playingState, positionSeconds: 11 });
    expect(session.setPositionState).toHaveBeenCalledTimes(1);

    advance(1000);
    bridge.update({ ...playingState, positionSeconds: 90 });
    expect(session.setPositionState).toHaveBeenCalledTimes(2);

    bridge.update({ ...playingState, positionSeconds: 90, status: "paused" });
    expect(session.setPositionState).toHaveBeenCalledTimes(3);
  });

  it("keeps the position inside the duration", () => {
    const { bridge, session } = context;
    bridge.update({ ...playingState, positionSeconds: 200.5 });
    expect(session.setPositionState).toHaveBeenCalledWith({ duration: 200, playbackRate: 1, position: 200 });
  });
});
