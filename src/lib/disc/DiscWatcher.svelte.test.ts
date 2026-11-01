import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscWatcher } from "./DiscWatcher.svelte";
import type { Toc } from "./types";

const discA: Toc = { tracks: [{ number: 1, first_sector: 0, last_sector: 99, is_audio: true }], leadout_sector: 100 };
const discB: Toc = { tracks: [{ number: 1, first_sector: 0, last_sector: 199, is_audio: true }], leadout_sector: 200 };

/** A drive whose contents the test changes: a Toc is a disc, `null` is an empty drive. */
const fakeDrive = (initial: Toc | null) => {
  const drive = {
    disc: initial,
    calls: 0,
    loadToc: async () => {
      drive.calls++;
      if (!drive.disc) throw "no usable audio CD drive found";
      return drive.disc;
    },
  };
  return drive;
};

describe("DiscWatcher", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("reports the first disc, then ignores identical reads", async () => {
    const drive = fakeDrive(discA);
    const onChange = vi.fn();
    const watcher = new DiscWatcher({ loadToc: drive.loadToc, onChange, intervalMs: 1000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(3000);
    watcher.stop();

    expect(drive.calls).toBe(4);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(watcher.toc).toEqual(discA);
    expect(watcher.error).toBe("");
  });

  it("notices a swapped disc, an ejected disc, and a disc coming back", async () => {
    const drive = fakeDrive(discA);
    const onChange = vi.fn();
    const watcher = new DiscWatcher({ loadToc: drive.loadToc, onChange });

    await watcher.checkNow();
    drive.disc = discB;
    await watcher.checkNow();
    expect(watcher.toc).toEqual(discB);

    drive.disc = null;
    await watcher.checkNow();
    expect(watcher.toc).toBeNull();
    expect(watcher.error).toBe("no usable audio CD drive found");

    drive.disc = discB;
    await watcher.checkNow();
    expect(watcher.toc).toEqual(discB);
    expect(watcher.error).toBe("");
    expect(onChange.mock.calls.map(([toc]) => toc)).toEqual([discA, discB, null, discB]);
  });

  it("reports an empty drive once, not on every check", async () => {
    const drive = fakeDrive(null);
    const onChange = vi.fn();
    const watcher = new DiscWatcher({ loadToc: drive.loadToc, onChange });

    await watcher.checkNow();
    await watcher.checkNow();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("leaves the drive alone while busy", async () => {
    const drive = fakeDrive(discA);
    let busy = true;
    const watcher = new DiscWatcher({ loadToc: drive.loadToc, isBusy: () => busy, intervalMs: 1000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(drive.calls).toBe(0);

    busy = false;
    await vi.advanceTimersByTimeAsync(1000);
    watcher.stop();
    expect(drive.calls).toBe(1);
  });

  it("doesn't start a check while one is still running", async () => {
    let finish: (toc: Toc) => void = () => {};
    const loadToc = vi.fn(() => new Promise<Toc>((resolve) => (finish = resolve)));
    const watcher = new DiscWatcher({ loadToc });

    const first = watcher.checkNow();
    await watcher.checkNow();
    expect(loadToc).toHaveBeenCalledTimes(1);

    finish(discA);
    await first;
    expect(watcher.checking).toBe(false);
  });

  it("only reports reading once a check has taken longer than the delay", async () => {
    let finish: (toc: Toc) => void = () => {};
    const loadToc = () => new Promise<Toc>((resolve) => (finish = resolve));
    const watcher = new DiscWatcher({ loadToc, readingDelayMs: 400 });

    const check = watcher.checkNow();
    await vi.advanceTimersByTimeAsync(399);
    expect(watcher.reading).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(watcher.reading).toBe(true);

    finish(discA);
    await check;
    expect(watcher.reading).toBe(false);
  });

  it("never reports reading for a quick check", async () => {
    const watcher = new DiscWatcher({ loadToc: fakeDrive(null).loadToc, readingDelayMs: 400 });

    await watcher.checkNow();
    await vi.advanceTimersByTimeAsync(1000);

    expect(watcher.reading).toBe(false);
  });

  it("stops polling after stop()", async () => {
    const drive = fakeDrive(discA);
    const watcher = new DiscWatcher({ loadToc: drive.loadToc, intervalMs: 1000 });

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);
    watcher.stop();
    const callsAtStop = drive.calls;
    await vi.advanceTimersByTimeAsync(5000);

    expect(drive.calls).toBe(callsAtStop);
  });
});
