export interface Attribution {
  /** Package names, as in package.json / Cargo.toml. */
  packages: string[];
  /** Copyright holders, from each package's LICENSE file (or Cargo.toml authors if it has no notice). */
  holders: string;
}

/**
 * Direct dependencies only (svelte-akui is ours and left out). Packages from one project share an entry.
 * Update this when a dependency is added or removed.
 */
export const ATTRIBUTIONS: Attribution[] = [
  {
    packages: [
      "@tauri-apps/api",
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-opener",
      "tauri",
      "tauri-plugin-fs",
      "tauri-plugin-opener",
    ],
    holders: "Tauri Apps Contributors",
  },
  // Listed in devDependencies, but the Svelte runtime and SvelteKit client are bundled into the app.
  { packages: ["svelte", "@sveltejs/kit"], holders: "Svelte Contributors" },
  { packages: ["bootstrap-icons"], holders: "The Bootstrap Authors" },
  { packages: ["butterchurn", "butterchurn-presets"], holders: "Jordan Berg" },
  { packages: ["dexie"], holders: "David Fahlander" },
  { packages: ["node-vibrant"], holders: "Jari Zwarts, AKFish" },
  { packages: ["cd-da-reader"], holders: "Seva Zaikov" },
  { packages: ["serde", "serde_json"], holders: "Erick Tryzelaar, David Tolnay" },
  { packages: ["symphonia"], holders: "Philip Deljanov" },
  { packages: ["symphonia-adapter-libopus"], holders: "Austin Schey" },
];

/** One paragraph, e.g. "bootstrap-icons (The Bootstrap Authors), butterchurn and butterchurn-presets (Jordan Berg)". */
export const attributionParagraph = (attributions: Attribution[] = ATTRIBUTIONS) =>
  attributions
    .map(({ packages, holders }) => {
      const names =
        packages.length > 1
          ? `${packages.slice(0, -1).join(", ")} and ${packages.at(-1)}`
          : packages[0];
      return `${names} (${holders})`;
    })
    .join(", ");
