import { invoke } from "@tauri-apps/api/core";
import { tocFingerprint } from "./tocFingerprint";
import type { Toc } from "./types";

interface Options {
  /** Reads the table of contents from the drive. `get_toc` re-opens the drive on every call. */
  loadToc?: () => Promise<Toc>;
  /** True while the drive is in use (playing); the watcher leaves it alone then. */
  isBusy?: () => boolean;
  /** Time between automatic checks. */
  intervalMs?: number;
  /** How long a check must run before `reading` turns on. */
  readingDelayMs?: number;
  /** Called when the disc changes, including the first check and a disc being removed (`null`). */
  onChange?: (toc: Toc | null) => void;
}

/**
 * Finds out which disc is in the drive by asking for its TOC at an interval, and reports changes.
 * The polling lives here in JS; Rust only answers "what is in the drive now".
 */
export class DiscWatcher {
  toc = $state<Toc | null>(null);
  /** Why there is no disc (empty drive, no drive), or empty when there is one. */
  error = $state("");
  checking = $state(false);
  /**
   * True once a check has taken longer than `readingDelayMs`. An empty drive answers almost at once, so
   * this stays false for it and the UI doesn't flash a spinner on every poll; a disc spinning up is slow
   * enough to show it.
   */
  reading = $state(false);

  #loadToc: () => Promise<Toc>;
  #isBusy: () => boolean;
  #intervalMs: number;
  #readingDelayMs: number;
  #readingTimer: ReturnType<typeof setTimeout> | undefined;
  #onChange: (toc: Toc | null) => void;
  #timer: ReturnType<typeof setInterval> | undefined;
  /** Fingerprint of the last result; `undefined` until the first check finishes. */
  #lastFingerprint: string | undefined;

  constructor({
    loadToc = () => invoke<Toc>("get_toc"),
    isBusy = () => false,
    intervalMs = 3000,
    readingDelayMs = 400,
    onChange = () => {},
  }: Options = {}) {
    this.#loadToc = loadToc;
    this.#isBusy = isBusy;
    this.#intervalMs = intervalMs;
    this.#readingDelayMs = readingDelayMs;
    this.#onChange = onChange;
  }

  /** Checks now, then every `intervalMs`. */
  start(): void {
    this.stop();
    void this.checkNow();
    this.#timer = setInterval(() => void this.checkNow(), this.#intervalMs);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    clearTimeout(this.#readingTimer);
  }

  /**
   * Looks at the drive once. Does nothing while playing (re-opening the drive would cut off reads)
   * or while an earlier check is still running.
   */
  async checkNow(): Promise<void> {
    if (this.checking || this.#isBusy()) return;
    this.checking = true;
    this.#readingTimer = setTimeout(() => (this.reading = true), this.#readingDelayMs);

    const result = await this.#loadToc().then(
      (toc) => ({ toc, error: "" }),
      (reason) => ({ toc: null, error: String(reason) }),
    );
    clearTimeout(this.#readingTimer);
    this.checking = false;
    this.reading = false;
    this.error = result.error;

    const fingerprint = tocFingerprint(result.toc);
    if (fingerprint === this.#lastFingerprint) return;
    this.#lastFingerprint = fingerprint;
    this.toc = result.toc;
    this.#onChange(result.toc);
  }
}
