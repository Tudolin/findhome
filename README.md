# FindHome

Self-hosted real estate search aggregator with a collaborative **Party Mode**.

It scrapes listing portals on a schedule, filters them against your search
preferences, and gives you (or you *and* your partner/roommate) a shared board
to rank, annotate and track every apartment you're considering.

Everything runs in Docker on your own Linux box. No SaaS, no external auth, no
API keys.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Quick start (automated)](#quick-start-automated)
3. [Quick start (manual)](#quick-start-manual)
4. [Exposing it on your LAN](#exposing-it-on-your-lan)
5. [Reverse proxy](#reverse-proxy)
6. [The scraping engine](#the-scraping-engine)
7. [Appearance and language](#appearance-and-language)
8. [Pins and WhatsApp alerts](#pins-and-whatsapp-alerts)
9. [Map](#map)
10. [Visits and calendar sync](#visits-and-calendar-sync)
11. [Location standardisation](#location-standardisation)
12. [Database, migrations and seeds](#database-migrations-and-seeds)
13. [Backup and restore](#backup-and-restore)
14. [Everyday commands](#everyday-commands)
15. [Architecture](#architecture)
16. [Configuration reference](#configuration-reference)
17. [Troubleshooting](#troubleshooting)
18. [Security notes](#security-notes)

---

## What it does

**Solo Mode** — a private workspace. Your preferences, your shortlist, your notes.

**Party Mode** — create a Party, share the invite code, and you get a shared
workspace with:

- one set of search preferences for the whole party,
- a Kanban board (Interested → Favorite → Visit scheduled → Applied → Archived),
- per-member star ratings and pros/cons badges shown side by side,
- a **ranking engine** that rewards *agreement*, not just high averages,
- a discussion thread under every property.

The UI is a neumorphic pistachio theme — soft extruded surfaces on a single
tinted background. See [Design system](#design-system--neumorphic-pistachio).

You switch between workspaces from the top bar. The two never mix: every API
call resolves the active workspace and checks membership before it reads or
writes anything.

---

## Quick start (automated)

On a fresh Ubuntu/Debian server:

```bash
git clone <your-repo-url> findhome
cd findhome
chmod +x setup.sh deploy/backup.sh   # if the execute bit did not survive the transfer
./setup.sh
```

`setup.sh` is idempotent — safe to re-run — and does the whole job:

| Step | What happens |
|------|--------------|
| 1 | Checks for Docker + the compose plugin, offers to install them |
| 2 | Generates `.env` with random secrets, `chmod 600` (never overwrites an existing one) |
| 3 | `docker compose up -d --build` (first build takes several minutes) |
| 4 | Waits for `/api/health`, confirms migrations, optionally seeds demo data |
| 5 | Optionally installs a systemd unit (start on boot) and a nightly backup cron |
| 6 | Prints your LAN URL and the demo credentials |

Non-interactive:

```bash
./setup.sh --unattended              # accept every default
./setup.sh --no-seed --no-cron       # skip demo data and the backup cron
```

When it finishes, open `http://<server-ip>:3000`.

> The scraper ships with `SCRAPE_SOURCES=DEMO` — an offline parser that
> generates synthetic listings and makes zero network calls. That lets you
> verify the whole pipeline before pointing it at real portals. See
> [The scraping engine](#the-scraping-engine).

---

## Quick start (manual)

If you'd rather do it by hand:

```bash
# 1. Configure
cp .env.example .env
nano .env
#    - POSTGRES_PASSWORD  ->  openssl rand -base64 24
#    - JWT_SECRET         ->  openssl rand -base64 48   (min 32 chars)

# 2. Build and start
docker compose up -d --build

# 3. Migrations run automatically via the one-shot `migrate` service.
#    Confirm they applied:
docker compose logs migrate

# 4. Optional: demo users, a demo party and sample listings
docker compose run --rm migrate npm run db:seed

# 5. Check it's alive
curl http://localhost:3000/api/health
# {"status":"ok","database":"up"}
```

Then open `http://<server-ip>:3000` and register the first account.

Seeded demo accounts (password = `SEED_PASSWORD` from `.env`, default
`findhome123`):

| Email | Role |
|-------|------|
| `alex@findhome.local` | owner of the demo party |
| `sam@findhome.local` | member of the demo party |

Demo party invite code: `DEMO2026`.

### Start on boot without systemd

Every service uses `restart: unless-stopped`, so Docker brings the stack back
after a reboot on its own. The systemd unit that `setup.sh` offers is only for
`systemctl start/stop findhome` convenience and ordering after `docker.service`.

---

## Exposing it on your LAN

`.env` controls this:

```bash
BIND_ADDRESS=0.0.0.0   # reachable from the LAN  -> http://192.168.1.50:3000
WEB_PORT=3000
```

Find the address:

```bash
hostname -I | awk '{print $1}'
```

Give it a name your household can remember by adding a record to your router,
Pi-hole or AdGuard: `findhome.home.arpa → 192.168.1.50`.

If UFW is enabled:

```bash
sudo ufw allow from 192.168.0.0/16 to any port 3000 proto tcp
```

**Only the `web` service publishes a port.** Postgres and the scraper stay on
the private `findhome` bridge network and are not reachable from the LAN.

---

## Reverse proxy

Whichever proxy you use, set `BIND_ADDRESS=127.0.0.1` in `.env` first and
`docker compose up -d` — the app should only be reachable through the proxy.
Once TLS is terminated, also set `COOKIE_SECURE=true`.

### Plain Nginx

```bash
sudo cp deploy/nginx-findhome.conf /etc/nginx/sites-available/findhome
sudo ln -s /etc/nginx/sites-available/findhome /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Nginx Proxy Manager

NPM can only route to containers it shares a network with.

1. In `docker-compose.yml`, uncomment the `proxy` external network at the
   bottom and add `proxy` to the `web` service's `networks:` list.
2. `docker compose up -d`
3. In NPM → **Proxy Hosts** → **Add**:
   - Domain: `findhome.home.arpa`
   - Scheme: `http`, Forward Hostname: `findhome-web`, Forward Port: `3000`
   - Enable **Websockets Support** (Next.js streaming needs it)
   - Block Common Exploits: on

### Traefik v3

```bash
docker compose -f docker-compose.yml -f deploy/traefik-labels.yml up -d
```

Edit the `Host(...)` rule, entrypoint and cert resolver names in
[`deploy/traefik-labels.yml`](deploy/traefik-labels.yml) to match your setup.

---

## The scraping engine

A dedicated container runs an internal cron (`node-cron`) — no host crontab
involved.

```bash
SCRAPE_CRON=0 8,20 * * *   # 08:00 and 20:00 daily (default)
SCRAPE_CRON=0 */6 * * *    # every 6 hours
SCRAPE_CRON=0 8 * * *      # once a day at 08:00
SCRAPE_SOURCES=DEMO        # see the table below
```

### The sources

| Source | How it reads the portal | Status |
|---|---|---|
| `QUINTO_ANDAR` | JSON API (`/house-listing-search/v3/search/list`) | verified working |
| `OLX` | renders the page, reads the `section.olx-adcard` cards | verified working |
| `CHAVES_NA_MAO` | renders the page, reads its schema.org `Offer` list | verified working |
| `IMOVELWEB` | renders the page, reads the `data-qa` card hooks | verified working |
| `ZAP`, `VIVA_REAL` | Grupo ZAP's shared JSON API | blocked by Cloudflare from datacenter IPs — see below |
| `DEMO` | synthetic listings, no network calls | always works |

Each parser's source file opens with a comment recording the exact contract it
depends on and how it was verified, so the next person to fix it starts from
facts rather than guesses.

### Is it working? `make doctor`

```bash
make doctor                      # probes every source in SCRAPE_SOURCES
make doctor SOURCES=ZAP,OLX      # or just these
```

This is the first thing to run when the feed stops filling up. A log line
saying `403 Forbidden` does not tell you *which* thing broke, and the four
possibilities have four different fixes. The doctor separates them:

```
[OK    ] QuintoAndar  (QUINTO_ANDAR)
        .../v3/search/list: 200 application/json via direct - 5 hit(s) of 65438 available, 5 mapped, 5 in São Paulo
        -> healthy
        sample: "Apartamento · 1 quartos em Campos Elíseos" | Campos Elíseos, São Paulo/SP | R$ 1785 + 1169 condo ...

[OK    ] OLX  (OLX)
        https://www.olx.com.br/imoveis/aluguel/estado-sp/sao-paulo?o=1: HTTP 200 - 50 listing(s) read, 14 in São Paulo
        -> healthy
```

It reports, per source: which URL answered, over which transport, how many
listings came back, **how many survive the city filter**, a mapped sample, and a
diagnosis naming the likely cause. It writes nothing to the database and exits
non-zero if any source failed.

The distinctions it draws are the useful part:

- *endpoint moved* — every known path 404s → set `GRUPOZAP_ENDPOINT` / `QUINTOANDAR_ENDPOINT`
- *contract changed* — 200 but 0 listings → the query parameters were renamed
- *fields renamed* — listings returned but none map → fix the parser's mapper
- *markup redesigned* — page loads but nothing readable → fix the selectors
- *IP blocked* — even the portal's front page 403s → nothing to fix in this code

### How a run works

1. **Targets** — every `PreferenceProfile` in the database (solo *and* party)
   becomes a search target. Profiles for the same city *and state* are merged
   into one widened search, so two people hunting São Paulo don't double the
   traffic. City, state and neighborhoods are canonicalised first (see
   [Location standardisation](#location-standardisation)).
2. **Transport** — the JSON parsers try a plain HTTP client first. If the
   endpoint answers with a bot wall (403/429, or 200 with a non-JSON body), the
   request is retried *from inside a real Chromium page parked on the portal's
   own origin*, which carries Chromium's TLS fingerprint and cookie jar. That is
   what the portal's own front-end looks like, because it is what the portal's
   own front-end does. Chromium is launched lazily, so an unchallenged run never
   pays for it.
3. **De-duplication** happens on three levels: by `external_id` within the
   batch, by `source_url` within the batch, and in the database via the unique
   `(source, external_id)` index — a listing seen again is *refreshed*, never
   duplicated. `created_at` is preserved so "new this week" stays meaningful.
4. **Filtering** — every portal pads its results with promoted listings from
   other cities, so anything outside the target city is dropped before it is
   stored. Minimum bedrooms and area are enforced here too, because ZAP's and
   QuintoAndar's equivalent parameters are exact-match, not minimums.
5. **Stale listings** not seen for `SCRAPE_STALE_DAYS` are flagged inactive and
   drop out of the feed.
6. **Every source writes a `ScrapeRun` row** (found / created / updated / error),
   so a broken parser is visible in the database, not just in container logs.
   A failing source never aborts the others. A source that completes but returns
   **zero** listings is recorded with a note and shown as a warning in the app —
   "200 OK, nothing found" is the failure that hides best.

### Triggering a run by hand

Four ways in, all equivalent:

```bash
# In the app:  Discovery -> "Scrape now"          (any signed-in user)
make scrape                     # run now and WAIT; exits non-zero if a source failed
make scrape SOURCES=ZAP,OLX     # ...only these
make scrape-now                 # run now in the BACKGROUND (what the button does)
make scrape-status              # last run's outcome per source
make scrape-demo                # offline parser only
```

The button and `make scrape-now` both go through the scraper's small control
API. That port is **not** published by compose — only the `web` container can
reach it, over the private bridge network, authenticated with
`SCRAPE_CONTROL_TOKEN` (generated by `setup.sh`).

### Checking on it

```sql
-- make psql
SELECT source, status, started_at, listings_found, listings_created, error
FROM scrape_runs ORDER BY started_at DESC LIMIT 10;
```

### ⚠️ About the portal parsers

Real estate portals have no public API and no stability guarantee. The endpoints,
payload shapes and markup these parsers rely on are undocumented, are not
versioned in practice, and **will** change.

The code is written to degrade rather than explode — a changed field skips a
listing, a failed source is recorded and the run continues — and `make doctor`
tells you which part moved. Expect to do some maintenance anyway.

**ZAP and Viva Real specifically:** Grupo ZAP fronts both the portal and its API
with Cloudflare, and from a datacenter or VPN address *the front page itself*
answers 403 — there is no request this code can make that would work. A
residential connection (which is what a home server usually has) normally passes.
`make doctor` distinguishes this case explicitly rather than blaming the parser.

Keep `SCRAPE_DELAY_MS` at a polite value and `SCRAPE_MAX_PAGES` low. Check the
terms of service of any portal you point this at; scraping may violate them.
That's your call to make, not the software's.

---

## Appearance and language

A theme switch (light / dark / follow the system) and a language switch
(Português / English) sit together in the top bar. Both are per-device cookies,
not account settings — a phone read in a dark room and a laptop in daylight want
different answers, and a shared party account may be read in two languages.

Neither adds a dependency. The theme is CSS custom properties: `tailwind.config.ts`
resolves every colour and every neumorphic shadow through `var(--…)`, and the two
palettes live in `globals.css` under `:root` and `:root[data-theme='dark']`. That
indirection is what makes dark mode possible at all here — this style's depth
comes from a pair of shadow tones that must flip with the background, and a
Tailwind `dark:` variant cannot restyle a shadow baked into a utility class. A
small blocking script in `<head>` applies the theme before first paint, so there
is no white flash on a dark-mode load.

Translation is a typed dictionary in `web/src/lib/i18n/`. `en.ts` defines the
shape and `pt.ts` is checked against it, so a missing key is a build error rather
than a blank label. Server components call `getDictionary()`; client components
read the same dictionary from `LocaleProvider`.

The dark palette is not a filter over the light one. Neumorphism needs a mid-tone
surface with room for a highlight above and a shadow below, so the dark surface
sits at `#252b22` rather than near-black, and the `ink` scale is inverted so
`text-ink-800` stays "body text" in both skins. Status colours go through
`--c-danger` / `--c-warning` / `--c-info` / `--c-plan` because Tailwind's fixed
steps cannot serve both: `rose-700` is right on cream and invisible on charcoal.

---

## Pins and WhatsApp alerts

**Pins** put a listing at the top of the feed. A pin is scoped like every other
interaction: made in Solo Mode it is yours alone, made inside a party it is
visible to the party *as yours* — each member owns their own row, so the card can
say "pinned by Sam" rather than flattening it into an anonymous flag. Pinned
listings sort first under every sort order, and `📌 Pinned only` in the toolbar
narrows to just them.

**Alerts** send a WhatsApp message when a new listing matches a saved search.
Enabled per workspace on the Preferences screen (switch, number, and a cap on how
many listings one message may carry); the provider is server-wide config:

```bash
WHATSAPP_PROVIDER=callmebot # free, zero infrastructure — start here
WHATSAPP_PROVIDER=telegram  # free and official, but Telegram rather than WhatsApp
WHATSAPP_PROVIDER=webhook   # your own gateway: Evolution API, WPPConnect, n8n, …
WHATSAPP_PROVIDER=cloud     # Meta's official Cloud API — paid for this use case
```

### Which one if you do not want to pay for anything

There is no free, official, unsolicited-message WhatsApp API. Meta's Cloud API is
the only official route and it bills per template message in Brazil, on top of
needing a verified business account. So the realistic options are:

| | Cost | Setup | Catch |
|---|---|---|---|
| **`callmebot`** | free | 2 minutes, no infra | Unofficial, rate-limited, personal use only. One number. |
| **`telegram`** | free | 5 minutes, no infra | Not WhatsApp — but official, unlimited and it will not break. |
| **`webhook`** + self-hosted gateway | free to run | a container on the box you already have | Unofficial WhatsApp clients (Baileys/WPPConnect) log in as *your* account and **can get the number banned**. |
| **`cloud`** | paid | business verification | Correct and reliable, but not free. |

`callmebot` is the fastest thing that puts a message on your phone tonight:

```bash
# 1. save +34 644 51 95 23 as a contact
# 2. send it exactly:  I allow callmebot to send me messages
# 3. it replies with your apikey
WHATSAPP_PROVIDER=callmebot
WHATSAPP_CALLMEBOT_APIKEY=123456
# then put your own number in the WhatsApp field on the Preferences screen
```

`telegram` is what to switch to when you want it to keep working:

```bash
# 1. message @BotFather, /newbot, copy the token
# 2. send your new bot any message
# 3. open https://api.telegram.org/bot<TOKEN>/getUpdates -> result[0].message.chat.id
WHATSAPP_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=123456:AA…
# put that chat id in the Preferences field, or pin it here for every workspace:
TELEGRAM_CHAT_ID=
```

A negative chat id is a Telegram group — worth using for a party, so both people
get the alert in one place.

Three properties it is built around:

- **Never twice.** `alert_deliveries` holds one row per (workspace, listing), and
  the candidate query is "matches AND has no row here" — duplicates are
  impossible by construction rather than by remembering a timestamp.
- **Never a flood.** The first check after enabling marks everything currently
  matching as already seen, so switching alerts on does not narrate the back
  catalogue. After that, only listings first seen within `ALERT_MAX_AGE_HOURS`
  qualify, and `alertMaxPerRun` caps one message.
- **Never fatal.** A dead channel logs a warning and writes no rows, so the
  listings are retried next run and the scrape still succeeds.

> ⚠️ Delivery itself is the one thing in this project that was **not** verified
> end to end — that needs your gateway credentials. The message composition,
> matching, de-duplication and first-run baseline were tested; whether your
> provider accepts the payload is the part to check first. Watch
> `docker compose logs scraper | grep whatsapp`.
>
> A note specific to `cloud`: outside a 24-hour window opened by *you* messaging
> the business number, Meta only delivers pre-approved **template** messages.
> Set `WHATSAPP_TEMPLATE` to a template with a single `{{1}}` body parameter, or
> sends will return 200 and quietly go nowhere.

---

## Map

`/map` plots every listing that has coordinates on an OpenStreetMap, drawn with
Leaflet. Markers are **price labels**, not teardrops — comparing what costs what,
where, is the only reason to look at a map of listings. Clicking one opens a
popup with the photo, address and specs.

Beside the map is a **legend**: every plotted listing, cheapest first, with a
thumbnail. It is not decoration — a price pin tells you *what*, the legend tells
you *which*, and it is the only way to reach a listing whose marker sits
underneath another one. Clicking a row flies to that marker and opens its popup.

The initial zoom fits the **5th–95th percentile** of the pins rather than their
full extent. Fitting the raw min/max means one mislocated listing — a vague
address the geocoder resolved to the middle of the state — zooms the city down to
a dot. Trimming the tails keeps the view on the city you actually chose.

Two decisions worth knowing about:

**Leaflet is loaded from a CDN, not bundled.** The map's tiles come from
`tile.openstreetmap.org` at view time, so this feature already cannot work
offline; fetching Leaflet the same way therefore adds no new failure mode, keeps
the image smaller, and means users who never open the map never download it. To
run fully self-hosted, drop `leaflet.js`/`leaflet.css` into `web/public/` and
point `LEAFLET_JS`/`LEAFLET_CSS` in `PropertyMap.tsx` at them.

**Not every listing has coordinates.** QuintoAndar and Chaves na Mão publish
lat/lon; OLX and ImovelWeb do not. The page says how many are missing rather than
quietly showing a partial map. To fill the gap, turn on geocoding:

```bash
GEOCODE_ENABLED=true
GEOCODE_CONTACT=you@example.com    # required by Nominatim's usage policy
GEOCODE_MAX_PER_RUN=25
```

It is off by default deliberately. Nominatim is donated OpenStreetMap
infrastructure whose policy allows one request per second, requires a contact
address, and forbids bulk geocoding — so this resolves a handful per run and works
through the backlog over days. A transient failure (403, rate limit, timeout)
leaves the listing untried so it is retried later; only a genuine "address not
found" is recorded as final. Point `GEOCODE_ENDPOINT` at your own Nominatim
container to lift all of it.

> Note: Nominatim refuses most datacenter IP ranges. If `make doctor`-style
> geocoding logs show `HTTP 403`, that is why — a home connection normally works.

---

## Visits and calendar sync

`/visits` is the viewing agenda. Bookings are scoped like everything else: made in
Solo Mode they are yours, made inside a party the whole party sees them, because
one person books the trip and both need it in their calendar. Booking a viewing
also nudges the listing's status to *Visit scheduled* — but only forwards, so a
listing you already applied for is not walked backwards.

A visit is deliberately **not** just the `VISIT_SCHEDULED` status. That status
answers "how far did this listing get"; a visit answers "when, for how long, and
what did we agree to ask". One flat can be visited twice, and it keeps its status
after the visit is over.

### Getting it into Apple / Google Calendar

Three ways out, no OAuth:

| | What it does |
|---|---|
| **Subscribe** | A URL your calendar app polls. New bookings appear on their own. |
| **Add to Google Calendar** | One-click link for a single viewing. |
| **Download .ics** | A file for one viewing — opens in any calendar app. |

The subscription is the one that matters for a shared search: your partner books
a viewing in the app and it lands on your phone without anyone exporting
anything. Paste the URL into Apple Calendar (*File → New Calendar Subscription*)
or Google Calendar (*Other calendars → From URL*); the `webcal://` button does it
in one click on desktop.

Per-vendor OAuth was considered and rejected: two provider integrations, two
consent screens and two sets of refresh tokens to maintain, to arrive at the same
place iCalendar already reaches — and Apple has no such API at all.

> ⚠️ **The subscription URL is a bearer token.** Apple and Google fetch it from
> their own servers with no cookies, so the secret has to be in the URL. Anyone
> holding the link can read your viewing schedule — dates, addresses, notes —
> until you rotate it. It grants nothing else: no session, no writes, no listings.
> *Generate a new link* on the agenda screen invalidates it and every existing
> subscription.
>
> Behind a reverse proxy, set `APP_ORIGIN` so the generated URL uses your public
> hostname instead of the container's.

The feed is a person, not a workspace: it returns the union of your solo agenda
and every party you belong to, because nobody wants to subscribe to one calendar
per party and merge them by hand.

---

## Location standardisation

Cities, states and neighborhoods arrive spelled every possible way — the user
types `sao paulo`, one portal returns `São Paulo` and another `SAO PAULO`. So
every place name is reduced to a slug before it is stored or compared:

```
"São Paulo"  "sao paulo"  "  SÃO  PAULO "   ->  sao-paulo
"Paraná"     "parana"     "PR"              ->  PR        (canonical UF)
```

- **Storage.** `properties` and `preference_profiles` each keep the display
  spelling *and* a slug column (`city_slug`, `neighborhood_slug(s)`). Cards show
  the pretty name; filters compare the slug.
- **Filtering.** The feed matches `citySlug` exactly. The previous
  `{ city: { equals, mode: 'insensitive' } }` looked equivalent but is not —
  case-insensitivity does nothing about accents, so a profile saved as
  `Sao Paulo` matched no listing at all.
- **State.** Preferences now carry a state, picked from a list of the 27 UFs.
  This matters: ZAP builds a location id from it, QuintoAndar builds a city slug
  from it, and OLX/ImovelWeb/Chaves na Mão all put it in the URL. Without one,
  searches are broader and can return a same-named city in another state — the
  app says so on the Preferences screen instead of failing quietly.
- **Neighborhoods.** Entering `vila mariana` when `Vila Mariana` is already a tag
  toggles it off instead of adding a duplicate, in the UI and again on the server.

The slug function is implemented three times — `scraper/src/locations.ts`,
`web/src/lib/locations.ts` and in SQL in the `location_normalization` migration
(which backfills existing rows). They must agree, and the migration's comment
says so; the SQL was checked against the TypeScript over 28 awkward names
(cedillas, tildes, apostrophes, punctuation-only input) before shipping.

---

## Database, migrations and seeds

Postgres 16 in a container, data in the named volume `findhome-pgdata`.

Prisma is the ORM; the schema lives at
[`prisma/schema.prisma`](prisma/schema.prisma) and is shared by both the web
app and the scraper (each Docker image copies it in, so there's a single source
of truth).

### Migrations

The one-shot `migrate` service runs `prisma migrate deploy` before `web` and
`scraper` start — `depends_on: service_completed_successfully` guarantees the
ordering. You never have to run migrations manually on a normal deploy.

```bash
make migrate                       # re-apply pending migrations
docker compose logs migrate        # verify
```

To change the schema during development:

```bash
# edit prisma/schema.prisma, then
docker compose run --rm migrate npx prisma migrate dev --name describe_change
```

### Seeds

```bash
make seed        # or: docker compose run --rm migrate npm run db:seed
```

The seed is fully upsert-based, so re-running it is safe. It creates two demo
users, a shared party, both preference profiles, six sample listings and enough
interactions that the Co-Op board isn't empty on first login.

---

## Backup and restore

The whole application state is one Postgres database.

```bash
make backup                                    # -> ./backups/findhome-<stamp>.sql.gz
./deploy/backup.sh /mnt/nas/findhome           # or anywhere else
```

The script verifies the dump isn't a truncated stub and prunes anything older
than `BACKUP_KEEP_DAYS` (default 14). `setup.sh` offers to schedule it nightly
at 03:15 via your crontab.

Restore:

```bash
make restore FILE=backups/findhome-20260804-031500.sql.gz
```

To move the whole install to another machine, copy the repo, the `.env` and one
dump — that's everything.

---

## Everyday commands

```
make help          list every target
make up            start
make down          stop (data is preserved)
make logs          follow all logs
make ps            container status and health
make scrape        run the scraper now and wait for it
make scrape-now    run the scraper now in the background
make scrape-status last run's outcome per source
make doctor        probe every portal and report what is broken and why
make seed          load demo data
make backup        dump the database
make psql          open a SQL prompt
make update        git pull + rebuild + migrate + restart
make prune         reclaim disk from old images and build cache
```

---

## Architecture

```
                        ┌──────────────────────────────┐
   LAN / reverse proxy  │  web  (Next.js App Router)   │
   :3000  ─────────────▶│  UI + REST API + auth        │
                        │  standalone build, ~200MB    │
                        └───────────────┬──────────────┘
                                        │
                        ┌───────────────▼──────────────┐
                        │  db  (PostgreSQL 16-alpine)  │
                        │  volume: findhome-pgdata     │
                        └───────────────▲──────────────┘
                                        │
                        ┌───────────────┴──────────────┐
                        │  scraper (node-cron +        │
                        │  Playwright/Chromium)        │
                        │  ZAP · VivaReal · QuintoAndar│
                        │  · OLX · DEMO                │
                        └──────────────────────────────┘
                    migrate (one-shot, exits after deploy)
```

### Why this shape

- **One Next.js service for UI *and* API.** A separate Fastify backend would
  mean a second container, a second image and CORS config for zero benefit on a
  single-user-household deployment. Route Handlers cover the API cleanly.
- **The scraper is its own container.** Chromium's memory profile is nothing
  like a web server's, and an OOM in a scrape must not take down the UI. It also
  lets you cap it separately (`SCRAPER_MEMORY_LIMIT`) or stop it entirely.
- **Chromium is only launched when a parser needs it.** Three of four portal
  parsers hit JSON endpoints, so the scraper idles at ~80MB instead of holding
  a browser open.
- **No `mcr.microsoft.com/playwright` base image.** It bundles Chromium,
  Firefox *and* WebKit (~3.9GB). Installing just the Chromium headless shell
  onto the same slim Node base the web service uses brings the scraper image
  down to 1.5GB and shares base layers with `web`.
- **Standalone Next.js output.** 479MB runtime image instead of ~700MB, with
  no build toolchain shipped to production.
- **Image optimization is off.** Re-encoding third-party listing photos would
  burn CPU on a home server for no gain.

### Layout

```
findhome/
├── docker-compose.yml       all four services
├── .env.example             every knob, documented
├── setup.sh                 automated bootstrap
├── Makefile                 day-to-day operations
├── prisma/
│   ├── schema.prisma        shared by web + scraper
│   └── migrations/          committed SQL, applied with `migrate deploy`
├── web/                     Next.js app
│   ├── Dockerfile           deps → builder → tools → runner
│   ├── scripts/seed.ts      demo users, party and listings
│   └── src/
│       ├── app/
│       │   ├── (auth)/      /login, /register
│       │   ├── (app)/       /dashboard, /preferences, /co-op, /property/[id]
│       │   └── api/         REST handlers
│       │   ├── globals.css  neumorphic component classes
│       │   ├── error.tsx / not-found.tsx / loading.tsx
│       │   └── icon.svg     favicon
│       ├── components/
│       ├── lib/
│       │   ├── workspace.ts single enforcement point for Solo/Party isolation
│       │   ├── scoring.ts   the party ranking engine
│       │   ├── matching.ts  preferences → SQL filter
│       │   └── queries.ts   shared reads for pages and API
│       └── middleware.ts    coarse route guard (Edge)
├── scraper/
│   ├── Dockerfile
│   └── src/
│       ├── index.ts         cron scheduler
│       ├── runner.ts        one full pass, per-source error isolation
│       ├── targets.ts       preferences → search targets
│       ├── persist.ts       normalisation + de-duplication
│       └── parsers/         one module per portal
└── deploy/
    ├── nginx-findhome.conf
    ├── traefik-labels.yml
    └── backup.sh
```

### Design system — neumorphic pistachio

Defined in [`web/tailwind.config.ts`](web/tailwind.config.ts) and
[`web/src/app/globals.css`](web/src/app/globals.css). Three rules hold the
whole thing together:

1. **One surface colour.** `#eef3e8` is the page *and* every card. Depth comes
   only from shadows, never from a colour change. A filled panel would sit on
   top of the design instead of inside it.
2. **One light source.** Every shadow uses exactly two tones — white up-left,
   `#c7d3bc` down-right — via the `shadow-neu`, `shadow-neu-sm`,
   `shadow-neu-lg`, `shadow-neu-inset` and `shadow-neu-inset-sm` utilities.
   Mixing in other tones makes the page look lit from several directions.
3. **Raised = actionable, pressed = active.** Buttons, cards and unselected
   chips are extruded; inputs, wells, selected toggles and the active nav item
   are carved in. Pistachio `#93c572` is reserved for the primary button, the
   logo and “this is selected”.

**On the accessibility trade-off:** low contrast is neumorphism's well-known
failure mode, and it was handled rather than ignored.

- Body text sits on `ink-700/800/900`, well clear of WCAG AA on this surface.
- Status is never colour-only — every status chip pairs a coloured dot with a
  text label (`StatusChip`).
- Selected toggles get a `ring-1 ring-brand-300` on top of the inset shadow
  (`.pressed-on`). The inset alone is too subtle at chip size to be a reliable
  "selected" signal.
- Focus rings are a solid 2px pistachio ring, not a shadow.

### Data model

| Model | Purpose |
|-------|---------|
| `User` | account (local email + bcrypt hash) |
| `Party` | shared workspace, carries the invite code |
| `PartyMember` | membership + role (`OWNER` / `MEMBER`) |
| `PreferenceProfile` | search filter; `user_id` **or** `party_id` set, never both |
| `Property` | a scraped listing, unique on `(source, external_id)` |
| `PropertyInteraction` | one row per (property, user, workspace): status, rating, pros, cons, notes |
| `PropertyComment` | discussion thread, scoped to a workspace |
| `ScrapeRun` | per-source run log for observability |

Two design notes worth knowing:

- **`scope_key`** on interactions and comments is `"solo"` in Solo Mode or the
  party id in Party Mode. It exists because Postgres treats `NULL`s as distinct
  in unique indexes, which would otherwise let duplicate solo rows through. The
  unique index is `(property_id, user_id, scope_key)`.
- **`total_price`** is stored, not computed, so the feed can filter and sort on
  the all-in price (rent + condo + taxes) directly in SQL. That's what makes the
  *"Calculate max budget as (Rent + Condo Fee + Taxes)"* toggle a one-line
  change of which column the filter targets.

### The ranking engine

`web/src/lib/scoring.ts` turns each member's rating and status into a single
0–100 score:

```
score = 100 × ( 0.55·(avgRating/5) + 0.15·coverage + 0.15·consensus + 0.15·statusWeight )
```

- **coverage** — share of members who actually rated it. A place both partners
  rated 4 outranks one a single partner rated 5.
- **consensus** — `1 − spread/4`. Agreement is rewarded; a 3+ star gap flags the
  card as *"needs a talk"*.
- **statusWeight** — how far it got (Applied > Visit > Favorite > Interested).
- A rejection from **any** member multiplies the whole score by 0.35.

---

## Configuration reference

Everything is set in `.env`. Full annotated list in
[`.env.example`](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | — | **Required.** Compose refuses to start without it |
| `JWT_SECRET` | — | **Required**, min 32 chars. Changing it logs everyone out |
| `SESSION_TTL_DAYS` | `30` | Session cookie lifetime |
| `COOKIE_SECURE` | `false` | Set `true` **only** behind HTTPS — otherwise login loops |
| `ALLOW_REGISTRATION` | `true` | Set `false` once your household has accounts |
| `MAX_PARTY_MEMBERS` | `6` | Cap per party |
| `BIND_ADDRESS` | `0.0.0.0` | `127.0.0.1` when a reverse proxy fronts the app |
| `WEB_PORT` | `3000` | Host port |
| `TZ` | `America/Sao_Paulo` | Drives cron evaluation |
| `SCRAPE_CRON` | `0 8,20 * * *` | Standard 5-field cron |
| `SCRAPE_SOURCES` | `DEMO` | `ZAP,VIVA_REAL,QUINTO_ANDAR,OLX,CHAVES_NA_MAO,IMOVELWEB,DEMO` |
| `SCRAPE_ON_START` | `true` | Run one pass at container start |
| `SCRAPE_MAX_PAGES` | `2` | Pages per source per target |
| `SCRAPE_DELAY_MS` | `1500` | Politeness delay. Don't set near zero |
| `SCRAPE_STALE_DAYS` | `21` | Hide listings not seen in this long |
| `SCRAPE_DEFAULT_CITY/STATE` | `São Paulo`/`SP` | Used until someone saves preferences, and for profiles with no state |
| `SCRAPE_CONTROL_TOKEN` | *(generated)* | Guards the manual-trigger API. `setup.sh` fills it in |
| `SCRAPE_CONTROL_PORT` | `8080` | Never published to the LAN |
| `SCRAPE_CONTROL_ENABLED` | `true` | `false` disables "Scrape now" and `make scrape-now` |
| `GRUPOZAP_ENDPOINT` | *(built-in)* | Override when `make doctor` says the path moved |
| `QUINTOANDAR_ENDPOINT` | *(built-in)* | Same |
| `WHATSAPP_PROVIDER` | *(empty)* | `webhook` / `cloud` / `callmebot`. Empty disables alerts |
| `ALERT_MAX_AGE_HOURS` | `48` | Older listings are marked seen rather than announced |
| `GEOCODE_ENABLED` | `false` | Resolve missing coordinates for the map |
| `GEOCODE_CONTACT` | *(empty)* | Email in the User-Agent. Required by Nominatim's policy |
| `GEOCODE_MAX_PER_RUN` | `25` | Keeps within the 1 req/s policy over time |
| `GEOCODE_ENDPOINT` | *(Nominatim)* | Point at your own instance to lift the limits |
| `APP_ORIGIN` | *(from request)* | Public base URL, for calendar-feed links behind a proxy |
| `DB_/WEB_/SCRAPER_MEMORY_LIMIT` | `512M`/`512M`/`1G` | Per-container caps |
| `SCRAPER_SHM_SIZE` | `512mb` | Chromium crashes on Docker's default 64MB |

### Sizing

Measured on an idle stack right after a seed and a DEMO scrape:

| Container | RAM (idle) |
|---|---|
| `findhome-db` | 47 MB |
| `findhome-web` | 65 MB |
| `findhome-scraper` | 82 MB |
| **total** | **~195 MB** |

The default limits in `docker-compose.yml` (512M / 512M / 1G) leave plenty of
headroom; the scraper's 1G is sized for an OLX run, which is the only time
Chromium is resident.

Disk, images only: `web` 479MB, `scraper` 1.54GB, `migrate` 1.16GB, `postgres`
420MB — but the three FindHome images share the same Debian/Node base layers,
so the real cost is around **3GB**, plus the database volume. A 2GB Raspberry
Pi 4 or an N100 mini-PC runs this comfortably.

`migrate` is the chunkiest image for what it does: it carries the Prisma CLI
and its query engines so that migrations and seeding do not have to ship inside
the web runtime. It only runs for a few seconds at startup.

---

## Troubleshooting

**Login redirects straight back to `/login`.**
`COOKIE_SECURE=true` over plain HTTP. The browser drops the `Secure` cookie
silently. Set it to `false`, or terminate TLS.

**`migrate` exits non-zero.**
```bash
docker compose logs migrate
```
Usually a wrong `DATABASE_URL` or a password containing characters that broke
the connection string. Re-check `POSTGRES_PASSWORD` in `.env` — avoid `@`, `/`
and `:` (the generated one already does).

**Scraper finds 0 listings from a real portal.**
Run `make doctor` — it names the cause instead of leaving you to guess, and
tells apart a moved endpoint, a renamed field, a redesigned page and a blocked
IP. Confirm the pipeline itself still works with `make scrape-demo`. The app also
flags this on the Discovery banner: a source that answers but returns nothing is
shown amber, not green.

**ZAP / Viva Real always fail with 403.**
Grupo ZAP blocks datacenter and VPN addresses at the edge — `make doctor` will
say so explicitly when even the portal's front page is refused. Nothing in the
parser can fix that; run from a residential connection, or drop those two from
`SCRAPE_SOURCES` and use the other four.

**"Scrape now" says the scraper is unreachable.**
```bash
docker compose ps scraper                 # up? healthy?
docker compose logs scraper | grep control
```
`web` reaches the scraper at `http://scraper:8080` over the compose network. Check
that `SCRAPE_CONTROL_TOKEN` is the *same* value for both services (it comes from
one `.env` key, so this only breaks if you edited compose) and that
`SCRAPE_CONTROL_ENABLED` is not `false`.

**Feed is empty even though listings were scraped.**
Almost always a city or state mismatch in Preferences. Check what the filter is
actually looking for versus what was stored:
```sql
SELECT city, city_slug, state FROM preference_profiles;
SELECT DISTINCT city, city_slug, state FROM properties;
```
The `city_slug` values must match exactly. Re-saving Preferences recomputes them.

**Chromium crashes / `Target closed`.**
Raise `SCRAPER_SHM_SIZE` to `1gb` and `SCRAPER_MEMORY_LIMIT` to `1.5G`.

**Port 3000 is taken.**
Change `WEB_PORT` in `.env`, then `docker compose up -d`.

**Health check.**
```bash
curl http://localhost:3000/api/health
docker compose ps          # health column
```

**Start clean (destroys all data).**
```bash
docker compose down -v && docker compose up -d --build
```

---

## Security notes

This is built for a **private LAN**. Before putting it on the public internet:

- Set `ALLOW_REGISTRATION=false` after creating your accounts. Otherwise anyone
  who reaches the app can sign up.
- Terminate TLS at a reverse proxy and set `COOKIE_SECURE=true`.
- Use a long random `JWT_SECRET` (`setup.sh` generates a 64-char one).
- There is **no rate limiting** on the login endpoint. Add it at the proxy
  (`limit_req` in Nginx) if the app is internet-facing.
- `.env` holds your database password and JWT secret — `setup.sh` sets mode
  `600`; keep it out of version control (it's in `.gitignore`).
- Postgres is not published to the host by default. Keep it that way unless you
  genuinely need a desktop SQL client.
