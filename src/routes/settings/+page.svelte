<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ControlGroup, ControlItemExpanded, Settings, type SettingsSection } from "svelte-akui";
  import { settings } from "$lib/settings/settings.svelte";

  const MUSICBRAINZ_URL = "https://musicbrainz.org";

  const sections: SettingsSection[] = [
    { id: "general", label: "General", icon: "gear", children: general },
  ];
</script>

{#snippet musicBrainzDescription()}
  Finds track names and cover art by sending the disc's ID to
  <!-- A webview doesn't open links itself; hand it to the system browser. -->
  <a
    href={MUSICBRAINZ_URL}
    onclick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      void openUrl(MUSICBRAINZ_URL);
    }}>MusicBrainz</a
  >. Applies the next time a disc is read.
{/snippet}

{#snippet general()}
  <ControlGroup role="group">
    <ControlItemExpanded
      label="Look up discs on MusicBrainz"
      descriptionSnippet={musicBrainzDescription}
      layout="horizontal"
      controlType="checkbox"
      wrapperRole="listitem"
      bind:checked={settings.musicBrainzEnabled}
    />
    <ControlItemExpanded
      label="Fade when playing and pausing"
      description="Fades the sound in and out over 100 ms, which avoids clicks."
      layout="horizontal"
      controlType="checkbox"
      wrapperRole="listitem"
      bind:checked={settings.fadeEnabled}
    />
  </ControlGroup>
{/snippet}

<!-- The window opens at 560 px: wide enough for the tab column, so only the narrowest sizes use the drill-down layout. -->
<Settings {sections} title="Settings" size="large" padding="m" mobileBreakpoint={480} />
