import type { PreferenceProfile, Property } from '@prisma/client';
import { config, env } from '../config.js';
import { prisma } from '../db.js';
import { locationSlug } from '../locations.js';
import { logger } from '../logger.js';
import { configuredProvider, normalizePhone, sendWhatsApp } from './whatsapp.js';

const log = logger('alerts');

/**
 * "Tell me on WhatsApp when something new matches what I asked for."
 *
 * Runs at the end of a scrape, once per PreferenceProfile that opted in. The
 * matching rules deliberately mirror the app's own feed filter
 * (web/src/lib/matching.ts) so an alert can never advertise a listing the user
 * would not see when they open the app.
 *
 * Three properties this is built around:
 *
 *  1. **Never twice.** AlertDelivery holds one row per (workspace, property).
 *     The candidate query is "matching AND not in that table", so duplicates are
 *     impossible by construction rather than by remembering a timestamp.
 *  2. **Never a flood.** A fresh install can match thousands of listings at
 *     once. The first run for a workspace is capped and, more importantly,
 *     everything older than ALERT_MAX_AGE_HOURS is marked as already-delivered
 *     without being sent — otherwise turning alerts on would replay history.
 *  3. **Never fatal.** A dead channel logs and leaves the rows unwritten, so the
 *     listings are retried next run and the scrape itself still succeeds.
 */

/** How recent a listing must be to be worth a message. */
const MAX_AGE_HOURS = Number(env('ALERT_MAX_AGE_HOURS', '48'));

type Candidate = Pick<
  Property,
  'id' | 'title' | 'neighborhood' | 'city' | 'totalPrice' | 'rentPrice' | 'bedrooms' | 'sqm' | 'sourceUrl' | 'source'
>;

/** "solo:<userId>" or the party id. Matches PropertyInteraction.scopeKey's intent. */
function scopeKeyFor(profile: PreferenceProfile): string | null {
  if (profile.partyId) return profile.partyId;
  if (profile.userId) return `solo:${profile.userId}`;
  return null;
}

/**
 * The same filter the app's feed applies, expressed for Prisma.
 *
 * Kept as a separate implementation from the web app's `preferenceWhere` on
 * purpose — the two services share no code — but it must stay in step with it.
 * If you change one, change the other.
 */
function matchWhere(profile: PreferenceProfile, since: Date) {
  const citySlug = profile.citySlug || locationSlug(profile.city);
  const neighborhoodSlugs = (
    profile.neighborhoodSlugs.length ? profile.neighborhoodSlugs : profile.neighborhoods.map(locationSlug)
  ).filter(Boolean);

  const priceField = profile.includeCondoInMaxPrice ? 'totalPrice' : 'rentPrice';
  const price: Record<string, number> = {};
  if (profile.minPrice != null) price.gte = profile.minPrice;
  if (profile.maxPrice != null) price.lte = profile.maxPrice;

  return {
    active: true,
    listingType: profile.listingType,
    createdAt: { gte: since },
    ...(citySlug ? { citySlug } : {}),
    ...(neighborhoodSlugs.length ? { neighborhoodSlug: { in: neighborhoodSlugs } } : {}),
    ...(profile.state ? { OR: [{ state: profile.state }, { state: null }] } : {}),
    bedrooms: { gte: profile.minBedrooms },
    bathrooms: { gte: profile.minBathrooms },
    parkingSpots: { gte: profile.minParkingSpots },
    sqm: { gte: profile.minSqm },
    ...(Object.keys(price).length ? { [priceField]: price } : {}),
    ...(profile.petFriendly ? { petFriendly: { not: false } } : {}),
    ...(profile.amenities.length ? { amenities: { hasEvery: profile.amenities } } : {}),
    // The point of the whole feature: only what has not been announced yet.
    alerts: { none: { scopeKey: scopeKeyFor(profile) ?? '' } },
  };
}

const money = (value: number) => `R$ ${value.toLocaleString('pt-BR')}`;

