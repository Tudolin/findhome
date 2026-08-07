import type { InteractionStatus } from '@prisma/client';
import type { MirroredPhoto } from './media';
import type { PartyScore } from './scoring';
import type { PricePoint } from './signals';

/** Interaction as rendered in the UI (one row per party member). */
export type UiInteraction = {
  id: string;
  userId: string;
  user: { id: string; name: string };
  status: InteractionStatus;
  rating: number | null;
  /** Pinned to the top of this workspace's feed. */
  pinned: boolean;
  pros: string[];
  cons: string[];
  notes: string | null;
};

/** Everything a property card needs. Matches the shape returned by queries.ts. */
export type UiProperty = {
  id: string;
  title: string;
  address: string;
  neighborhood: string;
  city: string;
  source: string;
  sourceUrl: string;
  /**
   * Decides what every price on the card *means*.
   *
   * RENT: `rentPrice` is monthly rent and `totalPrice` is rent + condo + IPTU.
   * SALE: `rentPrice` and `totalPrice` are both the asking price, and condo/tax
   * are what you go on paying monthly after buying. See normalize() in
   * scraper/src/persist.ts.
   */
  listingType: 'RENT' | 'SALE';
  rentPrice: number;
  condoFee: number;
  taxFee: number;
  totalPrice: number;
  bedrooms: number;
  bathrooms: number;
  parkingSpots: number;
  sqm: number;
  /** The portal's own URLs, in its order. Canonical — see lib/media. */
  images: string[];
  /**
   * Locally mirrored copies, when the scraper has fetched any. Pass the whole
   * property to `displayImages()` rather than reading `images` directly, or the
   * gallery silently goes back to hotlinking URLs that expire.
   */
  photos?: MirroredPhoto[] | null;
  amenities: string[];
  petFriendly: boolean | null;
  /** False once the listing stopped appearing, or its ad page returned 404/410. */
  active: boolean;
  /** When the ad itself was found to be down, as opposed to merely absent. */
  goneAt?: Date | string | null;
  /** Oldest first. Empty until the price moves at least once. */
  priceEvents?: PricePoint[];
  /** Minutes to the workspace's commute address, when one is configured. */
  commuteMin?: number | null;
  /** Ads for the same physical flat share this. Null means "not clustered". */
  clusterKey?: string | null;
  createdAt: Date | string;
  interactions: UiInteraction[];
  partyScore: PartyScore;
  mine: UiInteraction | null;
  commentCount: number;
};

export type UiWorkspace = {
  kind: 'SOLO' | 'PARTY';
  id: string;
  name: string;
  members: Array<{ userId: string; name: string; email: string; role: string }>;
  userId: string;
};
