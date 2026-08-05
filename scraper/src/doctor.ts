import type { PropertySource } from '@prisma/client';
import { BrowserPool, createApiContext, sleep } from './browser.js';
import { ALL_SOURCES, config, parseSources } from './config.js';
import { prisma } from './db.js';
import { requestJson, type JsonResult, type Transport } from './http.js';
import { logger } from './logger.js';
import { buildSearchTargets, describeTarget } from './targets.js';
import { applyTargetFilters } from './parsers/util.js';
import { extractListings, GRUPOZAP_PROBE, mapListing } from './parsers/grupozap.js';
import { extractHits, mapHit, QUINTOANDAR_PROBE } from './parsers/quintoandar.js';
import { OLX_CONFIG } from './parsers/olx.js';
import { CHAVES_NA_MAO_CONFIG } from './parsers/chavesnamao.js';
import { IMOVELWEB_CONFIG } from './parsers/imovelweb.js';
import type { PageParserConfig } from './parsers/page.js';
import { getParser } from './parsers/index.js';
import type { RawListing, ScrapeContext, SearchTarget } from './types.js';

/**
 * Connectivity check for every configured source.
 *
 *   docker compose exec scraper node dist/doctor.js
 *   docker compose exec scraper node dist/doctor.js ZAP,QUINTO_ANDAR
 *   make doctor
 *
 * This exists because "Zap Imoveis responded 403 Forbidden" in a log line does
 * not tell you whether the endpoint moved, the query contract changed, the
 * markup was redesigned, or the bot wall turned your IP away - and those four
 * have four different fixes. The doctor probes each candidate URL and query
 * variant, over both transports, and reports the status, which transport got
 * through, how many listings came back, how many survive the city filter, and a
 * diagnosis naming the likely cause. It writes nothing to the database.
 *
 * Exit code is 1 if any probed source failed, so it works in a health check.
 */

const log = logger('doctor');

type Probe = {
  source: PropertySource;
  label: string;
  /** What was tried, in order, with the outcome of each. */
  attempts: string[];
  ok: boolean;
  transport: Transport | null;
  /** Listings the source returned. */
  rawCount: number;
  /** Of those, how many a real run would keep. */
  mappedCount: number;
  sample: RawListing | null;
  diagnosis: string;
};

const line = '-'.repeat(72);

function summarise(result: JsonResult): string {
  const status = result.status === 0 ? 'no response' : String(result.status);
  const type = result.contentType.split(';')[0] || 'unknown';
  return `${status} ${type} via ${result.transport}`;
}

function bodyHint(result: JsonResult): string {
  const snippet = result.bodyText.replace(/\s+/g, ' ').trim().slice(0, 160);
  return snippet ? `\n        body: ${snippet}` : '';
}

/** True when a response body is an edge-network challenge page, not the API. */
function isBotWall(result: JsonResult): boolean {
  return /cloudflare|attention required|just a moment|access denied|incapsula|perimeterx/i.test(result.bodyText);
}

/**
 * Is the portal's own front page reachable?
 *
 * This single question separates the two causes that look identical from the
 * API's side: a query contract that moved (front page fine, API complains) and
 * an IP that the edge network refuses outright (front page 403 too). The second
 * is not a bug in this project and no amount of parser fixing will help - it
 * needs a different egress IP.
 */
async function originReachable(ctx: ScrapeContext, origin: string): Promise<{ ok: boolean; detail: string }> {
  const result = await requestJson(ctx, { url: origin, origin, channel: `doctor:origin:${origin}` });
  // The front page is HTML, so json === null is expected and fine here.
  if (result.status >= 200 && result.status < 400) return { ok: true, detail: `HTTP ${result.status}` };
  const wall = isBotWall(result) ? ' (challenge page)' : '';
  return { ok: false, detail: `HTTP ${result.status || 'no response'}${wall}` };
}

