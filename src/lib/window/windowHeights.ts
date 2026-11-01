/**
 * The page's height with no track list: the header (4.5rem cover plus 1rem padding above and below), the
 * page's 0.75rem top and 1rem bottom padding, as measured in the running app. Hard coded so the first
 * collapse doesn't wait on, or undershoot from, a measurement. The page still measures its content and uses
 * the larger of the two, so a wrapped header at a narrow width isn't clipped.
 */
export const COLLAPSED_PAGE_HEIGHT = 132;

/** The expanded height used when the app opens collapsed and the user has never set one. Matches the old window default. */
export const DEFAULT_EXPANDED_WINDOW_HEIGHT = 600;

/**
 * How much taller than wanted the native window must be asked to be for the page to get the wanted height
 * (seen as 32 px on macOS). It is the starting value; the measured one replaces it once known.
 */
export const DEFAULT_WINDOW_HEIGHT_OFFSET = 32;
