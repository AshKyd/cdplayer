import { invoke } from "@tauri-apps/api/core";
import type { OpticalVolume } from "./types";

interface Options {
  /** Lists the mounted discs. */
  loadVolumes?: () => Promise<OpticalVolume[]>;
  /** Time between automatic checks. */
  intervalMs?: number;
  /** Called when the set of mounted discs changes, including the first check (possibly with none). `checkNow()` waits for it. */
  onChange?: (volumes: OpticalVolume[]) => void | Promise<void>;
}

/**
 * Notices data and MP3 CDs being inserted or ejected by listing the mounted discs at an interval.
 * Unlike `DiscWatcher` it keeps checking during playback: the list comes from the operating system's
 * mount table, so it never touches the disc, and it is how an ejected disc is noticed.
 */
export class VolumeWatcher {
  volumes = $state<OpticalVolume[]>([]);

  #loadVolumes: () => Promise<OpticalVolume[]>;
  #intervalMs: number;
  #onChange: (volumes: OpticalVolume[]) => void | Promise<void>;
  #timer: ReturnType<typeof setInterval> | undefined;
  #checking = false;
  /** The mount paths of the last result; `undefined` until the first check finishes. */
  #lastMountPaths: string | undefined;

  constructor({
    loadVolumes = () => invoke<OpticalVolume[]>("list_optical_volumes"),
    intervalMs = 3000,
    onChange = () => {},
  }: Options = {}) {
    this.#loadVolumes = loadVolumes;
    this.#intervalMs = intervalMs;
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
  }

  /** Looks once. Does nothing while an earlier check is still running. */
  async checkNow(): Promise<void> {
    if (this.#checking) return;
    this.#checking = true;
    // A failed listing is treated as no discs, so an eject is still noticed.
    const volumes = await this.#loadVolumes().catch(() => []);
    this.#checking = false;

    const mountPaths = JSON.stringify(volumes.map(({ mount_path }) => mount_path).sort());
    if (mountPaths === this.#lastMountPaths) return;
    this.#lastMountPaths = mountPaths;
    this.volumes = volumes;
    await this.#onChange(volumes);
  }
}