async function probeGrupoZap(
  source: 'ZAP' | 'VIVA_REAL',
  target: SearchTarget,
  ctx: ScrapeContext,
): Promise<Probe> {
  const portal = GRUPOZAP_PROBE.portals[source];
  const probe: Probe = {
    source,
    label: portal.label,
    attempts: [],
    ok: false,
    transport: null,
    rawCount: 0,
    mappedCount: 0,
    sample: null,
    diagnosis: '',
  };

  const front = await originReachable(ctx, portal.origin);
  probe.attempts.push(`${portal.origin}: ${front.detail}`);

  for (const variant of GRUPOZAP_PROBE.variants) {
    const query = new URLSearchParams(variant.build(target, 0, 5)).toString();
    const result = await requestJson(ctx, {
      url: `${GRUPOZAP_PROBE.endpoint}?${query}`,
      headers: { 'x-domain': portal.domain, ...GRUPOZAP_PROBE.headers() },
      origin: portal.origin,
      // A fresh channel per variant so one variant's success does not pin the
      // transport for the others - the doctor wants the full picture.
      channel: `doctor:${source}:${variant.name}`,
    });

    if (result.ok && result.json !== null) {
      const listings = extractListings(result.json);
      const mapped = listings.map((raw) => mapListing(raw, portal.origin)).filter((l): l is RawListing => l !== null);
      const kept = applyTargetFilters(mapped, target);
      probe.attempts.push(
        `variant "${variant.name}": ${summarise(result)} - ${listings.length} listing(s), ` +
          `${mapped.length} mapped, ${kept.length} in ${target.city}`,
      );

      if (listings.length > 0) {
        probe.transport = result.transport;
        probe.rawCount = listings.length;
        probe.mappedCount = kept.length;
        probe.sample = kept[0] ?? mapped[0] ?? null;
        probe.ok = kept.length > 0;
        probe.diagnosis =
          mapped.length === 0
            ? 'endpoint answers but no listing could be mapped - the field names changed (see mapListing)'
            : kept.length === 0
              ? `results are all outside ${target.city} - the location parameters are not scoping the search`
              : `healthy on variant "${variant.name}"`;
        return probe;
      }
      continue;
    }

    probe.attempts.push(`variant "${variant.name}": ${summarise(result)}${bodyHint(result)}`);
    await sleep(500);
  }

  if (!front.ok) {
    probe.diagnosis =
      `even ${portal.origin} is refused from this machine, so the API never had a chance. ` +
      'This is an IP-level block by the portal\'s edge network, not a parser problem - ' +
      'a home/residential connection normally passes where a datacenter or VPN IP does not.';
  } else if (probe.attempts.some((a) => / 403 | 401 /.test(a))) {
    probe.diagnosis =
      'front page loads but the API refuses every variant, including through Chromium - ' +
      'try again later, or raise SCRAPE_DELAY_MS if this started after a heavy run.';
  } else {
    probe.diagnosis =
      'no query variant returned listings - open the portal, watch the /v2/listings call in the ' +
      'network tab, and update GRUPOZAP_ENDPOINT or PARAM_VARIANTS in parsers/grupozap.ts.';
  }
  return probe;
}

