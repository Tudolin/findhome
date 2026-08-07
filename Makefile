# FindHome — day-to-day operations on the home server.
# Run `make` with no target for the list.

SHELL := /bin/bash
COMPOSE := docker compose

# Make the .env values available to recipes (psql needs the user/db names).
# `-include` so the Makefile still works before setup.sh has run.
-include .env
export

.DEFAULT_GOAL := help
.PHONY: help setup up down restart build rebuild logs logs-web logs-scraper ps \
        migrate seed scrape scrape-now scrape-demo doctor shell-db psql backup \
        restore update prune status scrape-status photos photos-stats \
        mirror media-clean media-status

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

setup: ## First-time bootstrap (installs Docker, generates .env, starts everything)
	./setup.sh

up: ## Start the stack in the background
	$(COMPOSE) up -d

down: ## Stop the stack (data volume is preserved)
	$(COMPOSE) down

restart: ## Restart every service
	$(COMPOSE) restart

build: ## Build images without starting
	$(COMPOSE) build

rebuild: ## Rebuild from scratch and restart
	$(COMPOSE) build --no-cache && $(COMPOSE) up -d

ps status: ## Show container status and health
	$(COMPOSE) ps

logs: ## Follow all logs
	$(COMPOSE) logs -f --tail=100

logs-web: ## Follow the app logs
	$(COMPOSE) logs -f --tail=100 web

logs-scraper: ## Follow the scraper logs
	$(COMPOSE) logs -f --tail=100 scraper

migrate: ## Apply pending database migrations
	$(COMPOSE) run --rm migrate

seed: ## Load demo users, party and listings
	$(COMPOSE) run --rm migrate npm run db:seed

scrape: ## Run the scraper now and wait for it:  make scrape [SOURCES=ZAP,OLX]
	$(COMPOSE) exec scraper node dist/cli.js $(SOURCES)

scrape-now: ## Run the scraper now in the BACKGROUND, via the control API
	@$(COMPOSE) exec scraper node -e "\
	  const t=process.env.SCRAPE_CONTROL_TOKEN||''; \
	  fetch('http://127.0.0.1:'+(process.env.SCRAPE_CONTROL_PORT||8080)+'/run', \
	    {method:'POST',headers:{'content-type':'application/json',...(t?{'x-scrape-token':t}:{})}, \
	     body:JSON.stringify('$(SOURCES)'?{sources:'$(SOURCES)'.split(',')}:{})}) \
	  .then(r=>r.json().then(d=>{console.log(r.status,JSON.stringify(d));process.exit(r.ok?0:1)})) \
	  .catch(e=>{console.error(e.message);process.exit(1)})"
	@echo "Follow it with: make logs-scraper"

scrape-demo: ## Trigger a run against the offline DEMO parser only
	$(COMPOSE) exec scraper node dist/cli.js DEMO

scrape-status: ## Show the last run's outcome per source
	@$(COMPOSE) exec scraper node -e "\
	  const t=process.env.SCRAPE_CONTROL_TOKEN||''; \
	  fetch('http://127.0.0.1:'+(process.env.SCRAPE_CONTROL_PORT||8080)+'/status', \
	    {headers:t?{'x-scrape-token':t}:{}}) \
	  .then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2))) \
	  .catch(e=>{console.error(e.message);process.exit(1)})"

doctor: ## Probe every configured portal and report what is broken and why
	$(COMPOSE) exec scraper node dist/doctor.js $(SOURCES)

photos: ## Fetch full galleries: make photos [N=2000] [RESET=1|<min-photos>]
	$(COMPOSE) exec $(if $(N),-e PHOTOS_MAX_PER_RUN=$(N),) scraper node dist/photos-cli.js \
	  $(if $(RESET),$(if $(filter 1,$(RESET)),--reset,--reset=$(RESET)),)

mirror: ## Download photo FILES to the local mirror: make mirror [N=4000]
	$(COMPOSE) exec $(if $(N),-e PHOTOS_MIRROR_MAX_PER_RUN=$(N),) scraper node dist/media-cli.js mirror

media-clean: ## Delete untouched dead listings, orphaned photo files and stale downloads
	$(COMPOSE) exec scraper node dist/media-cli.js clean

media-status: ## Mirror size, budget, and how many dead listings are safe to purge
	@$(COMPOSE) exec scraper node dist/media-cli.js status

photos-stats: ## Photos per listing, per source — the number to check when a carousel is short
	@$(COMPOSE) exec db psql -U $${POSTGRES_USER:-findhome} -d $${POSTGRES_DB:-findhome} -c "\
	  SELECT source, count(*) AS listings, \
	         count(*) FILTER (WHERE photos_fetched_at IS NULL) AS never_tried, \
	         round(avg(photo_count), 1) AS avg_photos, max(photo_count) AS most, \
	         count(*) FILTER (WHERE photo_count <= 1) AS one_or_none \
	  FROM properties WHERE active GROUP BY source ORDER BY source;"

psql shell-db: ## Open a psql prompt on the database
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-findhome} -d $${POSTGRES_DB:-findhome}

backup: ## Dump the database to ./backups
	./deploy/backup.sh

restore: ## Restore from a dump:  make restore FILE=backups/findhome-....sql.gz
	@test -n "$(FILE)" || { echo "Usage: make restore FILE=backups/findhome-....sql.gz"; exit 1; }
	gunzip -c "$(FILE)" | $(COMPOSE) exec -T db psql -U $${POSTGRES_USER:-findhome} -d $${POSTGRES_DB:-findhome}

update: ## Pull the latest code, rebuild, migrate and restart
	git pull --ff-only && $(COMPOSE) up -d --build && $(COMPOSE) run --rm migrate

prune: ## Reclaim disk from old images and build cache
	docker image prune -f && docker builder prune -f
