import { env, envOptional } from '../config.js';
import { logger } from '../logger.js';

const log = logger('whatsapp');

/**
 * WhatsApp delivery, over whichever provider is configured.
 *
 * There is no single "WhatsApp API" a self-hoster can just use, so this is a
 * small adapter over the three realistic routes, chosen with WHATSAPP_PROVIDER:
 *
 *   webhook    POST the message to a URL you control. This is the one to use
 *              with Evolution API, Z-API, WPPConnect, n8n, Home Assistant or
 *              anything else already running on the box. Default, because a
 *              self-hoster almost always has one of those.
 *   cloud      Meta's official WhatsApp Cloud API. Free tier, but needs a
 *              Business account, a phone number id and a permanent token, and
 *              outside a 24h customer-service window it can only send
 *              pre-approved template messages — see the note on TEMPLATE below.
 *   callmebot  CallMeBot's personal-use bridge. Zero setup beyond messaging
 *              their number once to get an apikey. Rate-limited and not for
 *              anything important, but genuinely the fastest way to get a
 *              message on your phone tonight.
 *
 * `send` never throws: a broken channel must not fail a scrape run, and leaving
 * no AlertDelivery row means the listing is simply retried next time.
 */

export type WhatsAppProvider = 'webhook' | 'cloud' | 'callmebot' | 'telegram' | 'none';

const KNOWN: WhatsAppProvider[] = ['webhook', 'cloud', 'callmebot', 'telegram'];

export function configuredProvider(): WhatsAppProvider {
  const raw = env('WHATSAPP_PROVIDER', '').toLowerCase();
  if ((KNOWN as string[]).includes(raw)) return raw as WhatsAppProvider;
  if (raw === '' || raw === 'none' || raw === 'off') return 'none';
  log.warn(`unknown WHATSAPP_PROVIDER "${raw}" — alerts disabled`);
  return 'none';
}

export type SendResult = { ok: boolean; detail: string };

const TIMEOUT_MS = 15_000;

/**
 * Node 22 has a global `fetch`, but this package compiles with `lib: ["ES2022"]`
 * and no DOM — it is a Node service, and the parsers deliberately keep browser
 * typings out so that page code and server code cannot be confused for one
 * another. `Response` and `RequestInit` are therefore not in scope, so a narrow
 * local view of the parts actually used is declared instead of pulling in the
 * whole DOM surface. Same approach as the in-page fetch in ../http.ts.
 */
type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };

const httpFetch = (
  globalThis as unknown as { fetch: (url: string, init?: FetchInit) => Promise<FetchResponse> }
).fetch;

async function post(url: string, init: FetchInit): Promise<SendResult> {
  try {
    const response = await httpFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    return response.ok
      ? { ok: true, detail: `HTTP ${response.status}` }
      : { ok: false, detail: `HTTP ${response.status} ${body}` };
  } catch (err) {
    const name = (err as Error).name;
    return { ok: false, detail: name === 'TimeoutError' ? 'timed out' : (err as Error).message };
  }
}

/**
 * Your own endpoint. The body is deliberately flat and obvious so it can be
 * wired into anything without a transform step; `text` already contains the
 * whole formatted message.
 */
async function sendWebhook(to: string, text: string): Promise<SendResult> {
  const url = envOptional('WHATSAPP_WEBHOOK_URL');
  if (!url) return { ok: false, detail: 'WHATSAPP_WEBHOOK_URL is not set' };

  const token = envOptional('WHATSAPP_WEBHOOK_TOKEN');
  return post(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Sent both ways because the self-hosted gateways disagree about which
      // header they read.
      ...(token ? { authorization: `Bearer ${token}`, apikey: token } : {}),
    },
    body: JSON.stringify({ to, number: to, phone: to, text, message: text, source: 'findhome' }),
  });
}

