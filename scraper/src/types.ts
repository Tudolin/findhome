import type { APIRequestContext, Browser } from 'playwright-core';
import type { ListingType, PropertySource } from '@prisma/client';
import type { Logger } from './logger.js';

/** A search the engine should run, derived from the users' PreferenceProfiles. */
export type SearchTarget = {
  city: string;
  state?: string;
  neighborhoods: string[];
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
  browser: Browser;
  /** Shared HTTP client with a browser-like UA, for JSON endpoints. */
  api: APIRequestContext;
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
