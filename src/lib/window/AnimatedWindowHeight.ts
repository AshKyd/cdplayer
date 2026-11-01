/** What `AnimatedWindowHeight` needs from a window, so it can be tested without Tauri. */
export interface WindowHeightControl {
  /** The height the window was last set to (or opened at), in logical pixels. */
  getHeight(): Promise<number>;
  setHeight(height: number): Promise<void>;
  /** The smallest height the user (or the OS) can resize the window to. */
  setMinimumHeight(height: number): Promise<void>;
  /** False when resizing makes no sense (fullscreen, maximised). */
  canResize(): Promise<boolean>;
  /**
   * The height the page can actually use, read once the window has settled. It can differ from the window's
   * set height (the native side may count the window differently), which is how a constant offset is found.
   */
  getViewportHeight?(): Promise<number>;
  /** Calls `callback` whenever the window is resized, by us or the user. Returns a function that stops it. */
  onResized?(callback: () => void): Promise<() => void>;
}

/** An offset bigger than this is not a title bar; it's something else (a minimum size, say) and is ignored. */
const MAX_PLAUSIBLE_OFFSET = 100;

/** A number kept between launches. */
export interface NumberStore {
  load(): number | null;
  save(value: number): void;
}

interface Options {
  control: WindowHeightControl;
  /** Keeps the found offset, so the first collapse of a session is already right. */
  offsetStore?: NumberStore;
  /** The offset to use until one is stored or measured. */
  initialOffset?: number;
  /**
   * Keeps the height the user gave the expanded window. Needed when the app opens already collapsed, since
   * there is then no expanded height to read.
   */
  expandedHeightStore?: NumberStore;
  /** Used when the app opens collapsed and nothing is stored. */
  defaultExpandedHeight?: number;
  durationMs?: number;
  /** How long the user must stop resizing before their height is stored. */
  resizeSettleMs?: number;
  /** Tests pass a fake clock and frame scheduler. */
  now?: () => number;
  requestFrame?: (callback: () => void) => void;
}

const easeInOut = (progress: number): number => (progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2);

/**
 * Shrinks the window to fit its content and later returns it to the height the user had.
 *
 * Window heights here are what the window is set to. The page's viewport can be a constant `#offset` shorter,
 * so a page height is converted by adding the offset before it is set.
 *
 * The user's height is only remembered when a collapse begins from an expanded window, so a second collapse,
 * or the user dragging the collapsed window, never overwrites what the user chose. When the app opens
 * already small there is nothing to animate: the height comes from `expandedHeightStore`. Tauri has no
 * animated resize, so each frame sets the size from JS.
 */
export class AnimatedWindowHeight {
  #control: WindowHeightControl;
  #offsetStore?: NumberStore;
  #expandedHeightStore?: NumberStore;
  #defaultExpandedHeight: number;
  #durationMs: number;
  #resizeSettleMs: number;
  #now: () => number;
  #requestFrame: (callback: () => void) => void;

  /** The height before collapsing, or `null` while the window is at the user's height. */
  #heightBeforeCollapse: number | null = null;
  /** Page height, not window height. */
  #minimumHeight = 0;
  /**
   * How much taller than wanted the window must be asked to be for the page to get the wanted height. Found
   * by comparing the page's real viewport with the request after a move.
   */
  #offset: number;
  /** Bumped by every move, so an animation stops when a newer one starts. */
  #moveId = 0;
  #isMoving = false;

  constructor({
    control,
    offsetStore,
    initialOffset = 0,
    expandedHeightStore,
    defaultExpandedHeight = 600,
    durationMs = 250,
    resizeSettleMs = 400,
    now = () => performance.now(),
    requestFrame = (callback) => requestAnimationFrame(callback),
  }: Options) {
    this.#control = control;
    this.#offsetStore = offsetStore;
    this.#offset = offsetStore?.load() ?? initialOffset;
    this.#expandedHeightStore = expandedHeightStore;
    this.#defaultExpandedHeight = defaultExpandedHeight;
    this.#durationMs = durationMs;
    this.#resizeSettleMs = resizeSettleMs;
    this.#now = now;
    this.#requestFrame = requestFrame;
  }