/**
 * Meta's Cloud API.
 *
 * IMPORTANT: outside a 24-hour window opened by the user messaging your number
 * first, Meta only delivers *template* messages. An unsolicited alert is exactly
 * that case, so WHATSAPP_TEMPLATE must name an approved template whose body has
 * a single {{1}} parameter, and the whole message is passed as that parameter.
 * With no template configured this falls back to a plain text message, which
 * works while the window is open and is silently dropped once it closes — the
 * response is still 200, so watch for alerts that "send" but never arrive.
 */
async function sendCloud(to: string, text: string): Promise<SendResult> {
  const token = envOptional('WHATSAPP_CLOUD_TOKEN');
  const phoneId = envOptional('WHATSAPP_CLOUD_PHONE_ID');
  if (!token || !phoneId) return { ok: false, detail: 'WHATSAPP_CLOUD_TOKEN / _PHONE_ID are not set' };

  const template = envOptional('WHATSAPP_TEMPLATE');
  const version = env('WHATSAPP_CLOUD_VERSION', 'v21.0');

  const payload = template
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: env('WHATSAPP_TEMPLATE_LANG', 'pt_BR') },
          components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      };

  return post(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

/** CallMeBot takes everything in the query string. */
async function sendCallMeBot(to: string, text: string): Promise<SendResult> {
  const apiKey = envOptional('WHATSAPP_CALLMEBOT_APIKEY');
  if (!apiKey) return { ok: false, detail: 'WHATSAPP_CALLMEBOT_APIKEY is not set' };

  const query = new URLSearchParams({ phone: `+${to.replace(/\D/g, '')}`, text, apikey: apiKey });
  return post(`https://api.callmebot.com/whatsapp.php?${query}`, { method: 'GET' });
}

/**
 * Telegram, for when there is no free WhatsApp route left.
 *
 * Not WhatsApp, and that is the point: Telegram's Bot API is official, free with
 * no message charges, needs no business verification, no 24-hour window and no
 * approved templates. Setup is two steps — talk to @BotFather for a token, then
 * message your bot once and read your chat id from
 * api.telegram.org/bot<token>/getUpdates.
 *
 * The destination is the chat id, which is a number like a phone number, so it
 * goes in the same per-workspace field. A negative id is a group, which is the
 * useful case for a party: both people get the alert in one place.
 */
async function sendTelegram(to: string, text: string): Promise<SendResult> {
  const token = envOptional('TELEGRAM_BOT_TOKEN');
  if (!token) return { ok: false, detail: 'TELEGRAM_BOT_TOKEN is not set' };

  const chatId = envOptional('TELEGRAM_CHAT_ID') ?? to;

  return post(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // The composed message uses *bold* markers, which is Markdown in both
      // WhatsApp and Telegram. `disable_web_page_preview` keeps a five-listing
      // digest from turning into five link cards.
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
}

/**
 * Digits only, no plus — every provider here wants it that way.
 *
 * Telegram chat ids may be negative (groups), so a leading minus survives.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  const negative = raw.startsWith('-');
  const digits = raw.replace(/\D/g, '');
  // Shortest plausible international number; guards against a half-typed field
  // turning into a message to nobody. Telegram ids are 9-10 digits.
  if (digits.length < 9 || digits.length > 15) return null;
  return negative ? `-${digits}` : digits;
}

export async function sendWhatsApp(to: string, text: string): Promise<SendResult> {
  const provider = configuredProvider();
  if (provider === 'none') return { ok: false, detail: 'no WHATSAPP_PROVIDER configured' };

  const phone = normalizePhone(to);
  if (!phone) return { ok: false, detail: `"${to}" is not a usable phone number` };

  const result =
    provider === 'webhook'
      ? await sendWebhook(phone, text)
      : provider === 'cloud'
        ? await sendCloud(phone, text)
        : provider === 'telegram'
          ? await sendTelegram(phone, text)
          : await sendCallMeBot(phone, text);

  if (result.ok) log.info(`sent to ${phone.slice(0, 4)}…${phone.slice(-2)} via ${provider}`);
  else log.warn(`send to ${phone.slice(0, 4)}…${phone.slice(-2)} via ${provider} failed: ${result.detail}`);

  return result;
}
