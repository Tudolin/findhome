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
        migrate seed scrape scrape-demo shell-db psql backup restore update prune status

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

scrape: ## Trigger a scraper run immediately (uses SCRAPE_SOURCES from .env)
	$(COMPOSE) exec scraper node dist/cli.js

scrape-demo: ## Trigger a run against the offline DEMO parser only
	$(COMPOSE) exec scraper node dist/cli.js DEMO

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
