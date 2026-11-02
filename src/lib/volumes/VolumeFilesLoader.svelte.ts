import { listAudioFiles } from "./listAudioFiles";
import type { OpticalVolume } from "./types";
import { VolumeWatcher } from "./VolumeWatcher.svelte";

interface Options {
  /** Lists the mounted discs; passed through to `VolumeWatcher`. */
  loadVolumes?: () => Promise<OpticalVolume[]>;
  /** Time between checks; passed through to `VolumeWatcher`. */
  intervalMs?: number;
  /** Finds the files to play on a disc. Tests pass a fake. */
  listFiles?: (mountPath: string) => Promise<string[]>;
  /** True when a newly mounted disc may start playing: no audio CD in the drive, and nothing else playing. */
  canLoad?: () => boolean;
  /** Called with the files of a newly mounted disc, in play order. */
  onFiles: (paths: string[], volume: OpticalVolume) => void;
  /** Called when the disc whose files were loaded is ejected. */
  onRemoved: (volume: OpticalVolume) => void;
}

/**
 * Plays data and MP3 CDs: when one is mounted (and `canLoad` allows), its files go to `onFiles`; when it is
 * ejected, `onRemoved` is called so the player can drop them. An audio CD never reaches here: the drive's
 * TOC handles those.
 */
export class VolumeFilesLoader {
  /** The disc whose files were handed to `onFiles` and which is still mounted. */
  loaded = $state<OpticalVolume | null>(null);

  #watcher: VolumeWatcher;
  #listFiles: (mountPath: string) => Promise<string[]>;
  #canLoad: () => boolean;
  #onFiles: (paths: string[], volume: OpticalVolume) => void;
  #onRemoved: (volume: OpticalVolume) => void;
  /** Discs already tried, so each is loaded once per insertion, however many checks see it. */
  #handledMountPaths = new Set<string>();

  constructor({ loadVolumes, intervalMs, listFiles = listAudioFiles, canLoad = () => true, onFiles, onRemoved }: Options) {
    this.#listFiles = listFiles;
    this.#canLoad = canLoad;
    this.#onFiles = onFiles;
    this.#onRemoved = onRemoved;
    this.#watcher = new VolumeWatcher({ loadVolumes, intervalMs, onChange: (volumes) => this.#handleChange(volumes) });
  }

  start(): void {
    this.#watcher.start();
  }

  stop(): void {
    this.#watcher.stop();
  }

  checkNow(): Promise<void> {
    return this.#watcher.checkNow();
  }

  async #handleChange(volumes: OpticalVolume[]): Promise<void> {
    const mountPaths = new Set(volumes.map(({ mount_path }) => mount_path));
    this.#handledMountPaths = new Set([...this.#handledMountPaths].filter((path) => mountPaths.has(path)));

    if (this.loaded && !mountPaths.has(this.loaded.mount_path)) {
      const removed = this.loaded;
      this.loaded = null;
      this.#onRemoved(removed);
    }

    const fresh = volumes.find(({ mount_path }) => !this.#handledMountPaths.has(mount_path));
    if (!fresh || !this.#canLoad()) return;
    this.#handledMountPaths.add(fresh.mount_path);

    const paths = await this.#listFiles(fresh.mount_path).catch(() => []);
    if (paths.length === 0) return;
    this.loaded = fresh;
    this.#onFiles(paths, fresh);
  }
}