async function probeQuintoAndar(target: SearchTarget, ctx: ScrapeContext): Promise<Probe> {
  const probe: Probe = {
    source: 'QUINTO_ANDAR',
    label: 'QuintoAndar',
    attempts: [],
    ok: false,
    transport: null,
    rawCount: 0,
    mappedCount: 0,
    sample: null,
    diagnosis: '',
  };

  const body = QUINTOANDAR_PROBE.buildBody(target, 0, 5);

  for (const url of QUINTOANDAR_PROBE.candidates) {
    const result = await requestJson(ctx, {
      url,
      method: 'POST',
      headers: { referer: QUINTOANDAR_PROBE.referer(target) },
      body,
      origin: QUINTOANDAR_PROBE.origin,
      channel: `doctor:quintoandar:${url}`,
    });

    if (result.ok && result.json !== null) {
      const envelope = extractHits(result.json);
      const hitContext = { state: envelope.state ?? target.state, listingType: target.listingType };
      const mapped = envelope.hits
        .map((hit) => mapHit(hit, hitContext))
        .filter((l): l is RawListing => l !== null);
      const kept = applyTargetFilters(mapped, target);
      const total = envelope.total === null ? '' : ` of ${envelope.total} available`;
      probe.attempts.push(
        `${url}: ${summarise(result)} - ${envelope.hits.length} hit(s)${total}, ` +
          `${mapped.length} mapped, ${kept.length} in ${target.city}`,
      );

      if (envelope.hits.length > 0) {
        probe.transport = result.transport;
        probe.rawCount = envelope.hits.length;
        probe.mappedCount = kept.length;
        probe.sample = kept[0] ?? mapped[0] ?? null;
        probe.ok = kept.length > 0;
        probe.diagnosis =
          mapped.length === 0
            ? 'endpoint answers but no hit could be mapped - the field names changed (see mapHit)'
            : kept.length === 0
              ? `results are all outside ${target.city} - check the citySlug below`
              : `healthy on ${url}`;
        return probe;
      }
      continue;
    }

    probe.attempts.push(`${url}: ${summarise(result)}${bodyHint(result)}`);
    await sleep(500);
  }

  probe.diagnosis = probe.attempts.every((a) => a.includes(' 404 '))
    ? 'every known path is gone - open the site, watch the POST to apigw.prod.quintoandar.com.br, ' +
      'and set QUINTOANDAR_ENDPOINT to the new URL'
    : `no candidate returned hits (citySlug=${QUINTOANDAR_PROBE.citySlug(target)})`;
  return probe;
}

/**
 * Probe for the page-scraped portals (OLX, Chaves na Mao, ImovelWeb).
 *
 * Reports the failure modes separately, because they need different fixes: the
 * page never loading (bot wall or a moved URL scheme), the page loading but
 * yielding nothing (the markup or structured data moved), or the page yielding
 * listings that are all in other cities (the URL is no longer scoping by city).
 */
async function probePage(
  source: PropertySource,
  config: PageParserConfig,
  target: SearchTarget,
  ctx: ScrapeContext,
): Promise<Probe> {
  const probe: Probe = {
    source,
    label: config.label,
    attempts: [],
    ok: false,
    transport: 'browser',
    rawCount: 0,
    mappedCount: 0,
    sample: null,
    diagnosis: '',
  };

  const page = await ctx.newPage();
  let reachedAPage = false;

  try {
    for (const url of config.urls(target, 1)) {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
      const status = response?.status() ?? 0;

      if (status === 0 || status >= 400) {
        probe.attempts.push(`${url}: HTTP ${status || 'no response'}`);
        continue;
      }
      reachedAPage = true;

      const listings = await config.extract(page, target);
      // These portals pad their results with promoted listings from other
      // cities, so report what a real run would KEEP, not just what the page
      // contained: "50 read, 0 kept" is a different problem from "0 read".
      const kept = applyTargetFilters(listings, target);
      probe.attempts.push(
        `${url}: HTTP ${status} - ${listings.length} listing(s) read, ${kept.length} in ${target.city}`,
      );

      if (listings.length > 0) {
        probe.rawCount = listings.length;
        probe.mappedCount = kept.length;
        probe.sample = kept[0] ?? listings[0];
        probe.ok = kept.length > 0;
        probe.diagnosis = probe.ok
          ? 'healthy'
          : `listings found but none are in ${target.city} - the URL is not scoping by city any more`;
        return probe;
      }
      await sleep(500);
    }
  } catch (err) {
    probe.attempts.push((err as Error).message);
  } finally {
    await page.close().catch(() => undefined);
  }

  probe.diagnosis = reachedAPage
    ? 'pages load but nothing could be read from them - the markup or structured data moved; ' +
      `compare the selectors in parsers/${source.toLowerCase().split('_').join('')}.ts against the live page`
    : 'no candidate URL served a page - bot wall, or the URL scheme moved';
  return probe;
}

async function probeDemo(target: SearchTarget, ctx: ScrapeContext): Promise<Probe> {
  const listings = await getParser('DEMO').search(target, ctx);
  return {
    source: 'DEMO',
    label: 'Demo generator (offline)',
    attempts: [`generated ${listings.length} synthetic listing(s) - no network involved`],
    ok: listings.length > 0,
    transport: null,
    rawCount: listings.length,
    mappedCount: listings.length,
    sample: listings[0] ?? null,
    diagnosis: listings.length > 0 ? 'healthy' : 'generated nothing - check the search target',
  };
}

