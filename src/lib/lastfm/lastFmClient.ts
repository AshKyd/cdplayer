import { md5 } from "./md5";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

const REQUEST_TIMEOUT_MS = 10_000;

/** Last.fm's error code for a session key that no longer works. */
const INVALID_SESSION_ERROR = 9;

/** The Last.fm login. The password is only ever held as its MD5 hash. */
export interface LastFmCredentials {
  username: string;
  passwordHash: string;
}

/** A track as Last.fm wants it described. */
export interface LastFmTrack {
  artist: string;
  title: string;
  album: string;
  durationSeconds: number;
  trackNumber: number;
}

/** The public details of a Last.fm account. */
export interface LastFmProfile {
  /** The account's own spelling of the username. */
  username: string;
  /** The largest profile picture, or `null` if the account has none. */
  imageUrl: string | null;
  scrobbleCount: number;
  profileUrl: string;
}

interface Options {
  /** From a Last.fm API account. Without both, nothing is sent. */
  apiKey?: string;
  apiSecret?: string;
  /** Tests pass a fake. */
  fetcher?: typeof fetch;
}

type Params = Record<string, string>;

interface LastFmResponse {
  error?: number;
  message?: string;
  session?: { key: string; name?: string };
  user?: {
    name: string;
    url: string;
    /** Last.fm sends numbers as strings. */
    playcount: string;
    image?: Array<{ size: string; "#text": string }>;
  };
}

/** `md5` of every parameter's name and value, sorted by name and joined, then the secret. `format` is left out of the signature. */
export const signParams = (params: Params, apiSecret: string): string =>
  md5(
    Object.keys(params)
      .filter((name) => name !== "format")
      .sort()
      .map((name) => name + params[name])
      .join("") + apiSecret,
  );

/** The `authToken` for `auth.getMobileSession`: `md5(lowercase username + md5(password))`. */
export const authToken = ({ username, passwordHash }: LastFmCredentials): string => md5(username.toLowerCase() + passwordHash);

/** The Last.fm calls we use: log in, tell it what is playing now, and scrobble a finished listen. Plain JS, so it needs no Rust. */
export class LastFmClient {
  #apiKey: string;
  #apiSecret: string;
  #fetcher: typeof fetch;
  /** Session keys by login, so each call doesn't log in again. Last.fm session keys don't expire. */
  #sessions = new Map<string, string>();

  constructor({ apiKey = "", apiSecret = "", fetcher = (...args) => fetch(...args) }: Options = {}) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
    this.#fetcher = fetcher;
  }

  /** Whether an API key and secret are set. */
  get isConfigured(): boolean {
    return Boolean(this.#apiKey && this.#apiSecret);
  }

  /** Shows the track as "now playing" on the profile. Last.fm clears it itself after the track's length. */
  updateNowPlaying(credentials: LastFmCredentials, track: LastFmTrack): Promise<void> {
    return this.#callWithSession(credentials, "track.updateNowPlaying", trackParams(track));
  }

  /** Adds a listen to the profile. `startedAtSeconds` is when the track began playing, in Unix time. */
  scrobble(credentials: LastFmCredentials, track: LastFmTrack, startedAtSeconds: number): Promise<void> {
    return this.#callWithSession(credentials, "track.scrobble", {
      ...trackParams(track),
      timestamp: String(Math.floor(startedAtSeconds)),
    });
  }

  /** Calls a method that needs a session. If Last.fm says the cached session is dead, logs in again and tries once more. */
  async #callWithSession(credentials: LastFmCredentials, method: string, params: Params): Promise<void> {
    const attempt = async () => this.#call(method, { ...params, sk: await this.#sessionKey(credentials) });
    await attempt().catch(async (reason) => {
      if (!(reason instanceof LastFmError) || reason.code !== INVALID_SESSION_ERROR) throw reason;
      this.#sessions.delete(sessionCacheKey(credentials));
      await attempt();
    });
  }

  /**
   * Checks the credentials with Last.fm and returns the account's profile. Always asks Last.fm, so a wrong
   * password is caught even if a session was cached. Throws a `LastFmError` (code 4) for a wrong username or password.
   */
  async login(credentials: LastFmCredentials): Promise<LastFmProfile> {
    const { name } = await this.#startSession(credentials);
    return this.getProfile(name);
  }

  /** The public profile of `username`. No login is needed. */
  async getProfile(username: string): Promise<LastFmProfile> {
    const { user } = await this.#call("user.getInfo", { user: username });
    if (!user) throw new Error("Last.fm did not return a profile");

    // Sizes run small to extralarge; an account with no picture has empty URLs.
    const imageUrl = [...(user.image ?? [])].reverse().find(({ "#text": url }) => url)?.["#text"] ?? null;
    return {
      username: user.name,
      imageUrl,
      scrobbleCount: Number(user.playcount) || 0,
      profileUrl: user.url,
    };
  }

  async #sessionKey(credentials: LastFmCredentials): Promise<string> {
    const cached = this.#sessions.get(sessionCacheKey(credentials));
    return cached ?? (await this.#startSession(credentials)).key;
  }

  /** Logs in and caches the session key. `name` is the account's own spelling of the username. */
  async #startSession(credentials: LastFmCredentials): Promise<{ key: string; name: string }> {
    const { session } = await this.#call("auth.getMobileSession", {
      username: credentials.username,
      authToken: authToken(credentials),
    });
    if (!session?.key) throw new Error("Last.fm did not return a session");
    this.#sessions.set(sessionCacheKey(credentials), session.key);
    return { key: session.key, name: session.name ?? credentials.username };
  }

  async #call(method: string, params: Params): Promise<LastFmResponse> {
    if (!this.isConfigured) throw new Error("no Last.fm API key");

    const signed: Params = { ...params, method, api_key: this.#apiKey };
    const body = new URLSearchParams({ ...signed, api_sig: signParams(signed, this.#apiSecret), format: "json" });
    const response = await this.#fetcher(API_URL, { method: "POST", body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    // Last.fm reports most failures as a JSON `error` with a non-200 status, so read the body either way.
    const json = (await response.json().catch(() => ({}))) as LastFmResponse;
    if (json.error) throw new LastFmError(json.error, json.message ?? "");
    if (!response.ok) throw new Error(`Last.fm answered ${response.status}`);
    return json;
  }
}

/** A failure reported by Last.fm itself, with its numeric code. */
export class LastFmError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`Last.fm error ${code}: ${message}`);
  }
}

const sessionCacheKey = ({ username, passwordHash }: LastFmCredentials): string => `${username}:${passwordHash}`;

const trackParams = ({ artist, title, album, durationSeconds, trackNumber }: LastFmTrack): Params => ({
  artist,
  track: title,
  ...(album && { album }),
  ...(durationSeconds > 0 && { duration: String(Math.round(durationSeconds)) }),
  ...(trackNumber > 0 && { trackNumber: String(trackNumber) }),
});
