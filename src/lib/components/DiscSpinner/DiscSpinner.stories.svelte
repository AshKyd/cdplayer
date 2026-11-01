<script module lang="ts">
  import { defineMeta } from "@storybook/addon-svelte-csf";
  import { UIRoot } from "svelte-akui";
  import DiscSpinner from "./DiscSpinner.svelte";

  const { Story } = defineMeta({
    title: "DiscSpinner",
    component: DiscSpinner,
  });
</script>

<Story name="Default" asChild>
  <UIRoot><DiscSpinner /></UIRoot>
</Story>