  /**
   * Stores the height the user gives the expanded window, so the next launch (which opens collapsed) can
   * grow back to it. Returns a function that stops watching.
   */
  async watchUserHeight(): Promise<() => void> {
    if (!this.#expandedHeightStore || !this.#control.onResized) return () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = await this.#control.onResized(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void this.#storeUserHeight(), this.#resizeSettleMs);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }

  async #storeUserHeight(): Promise<void> {
    // Our own moves and the collapsed size are not the user's choice.
    if (this.#isMoving || this.#heightBeforeCollapse !== null || !(await this.#control.canResize())) return;
    this.#expandedHeightStore?.save(await this.#control.getHeight());
  }

  /**
   * Sets the window's minimum height, and never collapses or restores below it. Applies even when the
   * window is fullscreen or maximised, where only the animation is skipped.
   */
  async setMinimumHeight(pageHeight: number): Promise<void> {
    this.#minimumHeight = pageHeight;
    await this.#control.setMinimumHeight(pageHeight + this.#offset);
  }

  /**
   * Animates down so the page is `pageHeight` tall (never up: a window already that small is left alone,
   * with no animation, as when the app opens small).
   */
  async collapseTo(pageHeight: number): Promise<void> {
    if (!(await this.#control.canResize())) return;
    const current = await this.#control.getHeight();
    const target = Math.max(pageHeight, this.#minimumHeight) + this.#offset;

    if (this.#heightBeforeCollapse === null) {
      const alreadySmall = current <= target;
      this.#heightBeforeCollapse = alreadySmall && this.#expandedHeightStore ? (this.#expandedHeightStore.load() ?? this.#defaultExpandedHeight) : current;
      if (!alreadySmall) this.#expandedHeightStore?.save(current);
    }
    // Only a collapse is checked: its target is the page's own content height, so it is what the viewport should show.
    await this.#animate(current, Math.min(current, target), { calibrate: true });
  }

  /** Animates back to the height from before the collapse. Does nothing if the window wasn't collapsed. */
  async restore(): Promise<void> {
    const remembered = this.#heightBeforeCollapse;
    if (remembered === null) return;
    this.#heightBeforeCollapse = null;
    if (!(await this.#control.canResize())) return;
    await this.#animate(await this.#control.getHeight(), Math.max(remembered, this.#minimumHeight + this.#offset));
  }

  async #animate(from: number, to: number, { calibrate = false } = {}): Promise<void> {
    const moveId = ++this.#moveId;
    if (from === to) return;

    this.#isMoving = true;
    const startedAt = this.#now();
    const step = async (): Promise<void> => {
      if (moveId !== this.#moveId) return;
      const progress = Math.min((this.#now() - startedAt) / this.#durationMs, 1);
      await this.#control.setHeight(Math.round(from + (to - from) * easeInOut(progress)));
      if (progress < 1 && moveId === this.#moveId) await new Promise<void>((resolve) => this.#requestFrame(resolve)).then(step);
    };
    await step();
    if (moveId === this.#moveId) this.#isMoving = false;
    if (calibrate) await this.#calibrate(to, moveId);
  }

  /**
   * Compares the height the page really got with the height the window was set to, and if they differ by a
   * constant (a title bar the native side counts, say) asks for that much more from now on. Without this the
   * collapsed page is clipped and loses its bottom padding.
   */
  async #calibrate(setHeight: number, moveId: number): Promise<void> {
    const viewport = await this.#control.getViewportHeight?.();
    if (viewport === undefined || moveId !== this.#moveId) return;

    const offset = Math.round(setHeight - viewport);
    if (offset === this.#offset || Math.abs(offset) > MAX_PLAUSIBLE_OFFSET) return;

    const pageHeight = setHeight - this.#offset;
    this.#offset = offset;
    this.#offsetStore?.save(offset);
    await Promise.all([this.#control.setHeight(pageHeight + offset), this.#control.setMinimumHeight(this.#minimumHeight + offset)]);
  }
}
