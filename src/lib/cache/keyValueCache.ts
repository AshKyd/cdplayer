import Dexie, { type EntityTable } from "dexie";

/** A key/value cache. Values must be structured-cloneable (`Blob`s are fine). */
export interface KeyValueCache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CacheRow {
  key: string;
  value: unknown;
  /** When the row was written (ms since epoch), so old rows can be pruned later. */
  storedAt: number;
}

class CacheDatabase extends Dexie {
  entries!: EntityTable<CacheRow, "key">;

  constructor() {
    super("cdplayer-cache");
    this.version(1).stores({ entries: "key, storedAt" });
  }
}

/** Dexie-backed cache. Album metadata and cover art live here so a disc is only looked up once. */
export class DexieKeyValueCache implements KeyValueCache {
  #database = new CacheDatabase();

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.#database.entries.get(key))?.value as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.#database.entries.put({ key, value, storedAt: Date.now() });
  }

  async delete(key: string): Promise<void> {
    await this.#database.entries.delete(key);
  }
}

/** The app-wide cache, or `null` where IndexedDB is missing or blocked (callers then just skip caching). */
export const defaultKeyValueCache = (): KeyValueCache | null => {
  if (typeof indexedDB === "undefined") return null;
  return new DexieKeyValueCache();
};
