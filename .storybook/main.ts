import type { StorybookConfig } from "@storybook/sveltekit";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|svelte)"],
  addons: ["@storybook/addon-svelte-csf"],
  framework: "@storybook/sveltekit",
  // Audio for the Visualiser stories. Kept out of `static/`, which ships in the app.
  staticDirs: ["./assets"],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  features: { sidebarOnboardingChecklist: false },
};

export default config;
