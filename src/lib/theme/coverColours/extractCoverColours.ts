import { Vibrant } from "node-vibrant/browser";
import { pickCoverColours, type CoverColours } from "./pickCoverColours";

/**
 * Finds the cover's main colours, or `null` if there is no cover, it fails to load, or it is greyscale.
 *
 * The image is fetched and handed to Vibrant as a same-origin blob URL. Loading the remote URL straight
 * into Vibrant's canvas would be blocked as cross-origin whenever the cover host sends no CORS headers.
 */
export async function extractCoverColours(coverUrl: string | null | undefined): Promise<CoverColours | null> {
  if (!coverUrl) return null;
  const blob = await fetch(coverUrl)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .catch((reason) => {
      console.warn(JSON.stringify({ message: "Could not load cover for colours", coverUrl, error: String(reason) }));
      return null;
    });
  if (!blob) return null;

  const blobUrl = URL.createObjectURL(blob);
  // Albums are big images; a small sample is plenty for dominant colours and keeps the UI thread free.
  const vibrant = Vibrant.from(blobUrl).maxColorCount(64).quality(5).build();
  return vibrant
    .getPalette()
    // The raw clusters, not the palette: see `pickCoverColours` for why the named swatches aren't used.
    .then(() => pickCoverColours(vibrant.result?.colors ?? []))
    .catch((reason) => {
      console.warn(JSON.stringify({ message: "Could not read cover colours", coverUrl, error: String(reason) }));
      return null;
    })
    .finally(() => URL.revokeObjectURL(blobUrl));
}
