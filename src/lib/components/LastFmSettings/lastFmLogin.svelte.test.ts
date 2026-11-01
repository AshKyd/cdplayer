import { describe, expect, it } from "vitest";
import { LastFmError, type LastFmProfile } from "$lib/lastfm/lastFmClient";
import { md5 } from "$lib/lastfm/md5";
import { LastFmLogin } from "./lastFmLogin.svelte";

const profile: LastFmProfile = {
  username: "Ash",
  imageUrl: "https://example.test/ash.png",
  scrobbleCount: 1234,
  profileUrl: "https://www.last.fm/user/Ash",
};

const setup = ({ login = async () => profile, getProfile = async () => profile } = {}, saved = { lastFmUsername: "", lastFmPasswordHash: "" }) => {
  const settings = { ...saved };
  const sentLogins: Array<{ username: string; passwordHash: string }> = [];
  const lastFmLogin = new LastFmLogin({
    client: {
      login: async (credentials) => {
        sentLogins.push(credentials);
        return login();
      },
      getProfile,
    },
    settings,
  });
  return { lastFmLogin, settings, sentLogins };
};

describe("LastFmLogin", () => {
  it("saves the account's own username and the password hash once Last.fm accepts the login", async () => {
    const { lastFmLogin, settings, sentLogins } = setup();

    await lastFmLogin.login(" ash ", "hunter2");

    expect(sentLogins).toEqual([{ username: "ash", passwordHash: md5("hunter2") }]);
    expect(settings).toEqual({ lastFmUsername: "Ash", lastFmPasswordHash: md5("hunter2") });
    expect(lastFmLogin.isLoggedIn).toBe(true);
    expect(lastFmLogin.profile).toEqual(profile);
    expect(lastFmLogin.isBusy).toBe(false);
  });

  it("saves nothing and explains when the password is wrong", async () => {
    const { lastFmLogin, settings } = setup({
      login: async () => {
        throw new LastFmError(4, "Invalid authentication token supplied");
      },
    });

    await lastFmLogin.login("ash", "nope");

    expect(settings).toEqual({ lastFmUsername: "", lastFmPasswordHash: "" });
    expect(lastFmLogin.isLoggedIn).toBe(false);
    expect(lastFmLogin.error).toBe("Wrong username or password.");
  });

  it("asks for both fields without contacting Last.fm", async () => {
    const { lastFmLogin, sentLogins } = setup();
    await lastFmLogin.login("ash", "");
    expect(sentLogins).toEqual([]);
    expect(lastFmLogin.error).toBe("Enter your username and password.");
  });

  it("logs out by forgetting the login and profile", async () => {
    const { lastFmLogin, settings } = setup();
    await lastFmLogin.login("ash", "hunter2");

    lastFmLogin.logout();

    expect(settings).toEqual({ lastFmUsername: "", lastFmPasswordHash: "" });
    expect(lastFmLogin.profile).toBeNull();
    expect(lastFmLogin.isLoggedIn).toBe(false);
  });

  it("loads the profile when opened already logged in", async () => {
    const { lastFmLogin } = setup(undefined, { lastFmUsername: "Ash", lastFmPasswordHash: "abc" });
    expect(lastFmLogin.isLoggedIn).toBe(true);

    await lastFmLogin.loadProfile();

    expect(lastFmLogin.profile).toEqual(profile);
  });

  it("stays logged in when the profile can't be loaded", async () => {
    const { lastFmLogin } = setup(
      {
        getProfile: async () => {
          throw new Error("offline");
        },
      },
      { lastFmUsername: "Ash", lastFmPasswordHash: "abc" },
    );

    await lastFmLogin.loadProfile();

    expect(lastFmLogin.isLoggedIn).toBe(true);
    expect(lastFmLogin.profile).toBeNull();
    expect(lastFmLogin.error).toBe("Couldn't load your profile: offline");
  });
});
