<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ControlGroup, ControlItemExpanded, Select, Settings, type SettingsSection } from "svelte-akui";
  import LastFmSettings from "$lib/components/LastFmSettings/LastFmSettings.svelte";
  import { settings } from "$lib/settings/settings.svelte";
  import { isVisualiserId, VISUALISERS } from "$lib/visualisers/visualiserCatalogue";

  const visualiserOptions = VISUALISERS.map(({ id, label }) => ({ value: id, label }));

  const MUSICBRAINZ_URL = "https://musicbrainz.org";

  const sections: SettingsSection[] = [
    { id: "general", label: "General", icon: "gear", children: general },
    { id: "lastfm", label: "Last.fm", icon: "music-note-list", children: lastFm },
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
      label="Play when a disc is inserted"
      description="Starts the first track as soon as the disc has been read."
      layout="horizontal"
      controlType="checkbox"
      wrapperRole="listitem"
      bind:checked={settings.autoplayEnabled}
    />
    <ControlItemExpanded
      label="Fade when playing and pausing"
      description="Fades the sound in and out over 100 ms, which avoids clicks."
      layout="horizontal"
      controlType="checkbox"
      wrapperRole="listitem"
      bind:checked={settings.fadeEnabled}
    />
    <ControlItemExpanded
      label="Show the visualiser"
      description="Draws the waveform of the music behind the player."
      layout="horizontal"
      controlType="checkbox"
      wrapperRole="listitem"
      bind:checked={settings.visualiserEnabled}
    />
    <ControlItemExpanded
      label="Visualiser"
      description={VISUALISERS.find(({ id }) => id === settings.visualiserId)?.description}
      layout="horizontal"
      wrapperRole="listitem"
    >
      <Select
        value={settings.visualiserId}
        options={visualiserOptions}
        onchange={(event: Event) => {
          const { value } = event.target as HTMLSelectElement;
          if (isVisualiserId(value)) settings.visualiserId = value;
        }}
      />
    </ControlItemExpanded>
  </ControlGroup>
{/snippet}

{#snippet lastFm()}
  <LastFmSettings />
{/snippet}

<!-- The window opens at 560 px: wide enough for the tab column, so only the narrowest sizes use the drill-down layout. -->
<Settings {sections} title="Settings" size="large" padding="m" mobileBreakpoint={480} />
