import { LastFmError, type LastFmClient, type LastFmProfile } from "$lib/lastfm/lastFmClient";
import { md5 } from "$lib/lastfm/md5";

/** The two settings that make up the login. */
interface LoginSettings {
  lastFmUsername: string;
  lastFmPasswordHash: string;
}

interface Options {
  client: Pick<LastFmClient, "login" | "getProfile">;
  settings: LoginSettings;
}

/** Last.fm's error code for a wrong username or password. */
const WRONG_LOGIN_ERROR = 4;

const readableError = (reason: unknown): string => {
  if (reason instanceof LastFmError && reason.code === WRONG_LOGIN_ERROR) return "Wrong username or password.";
  return reason instanceof Error ? reason.message : String(reason);
};

/**
 * The Last.fm login on the settings page. The username and password hash are only saved once Last.fm has
 * accepted them, so a typo is never kept and never used for scrobbling. Being logged in is simply having
 * both saved; the profile (picture, scrobble count) is fetched for display and can be missing without
 * affecting that.
 */
export class LastFmLogin {
  #client: Options["client"];
  #settings: LoginSettings;

  /** The account's details, once fetched. */
  profile = $state<LastFmProfile | null>(null);
  /** True while talking to Last.fm. */
  isBusy = $state(false);
  /** Why the last login or profile load failed. Empty otherwise. */
  error = $state("");

  constructor({ client, settings }: Options) {
    this.#client = client;
    this.#settings = settings;
  }

  get isLoggedIn(): boolean {
    return Boolean(this.#settings.lastFmUsername && this.#settings.lastFmPasswordHash);
  }

  /** The saved username, for showing before (or without) the profile. */
  get username(): string {
    return this.#settings.lastFmUsername;
  }

  /** Checks the credentials with Last.fm. Saves them and shows the profile if they're right. */
  async login(username: string, password: string): Promise<void> {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      this.error = "Enter your username and password.";
      return;
    }

    this.isBusy = true;
    this.error = "";
    const passwordHash = md5(password);
    await this.#client.login({ username: trimmedUsername, passwordHash }).then(
      (profile) => {
        this.#settings.lastFmUsername = profile.username;
        this.#settings.lastFmPasswordHash = passwordHash;
        this.profile = profile;
      },
      (reason) => {
        this.error = readableError(reason);
      },
    );
    this.isBusy = false;
  }

  /** Forgets the saved login. */
  logout(): void {
    this.#settings.lastFmUsername = "";
    this.#settings.lastFmPasswordHash = "";
    this.profile = null;
    this.error = "";
  }

  /** Fetches the profile of the saved login, for when the window opens already logged in. */
  async loadProfile(): Promise<void> {
    if (!this.isLoggedIn || this.profile) return;

    this.isBusy = true;
    this.error = "";
    await this.#client.getProfile(this.#settings.lastFmUsername).then(
      (profile) => {
        this.profile = profile;
      },
      (reason) => {
        this.error = `Couldn't load your profile: ${readableError(reason)}`;
      },
    );
    this.isBusy = false;
  }
}
