import type { InteractionStatus } from '@prisma/client';
import type { PartyScore } from './scoring';

/** Interaction as rendered in the UI (one row per party member). */
export type UiInteraction = {
  id: string;
  userId: string;
  user: { id: string; name: string };
  status: InteractionStatus;
  rating: number | null;
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
  rentPrice: number;
  condoFee: number;
  taxFee: number;
  totalPrice: number;
  bedrooms: number;
  bathrooms: number;
  parkingSpots: number;
  sqm: number;
  images: string[];
  amenities: string[];
  petFriendly: boolean | null;
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
