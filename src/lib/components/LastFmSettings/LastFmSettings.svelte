<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { fade, fly, slide } from "svelte/transition";
  import {
    Avatar,
    Button,
    ControlGroup,
    ControlItemExpanded,
    InfoBox,
    PasswordInput,
    TextInput,
  } from "svelte-akui";
  import { createDefaultLastFmClient } from "$lib/lastfm/defaultLastFmClient";
  import { settings } from "$lib/settings/settings.svelte";
  import { LastFmLogin } from "./lastFmLogin.svelte";

  const client = createDefaultLastFmClient();
  const lastFmLogin = new LastFmLogin({ client, settings });

  /** What was typed, until login succeeds. The password is never saved; only its hash is, after Last.fm accepts it. */
  let usernameDraft = $state("");
  let passwordDraft = $state("");

  /** The one message shown under the form. A missing key explains everything else, so it takes priority. */
  const message = $derived(
    client.isConfigured
      ? lastFmLogin.error
      : "This build has no Last.fm API key. See devdocs/last-fm.md.",
  );

  onMount(() => {
    if (client.isConfigured) void lastFmLogin.loadProfile();
  });

  const submit = async () => {
    await lastFmLogin.login(usernameDraft, passwordDraft);
    if (lastFmLogin.isLoggedIn) passwordDraft = "";
  };

  const logout = () => {
    lastFmLogin.logout();
    usernameDraft = "";
  };

  const countFormat = new Intl.NumberFormat();

  /** The line under the username. Empty if the profile couldn't be loaded (the error is shown below). */
  const profileSummary = $derived(
    lastFmLogin.profile
      ? `${countFormat.format(lastFmLogin.profile.scrobbleCount)} scrobbles`
      : lastFmLogin.isBusy
        ? "Loading…"
        : "",
  );

  const lastFmProfileUrl = (username: string) =>
    `https://www.last.fm/user/${encodeURIComponent(username)}`;
</script>

<div class="section">
  <!-- Both modes sit in one grid cell, so the old one fades out as the new one slides in, without the page jumping. -->
  <div class="modes">
    {#if lastFmLogin.isLoggedIn}
      <div
        class="mode"
        in:fly={{ y: 8, duration: 200 }}
        out:fade={{ duration: 120 }}
      >
        <ControlGroup role="group">
          <!-- The profile card. A webview doesn't open links itself, so clicking it hands the profile page to the system browser. -->
          <ControlItemExpanded
            class="profile-card"
            label={lastFmLogin.username}
            description={profileSummary}
            wrapperRole="listitem"
            onclick={() =>
              void openUrl(
                lastFmLogin.profile?.profileUrl ??
                  lastFmProfileUrl(lastFmLogin.username),
              )}
          >
            {#snippet icon()}
              <Avatar
                src={lastFmLogin.profile?.imageUrl ?? undefined}
                initials={lastFmLogin.username.slice(0, 2).toUpperCase()}
                alt=""
                shape="round"
                size="3rem"
              />
            {/snippet}
          </ControlItemExpanded>
          <ControlItemExpanded
            label="Scrobbling"
            description="Each track is shown as now playing, then scrobbled after half of it has played."
            layout="horizontal"
            wrapperRole="listitem"
          >
            <Button class="lastfm-button" label="Log out" onclick={logout} />
          </ControlItemExpanded>
        </ControlGroup>
      </div>
    {:else}
      <!-- A form, so Enter submits. -->
      <form
        class="mode"
        in:fly={{ y: 8, duration: 200 }}
        out:fade={{ duration: 120 }}
        onsubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ControlGroup role="group">
          <ControlItemExpanded
            label="Username"
            layout="horizontal"
            wrapperRole="listitem"
          >
            <div class="field">
              <TextInput
                bind:value={usernameDraft}
                autocomplete="username"
                spellcheck="false"
              />
            </div>
          </ControlItemExpanded>
          <ControlItemExpanded
            label="Password"
            layout="horizontal"
            wrapperRole="listitem"
          >
            <div class="field">
              <PasswordInput
                bind:value={passwordDraft}
                autocomplete="current-password"
              />
            </div>
          </ControlItemExpanded>
        </ControlGroup>
        <div class="actions">
          <Button
            class="lastfm-button"
            type="submit"
            variant="accent"
            label="Log in"
            loading={lastFmLogin.isBusy}
            disabled={!client.isConfigured || lastFmLogin.isBusy}
          />
        </div>
      </form>
    {/if}
  </div>

  {#if message}
    <div transition:slide={{ duration: 150 }}>
      <InfoBox variant="error" title="Last.fm">{message}</InfoBox>
    </div>
  {/if}
</div>

<style>
  /* Space between the form (or profile) and the message under it. */
  .section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .modes {
    display: grid;
  }

  .mode {
    grid-area: 1 / 1;
    min-width: 0;
  }

  /*
   * Both fields sit in a box of the same width and fill it. The text input and the password input (which has a
   * show/hide button) put their `class` on different elements, so sizing the box is the only way to match them.
   */
  .field {
    width: 14rem;
    min-width: 12rem;
  }

  .field > :global(*) {
    width: 100%;
    box-sizing: border-box;
  }

  /* A fixed minimum so the buttons don't change size while "Log in" shows its spinner. */
  .section :global(.lastfm-button) {
    min-width: 6rem;
  }

  .section :global(.profile-card .akui-control-item-expanded-label) {
    font-weight: 700;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
</style>
