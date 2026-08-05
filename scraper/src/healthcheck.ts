import { get } from 'node:http';
import { config } from './config.js';

/**
 * Container health probe:  node dist/healthcheck.js
 *
 * A script rather than an inline `node -e` in docker-compose.yml, because that
 * one-liner has to survive compose interpolation AND the container shell's
 * quoting, and it only takes one stray parenthesis for the probe to fail for
 * reasons that have nothing to do with the scraper's health.
 *
 * Uses node:http rather than global fetch: this package compiles with
 * `lib: ["ES2022"]` and no DOM, so `Response` is not typed here.
 *
 * Exits 0 when the control API answers, or when it is switched off — in that
 * case there is nothing to probe and the container should not be marked
 * unhealthy for it.
 */
if (!config.controlEnabled) process.exit(0);

const request = get(
  { host: '127.0.0.1', port: config.controlPort, path: '/health', timeout: 4000 },
  (response) => {
    const status = response.statusCode ?? 0;
    response.resume(); // drain, so the socket closes cleanly
    process.exit(status >= 200 && status < 300 ? 0 : 1);
  },
);

request.on('timeout', () => {
  request.destroy();
  process.exit(1);
});
request.on('error', () => process.exit(1));
