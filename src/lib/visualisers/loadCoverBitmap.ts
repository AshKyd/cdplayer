/** Fetches and decodes a cover so it can be handed to the visualiser worker. `null` if there is no URL or it fails. */
export async function loadCoverBitmap(coverUrl: string | null | undefined): Promise<ImageBitmap | null> {
  if (!coverUrl) return null;
  return fetch(coverUrl)
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then((blob) => createImageBitmap(blob))
    .catch((reason) => {
      console.warn(JSON.stringify({ message: "Could not load cover for visualiser", coverUrl, error: String(reason) }));
      return null;
    });
}
