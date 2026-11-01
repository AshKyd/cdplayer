import { describe, expect, it } from "vitest";
import { AnimatedWindowHeight, type NumberStore, type WindowHeightControl } from "./AnimatedWindowHeight";

interface SetupOptions {
  /** What the window is set to at the start. */
  height?: number;
  canResize?: boolean;
  /** How much shorter the page's viewport is than the window's set height. */
  hiddenOffset?: number;
  offsetStore?: NumberStore;
  expandedHeightStore?: NumberStore;
}

/** A window, a clock that moves 50 ms per frame, and every height that was set. */
const setup = ({ height = 600, canResize = true, hiddenOffset = 0, offsetStore, expandedHeightStore }: SetupOptions = {}) => {
  const state = { height, canResize, minimum: 0, clock: 0, heights: [] as number[], viewport: () => state.height - hiddenOffset };
  const control: WindowHeightControl = {
    getHeight: async () => state.height,
    getViewportHeight: async () => state.viewport(),
    setHeight: async (next) => {
      state.height = next;
      state.heights.push(next);
    },
    setMinimumHeight: async (next) => void (state.minimum = next),
    canResize: async () => state.canResize,
  };
  const animator = new AnimatedWindowHeight({
    control,
    offsetStore,
    expandedHeightStore,
    durationMs: 200,
    now: () => state.clock,
    requestFrame: (callback) => {
      state.clock += 50;
      callback();
    },
  });
  return { state, animator };
};

const memoryStore = (initial: number | null = null): NumberStore & { value: number | null } => {
  const store = { value: initial, load: () => store.value, save: (next: number) => void (store.value = next) };
  return store;
};

describe("AnimatedWindowHeight", () => {
  it("collapses in steps and ends exactly on the target", async () => {
    const { state, animator } = setup();
    await animator.collapseTo(150);
    expect(state.height).toBe(150);
    expect(state.heights.length).toBeGreaterThan(2);
    expect(state.heights).toEqual([...state.heights].sort((a, b) => b - a));
  });

  it("restores the height from before the collapse", async () => {
    const { state, animator } = setup({ height: 640 });
    await animator.collapseTo(150);
    await animator.restore();
    expect(state.height).toBe(640);
  });

  it("keeps the first height when collapsed twice, even if the user resized in between", async () => {
    const { state, animator } = setup({ height: 640 });
    await animator.collapseTo(150);
    state.height = 300;
    await animator.collapseTo(150);
    await animator.restore();
    expect(state.height).toBe(640);
  });

  it("never grows the window when collapsing, and restores it afterwards", async () => {
    const { state, animator } = setup({ height: 100 });
    await animator.collapseTo(150);
    expect(state.height).toBe(100);
    await animator.restore();
    expect(state.height).toBe(100);
  });

  it("sets the window minimum and never collapses below it", async () => {
    const { state, animator } = setup();
    await animator.setMinimumHeight(220);
    await animator.collapseTo(150);
    expect(state.minimum).toBe(220);
    expect(state.height).toBe(220);
  });

  it("finds a constant offset between the set and real height, and keeps it", async () => {
    const offsetStore = memoryStore();
    const { state, animator } = setup({ hiddenOffset: 32, offsetStore });
    await animator.setMinimumHeight(150);
    await animator.collapseTo(150);
    expect(state.viewport()).toBe(150);
    expect(state.minimum).toBe(182);
    expect(offsetStore.value).toBe(32);

    await animator.restore();
    expect(state.height).toBe(600);
  });

  it("uses a stored offset from the first collapse, so it doesn't undershoot", async () => {
    const { state, animator } = setup({ hiddenOffset: 32, offsetStore: memoryStore(32) });
    await animator.collapseTo(150);
    expect(Math.min(...state.heights)).toBe(182);
    expect(state.viewport()).toBe(150);
  });

  it("does nothing on restore when it wasn't collapsed", async () => {
    const { state, animator } = setup();
    await animator.restore();
    expect(state.height).toBe(600);
  });

  it("leaves a fullscreen or maximised window alone and remembers nothing", async () => {
    const { state, animator } = setup({ canResize: false });
    await animator.collapseTo(150);
    state.canResize = true;
    state.height = 500;
    await animator.restore();
    expect(state.height).toBe(500);
  });

  describe("when the app opens already small", () => {
    it("doesn't move on the first collapse, then grows to the stored expanded height", async () => {
      const expandedHeightStore = memoryStore(720);
      const { state, animator } = setup({ height: 164, hiddenOffset: 32, offsetStore: memoryStore(32), expandedHeightStore });

      await animator.collapseTo(132);
      expect(state.heights).toEqual([]);

      await animator.restore();
      expect(state.height).toBe(720);
    });

    it("falls back to the default expanded height when none is stored", async () => {
      const { state, animator } = setup({ height: 164, offsetStore: memoryStore(0), expandedHeightStore: memoryStore() });
      await animator.collapseTo(164);
      await animator.restore();
      expect(state.height).toBe(600);
    });

    it("stores the user's height when they collapse from an expanded window", async () => {
      const expandedHeightStore = memoryStore();
      const { animator } = setup({ height: 640, expandedHeightStore });
      await animator.collapseTo(150);
      expect(expandedHeightStore.value).toBe(640);
    });
  });
});
