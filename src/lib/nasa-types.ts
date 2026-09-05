// NASA API wire types - moved from src/app/api/astro/route.ts for reuse.

/** Raw NASA APOD response shape. */
export interface ApodResponse {
  date: string;
  explanation: string;
  hdurl?: string;
  url?: string;
  media_type: string;
  title: string;
  copyright?: string;
  code?: number;
  msg?: string;
}

/**
 * Normalised subset of APOD `media_type`. NASA only documents
 * "image" and "video"; we keep `string` so unknown values
 * (forward-compat) still typecheck, but expose the literals
 * for narrowing at the call site.
 */
export type ApodMediaType = "image" | "video";

/** Single item from NASA Image Library search. */
export interface NasaImageItem {
  data: Array<{
    title: string;
    description?: string;
    date_created: string;
    photographer?: string;
    nasa_id?: string;
  }>;
  links?: Array<{ href: string; rel?: string; render?: string }>;
}

/** NASA Image Library search response (partial). */
export interface NasaImagesSearchResponse {
  collection: {
    items: NasaImageItem[];
    metadata?: { total_hits: number };
  };
}
