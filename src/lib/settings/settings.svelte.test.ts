import { describe, expect, it } from "vitest";
import { AppSettings, DEFAULT_SETTINGS, type SettingsStorage, type SettingsSync, type SettingsValues } from "./settings.svelte";
import { DEFAULT_VISUALISER_ID } from "$lib/visualisers/visualiserCatalogue";

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

    const expected = { ...DEFAULT_SETTINGS, musicBrainzEnabled: false };
    expect(JSON.parse(storage.items[KEY])).toEqual(expected);
    expect(published).toHaveLength(1);
    expect(published[0].values).toEqual(expected);
  });

  it("starts with the visualiser on, and saves turning it off", () => {
    const storage = makeStorage();
    const settings = new AppSettings({ storage });
    expect(settings.visualiserEnabled).toBe(true);

    settings.visualiserEnabled = false;

    expect(JSON.parse(storage.items[KEY]).visualiserEnabled).toBe(false);
  });

  it("starts on the default, saves a choice, and ignores one that is not offered", () => {
    const storage = makeStorage();
    const settings = new AppSettings({ storage });
    expect(settings.visualiserId).toBe(DEFAULT_VISUALISER_ID);

    settings.visualiserId = "ORB - Waaa";
    expect(JSON.parse(storage.items[KEY]).visualiserId).toBe("ORB - Waaa");

    // A number, and a preset that is no longer offered, both fall back.
    [42, "martin - disco mix 4"].forEach((visualiserId) => {
      const stale = makeStorage({ [KEY]: JSON.stringify({ visualiserId }) });
      expect(new AppSettings({ storage: stale }).visualiserId).toBe(DEFAULT_VISUALISER_ID);
    });
  });

  it("starts with no Last.fm login, and saves the username and password hash", () => {
    const storage = makeStorage();
    const settings = new AppSettings({ storage });
    expect([settings.lastFmUsername, settings.lastFmPasswordHash]).toEqual(["", ""]);

    settings.lastFmUsername = "ash";
    settings.lastFmPasswordHash = "2ab96390c7dbe3439de74d0c9b0b1767";

    expect(JSON.parse(storage.items[KEY])).toMatchObject({
      lastFmUsername: "ash",
      lastFmPasswordHash: "2ab96390c7dbe3439de74d0c9b0b1767",
    });
  });

  it("starts with no cover colours, saves them, and ignores malformed ones", () => {
    const storage = makeStorage();
    const settings = new AppSettings({ storage });
    expect(settings.coverColours).toBeNull();

    const colours = { primary: { hue: 29, chroma: 0.2 }, secondary: null };
    settings.coverColours = colours;
    expect(JSON.parse(storage.items[KEY]).coverColours).toEqual(colours);

    const bad = makeStorage({ [KEY]: JSON.stringify({ coverColours: { primary: { hue: "red" } } }) });
    expect(new AppSettings({ storage: bad }).coverColours).toBeNull();
  });

  it("applies and saves a change from another window without sending it back", () => {
    const storage = makeStorage();
    const { sync, published, receive } = makeSync();
    const settings = new AppSettings({ storage, sync });

    receive({ musicBrainzEnabled: false });

    expect(settings.musicBrainzEnabled).toBe(false);
    expect(JSON.parse(storage.items[KEY])).toEqual({ ...DEFAULT_SETTINGS, musicBrainzEnabled: false });
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
