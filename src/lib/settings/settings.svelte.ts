import { tauriSettingsSync } from "./tauriSettingsSync";

/** What the user can change. Add new settings here with a default; older saved settings fill in from it. */
export interface SettingsValues {
  /** Look up track names and cover art on MusicBrainz when a disc is inserted. */
  readonly musicBrainzEnabled: boolean;
  /** Fade the sound in and out over 100 ms when playing and pausing, to avoid clicks. */
  readonly fadeEnabled: boolean;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  musicBrainzEnabled: true,
  fadeEnabled: true,
};

const STORAGE_KEY = "cdplayer.settings";

/** Where settings are kept between runs. `localStorage` fits. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Carries a change to the app's other windows. Tests pass a fake. */
export interface SettingsSync {
  publish(values: SettingsValues, senderId: string): void;
  /** Calls `handler` for changes made by other windows. Returns a function that stops listening. */
  subscribe(handler: (values: Partial<SettingsValues>, senderId: string) => void): () => void;
}

interface Options {
  /** Defaults to `localStorage` when there is one. */
  storage?: SettingsStorage | null;
  sync?: SettingsSync | null;
}

const browserStorage = (): SettingsStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

/** Reads saved values over the defaults. Missing, corrupt or wrongly typed data falls back to the defaults. */
const loadValues = (storage: SettingsStorage | null): SettingsValues => {
  const saved = (() => {
    try {
      return JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}") as Partial<SettingsValues> | null;
    } catch {
      return {};
    }
  })();
  return pickKnownValues(saved ?? {});
};

/** Keeps only known settings of the right type, so a bad message or file can't put junk in the store. */
const pickKnownValues = (incoming: Partial<SettingsValues>): SettingsValues => ({
  musicBrainzEnabled:
    typeof incoming.musicBrainzEnabled === "boolean" ? incoming.musicBrainzEnabled : DEFAULT_SETTINGS.musicBrainzEnabled,
  fadeEnabled: typeof incoming.fadeEnabled === "boolean" ? incoming.fadeEnabled : DEFAULT_SETTINGS.fadeEnabled,
});

/**
 * The app's settings. Every window imports the same `settings` object and gets its own copy of the values,
 * which stay equal two ways: saved to `localStorage` (so a new window or the next run starts right),
 * and sent to the other open windows through `SettingsSync` (so they change live).
 *
 * A change made here is saved and sent. A change received from another window is applied but not sent
 * again, and a window ignores its own messages, so the windows never echo each other forever.
 */
export class AppSettings implements SettingsValues {
  /** Tells this window's messages apart from other windows'. */
  readonly #id = crypto.randomUUID();
  #storage: SettingsStorage | null;
  #sync: SettingsSync | null;
  #current = $state<SettingsValues>({ ...DEFAULT_SETTINGS });

  constructor({ storage = browserStorage(), sync = null }: Options = {}) {
    this.#storage = storage;
    this.#sync = sync;
    this.#current = loadValues(storage);

    this.#sync?.subscribe((incoming, senderId) => {
      if (senderId === this.#id) return;
      // Applied and saved, but not sent on: the other window already told everyone.
      this.#current = pickKnownValues(incoming);
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(this.#current));
    });
  }

  /*
   * One getter and setter per setting, so a change made anywhere (including `bind:` in a form) is saved
   * and sent at the moment it happens, without an effect.
   */
  get musicBrainzEnabled(): boolean {
    return this.#current.musicBrainzEnabled;
  }

  set musicBrainzEnabled(enabled: boolean) {
    this.#change({ musicBrainzEnabled: enabled });
  }

  get fadeEnabled(): boolean {
    return this.#current.fadeEnabled;
  }

  set fadeEnabled(enabled: boolean) {
    this.#change({ fadeEnabled: enabled });
  }

  /** A plain copy of every setting. */
  get values(): SettingsValues {
    return { ...this.#current };
  }

  #change(changes: Partial<SettingsValues>): void {
    const next = { ...this.#current, ...changes };
    if (JSON.stringify(next) === JSON.stringify(this.#current)) return;
    this.#current = next;
    this.#storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    this.#sync?.publish(next, this.#id);
  }
}

/** The app's settings, shared by every part of this window and kept in step with the others. */
export const settings = new AppSettings({ sync: tauriSettingsSync });
