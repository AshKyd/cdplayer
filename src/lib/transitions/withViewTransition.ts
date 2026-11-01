import { tick } from "svelte";

/**
 * Runs `update` inside a view transition, so elements sharing a `view-transition-name` morph from their old
 * place to the new one. Webviews without view transitions just run `update`.
 */
export function withViewTransition(update: () => void): void {
  if (!document.startViewTransition) return update();
  // The browser takes the "after" snapshot when this resolves, so wait for Svelte to apply the change to the DOM.
  document.startViewTransition(async () => {
    update();
    await tick();
  });
}
