import { describe, expect, it } from "vitest";
import { isDiscReady, isPlaybackActive, transition, type PlayerEvent, type PlayerStatus } from "./playerMachine";

const ALL: PlayerStatus[] = ["noDisc", "loadingMetadata", "ready", "loading", "playing", "buffering", "paused"];

/** The full table: for each event, the state it leads to from each state it is allowed in. */
const ALLOWED: Array<[PlayerEvent, Partial<Record<PlayerStatus, PlayerStatus>>]> = [
  [{ type: "discRemoved" }, { loadingMetadata: "noDisc", ready: "noDisc", loading: "noDisc", playing: "noDisc", buffering: "noDisc", paused: "noDisc" }],
  [{ type: "discInserted" }, { noDisc: "loadingMetadata", loadingMetadata: "loadingMetadata", ready: "loadingMetadata", loading: "loadingMetadata", playing: "loadingMetadata", buffering: "loadingMetadata", paused: "loadingMetadata" }],
  [{ type: "metadataSettled" }, { loadingMetadata: "ready" }],
  [{ type: "play" }, { ready: "loading", loading: "loading", playing: "loading", buffering: "loading", paused: "loading" }],
  [{ type: "chunkArrived" }, { loading: "playing", buffering: "playing" }],
  [{ type: "underrun" }, { playing: "buffering" }],
  [{ type: "pause" }, { loading: "paused", playing: "paused", buffering: "paused" }],
  [{ type: "resume", to: "buffering" }, { paused: "buffering" }],
  [{ type: "stop" }, { loading: "ready", playing: "ready", buffering: "ready", paused: "ready" }],
];

describe("transition", () => {
  ALLOWED.forEach(([event, allowed]) => {
    it(`${event.type}: allowed only from ${Object.keys(allowed).join(", ")}`, () => {
      ALL.forEach((status) => expect(transition(status, event), `${event.type} in ${status}`).toBe(allowed[status] ?? null));
    });
  });

  it("resume goes to the state it is given", () => {
    expect(transition("paused", { type: "resume", to: "playing" })).toBe("playing");
    expect(transition("paused", { type: "resume", to: "loading" })).toBe("loading");
  });

  it("can't play before the disc's metadata is settled, or with no disc", () => {
    expect(transition("loadingMetadata", { type: "play" })).toBeNull();
    expect(transition("noDisc", { type: "play" })).toBeNull();
  });

  it("walks the normal life of a disc", () => {
    const events: PlayerEvent[] = [
      { type: "discInserted" },
      { type: "metadataSettled" },
      { type: "play" },
      { type: "chunkArrived" },
      { type: "underrun" },
      { type: "chunkArrived" },
      { type: "pause" },
      { type: "resume", to: "playing" },
      { type: "stop" },
      { type: "discRemoved" },
    ];
    const visited = events.reduce<PlayerStatus[]>((path, event) => [...path, transition(path.at(-1)!, event)!], ["noDisc"]);
    expect(visited).toEqual(["noDisc", "loadingMetadata", "ready", "loading", "playing", "buffering", "playing", "paused", "playing", "ready", "noDisc"]);
  });
});

describe("state groups", () => {
  it("playback is active while loading, playing, buffering or paused", () => {
    expect(ALL.filter(isPlaybackActive)).toEqual(["loading", "playing", "buffering", "paused"]);
  });

  it("a disc is ready once its metadata has settled", () => {
    expect(ALL.filter(isDiscReady)).toEqual(["ready", "loading", "playing", "buffering", "paused"]);
  });
});
