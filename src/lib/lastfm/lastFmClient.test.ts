import { describe, expect, it } from "vitest";
import { authToken, LastFmClient, signParams, type LastFmCredentials, type LastFmTrack } from "./lastFmClient";
import { md5 } from "./md5";

const credentials: LastFmCredentials = { username: "Ash", passwordHash: md5("hunter2") };
const track: LastFmTrack = { artist: "Band", title: "Song", album: "Album", durationSeconds: 200.4, trackNumber: 3 };

type Reply = { status?: number; json: unknown };

/** A fetch that answers from `replies` in order, and records what was sent. */
const fakeFetch = (replies: Reply[]) => {
  const sent: URLSearchParams[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    sent.push(new URLSearchParams(init.body as URLSearchParams));
    const { status = 200, json } = replies.shift() ?? { json: {} };
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
  return { fetcher, sent };
};

const session = { json: { session: { key: "sk1" } } };

describe("signParams", () => {
  it("signs names and values sorted by name, then the secret, leaving out format", () => {
    expect(signParams({ method: "m", api_key: "k", format: "json" }, "s")).toBe(md5("api_keykmethodms"));
  });
});

describe("authToken", () => {
  it("is md5 of the lower-case username and the password hash", () => {
    expect(authToken(credentials)).toBe(md5("ash" + md5("hunter2")));
  });
});

describe("LastFmClient", () => {
  const make = (replies: Reply[]) => {
    const { fetcher, sent } = fakeFetch(replies);
    return { client: new LastFmClient({ apiKey: "key", apiSecret: "secret", fetcher }), sent };
  };

  it("logs in, then sends now playing with a signed request", async () => {
    const { client, sent } = make([session, { json: {} }]);

    await client.updateNowPlaying(credentials, track);

    expect(sent[0].get("method")).toBe("auth.getMobileSession");
    expect(sent[0].get("authToken")).toBe(authToken(credentials));
    const nowPlaying = sent[1];
    expect(Object.fromEntries(nowPlaying)).toMatchObject({
      method: "track.updateNowPlaying",
      sk: "sk1",
      artist: "Band",
      track: "Song",
      album: "Album",
      duration: "200",
      trackNumber: "3",
      format: "json",
    });
    const { api_sig, format: _format, ...signed } = Object.fromEntries(nowPlaying);
    expect(api_sig).toBe(signParams(signed, "secret"));
  });

  it("sends the scrobble timestamp, and reuses the session", async () => {
    const { client, sent } = make([session, { json: {} }, { json: {} }]);

    await client.updateNowPlaying(credentials, track);
    await client.scrobble(credentials, track, 1234.7);

    expect(sent.map((body) => body.get("method"))).toEqual(["auth.getMobileSession", "track.updateNowPlaying", "track.scrobble"]);
    expect(sent[2].get("timestamp")).toBe("1234");
  });

  it("logs in again once if the session is rejected", async () => {
    const { client, sent } = make([
      session,
      { status: 403, json: { error: 9, message: "Invalid session key" } },
      { json: { session: { key: "sk2" } } },
      { json: {} },
    ]);

    await client.scrobble(credentials, track, 1);

    expect(sent.map((body) => body.get("sk"))).toEqual([null, "sk1", null, "sk2"]);
  });

  it("throws Last.fm's error, such as a wrong password", async () => {
    const { client } = make([{ status: 403, json: { error: 4, message: "Invalid authentication token supplied" } }]);
    await expect(client.scrobble(credentials, track, 1)).rejects.toThrow("Last.fm error 4: Invalid authentication token supplied");
  });

  it("logs in and returns the profile with the largest picture and a numeric scrobble count", async () => {
    const { client, sent } = make([
      { json: { session: { key: "sk1", name: "Ash" } } },
      {
        json: {
          user: {
            name: "Ash",
            url: "https://www.last.fm/user/Ash",
            playcount: "4321",
            image: [
              { size: "small", "#text": "https://x/s.png" },
              { size: "extralarge", "#text": "https://x/xl.png" },
            ],
          },
        },
      },
    ]);

    const profile = await client.login(credentials);

    expect(profile).toEqual({
      username: "Ash",
      imageUrl: "https://x/xl.png",
      scrobbleCount: 4321,
      profileUrl: "https://www.last.fm/user/Ash",
    });
    expect(sent[1].get("method")).toBe("user.getInfo");
    expect(sent[1].get("user")).toBe("Ash");
  });

  it("has no picture when the account's image URLs are empty", async () => {
    const { client } = make([
      { json: { user: { name: "Ash", url: "u", playcount: "0", image: [{ size: "small", "#text": "" }] } } },
    ]);
    expect((await client.getProfile("Ash")).imageUrl).toBeNull();
  });

  it("sends nothing without an API key", async () => {
    const { fetcher, sent } = fakeFetch([]);
    const client = new LastFmClient({ fetcher });
    expect(client.isConfigured).toBe(false);
    await expect(client.scrobble(credentials, track, 1)).rejects.toThrow("no Last.fm API key");
    expect(sent).toEqual([]);
  });
});
