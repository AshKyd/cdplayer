import { describe, expect, it } from "vitest";
import { AppSettings, type SettingsStorage, type SettingsSync, type SettingsValues } from "./settings.svelte";

const makeStorage = (initial: Record<string, string> = {}): SettingsStorage & { items: Record<string, string> } => {
  const items = { ...initial };
  return {
    items,
    getItem: (key) => items[key] ?? null,
    setItem: (key, value) => {
      items[key] = value;
    },
  };
};

/** A fake bus: `published` is what this window sent, `receive()` plays a message from another window. */
const makeSync = () => {
  const published: Array<{ values: SettingsValues; senderId: string }> = [];
  let handler: Parameters<SettingsSync["subscribe"]>[0] = () => {};
  const sync: SettingsSync = {
    publish: (values, senderId) => published.push({ values, senderId }),
    subscribe: (next) => {
      handler = next;
      return () => {};
    },
  };
  return { sync, published, receive: (values: Partial<SettingsValues>, senderId = "other") => handler(values, senderId) };
};

const KEY = "cdplayer.settings";

describe("AppSettings", () => {
  it("starts with MusicBrainz on", () => {
    expect(new AppSettings({ storage: makeStorage() }).musicBrainzEnabled).toBe(true);
  });

  it("loads saved values", () => {
    const storage = makeStorage({ [KEY]: JSON.stringify({ musicBrainzEnabled: false }) });
    expect(new AppSettings({ storage }).musicBrainzEnabled).toBe(false);
  });

  it.each(["not json", "null", '{"musicBrainzEnabled":"no"}'])("falls back to defaults for %s", (saved) => {
    const storage = makeStorage({ [KEY]: saved });
    expect(new AppSettings({ storage }).musicBrainzEnabled).toBe(true);
  });

  it("saves and publishes a change", () => {
    const storage = makeStorage();
    const { sync, published } = makeSync();
    const settings = new AppSettings({ storage, sync });
    expect(published).toEqual([]);

    settings.musicBrainzEnabled = false;

    expect(JSON.parse(storage.items[KEY])).toEqual({ musicBrainzEnabled: false, fadeEnabled: true });
    expect(published).toHaveLength(1);
    expect(published[0].values).toEqual({ musicBrainzEnabled: false, fadeEnabled: true });
  });

  it("starts with fading on, and saves turning it off", () => {
    const storage = makeStorage();
    const settings = new AppSettings({ storage });
    expect(settings.fadeEnabled).toBe(true);

    settings.fadeEnabled = false;

    expect(JSON.parse(storage.items[KEY]).fadeEnabled).toBe(false);
  });

  it("applies and saves a change from another window without sending it back", () => {
    const storage = makeStorage();
    const { sync, published, receive } = makeSync();
    const settings = new AppSettings({ storage, sync });

    receive({ musicBrainzEnabled: false });

    expect(settings.musicBrainzEnabled).toBe(false);
    expect(JSON.parse(storage.items[KEY])).toEqual({ musicBrainzEnabled: false, fadeEnabled: true });
    expect(published).toEqual([]);
  });

  it("ignores its own messages", () => {
    const { sync, published, receive } = makeSync();
    const settings = new AppSettings({ storage: makeStorage(), sync });
    settings.musicBrainzEnabled = false;

    receive({ musicBrainzEnabled: true }, published[0].senderId);

    expect(settings.musicBrainzEnabled).toBe(false);
  });

  it("ignores values of the wrong type from another window", () => {
    const { sync, receive } = makeSync();
    const settings = new AppSettings({ storage: makeStorage(), sync });

    receive({ musicBrainzEnabled: "no" as unknown as boolean });

    expect(settings.musicBrainzEnabled).toBe(true);
  });
});