/** One WhatsApp message for a batch of listings. Plain text: every provider takes it. */
export function composeMessage(listings: Candidate[], profile: PreferenceProfile, remaining: number): string {
  const place = [profile.city, profile.state].filter(Boolean).join('/');
  const header =
    listings.length === 1
      ? `🏠 1 novo imóvel em ${place}`
      : `🏠 ${listings.length} novos imóveis em ${place}`;

  const items = listings.map((listing) => {
    const specs = [listing.bedrooms ? `${listing.bedrooms}q` : null, listing.sqm ? `${listing.sqm}m²` : null]
      .filter(Boolean)
      .join(' · ');
    return [
      `*${money(listing.totalPrice)}*${specs ? ` — ${specs}` : ''}`,
      `${listing.neighborhood}, ${listing.city}`,
      listing.title.slice(0, 90),
      listing.sourceUrl,
    ].join('\n');
  });

  const footer = remaining > 0 ? `\n\n+${remaining} outros aguardando a próxima verificação.` : '';
  return `${header}\n\n${items.join('\n\n')}${footer}`;
}

async function alertProfile(profile: PreferenceProfile): Promise<number> {
  const scopeKey = scopeKeyFor(profile);
  const phone = normalizePhone(profile.alertWhatsapp);
  if (!scopeKey || !phone) return 0;

  const since = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000);
  const where = matchWhere(profile, since);

  const matches = await prisma.property.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    // One over the cap so the message can honestly say how many are waiting.
    take: profile.alertMaxPerRun + 1,
    select: {
      id: true,
      title: true,
      neighborhood: true,
      city: true,
      totalPrice: true,
      rentPrice: true,
      bedrooms: true,
      sqm: true,
      sourceUrl: true,
      source: true,
    },
  });

  if (matches.length === 0) return 0;

  const batch = matches.slice(0, profile.alertMaxPerRun);
  const remaining = matches.length - batch.length;
  const provider = configuredProvider();

  const result = await sendWhatsApp(phone, composeMessage(batch, profile, remaining));
  if (!result.ok) {
    log.warn(`${scopeKey}: ${batch.length} listing(s) not announced — ${result.detail}`);
    // No rows written, so these are retried next run.
    return 0;
  }

  await prisma.alertDelivery.createMany({
    data: batch.map((listing) => ({ scopeKey, propertyId: listing.id, channel: provider })),
    skipDuplicates: true,
  });

  log.info(`${scopeKey}: announced ${batch.length} listing(s)${remaining ? `, ${remaining} queued` : ''}`);
  return batch.length;
}

/**
 * Marks everything currently matching as already-delivered, without sending.
 *
 * Called the first time a workspace turns alerts on. Without it, enabling the
 * feature on a database with 5,000 listings would try to narrate the entire back
 * catalogue — the user asked to hear about NEW listings, and on day one nothing
 * is new.
 */
async function primeBaseline(profile: PreferenceProfile): Promise<number> {
  const scopeKey = scopeKeyFor(profile);
  if (!scopeKey) return 0;

  // No createdAt bound here: the baseline covers the whole existing catalogue.
  const { createdAt: _ignored, ...rest } = matchWhere(profile, new Date(0));
  const existing = await prisma.property.findMany({ where: rest, select: { id: true } });
  if (existing.length === 0) return 0;

  await prisma.alertDelivery.createMany({
    data: existing.map((p) => ({ scopeKey, propertyId: p.id, channel: 'baseline' })),
    skipDuplicates: true,
  });
  return existing.length;
}

/**
 * Sends alerts for every workspace that opted in. Safe to call after every run;
 * does nothing when no provider is configured.
 */
export async function runAlerts(): Promise<void> {
  const provider = configuredProvider();
  if (provider === 'none') return;

  const profiles = await prisma.preferenceProfile.findMany({
    where: { alertsEnabled: true, alertWhatsapp: { not: null } },
  });
  if (profiles.length === 0) return;

  log.info(`checking alerts for ${profiles.length} workspace(s) via ${provider}`);

  for (const profile of profiles) {
    const scopeKey = scopeKeyFor(profile);
    if (!scopeKey) continue;

    try {
      // A workspace with no delivery history has just switched alerts on.
      const seen = await prisma.alertDelivery.count({ where: { scopeKey } });
      if (seen === 0) {
        const primed = await primeBaseline(profile);
        log.info(
          `${scopeKey}: first run — ${primed} existing listing(s) marked as seen, ` +
            'you will be told about new ones from here on',
        );
        continue;
      }

      await alertProfile(profile);
    } catch (err) {
      // One broken workspace must not stop the others, and must not fail the run.
      log.error(`${scopeKey}: alert check failed`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));
  }
}
