import { chromium, request, type APIRequestContext, type Browser } from 'playwright-core';
import { config } from './config.js';

/**
 * Chromium launch flags for a container.
 *
 * --no-sandbox / --disable-setuid-sandbox: the container already isolates the
 * process and there is no user namespace to build a sandbox in.
 * --disable-dev-shm-usage: Docker's default /dev/shm is 64MB, which Chromium
 * will happily blow through and crash on. Writing to /tmp instead is the
 * cheaper fix than raising shm_size.
 */
export const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--no-first-run',
  '--no-zygote',
  '--mute-audio',
];

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    args: CHROMIUM_ARGS,
    timeout: config.navigationTimeoutMs,
  });
}

export async function createApiContext(): Promise<APIRequestContext> {
  return request.newContext({
    userAgent: config.userAgent,
    timeout: config.navigationTimeoutMs,
    extraHTTPHeaders: {
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      accept: 'application/json, text/plain, */*',
    },
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
