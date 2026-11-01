<script lang="ts">
  import { ControlGroup, ControlItemExpanded, Select } from "svelte-akui";
  import { settings } from "$lib/settings/settings.svelte";
  import { isVisualiserId, VISUALISERS } from "$lib/visualisers/visualiserCatalogue";

  const visualiserOptions = VISUALISERS.map(({ id, label }) => ({ value: id, label }));
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
