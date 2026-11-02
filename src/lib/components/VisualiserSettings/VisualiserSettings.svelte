<script lang="ts">
  import { ControlGroup, ControlItemExpanded, Select } from "svelte-akui";
  import { settings } from "$lib/settings/settings.svelte";
  import { onMount } from "svelte";
  import { listPresetNames } from "$lib/visualisers/butterchurnPresets";
  import { isVisualiserId, RANDOM_PRESET_SECONDS, RANDOM_VISUALISER_ID } from "$lib/visualisers/visualiserCatalogue";

  let presetNames = $state<string[]>([]);
  onMount(() => {
    void listPresetNames().then((names) => (presetNames = names));
  });

  // The saved choice is listed even before the pack has loaded, so the select never shows blank.
  const visualiserOptions = $derived([
    { value: RANDOM_VISUALISER_ID, label: "Random" },
    ...(presetNames.length > 0 ? presetNames : [settings.visualiserId])
      .filter((name) => name !== RANDOM_VISUALISER_ID)
      .map((name) => ({ value: name, label: name })),
  ]);
</script>

<ControlGroup role="group">
  <ControlItemExpanded
    label="Show the visualiser"
    description="Draws the music behind the player."
    layout="horizontal"
    controlType="checkbox"
    wrapperRole="listitem"
    bind:checked={settings.visualiserEnabled}
  />
  <ControlItemExpanded
    label="Visualiser"
    description={settings.visualiserId === RANDOM_VISUALISER_ID
      ? `Changes to a new preset every ${RANDOM_PRESET_SECONDS} seconds.`
      : undefined}
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
