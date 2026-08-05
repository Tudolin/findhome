import type { APIRequestContext, Page } from 'playwright-core';
import type { ListingType, PropertySource } from '@prisma/client';
import type { Logger } from './logger.js';
import type { Transport } from './http.js';

/**
 * A search the engine should run, derived from the users' PreferenceProfiles.
 *
 * `state` is a canonical two-letter UF and `neighborhoodSlugs` are
 * `locationSlug()` values — parsers compare against the slugs, never against
 * the display spellings, so "Vila Mariana" and "vila mariana" are one filter.
 */
export type SearchTarget = {
  city: string;
  citySlug: string;
  /** Canonical UF ("SP", "PR"), or null when the profile has no usable state. */
  state: string | null;
  /** Display spellings, for logs and the DEMO parser. */
  neighborhoods: string[];
  neighborhoodSlugs: string[];
  listingType: ListingType;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number;
  minSqm: number;
};

/** Parser output, before normalisation and persistence. */
export type RawListing = {
  externalId: string;
  sourceUrl: string;
  title: string;
  description?: string | null;
  address: string;
  neighborhood: string;
  city: string;
  state?: string | null;
  rentPrice: number;
  condoFee?: number | null;
  taxFee?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parkingSpots?: number | null;
  sqm?: number | null;
  images?: string[];
  amenities?: string[];
  petFriendly?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  listingType?: ListingType;
};

export type ScrapeContext = {
  /** Shared HTTP client with a browser-like UA, for JSON endpoints. */
  api: APIRequestContext;
  /** A blank Chromium page. Launches the browser on first use. */
  newPage: () => Promise<Page>;
  /** A Chromium page parked on `origin`, reused across calls. See browser.ts. */
  anchor: (origin: string) => Promise<Page>;
  /** Which transport last worked, keyed by channel. See http.ts. */
  transports: Map<string, Transport>;
  log: Logger;
  maxPages: number;
  pageSize: number;
  delay: () => Promise<void>;
};

export interface Parser {
  source: PropertySource;
  label: string;
  /** Returns raw listings; throwing aborts only this source's run. */
  search(target: SearchTarget, ctx: ScrapeContext): Promise<RawListing[]>;
}