function printProbe(probe: Probe): void {
  const badge = probe.ok ? 'OK    ' : 'FAILED';
  console.log(`\n[${badge}] ${probe.label}  (${probe.source})`);
  for (const attempt of probe.attempts) console.log(`        ${attempt}`);
  if (probe.transport) console.log(`        transport: ${probe.transport}`);
  console.log(`        -> ${probe.diagnosis}`);

  if (probe.sample) {
    const s = probe.sample;
    console.log(
      `        sample: "${s.title.slice(0, 70)}" | ${s.neighborhood}, ${s.city}${s.state ? `/${s.state}` : ''} | ` +
        `R$ ${s.rentPrice} + ${s.condoFee ?? 0} condo + ${s.taxFee ?? 0} tax | ` +
        `${s.bedrooms ?? 0}q ${s.bathrooms ?? 0}ban ${s.parkingSpots ?? 0}vg ${s.sqm ?? 0}m2 | ` +
        `${(s.images ?? []).length} photo(s)`,
    );
    console.log(`        url:    ${s.sourceUrl}`);
  }
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const sources = arg ? parseSources(arg) : config.sources;

  const targets = await buildSearchTargets();
  const target = targets[0];

  console.log(line);
  console.log('FindHome scraper doctor');
  console.log(line);
  console.log(`sources:  ${sources.join(', ')}   (all known: ${ALL_SOURCES.join(', ')})`);
  console.log(`target:   ${describeTarget(target)}`);
  console.log(`          citySlug=${target.citySlug} state=${target.state ?? 'NONE'} type=${target.listingType}`);
  if (targets.length > 1) console.log(`          (${targets.length} targets configured; probing the first)`);
  if (!target.state) {
    console.log('          WARNING: no state. ZAP location ids, QuintoAndar city slugs and the OLX/');
    console.log('          ImovelWeb/Chaves na Mao URL schemes all need one. Set it in Preferences.');
  }
  console.log(`ua:       ${config.userAgent}`);

  const browsers = new BrowserPool();
  const api = await createApiContext();
  const ctx: ScrapeContext = {
    api,
    newPage: () => browsers.newPage(),
    anchor: (origin) => browsers.anchor(origin),
    transports: new Map(),
    log: logger('doctor'),
    // One small page is enough to prove the contract.
    maxPages: 1,
    pageSize: 5,
    delay: () => sleep(config.requestDelayMs),
  };

  const probes: Probe[] = [];

  try {
    for (const source of sources) {
      switch (source) {
        case 'ZAP':
        case 'VIVA_REAL':
          probes.push(await probeGrupoZap(source, target, ctx));
          break;
        case 'QUINTO_ANDAR':
          probes.push(await probeQuintoAndar(target, ctx));
          break;
        case 'OLX':
          probes.push(await probePage(source, OLX_CONFIG, target, ctx));
          break;
        case 'CHAVES_NA_MAO':
          probes.push(await probePage(source, CHAVES_NA_MAO_CONFIG, target, ctx));
          break;
        case 'IMOVELWEB':
          probes.push(await probePage(source, IMOVELWEB_CONFIG, target, ctx));
          break;
        case 'DEMO':
          probes.push(await probeDemo(target, ctx));
          break;
        default:
          log.warn(`no probe for ${source}`);
      }
      await sleep(config.requestDelayMs);
    }
  } finally {
    await api.dispose().catch(() => undefined);
    await browsers.close();
  }

  for (const probe of probes) printProbe(probe);

  const failed = probes.filter((p) => !p.ok);
  console.log(`\n${line}`);
  console.log(`${probes.length - failed.length}/${probes.length} source(s) healthy`);
  if (failed.length) {
    console.log(`failing: ${failed.map((p) => p.source).join(', ')}`);
    console.log('Nothing was written to the database. Sources that pass here will work in a real run.');
  }
  console.log(line);

  process.exitCode = failed.length > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    log.error('doctor failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
