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
7. [Database, migrations and seeds](#database-migrations-and-seeds)
8. [Backup and restore](#backup-and-restore)
9. [Everyday commands](#everyday-commands)
10. [Architecture](#architecture)
11. [Configuration reference](#configuration-reference)
12. [Troubleshooting](#troubleshooting)
13. [Security notes](#security-notes)

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
SCRAPE_SOURCES=DEMO        # ZAP, VIVA_REAL, QUINTO_ANDAR, OLX, DEMO
```

### How a run works

1. **Targets** — every `PreferenceProfile` in the database (solo *and* party)
   becomes a search target. Profiles for the same city are merged into one
   widened search, so two people hunting São Paulo don't double the traffic.
2. **Parsers** — each enabled source is queried. ZAP, Viva Real and QuintoAndar
   are served by JSON endpoints, so those parsers use a plain HTTP client and
   never launch a browser. Only OLX drives Chromium, and it reads the page's
   `__NEXT_DATA__` hydration payload rather than CSS selectors.
3. **De-duplication** happens on three levels: by `external_id` within the
   batch, by `source_url` within the batch, and in the database via the unique
   `(source, external_id)` index — a listing seen again is *refreshed*, never
   duplicated. `created_at` is preserved so "new this week" stays meaningful.
4. **Stale listings** not seen for `SCRAPE_STALE_DAYS` are flagged inactive and
   drop out of the feed.
5. **Every source writes a `ScrapeRun` row** (found / created / updated / error),
   so a broken parser is visible in the database, not just in container logs.
   A failing source never aborts the others.

### Triggering a run by hand

```bash
make scrape                                    # uses SCRAPE_SOURCES from .env
make scrape-demo                               # offline parser only
docker compose exec scraper node dist/cli.js ZAP,VIVA_REAL
docker compose logs -f scraper
```

### Checking on it

```sql
-- make psql
SELECT source, status, started_at, listings_found, listings_created, error
FROM scrape_runs ORDER BY started_at DESC LIMIT 10;
```

### ⚠️ About the portal parsers

Real estate portals have no public API and no stability guarantee. The
endpoints and payload shapes the ZAP/Viva Real, QuintoAndar and OLX parsers
rely on are undocumented, are not versioned in practice, and **will** change.
OLX in particular sits behind bot protection.

The code is written to degrade rather than explode — a changed field skips a
listing, a failed source is recorded and the run continues — but expect to
maintain the parsers. Each one has a comment at the top explaining exactly what
to re-check and which env var overrides the endpoint
(`GRUPOZAP_ENDPOINT`, `QUINTOANDAR_ENDPOINT`).

Keep `SCRAPE_DELAY_MS` at a polite value and `SCRAPE_MAX_PAGES` low. Check the
terms of service of any portal you point this at; scraping may violate them.
That's your call to make, not the software's.

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
make scrape        trigger a scraper run now
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
| `SCRAPE_SOURCES` | `DEMO` | `ZAP,VIVA_REAL,QUINTO_ANDAR,OLX,DEMO` |
| `SCRAPE_ON_START` | `true` | Run one pass at container start |
| `SCRAPE_MAX_PAGES` | `2` | Pages per source per target |
| `SCRAPE_DELAY_MS` | `1500` | Politeness delay. Don't set near zero |
| `SCRAPE_STALE_DAYS` | `21` | Hide listings not seen in this long |
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
Expected eventually — see the warning in
[The scraping engine](#the-scraping-engine). Confirm the pipeline itself still
works with `make scrape-demo`, then check `scrape_runs.error` and update the
parser.

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
