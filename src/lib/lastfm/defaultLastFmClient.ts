import { LastFmClient } from "./lastFmClient";

/** A client using the API key and secret from `.env` (see `devdocs/last-fm.md`). */
export const createDefaultLastFmClient = (): LastFmClient =>
  new LastFmClient({
    apiKey: import.meta.env.VITE_LASTFM_API_KEY,
    apiSecret: import.meta.env.VITE_LASTFM_API_SECRET,
  });
